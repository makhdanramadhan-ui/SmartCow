// SmartCow FINAL KIRI: 3 DS18B20 + 2 DHT22 -> ESP-NOW -> kanan -> Firebase.
// ESP32 klasik Dev Module / WROOM-32. Library: OneWire, DallasTemperature,
// DHT sensor library (Adafruit). Upload dari folder espkiri_FINAL.
// Pasangkan HANYA dengan espkanan_FINAL (format paket versi 3).
// DS DATA: GPIO4/14/18, masing-masing pull-up fisik 4.7k ke 3V3.
// DHT3 DATA19, DHT4 DATA25. GPIO20 TIDAK ADA pada ESP32 klasik.
// VCC3V3/GND lokal, pull-up DATA 4.7k-10k ke 3V3 bila modul belum punya.
// Kabel tes pendek; lindungi DHT dari hujan/matahari/sprinkler, tetap ventilasi.
// Cabut daya sebelum memasang/melepas jack atau sensor.

#include <Arduino.h>
#include <WiFi.h>
#include <DHT.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_system.h>
#include <esp_arduino_version.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <math.h>

// ISI MAC STA ESP KANAN dari Serial Monitor, bukan MAC router.
// Contoh format saja: {0xAA, 0xBB, 0xCC, 0x11, 0x22, 0x33}.
const uint8_t RIGHT_MAC[6] = {0, 0, 0, 0, 0, 0};
constexpr uint8_t ESPNOW_CHANNEL = 6; // sama dengan kanan + kanal tetap router
const uint8_t SENSOR_PINS[3] = {4, 14, 18}; // S4, S5, S6
const uint8_t DHT_PINS[2] = {19, 25};
constexpr uint8_t HUMIDITY_LABEL_BASE = 3; // H3, H4
constexpr uint32_t CONVERSION_MS = 800;
constexpr uint32_t SAMPLE_MS = 1000;
constexpr uint32_t LOCAL_TIMEOUT_MS = 3000;
constexpr uint32_t HUMIDITY_SAMPLE_MS = 3000;
constexpr uint32_t HUMIDITY_LOCAL_TIMEOUT_MS = 7000;
constexpr uint32_t SEND_MS = 2000;
constexpr uint32_t ACK_WAIT_MS = 300;
constexpr uint8_t MAX_ATTEMPTS = 4;

// Format HARUS identik dengan espkanan_FINAL. Tidak kompatibel versi lama.
constexpr uint32_t PACKET_MAGIC = 0x53435732;
constexpr uint8_t PACKET_VERSION = 3;
constexpr uint8_t PACKET_SAMPLE = 1;
constexpr uint8_t PACKET_ACK = 2;
struct WirePacket {
  uint32_t magic;
  uint8_t version, type, validMask, humidityValidMask;
  uint32_t bootId, sequence, sampleAgeMs;
  float temperature[3];
  float humidity[2];
  uint32_t humidityAgeMs[2];
  float dhtTemperature[2];
};
static_assert(sizeof(WirePacket) == 56, "Format paket harus sama di kedua ESP");
struct DhtChannel {
  bool valid, haveSample;
  float humidity, temperature;
  uint32_t sampledAt;
};

OneWire buses[3] = {SENSOR_PINS[0], SENSOR_PINS[1], SENSOR_PINS[2]};
DallasTemperature sensors[3] = {&buses[0], &buses[1], &buses[2]};
DHT dhtSensors[2] = {DHT(DHT_PINS[0], DHT22), DHT(DHT_PINS[1], DHT22)};
DhtChannel dht[2] = {};
uint32_t lastHumidityRead = 0;
float temperature[3] = {-127, -127, -127};
uint8_t validMask = 0;
bool converting = false, haveSample = false;
uint32_t conversionStarted = 0, sampledAt = 0, lastScan = 0;
uint32_t bootId = 0, sequence = 0, lastSend = 0, lastAttempt = 0;
uint32_t pendingSampledAt = 0, pendingHumiditySampledAt[2] = {};
uint8_t attempts = 0;
bool awaitingAck = false;
WirePacket pendingPacket = {};
QueueHandle_t ackQueue = nullptr;

