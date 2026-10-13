# Server produksi SIGAP Bencana

Situs: **https://sigap-bencana.malaysiawest.cloudapp.azure.com**

## Susunan

- **Satu VM Azure** `Standard_B2ats_v2` (2 vCPU AMD, RAM 1 GB + swap 2 GB, disk Standard SSD 32 GB), Ubuntu 24.04, region Malaysia West zona 2, grup sumber daya `sigap-rg`.
- **Docker Compose** ([`compose.yaml`](compose.yaml)) menjalankan tiga container:
  - `db`: PostgreSQL 18 + PostGIS 3.6, sama dengan basis data lokal. Hanya bisa diakses dari VM itu sendiri.
  - `api`: server Express (`server/`) beserta penjadwal: gempa tiap 60 detik, gunung api tiap 30 menit, indikasi SIGAP tiap 12 jam. Migrasi dijalankan otomatis saat container mulai.
  - `web`: Caddy. Menyajikan hasil build Vite, meneruskan `/api` ke `api`, dan mengambil serta memperpanjang sertifikat HTTPS Let's Encrypt sendiri.
- **Firewall** (NSG `sigap-nsg`): port 80 dan 443 terbuka untuk umum, port 22 (SSH) hanya dari IP laptop pengelola.
- Perekam arsip tetap berjalan di GitHub Actions dan tidak bergantung pada server ini.

## Biaya

Langganan Azure for Students (kredit US$100, berlaku sampai 1 Okt 2027):
- **VM**: gratis 750 jam per bulan selama 12 bulan untuk ukuran B1s, B2pts v2, dan B2ats v2. Itu cukup untuk satu VM yang menyala 24 jam.
- **IP publik statis dan disk**: mungkin dipotong dari kredit, sekitar US$6–7 per bulan.

Pemakaian bisa dicek di Azure Portal → Cost Management. Kalau kredit habis, langganan dinonaktifkan; tidak ada tagihan ke kartu.

## Memperbarui server setelah ada commit baru

```powershell
ssh -i ~/.ssh/sigap_azure azureuser@sigap-bencana.malaysiawest.cloudapp.azure.com
```

Lalu di server:

```bash
cd /opt/sigap
git pull
docker compose -f deploy/compose.yaml up -d --build
```

Image dibangun ulang di VM, biasanya 1–3 menit. Data di basis data tidak berubah.

## Perawatan

| Perlu | Perintah (di `/opt/sigap` pada server) |
|---|---|
| Status container | `docker compose -f deploy/compose.yaml ps` |
| Log API | `docker compose -f deploy/compose.yaml logs -f --tail 100 api` |
| Kesehatan sumber data | `curl -s https://sigap-bencana.malaysiawest.cloudapp.azure.com/api/health` (bisa dari mana saja) |
| Cadangan basis data | `docker compose -f deploy/compose.yaml exec db pg_dump -U sigap -d sigap -Fc -f /tmp/cadangan.dump && docker compose -f deploy/compose.yaml cp db:/tmp/cadangan.dump .` lalu salin ke laptop dengan `scp` |
| Mulai ulang semua | `docker compose -f deploy/compose.yaml restart` |

**SSH dari IP baru.** IP rumah atau kampus bisa berganti. Buka lagi aksesnya dari laptop:

```powershell
az network nsg rule update -g sigap-rg --nsg-name sigap-nsg -n default-allow-ssh --source-address-prefixes <IP-baru>/32
```

**Data riset dari server (RQ2).** `sync_logs` di server mencatat ketersediaan sumber sejak server ini berjalan (13 Okt 2026); log dari laptop sengaja tidak dibawa. Untuk menjalankan `research/09_kinerja_sistem.py` pada data server, buka tunnel SSH, lalu arahkan `DATABASE_URL` ke tunnel itu. Kata sandi ada di `/opt/sigap/deploy/.env` pada server.

```powershell
ssh -i ~/.ssh/sigap_azure -N -L 5434:127.0.0.1:5432 azureuser@sigap-bencana.malaysiawest.cloudapp.azure.com
# terminal lain:
$env:DATABASE_URL = "postgresql://sigap:<POSTGRES_PASSWORD>@localhost:5434/sigap"
research/.venv/Scripts/python research/09_kinerja_sistem.py
```

**Menghentikan atau menghapus.** `az vm deallocate -g sigap-rg -n sigap-vm` mematikan VM (IP dan disk tetap ditagih). `az group delete -n sigap-rg` menghapus semuanya, termasuk basis data server.

## Membangun server dari nol

Langkah ini yang dipakai pada 13 Okt 2026. Prasyarat di laptop: Azure CLI (`winget install --exact --id Microsoft.AzureCLI`), `az login`, dan kunci SSH (`ssh-keygen -t ed25519 -f ~/.ssh/sigap_azure`).

