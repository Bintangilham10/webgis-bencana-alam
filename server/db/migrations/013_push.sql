-- Web Push: notifikasi tetap sampai walau tab SIGAP ditutup. Browser yang
-- menyalakannya mendaftarkan alamat layanan push miliknya (endpoint) dan dua
-- kuncinya; server mengirim pesan terenkripsi ke alamat itu (src/lib/web-push.js).
--
-- Wilayah pengguna hanya disimpan bila pengguna punya wilayah saat menyalakan push,
-- dan sudah dibulatkan ke 0,1° (±11 km) oleh server. Tanpa wilayah, yang dikirim
-- hanya gempa dan perubahan level gunung api se-Indonesia. Baris dihapus saat
-- pengguna mematikan push atau saat layanan push menyatakan alamatnya tidak berlaku.
CREATE TABLE push_subscriptions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,                   -- kunci publik browser (base64url)
  auth        text NOT NULL,                   -- rahasia autentikasi browser (base64url)
  token       text NOT NULL UNIQUE,            -- pengenal acak untuk laporan terima dari service worker
  near_only   boolean NOT NULL DEFAULT false,  -- "Hanya sekitar lokasi saya"
  lat         double precision,                -- wilayah pengguna dibulatkan 0,1°; NULL = tidak dibagikan
  lon         double precision,
  kode        text,                            -- kode kab/kota pengguna, untuk peringatan cuaca
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz,
  failures    smallint NOT NULL DEFAULT 0,
  CHECK ((lat IS NULL) = (lon IS NULL))
);

-- Satu baris per pesan yang dikirim ke satu langganan (RQ2: latensi push).
-- accepted_ms = lama sampai layanan push menjawab; received_at = saat service worker
-- di perangkat melapor sudah menerima, menurut jam server, jadi received_at − sent_at
-- adalah batas atas waktu sampai ke perangkat (termasuk perjalanan laporannya).
-- notification_id NULL = pesan uji yang diminta pengguna. Baris tetap disimpan
-- setelah langganannya dihapus (subscription_id menjadi NULL).
CREATE TABLE push_deliveries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id bigint REFERENCES notifications (id) ON DELETE CASCADE,
  subscription_id bigint REFERENCES push_subscriptions (id) ON DELETE SET NULL,
  layanan         text NOT NULL,               -- host layanan push, mis. fcm.googleapis.com
  sent_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  status          smallint,                    -- status HTTP layanan push; NULL = tidak terjangkau
  accepted_ms     integer,
  received_at     timestamptz,
  UNIQUE (notification_id, subscription_id)
);
CREATE INDEX push_deliveries_sent_idx ON push_deliveries (sent_at DESC);
