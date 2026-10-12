// SmartCow FINAL KANAN: 3 DS18B20 + 2 DHT22 lokal, sisi kiri via ESP-NOW.
// Rata-rata/kontrol suhu HANYA DS. DHT22: RH + suhu pendamping untuk monitoring.
// Board: ESP32 klasik Dev Module / WROOM-32. Library: OneWire,
// DallasTemperature, DHT sensor library (Adafruit), ArduinoJson versi 7.
// Upload dari folder espkanan_FINAL. Pasangkan HANYA dengan espkiri_FINAL (v3).
// DS DATA GPIO4/14/18: tiap jalur pull-up fisik 4.7k ke 3V3. SSR IN GPIO23.
// DHT1 DATA19, DHT2 DATA25. GPIO20 TIDAK ADA pada ESP32 klasik.
// VCC3V3/GND lokal; pull-up DATA 4.7k-10k ke 3V3 jika belum ada di modul.
// DHT harus teduh/kering tetapi berventilasi; jauh dari hujan dan sprinkler.
// Kontrol relay TETAP berdasarkan suhu, BUKAN RH/THI. Gagal DHT tidak memblokir
// threshold jika 6 DS valid. Gagal DS/kiri stale -> threshold OFF seperti versi DS.
// Manual/jadwal tidak memakai proteksi suhu/maxDuration/cooldown threshold.
// Manual ON bertahan sampai perintah OFF, termasuk saat internet putus.
// THI belum dihitung: pasangan lokasi DS/DHT belum ditentukan.
// Cabut daya saat pindah jack; uji tanpa AC. Pengerjaan 220V oleh orang kompeten.

#include <Arduino.h>
#include <WiFi.h>
#include <DHT.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>
#include <math.h>

// ISI DI SALINAN LOKAL, jangan commit password/secret. Rotasi secret terbagikan.
#define WIFI_SSID "GANTI_WIFI_SSID"
#define WIFI_PASSWORD "GANTI_WIFI_PASSWORD"
#define DATABASE_URL "https://smartcow-de25f-default-rtdb.asia-southeast1.firebasedatabase.app"
#define DATABASE_SECRET "GANTI_DATABASE_SECRET"
#define DEVICE_ID "cow-sprinkler-01"
constexpr uint8_t ESPNOW_CHANNEL = 6; // sama dengan kiri + kanal tetap router 2.4GHz
// Opsional: MAC STA kiri. Nol = belajar pengirim valid pertama sampai reboot.
const uint8_t LEFT_MAC[6] = {0, 0, 0, 0, 0, 0};
const uint8_t SENSOR_PINS[3] = {4, 14, 18}; // S1, S2, S3
const uint8_t DHT_PINS[2] = {19, 25};
constexpr uint8_t HUMIDITY_LABEL_BASE = 1; // DHT1, DHT2
constexpr uint8_t SSR_PIN = 23;
constexpr bool SSR_ACTIVE_HIGH = true;
constexpr uint32_t LEFT_TIMEOUT_MS = 10000;
constexpr uint32_t LOCAL_TIMEOUT_MS = 3000;
constexpr uint32_t CONVERSION_MS = 800;
constexpr uint32_t SAMPLE_MS = 1000;
constexpr uint32_t HUMIDITY_SAMPLE_MS = 3000;
constexpr uint32_t HUMIDITY_LOCAL_TIMEOUT_MS = 7000;
constexpr uint32_t TELEMETRY_MS = 2000;
constexpr uint32_t CONTROL_MS = 5000;
constexpr uint32_t LOG_MS = 30000;
constexpr uint32_t WIFI_RETRY_MS = 30000;
constexpr uint32_t WIFI_CONNECT_WINDOW_MS = 10000;
constexpr uint8_t MAX_SLOTS = 6;
const char FW_VERSION[] = "3.0.0-final-ds-dht22";

// Format HARUS identik dengan espkiri_FINAL.
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
struct ReceivedPacket {
  uint8_t mac[6];
  WirePacket packet;
  uint32_t receivedAt;
};
struct ScheduleSlot {
  char date[11];
  char start[8];
  int duration;
};
struct ControlConfig {
  char mode[8], manual[8], autoSource[10];
  float threshold, hysteresis;
  int maxDuration, cooldown, slotCount;
  ScheduleSlot slots[MAX_SLOTS];
  bool legacySchedule;
  char legacyStart[8];
  int legacyDuration;
};
struct Snapshot {
  float temperature[6], avg;
  uint8_t validMask, validCount;
  bool leftOnline, complete, relayOn, scheduleOn;
  uint32_t leftAgeMs, capturedAt;
  char mode[8], autoSource[10];
  float humidity[4], humidityAvg;
  uint8_t humidityValidMask, humidityValidCount;
  uint32_t humidityAgeMs[4];
  float dhtTemperature[4];
  uint32_t temperatureAgeMs[6];
};
struct RelayEvent {
  char type[24], reason[80];
  float avg;
  uint32_t capturedAt;
};

