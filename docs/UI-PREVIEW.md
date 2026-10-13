# SmartCow — preview UI lokal

Konsep **Field Notes**: ivory/sage, navigasi hijau hutan, ilustrasi kandang orisinal (SVG lokal), kartu iklim, status sprinkler, titik sensor, dan pengaturan bernomor. Tersedia tema terang/gelap, drawer ponsel, riwayat sensor, dan aktivitas sprinkler.

Revisi keterbacaan: teks informasi utama 13–16 px, label ringkasan 16–17 px, serta kotak terpisah untuk label, nilai, status, min/max/ambang, dan keterangan. Layout ponsel mengalir ke baris baru alih-alih mengecilkan teks. Sapaan, nama akun, dan avatar otomatis mengikuti bagian email **sebelum `@`**, tanpa menyimpan profil tambahan atau mengubah Firebase. Bila email tidak tersedia, nama cadangannya **Pengelola**.

Revisi final: nama dalam sapaan tampil sebagai teks biasa tanpa highlight/kotak. Jam diperbesar menjadi 26 px di desktop dan 24 px di layar kecil.

UI v37: sidebar dimulai tertutup di semua ukuran layar. Tombol ☰ kiri atas membuka/menutupnya; desktop menggeser area konten, ponsel memakai drawer dengan overlay. Status relay dan mode operasi tampil sebelum ringkasan suhu/RH/THI. Rincian 6 DS dan 4 DHT tidak lagi memenuhi overview: buka **Lihat titik sensor** atau **Lihat titik kelembapan** pada kartu terkait. Popup tetap mengikuti telemetry/freshness, dapat ditutup dengan tombol ×, Escape, atau klik di luar, dan mengembalikan fokus ke tombol pembuka. Logout menutup popup serta membersihkan pembacaan.

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
- Belum login / gagal login / SDK gagal: hanya halaman masuk yang terlihat.
- Sesi login yang masih valid membuka dashboard otomatis. Untuk melihat landing login kembali, pilih **Keluar dari akun**.
- Saat keluar, data pada tampilan dibersihkan dan popup ditutup.
- Ini gerbang tampilan, bukan pengganti keamanan: autentikasi Firebase dan database rules tetap wajib.

## Cakupan revisi

Perubahan hanya pada UI web, preview lokal, dan allowlist aset untuk ilustrasi. Firmware, kredensial lokal, THI 6 DS + 4 RH, profil Suhu/THI, jadwal bersyarat, serta kebijakan relay tidak diubah.

UI v36 disetujui untuk publikasi pada 13 Oktober 2026. Target Hosting: **https://smartcow-de25f.web.app**; repo: **https://github.com/makhdanramadhan-ui/SmartCow**. Publikasi menggunakan `firebase deploy --only hosting --project smartcow-de25f`, bukan deployment database rules.

Revisi v37 (sidebar/popup/urutan kartu) juga disetujui untuk langsung push dan deploy. Arsip versi v36 sebelum revisi tersedia di folder backup yang sama: `smartcow-v36-sebelum-sidebar-popup-20261013-194636.zip`.

Backup sebelum revisi final/publikasi tersedia lokal di `F:\apaelah\TUGAS\smt5\IoT\web projek IoT_Backup\smartcow-sebelum-deploy-20261013-121706`: snapshot lengkap proyek dan arsip commit lama `dcf8657`. Snapshot lokal mengandung kredensial privat; jangan unggah folder backup.

## Tes lokal

```powershell
node --test test/core.test.js test/telemetry.test.js test/control.test.js test/preview.test.js
```

Tes preview memeriksa dashboard tersembunyi sejak HTML, ID elemen, ilustrasi mandiri, dan server lokal yang menolak akses ke firmware/konfigurasi privat serta request tulis. Tes THI dan kebijakan kontrol yang sudah ada tetap dipertahankan.
