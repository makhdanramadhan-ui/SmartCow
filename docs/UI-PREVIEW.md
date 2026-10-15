# SmartCow — Barn Console & preview lokal

UI terbaru **Barn Console (v45)**: neumorphism dengan permukaan abu kebiruan yang timbul, area pembacaan/input cekung, navigasi arang, dan aksen fungsional **jingga / suhu**, **biru / kelembapan**, **hijau / THI**. Panel sprinkler mengikuti tema terang/gelap; banner cukup **Kandang A** dan sapaan cukup **Halo, Akhdan.** (nama mengikuti email dengan huruf awal kapital). Label GPIO, inventaris perangkat di banner, Sistem/01, tautan sensor di banner, selector kandang/perangkat di sidebar, serta blok perangkat sidebar dihapus. Jam, detail sensor dari kartu, tema terang/gelap, drawer, dan ilustrasi skema kandang tetap tersedia.

v45 menambahkan kartu **Akun saat ini:** tepat di atas **Daftar Akun:** pada kolom kanan Dashboard Admin. Kartu hanya-baca berisi inisial, nama (cadangan dari email bila nama kosong), email, role, dan status akses dari record sesi yang sedang aktif, bukan akun pertama dalam daftar. Data kartu dibersihkan ketika izin Admin dicabut atau logout. Kolom kartu mengikuti tema terang/gelap dan menumpuk di bawah form pada layar kecil. Akun yang sedang login tetap ada di direktori; pengelolaan akun, bridge Firebase, Rules, dan kontrol sprinkler tidak berubah.

v44 menyelesaikan **Dashboard Admin**: pilihan pembuatan **User / Admin**, satu kartu induk **Daftar Akun:**, kartu akun ringkas, serta tombol **Tindakan** untuk membuka izin/aktivasi/simpan/hapus User. Tombol kirim email reset dihapus. Admin baru mendapat seluruh izin; Admin yang sudah ada tidak dapat diedit, diturunkan role-nya, dinonaktifkan, atau dihapus melalui dashboard, dengan perlindungan independen pada Rules. **Hapus akun** mencabut akses dan menghilangkan User dari daftar SmartCow setelah konfirmasi; identitas Firebase Auth tetap ada. Penghapusan permanen dilakukan operator melalui Firebase Console, tanpa backend/billing tambahan. Kartu **Sprinkler kandang** kini terang dalam light mode dan tetap kontras pada dark mode.

v43 merapikan **Dashboard Admin**: form identitas dengan input cekung, pilihan izin berbentuk kartu, daftar akun terpisah dengan inisial/nama/email/role/status, jumlah akun, serta sakelar akses. Izin dalam kartu akun berjajar tiga bila lebar direktori mencukupi; panel sempit menumpuk tanpa mengecilkan teks. Tombol ponsel selebar area kartu. Pesan proses/hasil berada di area status tersendiri yang hanya tampil pada halaman Admin. Tidak ada font, ikon, library, atau gambar eksternal tambahan. Autentikasi, aturan akses, dan operasi Firebase tidak berubah.

v42 menambahkan **Dashboard Admin** melalui avatar kanan atas maupun sidebar. Admin pertama yang disetujui **akhdan@gmail.com** dapat membuat User, memilih izin Monitoring/Pengaturan/Operasi sprinkler, menonaktifkan akses dan mengirim email reset. Izin ditegakkan oleh Firebase Rules, bukan hanya tombol tersembunyi. Pemulihan sesi menunggu record izin; akun lama lain tidak otomatis mendapat akses. Lihat [ADMIN-USER.md](ADMIN-USER.md) untuk penggunaan, batasan, emulator, bootstrap, dan penegakan keamanan.

Layout v41: **Konfigurasi sprinkler di atas, Tren sensor di bawah**, keduanya memakai satu kolom selebar konten dengan tepi kiri/kanan sejajar. Kartu dibuat persegi panjang dengan sudut 14 px, tanpa memaksa tinggi yang sama atau memotong isi. Tiga kelompok konfigurasi tersusun horizontal jika lebar isi panel ≥1000 px. Pada ≥680 px, dua kelompok pilihan berdampingan dan empat input ambang/proteksi sejajar di baris berikutnya; panel lebih sempit mengalir ke bawah. Container query mengikuti lebar panel sebenarnya saat sidebar dibuka, bukan hanya viewport. Jadwal dibuat dua kolom pada panel lebar, satu kolom pada panel kecil. Peringatan/status dan daftar jadwal berada di bawah header/kelompok kontrol dengan lebar penuh; tombol Simpan berada di footer panel. Urutan DOM/Tab mengikuti urutan visual dan tidak mengubah perilaku pengaturan.

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

