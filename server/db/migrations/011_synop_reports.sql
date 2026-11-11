-- Laporan sinoptik (SYNOP) stasiun cuaca BMKG yang dipertukarkan lewat jaringan
-- WMO, diambil dari gerbang NOAA/NWS (jobs/sync-synop.js). Satu baris per stasiun
-- per jam pengamatan; laporan koreksi menimpa yang lama. first_seen_at tidak
-- berubah, untuk mengukur jeda antara pengamatan dan data tersedia (RQ2).
-- Nama, koordinat, dan kab/kota stasiun ada di server/data/stasiun-cuaca.json.
CREATE TABLE synop_reports (
  wmo             text NOT NULL,                   -- nomor stasiun WMO, mis. '96749'
  observed_at     timestamptz NOT NULL,            -- jam pengamatan (UTC)
  rain_mm         real,                            -- hujan selama rain_hours; NULL = tidak dilaporkan
  rain_hours      smallint,                        -- lama periode (jam) yang berakhir pada observed_at
  rain_trace      boolean NOT NULL DEFAULT false,  -- ada hujan tetapi kurang dari 0,1 mm
  weather         smallint,                        -- sandi cuaca saat pengamatan (ww 00–99)
  temp_c          real,
  temp_max_c      real,
  temp_min_c      real,
  bulletin        text NOT NULL,                   -- kepala buletin WMO, mis. 'SMID02 WIIX 110000'
  raw             text NOT NULL,                   -- laporan asli
  source_file_at  timestamptz NOT NULL,            -- waktu berkas NOAA yang memuat laporan ini
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wmo, observed_at)
);
CREATE INDEX synop_reports_observed_idx ON synop_reports (observed_at DESC);
