// Font Plus Jakarta Sans (Tokotype, Indonesia); browser hanya mengunduh subset
// huruf yang dipakai halaman (±27 KB untuk Latin).
import "@fontsource-variable/plus-jakarta-sans";
import "leaflet/dist/leaflet.css";
import "./styles/base.css";
import "./styles/motion.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/map.css";
import "./styles/detail.css";
import "./styles/landing.css";

import L from "leaflet";
import {
  createEvacuation,
  createEvacuationSitesLayer,
  evacuationSitesLegend,
  facilityName,
} from "./features/evacuation.js";
import { createNotifications } from "./features/notifications.js";
import { createRiskCheck } from "./features/risk-check.js";
import { createSafeRoute } from "./features/safe-route.js";
import { createTracking } from "./features/tracking.js";
import { capLegend, createCapLayer } from "./layers/cap.js";
import {
  createEarthquakeLayer,
  earthquakeLegend,
} from "./layers/earthquakes.js";
import {
  createHazardLayer,
  createZkgtLayer,
  HAZARDS,
  hazardLegend,
  zkgtLegend,
} from "./layers/hazards.js";
import {
  cloudLegend,
  createCloudLayer,
  createImergLayer,
  createLandslideHistoryLayer,
  createRainWarningLayer,
  imergLegend,
  landslideLegend,
  landslideSymbol,
  rainWarningLegend,
} from "./layers/landslide.js";
import {
  createOutlookLayer,
  HAZARD_NAMES,
  OUTLOOK_VIEWS,
  outlookLegend,
} from "./layers/outlook.js";
import {
  boundaryLegend,
  createBoundaryLayer,
  createFaultLayer,
  createPlateLayer,
  faultLegend,
  plateLegend,
} from "./layers/reference.js";
import { createUsgsLayer, usgsLegend } from "./layers/usgs.js";
import { createEmscLayer, emscLegend } from "./layers/emsc.js";
import { createGdacsLayer, gdacsIconUrl, gdacsLegend } from "./layers/gdacs.js";
import {
  createVolcanoLayer,
  volcanoLegend,
  volcanoSwatch,
} from "./layers/volcanoes.js";
import { getJson } from "./lib/api.js";
import { formatDasarian } from "./lib/format.js";
import { icons } from "./lib/icons.js";
import { flyToBounds } from "./lib/motion.js";
import {
  CEWS_LEVELS,
  CLOUD_RAMP,
  DEPTH_CLASSES,
  IMERG_RAMP,
} from "./lib/symbology.js";
import { cssVar, currentTheme, onThemeChange, setTheme } from "./lib/theme.js";
import { createMap, INDONESIA_BOUNDS } from "./map/create-map.js";
import { LegendControl } from "./map/legend-control.js";
import { ReadoutControl } from "./map/readouts.js";
import { MapToolbar } from "./map/toolbar.js";
import { createFreshness } from "./ui/freshness.js";
import { createLanding } from "./ui/landing.js";
import { createLayerPanel } from "./ui/layer-panel.js";
import { createMarkerFilter } from "./ui/marker-filter.js";
import { createOverview } from "./ui/overview.js";
import { createRiskDetail } from "./ui/risk-detail.js";
import { createSearch } from "./ui/search.js";
import { createSidebar } from "./ui/sidebar.js";
import { hideSplashWhen } from "./ui/splash.js";
import { createTabs } from "./ui/tabs.js";

const $ = (selector) => document.querySelector(selector);
const px = (name) => parseFloat(cssVar(name)) || 0;

const EARTHQUAKE_REFRESH_MS = 60_000;
const VOLCANO_REFRESH_MS = 10 * 60_000;
// Peringatan dini cuaca BMKG disinkronkan server tiap 5 menit; notifikasi SSE
// memicu pemuatan lebih awal saat ada peringatan baru.
const CAP_REFRESH_MS = 5 * 60_000;
// Produk CEWS dasarian di-cache server 3 jam; daftar di Ikhtisar cukup dicek tiap 30 menit.
const RAIN_WARNING_REFRESH_MS = 30 * 60_000;
// Indikasi SIGAP dihitung server tiap 12 jam; hasil run baru terlihat paling lambat 10 menit kemudian.
const OUTLOOK_REFRESH_MS = 10 * 60_000;
const HAZARD_OPACITY = 0.65;
const PLACE_ZOOM = 13;

