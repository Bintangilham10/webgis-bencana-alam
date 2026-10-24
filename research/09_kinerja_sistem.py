"""Kinerja sistem SIGAP (RQ2): ketersediaan sinkronisasi dan latensi data gempa.

Latensi dipisah menjadi dua bagian, karena BMKG baru menerbitkan gempa di feed
publiknya beberapa menit setelah kejadian (gempa dirasakan 15–31 menit pada uji
1 Okt 2026). Ukuran "gempa masuk ≤ 2 menit" yang dihitung dari waktu kejadian
karena itu mengukur BMKG, bukan SIGAP.

- Jeda sumber (BMKG): waktu kejadian → event muncul di feed. Hanya bisa diperkirakan
  untuk event yang tertangkap saat server sedang memantau (sinkronisasi sukses
  sebelumnya ≤ 2 menit sebelum event pertama terlihat). Nilainya batas atas, lebih
  besar paling banyak satu interval sinkronisasi.
- Jeda sistem (SIGAP): event muncul di feed → tersimpan di SIGAP. Batas atasnya
  first_seen_at − waktu mulai sinkronisasi sukses sebelumnya (event belum ada).
- Event yang pertama terlihat setelah server mati atau offline lebih dari 2 menit
  tidak dipakai untuk latensi, dan dilaporkan sebagai jumlah tersendiri.

Ketersediaan dihitung dari sync_logs. Kegagalan karena jaringan klien (DNS gagal,
mis. laptop offline) dipisah dari kegagalan sumber (HTTP 5xx, timeout, format
halaman berubah). Kegagalan sumber yang beruntun dilaporkan sebagai rentang.

Masukan: database SIGAP (events, sync_logs), dari DATABASE_URL.
Keluaran: results/<keluaran>.md dan results/<keluaran>.csv (bawaan kinerja_sistem).

Jalankan dari root repo: research/.venv/Scripts/python research/09_kinerja_sistem.py

Server produksi Azure (13–23 Okt 2026), dari dump yang dipulihkan ke basis data
terpisah tanpa TRUNCATE sync_logs. Baris sesudah VM dimatikan (10:30:49Z) berasal
dari penyalaan ulang untuk backup, jadi tidak dihitung:

  DATABASE_URL=postgresql://sigap:sigap@localhost:5433/sigap_produksi \\
    research/.venv/Scripts/python research/09_kinerja_sistem.py --keluaran kinerja_sistem_server \\
    --dari 2026-10-13T06:28:43Z --sampai 2026-10-23T10:30:49Z \\
    --keterangan "server produksi Azure (VM B2ats_v2, Docker Compose) yang menyala terus"
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone

import pandas as pd

from sigap_riset.db import connect
from sigap_riset.paths import RESULTS

# Interval penjadwal server (server/src/jobs/scheduler.js).
EXPECTED_INTERVAL_S = {'bmkg-gempa': 60, 'usgs-gempa': 60, 'emsc-gempa': 2 * 60, 'magma': 30 * 60, 'bmkg-cap': 5 * 60,
                       'indikasi-sigap': 12 * 60 * 60, 'osm-fasilitas': 7 * 24 * 60 * 60}
MONITORING_GAP_S = 120
CLIENT_NETWORK = r'ENOTFOUND|EAI_AGAIN|ENETUNREACH|getaddrinfo'
LOCAL_DESCRIPTION = ('database SIGAP lokal. Server lokal hanya berjalan saat laptop menyala, jadi angka ini mengukur '
                     'instalasi pengembangan, bukan layanan yang selalu aktif')


def query(sql: str, params: tuple = ()) -> pd.DataFrame:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return pd.DataFrame(cur.fetchall(), columns=[d.name for d in cur.description])


def load(dari: datetime | None = None, sampai: datetime | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    # Jendela [dari, sampai) berlaku untuk sinkronisasi dan untuk waktu event pertama
    # terlihat, jadi event dari masa sebelum jendela tidak dihitung sebagai event
    # yang terlihat sesudah server mati.
    window = (dari, dari, sampai, sampai)
    syncs = query(
        """SELECT source, ok, message, started_at, duration_ms FROM sync_logs
           WHERE (%s::timestamptz IS NULL OR started_at >= %s) AND (%s::timestamptz IS NULL OR started_at < %s)
           ORDER BY started_at""", window)
    # Sinkronisasi penemu = sinkronisasi yang sedang berjalan saat event pertama
    # disimpan (dimulai paling akhir sebelum first_seen_at). Yang dibandingkan
    # adalah sinkronisasi sukses sebelum itu, saat event belum ada di feed.
    events = query(
        """WITH e AS (
             SELECT id, magnitude, occurred_at, first_seen_at, props->>'dirasakan' IS NOT NULL AS dirasakan,
                    (SELECT max(s.started_at) FROM sync_logs s
                     WHERE s.source = 'bmkg-gempa' AND s.started_at <= events.first_seen_at) AS sync_penemu
             FROM events WHERE hazard = 'gempa' AND source = 'bmkg'
               AND (%s::timestamptz IS NULL OR first_seen_at >= %s) AND (%s::timestamptz IS NULL OR first_seen_at < %s)
           )
           SELECT e.*, (SELECT max(s.started_at) FROM sync_logs s
                        WHERE s.source = 'bmkg-gempa' AND s.ok AND s.started_at < e.sync_penemu) AS sync_sebelumnya
           FROM e ORDER BY occurred_at""", window)
    return syncs, events


def availability(syncs: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for source, group in syncs.groupby('source'):
        failures = group[~group['ok']]
        client = failures['message'].fillna('').str.contains(CLIENT_NETWORK, regex=True)
        span_s = (group['started_at'].max() - group['started_at'].min()).total_seconds()
        expected = span_s / EXPECTED_INTERVAL_S.get(source, 60) + 1
        rows.append({
            'sumber': source,
            'dari': group['started_at'].min(),
            'sampai': group['started_at'].max(),
            'sinkronisasi': len(group),
            'sukses': int(group['ok'].sum()),
            'persen_sukses': 100 * group['ok'].mean(),
            'gagal_jaringan_klien': int(client.sum()),
            'gagal_sumber': int((~client).sum()),
            'persen_sukses_tanpa_gagal_klien': 100 * group['ok'].sum() / max(len(group) - int(client.sum()), 1),
            'persen_slot_terjadwal_berjalan': min(100.0, 100 * len(group) / expected) if source in EXPECTED_INTERVAL_S else None,
        })
    return pd.DataFrame(rows)


def failure_streaks(syncs: pd.DataFrame, min_runs: int = 2) -> pd.DataFrame:
    """Kegagalan sumber beruntun (bukan jaringan klien) per sumber, dari yang terpanjang."""
    rows = []
    for source, group in syncs.groupby('source'):
        failed = ~group['ok'] & ~group['message'].fillna('').str.contains(CLIENT_NETWORK, regex=True)
        streak_id = (failed != failed.shift()).cumsum()
        for _, streak in group[failed].groupby(streak_id[failed]):
            if len(streak) < min_runs:
                continue
            after = group[(group['started_at'] > streak['started_at'].max()) & group['ok']]
            rows.append({
                'sumber': source,
                'gagal_pertama': streak['started_at'].min(),
                'gagal_terakhir': streak['started_at'].max(),
                'jumlah': len(streak),
                'pulih': after['started_at'].min() if not after.empty else None,
                'pesan': streak['message'].fillna('').mode().iat[0],
            })
    columns = ['sumber', 'gagal_pertama', 'gagal_terakhir', 'jumlah', 'pulih', 'pesan']
    return pd.DataFrame(rows, columns=columns).sort_values('jumlah', ascending=False, ignore_index=True)


def latency(events: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    events = events.copy()
    events['gap_s'] = (events['first_seen_at'] - events['sync_sebelumnya']).dt.total_seconds()
    events['jeda_sumber_mnt'] = (events['first_seen_at'] - events['occurred_at']).dt.total_seconds() / 60
    monitored = events[events['gap_s'].notna() & (events['gap_s'] <= MONITORING_GAP_S)]
    summary = {
        'event': len(events),
        'event_terpantau': len(monitored),
        # Tanpa sinkronisasi sukses sebelumnya: event sudah ada di feed saat pemantauan dimulai.
        'event_awal_pemantauan': int(events['gap_s'].isna().sum()),
        'event_setelah_server_mati': int((events['gap_s'] > MONITORING_GAP_S).sum()),
    }
    rows = []
    for label, group in (('semua terpantau', monitored), ('gempa dirasakan', monitored[monitored['dirasakan']]),
                         ('M ≥ 5 tidak dirasakan', monitored[~monitored['dirasakan']])):
        if group.empty:
            continue
        rows.append({
            'kelompok': label,
            'n': len(group),
            'jeda_sumber_median_mnt': group['jeda_sumber_mnt'].median(),
            'jeda_sumber_p90_mnt': group['jeda_sumber_mnt'].quantile(0.9),
            'jeda_sistem_maks_s': group['gap_s'].max(),
            'jeda_sistem_median_s': group['gap_s'].median(),
        })
    return pd.DataFrame(rows), summary


def markdown(avail: pd.DataFrame, streaks: pd.DataFrame, lat: pd.DataFrame, summary: dict, description: str) -> str:
    fmt = lambda x, d=1: '–' if x is None or pd.isna(x) else f'{x:.{d}f}'  # noqa: E731
    when = lambda t: '–' if t is None or pd.isna(t) else f'{t:%Y-%m-%d %H:%M}'  # noqa: E731
    lines = [
        '# Kinerja sistem SIGAP (RQ2)',
        '',
        f'Dihitung {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC dari {description}. Definisi ada di docstring '
        '`research/09_kinerja_sistem.py`.',
        '',
        '## Ketersediaan sinkronisasi',
        '',
        '| Sumber | Periode (UTC) | Sinkronisasi | Sukses | Gagal jaringan klien | Gagal sumber | Sukses tanpa gagal klien | Slot terjadwal yang berjalan |',
        '|---|---|---|---|---|---|---|---|',
    ]
    for r in avail.itertuples():
        lines.append(f'| {r.sumber} | {r.dari:%Y-%m-%d %H:%M} – {r.sampai:%Y-%m-%d %H:%M} | {r.sinkronisasi} | '
                     f'{fmt(r.persen_sukses)}% | {r.gagal_jaringan_klien} | {r.gagal_sumber} | '
                     f'{fmt(r.persen_sukses_tanpa_gagal_klien)}% | {fmt(r.persen_slot_terjadwal_berjalan)}% |')
    if not streaks.empty:
        lines += [
            '',
            '## Gangguan sumber beruntun',
            '',
            'Kegagalan sumber (bukan jaringan klien) minimal dua kali berturut-turut. Selama gangguan, data terakhir '
            'yang tersimpan tetap dilayani API.',
            '',
            '| Sumber | Gagal pertama (UTC) | Gagal terakhir (UTC) | Sinkronisasi gagal | Pulih (UTC) | Pesan |',
            '|---|---|---|---|---|---|',
        ]
        for r in streaks.itertuples():
            lines.append(f'| {r.sumber} | {when(r.gagal_pertama)} | {when(r.gagal_terakhir)} | {r.jumlah} | '
                         f'{"belum pulih di periode ini" if pd.isna(r.pulih) else when(r.pulih)} | {r.pesan} |')
    lines += [
        '',
        '## Latensi gempa BMKG',
        '',
        f'{summary["event"]} event; {summary["event_terpantau"]} tertangkap saat server sedang memantau '
        f'(sinkronisasi sukses ≤ {MONITORING_GAP_S} detik sebelumnya). {summary["event_awal_pemantauan"]} event sudah '
        f'ada di feed saat pemantauan dimulai (terlihat pada sinkronisasi pertama) dan {summary["event_setelah_server_mati"]} '
        'event baru terlihat setelah server mati atau offline; keduanya tidak dipakai untuk latensi.',
        '',
        '| Kelompok | n | Jeda sumber BMKG, median (menit) | p90 (menit) | Jeda sistem SIGAP, median (detik) | maks (detik) |',
        '|---|---|---|---|---|---|',
    ]
    for r in lat.itertuples():
        lines.append(f'| {r.kelompok} | {r.n} | {fmt(r.jeda_sumber_median_mnt)} | {fmt(r.jeda_sumber_p90_mnt)} | '
                     f'{fmt(r.jeda_sistem_median_s, 0)} | {fmt(r.jeda_sistem_maks_s, 0)} |')
    lines += [
        '',
        'Jeda sumber dihitung dari waktu kejadian sampai event pertama terlihat, jadi lebih besar paling banyak satu interval '
        'sinkronisasi (60 detik). Jeda sistem adalah batas atas waktu dari event terbit di feed sampai tersimpan di SIGAP.',
        '',
    ]
    return '\n'.join(lines)


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace('Z', '+00:00')).astimezone(timezone.utc)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--dari', type=utc, help='awal jendela (UTC, ISO 8601), inklusif')
    parser.add_argument('--sampai', type=utc, help='akhir jendela (UTC, ISO 8601), eksklusif')
    parser.add_argument('--keluaran', default='kinerja_sistem', help='nama berkas hasil tanpa ekstensi')
    parser.add_argument('--keterangan', default=LOCAL_DESCRIPTION, help='sumber data untuk kalimat pembuka laporan')
    args = parser.parse_args()

    syncs, events = load(args.dari, args.sampai)
    avail = availability(syncs)
    streaks = failure_streaks(syncs)
    lat, summary = latency(events)
    RESULTS.mkdir(parents=True, exist_ok=True)
    tables = [avail.assign(tabel='ketersediaan'), streaks.assign(tabel='gangguan'), lat.assign(tabel='latensi')]
    pd.concat([t for t in tables if not t.empty]).to_csv(RESULTS / f'{args.keluaran}.csv', index=False)
    text = markdown(avail, streaks, lat, summary, args.keterangan)
    (RESULTS / f'{args.keluaran}.md').write_text(text, encoding='utf-8')
    print(text)


if __name__ == '__main__':
    main()
