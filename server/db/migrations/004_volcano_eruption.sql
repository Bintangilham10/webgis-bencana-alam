-- Status erupsi dari data peta MAGMA:
--   erupsi = MAGMA menampilkan ikon letusan untuk gunung api ini (erupt_icon),
--   vona   = VONA (peringatan abu vulkanik untuk penerbangan) sedang berlaku (has_vona).
ALTER TABLE volcanoes
  ADD COLUMN erupsi boolean NOT NULL DEFAULT false,
  ADD COLUMN vona   boolean NOT NULL DEFAULT false;