// Ikon untuk elemen statis di index.html (atribut data-icon).
for (const el of document.querySelectorAll("[data-icon]"))
  el.insertAdjacentHTML("afterbegin", icons[el.dataset.icon]);

// ---------- Panel samping (di HP menjadi lembar bawah) ----------
const sidebar = createSidebar({
  element: $("#sidebar"),
  handle: $("#sheet-handle"),
  mainView: $("#main-view"),
  detailView: $("#detail-view"),
});
createTabs($(".tabs"), {
  onChange() {
    $("#main-scroll").scrollTop = 0;
    sidebar.expand();
  },
});

// Popup yang digeser otomatis ke dalam layar tidak boleh tertutup bilah atas,
// panel samping/lembar bawah, atau bilah alat kanan.
L.Popup.mergeOptions(
  sidebar.isMobile()
    ? {
        autoPanPaddingTopLeft: L.point(12, px("--topbar-h") + 32),
        autoPanPaddingBottomRight: L.point(64, px("--sheet-peek") + 16),
      }
    : {
        autoPanPaddingTopLeft: L.point(
          px("--sidebar-w") + 48,
          px("--topbar-h") + 48,
        ),
        autoPanPaddingBottomRight: L.point(80, 32),
      },
);

// ---------- Peta dan kontrolnya ----------
const { map, basemaps } = createMap($("#map"), { theme: currentTheme() });

// Peta memenuhi layar dan sebagian tertutup panel melayang. viewPadding()
// menghitung ruang itu supaya hasil yang dibidik tidak tersembunyi. `detail` =
// hasil akan dibuka di panel detail (lembar bawah diperluas di HP).
function viewPadding({ detail = false } = {}) {
  const forResult = detail || sidebar.isDetailOpen();
  // Label jarak menjulur ±30 px di atas titik ujung garis; beri ruang ekstra.
  const top = px("--gap") + px("--topbar-h") + (forResult ? 48 : 16);
  if (sidebar.isMobile()) {
    const covered = sidebar.coveredHeight(forResult ? { expanded: true } : {});
    // Saat menampilkan seluruh Indonesia, bilah alat boleh menutupi tepi peta
    // supaya peta tidak mengecil di layar sempit.
    return {
      paddingTopLeft: [8, top],
      paddingBottomRight: [forResult ? 68 : 8, covered + 8],
    };
  }
  return {
    paddingTopLeft: [px("--gap") + px("--sidebar-w") + 32, top + 8],
    paddingBottomRight: [84, 40],
  };
}

map.fitBounds(INDONESIA_BOUNDS, viewPadding());
const legend = new LegendControl().addTo(map);
new ReadoutControl().addTo(map);

// ---------- Halaman depan ----------
// Profil situs di atas aplikasi yang sudah berjalan; "Buka peta" membuka
// aplikasi di belakangnya dalam tampilan biasa.
const landing = createLanding({
  element: $("#landing"),
  app: [$(".topbar"), $("#sidebar"), $("#map"), $("#toasts"), $("#track-chip")],
  // Di HP fokus ke pegangan lembar bawah: fokus di dalam lembar akan
  // membukanya dan menutupi peta.
  focusAfter: () => (sidebar.isMobile() ? $("#sheet-handle") : $("#sidebar")),
  // Pencarian dari halaman depan diteruskan ke kotak pencarian aplikasi.
  onSearch(q) {
    const input = $("#search input");
    input.value = q;
    input.focus();
    input.form.requestSubmit();
  },
  onLocate: () => locateUser(),
});

// ---------- Cek risiko: pencarian, lokasi saya, dan pilih titik ----------
const riskDetail = createRiskDetail($("#detail-view"), {
  sidebar,
  onClose: () => risk.clear(),
  onFit: () => risk.fitToResult(),
  onRetry: () => risk.retry(),
  // Rute aman ke titik evakuasi/fasilitas di daftar kartu cek risiko.
  onRoute: (id) => {
    const facility = evacuation.get(id);
    if (facility) requestRoute(facility);
  },
  onRouteMode: (mode) => route && requestRoute(route.facility, mode),
  onClearRoute: clearRoute,
  onTrack: toggleTracking,
});
const toolbar = new MapToolbar({
  basemaps,
  onHome: () => flyToBounds(map, INDONESIA_BOUNDS, viewPadding()),
  onLocate: locateUser,
  onPick: togglePicking,
  onTrack: toggleTracking,
}).addTo(map);
const ctaPick = $('[data-action="pick"]');
const risk = createRiskCheck({
  map,
  card: riskDetail,
  viewPadding,
  onPickingChange(active) {
    toolbar.setPicking(active);
    ctaPick.setAttribute("aria-pressed", String(active));
  },
  // Setelah profil tampil: titik evakuasi terdekat, wilayah notifikasi bila titik
  // ini lokasi pengguna, dan rute yang menunggu titik asal.
  onResult({ profile, latlng, label, signal }) {
    evacuation.load(latlng, signal).then(() => {
      if (!pendingRoute) return;
      const facility = pendingRoute;
      pendingRoute = null;
      requestRoute(facility);
    });
    if (label === "Lokasi Anda" || label === "Posisi Anda") {
      const wilayah = profile.location.wilayah;
      notifications.setArea({ lat: latlng.lat, lon: latlng.lng, kode: wilayah?.kode ?? null, nama: wilayah?.nama ?? label, provinsi: wilayah?.provinsi ?? null });
    }
  },
  onClear() {
    evacuation.clear();
    clearRoute();
  },
});

