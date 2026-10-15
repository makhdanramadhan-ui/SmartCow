# Admin & User — Kandang A (v45)

## Penggunaan

- Admin pertama yang disetujui: **akhdan@gmail.com**, memakai akun/password Firebase Auth yang sudah ada. Password tidak diubah oleh rilis ini.
- Buka **Dashboard Admin** dari avatar kanan atas atau menu sidebar kiri.
- Kartu **Akun saat ini:** di atas **Daftar Akun:** menunjukkan nama, email, role, dan status akun yang sedang login. Kartu ini hanya untuk informasi; tidak menyediakan pengubahan akun Admin.
- Pilih jenis akun **User / Admin**, lalu isi nama, email dan password awal minimal 8 karakter. User mendapat izin yang dipilih; Admin mendapat seluruh izin termasuk pengelolaan User dan pembuatan akun. Sampaikan password secara privat. Password tidak disimpan di RTDB, log aplikasi, ataupun penyimpanan browser oleh fitur Admin.
- Di panel **Daftar Akun:**, buka **Tindakan** pada kartu User untuk menampilkan izin, **Akses aktif**, **Simpan perubahan**, dan **Hapus akun**. Tidak ada lagi tombol kirim email reset.
- Hilangkan **Akses aktif**, lalu simpan untuk mencabut akses Kandang A tanpa menghapus pilihan izin. **Hapus akun** memakai dialog konfirmasi, menghapus record `/access/<uid>` dan menghilangkan User dari daftar SmartCow. Identitas Firebase Auth tetap ada; email tersebut tidak dapat dibuat ulang sebelum identitasnya dihapus melalui Firebase Console. Operasi hapus tidak pernah dijalankan tanpa konfirmasi.
- Akun Admin tidak memiliki tombol Tindakan dan tidak dapat diubah, dinonaktifkan, diturunkan role-nya atau dihapus oleh Admin lain maupun dirinya sendiri dari dashboard. Pengelola proyek menangani akun Admin melalui Firebase Console. Untuk penghapusan permanen, hapus identitas pada Authentication **dan** record `/access/<uid>` pada Realtime Database; menghapus Auth saja tidak otomatis membersihkan record akses.

| Izin | Yang diperbolehkan |
| --- | --- |
| Monitoring | Suhu, kelembapan, THI, status sprinkler, tren, riwayat, dan aktivitas |
| Pengaturan | Dasar kontrol, threshold, hysteresis, durasi maksimal, cooldown, dan jadwal; bukan ubah mode/manual ON/OFF |
| Operasi sprinkler | Ubah mode otomatis/manual dan manual ON/OFF; bukan ubah threshold/jadwal |

Pengaturan/Operasi menyertakan Monitoring agar pengguna dapat melihat keadaan kandang. User dengan ketiga izin **bukan Admin** dan tidak dapat membuat akun atau mengubah izin siapa pun. Admin memperoleh semua izin. Rilis ini mengelola **satu kandang, Kandang A**, bukan sistem multi-kandang.

**Pencabutan izin tidak mematikan sprinkler yang sudah menyala**, tidak membatalkan perintah yang telah diterima perangkat, dan tidak mengubah mode tersimpan. Admin harus mengoperasikan sprinkler secara eksplisit bila diperlukan. Pengaman online, kelengkapan sensor, firmware, jadwal, dan mode yang sudah ada tetap berlaku.

## Penegakan keamanan

Firebase Auth memeriksa identitas. RTDB `/access/<uid>` menyimpan role, enabled, dan tiga izin. Tidak ada allowlist email, flag Admin lokal, atau password Admin yang ditanam di aset web. UID Admin pertama dipasang oleh operator proyek melalui kanal terautentikasi, bukan saat login atau lewat pendaftaran pertama.

`database.rules.json` menolak akses secara default. Akun tanpa record/izin hanya dapat membaca record aksesnya sendiri. Admin aktif dapat membuat **User atau Admin baru**, serta mengubah/menghapus record **User**. Admin baru wajib aktif dengan ketiga izin bernilai true. Record Admin yang sudah ada tidak dapat diubah/dihapus dari browser, termasuk perubahan role atau izin. User yang sudah ada tidak dapat dipromosikan menjadi Admin lewat edit record. Email record lama tetap tidak dapat diganti. User tidak dapat menaikkan role atau mengubah izin. Pembatasan tersebut ditegakkan Rules, termasuk untuk panggilan API langsung. Pemeriksaan device dibatasi pada `cow-sprinkler-01`.

`control` tidak memiliki izin tulis induk. Izin tiap field memisahkan pengaturan dari `mode`/`manualSsr`; save pengaturan tidak menyertakan keduanya. Metadata pengubah memakai UID. Browser mana pun, termasuk Admin, tidak diizinkan menulis telemetry/status perangkat. Event web hanya append dengan skema terbatas; tidak boleh menimpa/menghapus log perangkat.

