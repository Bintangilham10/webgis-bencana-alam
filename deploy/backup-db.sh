#!/usr/bin/env bash
# Salinan basis data SIGAP di server produksi (pg_dump -Fc). Dijalankan cron tiap hari
# (deploy/README.md, bagian "Cadangan basis data"); bisa juga dijalankan sendiri:
#   bash deploy/backup-db.sh [direktori] [jumlah salinan yang disimpan]
# Bawaan: direktori cadangan/ di root repo dan 7 salinan terakhir. Salinan terbaru
# juga tersedia dengan nama tetap sigap-terbaru.dump, supaya mudah diambil dengan scp.
set -euo pipefail
# Salinan memuat alamat email pendaftar kunci API: hanya pemiliknya yang boleh membaca.
umask 077
cd "$(dirname "$0")/.."
dir=${1:-cadangan}
keep=${2:-7}
compose="docker compose -f deploy/compose.yaml"

mkdir -p "$dir"
out="$dir/sigap-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
tmp="$out.tmp"
trap 'rm -f "$tmp"' EXIT

# </dev/null: tanpa ini `exec -T` ikut membaca masukan skrip yang memanggilnya.
$compose exec -T db pg_dump -U sigap -d sigap -Fc < /dev/null > "$tmp"
# Salinan dibaca ulang sampai habis sebelum dipakai, supaya salinan yang rusak atau
# terpotong tidak menggeser salinan lama yang masih baik.
$compose exec -T db pg_restore -f /dev/null < "$tmp"
mv "$tmp" "$out"
ln -f "$out" "$dir/sigap-terbaru.dump"

# Nama berkas berurut waktu, jadi yang dihapus adalah yang tertua.
ls -1 "$dir"/sigap-20*.dump | sort -r | tail -n +"$((keep + 1))" | xargs -r rm -f
echo "$(date -u +%FT%TZ) $out $(du -h "$out" | cut -f1)"
