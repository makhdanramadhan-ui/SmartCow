// SmartCow ESP KIRI: 3 DS18B20 pin sendiri -> ESP-NOW -> ESP kanan.
// Board: ESP32 Dev Module / WROOM-32. Library: OneWire, DallasTemperature.
// Salin sketch ini SENDIRI ke folder espkiri/espkiri.ino untuk Arduino IDE.
// Tiap DATA wajib pull-up fisik 4.7k ke 3V3. Cabut daya saat pindah jack.

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_system.h>
#include <esp_arduino_version.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <math.h>

// ISI MAC STA ESP KANAN dari Serial Monitor espkanan, bukan MAC router.
// Contoh format: {0xAA, 0xBB, 0xCC, 0x11, 0x22, 0x33}.
const uint8_t RIGHT_MAC[6] = {0, 0, 0, 0, 0, 0};
// HARUS sama di kanan, kiri, dan kanal tetap router 2.4 GHz.
constexpr uint8_t ESPNOW_CHANNEL = 6;
const uint8_t SENSOR_PINS[3] = {4, 14, 18}; // S4, S5, S6 di web
constexpr uint32_t CONVERSION_MS = 800; // 12-bit: maksimal 750 ms + margin
constexpr uint32_t SAMPLE_MS = 1000;
constexpr uint32_t SEND_MS = 2000;
constexpr uint32_t ACK_WAIT_MS = 300;
constexpr uint8_t MAX_ATTEMPTS = 4; // 1 kirim + maksimal 3 retry

// Format HARUS identik dengan espkanan. Total 32 byte, bukan raw audio.
constexpr uint32_t PACKET_MAGIC = 0x53435732;
constexpr uint8_t PACKET_VERSION = 1;
constexpr uint8_t PACKET_SAMPLE = 1;
constexpr uint8_t PACKET_ACK = 2;
struct WirePacket {
  uint32_t magic;
  uint8_t version, type, validMask, reserved;
  uint32_t bootId, sequence, sampleAgeMs;
  float temperature[3];
};
static_assert(sizeof(WirePacket) == 32, "Format paket harus sama di kedua ESP");

OneWire buses[3] = {SENSOR_PINS[0], SENSOR_PINS[1], SENSOR_PINS[2]};
DallasTemperature sensors[3] = {&buses[0], &buses[1], &buses[2]};
float temperature[3] = {-127, -127, -127}; // terakhir terbaca; mask menentukan valid
uint8_t validMask = 0;
bool converting = false, haveSample = false;
uint32_t conversionStarted = 0, sampledAt = 0, lastScan = 0;
uint32_t bootId = 0, sequence = 0, lastSend = 0, lastAttempt = 0, pendingSampledAt = 0;
uint8_t attempts = 0;
bool awaitingAck = false;
WirePacket pendingPacket = {};
QueueHandle_t ackQueue = nullptr;

// Prototipe eksplisit supaya preprocessor Arduino mengenali tipe paket.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onReceive(const esp_now_recv_info_t *info, const uint8_t *data, int length);
#else
void onReceive(const uint8_t *mac, const uint8_t *data, int length);
#endif
void receiveAck(const uint8_t *mac, const uint8_t *data, int length);

bool usableTemperature(float t) {
  return isfinite(t) && t >= -55.0f && t <= 125.0f;
}

void receiveAck(const uint8_t *mac, const uint8_t *data, int length) {
  if (length != sizeof(WirePacket) || memcmp(mac, RIGHT_MAC, 6) != 0) return;
  WirePacket packet;
  memcpy(&packet, data, sizeof(packet));
  if (packet.magic != PACKET_MAGIC || packet.version != PACKET_VERSION ||
      packet.type != PACKET_ACK) return;
  // Callback berjalan di task Wi-Fi. Tidak ada Serial/HTTP/delay di sini.
  xQueueOverwrite(ackQueue, &packet);
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
  now = millis(); // pembacaan bus memakan waktu; hindari unsigned underflow
  // Scan ulang hanya DI ANTARA konversi, untuk sensor yang dipindah jack.
  if (!converting && uint32_t(now - lastScan) >= 60000) scanSensors();
  if (!converting && (!haveSample || uint32_t(now - sampledAt) >= SAMPLE_MS - CONVERSION_MS))
    beginConversion();
}