// ---------- Titik evakuasi, rute aman, dan pantau posisi ----------
const evacuation = createEvacuation({ map, card: riskDetail, onRoute: routeTo });
const safeRoute = createSafeRoute({ map, viewPadding });
const tracking = createTracking({
  map,
  chip: $("#track-chip"),
  viewPadding: markerPadding,
  progress: (latlng) => safeRoute.progress(latlng),
  onPosition({ latlng, first }) {
    // Posisi pertama menjadi wilayah notifikasi. Kab/kotanya belum diketahui,
    // jadi peringatan cuaca dicocokkan dengan jarak (lihat features/notifications.js).
    if (first) notifications.setArea({ lat: latlng.lat, lon: latlng.lng, kode: null, nama: "Posisi yang dipantau", provinsi: null });
  },
  onStop() {
    toolbar.setTracking(false);
    if (route?.data) riskDetail.renderRoute(route.data, { name: facilityName(route.facility), mode: route.mode, tracking: false });
  },
});

let route = null; // { facility, mode, data }
let pendingRoute = null;

// Dari popup penanda (juga lapisan titik evakuasi nasional): bila kartu cek risiko
// belum terbuka, titik asal ditentukan dulu (posisi dipantau atau "Lokasi saya").
function routeTo(facility) {
  if (sidebar.isDetailOpen() && risk.point) {
    requestRoute(facility);
    return;
  }
  pendingRoute = facility;
  if (tracking.position) risk.check(tracking.position, { label: "Posisi Anda" });
  else locateUser();
}

async function requestRoute(facility, mode = route?.mode ?? "jalan_kaki") {
  const origin = tracking.position ?? risk.point;
  if (!origin) return;
  const name = facilityName(facility);
  route = { facility, mode, data: null };
  riskDetail.routeLoading(name, mode);
  evacuation.highlight(facility.id);
  try {
    const data = await safeRoute.request({
      from: { lat: origin.lat, lon: origin.lng },
      to: { lat: facility.lat, lon: facility.lon },
      mode,
    });
    route.data = data;
    riskDetail.renderRoute(data, { name, mode, tracking: tracking.active });
    tracking.refresh();
  } catch (err) {
    if (err.name !== "AbortError") riskDetail.routeError(err.message, name, mode);
  }
}

function clearRoute() {
  route = null;
  safeRoute.clear();
  riskDetail.clearRoute();
  evacuation.highlight(null);
  tracking.refresh();
}

function toggleTracking() {
  const active = tracking.toggle();
  toolbar.setTracking(active);
  if (route?.data) riskDetail.renderRoute(route.data, { name: facilityName(route.facility), mode: route.mode, tracking: active });
}

// Di HP lembar bawah dikecilkan dulu supaya peta terlihat saat memilih titik.
function togglePicking() {
  sidebar.collapse();
  risk.togglePicking();
}

createSearch($("#search"), {
  onSelect(place) {
    const target = L.latLng(place.lat, place.lon);
    flyToBounds(map, place.bounds ?? target.toBounds(2_000), {
      maxZoom: PLACE_ZOOM,
      ...viewPadding({ detail: true }),
    });
    risk.check(target, { label: place.name });
  },
});

$("#panel-ikhtisar").addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "locate") locateUser();
  else if (action === "pick") togglePicking();
});

