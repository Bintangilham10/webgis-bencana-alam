import { getJson } from '../lib/api.js';
import { escapeHtml, timeAgo } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { WARNING_LEVEL_STYLES } from '../lib/symbology.js';
import { disablePush, enablePush, pushServerKey, pushSupported, syncPush, testPush } from './push.js';

// Notifikasi langsung (P6). Server mendorong lewat SSE (/api/stream) gempa BMKG
// baru, perubahan level gunung api, dan peringatan dini cuaca BMKG baru. Peringatan
// cuaca terbit ±80 kali sehari se-Indonesia, jadi hanya yang mengenai wilayah
// pengguna yang dimunculkan; sisanya cukup masuk daftar. Pengaturan disimpan di
// browser ini saja, dan posisi pengguna tidak dikirim ke server.
//
// Satu pengecualian, hanya bila pengguna menyalakan "Notifikasi saat SIGAP ditutup"
// (push, features/push.js): supaya server bisa memilih notifikasi yang dikirim saat
// tab ditutup, wilayah pengguna dikirim ke server, yang membulatkannya ke 0,1°
// (±11 km) sebelum menyimpan. Aturan pemilihannya di server sama dengan relevance()
// di bawah.

const STORAGE_KEY = 'sigap-notifikasi';
const LIST_SIZE = 30;
const MAX_TOASTS = 3;
// Jarak yang dianggap "sekitar lokasi saya" per jenis notifikasi.
const NEAR_KM = { gempa: 150, gunung_api: 100, cuaca: 30 };
// Lama notifikasi tampil per level; level 3 (Awas, berpotensi tsunami) sampai ditutup.
const TOAST_MS = [10_000, 12_000, 30_000, null];
const KINDS = {
  gempa: { label: 'Gempa BMKG', icon: 'quake' },
  gunung_api: { label: 'Gunung api PVMBG', icon: 'mountain' },
  cuaca: { label: 'Peringatan cuaca BMKG', icon: 'alert' },
};
const STATUS_TEXT = {
  connecting: 'Menyambung…',
  connected: 'Tersambung',
  reconnecting: 'Menyambung ulang…',
  closed: 'Terputus',
  unsupported: 'Tidak didukung browser',
};

const DEFAULT_SETTINGS = { nearMe: false, browser: false, push: false, sound: false, area: null };
// Kawasan yang diterima server untuk wilayah push; di luar itu wilayah tidak dikirim.
const PUSH_BOUNDS = { latMin: -15, latMax: 10, lonMin: 90, lonMax: 145 };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Penyimpanan diblokir (mode privat): pengaturan berlaku sampai halaman ditutup.
  }
}

const distanceKm = (a, b) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

const clock = (date) => `${String(date.getHours()).padStart(2, '0')}.${String(date.getMinutes()).padStart(2, '0')}`;

// Nama tempat di teks simulasi; posisi dari pantau posisi belum punya nama kab/kota.
const placeName = (area, fallback) => (area ? (area.kode ? area.nama : 'lokasi Anda') : fallback);

// Skenario uji (hanya di browser ini, tidak dikirim ke server dan tidak masuk data riset).
const SIMULATIONS = [
  (area) => ({
    kind: 'gempa',
    level: 2,
    title: `Gempa M 6,1 · 25 km barat daya ${placeName(area, 'Lembang')}`,
    body: 'Kedalaman 10 km · dirasakan IV di sekitar pusat gempa',
    lat: area ? area.lat - 0.15 : -6.95,
    lon: area ? area.lon - 0.15 : 107.45,
  }),
  (area) => {
    const now = new Date();
    return {
      kind: 'cuaca',
      level: 1,
      title: `Hujan Lebat disertai Petir di ${area ? (area.provinsi ?? 'sekitar lokasi Anda') : 'Jawa Barat'}`,
      body: `Berlaku ${clock(now)}–${clock(new Date(now.getTime() + 2 * 3_600_000))} · ${placeName(area, 'Kota Bandung')}`,
      wilayah: area?.kode ? [area.kode] : [],
      lat: area?.lat ?? -6.91,
      lon: area?.lon ?? 107.61,
    };
  },
  () => ({
    kind: 'gunung_api',
    level: 3,
    title: 'Gunung Merapi naik ke Level IV (Awas)',
    body: 'Sebelumnya Level III (Siaga). Ikuti rekomendasi radius aman PVMBG di MAGMA.',
    lat: -7.542,
    lon: 110.442,
  }),
];

