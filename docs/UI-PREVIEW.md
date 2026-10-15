# SmartCow — Barn Console & preview lokal

UI terbaru **Barn Console (v40)**: neumorphism dengan permukaan abu kebiruan yang timbul, area pembacaan/input cekung, navigasi arang, dan aksen fungsional **jingga / suhu**, **biru / kelembapan**, **hijau / THI**. Panel relay dibuat kontras; ringkasan sistem menggantikan banner promosi besar. Label serta keterangan tidak lagi dibungkus kotak bertumpuk. Tersedia tema terang/gelap, drawer ponsel, riwayat sensor, aktivitas sprinkler, dan ilustrasi skema kandang orisinal (SVG lokal, bukan posisi sensor sebenarnya).

Teks dan kontrol tidak bergantung pada bayangan/warna saja: fokus keyboard terlihat, input mempunyai batas, status memakai teks, dan pilihan aktif memakai warna serta indikator radio. Mode forced-colors diberi batas/outline pengganti bayangan. Animasi sidebar/popup dan preferensi reduced motion tetap dipertahankan. Min/maks diberi label **Titik terendah / Titik tertinggi** dan keterangan pembacaan terkini, bukan rekor harian.

Catatan versi sebelumnya (**Field Notes v36–v39**):

Revisi keterbacaan: teks informasi utama 13–16 px, label ringkasan 16–17 px, serta kotak terpisah untuk label, nilai, status, min/max/ambang, dan keterangan. Layout ponsel mengalir ke baris baru alih-alih mengecilkan teks. Sapaan, nama akun, dan avatar otomatis mengikuti bagian email **sebelum `@`**, tanpa menyimpan profil tambahan atau mengubah Firebase. Bila email tidak tersedia, nama cadangannya **Pengelola**.

Revisi final: nama dalam sapaan tampil sebagai teks biasa tanpa highlight/kotak. Jam diperbesar menjadi 26 px di desktop dan 24 px di layar kecil.

UI v37: sidebar dimulai tertutup di semua ukuran layar. Tombol ☰ kiri atas membuka/menutupnya; desktop menggeser area konten, ponsel memakai drawer dengan overlay. Status relay dan mode operasi tampil sebelum ringkasan suhu/RH/THI. Rincian 6 DS dan 4 DHT tidak lagi memenuhi overview: buka **Lihat titik sensor** atau **Lihat titik kelembapan** pada kartu terkait. Popup tetap mengikuti telemetry/freshness, dapat ditutup dengan tombol ×, Escape, atau klik di luar, dan mengembalikan fokus ke tombol pembuka. Logout menutup popup serta membersihkan pembacaan.

UI v38: sidebar dan area konten bergerak/fade bersamaan, menu serta halaman masuk bertahap, dan popup sensor memakai fade/geser/scale saat dibuka maupun ditutup. Preferensi **reduced motion** menonaktifkan animasi. Menutup popup lewat logout/perubahan halaman tetap instan agar data privat tidak tertahan selama animasi.

UI v39: ringkasan hanya menampilkan ambang **dasar kontrol tersimpan** (Suhu atau THI), sesuai threshold pengguna. Dasar lain tetap menampilkan pembacaan untuk monitoring tanpa membandingkan ambang; detail DS juga memakai status/warna netral saat THI dipilih. Grafik hanya menggambar garis ambang bila metriknya sama dengan dasar kontrol tersimpan. Draft belum mengubah ringkasan/grafik; sebelum konfigurasi Firebase dimuat, kedua ambang disembunyikan. Kebijakan kontrol, tombol mode ketika ESP offline, dan firmware tidak berubah.

## Membuka preview

Dari folder proyek, jalankan:

```powershell
node scripts/preview.cjs
```

Buka **http://127.0.0.1:8765**. Hentikan dengan **Ctrl+C**. Tidak perlu deploy atau push. Server hanya melayani aset web yang diizinkan, bukan firmware atau kredensial lokal.

Gunakan akun Firebase Authentication yang biasa dipakai. Koneksi internet diperlukan untuk SDK/login. Bila Firebase melaporkan domain tidak diizinkan, periksa Authorized domains untuk `localhost` di Firebase Authentication lalu gunakan `http://localhost:8765`. Jangan matikan autentikasi atau melonggarkan database rules.

