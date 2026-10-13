// SmartCow ESP KANAN: 3 DS18B20 lokal + 3 dari kiri -> SSR + Firebase.
// Board: ESP32 Dev Module / WROOM-32. Library: OneWire, DallasTemperature,
// ArduinoJson (Benoit Blanchon, versi 7). Tidak perlu library Firebase.
// Salin sketch ini SENDIRI ke folder espkanan/espkanan.ino untuk Arduino IDE.
// Tiap DATA pull-up fisik 4.7k ke 3V3. SSR IN GPIO23 + GND.
// Cabut daya saat pindah jack. Pengerjaan AC 220V oleh orang kompeten.

#include <Arduino.h>
#include <WiFi.h>
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

// ---------------- ISI KONFIGURASI SEBELUM UPLOAD ----------------
// Jangan commit password/secret asli. Gunakan salinan sketch lokal.
#define WIFI_SSID "GANTI_WIFI_SSID"
#define WIFI_PASSWORD "GANTI_WIFI_PASSWORD"
#define DATABASE_URL "https://smartcow-de25f-default-rtdb.asia-southeast1.firebasedatabase.app"
#define DATABASE_SECRET "GANTI_DATABASE_SECRET"
#define DEVICE_ID "cow-sprinkler-01"
// HARUS sama dengan kiri dan kanal tetap router 2.4 GHz.
constexpr uint8_t ESPNOW_CHANNEL = 6;
// Opsional: isi MAC STA kiri untuk membatasi pengirim. Nol = belajar pengirim
// pertama yang paketnya valid, lalu kunci MAC itu sampai kanan reboot.
const uint8_t LEFT_MAC[6] = {0, 0, 0, 0, 0, 0};
const uint8_t SENSOR_PINS[3] = {4, 14, 18}; // S1, S2, S3 di web
constexpr uint8_t SSR_PIN = 23;
constexpr bool SSR_ACTIVE_HIGH = true;
constexpr uint32_t LEFT_TIMEOUT_MS = 10000;
constexpr uint32_t LOCAL_TIMEOUT_MS = 3000;
constexpr uint32_t CONVERSION_MS = 800;
constexpr uint32_t SAMPLE_MS = 1000;
constexpr uint32_t TELEMETRY_MS = 2000;
constexpr uint32_t CONTROL_MS = 5000;
constexpr uint32_t LOG_MS = 30000;
constexpr uint32_t WIFI_RETRY_MS = 30000;
constexpr uint32_t WIFI_CONNECT_WINDOW_MS = 10000;
constexpr uint8_t MAX_SLOTS = 6;
const char FW_VERSION[] = "2.0.0-dual-esp-kanan";
// ----------------------------------------------------------------

// Format HARUS identik dengan espkiri.
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
  char mode[8];
};
struct RelayEvent {
  char type[24], reason[80];
  float avg;
  uint32_t capturedAt;
};

// Prototipe eksplisit untuk tipe custom (preprocessor Arduino IDE).
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
void fillTelemetry(JsonDocument &doc, const Snapshot &state);

OneWire buses[3] = {SENSOR_PINS[0], SENSOR_PINS[1], SENSOR_PINS[2]};
DallasTemperature sensors[3] = {&buses[0], &buses[1], &buses[2]};
float localT[3] = {-127, -127, -127}, remoteT[3] = {-127, -127, -127};
uint8_t localMask = 0, remoteMask = 0;
bool converting = false, haveLocal = false, haveLeft = false;
uint32_t conversionStarted = 0, sampledAt = 0, lastScan = 0;
uint32_t leftReceivedAt = 0, leftSampleAge = 0, leftBootId = 0, leftSequence = 0;
uint8_t pairedLeft[6] = {};
bool leftPaired = false;
bool relayOn = false;
uint32_t sprayStart = 0, lastSprayEnd = 0, lastPrint = 0;
ControlConfig control;
QueueHandle_t receiveQueue, controlQueue, snapshotQueue, eventQueue;
// HTTP/TLS hanya dimiliki firebaseTask, bukan loop kontrol/ESP-NOW.
WiFiClientSecure tls;
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