v36–v41 membatasi perubahan pada UI/preview/allowlist aset. v42 juga mengubah bridge Firebase serta Rules untuk role/izin, tanpa mengganti firmware, kredensial lokal, rumus THI 6 DS + 4 RH, profil Suhu/THI, jadwal bersyarat, atau kebijakan relay. Simpan pengaturan kini tidak menyertakan mode/manual output, sehingga izin Pengaturan tidak mendapat izin Operasi secara tidak sengaja. v44 memperbarui UI, bridge akun, dan Rules untuk pembuatan Admin dan penghapusan akses User; alur sensor, pengaturan, dan operasi sprinkler tidak diubah.

UI v36 disetujui untuk publikasi pada 13 Oktober 2026. Target Hosting: **https://smartcow-de25f.web.app**; repo: **https://github.com/makhdanramadhan-ui/SmartCow**. Publikasi menggunakan `firebase deploy --only hosting --project smartcow-de25f`, bukan deployment database rules.

Revisi v37 (sidebar/popup/urutan kartu) juga disetujui untuk langsung push dan deploy. Arsip versi v36 sebelum revisi tersedia di folder backup yang sama: `smartcow-v36-sebelum-sidebar-popup-20261013-194636.zip`.

Revisi v38 (motion/pemulihan sesi tanpa login flash) disetujui untuk langsung push dan deploy. Arsip v37: `smartcow-v37-sebelum-motion-session-20261013-200840.zip`.

Revisi v39 (ambang hanya untuk dasar kontrol tersimpan) mengikuti persetujuan langsung push dan deploy. Arsip v38: `smartcow-v38-sebelum-ambang-terpilih-20261014-104938.zip`.

Revisi v40 (Barn Console / neumorphism) disetujui untuk langsung push dan deploy pada 15 Oktober 2026. Arsip v39 tersedia lokal: `smartcow-v39-sebelum-neumorphism-20261015-192844.zip`. Hanya HTML, CSS, warna grafik, ilustrasi, dokumentasi, dan tes UI yang berubah. Perhitungan THI, konfigurasi/profil tersimpan vs draft, kontrol manual/otomatis, Firebase Auth/RTDB, aturan database, dan firmware tidak diubah.

Revisi v41 (konfigurasi horizontal, grafik di bawah dengan lebar sama) mengikuti persetujuan langsung push/deploy. Arsip v40: `smartcow-v40-sebelum-layout-horizontal-20261015-201523.zip`. Perubahan hanya HTML/CSS, dokumentasi, dan tes layout; seluruh JavaScript dan firmware tetap identik dengan v40. QA: 70 tes otomatis, 54 kondisi layout 320–1920 px/sidebar/tema, enam jadwal, picker tanggal/jam, peringatan firmware lama, draft/save/gagal/retry, navigasi/fokus, autentikasi/motion, THI, dan ambang terpilih. Pengujian interaktif memakai Firebase mock tanpa menulis kontrol produksi.

Revisi v42 (copy sederhana dan Admin/User) mengikuti permintaan push/deploy. Arsip v41: `smartcow-v41-sebelum-admin-user-20261015-222747.zip`; Rules produksi lama juga dibackup privat. QA: 75 tes otomatis, 160 pemeriksaan emulator Rules/Auth, alur SDK asli terhadap emulator lokal, 18 layout Admin terang/gelap, regresi 54 kondisi konfigurasi/sidebar, dan regresi THI/ambang/motion. Rilis ini menerbitkan Hosting **dan Database Rules** setelah bootstrap UID Admin yang disetujui. Hanya 12 aset runtime yang diterbitkan; docs, tes, rules, dan firmware tidak masuk Hosting.

