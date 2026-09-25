# Smart Cow Sprinkler

Glosarium domain kandang sapi. Istilah implementasi (path database, nama fungsi) tidak masuk sini.

## Language

**Titik suhu**:
Enam lokasi ukur suhu kandang (depan, tengah, belakang).
_Avoid_: sensor, probe, channel

**Rata-rata kandang**:
Rata-rata enam titik suhu, satu-satunya angka yang menggerakkan sprinkler.
_Avoid_: average, mean

**Threshold**:
Batas rata-rata kandang yang menyalakan semprotan.
_Avoid_: ambang (di UI), setpoint, target

**Hysteresis**:
Selisih di bawah threshold untuk mematikan semprotan, pencegah relay hidup-mati cepat.
_Avoid_: deadband, toleransi

**Cooldown**:
Jeda wajib antar dua semprotan agar kandang tidak becek dan air hemat.
_Avoid_: delay, jeda acak

**Jadwal semprot**:
Jam mulai dan lama semprotan harian yang memaksa sprinkler nyala di mode otomatis.
_Avoid_: timer, scheduler

**Override manual**:
Perintah langsung peternak yang mengalahkan mode otomatis.
_Avoid_: bypass, force

**Event**:
Catatan tiap perubahan sprinkler (nyala, mati, proteksi) sebagai bukti kerja.
_Avoid_: notifikasi, alarm
