# Panduan uji pengguna (lapis 5)

Lapis 5 rencana pengujian Tugas 1 (slide 17): responden mengerjakan 5 tugas nyata, lalu mengisi kuesioner SUS.

| Ukuran | Target |
|---|---|
| Responden | ≥ 15 mahasiswa dan warga |
| Skor SUS rata-rata | ≥ 68 (rata-rata umum skor SUS) |
| Tugas selesai tanpa bantuan | ≥ 90% |

Formulirnya: [`formulir-uji-pengguna.md`](formulir-uji-pengguna.md). Panduan ini untuk pemandu sesi.

## Persiapan

- **Situs.** Responden yang memakai HP sendiri butuh SIGAP yang online lewat HTTPS, karena browser menolak "Lokasi saya" di situs `http://`. Online-kan lagi lewat [`deploy/README.md`](../../deploy/README.md). Sesi tatap muka di laptop pemandu bisa memakai `npm run dev` / `npm run preview` di laptop itu.
- **Responden.** Campurkan mahasiswa dan warga di luar kampus (mis. 10 dan 5), juga pengguna HP dan laptop. Jangan memakai anggota kelompok sendiri.
- **Coba sendiri dulu.** Kerjakan kelima tugas sekali sebelum sesi pertama, untuk memastikan semuanya bisa diselesaikan hari itu dan kunci jawabannya masih sama. Kunci jawaban T1, T3 (b), T4, dan T5 berasal dari data SIGAP sendiri (batas wilayah, sesar aktif, legenda, nomor darurat), jadi tidak terpengaruh bila InaRISK BNPB sedang terganggu; pencarian "Lembang" memakai Nominatim (OpenStreetMap).
- **Siapkan:** formulir, lembar pengamatan di bawah (dicetak atau di spreadsheet), dan stopwatch HP.

## Jalannya sesi (±15 menit)

1. **Pembuka.** Bacakan:
   > "Terima kasih sudah mau membantu. Kami sedang menguji aplikasi SIGAP Bencana, jadi yang diuji aplikasinya, bukan Anda. Tidak ada jawaban yang salah. Silakan ceritakan apa yang Anda pikirkan sambil mengerjakan, misalnya 'saya cari tombol…'. Saya tidak akan banyak membantu, karena kami ingin tahu bagian mana yang membingungkan. Jawaban Anda tidak mencatat nama."
2. Responden mengisi **Bagian 1–2** formulir. Isikan kode responden (R01, R02, …).
3. **Tugas 1–5.** Responden membaca tugas dari formulir dan mengerjakannya di aplikasi. Mulai stopwatch saat tugas selesai dibaca, hentikan saat jawaban ditulis.
   - Jangan menunjuk tombol atau memberi petunjuk.
   - Bila responden meminta tolong dua kali, atau macet lebih dari 3 menit, beri petunjuk seperlunya dan catat **BB** (berhasil dengan bantuan). Bila tetap tidak bisa, catat **G** dan lanjut.
   - Pastikan pilihan "T… Hasil" di formulir sama dengan catatan Anda.
4. Responden mengisi **Bagian 4 (SUS)** sendiri, tanpa diskusi. Lalu Bagian 5.
5. **Penutup.** Tanyakan singkat bagian mana yang paling membingungkan, dan catat di kolom catatan.

## Kunci jawaban dan kriteria berhasil

| Tugas | Berhasil bila | Kunci jawaban |
|---|---|---|
| T1 Cari kab/kota | Kartu cek risiko **Kabupaten Garut** terbuka lewat pencarian | Jawa Barat |
| T2 Cek risiko | Kartu "Profil risiko lokasi" tampil untuk titik pilihan responden (judul "Lokasi Anda" atau "Titik pilihan"), bukan hasil pencarian | Kab/kota yang tertulis di kartu itu |
| T3 Baca level | (a) sama dengan kotak paling atas di layar saat itu; (b) dibaca benar | (a) sesuai layar (berubah tiap hari mengikuti prakiraan hujan); (b) Sesar Lembang, ±1,4 km. Bagian sesar dilayani basis data SIGAP, jadi tetap tampil walau layanan BNPB terganggu |
| T4 Ganti lapisan | Lapisan "Riwayat longsor" menyala dan legendanya dibaca | 2024–2025 |
| T5 Nomor darurat | Nomor ditemukan di aplikasi (tab Info, bagian Nomor darurat) | 117 |

Yang dihitung "selesai" untuk target 90% hanya **berhasil sendiri** (B).

## Lembar pengamatan

Isi satu baris per responden. Kode hasil: **B** berhasil sendiri, **BB** berhasil dengan bantuan, **G** tidak berhasil; waktu dalam menit:detik.

| Kode | Perangkat | T1 | T2 | T3 | T4 | T5 | Catatan (bagian yang membingungkan, komentar) |
|---|---|---|---|---|---|---|---|
| R01 | | B / 0:35 | | | | | |
| R02 | | | | | | | |
| R03 | | | | | | | |
| R04 | | | | | | | |
| R05 | | | | | | | |
| R06 | | | | | | | |
| R07 | | | | | | | |
| R08 | | | | | | | |
| R09 | | | | | | | |
| R10 | | | | | | | |
| R11 | | | | | | | |
| R12 | | | | | | | |
| R13 | | | | | | | |
| R14 | | | | | | | |
| R15 | | | | | | | |

## Menghitung hasil

1. Di Google Forms: tab **Respons** → menu ⋮ → **Unduh respons (.csv)**, lalu ekstrak berkas zip-nya.
2. Hitung:

   ```bash
   cd e2e
   npm run sus -- "C:\path\ke\jawaban.csv"
   ```

   Ringkasannya tampil di layar dan ditulis ke `e2e/hasil/lapis5-sus.md`: jumlah responden, skor SUS rata-rata dengan interval kepercayaan 95%, median, persentase responden ≥ 68, keberhasilan tiap tugas, rata-rata tiap pernyataan SUS, dan profil responden, masing-masing dibandingkan dengan target.
3. Salin ringkasan itu ke baris lapis 5 di [`README.md`](README.md) beserta temuan dari kolom catatan (mis. tugas yang paling sering gagal dan alasannya).

**Privasi.** Formulir tidak meminta nama atau kontak, tetapi kolom komentar bisa berisi hal pribadi. Simpan CSV mentah di Drive kelompok saja, jangan dikomit ke repo; yang masuk repo cukup ringkasan hasilnya.