// Prototipe eksplisit untuk preprocessor Arduino, termasuk callback core 2/3.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onReceive(const esp_now_recv_info_t *info, const uint8_t *data, int length);
#else
void onReceive(const uint8_t *mac, const uint8_t *data, int length);
#endif

bool usableTemperature(float t) {
  return isfinite(t) && t >= -55.0f && t <= 125.0f;
}

bool usableHumidity(float h) {
  return isfinite(h) && h >= 0.0f && h <= 100.0f;
}

void beginHumidity() {
  for (int i = 0; i < 2; i++) {
    dhtSensors[i].begin();
    dht[i].humidity = dht[i].temperature = NAN;
    Serial.printf("DHT%d DATA GPIO%u\n", i + HUMIDITY_LABEL_BASE, DHT_PINS[i]);
  }
  lastHumidityRead = millis();
}

void serviceHumidity() {
  if (uint32_t(millis() - lastHumidityRead) < HUMIDITY_SAMPLE_MS) return;
  lastHumidityRead = millis();
  for (int i = 0; i < 2; i++) {
    float rh = dhtSensors[i].readHumidity();
    float t = dhtSensors[i].readTemperature();
    dht[i].valid = usableHumidity(rh) && isfinite(t) && t >= -40 && t <= 80;
    if (dht[i].valid) {
      dht[i].humidity = rh;
      dht[i].temperature = t;
      dht[i].sampledAt = millis();
      dht[i].haveSample = true;
    } else {
      Serial.printf("DHT%d gagal; cek DATA/pull-up/daya.\n", i + HUMIDITY_LABEL_BASE);
    }
  }
}