function locateUser() {
  if (!navigator.geolocation) {
    riskDetail.showMessage(
      "Browser ini tidak mendukung penentuan lokasi. Cari lokasi secara manual.",
    );
    return;
  }
  // Browser menolak penentuan lokasi di situs http:// (kecuali localhost).
  if (!window.isSecureContext) {
    riskDetail.showMessage(
      "Penentuan lokasi butuh koneksi aman (HTTPS). Buka situs lewat https://, atau cari lokasi secara manual.",
    );
    return;
  }
  riskDetail.showMessage("Mencari lokasi Anda…");
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const here = L.latLng(coords.latitude, coords.longitude);
      const area = here.toBounds(Math.max(coords.accuracy * 2, 1_500));
      flyToBounds(map, area, {
        maxZoom: PLACE_ZOOM,
        ...viewPadding({ detail: true }),
      });
      risk.check(here, { label: "Lokasi Anda", accuracyM: coords.accuracy });
    },
    (err) =>
      riskDetail.showMessage(
        err.code === err.PERMISSION_DENIED
          ? "Izin lokasi ditolak. Izinkan akses lokasi di browser, atau cari lokasi secara manual."
          : "Lokasi tidak dapat ditentukan. Coba lagi atau cari lokasi secara manual.",
      ),
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
  );
}

// ---------- Tema gelap/terang ----------
// Tema hanya mengubah antarmuka; peta dasar dipilih sendiri di bilah alat.
const themeToggle = $("#theme-toggle");
function labelThemeToggle(theme) {
  const next = theme === "dark" ? "terang" : "gelap";
  if (themeToggle) {
    themeToggle.setAttribute("aria-label", `Ganti ke mode ${next}`);
    themeToggle.title = `Ganti ke mode ${next}`;
  }
  document.querySelectorAll('[data-action="toggle-theme"]').forEach((btn) => {
    btn.setAttribute("aria-label", `Ganti ke mode ${next}`);
    btn.title = `Ganti ke mode ${next}`;
  });
}
labelThemeToggle(currentTheme());
if (themeToggle) {
  themeToggle.addEventListener("click", () =>
    setTheme(currentTheme() === "dark" ? "light" : "dark"),
  );
}
document.querySelectorAll('[data-action="toggle-theme"]').forEach((btn) => {
  btn.addEventListener("click", () =>
    setTheme(currentTheme() === "dark" ? "light" : "dark"),
  );
});
onThemeChange(labelThemeToggle);

// ---------- Lapisan ----------
const freshness = createFreshness($("#freshness"));
// Klik titik gempa/gunung api: peta terbang mendekat ke area yang tidak tertutup
// panel. Di HP, sisi kanan juga dikosongkan untuk bilah alat supaya popup di
// atas titik tidak menabraknya.
function markerPadding() {
  const padding = viewPadding();
  if (sidebar.isMobile())
    padding.paddingBottomRight = [68, padding.paddingBottomRight[1]];
  return padding;
}
const earthquakes = createEarthquakeLayer(map, { viewPadding: markerPadding });
const volcanoes = createVolcanoLayer(map, { viewPadding: markerPadding });
const reportLoadError = (name) => (err) => freshness.fail(name, err);
const rainWarnings = createRainWarningLayer({
  onError: reportLoadError("Peringatan hujan"),
});
// Waktu IMERG yang gagal dibaca tidak fatal: petanya jatuh ke data terbaru GIBS.
const rainNow = createImergLayer({
  onError: (err) => console.warn("Waktu IMERG tidak terbaca", err),
});
const landslideHistory = createLandslideHistoryLayer({
  onError: reportLoadError("Riwayat longsor"),
});
// Data luar negeri sebagai pembanding, mati bawaan: katalog gempa USGS (Amerika
// Serikat) dan citra awan Himawari-9 (JMA, Jepang). Data BMKG tetap yang utama.
const usgsQuakes = createUsgsLayer(map, {
  viewPadding: markerPadding,
  onLoad: (collection) => freshness.ok("Gempa USGS", collection.meta.synced_at),
  onError: reportLoadError("Gempa USGS"),
});
// Pembanding dari Eropa, juga mati bawaan: katalog gempa EMSC (sebagian besar
// katalog lengkap BMKG, termasuk gempa kecil) dan peringatan bencana GDACS.
const emscQuakes = createEmscLayer(map, {
  viewPadding: markerPadding,
  onLoad: (collection) => freshness.ok("Gempa EMSC", collection.meta.synced_at),
  onError: reportLoadError("Gempa EMSC"),
});
const gdacsAlerts = createGdacsLayer(map, {
  viewPadding: markerPadding,
  onLoad: (collection) => freshness.ok("Peringatan GDACS", collection.meta.fetched_at),
  onError: reportLoadError("Peringatan GDACS"),
});
// Peringatan dini cuaca BMKG (CAP): datanya dimuat refreshCap() untuk peta dan Ikhtisar.
const cap = createCapLayer(map, { viewPadding: markerPadding });
// Semua titik evakuasi OSM se-Indonesia, mati bawaan; titik terdekat dari cek
// risiko digambar terpisah (features/evacuation.js).
const evacuationSites = createEvacuationSitesLayer({
  onLoad: (collection) => freshness.ok("Titik evakuasi", collection.meta.synced_at),
  onError: reportLoadError("Titik evakuasi"),
  onRoute: routeTo,
});
// Seperti IMERG, waktu citra yang gagal dibaca tidak fatal.
const clouds = createCloudLayer({
  onError: (err) => console.warn("Waktu citra Himawari-9 tidak terbaca", err),
});
// Indikasi SIGAP 3 hari per kab/kota. Popup membandingkannya dengan peringatan
// resmi CEWS BMKG dan bisa membuka cek risiko di titik pantau terparah.
const outlook = createOutlookLayer({
  onError: reportLoadError("Indikasi SIGAP"),
  officialRain(kode) {
    if (!rainSummary?.published) return null;
    return {
      level: rainSummary.regions.find((r) => r.kode === kode)?.level ?? 0,
      period: formatDasarian(rainSummary.dasarian, { short: true }),
    };
  },
  onCheckPoint({ lat, lon, hazard }) {
    const target = L.latLng(lat, lon);
    flyToBounds(map, target.toBounds(3_000), {
      maxZoom: PLACE_ZOOM,
      ...viewPadding({ detail: true }),
    });
    risk.check(target, {
      label: `Titik pantau ${HAZARD_NAMES[hazard].toLowerCase()}`,
    });
  },
});

