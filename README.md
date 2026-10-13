# 🐄 SmartCow — monitoring kandang & sprinkler

Dashboard **6 DS18B20 + 4 DHT22**, dua ESP32, satu device Firebase `cow-sprinkler-01`.

- **ESP kiri:** 3 DS + 2 DHT → ESP-NOW → kanan.
- **ESP kanan:** 3 DS + 2 DHT lokal, agregasi kedua sisi, relay GPIO23, Wi-Fi/Firebase.
- Kontrol otomatis memilih **Suhu DS** atau **THI agregat kandang**. THI memakai suhu rata-rata **6 DS** + RH rata-rata **4 DHT**, bukan suhu DHT atau THI per titik.

## Wiring FINAL

| Sinyal | ESP kanan | ESP kiri |
|---|---|---|
| DS pertama | GPIO4 → DS1 | GPIO4 → DS4 |
| DS kedua | GPIO14 → DS2 | GPIO14 → DS5 |
| DS ketiga | GPIO18 → DS3 | GPIO18 → DS6 |
| DHT pertama | GPIO19 → DHT1 | GPIO19 → DHT3 |
| DHT kedua | GPIO25 → DHT2 | GPIO25 → DHT4 |
| SSR IN | GPIO23 | Tidak dipasang |

VCC sensor **3V3**, GND lokal masing-masing ESP. Setiap DATA DS punya pull-up fisik **4,7 kΩ** sendiri. DATA DHT memakai pull-up **4,7–10 kΩ** ke 3V3 bila belum ada pada modul. **GPIO20 tidak tersedia pada ESP32 klasik/WROOM-32.** GPIO21/22/26 tetap tersedia untuk rencana mic, belum ada kode mic.

Cabut daya sebelum memindahkan jack/sensor. **Uji tanpa beban AC terlebih dahulu; pengerjaan 220 V harus oleh orang kompeten.** Detail wiring, pairing radio, library, dan checklist di [panduan firmware](firmware/smart-cow-sprinkler-firebase/README-DUA-ESP.md).

## Upload firmware

1. Arduino IDE: board **ESP32 Dev Module**. Library **OneWire**, **DallasTemperature**, **DHT sensor library (Adafruit)**, **Adafruit Unified Sensor**, dan **ArduinoJson v7** untuk kanan.
2. Buka `firmware/smart-cow-sprinkler-firebase/espkanan_FINAL/espkanan_FINAL.ino` bersama `ClimatePolicy.h` di folder yang sama. Pertahankan/isi konfigurasi Wi-Fi dan Firebase lokal, samakan `ESPNOW_CHANNEL` dengan kanal tetap router 2,4 GHz.
3. Upload kanan, buka Serial Monitor **115200**, catat MAC STA kanan.
4. Isi `RIGHT_MAC` pada `firmware/smart-cow-sprinkler-firebase/espkiri_FINAL/espkiri_FINAL.ino`, samakan kanal, upload kiri.
5. Pastikan ACK diterima, DS **6/6** dan RH **4/4**. Uji kehilangan sensor/link sebelum menghubungkan solenoid.

Setiap sketch berada di folder sendiri. FINAL memakai paket **v3, 56 byte**; jangan dipasangkan dengan DS-only atau versi AHT lama. Varian DS-only, tes DHT mandiri, dan firmware legacy tetap terpisah; tes DHT mandiri memakai GPIO4/14, **bukan pin FINAL**.

**Pembaruan THI memerlukan upload ulang kanan v3.1.** Kiri FINAL v3 tidak berubah dan tetap kompatibel. Web memblokir Simpan/aktivasi otomatis baru sampai menerima telemetry fresh dengan `controlPolicyVersion=2`; jangan hanya memperbarui web. Firmware baru masih membaca setting suhu legacy sampai pengguna menyimpan profil v2; jadwal pada firmware baru selalu bersyarat threshold.

## Dashboard & Firebase

Alamat Hosting: **https://smartcow-de25f.web.app**. Login memakai akun **Firebase Authentication Email/Password yang sudah dibuat**, bukan akun Google/Firebase Console kecuali email itu memang didaftarkan sebagai user Authentication.

- Konfigurasi publik ada di `js/firebase-public.js`: API key project bukan password akun. Password dimasukkan melalui formulir login; tidak dibundel di website.
- `js/firebase-config.js` lokal lama dipertahankan tetapi **tidak dimuat/dipublikasikan**.
- UI menampilkan 6 kartu DS dan 4 kartu DHT secara tetap, node kanan/kiri, validitas, rata-rata, THI, grafik suhu/RH/THI, riwayat 120 baris, dan CSV termasuk THI.
- Sensor hilang/stale ditampilkan **—**, bukan nol. LIVE membutuhkan telemetry terkini; relay offline ditampilkan **belum diketahui**, bukan diasumsikan OFF.
- Login/reload tidak menimpa control Firebase dengan konfigurasi browser. Web mengirim pengaturan/perintah, **ESP kanan sendiri** menjalankan kontrol lokal; menutup browser tidak mematikan otomatisasi.
- **Suhu / THI** menyimpan profil terpisah: threshold, hysteresis, durasi maksimum, cooldown, cara menjalankan, dan maksimal enam jendela jadwal bertanggal (WIB). Hanya profil terpilih yang mengendalikan relay. Edit/pindah profil/jadwal masih draft; klik **Simpan Pengaturan** untuk menerapkan. Tombol Manual/Otomatis mengubah mode secara langsung memakai profil terakhir tersimpan, bukan draft.