void receiveAck(const uint8_t *mac, const uint8_t *data, int length) {
  if (length != sizeof(WirePacket) || memcmp(mac, RIGHT_MAC, 6) != 0) return;
  WirePacket packet;
  memcpy(&packet, data, sizeof(packet));
  if (packet.magic != PACKET_MAGIC || packet.version != PACKET_VERSION ||
      packet.type != PACKET_ACK) return;
  xQueueOverwrite(ackQueue, &packet); // callback hanya menyalin, tanpa HTTP/delay
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onReceive(const esp_now_recv_info_t *info, const uint8_t *data, int length) {
  receiveAck(info->src_addr, data, length);
}
#else
void onReceive(const uint8_t *mac, const uint8_t *data, int length) {
  receiveAck(mac, data, length);
}
#endif

void beginConversion() {
  for (int i = 0; i < 3; i++) sensors[i].requestTemperatures();
  conversionStarted = millis();
  converting = true;
}

void scanSensors() {
  for (int i = 0; i < 3; i++) {
    sensors[i].begin();
    sensors[i].setResolution(12);
    sensors[i].setWaitForConversion(false);
    Serial.printf("S%d GPIO%u: %s\n", i + 4, SENSOR_PINS[i],
      sensors[i].getDeviceCount() ? "terdeteksi" : "tidak terdeteksi");
  }
  lastScan = millis();
}

void serviceSensors() {
  uint32_t now = millis();
  if (converting && uint32_t(now - conversionStarted) >= CONVERSION_MS) {
    validMask = 0;
    for (int i = 0; i < 3; i++) {
      float t = sensors[i].getTempCByIndex(0);
      if (usableTemperature(t)) {
        temperature[i] = t;
        validMask |= uint8_t(1U << i);
      }
    }
    sampledAt = millis();
    haveSample = true;
    converting = false;
  }
  now = millis();
  if (!converting && uint32_t(now - lastScan) >= 60000) scanSensors();
  if (!converting && (!haveSample || uint32_t(now - sampledAt) >= SAMPLE_MS - CONVERSION_MS))
    beginConversion();
}

void sendAttempt() {
  // Retry: timestamp milik PAKET ini, bukan sampel baru yang muncul sesudahnya.
  pendingPacket.sampleAgeMs = millis() - pendingSampledAt;
  for (int i = 0; i < 2; i++) {
    if (pendingPacket.humidityAgeMs[i] != UINT32_MAX)
      pendingPacket.humidityAgeMs[i] = millis() - pendingHumiditySampledAt[i];
  }
  esp_err_t result = esp_now_send(RIGHT_MAC,
    reinterpret_cast<const uint8_t *>(&pendingPacket), sizeof(pendingPacket));
  lastAttempt = millis();
  attempts++;
  if (result != ESP_OK) Serial.printf("Kirim ESP-NOW gagal: %d\n", int(result));
}

void serviceRadio() {
  WirePacket ack;
  while (xQueueReceive(ackQueue, &ack, 0) == pdTRUE) {
    if (awaitingAck && ack.bootId == pendingPacket.bootId && ack.sequence == pendingPacket.sequence) {
      awaitingAck = false;
      Serial.printf("ACK kanan seq=%lu diterima\n", (unsigned long)ack.sequence);
    }
  }
  uint32_t now = millis();
  if (awaitingAck && uint32_t(now - lastAttempt) >= ACK_WAIT_MS) {
    if (attempts < MAX_ATTEMPTS) sendAttempt();
    else {
      awaitingAck = false;
      Serial.println("Kanan belum membalas. Cek MAC, kanal, versi sketch, dan jarak.");
    }
  }
  if (!haveSample || awaitingAck || uint32_t(now - lastSend) < SEND_MS) return;
  pendingPacket = {};
  pendingPacket.magic = PACKET_MAGIC;
  pendingPacket.version = PACKET_VERSION;
  pendingPacket.type = PACKET_SAMPLE;
  pendingPacket.validMask = uint32_t(now - sampledAt) < LOCAL_TIMEOUT_MS ? validMask : 0;
  pendingPacket.bootId = bootId;
  pendingPacket.sequence = ++sequence;
  memcpy(pendingPacket.temperature, temperature, sizeof(temperature));
  pendingSampledAt = sampledAt;
  for (int i = 0; i < 2; i++) {
    pendingPacket.humidity[i] = dht[i].humidity;
    pendingPacket.dhtTemperature[i] = dht[i].temperature;
    pendingPacket.humidityAgeMs[i] = dht[i].haveSample ? now - dht[i].sampledAt : UINT32_MAX;
    pendingHumiditySampledAt[i] = dht[i].sampledAt;
    if (dht[i].valid && pendingPacket.humidityAgeMs[i] < HUMIDITY_LOCAL_TIMEOUT_MS)
      pendingPacket.humidityValidMask |= uint8_t(1U << i);
  }
  lastSend = now;
  attempts = 0;
  awaitingAck = true;
  Serial.printf("S4=%.2f S5=%.2f S6=%.2f mask=%u | H3=%.2f H4=%.2f RHmask=%u seq=%lu\n",
    temperature[0], temperature[1], temperature[2], pendingPacket.validMask,
    dht[0].humidity, dht[1].humidity, pendingPacket.humidityValidMask, (unsigned long)sequence);
  sendAttempt();
}

void stopWithError(const char *message) {
  Serial.println(message);
  while (true) delay(1000);
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA); // radio aktif, tidak login router
  WiFi.setSleep(false);
  Serial.printf("MAC STA ESP KIRI: %s\n", WiFi.macAddress().c_str());
  bool allZero = true;
  for (int i = 0; i < 6; i++) if (RIGHT_MAC[i]) allZero = false;
  if (allZero || (RIGHT_MAC[0] & 1U)) stopWithError("ISI RIGHT_MAC dengan MAC STA kanan dahulu.");
  if (ESPNOW_CHANNEL < 1 || ESPNOW_CHANNEL > 13) stopWithError("Kanal harus 1..13.");
  if (esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE) != ESP_OK)
    stopWithError("Gagal mengatur kanal radio.");
  ackQueue = xQueueCreate(1, sizeof(WirePacket));
  if (!ackQueue || esp_now_init() != ESP_OK) stopWithError("Gagal memulai queue / ESP-NOW.");
  esp_now_register_recv_cb(onReceive);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, RIGHT_MAC, 6);
  peer.channel = ESPNOW_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false; // pilot lokal, bukan autentikasi/enkripsi produksi
  if (esp_now_add_peer(&peer) != ESP_OK) stopWithError("Gagal memasangkan ESP kanan.");
  bootId = esp_random();
  Serial.printf("ESP-NOW v3 kanal %u; tanpa login Wi-Fi/Firebase.\n", ESPNOW_CHANNEL);
  beginHumidity();
  scanSensors();
  beginConversion();
}

void loop() {
  serviceRadio();
  serviceSensors();
  serviceHumidity();
  delay(5);
}