const symbol = {
  cap: `<span class="sym cap-swatch" style="--c:${CEWS_LEVELS[1].color}"></span>`,
  evacuation: '<span class="sym facility-dot" style="--c:#2e7d32"></span>',
  quake: `<span class="sym quake-swatch" style="--c:${DEPTH_CLASSES[0].color}"></span>`,
  usgs: `<span class="sym usgs-swatch" style="--c:${DEPTH_CLASSES[0].color}"></span>`,
  emsc: `<span class="sym emsc-swatch" style="--c:${DEPTH_CLASSES[0].color}"></span>`,
  gdacs: `<img class="gdacs-legend-icon" src="${gdacsIconUrl("FL", "orange")}" width="15" height="19" alt="" />`,
  volcano: volcanoSwatch(3),
  fault: '<span class="sym sym-line" style="--sym:var(--fault-color)"></span>',
  plate:
    '<span class="sym sym-line sym-line--thick" style="--sym:var(--plate-color)"></span>',
  boundary:
    '<span class="sym sym-line sym-line--thin" style="--sym:var(--boundary-color)"></span>',
  rain: `<span class="sym rain-swatch" style="--c:${CEWS_LEVELS[1].color}"></span>`,
  imerg: `<span class="sym ramp-swatch">${[0, 3, 5].map((i) => `<span style="background:${IMERG_RAMP[i].color}"></span>`).join("")}</span>`,
  clouds: `<span class="sym ramp-swatch">${[1, 2, 4, 6].map((i) => `<span style="background:${CLOUD_RAMP[i].color}"></span>`).join("")}</span>`,
  landslide: landslideSymbol(),
};

