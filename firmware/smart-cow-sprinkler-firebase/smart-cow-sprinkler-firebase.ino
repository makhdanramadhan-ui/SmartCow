// Smart Cow Sprinkler — Firmware ESP32 + Firebase RTDB (REST)
// 6x DS18B20 SATU bus OneWire di GPIO4 + SSR di GPIO23 ke Solenoid Valve.
//
// CARA COMPILE DI ARDUINO IDE:
// 1. Install board "esp32" (Espressif) via Boards Manager, pilih "ESP32 Dev Module".
// 2. Install via Library Manager: "OneWire" (Paul Stoffregen) + "DallasTemperature"
//    (Miles Burton). Tidak perlu library Firebase.
// 3. Isi 4 nilai di bawah (SSID, password, URL DB, secret), klik Upload.
// 4. Buka Serial Monitor 115200 untuk verifikasi suhu + status kirim.
//
// WIRING: semua kabel kuning DQ digabung ke GPIO4, resistor 4.7kOhm antara DQ
// dan 3V3. Semua merah ke 3V3, hitam ke GND. Jangan pakai parasite power
// untuk 6 sensor. SSR IN ke GPIO23 (+ GND). Sisi AC solenoid via steker mitra,
// HATI-HATI tegangan 220V.
//
// URUTAN S1..S6 = urutan discovery bus. Untuk petakan fisik, set
// SCAN_ADDRESSES true sekali, catat ROM dari Serial Monitor, lalu kembalikan
// ke false.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>

// ---------------- KONFIGURASI (ISI DULU) ----------------
#define WIFI_SSID "GANTI_WIFI_SSID"
#define WIFI_PASSWORD "GANTI_WIFI_PASSWORD"
#define DATABASE_URL "https://smartcow-de25f-default-rtdb.asia-southeast1.firebasedatabase.app"
#define DATABASE_SECRET "GANTI_DATABASE_SECRET"
#define DEVICE_ID "cow-sprinkler-01"

#define ONE_WIRE_PIN 4
#define SSR_PIN 23
#define SSR_ACTIVE_HIGH true
#define SCAN_ADDRESSES false

#define FW_VERSION "1.0.0-firebase"
#define TELEMETRY_MS 2000
#define CONTROL_MS 5000
#define LOG_MS 30000
// ----------------------------------------------------------

OneWire oneWire(ONE_WIRE_PIN);
DallasTemperature dallas(&oneWire);
WiFiClientSecure tls;
HTTPClient http;

float curT[6] = {29, 29, 29, 29, 29, 29};
float lastValid[6] = {29, 29, 29, 29, 29, 29};
bool fresh[6] = {true, true, true, true, true, true}; // false = fallback, sensor tidak terbaca
int devCount = 0;

char ctlMode[8] = "auto";
char ctlManual[8] = "off";
char ctlAutoSrc[10] = "threshold"; // threshold | schedule (eksklusif)
// Mode jadwal: daftar slot {jam mulai WIB, lama nyala menit}. Maks 6.
// Durasi = lama nyala slot itu, tanpa cooldown/proteksi.
#define MAX_SLOTS 6
int ctlSlotN = 0;
char ctlSlotStart[MAX_SLOTS][8] = {"09:00", "14:00", "18:00", "", "", ""};
int ctlSlotDur[MAX_SLOTS] = {10, 10, 10, 0, 0, 0};
// Legacy 1-jadwal (fallback bila web lama belum kirim schN).
char ctlSchStart[8] = "12:00";
int ctlSchDur = 10;
bool ctlSchOn = false;
bool schedWas = false;
float ctlThreshold = 30.0, ctlHyst = 1.0;
int ctlMaxDur = 120, ctlCooldown = 60;

bool ssrOn = false;
unsigned long sprayStart = 0, lastSprayEnd = 0;
unsigned long tTele = 0, tCtl = 0, tLog = 0, tScan = 0;

String devPath(const String &leaf) {
  return String(DATABASE_URL) + "/devices/" + DEVICE_ID + "/" + leaf + ".json?auth=" + DATABASE_SECRET;
}

bool fbPut(const String &path, const String &payload) {
  http.begin(tls, devPath(path));
  http.setTimeout(4000);
  http.setReuse(true);
  http.addHeader("Content-Type", "application/json");
  int code = http.PUT(payload);
  http.end();
  if (code < 200 || code >= 300) { Serial.printf("PUT %s gagal: %d\n", path.c_str(), code); return false; }
  return true;
}

bool fbPost(const String &path, const String &payload) {
  http.begin(tls, devPath(path));
  http.setTimeout(4000);
  http.setReuse(true);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payload);
  http.end();
  if (code < 200 || code >= 300) { Serial.printf("POST %s gagal: %d\n", path.c_str(), code); return false; }
  return true;
}
  
