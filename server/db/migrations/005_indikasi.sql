-- Indikasi SIGAP 3 hari per kab/kota (hujan lebat, banjir, tanah longsor).

-- Raster kelas bahaya InaRISK BNPB (±550 m, EPSG:4326): 1 rendah, 2 sedang,
-- 3 tinggi; NoData (0) = di luar zona bahaya atau laut. Dipakai untuk
-- statistik zona per kab/kota dan pemilihan titik pantau.
CREATE EXTENSION IF NOT EXISTS postgis_raster;

CREATE TABLE bahaya_raster (
  rid     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hazard  text NOT NULL CHECK (hazard IN ('banjir', 'longsor')),
  rast    raster NOT NULL
);
CREATE INDEX bahaya_raster_hull_idx ON bahaya_raster USING gist (ST_ConvexHull(rast));
CREATE INDEX bahaya_raster_hazard_idx ON bahaya_raster (hazard);

-- Statistik zona: luas tiap kelas bahaya di dalam kab/kota (km², dari jumlah piksel).
CREATE TABLE wilayah_bahaya (
  kode        text NOT NULL REFERENCES wilayah (kode) ON DELETE CASCADE,
  hazard      text NOT NULL CHECK (hazard IN ('banjir', 'longsor')),
  rendah_km2  real NOT NULL,
  sedang_km2  real NOT NULL,
  tinggi_km2  real NOT NULL,
  PRIMARY KEY (kode, hazard)
);

-- Titik pantau per kab/kota: sampai tiga sel 0,25° dengan kelas bahaya tertinggi
-- (lalu piksel terbanyak) di raster 550 m per jenis bahaya, plus satu titik acuan
-- kab/kota. Raster itu dihaluskan server, jadi titiknya kandidat terdekat ke
-- pusat sebaran piksel yang kelas aslinya (InaRISK 100 m, getSamples) cocok.
CREATE TABLE titik_pantau (
  id      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode    text NOT NULL REFERENCES wilayah (kode) ON DELETE CASCADE,
  hazard  text NOT NULL CHECK (hazard IN ('banjir', 'longsor', 'acuan')),
  urutan  smallint NOT NULL,
  kelas   smallint NOT NULL CHECK (kelas BETWEEN 0 AND 3),  -- kelas asli (100 m) di titik; 0 untuk titik acuan
  piksel  integer NOT NULL,                                 -- piksel kelas sel di raster 550 m
  geom    geometry(Point, 4326) NOT NULL
);
CREATE INDEX titik_pantau_kode_idx ON titik_pantau (kode);

-- Setiap run disimpan utuh, termasuk kab/kota yang Normal, untuk uji prospektif.
CREATE TABLE indikasi_run (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at        timestamptz NOT NULL,
  finished_at       timestamptz NOT NULL,
  rules_version     text NOT NULL,
  forecast_from     date NOT NULL,     -- hari pertama prakiraan (WIB)
  forecast_to       date NOT NULL,
  locations         integer NOT NULL,  -- titik yang diminta hujannya (koordinat 3 desimal)
  locations_failed  integer NOT NULL
);

CREATE TABLE indikasi_wilayah (
  run_id     integer NOT NULL REFERENCES indikasi_run (id) ON DELETE CASCADE,
  kode       text NOT NULL REFERENCES wilayah (kode) ON DELETE CASCADE,
  hazard     text NOT NULL CHECK (hazard IN ('hujan', 'banjir', 'longsor')),
  level      smallint CHECK (level BETWEEN 0 AND 3),  -- NULL = data hujan tidak tersedia
  peak_date  date,                                    -- hari dengan kondisi terburuk
  reason     text NOT NULL,
  titik      geometry(Point, 4326),                   -- titik pantau terburuk
  PRIMARY KEY (run_id, kode, hazard)
);
CREATE INDEX indikasi_wilayah_kode_idx ON indikasi_wilayah (kode, hazard);
