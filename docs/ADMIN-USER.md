# Admin & User — Kandang A (v42)

## Penggunaan

- Admin pertama yang disetujui: **akhdan@gmail.com**, memakai akun/password Firebase Auth yang sudah ada. Password tidak diubah oleh rilis ini.
- Buka **Dashboard Admin** dari avatar kanan atas atau menu sidebar kiri.
- Buat akun User dengan nama, email, password awal minimal 8 karakter, dan izin yang diperlukan. Sampaikan password secara privat; tombol **Kirim email reset** memberi User cara menggantinya. Password tidak disimpan di RTDB, log aplikasi, ataupun penyimpanan browser oleh fitur Admin.
- Centang izin, lalu klik **Simpan izin**. Hilangkan **Akses aktif** untuk mencabut seluruh akses Kandang A tanpa menghapus akun Auth. Pilihan izin tetap tersimpan saat dinonaktifkan.

| Izin | Yang diperbolehkan |
| --- | --- |
| Monitoring | Suhu, kelembapan, THI, status sprinkler, tren, riwayat, dan aktivitas |
| Pengaturan | Dasar kontrol, threshold, hysteresis, durasi maksimal, cooldown, dan jadwal; bukan ubah mode/manual ON/OFF |
| Operasi sprinkler | Ubah mode otomatis/manual dan manual ON/OFF; bukan ubah threshold/jadwal |

Pengaturan/Operasi menyertakan Monitoring agar pengguna dapat melihat keadaan kandang. User dengan ketiga izin **bukan Admin** dan tidak dapat membuat akun atau mengubah izin siapa pun. Admin memperoleh semua izin. Rilis ini mengelola **satu kandang, Kandang A**, bukan sistem multi-kandang.

**Pencabutan izin tidak mematikan sprinkler yang sudah menyala**, tidak membatalkan perintah yang telah diterima perangkat, dan tidak mengubah mode tersimpan. Admin harus mengoperasikan sprinkler secara eksplisit bila diperlukan. Pengaman online, kelengkapan sensor, firmware, jadwal, dan mode yang sudah ada tetap berlaku.

## Penegakan keamanan

Firebase Auth memeriksa identitas. RTDB `/access/<uid>` menyimpan role, enabled, dan tiga izin. Tidak ada allowlist email, flag Admin lokal, atau password Admin yang ditanam di aset web. UID Admin pertama dipasang oleh operator proyek melalui kanal terautentikasi, bukan saat login atau lewat pendaftaran pertama.

`database.rules.json` menolak akses secara default. Akun tanpa record/izin hanya dapat membaca record aksesnya sendiri. Admin dapat membaca daftar akses dan membuat/mengubah **User**, tidak dapat mengubah record Admin sendiri, menambahkan Admin lain, menghapus record akses, atau mengganti email record lama. User tidak dapat menaikkan role atau mengubah izin. Pemeriksaan device dibatasi pada `cow-sprinkler-01`.

`control` tidak memiliki izin tulis induk. Izin tiap field memisahkan pengaturan dari `mode`/`manualSsr`; save pengaturan tidak menyertakan keduanya. Metadata pengubah memakai UID. Browser mana pun, termasuk Admin, tidak diizinkan menulis telemetry/status perangkat. Event web hanya append dengan skema terbatas; tidak boleh menimpa/menghapus log perangkat.

Listener izin berjalan realtime. Saat akses berubah, subscription data dibangun ulang; popup privat, pembacaan, riwayat, draft status, daftar Admin dan cache data dibersihkan. Halaman privat tidak dibuka sebelum Firebase memulihkan identitas **dan** record akses. Kegagalan pemeriksaan akses menutup fitur, bukan memberi izin sementara.

Pembuatan akun memakai Firebase Auth instance kedua dengan **inMemoryPersistence**, sehingga sesi Admin utama tidak terganti. Penulisan `/access` tetap melalui sesi Admin utama dan harus lolos Rules. Jika pemberian izin gagal, aplikasi mencoba menghapus akun baru; jika cleanup gagal, ditampilkan UID untuk pemulihan operator. SDK publik tidak mengizinkan pencarian UID akun orang lain berdasarkan email: email yang sudah terdaftar tidak dibuat ulang; operator proyek perlu memverifikasi UID di Firebase Console dan menambahkan record User yang benar.

### Batasan yang perlu diketahui

- Tidak memakai Cloud Functions/billing. **Tidak ada formulir registrasi publik**, tetapi Email/Password Firebase Auth secara teknis tetap memiliki API pendaftaran. Pihak luar bisa membuat identitas Auth lewat API publik; identitas itu **tidak mendapat akses Kandang A atau hak Admin** karena tidak punya record izin. Untuk mencegah pembuatan identitas Auth itu sendiri diperlukan layanan backend/Identity Platform yang diotorisasi terpisah. Jangan menyatakan signup API telah ditutup.
- **Akses aktif** adalah pencabutan akses aplikasi/database, bukan men-disable atau menghapus identitas Firebase Auth. Penghapusan permanen, rotasi password oleh operator, dan penambahan Admin lain dilakukan melalui Firebase Console/kanal operator yang aman.
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

Konfigurasi emulator berada di `firebase.emulators.json`, proyek **demo-smartcow-access**. Jangan mengganti test project menjadi proyek produksi. 160 pemeriksaan mencakup izin field, akun unknown/disabled, eskalasi role, perubahan izin, telemetry palsu, validasi, dan Auth instance terpisah. QA browser tambahan menguji SDK asli terhadap emulator Auth/RTDB: create/duplicate, login User, save settings tanpa mode, serta pencabutan realtime/persisted session. QA UI menggunakan Firebase mock; tidak ada tes ON/OFF perangkat produksi.

Rules dihasilkan deterministik oleh `node scripts/build-rules.cjs`. Jangan menyunting hasil tanpa memperbarui generator dan menjalankan tes. Rilis membutuhkan **Hosting dan Database Rules**, tidak hanya Hosting. Bootstrap Admin yang disetujui harus selesai sebelum Rules dibatasi. Backup privat menyimpan Rules/access sebelumnya; arsip sumber sebelum v42: `smartcow-v41-sebelum-admin-user-20261015-222747.zip`.
