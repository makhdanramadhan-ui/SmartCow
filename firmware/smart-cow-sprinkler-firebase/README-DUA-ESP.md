# SmartCow — dua ESP32 FINAL

## Pilih sketch

| Folder/file | Fungsi |
|---|---|
| `espkanan_FINAL/espkanan_FINAL.ino` | 3 DS + 2 DHT lokal, receiver kiri, SSR dan Firebase |
| `espkanan_FINAL/ClimatePolicy.h` | Rumus THI dan kebijakan threshold/jadwal; wajib berada bersama sketch kanan |
| `espkiri_FINAL/espkiri_FINAL.ino` | 3 DS + 2 DHT, sender ESP-NOW tanpa login router/Firebase |
| `espkanan/espkanan.ino`, `espkiri/espkiri.ino` | Varian DS-only sebelumnya, tetap dipertahankan |
| `espkanan_testDHT22/espkanan_testDHT22.ino`, `espkiri_testDHT22/espkiri_testDHT22.ino` | Tes DHT mandiri melalui Serial, pin GPIO4/14, bukan pin FINAL |
| `smart-cow-sprinkler-firebase/smart-cow-sprinkler-firebase.ino` | Firmware legacy; konfigurasi lokal dipertahankan |

FINAL menggantikan/merename **plusAHT** sesuai permintaan. Tidak ada pembacaan AHT/BMP280 dalam FINAL. Setiap sketch memiliki folder senama, jangan menggabungkan beberapa `.ino` dalam satu folder.

Target **ESP32 klasik/WROOM-32, ESP32 Dev Module**. Paket FINAL **versi 3, 56 byte**, sama persis pada kedua sisi; tidak kompatibel dengan paket DS-only v1 atau AHT v2. ACK, boot ID, sequence, dan tiga retry tetap tersedia.

Kanan **v3.1** menambah kontrol Suhu/THI dan jadwal bersyarat. **Upload ulang kanan**, termasuk header di folder yang sama. Kiri FINAL v3 tidak berubah dan tetap kompatibel. Web hanya mengizinkan Simpan/aktivasi otomatis baru setelah mendapat telemetry fresh `controlPolicyVersion=2`. Setting suhu lama tetap dibaca; jadwal pada v3.1 tidak lagi paksa ON.

## 1. Wiring

| Komponen DATA | Kanan | Kiri |
|---|---|---|
| DS pertama | GPIO4 → `t1` / DS1 | GPIO4 → `t4` / DS4 |
| DS kedua | GPIO14 → `t2` / DS2 | GPIO14 → `t5` / DS5 |
| DS ketiga | GPIO18 → `t3` / DS3 | GPIO18 → `t6` / DS6 |
| DHT pertama | GPIO19 → `h1`,`d1` / DHT1 | GPIO19 → `h3`,`d3` / DHT3 |
| DHT kedua | GPIO25 → `h2`,`d2` / DHT2 | GPIO25 → `h4`,`d4` / DHT4 |
| SSR IN | GPIO23 + GND kanan | Tidak dipasang |

- **GPIO20 tidak ada pada ESP32 klasik**; pin 19/25 telah disepakati. Nomor GPIO boleh sama karena board terpisah.
- VCC sensor **3V3**, GND lokal. Tidak perlu kabel data/common ground antar-ESP untuk ESP-NOW. Ground sensor dan SSR tetap common dengan board lokalnya.
- DS menggunakan 3-kabel, bukan parasite power. **Satu pull-up fisik 4,7 kΩ ke 3V3 per DATA DS**: 3 resistor per sisi, bukan satu resistor bersama.
- DATA DHT menggunakan pull-up **4,7–10 kΩ ke 3V3** jika belum terpasang pada modul. Jangan mengandalkan urutan pin berdasarkan warna; periksa label modul/datasheet.
- GPIO21/22/26 tidak digunakan FINAL dan tersedia untuk rencana INMP441; kode mic belum ada.
- Jack audio boleh dipakai dengan mapping VCC/GND/DATA konsisten. **Cabut daya sebelum memasang/melepas** karena kontak TRS dapat short sesaat. Nomor DS mengikuti jack/GPIO, bukan identitas probe. Rediscovery bisa perlu hingga 60 detik.
- DHT diletakkan dekat titik pengukuran, berventilasi, teduh dan terlindung hujan/sprinkler. Uji kabel pendek terlebih dahulu; bukan kabel DHT/I2C sepanjang 15 m antar-ESP.
- **220 V tidak masuk GPIO**. Pastikan SSR/solenoid sesuai, isolasi dan box/proteksi diperiksa orang kompeten. Uji pertama **tanpa beban AC**; sesuaikan `SSR_ACTIVE_HIGH` dengan modul.