1. **Pilih region.** Azure for Students hanya mengizinkan beberapa region per akun:

   ```powershell
   az policy assignment list --query "[].parameters.listOfAllowedLocations.value" -o tsv
   ```

   Untuk akun ini: centralindia, malaysiawest, indiasouthcentral, eastasia, koreacentral. Di malaysiawest, B2ats v2 diblokir di zona 1, jadi VM dibuat di zona 2.

2. **Buat VM.** Dari root repo. `deploy/cloud-init.yaml` memasang Docker, membuat swap, dan meng-clone repo ke `/opt/sigap`.

   ```powershell
   az group create -n sigap-rg -l malaysiawest
   az vm create -g sigap-rg -n sigap-vm -l malaysiawest --zone 2 --image Ubuntu2404 --size Standard_B2ats_v2 `
     --admin-username azureuser --ssh-key-values "$HOME\.ssh\sigap_azure.pub" `
     --public-ip-sku Standard --public-ip-address sigap-ip --public-ip-address-dns-name sigap-bencana --public-ip-address-allocation static `
     --storage-sku StandardSSD_LRS --os-disk-size-gb 32 --custom-data deploy/cloud-init.yaml --nsg sigap-nsg --nsg-rule SSH
   az network nsg rule update -g sigap-rg --nsg-name sigap-nsg -n default-allow-ssh --source-address-prefixes <IP-laptop>/32
   az network nsg rule create -g sigap-rg --nsg-name sigap-nsg -n allow-web --priority 1010 --direction Inbound --access Allow `
     --protocol '*' --source-address-prefixes Internet --destination-port-ranges 80 443
   ```

3. **Tunggu persiapan VM selesai, lalu isi `deploy/.env` di server:**

   ```bash
   cloud-init status --wait
   cd /opt/sigap
   umask 077
   printf "SITE_ADDRESS=sigap-bencana.malaysiawest.cloudapp.azure.com\nPOSTGRES_PASSWORD=%s\n" "$(openssl rand -hex 24)" > deploy/.env
   ```

4. **Pindahkan basis data dari laptop.** Batas wilayah, sesar, riwayat longsor, raster bahaya, dan titik pantau tidak perlu di-seed ulang dari BNPB (salinan ±7 MB). Di laptop, dari root repo, dengan Docker Desktop menyala:

   ```powershell
   docker compose exec db pg_dump -U sigap -d sigap -Fc -f /tmp/sigap.dump
   docker compose cp db:/tmp/sigap.dump sigap.dump
   scp -i ~/.ssh/sigap_azure sigap.dump azureuser@sigap-bencana.malaysiawest.cloudapp.azure.com:/opt/sigap/
   ```

5. **Pulihkan, lalu jalankan.** Di server:

   ```bash
   bash deploy/restore-db.sh sigap.dump && rm sigap.dump
   docker compose -f deploy/compose.yaml up -d --build
   ```

   `restore-db.sh` menolak bekerja bila basis data server sudah berisi tabel SIGAP. Bila pemulihan gagal di tengah jalan, hapus volume basis data (`docker compose -f deploy/compose.yaml down && docker volume rm sigap_pgdata`) lalu ulangi langkah 5. Volume `sigap_caddy_data` jangan dihapus: isinya sertifikat HTTPS, dan Let's Encrypt membatasi penerbitan ulang.

Indikasi SIGAP pertama dihitung otomatis ±7 menit setelah API menyala.

## Uji di laptop

Image produksi bisa dicoba tanpa HTTPS dan tanpa penjadwal, supaya tidak memakai kuota sumber data. Dari root repo:

```powershell
$env:SITE_ADDRESS=":80"; $env:HTTP_PORT="8080"; $env:HTTPS_PORT="8443"; $env:DB_PORT="5434"; $env:POSTGRES_PASSWORD="uji"; $env:SCHEDULER="off"
docker compose -p sigap-uji -f deploy/compose.yaml up -d --build   # buka http://localhost:8080
docker compose -p sigap-uji -f deploy/compose.yaml down -v
```

## Catatan

- Firewall situs ESDM kadang memblokir IP tertentu. Pada 13 Okt 2026, layanan peta PVMBG menolak IP rumah pengembang (HTTP 403) tetapi menerima IP server ini.
- `/api/risk` dibatasi 120 permintaan per 10 menit dan `/api/geocode` 60 per menit untuk tiap IP pengunjung (`server/src/lib/rate-limit.js`), supaya kuota gratis Open-Meteo dan antrean Nominatim tidak habis oleh satu pengguna.
