# Kinerja sistem SIGAP (RQ2)

Dihitung 2026-10-01 01:21 UTC dari database SIGAP lokal. Definisi ada di docstring `research/09_kinerja_sistem.py`. Server lokal hanya berjalan saat laptop menyala, jadi angka ini mengukur instalasi pengembangan, bukan layanan yang selalu aktif.

## Ketersediaan sinkronisasi

| Sumber | Periode (UTC) | Sinkronisasi | Sukses | Gagal jaringan klien | Gagal sumber | Sukses tanpa gagal klien | Slot terjadwal yang berjalan |
|---|---|---|---|---|---|---|---|
| bmkg-gempa | 2026-09-26 00:45 – 2026-10-01 01:21 | 4312 | 85.5% | 626 | 1 | 100.0% | 59.6% |
| indikasi-sigap | 2026-09-29 11:59 – 2026-09-30 14:06 | 5 | 100.0% | 0 | 0 | 100.0% | 100.0% |
| magma | 2026-09-26 00:45 – 2026-10-01 01:13 | 225 | 89.3% | 22 | 2 | 99.0% | 93.0% |

## Latensi gempa BMKG

40 event; 6 tertangkap saat server sedang memantau (sinkronisasi sukses ≤ 120 detik sebelumnya). 34 event baru terlihat setelah server mati atau offline dan tidak dipakai untuk latensi.

| Kelompok | n | Jeda sumber BMKG, median (menit) | p90 (menit) | Jeda sistem SIGAP, median (detik) | maks (detik) |
|---|---|---|---|---|---|
| semua terpantau | 6 | 22.6 | 28.1 | 60 | 60 |
| gempa dirasakan | 6 | 22.6 | 28.1 | 60 | 60 |

Jeda sumber dihitung dari waktu kejadian sampai event pertama terlihat, jadi lebih besar paling banyak satu interval sinkronisasi (60 detik). Jeda sistem adalah batas atas waktu dari event terbit di feed sampai tersimpan di SIGAP.