## 2. Router & pairing

1. Router **2,4 GHz**, pilih kanal tetap, misalnya 6. Isi `ESPNOW_CHANNEL` sama pada kedua sketch.
2. Kanan login router; kiri mengirim ESP-NOW langsung ke **MAC STA kanan**, bukan MAC router.
3. Upload kanan terlebih dahulu, lihat `MAC STA ESP KANAN` pada Serial **115200**.
   Kanan v3.1.1 memvalidasi pembacaan MAC, memakai cadangan MAC STA turunan chip bila perlu, dan mencetak ulang setelah Wi-Fi terhubung. Format `RIGHT_MAC` siap salin juga dicetak. Buka Serial Monitor sebelum menekan EN/RESET; jangan menyalin `00:00:00:00:00:00`. `LEFT_MAC={0,...}` di kode kanan adalah placeholder opsional, bukan MAC kanan.
4. Isi pada kiri, contoh format (bukan MAC asli):

   ```cpp
   const uint8_t RIGHT_MAC[6] = {0xAA, 0xBB, 0xCC, 0x11, 0x22, 0x33};
   ```

5. Upload kiri; pastikan `ACK kanan ... diterima`, kanan `DS=6/6`, RH `valid=4/4 mask=15`.
6. `LEFT_MAC` kanan opsional: default nol belajar pengirim valid pertama lalu mengunci sampai reboot. Isi MAC kiri untuk allowlist tetap; ini **bukan autentikasi kriptografis**.

Default `RIGHT_MAC` masih nol: harus diisi sesuai perangkat. Kanal 6 adalah contoh. Kiri tidak auto-scan kanal. Router mati/reconnect dapat mengganggu radio; timeout sensor tetap berlaku. Jarak 15 m wajib diuji nyata.

## 3. Library & konfigurasi

Arduino IDE board **ESP32 Dev Module**:

- OneWire — Paul Stoffregen.
- DallasTemperature — Miles Burton.
- DHT sensor library — Adafruit, beserta Adafruit Unified Sensor.
- ArduinoJson **versi 7**, kanan saja.

Konfigurasi `WIFI_SSID`, `WIFI_PASSWORD`, `DATABASE_SECRET` kanan dipertahankan dari sketch sebelumnya; periksa/isi secara lokal. Jangan menaruh secret pada web atau commit publik. Bila ingin konfigurasi di luar repo, salin **seluruh folder sketch** ke lokasi kerja lokal.

Database/project tetap `smartcow-de25f`, device `cow-sprinkler-01`; hanya kanan mengirim Firebase. Tidak ada device/dashboard kedua.

## 4. Data & freshness

