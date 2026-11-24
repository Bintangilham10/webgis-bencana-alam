# Latensi notifikasi langsung

Dibuat oleh `e2e/scripts/latensi-notifikasi.mjs` dari berkas rekamannya, `latensi_notifikasi.csv`.

## sigap-bencana.malaysiawest.cloudapp.azure.com

Direkam 2026-11-24T09:54:04.643Z sampai 2026-11-24T12:50:56.919Z.

| Hal | Nilai |
|---|---|
| Notifikasi langsung | 34 (dalam 13 kali siaran) |
| Tidak dihitung (kiriman ulang setelah sambungan putus, atau dibuat selagi perekam terhenti) | 0 |
| Latensi kirim, median | 14 ms |
| Latensi kirim, persentil ke-90 | 19 ms |
| Latensi kirim, persentil ke-95 | 26 ms |
| Latensi kirim, tercepat dan terlama | 13 ms dan 28 ms |
| Ketidakpastian jam klien–server | paling besar ±13 ms |

| Jenis | Notifikasi | Latensi kirim, median | Sejak waktu sumber, median | Sejak waktu sumber, persentil ke-90 |
|---|---|---|---|---|
| Peringatan dini cuaca BMKG | 34 | 14 ms | 19,1 menit | 34,1 menit |

Latensi kirim dihitung dari saat server menyimpan notifikasi sampai datanya tiba di klien perekam; waktu menggambar notifikasi di layar tidak termasuk. Persentil memakai cara peringkat terdekat.

Jam klien dan server disamakan lewat `/api/time`: tujuh kali bolak-balik, dipakai yang tercepat, diulang tiap menit dan tiap kali menyambung lagi. Ketidakpastiannya paling besar setengah waktu bolak-balik, ditambah geser jam klien sejak pengukuran terakhir.

Jeda sejak waktu sumber dihitung dari waktu yang dicantumkan sumber (waktu gempa terjadi, waktu BMKG menerbitkan peringatan) sampai server menyimpan notifikasinya. Di dalamnya ada jeda sumber menerbitkan datanya dan selang SIGAP memeriksa sumber itu (gempa tiap 1 menit, peringatan cuaca tiap 5 menit). Untuk gunung api tidak dihitung: MAGMA tidak mencantumkan waktu penetapan level, jadi yang tercatat adalah saat SIGAP melihat perubahannya.
