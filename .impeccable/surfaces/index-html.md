---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# Surface brief: index.html (dashboard utama, satu-satunya surface)

Scope: dashboard monitoring + kontrol sprinkler, mobile-first (HP peternak di kandang).
Mode: Operate. Dial ENERGY 2 / RHYTHM 2 / MOTION 1.
Design Read: dashboard Operate untuk peternak, dalam bahasa antarmuka minimal-ekspresif ala Modrinth, dial ENERGY 2 / RHYTHM 2 / MOTION 1.
Audience/job: peternak cek suhu dan memastikan semprotan jalan, sering satu tangan dan cahaya terang.
Proof: 6 titik suhu, rata-rata, grafik 1 jam, log 120 baris, event sprinkler.
Constraints: offline-first (tanpa CDN/font luar), semua ID dan perilaku JS tetap, Bahasa Indonesia ikut glosarium CONTEXT.md, zona WIB, tema terang+gelap keduanya wajib utuh.

## Direction contract

THESIS: Dasbor ini alat kerja kandang, bukan demo neon. Ia menolak template hero-metrik: angka rata-rata hidup berdampingan dengan bukti kerja.
OWN-WORLD: Kartu terang ala Modrinth: border 1px, radius 14px, tanpa shadow. Satu aksen hijau untuk aksi dan status hidup; amber dan merah hanya untuk WASPADA dan BAHAYA. Angka tabular, sans-serif sistem.
STORY: Peternak paham kondisi dalam 5 detik dari pill status, rata-rata, dan sprinkler. Bukti menyusul: grafik dan log satu scroll di bawah. Override manual selalu satu ketuk.
FIRST VIEWPORT: Topbar berisi merek SC, jam WIB, badge sumber, dan toggle tema. Tiga kartu: Rata-rata sebagai fokus, Sprinkler berisi status dan alasan, Mode berisi override. Di bawahnya grid enam titik suhu.
FORM: Arah pin-pengguna (Modrinth-like) mengalahkan roll; seed 8123d691. Lima challenger declined; pelajarannya menjadi RAISE di bawah.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

RAISE/status-code (Saville): status berbicara dalam pill kode ringkas dan angka tabular; satu aksen hanya untuk status hidup.
RAISE/time-axis (Labanotation): grafik memegang sumbu waktu tetap; baris log sejajar ritmenya.
RAISE/digit-event (Nixie): perubahan angka cross-fade, tidak pernah melompat.
RAISE/pressed-invert (HyperCard): tombol mode aktif invert solid, bukan glow.
RAISE/packet-density (Miura): grid sensor berdenyut 6-3-2 mengikuti lebar layar.
RAISE/single-focus (Storm): satu fokus per viewport; viewport pertama milik rata-rata.
Verdicts: keenam challenger declined (kalah identifikasi audiens dan kejelasan produk); tidak ada pick card karena arah pin-pengguna menang. Halaman keputusan tidak tersedia di harness ini; verdict dicatat di sini.