- DS dikonversi non-blocking, tunggu **800 ms**, siklus sekitar 1 detik. Kiri mengirim ringkasan sekitar 2 detik. Retry memakai usia sampel paket asli; duplikat dibalas tanpa menyegarkan data.
- DHT dibaca **3 detik sekali**. Library memeriksa checksum; suhu dan RH dari frame yang sama. Gagal baca langsung invalid, tidak diganti nol. DHT tidak sepenuhnya non-blocking: tiap pembacaan menahan loop beberapa milidetik, berbeda dari konversi DS yang dijadwalkan.
- DS kanan timeout 3 detik; DS kiri/link timeout 10 detik. RH kanan timeout 7 detik; RH kiri timeout 10 detik serta membutuhkan link kiri fresh. Usia RH terpisah per sensor.
- `t1`–`t6` adalah suhu DS; `avg` hanya rata-rata DS valid/fresh. `validMask` bit 0–5, `validCount`, `complete`, `temperatureAgeMs`.
- `h1`–`h4` adalah %RH; `d1`–`d4` suhu DHT pendamping. `humidityAvg`, mask bit 0–3, count, complete, dan `humidityAgeMs` terpisah.
- `leftOnline`, `leftAgeMs`, `schemaVersion=3`, `ssr`, `mode`, `autoSrc`, `measuredTs` (estimasi snapshot NTP), `ts` (server Firebase).
- Angka DS terakhir atau -127 masih bisa tersimpan saat invalid; **mask/usia** menentukan kelayakan. RH/DHT invalid diserialisasi null dan bisa hilang dari RTDB. Jangan anggap field hilang = nol.
- **Nol DS valid:** FINAL tetap memperbarui latest/log/status, `avg` tidak ada. Rules baru mendukung kondisi ini tanpa suhu palsu, sehingga DHT/relay tetap dapat dipantau. Varian DS-only lama masih melewati latest/log saat semua DS invalid.
- Dashboard baru membaca mask dan freshness; enam/empat kartu tidak hilang saat sensor putus. Data kedaluwarsa tidak ditandai LIVE dan status relay lama tidak dianggap status kini.
- **THI agregat** dihitung dari rata-rata 6 DS (T °C) dan rata-rata 4 RH (%): `(1.8*T+32) - (0.55-0.0055*RH)*(1.8*T-26)`. Contoh 30 °C + 70%RH → **81,38**. `thi` hanya tersedia bila `thiComplete=true` (10 input valid/fresh). Tidak memakai suhu DHT, tidak memerlukan pairing per titik; ini pendekatan agregat, bukan THI lokal/diagnosis stres.
- Telemetry/status juga melaporkan `controlPolicyVersion=2` dan `controlBasis=temperature|thi` yang sedang diterapkan. Web menghitung ulang THI dengan freshness kanal, bukan menampilkan THI lama saat input hilang.

Lokasi Firebase:

```text
devices/cow-sprinkler-01/{telemetry/latest, telemetry/log, control, events, status}
```

## 5. Kontrol sprinkler

- **Auto suhu:** wajib keenam DS valid/fresh. Kurang satu atau kiri stale → OFF. Tidak ada fallback kanan saja. DHT gagal tidak memblokir jika 6 DS lengkap.
- Default threshold **30 °C**, hysteresis **1 °C**, maksimum nyala **120 detik**, cooldown **60 detik**. Setting berasal dari control Firebase.
- **Auto THI:** wajib 6 DS + 4 RH valid/fresh. Kurang satu → OFF. Default contoh threshold **72**, hysteresis **2 poin THI**, durasi maksimum **120 detik**, cooldown **60 detik**. Angka THI perlu disesuaikan dengan protokol evaluasi kandang.
- **Jadwal mengikuti dasar terpilih**: Suhu saja atau THI saja. Slot merupakan jendela waktu bertanggal WIB, membutuhkan NTP, dan boleh melintasi tengah malam. Di dalam slot relay tetap mengikuti threshold/hysteresis, kelengkapan input, maksimum durasi dan cooldown; di luar slot selalu OFF. Contoh THI 68, threshold 72, slot 14:00–14:10 → tetap OFF. Jika THI ≥72 relay boleh ON; berakhir paling lambat 14:10. Nilai tetap tinggi bisa memicu siklus baru setelah cooldown selama jendela aktif.
- **Manual ON bertahan sampai OFF**, termasuk saat internet putus. Hanya manual yang melewati kelengkapan sensor, maksimum durasi dan cooldown otomatis.
- Profil Suhu dan THI memiliki setting/jadwal terpisah. Control v2 memakai awalan `temp`/`thi` (mis. `tempThreshold`, `thiThreshold`, `tempSchN`, `thiSch1Date/Start/Dur`). Field legacy selalu profil suhu; THI 72 tidak pernah dikirim sebagai suhu 72 °C. Edit web tidak diterapkan sampai **Simpan Pengaturan**; pindah Manual/Otomatis langsung memakai profil terapan terakhir.
- Boot relay OFF; kontrol kembali default sampai Firebase terbaca, belum ada persistensi setting tahan reboot. Internet putus tidak otomatis menghentikan kontrol lokal bila data/link lokal tersedia.
- HTTP/TLS berjalan di task terpisah; snapshot/konfigurasi ditukar melalui queue. Antrean event offline hanya RAM terbatas, bukan arsip tahan mati daya.
- Web hanya mengirim pengaturan/manual dan mencerminkan status. Tidak mengirim otomatisasi/auto-off sendiri atau menimpa control saat login.

