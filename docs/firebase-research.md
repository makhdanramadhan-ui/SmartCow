# Riset Firebase — Smart Cow Sprinkler System

> Sumber HANYA primer (docs Firebase, repo resmi mobizt, npm/jsdelivr). Setiap klaim penting disertai URL. Diakses 25 Sep 2026. Versi SDK yang terlihat saat riset: **12.19.0**.

## Ringkasan keputusan

1. **Hosting → cocok** untuk dashboard statis (HTML/CSS/JS tanpa build). Deploy via `firebase-tools`, config `firebase.json` + `.firebaserc`.
2. **Database → pilih Realtime Database (RTDB)**, bukan Firestore. Alasan: telemetri tiap 2 detik = ~43.200 tulis/hari melampaui kuota tulis gratis Firestore (20K/hari), sedangkan RTDB ditagih bandwidth+storage dan library Arduino-nya paling matang untuk stream 2 arah.
3. **Web statis tanpa bundler → pakai Modular SDK via CDN `type="module"`** dari `gstatic`, bukan compat (compat hanya sementara untuk migrasi).
4. **ESP32 → pakai `mobizt/FirebaseClient`** (pengganti `Firebase-ESP-Client` yang deprecated). Kalau mentok memori/TLS, fallback ke **REST API RTDB** (`PUT/PATCH/POST/GET + .json`).
5. **Rules → jangan pernah `".read": true, ".write": true` global.** Contoh aman di §4.

---

## 1. Firebase Hosting untuk situs statis

### Cara deploy (firebase-tools)