// Prototipe eksplisit untuk tipe custom dan callback core 2.x / 3.x.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onReceive(const esp_now_recv_info_t *info, const uint8_t *data, int length);
#else
void onReceive(const uint8_t *mac, const uint8_t *data, int length);
#endif
ControlConfig defaultControl();
void buildSnapshot(Snapshot &out);
bool parseControl(const String &body, ControlConfig &out);
void sendTelemetry(const Snapshot &state);
void sendLog(const Snapshot &state);
void sendStatus(const Snapshot &state);
bool sendEvent(const RelayEvent &event);
void fillHumidity(JsonDocument &doc, const Snapshot &state);
void fillTelemetry(JsonDocument &doc, const Snapshot &state);

OneWire buses[3] = {SENSOR_PINS[0], SENSOR_PINS[1], SENSOR_PINS[2]};
DallasTemperature sensors[3] = {&buses[0], &buses[1], &buses[2]};
DHT dhtSensors[2] = {DHT(DHT_PINS[0], DHT22), DHT(DHT_PINS[1], DHT22)};
DhtChannel dht[2] = {};
uint32_t lastHumidityRead = 0;
float localT[3] = {-127, -127, -127}, remoteT[3] = {-127, -127, -127};
float remoteHumidity[2] = {NAN, NAN};
float remoteDhtTemperature[2] = {NAN, NAN};
uint8_t localMask = 0, remoteMask = 0, remoteHumidityMask = 0;
bool converting = false, haveLocal = false, haveLeft = false;
uint32_t conversionStarted = 0, sampledAt = 0, lastScan = 0;
uint32_t leftReceivedAt = 0, leftSampleAge = 0, leftBootId = 0, leftSequence = 0;
uint32_t remoteHumidityAgeMs[2] = {UINT32_MAX, UINT32_MAX};
uint8_t pairedLeft[6] = {};
bool leftPaired = false, relayOn = false;
uint32_t sprayStart = 0, lastSprayEnd = 0, lastPrint = 0;
ControlConfig control;
QueueHandle_t receiveQueue, controlQueue, snapshotQueue, eventQueue;
WiFiClientSecure tls; // HTTP/TLS hanya dimiliki firebaseTask
HTTPClient http;

ControlConfig defaultControl() {
  ControlConfig cfg = {};
  strcpy(cfg.mode, "auto");
  strcpy(cfg.manual, "off");
  strcpy(cfg.autoSource, "threshold");
  cfg.threshold = 30.0f;
  cfg.hysteresis = 1.0f;
  cfg.maxDuration = 120;
  cfg.cooldown = 60;
  strcpy(cfg.legacyStart, "12:00");
  cfg.legacyDuration = 10;
  return cfg;
}

bool usableTemperature(float t) {
  return isfinite(t) && t >= -55.0f && t <= 125.0f;
}

bool usableHumidity(float h) {
  return isfinite(h) && h >= 0.0f && h <= 100.0f;
}

uint32_t addAge(uint32_t age, uint32_t elapsed) {
  return elapsed > UINT32_MAX - age ? UINT32_MAX : age + elapsed;
}

void beginHumidity() {
  for (int i = 0; i < 2; i++) {
    dhtSensors[i].begin();
    dht[i].humidity = dht[i].temperature = NAN;
    Serial.printf("DHT%d DATA GPIO%u\n", i + HUMIDITY_LABEL_BASE, DHT_PINS[i]);
  }
  lastHumidityRead = millis(); // tunggu power-up 3 detik sebelum baca pertama
}