String fbGet(const String &path) {
  http.begin(tls, devPath(path));
  http.setTimeout(4000);
  http.setReuse(true);
  int code = http.GET();
  String body = (code == 200) ? http.getString() : "";
  http.end();
  if (code != 200) Serial.printf("GET %s gagal: %d\n", path.c_str(), code);
  return body;
}

// Parser JSON mini (respons Firebase compact, tanpa spasi).
float jNum(const String &js, const char *key, float dflt) {
  String k = String("\"") + key + "\":";
  int i = js.indexOf(k);
  if (i < 0) return dflt;
  i += k.length();
  if (js.charAt(i) == '"') return dflt;
  return js.substring(i).toFloat();
}
void jStr(const String &js, const char *key, char *out, size_t n, const char *dflt) {
  String k = String("\"") + key + "\":\"";
  int i = js.indexOf(k);
  if (i < 0) { strncpy(out, dflt, n); out[n - 1] = 0; return; }
  i += k.length();
  int j = js.indexOf('"', i);
  String v = (j < 0) ? js.substring(i) : js.substring(i, j);
  strncpy(out, v.c_str(), n); out[n - 1] = 0;
}

void setRelay(bool on, const char *type, const String &reason, float avg) {
  if (on == ssrOn) return;
  ssrOn = on;
  digitalWrite(SSR_PIN, (on == SSR_ACTIVE_HIGH) ? HIGH : LOW);
  unsigned long now = millis();
  if (on) sprayStart = now; else { lastSprayEnd = now; sprayStart = 0; }
  char buf[220];
  snprintf(buf, sizeof(buf),
    "{\"type\":\"%s\",\"reason\":\"%s\",\"avg\":%.2f,\"ts\":{\".sv\":\"timestamp\"}}",
    type, reason.c_str(), avg);
  fbPost("events", String(buf));
  Serial.printf("Relay %s (%s): %s\n", on ? "ON" : "OFF", type, reason.c_str());
}

void readSensors() {
  dallas.requestTemperatures();
  for (int i = 0; i < 6; i++) {
    float t = (i < devCount) ? dallas.getTempCByIndex(i) : DEVICE_DISCONNECTED_C;
    if (t == DEVICE_DISCONNECTED_C || t < -55 || t > 125) { t = lastValid[i]; fresh[i] = false; }
    else { lastValid[i] = t; fresh[i] = true; }
    curT[i] = t;
  }
}

// Cetak status bus + tiap sensor ke Serial. Tanda * = fallback (tidak terbaca).
void printSensors(float avg) {
  Serial.printf("Sensor terdeteksi: %d/6 | ", devCount);
  for (int i = 0; i < 6; i++)
    Serial.printf("S%d:%.2f%s%s", i + 1, curT[i], fresh[i] ? "" : "*", i < 5 ? " " : "");
  Serial.printf(" | avg:%.2f ssr:%d\n", avg, ssrOn);
}

float lastAvg = 29.0;

float avgNow() {
  float s = 0; int c = 0;
  for (int i = 0; i < 6; i++) if (fresh[i]) { s += curT[i]; c++; }
  if (c == 0) return lastAvg;
  lastAvg = s / c;
  return lastAvg;
}

// true bila `cur` (menit) di dalam window [start, start+dur). Tahan bungkus tengah malam.
bool inWindow(int cur, int start, int dur) {
  if (dur <= 0) return false;
  if (start + dur <= 1440) return cur >= start && cur < start + dur;
  return cur >= start || cur < (start + dur) % 1440;
}

// true bila SALAH SATU slot jadwal sedang berjalan (jam WIB dari NTP).
// Tanpa ctlSchOn: jumlah slot (ctlSlotN) yang menentukan. Fallback legacy 1-jadwal.
bool schedActiveNow() {
  struct tm ti;
  if (!getLocalTime(&ti)) return false;
  int cur = ti.tm_hour * 60 + ti.tm_min;
  if (ctlSlotN > 0) {
    for (int i = 0; i < ctlSlotN && i < MAX_SLOTS; i++) {
      int h, m;
      if (sscanf(ctlSlotStart[i], "%d:%d", &h, &m) != 2) continue;
      if (inWindow(cur, h * 60 + m, ctlSlotDur[i])) return true;
    }
    return false;
  }
  if (!ctlSchOn) return false;
  int h, m;
  if (sscanf(ctlSchStart, "%d:%d", &h, &m) != 2) return false;
  return inWindow(cur, h * 60 + m, ctlSchDur);
}