Alur resmi: install CLI → login → init → deploy (https://firebase.google.com/docs/hosting/quickstart, https://firebase.google.com/docs/cli):

```bash
npm install -g firebase-tools   # butuh Node.js v18+
firebase login
firebase init hosting           # jawab: pilih project, direktori public, one-page-app?
firebase deploy --only hosting  # hanya hosting; tambah ,functions dsb. bila perlu
```

Detail yang diverifikasi dari docs:

- `firebase init hosting` meminta: project Firebase default, **direktori public root** (default `public`; untuk repo ini bisa `public` berisi salinan `index.html`+`css/`+`js/`), dan opsi one-page-app (rewrite otomatis) (https://firebase.google.com/docs/hosting/quickstart).
- Perintah deploy mengunggah ke subdomain gratis `PROJECT_ID.web.app` dan `PROJECT_ID.firebaseapp.com`, sudah SSL/CDN global (https://firebase.google.com/docs/hosting/quickstart).
- Uji lokal: `firebase serve` / `firebase emulators:start` sebelum deploy (disebut di quickstart sebagai "test locally") (https://firebase.google.com/docs/hosting/quickstart).

### File config yang dibutuhkan

- **`firebase.json`** — wajib; bagian `hosting.public` satu-satunya atribut wajib, plus `hosting.ignore` default (`firebase.json`, `**/.*`, `**/node_modules/**`). Dibuat otomatis oleh `firebase init`; menjalankan init ulang akan me-reset bagian hosting ke default (https://firebase.google.com/docs/hosting/full-config, https://firebase.google.com/docs/hosting/quickstart).
- **`.firebaserc`** — menyimpan alias project default (dibuat otomatis saat init) (https://firebase.google.com/docs/hosting/quickstart).
- Contoh minimal untuk projek ini:

```json
{
  "hosting": {
    "public": "public",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"]
  }
}
```

### Batas gratis Spark plan (Hosting)

Dari halaman pricing resmi (https://firebase.google.com/pricing):

| Kuota Spark | Nilai |
|---|---|
| Storage Hosting | 10 GB |
| Transfer data | 360 MB/hari |
| Custom domain + SSL, multiple sites | termasuk |

Implikasi: dashboard statis (± ratusan KB) + traffic demo kelas sangat aman. Yang perlu diwaspadai justru **bandwidth RTDB** (§2), bukan Hosting.

---

## 2. RTDB vs Firestore untuk telemetri ESP32

### Rekomendasi resmi Firebase

- Firebase merekomendasikan **Cloud Firestore untuk pelanggan baru** dengan model data kaya/butuh query kompleks; **RTDB untuk model JSON sederhana yang butuh sinkronisasi state low-latency** (https://firebase.google.com/docs/database/rtdb-vs-firestore).
- Perbandingan resmi: RTDB = satu JSON tree besar, query dalam (deep) tapi filter/sort terbatas; Firestore = koleksi-dokumen, query indexed + compound, scaling otomatis tanpa sharding; RTDB scaling butuh sharding di ~200K koneksi & ~1.000 tulis/detik; **presence hanya didukung native oleh RTDB** (berguna untuk status online ESP32) (https://firebase.google.com/docs/database/rtdb-vs-firestore).
- Penagihan: **Firestore ditagih per operasi** (read/write/delete) + bandwidth/storage; **RTDB hanya ditagih bandwidth + storage** (dengan tarif lebih tinggi) (https://firebase.google.com/docs/database/rtdb-vs-firestore, https://firebase.google.com/docs/database/usage/billing).

### Library Arduino yang matang

- Repo lama **`mobizt/Firebase-ESP-Client` SUDAH DEPRECATED / end-of-life**, README-nya memerintahkan pindah ke **`mobizt/FirebaseClient`** (https://github.com/mobizt/Firebase-ESP-Client).
- Pengganti **`mobizt/FirebaseClient`**: library async REST yang mencakup **RTDB, Firestore, Cloud Messaging, Storage, Cloud Functions, Cloud Storage, Rules Management** dalam satu tempat; contoh bare-minimum + wrapper tersedia (https://github.com/mobizt/FirebaseClient).
- Opsi build per layanan via makro: `ENABLE_DATABASE`, `ENABLE_FIRESTORE`, `ENABLE_MESSAGING`, dst.; wajib didefinisikan sebelum include sejak v2.1.0 (https://github.com/mobizt/FirebaseClient).
- Auth yang didukung: **ServiceAuth** (service account → token OAuth2, akses privileged), **CustomAuth/UserAuth** (email/password, butuh Auth + Web API Key), token langsung (**custom/ID/access/refresh token**), dan **legacy token / database secret** (akses privileged gaya lama, kini deprecated) (https://github.com/mobizt/FirebaseClient).
- **Batasan penting REST-based client**: "Firestore data change listening dan RTDB disconnected event TIDAK didukung oleh Firebase REST API" — jadi untuk kontrol 2 arah, ESP32 harus **polling/GET berkala atau SSE**, bukan listener native (https://github.com/mobizt/FirebaseClient).
- Perangkat didukung: ESP8266/ESP32 dan MCU 32-bit lain (bukan AVR); instal via Library Manager `"FirebaseClient"` atau `pio lib install "FirebaseClient"` (https://github.com/mobizt/FirebaseClient).

### Hitungan kasar untuk update 2 detik + kontrol 2 arah

- 1 kirim / 2 detik = **43.200 tulis/hari per perangkat**.
- **Firestore Spark: 20K writes/hari, 50K reads/hari, 20K deletes/hari, storage 1 GiB, egress 10 GiB/bulan** (https://firebase.google.com/pricing) → **satu ESP32 saja sudah jebol kuota tulis gratis**.
- **RTDB Spark: 100 koneksi simultan, storage 1 GB, download 10 GB/bulan (~360 MB/hari)** (https://firebase.google.com/pricing, https://firebase.google.com/docs/database/usage/billing).
- Estimasi payload `latest` (±250 byte JSON: 6 suhu + avg + ssr + mode + ts): 43.200 × 250 B ≈ **±11 MB/hari upload**; download web (1 listener, 2-detik push) seorde sama + overhead WS/TLS (overhead handshake ~3,5 KB + header per pesan dijelaskan di billing) (https://firebase.google.com/docs/database/usage/billing) → **masih jauh di bawah 360 MB/hari**.
- **Kesimpulan: pakai RTDB.** Satu koneksi stream persisten untuk `latest` (ESP32 tulis, web listen) + satu listener `control` di ESP32 (polling/SSE tiap 2–5 detik). Batas tulis 1.000/detik dan koneksi 100 (Spark) / 200K (Blaze) tidak jadi masalah untuk demo 1 kandang (https://firebase.google.com/docs/database/usage/limits).

### Batas teknis RTDB lain yang relevan

Dari (https://firebase.google.com/docs/database/usage/limits): kedalaman node maks 32, panjang key 768 byte, string maks 10 MB, **single write 256 MB via REST / 16 MB via SDK**, respons baca tunggal 256 MB, query tunggal maks 15 menit. Praktik billing: pakai SDK/native connection (bukan REST pendek berulang) untuk menekan overhead TLS; pakai `shallow`/query terbatas; listener sedalam mungkin di path yang dibutuhkan (https://firebase.google.com/docs/database/usage/billing).

---

## 3. Firebase JS SDK untuk web statis tanpa bundler

### Opsi: modular (disarankan) vs compat (sementara)

- Halaman setup resmi: **modular API sangat disarankan, terutama produksi**; pola `npm install firebase` + `import { initializeApp } from 'firebase/app'` + tree-shaking via bundler (https://firebase.google.com/docs/web/setup).
- Untuk kebutuhan tanpa bundler (kasus repo ini: HTML/CSS/JS mentah), halaman **alternative setup** meresmikan impor browser-module langsung dari CDN (https://firebase.google.com/docs/web/alt-setup):

```html
<script type="module">
  import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
  import { getDatabase, ref, onValue, set, push, update, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
  const app = initializeApp({ /* firebaseConfig */ });
</script>
```

- **Compat** (`firebase/compat/app` dst., atau `firebase-app-compat.js`) adalah API namespaced gaya v8 agar kode lama tetap jalan berdampingan saat migrasi; docs menyebutnya **solusi sementara yang akan dihapus di major mendatang (mis. v10/v11)** — proyek baru wajib modular (https://firebase.google.com/docs/web/modular-upgrade).
- Versi stabil saat riset: **`12.19.0`** — tercantum di contoh CDN gstatic (https://firebase.google.com/docs/web/alt-setup), perintah `npm i firebase@12.19.0` di panduan migrasi (https://firebase.google.com/docs/web/modular-upgrade), dan npm `firebase` latest `12.19.0` (https://www.npmjs.com/package/firebase). Cek mutakhir di (https://firebase.google.com/support/release-notes/js). **Jangan hardcode selamanya — samakan semua URL gstatic ke satu versi.**

### Pola listen + tulis RTDB (modular)

Dari (https://firebase.google.com/docs/database/web/read-and-write):

```js
import { getDatabase, ref, onValue, set, push, update, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

// listen realtime (dipicu sekali saat attach + tiap ada perubahan)
onValue(ref(db, 'devices/cow-sprinkler-01/telemetry/latest'), (snap) => {
  const data = snap.val(); // null bila belum ada data
});

// tulis: set (timpa), update (parsial/fan-out), push (key unik timestamp)
set(ref(db, 'devices/cow-sprinkler-01/control'), { mode: 'auto', threshold: 30.0 });
const key = push(ref(db, 'devices/cow-sprinkler-01/events')).key;
update(ref(db), { [`devices/cow-sprinkler-01/events/${key}`]: { type: 'manual_on', ts: serverTimestamp() } });
```

Catatan: pasang listener **serendah mungkin** (mis. `.../telemetry/latest`, bukan root) agar snapshot kecil (https://firebase.google.com/docs/database/web/read-and-write).

> Kendala proyek: `index.html` harus bisa dibuka langsung (`file://`). ES module + `fetch`/CDN dari `file://` bisa kena CORS; untuk dev pakai `firebase emulators:start`/`firebase serve`, untuk demo pakai Hosting (https://firebase.google.com/docs/hosting/quickstart). Fitur realtime tetap butuh internet.

---

## 4. Security Rules RTDB minimal yang aman (demo mahasiswa)

Konsep (https://firebase.google.com/docs/database/security/core-syntax, https://firebase.google.com/docs/database/security/rules-conditions, https://firebase.google.com/docs/database/security/get-started):

- Tiga jenis rule: **`.read` / `.write`** (otorisasi, *cascade* dari atas ke bawah — child tidak bisa mencabut akses parent) dan **`.validate`** (validasi format, **tidak cascade**, hanya dievaluasi untuk nilai non-null, semua level harus lolos).
- Variabel: `auth` (null bila belum login), `data` (lama), `newData` (hasil gabungan), `root`, `$var` wildcard. Validasi umum: `newData.isNumber()`, `isString()`, `.matches(/regex/)`, `.exists()`, `.val()`.
- **Rules bukan filter**: baca di parent gagal total (PERMISSION_DENIED) bila ada child yang tak berhak — jadi struktur data harus selaras dengan rules.

Contoh minimal yang disarankan (sesuaikan; baseline demo: tulis ESP32 + baca web pakai auth, bukan publik total):

```json
{
  "rules": {
    "devices": {
      "$device": {
        "telemetry": {
          "latest": {
            ".read": "auth != null",
            ".write": "auth != null",
            ".validate": "newData.hasChildren(['t1','t2','t3','t4','t5','t6','avg','ts']) && newData.child('t1').isNumber() && newData.child('t1').val() >= -55 && newData.child('t1').val() <= 125 && newData.child('avg').isNumber() && newData.child('avg').val() >= -55 && newData.child('avg').val() <= 125"
          },
          "log": {
            ".read": "auth != null",
            "$pushId": {
              ".write": "auth != null",
              ".validate": "newData.hasChildren(['avg','ts']) && newData.child('avg').isNumber()"
            }
          }
        },
        "control": {
          ".read": "auth != null",
          ".write": "auth != null",
          ".validate": "newData.hasChildren(['mode']) && newData.child('mode').val() == 'auto' || newData.child('mode').val() == 'manual'"
        },
        "events": {
          ".read": "auth != null",
          "$pushId": {
            ".write": "auth != null",
            ".validate": "newData.hasChildren(['type','ts']) && newData.child('type').isString()"
          }
        }
      }
    }
  }
}
```

### Yang TIDAK BOLEH dibiarkan terbuka

1. **`{ ".read": true, ".write": true }` di root** — siapa pun di internet bisa curi/ubah/hapus DB. Start `locked mode` (`auth != null`) seperti contoh setup resmi, bukan `test mode` (https://github.com/mobizt/FirebaseClient — bagian Realtime Database Getting Started; https://firebase.google.com/docs/database/security/get-started).
2. **Database secret / service-account JSON di kode klien (web publik, repo git, firmware yang disebar)** — secret = akses privileged penuh; docs REST mewanti-wanti "jangan commit ke repo publik / deploy di client app" (https://firebase.google.com/docs/database/rest/auth).
3. **Test-mode rules yang kedaluwarsa lalu dibuka lagi** — pantau tab Rules di console; prinsip least-privilege per path seperti contoh di atas.
4. **Mengandalkan rules sebagai filter query** — akan gagal atomik; batasi query (`limitToLast`) + `.indexOn` bila pakai `orderBy` (https://firebase.google.com/docs/database/security/core-syntax, https://firebase.google.com/docs/database/rest/retrieve-data).

---

## 5. Alternatif: REST API RTDB via HTTPS (saat SDK ESP32 bermasalah)

Kapan dipakai: RAM/Flash mepet, konflik TLS/BearSSL, atau ingin dependensi nol selain `HTTPClient`.

Dasar (https://firebase.google.com/docs/reference/rest/database, https://firebase.google.com/docs/database/rest/save-data, https://firebase.google.com/docs/database/rest/retrieve-data):

- Setiap URL DB + **`.json`** adalah endpoint. Metode: **`PUT`** (=`set`, timpa path), **`PATCH`** (=`update`, parsial/multi-path), **`POST`** (=`push`, key unik), **`DELETE`**, **`GET`**.
- Contoh (ganti host dengan URL DB sendiri):

```bash
curl -X PUT -d '{"avg":30.2,"ssr":1}' 'https://<PROJECT>.firebaseio.com/devices/cow-sprinkler-01/telemetry/latest.json?auth=<TOKEN>'
curl 'https://<PROJECT>.firebaseio.com/devices/cow-sprinkler-01/control.json?auth=<TOKEN>'
curl 'https://<PROJECT>.firebaseio.com/devices/cow-sprinkler-01/telemetry/log.json?orderBy="$key"&limitToLast=120&print=pretty'
```

- Auth REST (https://firebase.google.com/docs/database/rest/auth): (a) **secret/token lama** via `?auth=<DATABASE_SECRET>` (deprecated, akses penuh); (b) **ID token Firebase Auth** via `?auth=<ID_TOKEN>` (ditundukkan ke Rules per-user); (c) **OAuth2 access token service account** via header `Authorization: Bearer <TOKEN>` atau `?access_token=` (bypass Rules, untuk server). Scope perlu: `userinfo.email` + `firebase.database`.
- **Streaming perubahan** tanpa SDK: set header `Accept: text/event-stream`, ikuti redirect 307, sertakan `?auth=`; event `put`/`patch`/`keep-alive`/`cancel` (https://firebase.google.com/docs/database/rest/retrieve-data — "Streaming from the REST API").
- Di ESP32 cukup `WiFiClientSecure` + `HTTPClient`:

```cpp
http.begin("https://<PROJECT>.firebaseio.com/devices/cow-sprinkler-01/telemetry/latest.json?auth=" + token);
http.addHeader("Content-Type", "application/json");
http.PUT("{\"t1\":29.8,\"avg\":30.1,\"ssr\":1}");
```

- Trade-off vs SDK (https://firebase.google.com/docs/database/usage/billing): tiap request pendek = handshake TLS berulang → overhead; mitigasi dengan **HTTP keep-alive / SSE persisten**. Untuk poll kontrol 2-detik, pertimbangkan interval 5 detik atau SSE agar hemat bandwidth.

---

## 6. Skema path RTDB yang disarankan

Satu device id: `cow-sprinkler-01` (multi-kandang tinggal tambah id).

```
/devices/cow-sprinkler-01/telemetry/latest
  { t1..t6: number, avg: number, ssr: 0|1, mode: "auto"|"manual",
    rssi: number, heap: number, ts: <server-timestamp> }
  → ditulis ESP32 tiap 2 dtk (PUT/set). Dibaca web via onValue.

/devices/cow-sprinkler-01/telemetry/log/{pushId}
  { avg: number, t1..t6: number, ssr: 0|1, ts }
  → ditulis tiap 30 dtk (POST/push) hingga ±120 entri ≈ 1 jam (cermin log lokal saat ini).
    Web baca limitToLast(120); hapus entri tua via scheduled cleanup/manual trim.

/devices/cow-sprinkler-01/control
  { mode: "auto"|"manual", manualSsr: "on"|"off",
    threshold: 30.0, hysteresis: 1.0, maxDuration: 120, cooldown: 60,
    updatedAt: <ts>, updatedBy: "web"|"device" }
  → ditulis WEB (set/update). Dibaca ESP32 via stream/poll tiap 2–5 dtk.

/devices/cow-sprinkler-01/events/{pushId}
  { type: "auto_on"|"auto_off"|"manual_on"|"manual_off"|"protect_off"|"cooldown",
    reason: string, avg: number, ts }
  → ditulis ESP32 (dan web untuk aksi manual) via POST/push; web render sebagai log event.

/devices/cow-sprinkler-01/status
  { online: true, lastSeen: <ts>, ip: string, fw: "1.0.0" }
  → heartbeat ESP32 tiap ~30 dtk (manfaatkan dukungan presence RTDB bila perlu).
```

Aturan main: `latest` kecil & sering (2 dtk); `log` jarang (30 dtk, batasi 120); `control` satu-satunya sumber perintah web→device; `events` append-only untuk bukti ke dosen/mitra. Timestamp pakai server value agar konsisten (web: `serverTimestamp()`; REST/ESP32: `{".sv":"timestamp"}`) (https://firebase.google.com/docs/database/web/read-and-write, https://firebase.google.com/docs/reference/rest/database).

## 7. Langkah actionable berikutnya

1. `firebase init hosting` dengan `public/` berisi build statis saat ini; deploy preview → cek budget dashboard (https://firebase.google.com/docs/hosting/quickstart).
2. Buat RTDB (region terdekat, mis. asia-southeast1), mulai locked mode, tempel rules §4 (https://firebase.google.com/docs/database/security/get-started).
3. Web: ganti/ tambah opsi sumber "Firebase" di samping Simulasi/MQTT; pakai impor CDN modular §3 yang di-pin ke satu versi.
4. Firmware: coba `FirebaseClient` (`ENABLE_DATABASE`, `UserAuth` untuk demo) — contoh RTDB di repo; fallback REST §5 bila heap/TLS gagal (https://github.com/mobizt/FirebaseClient).
5. Validasi kuota: pantau tab Usage (connections/storage/downloads) di console selama uji 1 jam (https://firebase.google.com/docs/database/usage/billing).