void serviceHumidity() {
  if (uint32_t(millis() - lastHumidityRead) < HUMIDITY_SAMPLE_MS) return;
  lastHumidityRead = millis();
  for (int i = 0; i < 2; i++) {
    float rh = dhtSensors[i].readHumidity();
    float t = dhtSensors[i].readTemperature(); // library cache: frame yang sama
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

void receiveSample(const uint8_t *mac, const uint8_t *data, int length) {
  if (length != sizeof(WirePacket)) return;
  ReceivedPacket received;
  memcpy(received.mac, mac, 6);
  memcpy(&received.packet, data, sizeof(WirePacket));
  received.receivedAt = millis();
  if (received.packet.magic != PACKET_MAGIC || received.packet.version != PACKET_VERSION ||
      received.packet.type != PACKET_SAMPLE) return;
  xQueueOverwrite(receiveQueue, &received);
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onReceive(const esp_now_recv_info_t *info, const uint8_t *data, int length) {
  receiveSample(info->src_addr, data, length);
}
#else
void onReceive(const uint8_t *mac, const uint8_t *data, int length) {
  receiveSample(mac, data, length);
}
#endif

void serviceRadio() {
  ReceivedPacket received;
  if (xQueueReceive(receiveQueue, &received, 0) != pdTRUE) return;
  const WirePacket &packet = received.packet;
  if ((packet.validMask & ~7U) || (packet.humidityValidMask & ~3U) ||
      packet.sampleAgeMs > LOCAL_TIMEOUT_MS) return;
  for (int i = 0; i < 3; i++)
    if ((packet.validMask & (1U << i)) && !usableTemperature(packet.temperature[i])) return;
  for (int i = 0; i < 2; i++)
    if ((packet.humidityValidMask & (1U << i)) && (!usableHumidity(packet.humidity[i]) ||
        !isfinite(packet.dhtTemperature[i]) || packet.dhtTemperature[i] < -40 || packet.dhtTemperature[i] > 80)) return;
  bool configuredMac = false;
  for (int i = 0; i < 6; i++) if (LEFT_MAC[i]) configuredMac = true;
  if (configuredMac && memcmp(LEFT_MAC, received.mac, 6) != 0) return;
  if (leftPaired && memcmp(pairedLeft, received.mac, 6) != 0) return;
  if (!leftPaired) {
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, received.mac, 6);
    peer.channel = 0;
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = false; // allowlist MAC bukan autentikasi kriptografis
    if (esp_now_add_peer(&peer) != ESP_OK) return;
    memcpy(pairedLeft, received.mac, 6);
    leftPaired = true;
    Serial.printf("ESP kiri: %02X:%02X:%02X:%02X:%02X:%02X\n",
      pairedLeft[0], pairedLeft[1], pairedLeft[2], pairedLeft[3], pairedLeft[4], pairedLeft[5]);
  }
  bool newer = !haveLeft || packet.bootId != leftBootId || int32_t(packet.sequence - leftSequence) > 0;
  if (newer) {
    for (int i = 0; i < 3; i++)
      if (packet.validMask & (1U << i)) remoteT[i] = packet.temperature[i];
    remoteMask = packet.validMask;
    remoteHumidityMask = 0;
    for (int i = 0; i < 2; i++) {
      remoteHumidityAgeMs[i] = packet.humidityAgeMs[i];
      if ((packet.humidityValidMask & (1U << i)) && packet.humidityAgeMs[i] < HUMIDITY_LOCAL_TIMEOUT_MS) {
        remoteHumidity[i] = packet.humidity[i];
        remoteDhtTemperature[i] = packet.dhtTemperature[i];
        remoteHumidityMask |= uint8_t(1U << i);
      }
    }
    leftReceivedAt = received.receivedAt;
    leftSampleAge = packet.sampleAgeMs;
    leftBootId = packet.bootId;
    leftSequence = packet.sequence;
    haveLeft = true;
  }
  // Balas duplikat, tetapi jangan memperbarui timestamp/freshness-nya.
  WirePacket ack = {};
  ack.magic = PACKET_MAGIC;
  ack.version = PACKET_VERSION;
  ack.type = PACKET_ACK;
  ack.bootId = packet.bootId;
  ack.sequence = packet.sequence;
  esp_now_send(pairedLeft, reinterpret_cast<const uint8_t *>(&ack), sizeof(ack));
}

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
    Serial.printf("S%d GPIO%u: %s\n", i + 1, SENSOR_PINS[i],
      sensors[i].getDeviceCount() ? "terdeteksi" : "tidak terdeteksi");
  }
  lastScan = millis();
}