createLayerPanel({
  map,
  container: $("#layer-controls"),
  legend,
  groups: [
    {
      id: "indikasi",
      title: "Indikasi SIGAP · 3 hari",
      note: "Per kab/kota",
      description:
        "Prakiraan hujan × zona bahaya InaRISK, dihitung ulang tiap 12 jam. Indikasi sistem, bukan peringatan resmi.",
      exclusive: true,
      items: OUTLOOK_VIEWS.map((view) => ({
        label: view.label,
        legendTitle: `Indikasi SIGAP 3 hari · ${view.label.toLowerCase()}`,
        layer: outlook.views[view.id],
        legend: outlookLegend(view.id),
        on: view.id === "tertinggi",
      })),
    },
    {
      id: "kejadian",
      title: "Kejadian & status",
      items: [
        {
          label: "Gempa BMKG",
          description: "M ≥ 5 dan gempa dirasakan · 7 hari · tiap menit",
          legendTitle: "Gempa BMKG (7 hari)",
          symbol: symbol.quake,
          layer: earthquakes.layer,
          legend: earthquakeLegend,
          on: true,
        },
        {
          label: "Gempa USGS (pembanding)",
          description: "Amerika Serikat · mulai ±M4 · 7 hari · tiap menit · dampak dan longsor akibat gempa",
          legendTitle: "Gempa USGS (7 hari)",
          symbol: symbol.usgs,
          layer: usgsQuakes.layer,
          legend: usgsLegend,
        },
        {
          label: "Gempa EMSC (katalog lengkap)",
          description: "Eropa · sebagian besar katalog BMKG · mulai ±M1 · 7 hari · tiap 2 menit",
          legendTitle: "Gempa EMSC (7 hari)",
          symbol: symbol.emsc,
          layer: emscQuakes.layer,
          legend: emscLegend,
        },
        {
          label: "Peringatan GDACS (Uni Eropa–PBB)",
          description: "Banjir, gempa, gunung api, siklon, kebakaran hutan · Oranye/Merah 12 bulan, Hijau 7 hari",
          legendTitle: "Peringatan GDACS",
          symbol: symbol.gdacs,
          layer: gdacsAlerts.layer,
          legend: gdacsLegend,
        },
        {
          label: "Status gunung api",
          description: "PVMBG — MAGMA · diperbarui tiap 30 menit",
          legendTitle: "Status gunung api (PVMBG)",
          symbol: symbol.volcano,
          layer: volcanoes.layer,
          legend: volcanoLegend,
          on: true,
        },
      ],
    },
    {
      id: "hujan",
      title: "Hujan dan longsor",
      note: "BMKG · NASA · JMA · PVMBG",
      items: [
        {
          label: "Peringatan dini cuaca BMKG",
          description: "Kecamatan yang diperingatkan · berlaku ±2 jam · tiap 5 menit",
          legendTitle: "Peringatan dini cuaca (BMKG)",
          symbol: symbol.cap,
          layer: cap.layer,
          legend: capLegend,
          on: true,
        },
        {
          label: "Peringatan hujan tinggi BMKG",
          description: "Per dasarian · kab/kota Waspada ke atas",
          legendTitle: "Peringatan hujan tinggi (BMKG)",
          symbol: symbol.rain,
          layer: rainWarnings,
          legend: rainWarningLegend,
        },
        {
          label: "Hujan terkini dari satelit",
          description: "NASA IMERG · rata-rata 30 menit, terlambat ±4–6 jam",
          legendTitle: "Hujan satelit (NASA IMERG)",
          symbol: symbol.imerg,
          layer: rainNow,
          legend: imergLegend,
        },
        {
          label: "Citra awan Himawari-9",
          description: "JMA Jepang · inframerah tiap 10 menit, terlambat ±1 jam",
          legendTitle: "Awan dari satelit (Himawari-9, JMA)",
          symbol: symbol.clouds,
          layer: clouds,
          legend: cloudLegend,
        },
        {
          label: "Riwayat longsor",
          description: "PVMBG dan MAGMA · kejadian sejak 2008",
          legendTitle: "Riwayat longsor (PVMBG)",
          symbol: symbol.landslide,
          layer: landslideHistory,
          legend: landslideLegend,
        },
      ],
    },
    {
      id: "bahaya",
      title: "Peta rawan bencana",
      note: "InaRISK BNPB · PVMBG",
      description:
        "Satu peta rawan ditampilkan sekaligus supaya warnanya tidak saling menutupi.",
      exclusive: true,
      opacity: HAZARD_OPACITY,
      items: [
        ...HAZARDS.map((hazard) => ({
          label: hazard.label.replace(/\s*\(.*\)$/, ""),
          legendTitle: `Indeks bahaya ${hazard.label.toLowerCase()}`,
          layer: createHazardLayer(hazard, HAZARD_OPACITY),
          legend: hazardLegend,
        })),
        {
          label: "Kerentanan gerakan tanah",
          legendTitle: "Zona kerentanan gerakan tanah (PVMBG)",
          layer: createZkgtLayer(HAZARD_OPACITY),
          legend: zkgtLegend,
        },
      ],
    },
    {
      id: "evakuasi",
      title: "Evakuasi",
      note: "OpenStreetMap",
      items: [
        {
          label: "Titik evakuasi",
          description: "Tempat evakuasi dan titik kumpul yang terpetakan · ±1.600 titik",
          legendTitle: "Titik evakuasi (OpenStreetMap)",
          symbol: symbol.evacuation,
          layer: evacuationSites,
          legend: evacuationSitesLegend,
        },
      ],
    },
    {
      id: "geologi",
      title: "Geologi & wilayah",
      items: [
        {
          label: "Sesar aktif",
          description: "PuSGeN 2024 · 401 segmen",
          symbol: symbol.fault,
          layer: createFaultLayer(reportLoadError("Sesar")),
          legend: faultLegend,
          on: true,
        },
        {
          label: "Batas lempeng tektonik",
          description: "Bird (2003)",
          symbol: symbol.plate,
          layer: createPlateLayer(reportLoadError("Lempeng")),
          legend: plateLegend,
          on: true,
        },
        {
          label: "Batas kabupaten/kota",
          description: "Kepmendagri 2025 · 514 wilayah",
          symbol: symbol.boundary,
          layer: createBoundaryLayer(reportLoadError("Batas wilayah")),
          legend: boundaryLegend,
        },
      ],
    },
  ],
});

