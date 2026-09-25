// Smart Cow Sprinkler — Firmware ESP32 + Firebase RTDB (REST), versi PlatformIO.
// Sumber utama firmware. Secret WiFi/Firebase ada di include/secrets.h
// (tidak di-commit). 6x DS18B20 satu bus OneWire GPIO4, SSR GPIO23.
//
// WIRING: semua DQ gabung ke GPIO4, pull-up 4.7kOhm DQ ke 3V3, power 3V3
// eksternal (bukan parasite). SSR IN ke GPIO23 (+ GND). AC 220V via steker
// mitra, HATI-HATI tegangan tinggi.

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>
#include "secrets.h"

#define ONE_WIRE_PIN 4
#define SSR_PIN 23
#define SSR_ACTIVE_HIGH true
#define SCAN_ADDRESSES false

#define FW_VERSION "1.0.0-firebase"
#define TELEMETRY_MS 2000
#define CONTROL_MS 5000
#define LOG_MS 30000

String devPath(const String &leaf);
bool fbPut(const String &path, const String &payload);
bool fbPost(const String &path, const String &payload);
String fbGet(const String &path);
float jNum(const String &js, const char *key, float dflt);
void jStr(const String &js, const char *key, char *out, size_t n, const char *dflt);
void setRelay(bool on, const char *type, const String &reason, float avg);
void readSensors();
void printSensors(float avg);
float avgNow();
bool schedActiveNow();
void applyLogic(float avg);
void sendTelemetry(float avg);
void sendLog(float avg);
void pollControl();
void printAddresses();

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
char ctlSchStart[8] = "12:00";
int ctlSchDur = 10;
bool ctlSchOn = false;
bool schedWas = false;
float ctlThreshold = 30.0, ctlHyst = 1.0;
int ctlMaxDur = 120, ctlCooldown = 60;

bool ssrOn = false;
unsigned long sprayStart = 0, lastSprayEnd = 0;
unsigned long tTele = 0, tCtl = 0, tLog = 0, tScan = 0;
float lastAvg = 29.0;

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

float avgNow() {
  float s = 0; int c = 0;
  for (int i = 0; i < 6; i++) if (fresh[i]) { s += curT[i]; c++; }
  if (c == 0) return lastAvg;
  lastAvg = s / c;
  return lastAvg;
}

// true bila jadwal harian sedang dalam window (jam WIB dari NTP).
bool schedActiveNow() {
  if (!ctlSchOn) return false;
  struct tm ti;
  if (!getLocalTime(&ti)) return false;
  int h, m;
  if (sscanf(ctlSchStart, "%d:%d", &h, &m) != 2) return false;
  int start = h * 60 + m, cur = ti.tm_hour * 60 + ti.tm_min, dur = ctlSchDur;
  if (dur <= 0) return false;
  if (start + dur <= 1440) return cur >= start && cur < start + dur;
  return cur >= start || cur < (start + dur) % 1440;
}

void applyLogic(float avg) {
  unsigned long now = millis();
  bool autoMode = strcmp(ctlMode, "auto") == 0;
  if (autoMode) {
    if (!ssrOn && avg >= ctlThreshold) {
      if ((now - lastSprayEnd) / 1000UL >= (unsigned long)ctlCooldown)
        setRelay(true, "auto_on", "avg>=threshold", avg);
    } else if (ssrOn && avg <= ctlThreshold - ctlHyst) {
      setRelay(false, "auto_off", "hysteresis", avg);
    }
    if (ssrOn && sprayStart && (now - sprayStart) / 1000UL >= (unsigned long)ctlMaxDur)
      setRelay(false, "protect_off", "durasi maks", avg);
    // Overlay jadwal: paksa nyala di window (lewati cooldown, perintah eksplisit),
    // matikan saat window selesai kecuali suhu masih menahan via threshold.
    bool sch = schedActiveNow();
    if (sch && !ssrOn) setRelay(true, "jadwal_on", "jadwal " + String(ctlSchStart), avg);
    else if (!sch && schedWas && ssrOn && avg < ctlThreshold)
      setRelay(false, "jadwal_off", "jadwal selesai", avg);
    schedWas = sch;
  } else {
    bool want = strcmp(ctlManual, "on") == 0;
    if (want && !ssrOn) setRelay(true, "manual_on", "perintah web", avg);
    else if (!want && ssrOn) setRelay(false, "manual_off", "perintah web", avg);
  }
}