void serviceSensors() {
  uint32_t now = millis();
  if (converting && uint32_t(now - conversionStarted) >= CONVERSION_MS) {
    localMask = 0;
    for (int i = 0; i < 3; i++) {
      float t = sensors[i].getTempCByIndex(0);
      if (usableTemperature(t)) {
        localT[i] = t;
        localMask |= uint8_t(1U << i);
      }
    }
    sampledAt = millis();
    haveLocal = true;
    converting = false;
  }
  now = millis();
  if (!converting && uint32_t(now - lastScan) >= 60000) scanSensors();
  if (!converting && (!haveLocal || uint32_t(now - sampledAt) >= SAMPLE_MS - CONVERSION_MS))
    beginConversion();
}

void buildSnapshot(Snapshot &out) {
  out = {};
  uint32_t now = millis(), elapsed = now - leftReceivedAt;
  out.leftAgeMs = haveLeft ? addAge(leftSampleAge, elapsed) : UINT32_MAX;
  out.leftOnline = haveLeft && out.leftAgeMs < LEFT_TIMEOUT_MS;
  uint8_t rightFresh = haveLocal && uint32_t(now - sampledAt) < LOCAL_TIMEOUT_MS ? localMask : 0;
  out.validMask = rightFresh | (out.leftOnline ? uint8_t(remoteMask << 3) : 0);
  float sum = 0;
  for (int i = 0; i < 6; i++) {
    out.temperature[i] = i < 3 ? localT[i] : remoteT[i - 3];
    out.temperatureAgeMs[i] = i < 3 ? (haveLocal ? now - sampledAt : UINT32_MAX) : out.leftAgeMs;
    if (out.validMask & (1U << i)) { sum += out.temperature[i]; out.validCount++; }
  }
  out.avg = out.validCount ? sum / out.validCount : NAN;
  out.complete = out.validMask == 63; // hanya 6 DS; tidak tergantung RH
  sum = 0;
  for (int i = 0; i < 4; i++) {
    bool valid;
    if (i < 2) {
      out.humidityAgeMs[i] = dht[i].haveSample ? now - dht[i].sampledAt : UINT32_MAX;
      valid = dht[i].valid && out.humidityAgeMs[i] < HUMIDITY_LOCAL_TIMEOUT_MS;
      out.humidity[i] = valid ? dht[i].humidity : NAN;
      out.dhtTemperature[i] = valid ? dht[i].temperature : NAN;
    } else {
      int remote = i - 2;
      out.humidityAgeMs[i] = haveLeft ? addAge(remoteHumidityAgeMs[remote], elapsed) : UINT32_MAX;
      valid = out.leftOnline && (remoteHumidityMask & (1U << remote)) &&
              out.humidityAgeMs[i] < LEFT_TIMEOUT_MS;
      out.humidity[i] = valid ? remoteHumidity[remote] : NAN;
      out.dhtTemperature[i] = valid ? remoteDhtTemperature[remote] : NAN;
    }
    if (valid) {
      out.humidityValidMask |= uint8_t(1U << i);
      out.humidityValidCount++;
      sum += out.humidity[i];
    }
  }
  out.humidityAvg = out.humidityValidCount ? sum / out.humidityValidCount : NAN;
  out.relayOn = relayOn;
  out.capturedAt = now;
  strcpy(out.mode, control.mode);
  strcpy(out.autoSource, control.autoSource);
}

void setRelay(bool on, const char *type, const char *reason, float avg) {
  if (on == relayOn) return;
  relayOn = on;
  digitalWrite(SSR_PIN, (on == SSR_ACTIVE_HIGH) ? HIGH : LOW);
  if (on) sprayStart = millis();
  else lastSprayEnd = millis();
  RelayEvent event = {};
  strlcpy(event.type, type, sizeof(event.type));
  strlcpy(event.reason, reason, sizeof(event.reason));
  event.avg = avg;
  event.capturedAt = millis();
  if (xQueueSend(eventQueue, &event, 0) != pdTRUE)
    Serial.println("Queue event penuh saat Firebase offline; event ini tidak tersimpan.");
  Serial.printf("Relay %s (%s): %s\n", on ? "ON" : "OFF", type, reason);
}

bool parseClock(const char *text, int &minutes) {
  int h, m;
  char trailing;
  if (sscanf(text, "%d:%d%c", &h, &m, &trailing) != 2 || h < 0 || h > 23 || m < 0 || m > 59)
    return false;
  minutes = h * 60 + m;
  return true;
}

bool inWindow(int current, int start, int duration) {
  return duration > 0 && (current - start + 1440) % 1440 < duration;
}