// Jam mulai slot yang sedang berjalan (untuk log). "" bila tidak ada.
void activeSlotStart(char *out, size_t n) {
  struct tm ti;
  if (!getLocalTime(&ti)) { out[0] = 0; return; }
  int cur = ti.tm_hour * 60 + ti.tm_min;
  for (int i = 0; i < ctlSlotN && i < MAX_SLOTS; i++) {
    int h, m;
    if (sscanf(ctlSlotStart[i], "%d:%d", &h, &m) != 2) continue;
    if (inWindow(cur, h * 60 + m, ctlSlotDur[i])) {
      strncpy(out, ctlSlotStart[i], n); out[n - 1] = 0; return;
    }
  }
  out[0] = 0;
}

void applyLogic(float avg) {
  unsigned long now = millis();
  bool autoMode = strcmp(ctlMode, "auto") == 0;
  if (autoMode) {
    bool isSchedule = strcmp(ctlAutoSrc, "schedule") == 0;
    if (isSchedule) {
      // EKSKLUSIF jadwal: ikuti slot persis apa adanya.
      // Tiap slot: ON di jam mulai selama lama-nyala slot itu, OFF di luar itu.
      // Tanpa cooldown & tanpa batas durasi maks (durasi = lama nyala slot).
      bool sch = schedActiveNow();
      if (sch && !ssrOn) {
        char sb[8]; activeSlotStart(sb, sizeof(sb));
        setRelay(true, "jadwal_on", "jadwal " + String(sb), avg);
      } else if (!sch && ssrOn) {
        setRelay(false, "jadwal_off", "jadwal selesai", avg);
      }
      schedWas = sch;
    } else {
      // EKSKLUSIF threshold: abaikan jadwal.
      if (!ssrOn && avg >= ctlThreshold) {
        if ((now - lastSprayEnd) / 1000UL >= (unsigned long)ctlCooldown)
          setRelay(true, "auto_on", "avg>=threshold", avg);
      } else if (ssrOn && avg <= ctlThreshold - ctlHyst) {
        setRelay(false, "auto_off", "hysteresis", avg);
      }
      if (ssrOn && sprayStart && (now - sprayStart) / 1000UL >= (unsigned long)ctlMaxDur)
        setRelay(false, "protect_off", "durasi maks", avg);
      schedWas = false;
    }
  } else {
    bool want = strcmp(ctlManual, "on") == 0;
    if (want && !ssrOn) setRelay(true, "manual_on", "perintah web", avg);
    else if (!want && ssrOn) setRelay(false, "manual_off", "perintah web", avg);
  }
}

void sendTelemetry(float avg) {
  char buf[340];
  bool schNow = schedActiveNow();
  snprintf(buf, sizeof(buf),
    "{\"t1\":%.2f,\"t2\":%.2f,\"t3\":%.2f,\"t4\":%.2f,\"t5\":%.2f,\"t6\":%.2f,"
    "\"avg\":%.2f,\"ssr\":%d,\"sch\":%d,\"n\":%d,\"mode\":\"%s\",\"rssi\":%d,\"heap\":%u,\"ts\":{\".sv\":\"timestamp\"}}",
    curT[0], curT[1], curT[2], curT[3], curT[4], curT[5],
    avg, ssrOn ? 1 : 0, schNow ? 1 : 0, devCount, ctlMode, WiFi.RSSI(), (unsigned)ESP.getFreeHeap());
  if (fbPut("telemetry/latest", String(buf))) printSensors(avg);
  else Serial.println("Gagal kirim telemetri, cek WiFi/Firebase.");
}

void sendLog(float avg) {
  char buf[260];
  snprintf(buf, sizeof(buf),
    "{\"t1\":%.2f,\"t2\":%.2f,\"t3\":%.2f,\"t4\":%.2f,\"t5\":%.2f,\"t6\":%.2f,"
    "\"avg\":%.2f,\"ssr\":%d,\"ts\":{\".sv\":\"timestamp\"}}",
    curT[0], curT[1], curT[2], curT[3], curT[4], curT[5], avg, ssrOn ? 1 : 0);
  fbPost("telemetry/log", String(buf));
  char st[220];
  snprintf(st, sizeof(st),
    "{\"online\":true,\"lastSeen\":{\".sv\":\"timestamp\"},\"ip\":\"%s\",\"fw\":\"%s\"}",
    WiFi.localIP().toString().c_str(), FW_VERSION);
  fbPut("status", String(st));
}