void sendTelemetry(float avg) {
  char buf[340];
  bool schNow = schedActiveNow();
  String t[6];
  for (int i = 0; i < 6; i++) t[i] = fresh[i] ? String(curT[i], 2) : "null";
  snprintf(buf, sizeof(buf),
    "{\"t1\":%s,\"t2\":%s,\"t3\":%s,\"t4\":%s,\"t5\":%s,\"t6\":%s,"
    "\"avg\":%.2f,\"ssr\":%d,\"sch\":%d,\"n\":%d,\"mode\":\"%s\",\"rssi\":%d,\"heap\":%u,\"ts\":{\".sv\":\"timestamp\"}}",
    t[0].c_str(), t[1].c_str(), t[2].c_str(), t[3].c_str(), t[4].c_str(), t[5].c_str(),
    avg, ssrOn ? 1 : 0, schNow ? 1 : 0, devCount, ctlMode, WiFi.RSSI(), (unsigned)ESP.getFreeHeap());
  if (fbPut("telemetry/latest", String(buf))) printSensors(avg);
  else Serial.println("Gagal kirim telemetri, cek WiFi/Firebase.");
}

void sendLog(float avg) {
  char buf[260];
  String t[6];
  for (int i = 0; i < 6; i++) t[i] = fresh[i] ? String(curT[i], 2) : "null";
  snprintf(buf, sizeof(buf),
    "{\"t1\":%s,\"t2\":%s,\"t3\":%s,\"t4\":%s,\"t5\":%s,\"t6\":%s,"
    "\"avg\":%.2f,\"ssr\":%d,\"ts\":{\".sv\":\"timestamp\"}}",
    t[0].c_str(), t[1].c_str(), t[2].c_str(), t[3].c_str(), t[4].c_str(), t[5].c_str(),
    avg, ssrOn ? 1 : 0);
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
    char buf[280];
    snprintf(buf, sizeof(buf),
      "{\"mode\":\"auto\",\"manualSsr\":\"off\",\"threshold\":%.1f,\"hysteresis\":%.1f,"
      "\"maxDuration\":%d,\"cooldown\":%d,\"schOn\":0,\"schStart\":\"12:00\",\"schDur\":10,"
      "\"updatedBy\":\"device\"}",
      ctlThreshold, ctlHyst, ctlMaxDur, ctlCooldown);
    fbPut("control", String(buf));
    return;
  }
  jStr(js, "mode", ctlMode, sizeof(ctlMode), "auto");
  jStr(js, "manualSsr", ctlManual, sizeof(ctlManual), "off");
  ctlThreshold = jNum(js, "threshold", ctlThreshold);
  ctlHyst = jNum(js, "hysteresis", ctlHyst);
  ctlMaxDur = (int)jNum(js, "maxDuration", ctlMaxDur);
  ctlCooldown = (int)jNum(js, "cooldown", ctlCooldown);
  ctlSchOn = jNum(js, "schOn", ctlSchOn ? 1 : 0) > 0.5;
  jStr(js, "schStart", ctlSchStart, sizeof(ctlSchStart), "12:00");
  ctlSchDur = (int)jNum(js, "schDur", ctlSchDur);
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
    if (n != devCount) {
      char buf[120];
      snprintf(buf, sizeof(buf),
        "{\"type\":\"rescan\",\"reason\":\"bus %d -> %d, peta S1..S%d berubah\",\"ts\":{\".sv\":\"timestamp\"}}",
        devCount, n, n);
      fbPost("events", String(buf));
      devCount = n;
      Serial.printf("Rescan bus: %d sensor (peta S1..Sn berubah)\n", devCount);
    }
  }
  delay(10);
}
