// SmartCow TEST DHT22 — ESP KANAN (2 sensor, Serial saja).
// Board: ESP32 Dev Module / WROOM-32.
// Library Arduino IDE: "DHT sensor library" (Adafruit) + "Adafruit Unified Sensor".
// File ini dibuka sebagai: espkanan_testDHT22/espkanan_testDHT22.ino
// (nama folder HARUS sama dengan nama file untuk Arduino IDE).
// TIDAK ada Wi-Fi / Firebase / ESP-NOW di sketch ini. Murni tes baca sensor.
//
// WIRING ESP KANAN:
//   DHT#1: VCC -> 3V3, GND -> GND, DATA -> GPIO4
//   DHT#2: VCC -> 3V3, GND -> GND, DATA -> GPIO14
// Modul DHT22 umumnya sudah ada pull-up di DATA. Kalau pakai sensor
// telanjang (4 kaki), tambah resistor 10k antara DATA dan VCC.
// Kabel tes dibuat PENDEK dulu (< 5 m). DHT22 tidak cocok untuk kabel
// panjang lintas kandang seperti DS18B20.
// DHT kanan = DHT#1 + DHT#2. DHT kiri (ESP lain) = DHT#3 + DHT#4.

#include <Arduino.h>
#include <DHT.h>
#include <math.h>

#define DHTTYPE DHT22

const uint8_t DHT_PINS[2] = {4, 14}; // DHT#1, DHT#2
constexpr uint32_t READ_MS = 3000;   // DHT22 minimal ~2 detik antar baca

DHT dhtSensors[2] = {DHT(DHT_PINS[0], DHTTYPE), DHT(DHT_PINS[1], DHTTYPE)};
uint32_t lastRead = 0;

float calcTHI(float tempC, float rh) {
  if (!isfinite(tempC) || !isfinite(rh)) return NAN;
  // Rumus NRC untuk preview saja, bukan kontrol relay.
  return (1.8f * tempC + 32.0f) - (0.55f - 0.0055f * rh) * (1.8f * tempC - 26.0f);
}

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("SmartCow TEST DHT22 — ESP KANAN (DHT#1 + DHT#2)");
  for (int i = 0; i < 2; i++) {
    dhtSensors[i].begin();
    Serial.printf("DHT#%d DATA -> GPIO%u\n", i + 1, DHT_PINS[i]);
  }
  Serial.println("Buka Serial Monitor 115200. Pembacaan tiap 3 detik.");
  lastRead = millis() - READ_MS; // baca langsung saat boot
}

void loop() {
  if (uint32_t(millis() - lastRead) < READ_MS) {
    delay(50);
    return;
  }
  lastRead = millis();

  for (int i = 0; i < 2; i++) {
    float rh = dhtSensors[i].readHumidity();
    float tempC = dhtSensors[i].readTemperature(false);
    if (isnan(rh) || isnan(tempC)) {
      Serial.printf("DHT#%d GPIO%u: GAGAL (cek kabel VCC/GND/DATA + power 3V3)\n",
        i + 1, DHT_PINS[i]);
      continue;
    }
    float thi = calcTHI(tempC, rh);
    Serial.printf("DHT#%d GPIO%u: T=%.2fC RH=%.2f%% THI=%.2f OK\n",
      i + 1, DHT_PINS[i], tempC, rh, thi);
  }
  Serial.println("---");
}
