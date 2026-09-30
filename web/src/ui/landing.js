import { formatDasarian, formatDecimal, formatNumber } from '../lib/format.js';
import { prefersReducedMotion, tween } from '../lib/motion.js';
import { WARNING_LEVEL_STYLES } from '../lib/symbology.js';

// Halaman depan: tur produk di atas aplikasi yang sudah berjalan. Tangkapan
// layar aplikasi asli dalam bingkai browser dan HP, ditambah angka langsung
// dari data yang sama dengan Ikhtisar (tanpa request tambahan).
//
// Gerak (dilewati bila pengguna meminta "kurangi gerakan"):
// 1. play(), saat layar pembuka memudar: teks hero muncul dan angka menghitung naik;
// 2. bingkai hero mulai miring lalu tegak mengikuti gulir;
// 3. tur fitur: bingkai menempel di layar, tangkapan layarnya berganti mengikuti
//    fitur yang sedang dibaca;
// 4. enter(): lubang lingkaran membesar dari tombol yang ditekan sampai
//    aplikasi di belakangnya terlihat penuh.
const HOLE_MS = 950;
const ARRIVE_MS = 1_600;
const COUNT_MS = 1_300;
const PLAY_FALLBACK_MS = 9_000;
// Tur menempel hanya bila ada ruang untuk dua kolom.
const tourQuery = window.matchMedia('(min-width: 960px)');

const levelKey = (level) => WARNING_LEVEL_STYLES[level].label.toLowerCase();
const flagged = (counts) => counts.waspada + counts.siaga + counts.awas;
// {waspada: 8, siaga: 0, awas: 1} → "1 Awas · 8 Waspada" (kosong bila semuanya 0).
const levelParts = (counts) =>
  [3, 2, 1]
    .filter((level) => counts[levelKey(level)])
    .map((level) => `${counts[levelKey(level)]} ${WARNING_LEVEL_STYLES[level].label}`)
    .join(' · ');
const shortName = (nama) => nama.replace(/^Kabupaten /, 'Kab. ');
const clockFormat = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
const clock = (iso) => `${clockFormat.format(new Date(iso))} WIB`;
const timeFormat = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
const clamp = (v) => Math.min(1, Math.max(0, v));