void receiveSample(const uint8_t *mac, const uint8_t *data, int length) {
  if (length != sizeof(WirePacket)) return;
  ReceivedPacket received;
  memcpy(received.mac, mac, 6);
  memcpy(&received.packet, data, sizeof(WirePacket));
  received.receivedAt = millis();
  if (received.packet.magic != PACKET_MAGIC ||
      received.packet.version != PACKET_VERSION || received.packet.type != PACKET_SAMPLE) return;
  // Callback Wi-Fi hanya menyalin ke queue. Tidak menjalankan kontrol/HTTP.
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
  if ((packet.validMask & ~7U) || packet.sampleAgeMs > LOCAL_TIMEOUT_MS) return;
  for (int i = 0; i < 3; i++)
    if ((packet.validMask & (1U << i)) && !usableTemperature(packet.temperature[i])) return;
  bool configuredMac = false;
  for (int i = 0; i < 6; i++) if (LEFT_MAC[i]) configuredMac = true;
  if (configuredMac && memcmp(LEFT_MAC, received.mac, 6) != 0) return;
  if (leftPaired && memcmp(pairedLeft, received.mac, 6) != 0) return;
  if (!leftPaired) {
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, received.mac, 6);
    peer.channel = 0; // kanal radio saat ini, mengikuti router ketika terhubung
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = false;
    if (esp_now_add_peer(&peer) != ESP_OK) return;
    memcpy(pairedLeft, received.mac, 6);
    leftPaired = true;
    Serial.printf("ESP kiri dipasangkan: %02X:%02X:%02X:%02X:%02X:%02X\n",
      pairedLeft[0], pairedLeft[1], pairedLeft[2], pairedLeft[3], pairedLeft[4], pairedLeft[5]);
  }
  // Paket duplikat tetap dibalas, tetapi TIDAK memperbarui umur data.
  bool newer = !haveLeft || packet.bootId != leftBootId ||
               int32_t(packet.sequence - leftSequence) > 0;
  if (newer) {
    for (int i = 0; i < 3; i++)
      if (packet.validMask & (1U << i)) remoteT[i] = packet.temperature[i];
    remoteMask = packet.validMask;
    leftReceivedAt = received.receivedAt;
    leftSampleAge = packet.sampleAgeMs;
    leftBootId = packet.bootId;
    leftSequence = packet.sequence;
    haveLeft = true;
  }
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
  now = millis(); // pembacaan bus memakan waktu; hindari unsigned underflow
  if (!converting && uint32_t(now - lastScan) >= 60000) scanSensors();
  if (!converting && (!haveLocal || uint32_t(now - sampledAt) >= SAMPLE_MS - CONVERSION_MS))
    beginConversion();
}

void buildSnapshot(Snapshot &out) {
  out = {};
  uint32_t now = millis();
  uint32_t elapsed = now - leftReceivedAt;
  out.leftAgeMs = haveLeft ? (elapsed > UINT32_MAX - leftSampleAge ? UINT32_MAX : elapsed + leftSampleAge)
                          : UINT32_MAX;
  out.leftOnline = haveLeft && out.leftAgeMs < LEFT_TIMEOUT_MS;
  uint8_t rightFresh = haveLocal && uint32_t(now - sampledAt) < LOCAL_TIMEOUT_MS ? localMask : 0;
  out.validMask = rightFresh | (out.leftOnline ? uint8_t(remoteMask << 3) : 0);
  float sum = 0;
  for (int i = 0; i < 6; i++) {
    out.temperature[i] = i < 3 ? localT[i] : remoteT[i - 3];
    if (out.validMask & (1U << i)) {
      sum += out.temperature[i];
      out.validCount++;
    }
  }
  out.avg = out.validCount ? sum / out.validCount : NAN;
  out.complete = out.validMask == 63;
  out.relayOn = relayOn;
  out.capturedAt = now;
  strcpy(out.mode, control.mode);
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
  if (duration <= 0) return false;
  return (current - start + 1440) % 1440 < duration;
}