void sendAttempt() {
  // Retry memakai sequence yang sama. Usia sampel selalu diperbarui.
  pendingPacket.sampleAgeMs = millis() - pendingSampledAt;
  esp_err_t result = esp_now_send(RIGHT_MAC,
    reinterpret_cast<const uint8_t *>(&pendingPacket), sizeof(pendingPacket));
  lastAttempt = millis();
  attempts++;
  if (result != ESP_OK) Serial.printf("Kirim ESP-NOW gagal: %d\n", int(result));
}

void serviceRadio() {
  WirePacket ack;
  while (xQueueReceive(ackQueue, &ack, 0) == pdTRUE) {
    if (awaitingAck && ack.bootId == pendingPacket.bootId &&
        ack.sequence == pendingPacket.sequence) {
      awaitingAck = false;
      Serial.printf("ACK kanan seq=%lu diterima\n", (unsigned long)ack.sequence);
    }
  }
  uint32_t now = millis();
  if (awaitingAck && uint32_t(now - lastAttempt) >= ACK_WAIT_MS) {
    if (attempts < MAX_ATTEMPTS) sendAttempt();
    else {
      awaitingAck = false;
      Serial.println("Kanan belum membalas. Cek daya, MAC, kanal, dan jarak.");
    }
  }
  if (!haveSample || awaitingAck || uint32_t(now - lastSend) < SEND_MS) return;
  pendingPacket = {};
  pendingPacket.magic = PACKET_MAGIC;
  pendingPacket.version = PACKET_VERSION;
  pendingPacket.type = PACKET_SAMPLE;
  pendingPacket.validMask = validMask;
  pendingPacket.bootId = bootId;
  pendingPacket.sequence = ++sequence;
  memcpy(pendingPacket.temperature, temperature, sizeof(temperature));
  pendingSampledAt = sampledAt;
  lastSend = now;
  attempts = 0;
  awaitingAck = true;
  Serial.printf("Kirim S4=%.2f S5=%.2f S6=%.2f mask=%u seq=%lu\n",
                temperature[0], temperature[1], temperature[2], validMask,
                (unsigned long)sequence);
  sendAttempt();
}

void stopWithError(const char *message) {
  Serial.println(message);
  while (true) delay(1000);
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA); // radio aktif; TIDAK login ke router
  WiFi.setSleep(false);
  Serial.printf("MAC STA ESP KIRI: %s\n", WiFi.macAddress().c_str());
  bool allZero = true;
  for (int i = 0; i < 6; i++) if (RIGHT_MAC[i]) allZero = false;
  if (allZero || (RIGHT_MAC[0] & 1U))
    stopWithError("ISI RIGHT_MAC dengan MAC STA ESP kanan dahulu.");
  if (ESPNOW_CHANNEL < 1 || ESPNOW_CHANNEL > 13)
    stopWithError("ESPNOW_CHANNEL harus 1..13 dan sama dengan router.");
  if (esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE) != ESP_OK)
    stopWithError("Gagal mengatur kanal radio.");
  ackQueue = xQueueCreate(1, sizeof(WirePacket));
  if (!ackQueue || esp_now_init() != ESP_OK)
    stopWithError("Gagal membuat queue / memulai ESP-NOW.");
  esp_now_register_recv_cb(onReceive);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, RIGHT_MAC, 6);
  peer.channel = ESPNOW_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false; // pilot lokal; bukan autentikasi/enkripsi produksi
  if (esp_now_add_peer(&peer) != ESP_OK) stopWithError("Gagal memasangkan ESP kanan.");
  bootId = esp_random();
  Serial.printf("ESP-NOW kanal %u; tidak memakai Wi-Fi/Firebase login.\n", ESPNOW_CHANNEL);
  scanSensors();
  beginConversion();
}

void loop() {
  serviceSensors();
  serviceRadio();
  delay(5);
}