**Perhatian:** lokal hanya tampilan/hosting-nya. Setelah masuk, backend tetap Firebase asli. Menekan mode, kontrol manual, atau Simpan Pengaturan akan mengubah kontrol perangkat asli. Jangan gunakan tombol tersebut hanya untuk mencoba tampilan saat beban terhubung.

## Login terlebih dahulu

- Dashboard dimulai dalam keadaan `hidden` dan `inert` langsung di HTML; tidak ada kilatan dashboard sebelum sesi diperiksa.
- Form login juga dimulai `hidden inert`. Selama Firebase memulihkan sesi, hanya layar netral **Menyiapkan ruang kendali** yang terlihat, bukan landing login.
- Firebase memastikan tidak ada sesi: halaman masuk muncul. Sesi valid langsung masuk dashboard/halaman terakhir tanpa kilatan form login saat refresh.
- SDK/auth gagal atau pemeriksaan terlalu lama: layar netral memberi pesan/retry; dashboard tetap tersembunyi. Tidak ada flag login lokal yang dipakai untuk melewati autentikasi.
- Sesi login yang masih valid membuka dashboard otomatis. Untuk melihat landing login kembali, pilih **Keluar dari akun**.
- Saat keluar, data pada tampilan dibersihkan dan popup ditutup.
- Ini gerbang tampilan, bukan pengganti keamanan: autentikasi Firebase dan database rules tetap wajib.

## Cakupan revisi

Perubahan hanya pada UI web, preview lokal, dan allowlist aset untuk ilustrasi. Firmware, kredensial lokal, THI 6 DS + 4 RH, profil Suhu/THI, jadwal bersyarat, serta kebijakan relay tidak diubah.

UI v36 disetujui untuk publikasi pada 13 Oktober 2026. Target Hosting: **https://smartcow-de25f.web.app**; repo: **https://github.com/makhdanramadhan-ui/SmartCow**. Publikasi menggunakan `firebase deploy --only hosting --project smartcow-de25f`, bukan deployment database rules.

Revisi v37 (sidebar/popup/urutan kartu) juga disetujui untuk langsung push dan deploy. Arsip versi v36 sebelum revisi tersedia di folder backup yang sama: `smartcow-v36-sebelum-sidebar-popup-20261013-194636.zip`.

Revisi v38 (motion/pemulihan sesi tanpa login flash) disetujui untuk langsung push dan deploy. Arsip v37: `smartcow-v37-sebelum-motion-session-20261013-200840.zip`.

Revisi v39 (ambang hanya untuk dasar kontrol tersimpan) mengikuti persetujuan langsung push dan deploy. Arsip v38: `smartcow-v38-sebelum-ambang-terpilih-20261014-104938.zip`.

Revisi v40 (Barn Console / neumorphism) disetujui untuk langsung push dan deploy pada 15 Oktober 2026. Arsip v39 tersedia lokal: `smartcow-v39-sebelum-neumorphism-20261015-192844.zip`. Hanya HTML, CSS, warna grafik, ilustrasi, dokumentasi, dan tes UI yang berubah. Perhitungan THI, konfigurasi/profil tersimpan vs draft, kontrol manual/otomatis, Firebase Auth/RTDB, aturan database, dan firmware tidak diubah.

Backup sebelum revisi final/publikasi tersedia lokal di `F:\apaelah\TUGAS\smt5\IoT\web projek IoT_Backup\smartcow-sebelum-deploy-20261013-121706`: snapshot lengkap proyek dan arsip commit lama `dcf8657`. Snapshot lokal mengandung kredensial privat; jangan unggah folder backup.

## Tes lokal

```powershell
node --test test/core.test.js test/telemetry.test.js test/control.test.js test/preview.test.js test/ui-threshold.test.js
```

Tes preview memeriksa dashboard tersembunyi sejak HTML, ID elemen, ilustrasi mandiri/versioning, label snapshot, serta server lokal yang menolak akses ke firmware/konfigurasi privat dan request tulis. Tes UI ambang menjalankan fungsi render asli untuk memeriksa dasar tersimpan/draft, nilai pengguna, monitoring netral, data hilang, serta garis grafik. Tes THI dan kebijakan kontrol yang sudah ada tetap dipertahankan. QA browser memakai Firebase mock (tanpa kontrol produksi): 320–1920 px, tema terang/gelap, sidebar, popup sensor, refresh sesi, draft/save/failure/retry, serta pemeriksaan kontras teks utama minimum 4,5:1. Pemeriksaan SDK asli tidak login dan tidak menulis ke RTDB.
