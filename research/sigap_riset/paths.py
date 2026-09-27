from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Data mentah, cache, dan hasil antara (tidak dikomit; bisa dibuat ulang).
DATA = ROOT / 'data'
CACHE = DATA / 'cache'
# Tabel dan gambar hasil analisis (dikomit).
RESULTS = ROOT / 'results'
