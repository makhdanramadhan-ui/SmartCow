# RTDB + REST-secret untuk telemetri ESP32

Pakai Realtime Database (bukan Firestore): telemetri 2 detik (43.200 tulis/hari) jebol kuota tulis gratis Firestore (20K/hari), sementara RTDB ditagih bandwidth dan hitungan kasar ±11 MB/hari masih jauh di bawah batas Spark.

Firmware bicara ke RTDB via REST + Database Secret (bukan SDK FirebaseClient): nol library baru selain OneWire/DallasTemperature sehingga pasti compile di Arduino IDE, dan logika relay tetap jalan walau jaringan putus. Konsekuensi: secret setara akses penuh, jadi file .ino tidak boleh disebar dan rules tetap dikunci (auth untuk klien web).

## Considered Options

- Firestore: ditolak karena kuota tulis gratis.
- FirebaseClient + UserAuth: ditolak untuk firmware utama karena risiko API dan heap TLS; tetap jadi opsi lanjutan di docs.
