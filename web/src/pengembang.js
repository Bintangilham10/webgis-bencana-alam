// Halaman dokumentasi API untuk pengembang (pengembang.html): mengisi tabel endpoint
// dan angka kuota dari GET /api/v1, dan mengirim formulir kunci API.
import '@fontsource-variable/plus-jakarta-sans';
import './styles/base.css';
import './styles/components.css';
import './styles/pengembang.css';

const number = new Intl.NumberFormat('id-ID');
const setAll = (selector, text) => {
  for (const el of document.querySelectorAll(selector)) el.textContent = text;
};

// Contoh kode memakai alamat halaman ini sendiri, jadi bisa langsung disalin.
setAll('[data-origin]', location.origin);

function cell(text, tag = 'td') {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}

function endpointRow(endpoint) {
  const row = document.createElement('tr');
  const path = document.createElement('td');
  const code = document.createElement('code');
  code.textContent = endpoint.path.replace('/api/v1', '');
  path.append(code);
  const about = cell(endpoint.description);
  if (endpoint.params) {
    const params = document.createElement('span');
    params.className = 'dev-params';
    params.textContent = `Parameter: ${endpoint.params}`;
    about.append(params);
  }
  // Nama kolom untuk tampilan layar sempit, saat tiap baris menjadi satu blok.
  const source = cell(endpoint.source);
  source.dataset.label = 'Sumber';
  const update = cell(endpoint.update);
  update.dataset.label = 'Diperbarui';
  row.append(path, about, source, update);
  return row;
}

async function loadIndex() {
  const rows = document.getElementById('endpoint-rows');
  try {
    const res = await fetch('/api/v1');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const index = await res.json();
    rows.replaceChildren(...index.endpoints.map(endpointRow));
    setAll('[data-quota]', number.format(index.daily_quota_default));
    setAll('[data-max-keys]', number.format(index.max_keys_per_email));
  } catch {
    const row = document.createElement('tr');
    const only = cell('Daftar endpoint tidak bisa dimuat sekarang. Coba muat ulang halaman ini.');
    only.colSpan = 4;
    row.append(only);
    rows.replaceChildren(row);
  }
}

const form = document.getElementById('key-form');
const submit = document.getElementById('key-submit');
const error = document.getElementById('key-error');
const result = document.getElementById('key-result');
const keyValue = document.getElementById('key-value');

function showError(message) {
  error.textContent = message;
  error.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const body = { name: data.get('name'), email: data.get('email'), purpose: data.get('purpose'), agree: data.get('agree') === 'on' };
  submit.disabled = true;
  submit.textContent = 'Membuat kunci…';
  try {
    const res = await fetch('/api/v1/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const answer = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(answer.error ?? `Kunci tidak bisa dibuat (HTTP ${res.status}). Coba lagi sebentar lagi.`);
      return;
    }
    keyValue.textContent = answer.key;
    setAll('[data-key]', answer.key);
    setAll('[data-quota]', number.format(answer.daily_quota));
    form.hidden = true;
    result.hidden = false;
  } catch {
    showError('Server tidak bisa dihubungi. Periksa sambungan internet, lalu coba lagi.');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Buat kunci';
  }
});

const copy = document.getElementById('key-copy');
copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(keyValue.textContent);
    copy.textContent = 'Tersalin';
  } catch {
    // Izin papan klip ditolak: sorot kuncinya supaya bisa disalin dengan Ctrl+C.
    const range = document.createRange();
    range.selectNodeContents(keyValue);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    copy.textContent = 'Tekan Ctrl+C';
  }
  setTimeout(() => {
    copy.textContent = 'Salin';
  }, 2500);
});

await loadIndex();
