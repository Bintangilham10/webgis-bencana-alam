# Kinerja sistem SIGAP (RQ2)

Dihitung 2026-10-23 16:37 UTC dari server produksi Azure (VM B2ats_v2, Docker Compose) yang menyala terus. Definisi ada di docstring `research/09_kinerja_sistem.py`.

## Ketersediaan sinkronisasi

| Sumber | Periode (UTC) | Sinkronisasi | Sukses | Gagal jaringan klien | Gagal sumber | Sukses tanpa gagal klien | Slot terjadwal yang berjalan |
|---|---|---|---|---|---|---|---|
| bmkg-gempa | 2026-10-13 06:28 – 2026-10-23 10:30 | 14640 | 100.0% | 0 | 0 | 100.0% | 100.0% |
| indikasi-sigap | 2026-10-13 06:28 – 2026-10-23 06:28 | 21 | 100.0% | 0 | 0 | 100.0% | 100.0% |
| magma | 2026-10-13 06:28 – 2026-10-23 10:28 | 489 | 77.9% | 0 | 108 | 77.9% | 100.0% |

## Gangguan sumber beruntun

Kegagalan sumber (bukan jaringan klien) minimal dua kali berturut-turut. Selama gangguan, data terakhir yang tersimpan tetap dilayani API.

| Sumber | Gagal pertama (UTC) | Gagal terakhir (UTC) | Sinkronisasi gagal | Pulih (UTC) | Pesan |
|---|---|---|---|---|---|
| magma | 2026-10-21 04:58 | 2026-10-23 10:28 | 108 | belum pulih di periode ini | Variabel markersGunungApi tidak ditemukan |

## Latensi gempa BMKG

43 event; 26 tertangkap saat server sedang memantau (sinkronisasi sukses ≤ 120 detik sebelumnya). 17 event sudah ada di feed saat pemantauan dimulai (terlihat pada sinkronisasi pertama) dan 0 event baru terlihat setelah server mati atau offline; keduanya tidak dipakai untuk latensi.

| Kelompok | n | Jeda sumber BMKG, median (menit) | p90 (menit) | Jeda sistem SIGAP, median (detik) | maks (detik) |
|---|---|---|---|---|---|
| semua terpantau | 26 | 17.1 | 40.1 | 60 | 60 |
| gempa dirasakan | 26 | 17.1 | 40.1 | 60 | 60 |

Jeda sumber dihitung dari waktu kejadian sampai event pertama terlihat, jadi lebih besar paling banyak satu interval sinkronisasi (60 detik). Jeda sistem adalah batas atas waktu dari event terbit di feed sampai tersimpan di SIGAP.
