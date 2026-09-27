"""Uji cache klien HTTP: balasan yang tidak sah tidak boleh tersimpan sebagai data.

Jalankan dari root repo: research/.venv/Scripts/python -m unittest discover research/tests
"""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sigap_riset.http import Blocked, Client, UnexpectedResponse  # noqa: E402

URL = 'https://contoh.test/wms?layer=a'
BLOCK_PAGE = '<html><head><title>Request Rejected</title></head><body>Mohon Maaf<br>Your support ID is: 123</body></html>'
TRANSIENT_ERROR = '<?xml version="1.0"?><ServiceExceptionReport><ServiceException>java.io.IOException</ServiceException></ServiceExceptionReport>'


class Response:
    def __init__(self, status: int, body: str = ''):
        self.status_code = status
        self.content = body.encode()

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))


class Session:
    """Pengganti requests.Session yang membalas dari daftar urut."""

    def __init__(self, responses: list[Response]):
        self.responses = list(responses)
        self.calls = 0

    def get(self, url, timeout):
        self.calls += 1
        return self.responses.pop(0)


def is_json(text: str) -> bool:
    return text.startswith('{')


class TestClient(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        sleep = mock.patch('sigap_riset.http.time.sleep')
        sleep.start()
        self.addCleanup(sleep.stop)
        self.client = Client('uji', min_interval_s=0, cache_dir=Path(self.tmp.name))

    def serve(self, *responses: Response) -> Session:
        self.client._session = Session(responses)
        return self.client._session

    def cached_files(self) -> list[Path]:
        return list(self.client.dir.glob('*.txt'))

    def test_halaman_blokir_menghentikan_tanpa_coba_ulang_dan_tidak_di_cache(self):
        session = self.serve(Response(200, BLOCK_PAGE))
        with self.assertRaises(Blocked):
            self.client.text(URL)
        self.assertEqual(session.calls, 1)
        self.assertEqual(self.cached_files(), [])

    def test_balasan_tak_sah_dicoba_ulang_lalu_yang_sah_disimpan(self):
        session = self.serve(Response(200, TRANSIENT_ERROR), Response(200, '{"features": []}'))
        self.assertEqual(self.client.text(URL, valid=is_json), '{"features": []}')
        self.assertEqual(self.client.text(URL, valid=is_json), '{"features": []}')
        self.assertEqual(session.calls, 2)

    def test_balasan_yang_terus_tak_sah_memunculkan_galat(self):
        self.serve(*[Response(200, TRANSIENT_ERROR)] * 4)
        with self.assertRaises(UnexpectedResponse):
            self.client.text(URL, valid=is_json)
        self.assertEqual(self.cached_files(), [])

    def test_cache_lama_yang_tak_sah_diambil_ulang(self):
        self.client._file(URL).write_text(BLOCK_PAGE, encoding='utf-8')
        session = self.serve(Response(200, '{"ok": 1}'))
        self.assertEqual(self.client.text(URL, valid=is_json), '{"ok": 1}')
        self.assertEqual(session.calls, 1)

    def test_404_disimpan_sebagai_penanda(self):
        session = self.serve(Response(404))
        self.assertIsNone(self.client.text(URL))
        self.assertIsNone(self.client.text(URL))
        self.assertEqual(session.calls, 1)


if __name__ == '__main__':
    unittest.main()