## 6. Keamanan & deploy web

Web login lewat formulir Firebase Authentication, konfigurasi publik `js/firebase-public.js` tanpa password. File lokal lama `js/firebase-config.js` tidak dimuat/deploy. Hosting diaktifkan kembali sesuai persetujuan pengguna; publikasi hanya melalui allowlist aset web pada `scripts/prepare-hosting.cjs`. Deploy rules/Hosting tidak menulis control atau data telemetry uji ke produksi.

**Rotasi secret/password yang pernah terbagikan.** Database Secret legacy berhak luas, TLS firmware masih `setInsecure()`, ESP-NOW masih tanpa enkripsi. Ini batas pilot, bukan jaminan keamanan produksi. Jangan membuka port router untuk ESP-NOW.

## 7. Verifikasi & checklist

Kedua FINAL berhasil dikompilasi terpisah sebagai `.ino`: PlatformIO `esp32dev`, Arduino-ESP32 **2.0.17**, OneWire **2.3.8**, DallasTemperature **4.0.6**, DHT **1.4.7**, Adafruit Unified Sensor **1.1.15**, ArduinoJson **7.4.3** untuk kanan. Callback core 3.x disediakan tetapi belum dikompilasi pada core 3.x. Warning berasal dari library OneWire, build berhasil. Belum upload/uji sensor, radio 15 m, atau relay nyata.

1. Tanpa AC, 6 DS + 4 DHT terbaca; bandingkan dengan alat referensi dan hitung manual rata-rata DS.
2. Auto suhu: melampaui threshold → ON; turun melewati hysteresis → OFF; maksimum durasi → OFF, cooldown dipatuhi.
3. Cabut daya sebelum melepas satu DS, nyalakan: DS tersebut invalid, rata-rata parsial, auto suhu tidak ON.
4. Matikan kiri: setelah timeout DS4–6/DHT3–4 invalid dan auto suhu OFF; kartu tetap ada.
5. Lepas satu DHT saat daya mati, nyalakan: hanya channel itu hilang; DS lengkap tetap dapat mengontrol threshold.
6. Semua DS invalid, DHT ada: latest baru dengan `validCount=0`, tanpa avg; RH dan status relay tetap diperbarui.
7. Putus internet saja/boot tanpa Wi-Fi: sensor dan logika lokal tetap berjalan, HTTP tidak menahan loop; NTP/jadwal punya keterbatasan boot.
8. Reboot kiri: boot ID baru diterima. Uji router reconnect/kanal dan jarak nyata 15 m saat sapi/orang bergerak.
9. Uji THI: bandingkan rumus dengan angka rata-rata DS/RH; lepas satu DHT → auto THI OFF, auto suhu tetap boleh jika DS lengkap. Pindah profil dan pastikan threshold/durasi/cooldown/jadwal terpisah.
10. Uji jadwal Suhu dan THI: bawah threshold saat slot mulai tetap OFF; ambang tercapai boleh ON; hysteresis/maksimum/cooldown tetap berlaku; akhir slot OFF walau nilai tinggi. Uji slot melewati tengah malam dan NTP belum valid.
11. Uji manual terpisah, pahami ON menetap saat internet/data putus. Tutup browser tidak mematikan relay.
12. Saat ESP berhenti mengirim, web harus berhenti menunjukkan LIVE; relay menjadi belum diketahui. Jangan sambungkan AC sebelum uji dan keselamatan diperiksa.