// ---------- Filter penanda (menu di bilah alat) ----------
createMarkerFilter({
  map,
  container: toolbar.filterMenu,
  earthquakes,
  volcanoes,
  onChange: (filtered) => toolbar.setFiltered(filtered),
});

// ---------- Ikhtisar & pembaruan data berkala ----------
const overview = createOverview({
  stats: {
    quakes24h: $("#stat-quakes-24h"),
    quakes24hSub: $("#stat-quakes-24h-sub"),
    quakesM5: $("#stat-quakes-m5"),
    volcanoes: $("#stat-volcanoes"),
    volcanoesSub: $("#stat-volcanoes-sub"),
  },
  quakeList: $("#quake-list"),
  volcanoList: $("#volcano-alerts"),
  capList: $("#cap-alerts"),
  capMeta: $("#cap-meta"),
  rainList: $("#rain-warnings"),
  rainMeta: $("#rain-warning-meta"),
  outlook: {
    counts: $("#outlook-counts"),
    list: $("#outlook-list"),
    meta: $("#outlook-meta"),
  },
  onSelectQuake(id) {
    sidebar.collapse();
    earthquakes.focus(id);
  },
  onSelectVolcano(kode) {
    sidebar.collapse();
    volcanoes.focus(kode);
  },
  // Kab/kota dari daftar peringatan hujan: layer CEWS dinyalakan, peta terbang
  // ke wilayahnya, lalu rincian peringatannya dibuka.
  onSelectCapAlert(identifier) {
    sidebar.collapse();
    cap.focus(identifier);
  },
  onSelectRainWarning(kode) {
    const region = rainSummary?.regions.find((r) => r.kode === kode);
    if (!region) return;
    sidebar.collapse();
    if (!map.hasLayer(rainWarnings)) map.addLayer(rainWarnings);
    map.once("moveend", () => {
      rainWarnings.eachLayer((feature) => {
        if (feature.feature.properties.kode === kode) feature.openPopup();
      });
    });
    flyToBounds(map, region.bounds, { maxZoom: 10, ...markerPadding() });
  },
  // Kab/kota dari daftar indikasi SIGAP: tampilan "Tertinggi" dinyalakan bila
  // belum ada tampilan indikasi, lalu popup dibuka setelah peta dan batas siap.
  async onSelectOutlook(kode) {
    const region = outlookData?.regions.find((r) => r.kode === kode);
    if (!region) return;
    sidebar.collapse();
    if (!outlook.activeView) map.addLayer(outlook.views.tertinggi);
    const arrived = new Promise((resolve) => map.once("moveend", resolve));
    flyToBounds(map, region.bounds, { maxZoom: 9, ...markerPadding() });
    await Promise.all([arrived, outlook.whenLoaded()]);
    outlook.openPopup(kode);
  },
});

let rainSummary = null;
async function refreshRainWarnings() {
  try {
    rainSummary = await getJson("/api/rain-warnings/summary");
    overview.renderRainWarnings(
      rainSummary,
      formatDasarian(rainSummary.dasarian, { short: true }),
    );
    landing.renderRainWarnings(rainSummary);
    freshness.ok("Peringatan hujan", rainSummary.fetched_at);
  } catch (err) {
    overview.showError(
      $("#rain-warnings"),
      "Peringatan hujan BMKG gagal dimuat. Dicoba lagi otomatis.",
    );
    landing.showUnavailable("rain");
    freshness.fail("Peringatan hujan", err);
  }
}

