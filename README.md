# 🐄 Smart Cow Sprinkler System

Web monitoring + kontrol penyemprot kandang sapi otomatis berbasis suhu (6× DS18B20, satu bus OneWire). Backend: Firebase Hosting + Realtime Database.

## 1. Wiring (lo hardware dulu)

| Komponen | Pasang |
|---|---|
| 6× DS18B20, kabel kuning DQ | Gabung semua ke **GPIO4** |
| Resistor 4.7kΩ | Antara DQ dan 3V3 (wajib, satu saja) |
| Kabel merah / hitam | 3V3 / GND (power eksternal, bukan parasite) |
| SSR IN | **GPIO23** + GND |
| Solenoid valve AC 220V | Via SSR + steker mitra. HATI-HATI tegangan tinggi |

## 2. Flash firmware (Arduino IDE)

1. Install board `esp32` (Espressif) via Boards Manager, pilih **ESP32 Dev Module**.
2. Install via Library Manager: **OneWire** (Paul Stoffregen) + **DallasTemperature** (Miles Burton). Tidak perlu library Firebase.
3. Buka `firmware/smart-cow-sprinkler-firebase.ino`, isi 4 nilai atas: `WIFI_SSID`, `WIFI_PASSWORD`, `DATABASE_URL`, `DATABASE_SECRET` (lihat langkah 3).
4. Upload, buka Serial Monitor **115200**. Harus muncul `Sensor terdeteksi: 6` + `Terkirim avg=...` tiap 2 detik.
5. Kalau sensor kurang dari 6: cek pull-up, power 3V3, dan sambungan DQ.
6. Untuk petakan S1..S6 ke posisi fisik: set `SCAN_ADDRESSES true` sekali, catat ROM dari Serial, kembalikan ke false.

## 3. Firebase Console (sekali saja)

1. Buat project di console.firebase.google.com. Buat **Realtime Database** (region asia-southeast1), mulai dengan **locked mode**.
2. Tab **Rules**: tempel isi `database.rules.json`, Publish.
3. Project Overview > Add app > Web, salin config ke `js/firebase-config.js` (contoh di `js/firebase-config.example.js`).
4. Build > Authentication > Sign-in method > aktifkan **Email/Password**, tambah user demo. Email + password itu yang diisi di `js/firebase-config.js`.
5. Project Settings > Service accounts > **Database secrets** > salin secret ke firmware (langkah 2). Secret ini sensitif: jangan sebar file .ino.

## 4. Jalanin web

- Lokal: double-click `index.html` (mode Simulasi langsung jalan, tanpa internet).
- Live ESP32: klik tombol **Firebase** di kartu Sumber Data. Web login akun demo, listen `devices/cow-sprinkler-01/telemetry/latest`, kirim perintah ke `.../control`.
- Online via Hosting: `npm install -g firebase-tools`, `firebase login`, isi project id di `.firebaserc`, `firebase deploy --only hosting,database`.

## 5. Struktur data RTDB

```
devices/cow-sprinkler-01/telemetry/latest  (ESP32 tulis tiap 2 dtk, web listen; ada flag sch)
devices/cow-sprinkler-01/telemetry/log/{id} (tiap 30 dtk, web baca 120 terakhir)
devices/cow-sprinkler-01/control            (web tulis, ESP32 baca tiap 5 dtk:
  mode, manualSsr, threshold, hysteresis, maxDuration, cooldown,
  schOn, schStart "HH:MM", schDur menit)
devices/cow-sprinkler-01/events/{id}        (bukti ON/OFF, ditulis ESP32 + web)
devices/cow-sprinkler-01/status             (heartbeat ESP32 tiap 30 dtk)
```

## 6. File

```
index.html  css/style.css  js/core.js  js/app.js  js/config.js
js/firebase.js  js/firebase-config.js  test/core.test.js (node --test test/)
firmware/smart-cow-sprinkler-firebase.ino  firmware/smart-cow-sprinkler.ino (MQTT lama)
firebase.json  .firebaserc  database.rules.json
docs/firebase-research.md  docs/adr/  CONTEXT.md  PRODUCT.md
```

Logika relay identik di web (`js/core.js`, ter-test) dan firmware: mode otomatis eksklusif, pilih salah satu — (a) **suhu**: ON saat avg ≥ threshold, OFF saat avg ≤ threshold − hysteresis (+ proteksi durasi maks & cooldown); (b) **jadwal**: daftar maks 6 slot bertanggal `{tanggal, jam mulai WIB, lama nyala menit}`, tiap slot jalan hanya di tanggalnya (khusus hari ini jam min = sekarang+1 mnt), slot kedaluwarsa auto-hapus. Tambahan: mode manual mengunci ke tombol.