bool schedActiveNow() {
  time_t now = time(nullptr);
  if (now < 1700000000) return false;
  struct tm local;
  localtime_r(&now, &local);
  int current = local.tm_hour * 60 + local.tm_min;
  if (control.slotCount > 0) {
    for (int i = 0; i < control.slotCount; i++) {
      int year, month, day, start;
      char trailing;
      if (sscanf(control.slots[i].date, "%d-%d-%d%c", &year, &month, &day, &trailing) != 3) continue;
      if (year != local.tm_year + 1900 || month != local.tm_mon + 1 || day != local.tm_mday) continue;
      if (parseClock(control.slots[i].start, start) && inWindow(current, start, control.slots[i].duration))
        return true;
    }
    return false;
  }
  int start;
  return control.legacySchedule && parseClock(control.legacyStart, start) &&
    inWindow(current, start, control.legacyDuration);
}

void applyLogic(float avg, bool complete, bool scheduleOn) {
  uint32_t now = millis();
  if (strcmp(control.mode, "manual") == 0) {
    bool on = strcmp(control.manual, "on") == 0;
    setRelay(on, on ? "manual_on" : "manual_off", "perintah web", avg);
    return;
  }
  if (strcmp(control.autoSource, "schedule") == 0) {
    setRelay(scheduleOn, scheduleOn ? "jadwal_on" : "jadwal_off",
      scheduleOn ? "slot jadwal aktif" : "jadwal selesai / waktu belum valid", avg);
    return;
  }
  if (!complete || !isfinite(avg)) {
    setRelay(false, "sensor_off", "data 6 sensor belum lengkap / kedaluwarsa", avg);
    return;
  }
  if (relayOn && uint32_t(now - sprayStart) / 1000UL >= uint32_t(control.maxDuration)) {
    setRelay(false, "protect_off", "durasi maks", avg);
    return;
  }
  if (!relayOn && avg >= control.threshold &&
      uint32_t(now - lastSprayEnd) / 1000UL >= uint32_t(control.cooldown))
    setRelay(true, "auto_on", "avg >= threshold", avg);
  else if (relayOn && avg <= control.threshold - control.hysteresis)
    setRelay(false, "auto_off", "hysteresis", avg);
}

String devPath(const char *leaf) {
  return String(DATABASE_URL) + "/devices/" + DEVICE_ID + "/" + leaf + ".json?auth=" + DATABASE_SECRET;
}

bool fbWrite(const char *path, const String &payload, bool post = false) {
  if (WiFi.status() != WL_CONNECTED) return false;
  http.setConnectTimeout(2000);
  if (!http.begin(tls, devPath(path))) return false;
  http.setTimeout(4000);
  http.addHeader("Content-Type", "application/json");
  int code = post ? http.POST(payload) : http.PUT(payload);
  http.end();
  if (code < 200 || code >= 300) {
    Serial.printf("Firebase %s gagal: %d\n", path, code);
    return false;
  }
  return true;
}

String fbGet(const char *path) {
  if (WiFi.status() != WL_CONNECTED) return "";
  http.setConnectTimeout(2000);
  if (!http.begin(tls, devPath(path))) return "";
  http.setTimeout(4000);
  int code = http.GET();
  String body = code == 200 ? http.getString() : "";
  http.end();
  if (code != 200) Serial.printf("Firebase GET %s gagal: %d\n", path, code);
  return body;
}

int64_t measuredTimestamp(uint32_t capturedAt) {
  time_t now = time(nullptr);
  return now < 1700000000 ? 0 : int64_t(now) * 1000 - uint32_t(millis() - capturedAt);
}

void fillHumidity(JsonDocument &doc, const Snapshot &state) {
  JsonArray ages = doc["humidityAgeMs"].to<JsonArray>();
  for (int i = 0; i < 4; i++) {
    char key[4];
    snprintf(key, sizeof(key), "h%d", i + 1);
    // Invalid/stale -> null, bukan 0 atau nilai lama yang disamarkan fresh.
    // Firebase menghapus child bernilai null: lihat humidityValidMask.
    if (state.humidityValidMask & (1U << i)) doc[key] = state.humidity[i];
    else doc[key] = nullptr;
    snprintf(key, sizeof(key), "d%d", i + 1);
    if (state.humidityValidMask & (1U << i)) doc[key] = state.dhtTemperature[i];
    else doc[key] = nullptr;
    if (state.humidityAgeMs[i] == UINT32_MAX) ages.add(nullptr);
    else ages.add(state.humidityAgeMs[i]);
  }
  if (state.humidityValidCount) doc["humidityAvg"] = state.humidityAvg;
  else doc["humidityAvg"] = nullptr;
  doc["humidityValidMask"] = state.humidityValidMask; // bit 0..3 = H1..H4
  doc["humidityValidCount"] = state.humidityValidCount;
  doc["humidityComplete"] = state.humidityValidMask == 15;
}