void pollControl() {
  String js = fbGet("control");
  if (js.length() == 0) return;
  if (js == "null") { // belum ada, tulis default dari firmware
    char buf[400];
    snprintf(buf, sizeof(buf),
      "{\"mode\":\"auto\",\"autoSrc\":\"threshold\",\"manualSsr\":\"off\",\"threshold\":%.1f,\"hysteresis\":%.1f,"
      "\"maxDuration\":%d,\"cooldown\":%d,\"schN\":0,\"schOn\":0,"
      "\"sch1Start\":\"09:00\",\"sch1Dur\":10,\"sch2Start\":\"14:00\",\"sch2Dur\":10,\"sch3Start\":\"18:00\",\"sch3Dur\":10,"
      "\"updatedBy\":\"device\"}",
      ctlThreshold, ctlHyst, ctlMaxDur, ctlCooldown);
    fbPut("control", String(buf));
    return;
  }
  jStr(js, "mode", ctlMode, sizeof(ctlMode), "auto");
  jStr(js, "autoSrc", ctlAutoSrc, sizeof(ctlAutoSrc), "");
  jStr(js, "manualSsr", ctlManual, sizeof(ctlManual), "off");
  ctlThreshold = jNum(js, "threshold", ctlThreshold);  ctlHyst = jNum(js, "hysteresis", ctlHyst);
  ctlMaxDur = (int)jNum(js, "maxDuration", ctlMaxDur);
  ctlCooldown = (int)jNum(js, "cooldown", ctlCooldown);
  ctlSchOn = jNum(js, "schOn", ctlSchOn ? 1 : 0) > 0.5;
  jStr(js, "schStart", ctlSchStart, sizeof(ctlSchStart), "12:00");
  ctlSchDur = (int)jNum(js, "schDur", ctlSchDur);
  // Migrasi: kalau web lama belum kirim autoSrc, turunkan dari schOn.
  if (strlen(ctlAutoSrc) == 0) strncpy(ctlAutoSrc, ctlSchOn ? "schedule" : "threshold", sizeof(ctlAutoSrc));
  ctlAutoSrc[sizeof(ctlAutoSrc) - 1] = 0;
  // Daftar slot multi-jadwal (schN, sch1Start/sch1Dur, ...). -1 = kunci tak ada.
  {
    int n = (int)jNum(js, "schN", -1);
    if (n >= 0) {
      ctlSlotN = n > MAX_SLOTS ? MAX_SLOTS : n;
      for (int i = 0; i < ctlSlotN; i++) {
        char kS[12], kD[12];
        snprintf(kS, sizeof(kS), "sch%dStart", i + 1);
        snprintf(kD, sizeof(kD), "sch%dDur", i + 1);
        jStr(js, kS, ctlSlotStart[i], sizeof(ctlSlotStart[i]), "");
        int d = (int)jNum(js, kD, 10);
        ctlSlotDur[i] = d < 1 ? 1 : (d > 180 ? 180 : d);
      }
    }
  }
}

void printAddresses() {
  Serial.printf("Ditemukan %d sensor. ROM address:\n", devCount);
  for (int i = 0; i < devCount; i++) {
    DeviceAddress a;
    if (!dallas.getAddress(a, i)) { Serial.printf("S%d: gagal baca address\n", i + 1); continue; }
    Serial.printf("S%d: { ", i + 1);
    for (int b = 0; b < 8; b++) Serial.printf("0x%02X%s", a[b], b < 7 ? ", " : " };\n");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(SSR_PIN, OUTPUT);
  digitalWrite(SSR_PIN, SSR_ACTIVE_HIGH ? LOW : HIGH);
  dallas.begin();
  devCount = dallas.getDeviceCount();
  if (SCAN_ADDRESSES) printAddresses();
  else Serial.printf("Sensor terdeteksi: %d (harap 6)\n", devCount);
  if (devCount != 6) Serial.println("PERINGATAN: jumlah sensor bukan 6, cek wiring/pull-up.");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(400); Serial.print(".");
    if (millis() - t0 > 30000) { Serial.println(" gagal, restart."); ESP.restart(); }
  }
  Serial.printf("\nWiFi OK: %s\n", WiFi.localIP().toString().c_str());
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov"); // WIB untuk jadwal
  tls.setInsecure(); // demo: tanpa verifikasi sertifikat (jangan untuk produksi)
  pollControl();
  lastSprayEnd = millis() - (unsigned long)ctlCooldown * 1000UL; // boot tidak kena cooldown
  tTele = tCtl = tLog = millis();
}

void loop() {
  unsigned long now = millis();
  readSensors();
  float avg = avgNow();
  applyLogic(avg); // relay jalan walau Firebase sedang gagal
  if (now - tTele >= TELEMETRY_MS) { tTele = now; sendTelemetry(avg); }
  if (now - tCtl >= CONTROL_MS) { tCtl = now; pollControl(); }
  if (now - tLog >= LOG_MS) { tLog = now; sendLog(avg); }
  if (now - tScan >= 60000) { // scan ulang bus tiap 1 menit, sensor goyang ikut ketemu lagi
    tScan = now;
    dallas.begin();
    int n = dallas.getDeviceCount();
    if (n != devCount) { devCount = n; Serial.printf("Rescan bus: %d sensor\n", devCount); }
  }
  delay(10);
}
