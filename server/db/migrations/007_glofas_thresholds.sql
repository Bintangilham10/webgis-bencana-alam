-- Ambang debit banjir per sel GloFAS (periode ulang 2, 5, dan 20 tahun), dihitung
-- dari debit maksimum tahunan reanalisis GloFAS lewat Open-Meteo (routes/river.js).
-- Reanalisisnya tetap, jadi tiap sel cukup diminta dan dihitung sekali: satu
-- permintaan riwayat dihitung Open-Meteo sebagai puluhan panggilan kuota.
-- years NULL = riwayat sel itu kurang dari 10 tahun lengkap, jadi tidak ada ambang.
CREATE TABLE glofas_thresholds (
  lat          double precision NOT NULL,     -- pusat sel dari jawaban Open-Meteo
  lon          double precision NOT NULL,
  years        smallint,                      -- jumlah tahun lengkap yang dipakai
  from_year    smallint,
  to_year      smallint,
  rp2          double precision,              -- m³/s
  rp5          double precision,
  rp20         double precision,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lat, lon)
);