void fillTelemetry(JsonDocument &doc, const Snapshot &state) {
  doc["schemaVersion"] = 3;
  JsonArray ages = doc["temperatureAgeMs"].to<JsonArray>();
  for (int i = 0; i < 6; i++) {
    char key[4];
    snprintf(key, sizeof(key), "t%d", i + 1);
    doc[key] = state.temperature[i]; // angka terakhir / -127; validMask menentukan freshness
    if (state.temperatureAgeMs[i] == UINT32_MAX) ages.add(nullptr);
    else ages.add(state.temperatureAgeMs[i]);
  }
  if (state.validCount) doc["avg"] = state.avg;
  else doc["avg"] = nullptr; // rules FINAL mendukung nol sensor valid tanpa avg palsu
  doc["ssr"] = state.relayOn ? 1 : 0;
  doc["sch"] = state.scheduleOn ? 1 : 0;
  doc["n"] = 6;
  doc["validCount"] = state.validCount;
  doc["validMask"] = state.validMask;
  doc["complete"] = state.complete;
  doc["leftOnline"] = state.leftOnline;
  if (state.leftAgeMs == UINT32_MAX) doc["leftAgeMs"] = nullptr;
  else doc["leftAgeMs"] = state.leftAgeMs;
  doc["mode"] = state.mode;
  doc["autoSrc"] = state.autoSource; // task Firebase tidak membaca control lintas-core
  doc["measuredTs"] = measuredTimestamp(state.capturedAt); // waktu snapshot; usia RH terpisah
  doc["ts"][".sv"] = "timestamp";
  fillHumidity(doc, state);
}

void sendTelemetry(const Snapshot &state) {
  JsonDocument doc;
  fillTelemetry(doc, state);
  doc["rssi"] = WiFi.RSSI();
  doc["heap"] = ESP.getFreeHeap();
  String body;
  serializeJson(doc, body);
  fbWrite("telemetry/latest", body);
}

void sendLog(const Snapshot &state) {
  JsonDocument doc;
  fillTelemetry(doc, state);
  String body;
  serializeJson(doc, body);
  fbWrite("telemetry/log", body, true);
}

void sendStatus(const Snapshot &state) {
  JsonDocument doc;
  doc["online"] = true; // bukan bukti selalu online; periksa usia lastSeen
  doc["lastSeen"][".sv"] = "timestamp";
  doc["ip"] = WiFi.localIP().toString();
  doc["fw"] = FW_VERSION;
  doc["leftOnline"] = state.leftOnline;
  doc["validCount"] = state.validCount;
  doc["validMask"] = state.validMask;
  doc["complete"] = state.complete;
  doc["ssr"] = state.relayOn ? 1 : 0;
  doc["channel"] = WiFi.channel();
  doc["measuredTs"] = measuredTimestamp(state.capturedAt);
  fillHumidity(doc, state);
  String body;
  serializeJson(doc, body);
  fbWrite("status", body);
}

bool sendEvent(const RelayEvent &event) {
  JsonDocument doc;
  doc["type"] = event.type;
  doc["reason"] = event.reason;
  if (isfinite(event.avg)) doc["avg"] = event.avg;
  doc["measuredTs"] = measuredTimestamp(event.capturedAt);
  doc["ts"][".sv"] = "timestamp";
  String body;
  serializeJson(doc, body);
  return fbWrite("events", body, true);
}