Untuk preview lokal gunakan server HTTP, misalnya `python -m http.server 8080`; buka `http://localhost:8080`. Bukan mode simulasi, dan SDK/login membutuhkan internet.

### Deploy

```sh
node scripts/prepare-hosting.cjs
firebase deploy --only hosting,database --project smartcow-de25f
```

Hosting hanya memuat hasil salinan allowlist di `public/`, bukan seluruh repository. Firmware, konfigurasi login lama, dan secrets tidak ikut. Rules tetap mewajibkan autentikasi; mendukung telemetry FINAL dengan nol DS valid dan `avg` tidak ada, tanpa rata-rata palsu. Deploy rules tidak mengubah data/control perangkat.

## Kontrak data

```text
devices/cow-sprinkler-01/
  telemetry/latest       sekitar 2 detik jika koneksi lancar
  telemetry/log/{id}     sekitar 30 detik, ESP kanan yang menulis
  control                dibaca ESP kanan sekitar 5 detik
  events/{id}
  status                 heartbeat sekitar 30 detik
```

- `t1`–`t6`, `avg`, `validMask`, `validCount`, `complete`, `temperatureAgeMs`: suhu DS; bit 0–5 = DS1–DS6.
- `h1`–`h4`, `humidityAvg`, `humidityValidMask`, `humidityValidCount`, `humidityComplete`, `humidityAgeMs`: RH; bit 0–3 = DHT1–DHT4.
- `d1`–`d4`: suhu DHT untuk pembanding, tidak masuk `avg` DS.
- `thi`, `thiComplete`: THI hanya tersedia saat semua 6 DS + 4 RH valid/fresh. Rumus: `(1.8*T+32) - (0.55-0.0055*RH)*(1.8*T-26)`. Contoh T=30 °C, RH=70% → THI=81,38. Ini indikator lingkungan agregat, bukan diagnosis stres hewan.
- `controlPolicyVersion=2`, `controlBasis=temperature|thi` pada control/telemetry/status. Control memuat `tempThreshold`, `thiThreshold`, `tempHysteresis`, `thiHysteresis`, `tempMaxDuration`, `thiMaxDuration`, `tempCooldown`, `thiCooldown`, `tempAutoSrc`, `thiAutoSrc`, serta `tempSchN`/`thiSchN` dan slot `tempSch1Date/Start/Dur`–6 / `thiSch1Date/Start/Dur`–6. Field legacy tetap berisi profil **suhu**, tidak pernah angka THI.
- `leftOnline`, `leftAgeMs`, `ssr`, `mode`, `autoSrc`, `schemaVersion=3`, `measuredTs`, `ts`.
- Nilai suhu DS invalid bisa masih berupa angka terakhir/-127 di database; **mask + usia** menentukan kelayakan, bukan angka saja. RH invalid/null hilang dari RTDB; jangan ubah field hilang menjadi 0%RH.

## Kontrol & batas pilot

- **Auto suhu:** wajib 6/6 DS valid/fresh. Kurang satu DS atau kiri stale → relay OFF. Default threshold 30 °C, hysteresis 1 °C, maksimum 120 detik, cooldown 60 detik.
- **Auto THI:** wajib 6/6 DS + 4/4 RH valid/fresh. Satu input hilang/stale → OFF. Default contoh threshold **72**, hysteresis **2 poin THI**, maksimum **120 detik**, cooldown **60 detik**; perlu disesuaikan dengan protokol lapangan, bukan ambang diagnosis universal.
- **Sepanjang waktu:** threshold profil terpilih selalu diperiksa. **Dalam jadwal:** slot adalah jendela waktu, bukan paksa ON; di luar slot OFF. Di dalam slot threshold/hysteresis, kelengkapan sensor, durasi maksimum, dan cooldown semuanya tetap berlaku. Jadwal membutuhkan NTP; slot bertanggal boleh melintasi tengah malam. Contoh THI threshold 72, slot 14:00–14:10: THI 68 → tetap OFF; THI ≥72 → boleh ON, paling lambat OFF 14:10. Jika nilai tetap tinggi setelah maksimum/cooldown, siklus bisa berulang selama slot masih aktif.
- **Manual:** ON sampai perintah OFF, termasuk saat internet putus; tidak memakai kelengkapan sensor/durasi maksimum/cooldown otomatis. Uji tanpa AC terlebih dahulu.
- Boot relay OFF, konfigurasi default sampai Firebase control terbaca; belum ada penyimpanan pengaturan tahan reboot.
- Radio 15 m, kualitas RH, kabel, dan keselamatan kelistrikan belum diuji di kandang. TLS `setInsecure()`, Database Secret legacy, serta ESP-NOW tanpa enkripsi masih batas pilot, bukan desain produksi. Rotasi kredensial yang pernah terbagikan; jangan commit secret lokal.

## Verifikasi

```sh
node --test test/core.test.js test/telemetry.test.js test/control.test.js
```

54 unit test mencakup THI, profil independen, migrasi setting, jadwal bersyarat, proteksi otomatis, dan normalisasi/freshness DS–DHT. FINAL kanan/kiri berhasil dikompilasi sebagai `.ino` untuk `esp32dev`, Arduino-ESP32 **2.0.17**, OneWire 2.3.8, DallasTemperature 4.0.6, DHT 1.4.7, Unified Sensor 1.1.15, ArduinoJson 7.4.3. Cabang callback core 3.x tersedia tetapi belum dikompilasi pada core 3.x. Uji browser/emulator bukan pengganti upload dan uji perangkat nyata.
