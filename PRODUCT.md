# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pengguna utama: peternak di kandang. Membuka dashboard dari HP saat kerja harian untuk memantau suhu kandang dan memastikan penyemprot berjalan saat sapi kepanasan. Berhasil = sapi tidak stres panas, data suhu jelas, dan kontrol semprot bisa diandalkan dari web.

## Product Purpose

Memberi peternak kepastian kondisi kandang lewat monitoring 6 titik suhu DS18B20 + rata-rata, dan mengendalikan sprinkler solenoid (via SSR) secara otomatis berbasis ambang suhu, dengan opsi manual. Sukses berarti: semprotan menyala tepat saat rata-rata menyentuh threshold, tercatat di log, dan peternak selalu bisa override manual.

## Positioning

Satu dashboard yang menggabungkan tiga hal yang biasanya terpisah: pantau 6 titik + rata-rata kandang, logika proteksi sapi (threshold + hysteresis + batas durasi + cooldown), dan bukti kerja (grafik + log 1 jam + event) yang bisa ditunjukkan ke dosen/mitra — tetap jalan dalam mode simulasi tanpa hardware.

## Operating Context

Dipakai di kandang (HP, koneksi tidak selalu stabil) dan saat demo tugas semester 5. Alur harian: cek rata-rata dan status → biarkan mode otomatis bekerja → ambil alih manual bila perlu → unduh/cek log 1 jam terakhir sebagai laporan. Evaluasi juga memakai mode simulasi saat ESP32 tidak tersambung.

## Capabilities and Constraints

- 6× DS18B20 satu bus OneWire di GPIO4 sebagai variabel suhu; threshold default ~30.0°C, hysteresis 1.0°C, durasi semprot maks 120 dtk, cooldown 60 dtk (dapat diubah, tersimpan di browser dan dikirim ke ESP32).
- Backend Firebase sebagai satu-satunya sumber data: Realtime Database (`devices/cow-sprinkler-01/...`) untuk telemetri 2 dtk, log 30 dtk, kontrol web-ke-ESP32, event, dan status; Hosting untuk deploy web statis. Login web pakai akun demo Email/Password; firmware pakai Database Secret (file .ino tidak disebar).
- Jadwal semprot harian (jam mulai WIB + lama menit) yang memaksa sprinkler nyala di mode otomatis; dieksekusi ESP32 berdasar jam NTP.
- Waktu dan log selalu zona Asia/Jakarta (WIB); log suhu tiap 30 dtk, maks 120 baris (1 jam), tersimpan di localStorage, bisa export CSV.
- UI Bahasa Indonesia. Web statis (HTML/CSS/JS tanpa build step), harus tetap bisa dibuka langsung dari `index.html` dan jalan offline kecuali fitur live Firebase (butuh internet + login akun demo).
- Batasan fisik: solenoid AC 220V via SSR + steker mitra — keselamatan tegangan tinggi tidak ditawar.
- Firebase sudah final sebagai backend deployment kandang. Penamaan/posisi fisik keenam titik ikut CONTEXT (depan, tengah, belakang); pemetaan ROM ke posisi via SCAN_ADDRESSES belum final.

## Brand Commitments

Nama: Smart Cow Sprinkler System. Bahasa: Indonesia. Satuan suhu °C, waktu WIB. Tidak ada logo, testimoni, atau klaim pelanggan — jangan difabrikasi.

## Evidence on Hand

Implementasi berjalan di `index.html` + `css/style.css` + `js/core.js` + `js/app.js` + `js/config.js` + `js/source.js` + `js/firebase.js` (contoh config di `js/firebase-config.example.js`, skrip uji di `package.json` via `npm test`, vektor keputusan di `test/decision-vectors.json`); firmware ESP32 di `firmware/smart-cow-sprinkler-firebase/smart-cow-sprinkler-firebase.ino`; wiring dan cara pakai di `README.md`. Belum ada data sensor nyata, foto kandang, atau hasil uji coba — semua angka saat ini dari simulasi.

## Product Principles

1. Keselamatan sapi dan manusia dulu: proteksi durasi, cooldown, dan kelistrikan di atas kenyamanan fitur.
2. Data jujur dan terbukti: setiap klaim semprotan harus bisa dilacak di grafik, log, dan event.
3. Kontrol peternak selalu menang: override manual harus satu ketuk dan tidak pernah terkunci oleh otomasi.
4. Jalan dulu, mewah belakangan: simulasi dan offline-first menjamin dashboard berguna sebelum hardware tersambung.
5. Satu bahasa satu zona waktu: Indonesia dan WIB di semua label, log, dan export agar tidak ada salah tafsir.

## Accessibility & Inclusion

Dipakai di kandang lewat HP, sering di bawah cahaya terang dan dengan satu tangan: angka suhu besar dan kontras, tombol kontrol besar, serta tetap terbaca di layar kecil. Standar formal belum ditetapkan.
