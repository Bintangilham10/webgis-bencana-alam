// Uji hitungan perekam latensi notifikasi. Jalankan di e2e/: npm run test:skrip
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clockOffset, createRecorder, parseSse, report, summarize, toRow } from './latensi-notifikasi.mjs';

describe('pembaca aliran SSE', () => {
  test('event lengkap dibaca, komentar dan baris retry dilewati, sisa yang belum lengkap dikembalikan', () => {
    const text = 'retry: 10000\n\n: ping\n\nid: 7\nevent: notification\ndata: {"id":7,"kind":"gempa"}\n\nid: 8\nevent: notif';
    const { events, rest } = parseSse(text);
    assert.deepEqual(events, [{ id: '7', event: 'notification', data: '{"id":7,"kind":"gempa"}' }]);
    assert.equal(rest, 'id: 8\nevent: notif');
  });

  test('event yang terpotong di tengah tersambung pada potongan berikutnya', () => {
    const first = parseSse('id: 9\nevent: notification\ndata: {"id":9,');
    assert.deepEqual(first.events, []);
    const second = parseSse(`${first.rest}"kind":"cuaca"}\n\n`);
    assert.equal(second.events[0].data, '{"id":9,"kind":"cuaca"}');
    assert.equal(second.rest, '');
  });

  test('akhir baris CRLF dan data beberapa baris', () => {
    const { events } = parseSse('event: notification\r\ndata: satu\r\ndata: dua\r\n\r\n');
    assert.deepEqual(events, [{ id: null, event: 'notification', data: 'satu\ndua' }]);
  });
});

describe('selisih jam', () => {
  test('memakai bolak-balik tercepat: jam server dibandingkan dengan tengah-tengah kirim dan terima', () => {
    const samples = [
      { sent: 1000, received: 1400, rtt: 400, serverMs: 6100 },
      { sent: 2000, received: 2040, rtt: 40, serverMs: 7030 },
      { sent: 3000, received: 3090, rtt: 90, serverMs: 8000 },
    ];
    assert.deepEqual(clockOffset(samples), { offset: 5010, rtt: 40 });
  });
});

