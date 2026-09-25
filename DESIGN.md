---
name: "Smart Cow Sprinkler System"
description: "Dashboard kandang: kartu terang berborder, satu aksen hijau, angka tabular."
colors:
  primary: "#177245"
  primary-hover: "#125c37"
  neutral-bg: "#f3f4f6"
  surface: "#ffffff"
  ink: "#1c2027"
  muted: "#5d6875"
  line: "#e2e4e9"
  line-strong: "#cfd4dc"
  danger: "#c92a1e"
  warn-ink: "#8a4a08"
  info-ink: "#174a9e"
  code-ink: "#174a9e"
  ok-soft: "#e3f2e9"
  ok-ink: "#125c37"
  ok-line: "#bfe3cd"
  warn-soft: "#fdf1de"
  warn-line: "#ecd3a8"
  danger-soft: "#fdecea"
  danger-ink: "#8f1d13"
  info-soft: "#e9effd"
  chart-threshold: "#b45309"
  chart-avg: "#0e7490"
  series-1: "#e11d48"
  series-2: "#ea580c"
  series-3: "#a16207"
  series-4: "#15803d"
  series-5: "#2563eb"
  series-6: "#7c3aed"
  dark-bg: "#14161a"
  dark-surface: "#1e2126"
  dark-ink: "#e9ebee"
  dark-muted: "#9aa3ae"
  dark-line: "#2f343c"
  dark-accent: "#2ea36c"
  dark-danger: "#e4574c"
  dark-danger-ink: "#2b0a07"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "56px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  section-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "12.5px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.02em"
  clock:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "0.01em"
  unit:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "normal"
  avg-mobile:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "44px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  caption-sm:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "normal"
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "10.5px"
    fontWeight: 800
    lineHeight: 1.5
    letterSpacing: "0.04em"
  sensor-value:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
rounded:
  card: "14px"
  control: "9px"
  pill: "999px"
  sensor: "12px"
  box: "10px"
  code: "6px"
  focus: "4px"
  logo: "11px"
spacing:
  container: "20px"
  section-gap: "18px"
  card-gap: "14px"
  card-padding: "18px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  status-pill:
    rounded: "{rounded.pill}"
    padding: "5px 14px"
  sensor-card:
    backgroundColor: "{colors.surface}"
    rounded: "12px"
    padding: "12px 10px"
---

# DESIGN.md: Smart Cow Sprinkler System

Catatan sumber: dipindai dari `index.html` + `css/style.css` + `js/app.js` + `js/source.js` yang dibangun. Token di frontmatter adalah normatif; prosa menjelaskan cara pakai.

## Overview

Bahasa antarmuka minimal-ekspresif ala Modrinth untuk dasbor Operate: kartu terang berborder 1px tanpa shadow, satu aksen hijau untuk aksi dan status hidup, kosakata status (NORMAL, WASPADA, BAHAYA, PANAS) dalam pill berkode warna. Mobile-first: peternak membaca rata-rata kandang dalam 5 detik dari HP di cahaya terang. Tema terang mengikuti sistem dengan toggle manual; tema gelap wajib utuh (variabel `[data-theme="dark"]` di `style.css`).

## Colors

Restrained: netral + satu aksen. Aksen hijau `#177245` hanya untuk aksi primer (Simpan, Nyalakan, mode aktif) dan status hidup (sprinkler ON, badge LIVE). Amber `#8a4a08` dan merah `#c92a1e` milik eksklusif status WASPADA/BAHAYA/PANAS, tidak dipakai dekorasi. Biru info `#174a9e` hanya untuk teks kode dan badge SIMULASI. Permukaan: latar `#f3f4f6`, kartu `#ffffff`, area inset (grafik, tabel, log, event) `#f3f4f6`. Garis `@line`. Teks `@ink`, sekunder `@muted` (kontras ≥4.5:1). Grafik kanvas membaca `--chart-grid`/`--chart-ink` dari CSS agar ikut tema; seri sensor `#e11d48 #ea580c #a16207 #16a34a #2563eb #7c3aed`, rata-rata `#0e7490`, garis threshold `#d97706`.

## Typography

Satu system sans stack di semua teks (offline-first, tanpa font luar; disengaja, bukan fallback). Display hanya untuk angka rata-rata (56px/800/-0.03em, tabular). H1 22px, H2 18px, H3 17px dengan ikon SVG 18px. Body 13.5-14px. Semua angka (suhu, jam, log) `font-variant-numeric: tabular-nums` agar tidak bergeser. Tidak ada uppercase dekoratif; pill status memakai konten kapital ringkas sebagai kosakata kode.

## Layout

Lebar maks 1240px. Viewport pertama: topbar (merek SC, jam WIB, badge sumber, toggle tema) + tiga kartu (Rata-rata fokus, Sprinkler, Mode/override) + grid 6 titik suhu. Urutan scroll: grafik + pengaturan, log report, event + info ESP32. Grid sensor 6-3-2 kolom mengikuti lebar (1100px, 640px). Tabel log full-bleed dalam kontainer ber-radius dengan inset 8px dan thead sticky.

## Elevation & Depth

Deklarasi tunggal: border 1px, tanpa shadow di semua kartu dan kontrol. Satu-satunya gerakGlow adalah denyut dot hijau saat MENYEMPROT (satu momen gerak, MOTION 1; mati saat `prefers-reduced-motion`). Perubahan angka sensor cross-fade warna 0.3s; bar memakai `transform: scaleX`, bukan animasi width.

## Shapes

Radius kartu 14px, kartu sensor 12px, kontrol 8-9px, pill 999px hanya untuk badge dan status kecil. Ikon: satu set SVG inline goresan 1.8px `currentColor` (grafik, slider, list, bell, chip, droplet, stop, download, trash, pencil, sun, moon); tanpa emoji sebagai ikon. Logo berupa ubin teks "SC" hijau, bukan logo gambar.

## Components

Tombol: primer hijau solid, danger merah solid, ghost berborder; tinggi sentuh min 44px (36px varian small); disabled 0.45. Mode aktif invert solid hijau. Input/select 44px dengan border tegas dan fokus hijau. Pill status: normal/waspada/bahaya + s-state ok/warn/hot/off, selalu 1px border bernada sama. Sprinkler ON/OFF sebagai panel status besar. Badge sumber: SIMULASI/LIVE/KONEKSI GAGAL. Event sebagai daftar inset dengan stempel WIB. Empty/loading/error: baris `.empty`, teks "Menunggu data…", notice merah dengan langkah pemulihan wiring.

## Do's and Don'ts

Lakukan: pertahankan semua `id` yang dipakai `app.js`; tambah fitur baru dalam kartu dan ritme yang sama; hormati glosarium CONTEXT.md (Threshold, Hysteresis, Cooldown, Jadwal semprot, Override manual, Event; jangan tulis "ambang" di UI); verifikasi kedua tema tiap perubahan. Jangan: tambah warna aksen baru, shadow, gradien, glass, emoji ikon, klaim/fitur fiktif, atau font luar yang merusak offline-first.