Revisi v43 (Admin neumorphism) mempertahankan semua fungsi v42 dan rumus THI pada baris tersendiri. Arsip sebelum revisi: `smartcow-v42-sebelum-admin-neumorphism-20261016-000308.zip`. QA: 76 tes otomatis; regresi alur Admin/User (buat akun, izin, aktivasi, reset, revokasi, teks aman, pemisahan izin); 44 kombinasi layout Admin 320–1920 px/tema/sidebar; regresi 54 kondisi konfigurasi/grafik/jadwal; 114 pemeriksaan kontras teks ≥4,5:1; keyboard, forced colors, pesan gagal, nama/email panjang, daftar kosong, dan penghitung akun. Pengujian interaktif seluruhnya memakai backend tiruan, tanpa akun atau kontrol produksi. Rilis hanya **Hosting**; Firebase bridge, Rules, firmware, dan kredensial lokal tidak diubah. Hanya CSS dan skrip Admin mendapat versi aset baru `v=43`; aset yang tidak berubah tetap pada versi sebelumnya.

Revisi v44 mengikuti persetujuan menyelesaikan web **tanpa billing**. Arsip sebelum revisi: `smartcow-v43-sebelum-daftar-akun-role-20261016-005113.zip`. QA: 78 tes otomatis, 201 pemeriksaan emulator Rules/Auth, alur bridge SDK asli terhadap emulator lokal (pembuatan User/Admin, sesi utama tidak berganti, simpan izin, perlindungan Admin, hapus akses User tanpa menghapus Auth, pemulihan sesi/revokasi), 80 kondisi layout Admin/tema/sidebar/Tindakan, 54 kondisi regresi konfigurasi/grafik/jadwal, dan 126 pemeriksaan kontras teks ≥4,5:1. Seluruh pengujian akun/kontrol menggunakan mock atau emulator; tidak ada akun ataupun operasi hardware produksi yang diubah. Rilis menerbitkan **Hosting dan Database Rules**, bukan Functions. Hanya 12 aset runtime masuk Hosting; versi CSS, access.js, firebase.js, dan admin.js menjadi `v=44`.

Revisi v45 (kartu akun saat ini) dibackup sebelum perubahan pada `smartcow-v44-sebelum-akun-saat-ini-20261016-013550.zip`. QA: 79 tes otomatis; identitas sesi berbeda dari Admin pertama dalam direktori, pergantian Admin, nama kosong, teks berbahaya tetap plain text, pembersihan saat revokasi/logout; 46 kondisi layout tema/sidebar/nama-email panjang/forced colors; 12 pemeriksaan kontras teks kartu ≥4,5:1; serta regresi alur akun v44 pada 80 kondisi layout. Pengujian akun memakai Firebase mock tanpa penulisan produksi. Rilis hanya **Hosting**; CSS dan admin.js memakai `v=45`, access.js/firebase.js tetap `v=44`, aset lain tidak berubah. Firmware dan kredensial lokal dipertahankan.

Backup sebelum revisi final/publikasi tersedia lokal di `F:\apaelah\TUGAS\smt5\IoT\web projek IoT_Backup\smartcow-sebelum-deploy-20261013-121706`: snapshot lengkap proyek dan arsip commit lama `dcf8657`. Snapshot lokal mengandung kredensial privat; jangan unggah folder backup.

## Tes lokal

```powershell
node --test test/core.test.js test/telemetry.test.js test/control.test.js test/preview.test.js test/ui-threshold.test.js test/access.test.js
```

Tes preview memeriksa dashboard tersembunyi sejak HTML, ID elemen, ilustrasi mandiri/versioning, label snapshot, serta server lokal yang menolak akses ke firmware/konfigurasi privat dan request tulis. Tes UI ambang menjalankan fungsi render asli untuk memeriksa dasar tersimpan/draft, nilai pengguna, monitoring netral, data hilang, serta garis grafik. Tes THI dan kebijakan kontrol yang sudah ada tetap dipertahankan. QA browser memakai Firebase mock (tanpa kontrol produksi): 320–1920 px, tema terang/gelap, sidebar, popup sensor, refresh sesi, draft/save/failure/retry, serta pemeriksaan kontras teks utama minimum 4,5:1. Smoke SDK terhadap produksi tidak login/tulis; pengujian interaktif SDK hanya memakai proyek demo pada emulator Auth/RTDB.
