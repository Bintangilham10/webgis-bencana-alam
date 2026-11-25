// Uji hitungan perekam latensi notifikasi. Jalankan di e2e/: npm run test:skrip
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseCsv } from './csv.mjs';
import { clockOffset, createRecorder, createWriter, parseSse, report, sessionLine, sessionsOf, summarize, toRow } from './latensi-notifikasi.mjs';

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

describe('penulis baris: di luar pembacaan aliran, dan mencoba lagi bila berkas terkunci', () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const row = (id, langsung = true) => ({
    diterima_utc: `1970-01-01T00:00:0${id}.000Z`, server: 'contoh.id', id, jenis: 'cuaca', level: 1, dibuat_utc: '1970-01-01T00:00:00.000Z',
    sumber_utc: '', latensi_ms: '12.0', jeda_sumber_s: '', selisih_jam_ms: '0.0', rtt_ms: '20.0', langsung,
  });
  const locked = () => Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
  const ids = (text) => text.split('\n').filter(Boolean).map((line) => Number(line.split(',')[2]));

  // Berkas tiruan: tiap penulisan baru selesai saat test memanggil writes[i].ok() atau .fail().
  function setup() {
    const file = { text: '' };
    const writes = [];
    const logs = [];
    const warnings = [];
    const append = (text) => new Promise((resolve, reject) => {
      writes.push({
        text,
        ok: () => {
          file.text += text;
          resolve();
        },
        fail: () => reject(locked()),
      });
    });
    const writer = createWriter({ append, log: (line) => logs.push(line), warn: (line) => warnings.push(line) });
    return { writer, file, writes, logs, warnings };
  }

  test('satu penulisan pada satu waktu, urutan terjaga, dan baris baru dicetak sesudah tertulis', async () => {
    const { writer, file, writes, logs } = setup();
    const first = writer.add([row(1), row(2, false)]);
    // Tiba selagi penulisan pertama belum selesai.
    writer.add([row(3)]);
    assert.equal(writes.length, 1);
    assert.deepEqual(logs, []);
    writes[0].ok();
    await settle();
    assert.equal(writes.length, 2);
    writes[1].ok();
    await first;
    await settle();
    assert.deepEqual(ids(file.text), [1, 2, 3]);
    assert.equal(writer.pending(), 0);
    assert.deepEqual(logs, ['  00:00:01 cuaca #1: 12.0 ms', '  00:00:02 cuaca #2: tidak dihitung', '  00:00:03 cuaca #3: 12.0 ms']);
    assert.match(file.text, /^1970-01-01T00:00:01\.000Z,contoh\.id,1,cuaca,1,1970-01-01T00:00:00\.000Z,,12\.0,,0\.0,20\.0,true\n/);
  });

  test('berkas terkunci: baris disimpan, diperingatkan sekali, lalu ditulis sekaligus saat berkas terbuka lagi', async () => {
    const { writer, file, writes, logs, warnings } = setup();
    writer.add([row(1)]);
    writes[0].fail();
    await settle();
    assert.equal(writer.pending(), 1);
    assert.match(warnings[0], /Rekaman belum bisa ditulis \(EBUSY\)/);
    assert.deepEqual(logs, []);

    // Notifikasi berikutnya mencoba lagi, masih terkunci.
    writer.add([row(2)]);
    writes[1].fail();
    await settle();
    assert.deepEqual([writer.pending(), warnings.length], [2, 1]);
    assert.deepEqual(ids(writer.unwritten()), [1, 2]);

    // Percobaan berkala berikutnya berhasil.
    const retry = writer.flush();
    assert.deepEqual(ids(writes[2].text), [1, 2]);
    writes[2].ok();
    await retry;
    await settle();
    assert.deepEqual(ids(file.text), [1, 2]);
    assert.equal(writer.pending(), 0);
    assert.match(warnings[1], /Rekaman bisa ditulis lagi/);
    assert.equal(logs.length, 2);
  });

  test('flush tanpa baris yang menunggu tidak menulis apa pun', async () => {
    const { writer, writes } = setup();
    await writer.flush();
    assert.equal(writes.length, 0);
  });
});