bool schedActiveNow() {
  time_t now = time(nullptr);
  if (now < 1700000000) return false; // belum sinkron NTP: jangan menjalankan jadwal
  struct tm local;
  localtime_r(&now, &local);
  int current = local.tm_hour * 60 + local.tm_min;
  if (control.slotCount > 0) {
    for (int i = 0; i < control.slotCount; i++) {
      int year, month, day, start;
      char trailing;
      if (sscanf(control.slots[i].date, "%d-%d-%d%c", &year, &month, &day, &trailing) != 3) continue;
      if (year != local.tm_year + 1900 || month != local.tm_mon + 1 || day != local.tm_mday) continue;
      if (parseClock(control.slots[i].start, start) &&
          inWindow(current, start, control.slots[i].duration)) return true;
    }
    return false;
  }
  int start;
  return control.legacySchedule && parseClock(control.legacyStart, start) &&
         inWindow(current, start, control.legacyDuration);
}

void applyLogic(float avg, bool complete, bool scheduleOn) {
  uint32_t now = millis();
  // Manual/jadwal mempertahankan perilaku firmware lama, tidak memakai suhu.
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
  // Default konservatif: threshold hanya aktif jika keenam sensor fresh.
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

// Waktu sampel/kejadian, bukan waktu upload setelah request tertunda.
int64_t measuredTimestamp(uint32_t capturedAt) {
  time_t now = time(nullptr);
  return now < 1700000000 ? 0 : int64_t(now) * 1000 - uint32_t(millis() - capturedAt);
}

void fillTelemetry(JsonDocument &doc, const Snapshot &state) {
  for (int i = 0; i < 6; i++) {
    char key[4];
    snprintf(key, sizeof(key), "t%d", i + 1);
    // Kompatibilitas rules lama: angka terakhir; validMask adalah sumber freshness.
    // -127 = belum pernah ada nilai valid, BUKAN suhu untuk perhitungan.
    doc[key] = state.temperature[i];
  }
  doc["avg"] = state.avg; // hanya rata-rata sensor valid/fresh, tidak memakai fallback
  doc["ssr"] = state.relayOn ? 1 : 0;
  doc["sch"] = state.scheduleOn ? 1 : 0;
  doc["n"] = 6; // enam posisi tetap, bukan jumlah sensor valid
  doc["validCount"] = state.validCount;
  doc["validMask"] = state.validMask; // bit 0..5 = S1..S6
  doc["complete"] = state.complete;
  doc["leftOnline"] = state.leftOnline;
  if (state.leftAgeMs == UINT32_MAX) doc["leftAgeMs"] = nullptr;
  else doc["leftAgeMs"] = state.leftAgeMs;
  doc["mode"] = state.mode;
  doc["measuredTs"] = measuredTimestamp(state.capturedAt);
  doc["ts"][".sv"] = "timestamp";
}

void sendTelemetry(const Snapshot &state) {
  // Rules existing mewajibkan avg numerik. Jangan mengarang avg jika 0 valid.
  if (!state.validCount) return;
  JsonDocument doc;
  fillTelemetry(doc, state);
  doc["rssi"] = WiFi.RSSI();
  doc["heap"] = ESP.getFreeHeap();
  String body;
  serializeJson(doc, body);
  fbWrite("telemetry/latest", body);
}

void sendLog(const Snapshot &state) {
  if (!state.validCount) return;
  JsonDocument doc;
  fillTelemetry(doc, state);
  String body;
  serializeJson(doc, body);
  fbWrite("telemetry/log", body, true);
}

void sendStatus(const Snapshot &state) {
  JsonDocument doc;
  doc["online"] = true; // kanan berhasil upload; web harus tetap memeriksa lastSeen
  doc["lastSeen"][".sv"] = "timestamp";
  doc["ip"] = WiFi.localIP().toString();
  doc["fw"] = FW_VERSION;
  doc["leftOnline"] = state.leftOnline;
  doc["validCount"] = state.validCount;
  doc["validMask"] = state.validMask;
  doc["complete"] = state.complete;
  doc["ssr"] = state.relayOn ? 1 : 0;
  doc["channel"] = WiFi.channel();
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
  // Kompatibel dengan control web lama; hanya dipanggil jika control belum ada.
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
  doc["updatedBy"] = "espkanan";
  String body;
  serializeJson(doc, body);
  fbWrite("control", body);
}

void firebaseTask(void *) {
  // Menjaga HTTP/TLS yang blocking tidak menahan pembacaan dan proteksi relay.
  tls.setInsecure(); // sama seperti firmware lama; untuk produksi pakai CA valid
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
        WiFi.disconnect(false, false); // radio tetap aktif untuk ESP-NOW
        esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
        connecting = false;
        lastWifi = now;
      }
      wasConnected = false;
      // Jangan terus scan Wi-Fi: kembalikan radio ke kanal ESP-NOW saat idle.
      if (connecting && uint32_t(now - lastWifi) >= WIFI_CONNECT_WINDOW_MS) {
        WiFi.disconnect(false, false);
        esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
        connecting = false;
      }
      if (!connecting && uint32_t(now - lastWifi) >= WIFI_RETRY_MS) {
        lastWifi = now;
        Serial.println("Mencoba Wi-Fi lagi (tanpa restart ESP).");
        // Kanal sudah diketahui; hindari scan seluruh kanal saat reconnect.
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD, ESPNOW_CHANNEL);
        connecting = true;
      }
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }
    if (!wasConnected) {
      connecting = false;
      Serial.printf("Wi-Fi terhubung: %s | kanal %d\n", WiFi.localIP().toString().c_str(), WiFi.channel());
      if (WiFi.channel() != ESPNOW_CHANNEL)
        Serial.printf("PERINGATAN: router kanal %d, kiri disetel %u. Samakan kanal!\n",
                      WiFi.channel(), ESPNOW_CHANNEL);
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
        else Serial.println("Control Firebase tidak valid; mempertahankan pengaturan sebelumnya.");
      }
    }
    Snapshot state;
    if (uint32_t(millis() - lastTelemetry) >= TELEMETRY_MS &&
        xQueuePeek(snapshotQueue, &state, 0) == pdTRUE) {
      lastTelemetry = millis();
      sendTelemetry(state);
    }
    if (uint32_t(millis() - lastLog) >= LOG_MS && xQueuePeek(snapshotQueue, &state, 0) == pdTRUE) {
      lastLog = millis();
      sendLog(state);
      // Ambil ulang karena request log mungkin lama.
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
  if (!receiveQueue || !controlQueue || !snapshotQueue || !eventQueue)
    stopWithError("Gagal membuat queue; relay tetap OFF.");
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  Serial.printf("MAC STA ESP KANAN: %s\n", WiFi.macAddress().c_str());
  Serial.println("Salin MAC ini ke RIGHT_MAC pada sketch espkiri.");
  if (ESPNOW_CHANNEL < 1 || ESPNOW_CHANNEL > 13 ||
      esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE) != ESP_OK ||
      esp_now_init() != ESP_OK) stopWithError("Gagal memulai radio ESP-NOW.");
  esp_now_register_recv_cb(onReceive);
  scanSensors();
  beginConversion();
  // ESP32 klasik dual-core: HTTP di core 0, loop kontrol Arduino di core 1.
  if (xTaskCreatePinnedToCore(firebaseTask, "firebase", 12288, nullptr, 1, nullptr, 0) != pdPASS)
    stopWithError("Gagal memulai task Firebase.");
}

void loop() {
  serviceRadio();
  serviceSensors();
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
    Serial.printf("S1=%.2f S2=%.2f S3=%.2f | S4=%.2f S5=%.2f S6=%.2f | "
                  "valid=%u/6 mask=%u avg=%.2f kiri=%s relay=%d\n",
      state.temperature[0], state.temperature[1], state.temperature[2],
      state.temperature[3], state.temperature[4], state.temperature[5],
      state.validCount, state.validMask, state.avg, state.leftOnline ? "online" : "offline", relayOn);
  }
  delay(5);
}
