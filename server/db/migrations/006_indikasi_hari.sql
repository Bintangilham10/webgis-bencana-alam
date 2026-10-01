-- Indikasi SIGAP per hari prakiraan (sejak aturan v0.2, 1 Okt 2026).
-- Run memakai 4 hari prakiraan (hari run sampai H+3). Peta menampilkan hari ini
-- sampai dua hari berikutnya dari tabel ini, jadi hari yang sudah lewat tidak ikut
-- menentukan warna. Tabel ini juga bahan verifikasi prospektif per lead time
-- (tanggal − tanggal run). indikasi_wilayah tetap menyimpan ringkasan 3 hari
-- pertama run (hari run sampai H+2), sama dengan run sebelum tabel ini ada.
CREATE TABLE indikasi_hari (
  run_id    integer NOT NULL REFERENCES indikasi_run (id) ON DELETE CASCADE,
  kode      text NOT NULL REFERENCES wilayah (kode) ON DELETE CASCADE,
  hazard    text NOT NULL CHECK (hazard IN ('hujan', 'banjir', 'longsor')),
  tanggal   date NOT NULL,                             -- tanggal prakiraan (WIB)
  level     smallint CHECK (level BETWEEN 0 AND 3),     -- NULL = data hujan tidak tersedia
  hujan_mm  real,                                      -- hujan harian di titik terburuk
  reason    text NOT NULL,
  titik     geometry(Point, 4326),                     -- titik pantau terburuk hari itu
  PRIMARY KEY (run_id, kode, hazard, tanggal)
);
CREATE INDEX indikasi_hari_tanggal_idx ON indikasi_hari (tanggal, hazard);
