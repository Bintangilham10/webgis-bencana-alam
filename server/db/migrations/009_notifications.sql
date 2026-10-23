-- Notifikasi yang dikirim ke browser lewat SSE (/api/stream): gempa BMKG baru,
-- perubahan level gunung api, dan peringatan dini cuaca BMKG baru. Satu baris per
-- kejadian sumber (kind, ref), jadi sinkronisasi ulang tidak mengirim dua kali.
-- created_at − source_time = jeda dari sumber sampai SIGAP mengirim (RQ2).
CREATE TABLE notifications (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('gempa', 'gunung_api', 'cuaca')),
  ref          text NOT NULL,                 -- events.id, kode gunung api + waktu ubah, identifier CAP
  level        smallint NOT NULL CHECK (level BETWEEN 0 AND 3),
  title        text NOT NULL,
  body         text NOT NULL,
  wilayah      text[] NOT NULL DEFAULT '{}',  -- kode kab/kota yang terkena (peringatan cuaca)
  lat          double precision,              -- titik gempa/gunung api, titik dalam poligon CAP
  lon          double precision,
  source_time  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref)
);
CREATE INDEX notifications_created_idx ON notifications (created_at DESC);

-- Level sebelum perubahan terakhir, untuk menulis "naik" atau "turun".
ALTER TABLE volcanoes ADD COLUMN level_sebelumnya smallint;
