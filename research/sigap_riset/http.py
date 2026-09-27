"""Klien HTTP untuk skrip riset.

Setiap respons disimpan di cache disk, jadi skrip bisa diulang tanpa membebani
server sumber, dan hasilnya tetap sama selama cache ada. Request ke jaringan
diberi jeda minimum, dan waktu pengambilannya dicatat di _manifest.jsonl.
"""

from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from .paths import CACHE

USER_AGENT = 'SIGAP-Riset/0.1 (+https://github.com/Bintangilham10/webgis-bencana-alam)'
NOT_FOUND = '__HTTP_404__'
MAX_ATTEMPTS = 4


class Client:
    def __init__(self, name: str, min_interval_s: float = 1.0):
        self.dir = CACHE / name
        self.dir.mkdir(parents=True, exist_ok=True)
        self.min_interval_s = min_interval_s
        self.network_requests = 0
        self._last = 0.0
        self._session = requests.Session()
        self._session.headers['User-Agent'] = USER_AGENT

    def _file(self, key: str) -> Path:
        return self.dir / f'{hashlib.sha256(key.encode()).hexdigest()[:32]}.txt'

    def _log(self, key: str, url: str, status: int) -> None:
        with (self.dir / '_manifest.jsonl').open('a', encoding='utf-8') as f:
            record = {'file': self._file(key).name, 'url': url, 'status': status, 'fetched_at': datetime.now(timezone.utc).isoformat()}
            f.write(json.dumps(record) + '\n')

    def text(self, url: str, data: dict | None = None, timeout: float = 60) -> str | None:
        """Isi respons sebagai teks (BOM dibuang); None bila 404."""
        key = url if data is None else f'{url}\n{json.dumps(data, sort_keys=True)}'
        file = self._file(key)
        if file.exists():
            content = file.read_text(encoding='utf-8')
            return None if content == NOT_FOUND else content

        for attempt in range(MAX_ATTEMPTS):
            wait = self.min_interval_s - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            try:
                if data is None:
                    res = self._session.get(url, timeout=timeout)
                else:
                    res = self._session.post(url, data=data, timeout=timeout)
            except requests.RequestException:
                self._last = time.monotonic()
                if attempt == MAX_ATTEMPTS - 1:
                    raise
                time.sleep(5 * 2**attempt)
                continue
            self._last = time.monotonic()
            self.network_requests += 1

            if res.status_code == 404:
                file.write_text(NOT_FOUND, encoding='utf-8')
                self._log(key, url, 404)
                return None
            # Server sibuk atau kuota habis: tunggu lebih lama lalu coba lagi.
            if res.status_code == 429 or res.status_code >= 500:
                if attempt == MAX_ATTEMPTS - 1:
                    res.raise_for_status()
                time.sleep(10 * 2**attempt)
                continue
            res.raise_for_status()
            # requests menebak ISO-8859-1 untuk HTML tanpa charset; sumber kita UTF-8.
            content = res.content.decode('utf-8-sig', errors='replace')
            file.write_text(content, encoding='utf-8')
            self._log(key, url, res.status_code)
            return content
        raise RuntimeError(f'Gagal mengambil {url}')

    def json(self, url: str, data: dict | None = None, timeout: float = 60):
        content = self.text(url, data=data, timeout=timeout)
        return None if content is None else json.loads(content)
