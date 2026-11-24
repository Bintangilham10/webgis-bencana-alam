-- Kunci API untuk pengembang luar (/api/v1). Kunci asli hanya ditampilkan sekali
-- saat dibuat; yang disimpan sidik SHA-256-nya, jadi isi tabel ini tidak bisa
-- dipakai untuk memanggil API. `prefix` (awal kunci) hanya untuk mengenali kunci
-- saat mengelolanya.
CREATE TABLE api_keys (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key_hash    text NOT NULL UNIQUE,
  prefix      text NOT NULL,
  name        text NOT NULL,          -- nama orang atau tim pendaftar
  email       text NOT NULL,          -- tidak diverifikasi; untuk menghubungi pemilik kunci
  purpose     text NOT NULL,          -- untuk apa datanya dipakai
  daily_quota integer NOT NULL DEFAULT 5000 CHECK (daily_quota >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE INDEX api_keys_email_idx ON api_keys (lower(email));

-- Jumlah permintaan per kunci per hari (UTC): dasar kuota harian dan statistik pemakaian.
CREATE TABLE api_usage (
  key_id   bigint NOT NULL REFERENCES api_keys (id) ON DELETE CASCADE,
  day      date NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day)
);