bool parseControl(const String &body, ControlConfig &out) {
  JsonDocument doc;
  if (deserializeJson(doc, body) || !doc.is<JsonObject>()) return false;
  const char *mode = doc["mode"] | "auto";
  const char *manual = doc["manualSsr"] | "off";
  bool legacy = doc["schOn"].is<bool>() ? doc["schOn"].as<bool>() : doc["schOn"].as<int>() != 0;
  const char *source = doc["autoSrc"] | (legacy ? "schedule" : "threshold");
  if ((strcmp(mode, "auto") && strcmp(mode, "manual")) ||
      (strcmp(manual, "on") && strcmp(manual, "off")) ||
      (strcmp(source, "threshold") && strcmp(source, "schedule"))) return false;
  out = defaultControl();
  strlcpy(out.mode, mode, sizeof(out.mode));
  strlcpy(out.manual, manual, sizeof(out.manual));
  strlcpy(out.autoSource, source, sizeof(out.autoSource));
  out.threshold = doc["threshold"] | 30.0f;
  out.hysteresis = doc["hysteresis"] | 1.0f;
  out.maxDuration = doc["maxDuration"] | 120;
  out.cooldown = doc["cooldown"] | 60;
  out.slotCount = doc["schN"] | 0;
  out.legacySchedule = legacy;
  out.legacyDuration = doc["schDur"] | 10;
  strlcpy(out.legacyStart, doc["schStart"] | "12:00", sizeof(out.legacyStart));
  if (!usableTemperature(out.threshold) || !isfinite(out.hysteresis) || out.hysteresis < 0 ||
      out.hysteresis > 50 || out.maxDuration < 1 || out.maxDuration > 10800 ||
      out.cooldown < 0 || out.cooldown > 10800 || out.slotCount < 0 || out.slotCount > MAX_SLOTS ||
      out.legacyDuration < 1 || out.legacyDuration > 180) return false;
  for (int i = 0; i < out.slotCount; i++) {
    char key[16];
    snprintf(key, sizeof(key), "sch%dDate", i + 1);
    strlcpy(out.slots[i].date, doc[key] | "", sizeof(out.slots[i].date));
    snprintf(key, sizeof(key), "sch%dStart", i + 1);
    strlcpy(out.slots[i].start, doc[key] | "", sizeof(out.slots[i].start));
    snprintf(key, sizeof(key), "sch%dDur", i + 1);
    out.slots[i].duration = doc[key] | 10;
    if (out.slots[i].duration < 1 || out.slots[i].duration > 180) return false;
  }
  return true;
}

void createDefaultControl() {
  JsonDocument doc;
  doc["mode"] = "auto";
  doc["autoSrc"] = "threshold";
  doc["manualSsr"] = "off";
  doc["threshold"] = 30.0;
  doc["hysteresis"] = 1.0;
  doc["maxDuration"] = 120;
  doc["cooldown"] = 60;
  doc["schN"] = 0;
  doc["schOn"] = 0;
  doc["updatedBy"] = "espkanan_FINAL";
  String body;
  serializeJson(doc, body);
  fbWrite("control", body);
}

