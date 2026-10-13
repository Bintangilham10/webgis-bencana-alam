#!/usr/bin/env bash
# Memulihkan salinan basis data SIGAP (pg_dump -Fc dari laptop) ke server produksi,
# sebelum API dijalankan pertama kali. Dari root repo di server:
#   bash deploy/restore-db.sh sigap.dump
set -euo pipefail
dump=${1:?pakai: bash deploy/restore-db.sh <berkas.dump>}
compose="docker compose -f deploy/compose.yaml"

$compose up -d --wait db
# Penugasan terpisah supaya galat psql menghentikan skrip (set -e), bukan dianggap "kosong".
has_tables=$($compose exec -T db psql -U sigap -d sigap -Atc "select to_regclass('public.wilayah') is not null")
if [ "$has_tables" = t ]; then
  echo "Basis data server sudah berisi tabel SIGAP; pemulihan dibatalkan supaya data tidak tertimpa." >&2
  exit 1
fi

$compose cp "$dump" db:/tmp/sigap.dump
# Skema tiger dan topology sudah dibuat image PostGIS saat basis data pertama kali
# dibuat, jadi entri CREATE SCHEMA keduanya dilewati supaya pemulihan bebas galat.
$compose exec -T db sh -c '
  set -e
  trap "rm -f /tmp/sigap.dump /tmp/sigap.list" EXIT
  pg_restore -l /tmp/sigap.dump | grep -vE "SCHEMA - (tiger|topology) " > /tmp/sigap.list
  pg_restore -U sigap -d sigap --no-owner --no-privileges --exit-on-error -L /tmp/sigap.list /tmp/sigap.dump'

# Log sinkronisasi laptop tidak dibawa: ketersediaan server (RQ2) dihitung sejak
# server ini berjalan. Riwayat laptop tetap ada di basis data lokal.
$compose exec -T db psql -U sigap -d sigap -c 'TRUNCATE sync_logs'
$compose exec -T db psql -U sigap -d sigap -Atc "select format('%s wilayah, %s titik pantau, %s gempa, %s run indikasi', (select count(*) from wilayah), (select count(*) from titik_pantau), (select count(*) from events), (select count(*) from indikasi_run))"