let outlookData = null;
async function refreshOutlook() {
  try {
    outlookData = await outlook.refresh();
    overview.renderOutlook(outlookData);
    landing.renderOutlook(outlookData);
    freshness.ok("Indikasi SIGAP", outlookData.run.finished_at);
  } catch (err) {
    // 404 = server belum menyelesaikan run pertama (±10 menit setelah seed).
    if (err.status === 404) {
      landing.showUnavailable("outlook", "indikasi pertama sedang dihitung");
      overview.showOutlookMessage(
        "Indikasi pertama sedang dihitung server (±10 menit). Dicoba lagi otomatis.",
      );
      return;
    }
    overview.showOutlookMessage(
      "Indikasi SIGAP gagal dimuat. Dicoba lagi otomatis.",
    );
    landing.showUnavailable("outlook");
    freshness.fail("Indikasi SIGAP", err);
  }
}

async function refreshEarthquakes() {
  try {
    const collection = await earthquakes.load();
    overview.renderQuakes(collection);
    landing.renderQuakes(collection);
    freshness.ok("Gempa", collection.meta.synced_at);
  } catch (err) {
    overview.showError(
      $("#quake-list"),
      "Data gempa gagal dimuat. Dicoba lagi otomatis tiap menit.",
    );
    landing.showUnavailable("quakes");
    freshness.fail("Gempa", err);
  }
}

async function refreshVolcanoes() {
  try {
    const collection = await volcanoes.load();
    overview.renderVolcanoes(collection);
    landing.renderVolcanoes(collection);
    freshness.ok("Gunung api", collection.meta.synced_at);
  } catch (err) {
    overview.showError($("#volcano-alerts"), "Status gunung api gagal dimuat.");
    landing.showUnavailable("volcanoes");
    freshness.fail("Gunung api", err);
  }
}

async function refreshCap() {
  try {
    const collection = await getJson("/api/cap");
    cap.setData(collection);
    overview.renderCapAlerts(collection);
    freshness.ok("Peringatan cuaca", collection.meta.synced_at);
  } catch (err) {
    overview.showError(
      $("#cap-alerts"),
      "Peringatan dini cuaca BMKG gagal dimuat. Dicoba lagi otomatis.",
    );
    freshness.fail("Peringatan cuaca", err);
  }
}

// ---------- Notifikasi langsung (SSE) ----------
const notifications = createNotifications({
  button: $("#notif-toggle"),
  panel: $("#notif-panel"),
  toasts: $("#toasts"),
  // "Lihat": penanda/poligon kejadiannya dibuka; bila tidak ada (mis. simulasi),
  // peta menuju koordinatnya.
  onShow(n) {
    if (!n) return;
    sidebar.collapse();
    if (!n.simulated) {
      if (n.kind === "gempa" && earthquakes.focus(n.ref)) return;
      if (n.kind === "gunung_api" && volcanoes.focus(n.ref.split(":")[0])) return;
      if (n.kind === "cuaca" && cap.focus(n.ref)) return;
    }
    if (Number.isFinite(n.lat)) {
      const radius = n.kind === "cuaca" ? 40_000 : 25_000;
      flyToBounds(map, L.latLng(n.lat, n.lon).toBounds(radius), { maxZoom: 11, ...markerPadding() });
    }
  },
  // Data kejadiannya dimuat ulang saat notifikasi masuk, tanpa menunggu jadwal.
  onLive(n) {
    if (n.kind === "gempa") refreshEarthquakes();
    else if (n.kind === "gunung_api") refreshVolcanoes();
    else if (n.kind === "cuaca") refreshCap();
  },
});

// Layar pembuka hilang setelah data gempa dan gunung api pertama selesai dimuat;
// halaman depan memulai intronya saat layar pembuka memudar.
hideSplashWhen(
  $("#splash"),
  Promise.allSettled([refreshEarthquakes(), refreshVolcanoes()]),
).then(() => landing.play());
setInterval(refreshEarthquakes, EARTHQUAKE_REFRESH_MS);
setInterval(refreshVolcanoes, VOLCANO_REFRESH_MS);
refreshCap();
setInterval(refreshCap, CAP_REFRESH_MS);
refreshRainWarnings();
setInterval(refreshRainWarnings, RAIN_WARNING_REFRESH_MS);
refreshOutlook();
setInterval(refreshOutlook, OUTLOOK_REFRESH_MS);
