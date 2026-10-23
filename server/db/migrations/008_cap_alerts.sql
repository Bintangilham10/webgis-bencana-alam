-- Peringatan dini cuaca (nowcast) BMKG dalam format CAP 1.2. Satu baris per
-- peringatan; poligon kecamatannya digabung menjadi satu MultiPolygon. Masa
-- berlakunya ±2 jam, jadi peringatan aktif = expires > now() dan belum digantikan
-- CAP Update/Cancel. Disimpan 30 hari (jobs/sync-cap.js); XML aslinya diarsip perekam.
-- BMKG menerbitkan ulang berkas yang sama dengan identifier baru (arsip 26 Sep–23 Okt
-- 2026: 5.738 identifier untuk 2.214 berkas, isi dan waktunya identik), jadi URL
-- berkas (mis. CSU20261023006_alert.xml) yang dijadikan kunci unik.
CREATE TABLE cap_alerts (
  identifier     text PRIMARY KEY,
  event          text NOT NULL,
  severity       text NOT NULL,               -- Minor, Moderate, Severe, Extreme, Unknown
  urgency        text,
  certainty      text,
  headline       text,
  description    text,
  area_desc      text,                        -- provinsi dari <areaDesc>
  web            text,                        -- infografis BMKG
  url            text NOT NULL UNIQUE,        -- berkas XML CAP
  sent           timestamptz NOT NULL,
  effective      timestamptz,
  expires        timestamptz NOT NULL,
  utc_offset     smallint,                    -- menit; zona waktu wilayahnya (420 WIB, 480 WITA, 540 WIT)
  superseded_at  timestamptz,                 -- diisi saat CAP Update/Cancel merujuknya
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  geom           geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX cap_alerts_geom_idx ON cap_alerts USING gist (geom);
CREATE INDEX cap_alerts_expires_idx ON cap_alerts (expires DESC);

-- Kab/kota yang terkena = kab/kota tempat titik di dalam poligon tiap kecamatan,
-- bukan sekadar bersinggungan (batas kecamatan BMKG dan Kepmendagri tidak persis sama).
CREATE TABLE cap_alert_wilayah (
  identifier  text NOT NULL REFERENCES cap_alerts (identifier) ON DELETE CASCADE,
  kode        text NOT NULL REFERENCES wilayah (kode) ON DELETE CASCADE,
  PRIMARY KEY (identifier, kode)
);
CREATE INDEX cap_alert_wilayah_kode_idx ON cap_alert_wilayah (kode);