Listener izin berjalan realtime. Saat akses berubah, subscription data dibangun ulang; popup privat, pembacaan, riwayat, draft status, daftar Admin dan cache data dibersihkan. Halaman privat tidak dibuka sebelum Firebase memulihkan identitas **dan** record akses. Kegagalan pemeriksaan akses menutup fitur, bukan memberi izin sementara.

Pembuatan akun memakai Firebase Auth instance kedua dengan **inMemoryPersistence**, sehingga sesi Admin utama tidak terganti. Penulisan `/access` tetap melalui sesi Admin utama dan harus lolos Rules. Jika pemberian izin gagal, aplikasi mencoba menghapus akun baru; jika cleanup gagal, ditampilkan UID untuk pemulihan operator. SDK publik tidak mengizinkan pencarian UID akun orang lain berdasarkan email: email yang sudah terdaftar tidak dibuat ulang; operator proyek perlu memverifikasi UID di Firebase Console dan menambahkan record User yang benar.

### Batasan yang perlu diketahui

- Tidak memakai Cloud Functions/billing. **Tidak ada formulir registrasi publik**, tetapi Email/Password Firebase Auth secara teknis tetap memiliki API pendaftaran. Pihak luar bisa membuat identitas Auth lewat API publik; identitas itu **tidak mendapat akses Kandang A atau hak Admin** karena tidak punya record izin. Untuk mencegah pembuatan identitas Auth itu sendiri diperlukan layanan backend/Identity Platform yang diotorisasi terpisah. Jangan menyatakan signup API telah ditutup.
- **Akses aktif** dan **Hapus akun** hanya mengelola akses aplikasi/database, bukan men-disable atau menghapus identitas Firebase Auth. Penghapusan permanen dan rotasi password oleh operator dilakukan melalui Firebase Console/kanal operator yang aman. Tidak ada backend administratif atau billing yang ditambahkan.
- Akun lama selain Admin pertama tidak otomatis diwarisi izin. Misalnya `kelompok4@gmail.com` akan melihat pemberitahuan belum mendapat akses sampai operator menyediakan record izin yang terverifikasi.
- Firmware saat ini memakai **Database Secret** (hak administratif yang melewati Rules). Rilis ini tidak mengganti kredensial/perilaku firmware; Rules baru tetap kompatibel dengan kanal itu, tetapi Secret yang bocor dapat melewati izin User. Rotasi Secret/kredensial yang pernah terekspos dan migrasi autentikasi perangkat tetap pekerjaan hardening tersendiri.
- Pembatasan izin tidak bisa menghapus data yang sudah pernah disalin pengguna. Cache lokal aplikasi dibersihkan ketika sesi/izin berubah; jangan gunakan komputer bersama tanpa logout.

## Pengujian & rilis

Tes tanpa dependensi tambahan dari root:

```sh
node --test test/core.test.js test/telemetry.test.js test/control.test.js test/preview.test.js test/ui-threshold.test.js test/access.test.js
node scripts/build-rules.cjs --check
```

Tes Rules lokal (Node.js modern, Java dan Firebase CLI terpasang; port 9000/9099 kosong):

```sh
cd test/rbac
npm ci
npm test
```

Konfigurasi emulator berada di `firebase.emulators.json`, proyek **demo-smartcow-access**. Jangan mengganti test project menjadi proyek produksi. 201 pemeriksaan mencakup izin field, akun unknown/disabled, eskalasi role, pembuatan Admin, perlindungan Admin, penghapusan akses User, perubahan izin, telemetry palsu, validasi, dan Auth instance terpisah. QA browser tambahan menguji bridge SDK asli terhadap emulator Auth/RTDB: membuat User/Admin, sesi Admin utama tetap, simpan izin, hapus Admin ditolak, hapus akses User tetapi identitas/email Auth tetap, serta pencabutan realtime/persisted session. QA UI menggunakan Firebase mock; tidak ada tes akun atau ON/OFF perangkat produksi.

Catatan dependensi pengujian v44: `npm audit` melaporkan lima entri high yang berakar pada `@grpc/grpc-js` transitif paket Firestore dalam SDK pengujian. Tes ini hanya memakai Auth/RTDB lokal; paket npm pengujian, Firestore, dan gRPC tidak diterbitkan ke Hosting. Perbaikan otomatis yang disarankan berupa downgrade major tidak diterapkan pada rilis UI/akses ini; pembaruan dependensi pengujian tetap menjadi tindak lanjut terpisah.

Rules dihasilkan deterministik oleh `node scripts/build-rules.cjs`. Jangan menyunting hasil tanpa memperbarui generator dan menjalankan tes. Rilis membutuhkan **Hosting dan Database Rules**, tidak hanya Hosting. Bootstrap Admin yang disetujui harus selesai sebelum Rules dibatasi. Backup privat menyimpan Rules/access sebelumnya; arsip sumber sebelum v42: `smartcow-v41-sebelum-admin-user-20261015-222747.zip`.
