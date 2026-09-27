from datetime import date

BULAN = {
    'januari': 1, 'februari': 2, 'maret': 3, 'april': 4, 'mei': 5, 'juni': 6,
    'juli': 7, 'agustus': 8, 'september': 9, 'oktober': 10, 'november': 11, 'desember': 12,
}
TZ_OFFSET_JAM = {'WIB': 7, 'WITA': 8, 'WIT': 9}


def dasarian(d: date) -> tuple[int, int, int]:
    """Dasarian BMKG: tanggal 1–10, 11–20, 21–akhir bulan."""
    return d.year, d.month, 1 if d.day <= 10 else 2 if d.day <= 20 else 3


def month_index(year: int, month: int) -> int:
    return year * 12 + month - 1


def dasarian_index(year: int, month: int, num: int) -> int:
    return month_index(year, month) * 3 + num - 1
