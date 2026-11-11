# Formulir uji pengguna (Google Form)

Teks untuk membuat Google Form uji pengguna SIGAP Bencana (lapis 5 rencana pengujian Tugas 1: 5 tugas nyata dan kuesioner SUS, ≥ 15 responden). Cara memandu sesinya ada di [`panduan-uji-pengguna.md`](panduan-uji-pengguna.md).

**Sebelum menyalin:**

- Buat formulir baru di Google Forms. Di **Setelan**, matikan "Kumpulkan alamat email" dan "Batasi ke 1 tanggapan", supaya responden tidak perlu masuk akun dan tetap anonim.
- Jenis pertanyaan ditulis dalam [kurung siku]. Pertanyaan bertanda **wajib** dinyalakan "Wajib diisi".
- **Salin awalan judul pertanyaan apa adanya.** Skrip penghitung (`npm run sus` di `e2e/`) mengenali kolom dari awalan "T1 Hasil" … "T5 Hasil" dan "S1." … "S10.".
- Ganti `<alamat situs>` dengan alamat SIGAP yang dipakai saat uji.

---

**Judul formulir:** Uji Coba SIGAP Bencana

**Deskripsi formulir:**

> Terima kasih bersedia mencoba SIGAP Bencana, peta peringatan dini dan mitigasi bencana untuk seluruh Indonesia. Uji coba ini bagian dari Tugas Besar mata kuliah Teknologi Pemetaan Berbasis Web, Telkom University.
>
> Anda akan mengerjakan 5 tugas singkat di aplikasi, lalu menilai 10 pernyataan tentang pengalaman Anda. Waktunya sekitar 10–15 menit. Yang diuji adalah aplikasinya, bukan Anda, jadi tidak ada jawaban yang salah. Formulir ini tidak mencatat nama, email, atau kontak, dan jawaban hanya dipakai untuk laporan tugas besar.
>
> Buka aplikasinya di: `<alamat situs>`

## Bagian 1: Persetujuan

1. **Saya bersedia ikut uji coba ini dan jawaban saya dipakai untuk laporan tugas besar.** [Pilihan ganda, wajib]
   - Ya, saya bersedia
2. **Kode responden** [Jawaban singkat]
   Deskripsi: "Diisi pemandu bila uji didampingi, mis. R01. Kosongkan bila mengisi sendiri."

## Bagian 2: Tentang Anda

3. **Status** [Pilihan ganda, wajib]: Mahasiswa · Pelajar · Bekerja · Lainnya
4. **Usia** [Pilihan ganda, wajib]: Di bawah 18 tahun · 18–24 tahun · 25–34 tahun · 35–44 tahun · 45 tahun ke atas
5. **Perangkat yang dipakai untuk uji coba ini** [Pilihan ganda, wajib]: HP Android · iPhone · Laptop/komputer
6. **Seberapa sering Anda memakai aplikasi peta (mis. Google Maps)?** [Pilihan ganda, wajib]: Hampir setiap hari · Beberapa kali seminggu · Jarang · Tidak pernah
7. **Pernahkah Anda mencari informasi bencana di situs atau aplikasi resmi (BMKG, InaRISK, MAGMA)?** [Pilihan ganda, wajib]: Pernah · Belum pernah

## Bagian 3: Lima tugas

Deskripsi bagian:

> Kerjakan tugas berurutan di aplikasi, lalu jawab pertanyaannya. Mulai dari halaman depan dan tekan "Buka peta". Bila macet lebih dari 3 menit, pilih "Tidak berhasil" lalu lanjut ke tugas berikutnya.

**Tugas 1.** Cari **Kabupaten Garut** lewat kotak pencarian di bagian atas peta.

8. **T1 Jawaban: provinsi apa yang tertulis di bawah judul kartu yang muncul?** [Jawaban singkat]
9. **T1 Hasil** [Pilihan ganda, wajib]: Berhasil sendiri · Berhasil dengan bantuan · Tidak berhasil

**Tugas 2.** Cek risiko di titik pilihan Anda sendiri (rumah, kampus, atau tempat lain) dengan tombol **"Lokasi saya"** atau **"Pilih di peta"**, atau dengan klik kanan / tekan lama di peta.