// onShow(n): tombol "Lihat"; onLive(n): setiap notifikasi asli yang baru masuk,
// supaya peta langsung memuat data barunya tanpa menunggu jadwal pembaruan.
export function createNotifications({ button, panel, toasts, onShow, onLive }) {
  const settings = loadSettings();
  const items = new Map();
  let unread = 0;
  let status = 'connecting';
  let audio = null;
  let simulation = 0;
  // Kunci publik push server: undefined = belum diketahui, null = server tidak mengaktifkannya.
  let pushKey;
  let pushBusy = false;
  let pushNote = '';

  const near = (n) => {
    const area = settings.area;
    if (!area || !Number.isFinite(n.lat)) return false;
    if (n.kind === 'cuaca' && area.kode && n.wilayah?.includes(area.kode)) return true;
    return distanceKm(area, n) <= NEAR_KM[n.kind];
  };

  // 'alert' = dimunculkan (kotak notifikasi, bunyi, notifikasi browser);
  // 'list' = cukup masuk daftar; 'hidden' = disaring "hanya sekitar lokasi saya".
  function relevance(n) {
    if (n.simulated) return 'alert';
    if (settings.nearMe && settings.area) return near(n) ? 'alert' : 'hidden';
    if (n.kind === 'cuaca') return near(n) ? 'alert' : 'list';
    return 'alert';
  }

  // ---------- Bunyi dan notifikasi browser ----------
  function beep(level) {
    if (!settings.sound) return;
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return;
    audio ??= new AudioContext();
    audio.resume?.();
    const tones = level >= 3 ? [880, 660, 880, 660] : [880, 660];
    tones.forEach((frequency, i) => {
      const at = audio.currentTime + i * 0.18;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.16);
    });
  }

  const browserSupported = () => 'Notification' in window && window.isSecureContext;

  // Notifikasi sistem hanya saat tab tidak dilihat; saat dilihat cukup kotak di halaman.
  function systemNotify(n) {
    if (!settings.browser || !browserSupported() || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    const note = new Notification(n.title, { body: n.simulated ? `SIMULASI · ${n.body}` : n.body, tag: `sigap-${n.id}`, icon: '/favicon.svg' });
    note.addEventListener('click', () => {
      window.focus();
      onShow(n);
      note.close();
    });
  }

  // ---------- Push (notifikasi saat SIGAP ditutup) ----------
  // Pilihan yang dikirim ke server bersama langganan push.
  function pushPrefs() {
    const area = settings.area;
    const inside = area && area.lat >= PUSH_BOUNDS.latMin && area.lat <= PUSH_BOUNDS.latMax && area.lon >= PUSH_BOUNDS.lonMin && area.lon <= PUSH_BOUNDS.lonMax;
    return { nearOnly: Boolean(settings.nearMe && inside), area: inside ? { lat: area.lat, lon: area.lon, kode: area.kode ?? null } : null };
  }

  // Pilihan di server disamakan dengan pengaturan di sini. Bila perangkat ternyata
  // tidak lagi berlangganan (izin dicabut, data situs dihapus), sakelarnya dimatikan.
  function syncPushPrefs() {
    if (!settings.push || !pushKey) return;
    syncPush(pushPrefs())
      .then((active) => {
        if (active) return;
        settings.push = false;
        saveSettings(settings);
        renderPanel();
      })
      .catch((err) => console.warn('Pilihan push gagal diperbarui', err));
  }

  async function togglePush(on) {
    pushBusy = true;
    pushNote = '';
    renderPanel();
    let active = false;
    if (on) {
      const result = await enablePush(pushKey, pushPrefs());
      active = result.ok;
      pushNote = result.ok ? '' : result.reason;
    } else {
      await disablePush().catch((err) => console.warn('Push gagal dimatikan', err));
    }
    pushBusy = false;
    return active;
  }

  function pushDescription() {
    if (!pushSupported()) return 'Tidak didukung browser ini';
    if (pushKey === null) return 'Belum diaktifkan di server ini';
    if (Notification.permission === 'denied') return 'Diblokir; izinkan notifikasi untuk situs ini di pengaturan browser';
    return settings.area
      ? 'Server menyimpan wilayah Anda yang dibulatkan (±11 km) untuk memilih notifikasinya'
      : 'Tanpa lokasi: semua gempa dan perubahan level gunung api, tanpa peringatan cuaca';
  }

  // ---------- Kotak notifikasi di halaman ----------
  function dismiss(toast) {
    if (!toast.isConnected) return;
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 250);
  }

  function showToast(n) {
    const style = WARNING_LEVEL_STYLES[n.level] ?? WARNING_LEVEL_STYLES[1];
    const kind = KINDS[n.kind];
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.level = String(n.level);
    toast.style.setProperty('--c', style.color);
    toast.style.setProperty('--c-ink', style.text);
    toast.setAttribute('role', n.level >= 2 ? 'alert' : 'status');
    toast.innerHTML = `
      <span class="toast-icon">${icons[kind.icon]}</span>
      <div class="toast-text">
        <p class="toast-title">${escapeHtml(n.title)}</p>
        <p class="toast-body">${escapeHtml(n.body)}</p>
        <p class="toast-meta">${n.simulated ? '<span class="sim-badge">Simulasi</span>' : ''}${kind.label} · baru saja</p>
      </div>
      <div class="toast-actions">
        <button type="button" class="btn btn-secondary" data-action="show">Lihat</button>
        <button type="button" class="icon-btn" data-action="close" aria-label="Tutup notifikasi">${icons.close}</button>
      </div>`;
    toast.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'show') onShow(n);
      if (action) dismiss(toast);
    });
    toasts.prepend(toast);
    [...toasts.children].slice(MAX_TOASTS).forEach(dismiss);
    const ms = TOAST_MS[n.level];
    if (ms) setTimeout(() => dismiss(toast), ms);
  }

  // ---------- Panel ----------
  function renderBadge() {
    const badge = button.querySelector('.notif-badge');
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    button.setAttribute('aria-label', unread ? `Notifikasi, ${unread} baru` : 'Notifikasi');
  }

  const switchRow = (key, icon, label, desc, { disabled = false } = {}) => `
    <label class="switch-row${disabled ? ' is-disabled' : ''}">
      <span class="switch-symbol">${icons[icon]}</span>
      <span class="switch-text"><span class="switch-label">${label}</span><span class="switch-desc">${desc}</span></span>
      <input type="checkbox" class="switch" role="switch" data-setting="${key}" ${settings[key] ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
    </label>`;

  function itemHtml(n, now) {
    const style = WARNING_LEVEL_STYLES[n.level] ?? WARNING_LEVEL_STYLES[1];
    return `
      <li>
        <button type="button" class="notif-item" data-id="${n.id}">
          <span class="notif-dot" style="--c:${style.color}"></span>
          <span class="notif-text">
            <span class="notif-title">${escapeHtml(n.title)}</span>
            <span class="notif-body">${escapeHtml(n.body)}</span>
            <span class="notif-meta">${n.simulated ? '<span class="sim-badge">Simulasi</span>' : ''}${KINDS[n.kind].label} · ${timeAgo(n.created_at, now)}</span>
          </span>
        </button>
      </li>`;
  }

  function renderPanel() {
    if (panel.hidden) return;
    const now = Date.now();
    const area = settings.area;
    const browserDesc = !browserSupported()
      ? 'Tidak tersedia di browser ini atau tanpa HTTPS'
      : Notification.permission === 'denied'
        ? 'Diblokir; izinkan notifikasi untuk situs ini di pengaturan browser'
        : 'Muncul walau tab ini sedang tidak dibuka';
    const shown = [...items.values()].filter((n) => relevance(n) !== 'hidden').sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, LIST_SIZE);
    panel.innerHTML = `
      <div class="notif-head">
        <h2 class="notif-heading">Notifikasi</h2>
        <span class="notif-status" data-status="${status}">${STATUS_TEXT[status]}</span>
      </div>
      <div class="notif-settings">
        ${switchRow('nearMe', 'locate', 'Hanya sekitar lokasi saya', area ? `${escapeHtml(area.nama ?? 'Lokasi terakhir')} · gempa 150 km, gunung api 100 km` : 'Tekan “Lokasi saya” atau pantau posisi dulu', { disabled: !area })}
        ${switchRow('browser', 'bell', 'Notifikasi browser', browserDesc, { disabled: !browserSupported() || Notification.permission === 'denied' })}
        ${switchRow('push', 'bell', 'Notifikasi saat SIGAP ditutup', pushDescription(), { disabled: pushBusy || !pushSupported() || !pushKey || Notification.permission === 'denied' })}
        ${switchRow('sound', 'activity', 'Bunyi', 'Nada singkat saat ada notifikasi baru')}
        ${pushNote ? `<p class="notif-push-note" role="status">${escapeHtml(pushNote)}</p>` : ''}
        ${settings.push ? '<button type="button" class="btn btn-secondary btn-block" data-action="push-test">Kirim notifikasi uji ke perangkat ini</button>' : ''}
        <button type="button" class="btn btn-secondary btn-block" data-action="simulate">Uji notifikasi (simulasi)</button>
      </div>
      ${shown.length ? `<ol class="notif-list">${shown.map((n) => itemHtml(n, now)).join('')}</ol>` : '<p class="empty-note">Belum ada notifikasi dalam 24 jam terakhir.</p>'}
      <p class="notif-note">Peringatan dini cuaca BMKG terbit ±80 kali sehari; yang tidak mengenai lokasi Anda hanya masuk daftar ini.</p>`;
  }

  function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      unread = 0;
      renderBadge();
      renderPanel();
    }
  }

  button.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      button.focus();
    }
  });

  panel.addEventListener('change', async (event) => {
    const key = event.target.dataset.setting;
    if (!key) return;
    let on = event.target.checked;
    if (key === 'browser' && on && Notification.permission !== 'granted') {
      on = (await Notification.requestPermission()) === 'granted';
    }
    if (key === 'push') on = await togglePush(on);
    settings[key] = on;
    saveSettings(settings);
    // Bunyi dinyalakan lewat sentuhan pengguna, jadi browser mengizinkan audio.
    if (key === 'sound' && on) beep(1);
    if (key === 'nearMe') syncPushPrefs();
    renderPanel();
  });

  panel.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="push-test"]')) {
      pushNote = 'Mengirim pesan uji…';
      renderPanel();
      testPush()
        .then(() => {
          pushNote = 'Pesan uji dikirim. Notifikasinya muncul dalam beberapa detik, juga bila tab ini ditutup.';
        })
        .catch((err) => {
          pushNote = err.message;
        })
        .finally(renderPanel);
      return;
    }
    if (event.target.closest('[data-action="simulate"]')) {
      // Panel ditutup supaya toast simulasinya terlihat di atas peta.
      setOpen(false);
      button.focus();
      const n = SIMULATIONS[simulation++ % SIMULATIONS.length](settings.area);
      receive({ ...n, id: -Date.now(), ref: null, wilayah: n.wilayah ?? [], created_at: new Date().toISOString(), simulated: true }, { live: true });
      return;
    }
    const id = event.target.closest('[data-id]')?.dataset.id;
    if (id) {
      setOpen(false);
      onShow(items.get(Number(id)));
    }
  });

  // ---------- Data ----------
  function receive(n, { live }) {
    if (items.has(n.id)) return;
    items.set(n.id, n);
    // Daftar dibatasi; notifikasi tertua dibuang.
    if (items.size > LIST_SIZE * 3) items.delete(items.keys().next().value);
    if (live && !n.simulated) onLive?.(n);
    if (live && relevance(n) === 'alert') {
      unread++;
      showToast(n);
      beep(n.level);
      systemNotify(n);
      renderBadge();
    }
    renderPanel();
  }

  async function loadRecent() {
    try {
      const { notifications } = await getJson(`/api/notifications?limit=${LIST_SIZE}`);
      for (const n of notifications.reverse()) receive(n, { live: false });
    } catch (err) {
      console.warn('Daftar notifikasi gagal dimuat', err);
    }
  }

  // EventSource menyambung ulang sendiri (jeda 10 detik dari server) dan
  // mengirim Last-Event-ID, jadi notifikasi selama putus tetap diterima.
  function connect() {
    if (!('EventSource' in window)) {
      status = 'unsupported';
      return;
    }
    const source = new EventSource('/api/stream');
    source.addEventListener('open', () => {
      status = 'connected';
      renderPanel();
    });
    source.addEventListener('error', () => {
      status = source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting';
      renderPanel();
    });
    source.addEventListener('notification', (event) => receive(JSON.parse(event.data), { live: true }));
  }

  renderBadge();
  const loaded = loadRecent();
  loaded.then(connect);

  // Membuka kejadian sebuah notifikasi dari id-nya, setelah daftar selesai dimuat.
  function show(id) {
    loaded.then(() => onShow(items.get(Number(id))));
  }

  // Push: kunci server menentukan apakah sakelarnya bisa dipakai, dan pilihan yang
  // tersimpan di server disamakan lagi tiap halaman dibuka.
  if (pushSupported()) {
    pushServerKey().then((key) => {
      pushKey = key;
      syncPushPrefs();
      renderPanel();
    });
    // Notifikasi push diklik selagi tab ini terbuka (public/sw.js).
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'sigap-notifikasi') show(event.data.id);
    });
  }

  return {
    // Wilayah pengguna dari "Lokasi saya" atau pantau posisi: { lat, lon, kode, nama, provinsi }.
    setArea(area) {
      settings.area = area;
      saveSettings(settings);
      syncPushPrefs();
      renderPanel();
    },
    show,
  };
}