void firebaseTask(void *) {
  tls.setInsecure(); // baseline lama; produksi perlu CA untuk verifikasi server
  tls.setHandshakeTimeout(5);
  WiFi.setAutoReconnect(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t lastWifi = millis(), lastControl = 0, lastTelemetry = 0, lastLog = 0;
  bool wasConnected = false, connecting = true, pendingEvent = false;
  RelayEvent event;
  for (;;) {
    uint32_t now = millis();
    bool connected = WiFi.status() == WL_CONNECTED;
    if (!connected) {
      if (wasConnected) {
        Serial.println("Wi-Fi putus; kontrol lokal tetap jalan.");
        WiFi.disconnect(false, false);
        esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
        connecting = false;
        lastWifi = now;
      }
      wasConnected = false;
      if (connecting && uint32_t(now - lastWifi) >= WIFI_CONNECT_WINDOW_MS) {
        WiFi.disconnect(false, false);
        esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
        connecting = false;
      }
      if (!connecting && uint32_t(now - lastWifi) >= WIFI_RETRY_MS) {
        lastWifi = now;
        Serial.println("Mencoba Wi-Fi lagi, tanpa restart ESP.");
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD, ESPNOW_CHANNEL);
        connecting = true;
      }
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }
    if (!wasConnected) {
      connecting = false;
      Serial.printf("Wi-Fi %s | kanal %d\n", WiFi.localIP().toString().c_str(), WiFi.channel());
      if (WiFi.channel() != ESPNOW_CHANNEL)
        Serial.printf("PERINGATAN: router kanal %d, kiri %u. Samakan kanal!\n", WiFi.channel(), ESPNOW_CHANNEL);
      configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
      lastControl = now - CONTROL_MS;
      lastTelemetry = now - TELEMETRY_MS;
      lastLog = now - LOG_MS;
      wasConnected = true;
    }
    if (uint32_t(now - lastControl) >= CONTROL_MS) {
      lastControl = now;
      String body = fbGet("control");
      if (body == "null") createDefaultControl();
      else if (body.length()) {
        ControlConfig cfg;
        if (parseControl(body, cfg)) xQueueOverwrite(controlQueue, &cfg);
        else Serial.println("Control tidak valid; mempertahankan pengaturan sebelumnya.");
      }
    }
    Snapshot state;
    if (uint32_t(millis() - lastTelemetry) >= TELEMETRY_MS && xQueuePeek(snapshotQueue, &state, 0) == pdTRUE) {
      lastTelemetry = millis();
      sendTelemetry(state);
    }
    if (uint32_t(millis() - lastLog) >= LOG_MS && xQueuePeek(snapshotQueue, &state, 0) == pdTRUE) {
      lastLog = millis();
      sendLog(state);
      if (xQueuePeek(snapshotQueue, &state, 0) == pdTRUE) sendStatus(state);
    }
    if (!pendingEvent) pendingEvent = xQueueReceive(eventQueue, &event, 0) == pdTRUE;
    if (pendingEvent && sendEvent(event)) pendingEvent = false;
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

void stopWithError(const char *message) {
  digitalWrite(SSR_PIN, SSR_ACTIVE_HIGH ? LOW : HIGH);
  Serial.println(message);
  while (true) delay(1000);
}

void setup() {
  Serial.begin(115200);
  digitalWrite(SSR_PIN, SSR_ACTIVE_HIGH ? LOW : HIGH);
  pinMode(SSR_PIN, OUTPUT);
  control = defaultControl();
  lastSprayEnd = millis() - uint32_t(control.cooldown) * 1000UL;
  receiveQueue = xQueueCreate(1, sizeof(ReceivedPacket));
  controlQueue = xQueueCreate(1, sizeof(ControlConfig));
  snapshotQueue = xQueueCreate(1, sizeof(Snapshot));
  eventQueue = xQueueCreate(16, sizeof(RelayEvent));
  if (!receiveQueue || !controlQueue || !snapshotQueue || !eventQueue) stopWithError("Queue gagal; relay OFF.");
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  Serial.printf("MAC STA ESP KANAN: %s\n", WiFi.macAddress().c_str());
  Serial.println("Salin MAC ini ke RIGHT_MAC di espkiri_FINAL.");
  if (ESPNOW_CHANNEL < 1 || ESPNOW_CHANNEL > 13 ||
      esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE) != ESP_OK ||
      esp_now_init() != ESP_OK) stopWithError("Gagal memulai ESP-NOW.");
  esp_now_register_recv_cb(onReceive);
  beginHumidity();
  scanSensors();
  beginConversion();
  if (xTaskCreatePinnedToCore(firebaseTask, "firebase", 12288, nullptr, 1, nullptr, 0) != pdPASS)
    stopWithError("Gagal memulai task Firebase.");
}

void loop() {
  serviceRadio();
  serviceSensors();
  serviceHumidity();
  ControlConfig updated;
  if (xQueueReceive(controlQueue, &updated, 0) == pdTRUE) control = updated;
  Snapshot state;
  buildSnapshot(state);
  state.scheduleOn = strcmp(control.mode, "auto") == 0 &&
    strcmp(control.autoSource, "schedule") == 0 && schedActiveNow();
  applyLogic(state.avg, state.complete, state.scheduleOn);
  state.relayOn = relayOn;
  xQueueOverwrite(snapshotQueue, &state);
  if (uint32_t(millis() - lastPrint) >= TELEMETRY_MS) {
    lastPrint = millis();
    Serial.printf("S1=%.2f S2=%.2f S3=%.2f | S4=%.2f S5=%.2f S6=%.2f | DS=%u/6 avg=%.2f "
      "kiri=%s relay=%d\n", state.temperature[0], state.temperature[1], state.temperature[2],
      state.temperature[3], state.temperature[4], state.temperature[5], state.validCount,
      state.avg, state.leftOnline ? "online" : "offline", relayOn);
    Serial.printf("H1=%.2f H2=%.2f H3=%.2f H4=%.2f %%RH | valid=%u/4 mask=%u avgRH=%.2f\n",
      state.humidity[0], state.humidity[1], state.humidity[2], state.humidity[3],
      state.humidityValidCount, state.humidityValidMask, state.humidityAvg);
  }
  delay(5);
}