describe('baris dan ringkasan', () => {
  const clock = { offset: 5000, rtt: 40 };
  const notification = (id, kind, created, source) => ({ id, kind, level: 1, created_at: created, source_time: source });
  // Perekam mulai mendengarkan pada jam klien 10.000 ms = jam server 15.000 ms (1970-01-01T00:00:15Z).
  const row = (n, receivedMs, extra = {}) => toRow({ notification: n, receivedMs, clock, liveSinceMs: 10_000, server: 'contoh.id', ...extra });
  // Baris seperti terbaca dari CSV: semua nilai berupa teks.
  const asCsv = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])));

  test('latensi memakai jam server; notifikasi yang dibuat sebelum sambungan adalah kiriman ulang', () => {
    const live = row(notification(1, 'gempa', '1970-01-01T00:00:20.000Z', '1970-01-01T00:00:02.000Z'), 15_120);
    assert.equal(live.latensi_ms, '120.0');
    assert.equal(live.jeda_sumber_s, '18.0');
    assert.equal(live.langsung, true);
    assert.equal(live.diterima_utc, '1970-01-01T00:00:15.120Z');
    const replay = row(notification(2, 'cuaca', '1970-01-01T00:00:12.000Z', null), 10_050);
    assert.equal(replay.langsung, false);
    assert.equal(replay.jeda_sumber_s, '');
  });

  test('selagi selisih jam belum diukur ulang sesudah perekam terhenti, notifikasi tidak dihitung', () => {
    const n = notification(1, 'gempa', '1970-01-01T00:00:20.000Z', '1970-01-01T00:00:02.000Z');
    assert.equal(row(n, 15_120, { stale: true }).langsung, false);
    // Dibuat sebelum perekam bangun (jam klien 16.000 ms = jam server 21.000 ms).
    assert.equal(row(n, 16_500, { liveSinceMs: 16_000 }).langsung, false);
  });

  test('ringkasan hanya menghitung notifikasi langsung, per server dan per jenis', () => {
    const rows = asCsv([
      row(notification(1, 'cuaca', '1970-01-01T00:00:20.000Z', '1970-01-01T00:00:00.000Z'), 15_100),
      row(notification(2, 'cuaca', '1970-01-01T00:00:20.000Z', '1970-01-01T00:00:05.000Z'), 15_300),
      row(notification(3, 'gempa', '1970-01-01T00:00:40.000Z', '1970-01-01T00:00:10.000Z'), 35_050),
      row(notification(4, 'cuaca', '1970-01-01T00:00:12.000Z', null), 10_050),
    ]);
    const [s] = summarize(rows);
    assert.equal(s.server, 'contoh.id');
    assert.deepEqual([s.diterima, s.tidak_langsung, s.rombongan, s.duplikat, s.sumber_negatif], [4, 1, 2, 0, 0]);
    assert.deepEqual(s.latensi_ms, { n: 3, min: 50, p50: 100, p90: 300, p95: 300, maks: 300 });
    assert.equal(s.ketidakpastian_jam_ms, 20);
    const cuaca = s.per_jenis.find((k) => k.jenis === 'cuaca');
    assert.deepEqual([cuaca.n, cuaca.latensi_ms.p50, cuaca.jeda_sumber_s.p50, cuaca.jeda_sumber_s.maks], [2, 100, 15, 20]);
    const text = report([s]);
    assert.match(text, /Notifikasi langsung \| 3 \(dalam 2 kali siaran\)/);
    assert.match(text, /Tidak dihitung \([^|]+\) \| 1 \|/);
    assert.match(text, /Latensi kirim, median \| 100 ms/);
    assert.match(text, /Peringatan dini cuaca BMKG \| 2 \| 100 ms \| 0,3 menit \| 0,3 menit/);
    assert.doesNotMatch(text, /Catatan:/);
  });

  test('gunung api: waktu sumbernya saat SIGAP melihat perubahan, jadi tidak diringkas sebagai jeda sumber', () => {
    const rows = asCsv([row(notification(5, 'gunung_api', '1970-01-01T00:00:30.000Z', '1970-01-01T00:00:29.900Z'), 25_080)]);
    const [s] = summarize(rows);
    const [gunung] = s.per_jenis;
    assert.deepEqual([gunung.n, gunung.latensi_ms.p50, gunung.jeda_sumber_s], [1, 80, null]);
    assert.match(report([s]), /Level gunung api \| 1 \| 80 ms \| — \| — \|/);
  });

  test('notifikasi yang terekam dua kali dihitung sekali; waktu sumber yang lebih baru dari waktu simpan tidak dihitung', () => {
    const quake = notification(6, 'gempa', '1970-01-01T00:00:20.000Z', '1970-01-01T00:00:25.000Z');
    const rows = asCsv([
      // Perekam pertama menerimanya sebagai kiriman ulang, perekam kedua secara langsung.
      row(quake, 15_400, { liveSinceMs: 15_200 }),
      row(quake, 15_090),
      row(notification(7, 'gempa', '1970-01-01T00:00:50.000Z', '1970-01-01T00:00:20.000Z'), 45_070),
      // id sama tetapi created_at lain = notifikasi lain (mis. basis data server dipulihkan).
      row(notification(7, 'gempa', '1970-01-01T00:01:10.000Z', '1970-01-01T00:00:40.000Z'), 65_110),
    ]);
    const [s] = summarize(rows);
    assert.deepEqual([s.diterima, s.duplikat, s.tidak_langsung, s.sumber_negatif], [3, 1, 0, 1]);
    assert.deepEqual(s.latensi_ms, { n: 3, min: 70, p50: 90, p90: 110, p95: 110, maks: 110 });
    const [gempa] = s.per_jenis;
    assert.deepEqual([gempa.n, gempa.jeda_sumber_s.n, gempa.jeda_sumber_s.p50], [3, 2, 30]);
    const text = report([s]);
    assert.match(text, /Catatan: 1 baris rekaman ganda/);
    assert.match(text, /Catatan: 1 notifikasi punya waktu sumber yang lebih baru/);
  });

  test('latensi negatif (di bawah ketelitian jam) tetap dihitung dan diberi catatan', () => {
    const rows = asCsv([row(notification(8, 'cuaca', '1970-01-01T00:00:20.000Z', '1970-01-01T00:00:00.000Z'), 14_996)]);
    const [s] = summarize(rows);
    assert.deepEqual([s.negatif, s.latensi_ms.min], [1, -4]);
    assert.match(report([s]), /Catatan: 1 latensi bernilai negatif/);
  });

  test('tidak ada notifikasi langsung: ringkasan menyebutnya dan tidak menghitung latensi', () => {
    const rows = asCsv([row(notification(4, 'cuaca', '1970-01-01T00:00:12.000Z', null), 10_050)]);
    const [s] = summarize(rows);
    assert.equal(s.latensi_ms, null);
    assert.match(report([s]), /Belum ada notifikasi langsung/);
  });
});

