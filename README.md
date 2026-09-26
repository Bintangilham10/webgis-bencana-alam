# SIGAP Bencana

Sistem web pemetaan **peringatan dini dan mitigasi bencana alam Indonesia** berbasis data spasial terbuka.
Tugas Besar mata kuliah Teknologi Pemetaan Berbasis Web (ACK4LBB3), Telkom University.

> **Bukan sumber peringatan resmi.** Untuk keputusan keselamatan, ikuti BMKG, PVMBG/MAGMA, dan BNPB/BPBD setempat.

## Fitur saat ini

- **Antarmuka peta dominan:**
  - pencarian di bilah atas;
  - panel samping bertab (Ikhtisar, Lapisan, Info) yang menjadi lembar bawah (*bottom sheet*) di HP;
  - bilah alat seragam di kanan peta (zoom, seluruh Indonesia, lokasi saya, pilih titik, peta dasar);
  - indikator kesegaran data.
  
  Tab Info memuat nomor darurat (112, 117, 115, 119, 113, 110). Tanpa framework CSS; font Plus Jakarta Sans dimuat mandiri (±27 KB).
- **Peta dasar:** abu-abu netral, kemanusiaan (HOT), OpenStreetMap, relief (OpenTopoMap), dan citra satelit (Esri), dipilih lewat menu bergambar.
- **Elemen kartografi:** legenda dinamis yang bisa dilipat, skala batang, arah utara, angka skala 1:n beserta klasifikasinya, dan koordinat kursor dalam WGS84, UTM, dan EPSG:3857.
- **Gempa BMKG:** disinkronkan tiap 60 detik. Simbol menunjukkan magnitudo dan kelas kedalaman, dengan penanda potensi tsunami dan tautan shakemap.
- **Status gunung api:** 69 gunung api dari MAGMA/PVMBG, disinkronkan tiap 30 menit.
- **Peta rawan InaRISK BNPB:** gempa bumi, cuaca ekstrem, banjir, tanah longsor, dan gunung api, masing-masing dalam 3 kelas bahaya.
- **Data geologi dan wilayah:** sesar aktif PuSGeN 2024, batas lempeng tektonik, dan batas 514 kabupaten/kota (Kepmendagri 2025).
- **Pencarian lokasi:** nama kab/kota dicari di database sendiri, tempat lain lewat Nominatim OpenStreetMap. Pencarian berjalan saat Enter ditekan, sesuai kebijakan Nominatim.
- **Cek risiko lokasi:** pilih titik dengan pencarian, tombol "lokasi saya", mode pilih titik, atau klik kanan/tekan lama di peta. Profil tampil di panel samping (peta tidak tertutup) dan dibuka dengan satu status 3 hari ke depan (Normal/Waspada/Siaga/Awas). Isinya:
  - indeks lima bahaya InaRISK dengan kelas BNPB;
  - indikasi peringatan 3 hari (hujan × kelas bahaya, aturan awal v0 di `server/src/config/rules.json`);
  - prakiraan hujan dan elevasi;
  - jarak ke sesar aktif dan gunung api terdekat, digambar sebagai garis di peta;
  - gempa di sekitar lokasi dan saran kesiapsiagaan.
- **Perekam arsip data riset** (`recorder/`): GitHub Actions merekam tiap 15 menit ke branch `arsip-data`.

## Struktur

| Folder | Isi |
|---|---|
| `server/` | API Express + PostGIS, penjadwal sinkronisasi, migrasi, dan seed data |
| `web/` | Frontend Vite + Leaflet |
| `recorder/` | Perekam arsip data (berjalan di GitHub Actions) |
| `docker-compose.yml` | Database PostgreSQL 18 + PostGIS 3.6 |

## Menjalankan secara lokal

Prasyarat: Node.js 22 atau lebih baru dan Docker Desktop.

```bash
docker compose up -d        # database di localhost:5433

cd server
npm install
npm run migrate             # membuat tabel
npm run seed                # batas wilayah, gunung api, sesar (unduh sekali, ±15 detik)
npm run dev                 # API di http://localhost:3000/api
```

Di terminal lain:

```bash
cd web
npm install
npm run dev                 # buka http://localhost:5173
```

Konfigurasi bawaan sudah cocok dengan `docker-compose.yml`. Salin `.env.example` menjadi `.env` hanya bila perlu mengubahnya.

### Test

```bash
cd server && npm test       # unit test
cd recorder && npm test
```

Test integrasi server memakai database terpisah supaya data pengembangan tidak tersentuh:

```bash
docker compose exec db createdb -U sigap sigap_test     # sekali saja
cd server
TEST_DATABASE_URL=postgres://sigap:sigap@localhost:5433/sigap_test npm test
```

Di PowerShell: `$env:TEST_DATABASE_URL="postgres://sigap:sigap@localhost:5433/sigap_test"; npm test`

## API

| Endpoint | Isi |
|---|---|
| `GET /api/health` | Status database dan sinkronisasi tiap sumber |
| `GET /api/earthquakes?days=7` | Gempa dalam 1–90 hari terakhir (GeoJSON) |
| `GET /api/volcanoes` | Gunung api beserta status level |
| `GET /api/faults` | Segmen sesar aktif PuSGeN 2024 |
| `GET /api/wilayah?tingkat=provinsi` atau `kabkota` | Batas wilayah, disederhanakan untuk tampilan |
| `GET /api/risk?lat=-6.2&lon=106.85` | Profil risiko satu titik (cache 10 menit per sel ±100 m) |
| `GET /api/geocode?q=bandung` | Pencarian kab/kota (database) dan tempat lain (Nominatim) |

## Sumber data dan atribusi

| Data | Sumber | Ketentuan |
|---|---|---|
| Gempa bumi | [BMKG](https://data.bmkg.go.id/) | Wajib mencantumkan BMKG sebagai sumber |
| Indeks bahaya, sesar aktif | [InaRISK BNPB](https://inarisk.bnpb.go.id/); model sesar PuSGeN 2024 | Cantumkan BNPB dan PuSGeN |
| Status gunung api | [MAGMA Indonesia](https://magma.esdm.go.id/), PVMBG Kementerian ESDM | Cantumkan PVMBG |
| Batas lempeng | Bird (2003) PB2002, konversi H. Ahlenius/Nordpil | ODC-By |
| Batas wilayah | Kepmendagri No 300.2.2-2430 Tahun 2025, [cahyadsn/wilayah_boundaries](https://github.com/cahyadsn/wilayah_boundaries) | MIT |
| Laporan warga (arsip riset) | [PetaBencana.id](https://petabencana.id/) | CC BY-NC 4.0 |
| Prakiraan hujan dan elevasi | [Open-Meteo](https://open-meteo.com/) (elevasi dari Copernicus DEM 90 m) | CC BY 4.0, gratis untuk nonkomersial |
| Pencarian tempat | [Nominatim](https://nominatim.org/) © OpenStreetMap contributors | ODbL; maksimal 1 request/detik, tanpa autocomplete |
| Peta dasar | Esri; © OpenStreetMap contributors (ODbL); Humanitarian OpenStreetMap Team; OpenTopoMap | CC-BY-SA untuk OpenTopoMap |