// app: elemen aplikasi yang tidak boleh terjangkau keyboard selama halaman
// depan tampil. focusAfter: elemen (atau fungsi yang mengembalikannya) yang
// difokus setelah masuk. onSearch dan onLocate dipanggil setelah halaman hilang.
export function createLanding({ element, app, focusAfter, onSearch, onLocate }) {
  const reduced = prefersReducedMotion();
  const $ = (selector) => element.querySelector(selector);
  const $$ = (selector) => [...element.querySelectorAll(selector)];
  let open = !element.hidden;
  let played = false;
  for (const el of app) el.inert = open;
  element.classList.add('lp-js');
  if (!reduced) element.classList.add('lp-motion');

  const nav = $('.lp-nav');

  // ---------- Angka langsung ----------
  const stats = {};
  function countUp(el, value) {
    if (reduced) {
      el.textContent = formatNumber(value);
      return;
    }
    tween(COUNT_MS, (t) => (el.textContent = formatNumber(Math.round(value * t))));
  }
  function setStat(key, value) {
    const el = $(`[data-stat="${key}"]`);
    const first = stats[key] === undefined;
    stats[key] = value;
    if (value === null) el.textContent = '–';
    else if (played && first) countUp(el, value);
    else el.textContent = formatNumber(value);
  }
  const setText = (key, text, attr = 'lp') => $$(`[data-${attr}="${key}"]`).forEach((el) => (el.textContent = text));
  const live = {};
  function setLive(key, part, text) {
    live[key] = { ...live[key], [part]: text };
    const el = $(`[data-live="${key}"]`);
    if (el) el.textContent = Object.values(live[key]).filter(Boolean).join(' · ') || 'Memuat data…';
  }
  const stamps = {};
  // Waktu sinkron terakhir per sumber di bagian Sumber data.
  const setSync = (key, iso) => iso && setText(key, `terakhir ${clock(iso)}`, 'sync');
  function setStamp(key, iso) {
    if (iso) stamps[key] = iso;
    const parts = [stamps.quakes && `gempa ${clock(stamps.quakes)}`, stamps.outlook && `indikasi ${clock(stamps.outlook)}`].filter(Boolean);
    if (parts.length) setText('stamp', `angka di atas diperbarui ${parts.join(' · ')}`);
    if (stamps.quakes) setText('nav-live', `Langsung · diperbarui ${timeFormat.format(new Date(stamps.quakes))} WIB`);
  }

  // ---------- Gulir: bilah atas, bingkai hero ----------
  const tilt = $('[data-tilt]');
  let frame = 0;
  function onScroll() {
    frame = 0;
    nav.classList.toggle('is-stuck', element.scrollTop > 8);
    // Bilah kemajuan baca di bawah header.
    const max = element.scrollHeight - element.clientHeight;
    nav.style.setProperty('--read', max > 0 ? (element.scrollTop / max).toFixed(4) : '0');
    if (reduced) return;
    // Miring saat hero baru tampil, tegak setelah digulir ±45% tinggi layar.
    const p = clamp(element.scrollTop / (element.clientHeight * 0.45));
    tilt.style.setProperty('--tilt', (1 - p).toFixed(3));
  }
  element.addEventListener('scroll', () => (frame ||= requestAnimationFrame(onScroll)), { passive: true });
  onScroll();

  // ---------- Tur fitur ----------
  const steps = $$('.lp-step');
  const screens = $$('[data-screen]');
  const dots = $$('[data-dot]');
  // Tangkapan layar berjejer mendatar; --current menggeser jejeran itu, jadi
  // gambar berikutnya masuk dari kanan saat digulir turun (dan sebaliknya).
  const slides = $('[data-screens]');
  function showStep(name) {
    steps.forEach((step) => step.classList.toggle('is-current', step.dataset.step === name));
    slides.style.setProperty('--current', String(screens.findIndex((screen) => screen.dataset.screen === name)));
    dots.forEach((dot) => dot.classList.toggle('is-current', dot.dataset.dot === name));
  }
  const tourSpy = new IntersectionObserver(
    (entries) => entries.forEach((entry) => entry.isIntersecting && tourQuery.matches && showStep(entry.target.dataset.step)),
    { root: element, rootMargin: '-45% 0px -45% 0px' },
  );
  steps.forEach((step) => tourSpy.observe(step));

  // ---------- Muncul saat pertama terlihat ----------
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal.unobserve(entry.target);
        entry.target.classList.add('is-in');
      }
    },
    { root: element, rootMargin: '0px 0px -10% 0px', threshold: 0.1 },
  );
  $$('[data-reveal], .lp-step').forEach((el) => reveal.observe(el));

  // Menu menandai bagian yang sedang dibaca.
  const links = new Map($$('.lp-nav__links a').map((link) => [link.hash.slice(1), link]));
  // Garis bawah biru bergeser ke tautan bagian yang sedang dibaca.
  const ink = $('.lp-nav__ink');
  function moveInk() {
    const link = [...links.values()].find((l) => l.hasAttribute('aria-current'));
    ink.classList.toggle('is-on', Boolean(link));
    if (link) {
      ink.style.setProperty('--x', `${link.offsetLeft}px`);
      ink.style.setProperty('--w', `${link.offsetWidth}px`);
    }
  }
  window.addEventListener('resize', moveInk);
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const link = links.get(entry.target.id);
        if (entry.isIntersecting) {
          links.forEach((other) => other.removeAttribute('aria-current'));
          link.setAttribute('aria-current', 'true');
        } else link.removeAttribute('aria-current');
      }
      moveInk();
    },
    { root: element, rootMargin: '-45% 0px -50% 0px' },
  );
  links.forEach((_, id) => spy.observe(element.querySelector(`#${id}`)));

  // ---------- Intro ----------
  const fallback = setTimeout(() => play(), PLAY_FALLBACK_MS);
  function play() {
    if (!open || played) return;
    played = true;
    clearTimeout(fallback);
    element.classList.add('is-playing');
    // Angka yang sudah tiba sebelum intro ikut menghitung naik.
    for (const [key, value] of Object.entries(stats)) {
      if (value !== null) countUp($(`[data-stat="${key}"]`), value);
    }
  }

  // ---------- Masuk ke aplikasi ----------
  // Titik tengah tombol yang ditekan (juga benar untuk klik lewat keyboard).
  function centerOf(target) {
    const box = target?.getBoundingClientRect();
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
  }

  function enter(then, from = centerOf()) {
    if (!open) return;
    open = false;
    clearTimeout(fallback);
    for (const el of app) el.inert = false;
    document.body.classList.remove('has-landing');
    let ring = null;
    const finish = () => {
      element.hidden = true;
      element.classList.remove('is-leaving');
      ring?.remove();
      for (const observer of [reveal, spy, tourSpy]) observer.disconnect();
      if (then) then();
      else (typeof focusAfter === 'function' ? focusAfter() : focusAfter)?.focus({ preventScroll: true });
    };
    if (reduced) {
      finish();
      return;
    }
    // Jari-jari sampai sudut layar terjauh dari titik asal.
    const radius = Math.ceil(Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y))) + 4;
    ring = document.createElement('div');
    ring.className = 'lp-hole-ring';
    ring.setAttribute('aria-hidden', 'true');
    for (const el of [element, ring]) {
      el.style.setProperty('--hole-x', `${from.x}px`);
      el.style.setProperty('--hole-y', `${from.y}px`);
      el.style.setProperty('--hole-r', `${radius}px`);
    }
    document.body.append(ring);
    element.classList.add('is-leaving');
    document.body.classList.add('is-arriving');
    setTimeout(finish, HOLE_MS);
    setTimeout(() => document.body.classList.remove('is-arriving'), ARRIVE_MS);
  }

  const form = $('.lp-search');
  element.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"], .lp-brand[href]');
    if (link) {
      event.preventDefault();
      const behavior = reduced ? 'auto' : 'smooth';
      const target = link.hash && element.querySelector(link.hash);
      if (!target) {
        element.scrollTo({ top: 0, behavior });
        return;
      }
      target.scrollIntoView({ behavior, block: 'start' });
      // Fokus ikut pindah supaya Tab berikutnya mulai dari bagian itu.
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      return;
    }
    const example = event.target.closest('[data-example]');
    if (example) {
      form.elements.q.value = example.dataset.example;
      form.requestSubmit();
      return;
    }
    const button = event.target.closest('[data-action]');
    if (button?.dataset.action === 'enter-map') enter(null, centerOf(button));
    else if (button?.dataset.action === 'locate') enter(onLocate, centerOf(button));
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const q = form.elements.q.value.trim();
    if (q.length >= 2) enter(() => onSearch(q), centerOf(form.querySelector('[type="submit"]')));
  });

  return {
    play,
    enter,
    renderQuakes(collection) {
      const quakes = collection.features.map((f) => f.properties);
      const strongest = quakes.reduce((max, q) => (!max || q.magnitude > max.magnitude ? q : max), null);
      setStat('quakes', quakes.length);
      setLive('overview', 'quakes', strongest ? `Saat ini: ${quakes.length} gempa dalam 7 hari, terbesar M ${formatDecimal(strongest.magnitude)}` : 'Saat ini: belum ada gempa dirasakan atau M5+ dalam 7 hari');
      setStamp('quakes', collection.meta.synced_at);
      setSync('quakes', collection.meta.synced_at);
    },
    renderVolcanoes(collection) {
      const volcanoes = collection.features.map((f) => f.properties);
      const high = volcanoes.filter((v) => v.level >= 3).length;
      setStat('volcanoes', high);
      setSync('volcanoes', collection.meta.synced_at);
      setLive('overview', 'volcanoes', `${high} gunung api Siaga ke atas`);
    },
    renderRainWarnings(summary) {
      const period = formatDasarian(summary.dasarian, { short: true });
      setStat('rain', summary.published ? summary.regions.length : null);
      setSync('rain', summary.fetched_at);
      const parts = levelParts(summary.counts);
      setLive(
        'rain',
        'text',
        summary.published
          ? `Dasarian ${period}: ${parts ? `${flagged(summary.counts)} kab/kota (${parts})` : 'tidak ada kab/kota berstatus Waspada'}`
          : `Peringatan dasarian ${period} belum terbit`,
      );
    },
    renderOutlook(data) {
      const counts = data.counts.tertinggi;
      const top = data.regions
        .filter((r) => r.level >= 1)
        .sort((a, b) => b.level - a.level || a.nama.localeCompare(b.nama, 'id'))[0];
      setStat('outlook', flagged(counts));
      setLive(
        'outlook',
        'text',
        top
          ? `Saat ini: ${flagged(counts)} kab/kota (${levelParts(counts)}), tertinggi ${shortName(top.nama)} (${WARNING_LEVEL_STYLES[top.level].label})`
          : 'Saat ini: semua kab/kota Normal',
      );
      setText('locations', formatNumber(data.run.locations));
      for (const key of ['normal', 'waspada', 'siaga', 'awas']) setText(`n-${key}`, formatNumber(counts[key]));
      const failed = data.run.locations_failed ? `, ${formatNumber(data.run.locations_failed)} gagal` : '';
      setText('run', `Run terakhir ${clock(data.run.finished_at)} · ${formatNumber(data.run.locations)} titik pantau${failed} · dihitung ulang tiap 12 jam`);
      setStamp('outlook', data.run.finished_at);
      setSync('outlook', data.run.finished_at);
    },
    // Data belum ada (mis. indikasi pertama masih dihitung) atau gagal dimuat.
    showUnavailable(key, meta = 'belum tersedia') {
      const text = meta.charAt(0).toUpperCase() + meta.slice(1);
      if (key === 'quakes') {
        setStat('quakes', null);
        setLive('overview', 'quakes', null);
      } else if (key === 'volcanoes') {
        setStat('volcanoes', null);
        setLive('overview', 'volcanoes', null);
      } else if (key === 'rain') {
        setStat('rain', null);
        setLive('rain', 'text', text);
      } else if (key === 'outlook') {
        setStat('outlook', null);
        setLive('outlook', 'text', text);
        setText('run', `Run terakhir: ${meta}`);
      }
    },
  };
}