10. **T2 Jawaban: kabupaten/kota apa yang tertulis di kartu?** [Jawaban singkat]
11. **T2 Hasil** [Pilihan ganda, wajib]: Berhasil sendiri · Berhasil dengan bantuan · Tidak berhasil

**Tugas 3.** Cari **Lembang** (pilih yang di Bandung Barat), lalu baca kartu cek risiko yang muncul.

12. **T3 Jawaban (a): apa status 3 hari ke depan di kotak paling atas kartu?** [Pilihan ganda]: Normal · Waspada · Siaga · Awas · Lainnya (mis. belum dapat dinilai)
13. **T3 Jawaban (b): di bagian "Sekitar lokasi", apa nama sesar aktif terdekat?** [Jawaban singkat]
14. **T3 Hasil** [Pilihan ganda, wajib]: Berhasil sendiri · Berhasil dengan bantuan · Tidak berhasil

**Tugas 4.** Buka tab **"Lapisan"**, nyalakan **"Riwayat longsor"**, lalu buka **legenda** di bawah peta.

15. **T4 Jawaban: menurut legenda, segitiga ungu paling gelap berarti kejadian tahun berapa?** [Jawaban singkat]
16. **T4 Hasil** [Pilihan ganda, wajib]: Berhasil sendiri · Berhasil dengan bantuan · Tidak berhasil

**Tugas 5.** Temukan nomor telepon **BNPB** untuk informasi bencana di dalam aplikasi.

17. **T5 Jawaban: nomornya berapa?** [Jawaban singkat]
18. **T5 Hasil** [Pilihan ganda, wajib]: Berhasil sendiri · Berhasil dengan bantuan · Tidak berhasil

## Bagian 4: Pengalaman Anda

Deskripsi bagian:

> Untuk setiap pernyataan, pilih angka yang paling sesuai dengan pengalaman Anda tadi: 1 = sangat tidak setuju, 5 = sangat setuju. Jawab semua pernyataan; kesan pertama Anda sudah cukup.

Sepuluh pertanyaan berikut semuanya [Skala linier 1–5, wajib], label 1 "Sangat tidak setuju" dan label 5 "Sangat setuju". Urutan dan bunyi pernyataan jangan diubah: ini *System Usability Scale* (Brooke 1996) versi bahasa Indonesia yang sudah diuji (Sharfina dan Santoso 2016).

19. **S1. Saya berpikir akan menggunakan sistem ini lagi.**
20. **S2. Saya merasa sistem ini rumit untuk digunakan.**
21. **S3. Saya merasa sistem ini mudah digunakan.**
22. **S4. Saya membutuhkan bantuan dari orang lain atau teknisi dalam menggunakan sistem ini.**
23. **S5. Saya merasa fitur-fitur sistem ini berjalan dengan semestinya.**
24. **S6. Saya merasa ada banyak hal yang tidak konsisten (tidak serasi pada sistem ini).**
25. **S7. Saya merasa orang lain akan memahami cara menggunakan sistem ini dengan cepat.**
26. **S8. Saya merasa sistem ini membingungkan.**
27. **S9. Saya merasa tidak ada hambatan dalam menggunakan sistem ini.**
28. **S10. Saya perlu membiasakan diri terlebih dahulu sebelum menggunakan sistem ini.**

## Bagian 5: Masukan (opsional)

29. **Apa yang paling membantu dari SIGAP Bencana?** [Paragraf]
30. **Apa yang membingungkan atau perlu diperbaiki?** [Paragraf]

**Pesan konfirmasi** (Setelan → Presentasi): "Terima kasih! Jawaban Anda sudah tersimpan."

---

Rujukan: J. Brooke, "SUS: A 'quick and dirty' usability scale", dalam *Usability Evaluation in Industry*, 1996. Z. Sharfina dan H. B. Santoso, "An Indonesian adaptation of the System Usability Scale (SUS)", ICACSIS 2016. Cocokkan sekali lagi bunyi kesepuluh pernyataan dengan makalah Sharfina dan Santoso sebelum formulir disebar.
