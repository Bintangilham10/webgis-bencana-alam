-- Semua geometri disimpan dalam WGS84 (EPSG:4326). Jarak dan luas dihitung
-- dengan tipe geography supaya tidak terdistorsi proyeksi Web Mercator.

-- Batas administrasi sesuai Kepmendagri 2025: provinsi dan kabupaten/kota.
CREATE TABLE wilayah (
  kode        text PRIMARY KEY,                -- '32' (provinsi) atau '32.73' (kab/kota)
  nama        text NOT NULL,
  tingkat     text NOT NULL CHECK (tingkat IN ('provinsi', 'kabupaten', 'kota')),
  induk_kode  text REFERENCES wilayah (kode),
  titik       geometry(Point, 4326) NOT NULL,  -- titik yang pasti berada di dalam poligon
  geom        geometry(MultiPolygon, 4326) NOT NULL
);

-- Gunung api yang dipantau PVMBG beserta status level terakhir dari MAGMA.
CREATE TABLE volcanoes (
  kode              text PRIMARY KEY,          -- kode MAGMA, mis. 'MER'
  nama              text NOT NULL,
  kabupaten         text,
  provinsi          text,
  elevasi_m         integer,
  level             smallint NOT NULL CHECK (level BETWEEN 1 AND 4),
  checked_at        timestamptz NOT NULL,      -- sinkronisasi terakhir yang berhasil
  level_changed_at  timestamptz,               -- NULL = belum ada perubahan sejak sistem berjalan
  geom              geometry(Point, 4326) NOT NULL
);

-- Segmen sesar aktif kerak dangkal, model PuSGeN 2024.
CREATE TABLE faults (
  id                     integer PRIMARY KEY,
  nama                   text NOT NULL,
  segmen                 text,
  region                 text,
  tipe                   text,                 -- kode mekanisme PuSGeN, mis. 'SS-LL90'
  mmax                   real,
  slip_rate_mm_per_year  real,
  panjang_km             real,
  geom                   geometry(MultiLineString, 4326) NOT NULL
);

-- Kejadian dari sumber luar. occurred_at dan first_seen_at dipisah untuk
-- riset latensi: kapan kejadian terjadi dan kapan sistem pertama melihatnya.
CREATE TABLE events (
  id             text PRIMARY KEY,             -- mis. 'bmkg:20260925T134730Z'
  source         text NOT NULL,
  hazard         text NOT NULL,
  magnitude      real,
  depth_km       real,
  occurred_at    timestamptz NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  props          jsonb NOT NULL DEFAULT '{}',
  geom           geometry(Point, 4326) NOT NULL
);

-- Log setiap sinkronisasi: dasar halaman kesehatan sumber dan data ketersediaan (RQ2).
CREATE TABLE sync_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source       text NOT NULL,
  ok           boolean NOT NULL,
  items        integer,
  message      text,
  started_at   timestamptz NOT NULL,
  duration_ms  integer NOT NULL
);