describe('perekam: sambung ulang dan laptop tidur', () => {
  const at = (ms) => new Date(ms).toISOString();
  const notification = (id, createdMs) => ({ id, kind: 'cuaca', level: 1, created_at: at(createdMs), source_time: null });
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  // Jam tiruan: `wall` = jam sistem, `mono` = jam penghitung perekam. Pengukuran selisih
  // jam baru selesai saat test memanggil measures[i].resolve() atau .reject().
  function setup() {
    const time = { wall: 100_000, mono: 100_000 };
    const measures = [];
    const warnings = [];
    const recorder = createRecorder({
      server: 'contoh.id',
      clock: { offset: 0, rtt: 20 },
      measure: () => new Promise((resolve, reject) => measures.push({ resolve, reject })),
      wallClock: () => time.wall,
      monotonic: () => time.mono,
      warn: (text) => warnings.push(text),
    });
    return { recorder, time, measures, warnings };
  }

  test('notifikasi yang sama tidak dicatat dua kali, dan Last-Event-ID memakai id terbesar', () => {
    const { recorder } = setup();
    const first = recorder.accept([notification(11, 101_000), notification(12, 101_000)], 101_050, 100_500);
    assert.deepEqual(first.map((row) => [row.id, row.langsung, row.latensi_ms]), [[11, true, '50.0'], [12, true, '50.0']]);
    assert.deepEqual(recorder.accept([], 102_000, 100_500), []);
    // Sambung lagi pada 114.000: server mengirim ulang 12 dan mengirim 13 yang terlewat.
    const again = recorder.accept([notification(12, 101_000), notification(13, 102_000)], 114_050, 114_000);
    assert.deepEqual(again.map((row) => [row.id, row.langsung]), [[13, false]]);
    assert.deepEqual([recorder.state.lastId, recorder.state.received], [13, 3]);
  });

  test('laptop tidur: yang dibuat sebelum bangun tidak dihitung, lalu selisih jam diukur ulang', async () => {
    const { recorder, time, measures, warnings } = setup();
    time.wall = 101_000;
    time.mono = 101_000;
    assert.equal(recorder.checkSuspend(), null);

    // Tidur 60 detik: jam sistem (dan jam server) maju, jam penghitung perekam berhenti.
    time.wall = 161_000;
    const woke = recorder.accept([notification(21, 130_000)], 101_005, 100_500);
    assert.deepEqual(woke.map((row) => row.langsung), [false]);
    assert.equal(recorder.state.stale, true);
    assert.match(warnings[0], /Perekam terhenti ±60 detik/);
    // Selagi jam belum diukur ulang, notifikasi baru pun belum dihitung.
    assert.deepEqual(recorder.accept([notification(22, 161_100)], 101_150, 100_500).map((row) => row.langsung), [false]);

    measures[0].resolve({ offset: 60_000, rtt: 30 });
    await settle();
    assert.deepEqual([recorder.state.stale, recorder.state.clock.offset, measures.length], [false, 60_000, 1]);
    // Dibuat selagi tidur tetapi baru tiba sekarang: tetap tidak dihitung.
    assert.deepEqual(recorder.accept([notification(23, 150_000)], 101_300, 100_500).map((row) => row.langsung), [false]);
    // Dibuat sesudah bangun: dihitung, dengan selisih jam yang baru.
    const live = recorder.accept([notification(24, 162_000)], 102_080, 100_500);
    assert.deepEqual(live.map((row) => [row.langsung, row.latensi_ms, row.selisih_jam_ms]), [[true, '80.0', '60000.0']]);
  });

  test('pengukuran jam yang dimulai sebelum laptop tidur tidak dipakai; yang gagal dibiarkan sampai berhasil', async () => {
    const { recorder, time, measures, warnings } = setup();
    recorder.refreshClock();
    time.wall += 60_000;
    recorder.checkSuspend();
    measures[0].resolve({ offset: 999, rtt: 5 });
    await settle();
    assert.deepEqual([recorder.state.clock.offset, recorder.state.stale], [0, true]);

    measures[1].reject(new Error('jaringan belum tersambung'));
    await settle();
    assert.equal(recorder.state.stale, true);
    assert.match(warnings.at(-1), /Jam server tidak terukur: jaringan belum tersambung/);

    recorder.refreshClock();
    measures[2].resolve({ offset: 60_000, rtt: 30 });
    await settle();
    assert.deepEqual([recorder.state.clock.offset, recorder.state.stale], [60_000, false]);
  });
});