describe('sesi perekaman: kapan perekam mendengarkan', () => {
  const server = 'contoh.id';
  const event = (sesi, kejadian, waktu_utc, detik = '', catatan = '') => ({ sesi, server, kejadian, waktu_utc, detik: String(detik), catatan });
  // Baris seperti terbaca dari CSV rekaman.
  const row = (id, diterima_utc, langsung = true) => ({
    diterima_utc, server, id: String(id), jenis: 'cuaca', level: '1', dibuat_utc: diterima_utc, sumber_utc: '',
    latensi_ms: '15.0', jeda_sumber_s: '', selisih_jam_ms: '0.0', rtt_ms: '24.0', langsung: String(langsung),
  });
  const day1 = (clock) => `2026-01-01T${clock}.000Z`;
  const day2 = (clock) => `2026-01-02T${clock}.000Z`;

  test('baris catatan sesi terbaca lagi sebagai sesi: mulai, terhenti, selesai', () => {
    const sesi = day1('01:00:00');
    const at = (clock) => Date.parse(day1(clock));
    const text = [
      'sesi,server,kejadian,waktu_utc,detik,catatan\n',
      sessionLine({ sesi, server, kejadian: 'mulai', waktuMs: at('01:00:00') }),
      sessionLine({ sesi, server, kejadian: 'terhenti', waktuMs: at('02:00:00'), detik: 600 }),
      sessionLine({ sesi, server, kejadian: 'terhenti', waktuMs: at('03:00:00'), detik: 60 }),
      sessionLine({ sesi, server, kejadian: 'selesai', waktuMs: at('04:10:00') }),
    ].join('');
    assert.match(text, /\n2026-01-01T01:00:00\.000Z,contoh\.id,terhenti,2026-01-01T02:00:00\.000Z,600,\n/);
    assert.deepEqual(sessionsOf(parseCsv(text).records), [{ server, mulai: sesi, selesai: day1('04:10:00'), terhenti_s: 660, catatan: [] }]);
  });

  test('dua perekam bersamaan dan sesi tanpa akhir tidak tertukar; urut waktu mulai', () => {
    const sessions = sessionsOf([
      event(day2('10:00:00'), 'mulai', day2('10:00:00')),
      event(day1('01:00:00'), 'mulai', day1('01:00:00'), '', 'diisi belakangan'),
      event(day1('01:05:00'), 'mulai', day1('01:05:00')),
      event(day1('01:00:00'), 'selesai', day1('02:00:00'), '', 'diisi belakangan'),
      event(day2('10:00:00'), 'selesai', day2('11:00:00')),
    ]);
    assert.deepEqual(sessions.map((s) => [s.mulai, s.selesai]), [
      [day1('01:00:00'), day1('02:00:00')],
      [day1('01:05:00'), null],
      [day2('10:00:00'), day2('11:00:00')],
    ]);
    assert.deepEqual(sessions[0].catatan, ['diisi belakangan']);
  });

  test('ringkasan menyebut tiap sesi, bukan satu rentang dari baris pertama sampai terakhir', () => {
    const events = [
      event(day1('01:00:00'), 'mulai', day1('01:00:00')),
      event(day1('01:00:00'), 'selesai', day1('04:10:00')),
      event(day2('10:00:00'), 'mulai', day2('10:00:00')),
      event(day2('10:00:00'), 'terhenti', day2('10:40:00'), 600),
      event(day2('10:00:00'), 'selesai', day2('11:00:00')),
    ];
    const rows = [row(1, day1('01:30:00')), row(2, day1('02:00:00')), row(3, day1('03:00:00'), false), row(4, day2('10:50:00'))];
    const [s] = summarize(rows, events);
    assert.deepEqual(s.sesi.map((k) => [k.nomor, k.lama_s, k.langsung, k.terhenti_s]), [[1, 11_400, 2, 0], [2, 3000, 1, 600]]);
    assert.equal(s.tanpa_sesi.n, 0);
    const text = report([s]);
    assert.match(text, /Direkam dalam 2 sesi, lama mendengarkan seluruhnya 4 jam\. Di luar sesi perekam tidak berjalan/);
    assert.match(text, /\| 1 \| 2026-01-01 01:00:00 \| 2026-01-01 04:10:00 \| 3 jam 10 menit \| 2 \|/);
    assert.match(text, /\| 2 \| 2026-01-02 10:00:00 \| 2026-01-02 11:00:00 \| 50 menit \| 1 \|/);
    assert.match(text, /Sesi 2: perekam sempat terhenti 10 menit \(laptop tidur\)/);
    assert.doesNotMatch(text, /Direkam 2026/);
    assert.match(text, /Notifikasi langsung \| 3 \(dalam 3 kali siaran\)/);
  });

  test('sesi tanpa akhir berlangsung sampai sesi berikutnya dan lamanya tidak dihitung; baris di luar sesi disebut terpisah', () => {
    const events = [
      event(day1('01:00:00'), 'mulai', day1('01:00:00')),
      event(day1('05:00:00'), 'mulai', day1('05:00:00')),
      event(day1('05:00:00'), 'selesai', day1('06:00:00'), '', 'waktu selesai diisi belakangan'),
    ];
    const rows = [row(1, day1('00:30:00')), row(2, day1('02:00:00')), row(3, day1('05:30:00')), row(4, day1('06:00:01'))];
    const [s] = summarize(rows, events);
    assert.deepEqual(s.sesi.map((k) => [k.selesai, k.lama_s, k.langsung, k.baris_terakhir]), [
      [null, null, 1, day1('02:00:00')],
      [day1('06:00:00'), 3600, 1, day1('05:30:00')],
    ]);
    assert.deepEqual(s.tanpa_sesi, { n: 2, dari: day1('00:30:00'), sampai: day1('06:00:01') });
    const text = report([s]);
    assert.match(text, /Direkam dalam 2 sesi, lama mendengarkan seluruhnya 1 jam \(di luar 1 sesi yang akhirnya tidak tercatat\)\./);
    assert.match(text, /\| 1 \| 2026-01-01 01:00:00 \| tidak tercatat \| — \| 1 \|/);
    assert.match(text, /Sesi 1: perekam berhenti tanpa menulis akhir sesinya, jadi lamanya tidak dihitung \(notifikasi terakhirnya 2026-01-01 02:00:00 UTC\)\./);
    assert.match(text, /Sesi 2: waktu selesai diisi belakangan\./);
    assert.match(text, /2 notifikasi direkam di luar sesi yang tercatat: notifikasi pertama diterima 2026-01-01 00:30:00 UTC, terakhir 2026-01-01 06:00:01 UTC\./);
  });

  test('tanpa catatan sesi: hanya waktu notifikasi pertama dan terakhir, dengan peringatan', () => {
    const text = report(summarize([row(1, day1('01:30:00')), row(2, day2('10:50:00'))]));
    assert.match(text, /Sesi perekaman tidak dicatat: notifikasi pertama diterima 2026-01-01 01:30:00 UTC, terakhir 2026-01-02 10:50:00 UTC\. Perekam belum tentu berjalan terus/);
    assert.doesNotMatch(text, /Direkam dalam/);
  });

  test('sesi yang belum menerima notifikasi tetap ditulis', () => {
    const events = [event(day1('01:00:00'), 'mulai', day1('01:00:00')), event(day1('01:00:00'), 'selesai', day1('01:00:20'))];
    const text = report(summarize([], events));
    assert.match(text, /## contoh\.id/);
    assert.match(text, /\| 1 \| 2026-01-01 01:00:00 \| 2026-01-01 01:00:20 \| kurang dari 1 menit \| 0 \|/);
    assert.match(text, /Belum ada notifikasi langsung \(0 diterima/);
  });

  test('perekam yang terhenti melapor lamanya, untuk catatan sesi', () => {
    const time = { wall: 100_000 };
    const gaps = [];
    const recorder = createRecorder({
      server, clock: { offset: 0, rtt: 20 }, measure: () => new Promise(() => {}),
      wallClock: () => time.wall, monotonic: () => time.wall, warn: () => {}, onSuspend: (gap) => gaps.push(gap),
    });
    time.wall += 1000;
    recorder.checkSuspend();
    time.wall += 90_000;
    recorder.checkSuspend();
    assert.deepEqual(gaps, [90_000]);
  });
});
