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

import L from "leaflet";
import { createRiskCheck } from "./features/risk-check.js";
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
  createImergLayer,
  createLandslideHistoryLayer,
  createRainWarningLayer,
  imergLegend,
  landslideLegend,
  landslideSymbol,
  rainWarningLegend,
} from "./layers/landslide.js";
import {
  boundaryLegend,
  createBoundaryLayer,
  createFaultLayer,
  createPlateLayer,
  faultLegend,
  plateLegend,
} from "./layers/reference.js";
import {
  createVolcanoLayer,
  volcanoLegend,
  volcanoSwatch,
} from "./layers/volcanoes.js";
import { getJson } from "./lib/api.js";
import { formatDasarian } from "./lib/format.js";
import { icons } from "./lib/icons.js";
import { flyToBounds } from "./lib/motion.js";
import { CEWS_LEVELS, DEPTH_CLASSES, IMERG_RAMP } from "./lib/symbology.js";
import { cssVar, currentTheme, onThemeChange, setTheme } from "./lib/theme.js";
import { createMap, INDONESIA_BOUNDS } from "./map/create-map.js";
import { LegendControl } from "./map/legend-control.js";
import { ReadoutControl } from "./map/readouts.js";
import { MapToolbar } from "./map/toolbar.js";
import { createFreshness } from "./ui/freshness.js";
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

const landingShell = $("#landing-shell");
const enterMap = () => {
  if (!landingShell) return;
  landingShell.classList.add("is-hidden");
  document.body.classList.remove("has-landing");
  const openMap = () => {
    if (landingShell) landingShell.setAttribute("aria-hidden", "true");
    if (
      document.activeElement &&
      typeof document.activeElement.blur === "function"
    ) {
      document.activeElement.blur();
    }
  };
  requestAnimationFrame(openMap);
};

document.querySelectorAll('[data-action="enter-map"]').forEach((btn) => {
  btn.addEventListener("click", enterMap);
});

document.querySelectorAll('[data-action="explore-risk"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    enterMap();
    const pickButton = document.querySelector('[data-action="pick"]');
    if (pickButton) pickButton.click();
  });
});

document
  .querySelectorAll('[data-action="enter-tab-ikhtisar"]')
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      enterMap();
      document.querySelector("#tab-ikhtisar")?.click();
    });
  });

document
  .querySelectorAll('[data-action="enter-tab-lapisan"]')
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      enterMap();
      document.querySelector("#tab-lapisan")?.click();
    });
  });

document.querySelectorAll('[data-action="enter-tab-info"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    enterMap();
    document.querySelector("#tab-info")?.click();
  });
});

const landingSearchInput = document.querySelector("[data-landing-search]");
if (landingSearchInput) {
  landingSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = landingSearchInput.value.trim();
      enterMap();
      const mainSearchInput = document.querySelector(".search-input");
      if (mainSearchInput && val) {
        mainSearchInput.value = val;
        mainSearchInput.dispatchEvent(new Event("input", { bubbles: true }));
        mainSearchInput.focus();
      }
    }
  });
}

const clockEl = document.querySelector("#landing-clock");
if (clockEl) {
  const updateClock = () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", { hour12: false });
    clockEl.textContent = `WIB ${timeStr}`;
  };
  updateClock();
  setInterval(updateClock, 1000);
}

const EARTHQUAKE_REFRESH_MS = 60_000;
const VOLCANO_REFRESH_MS = 10 * 60_000;
// Produk CEWS dasarian di-cache server 3 jam; daftar di Ikhtisar cukup dicek tiap 30 menit.
const RAIN_WARNING_REFRESH_MS = 30 * 60_000;
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

function initLandingMiniMap(globalMap, onEnterMap) {
  const container = document.querySelector("#landing-mini-map");
  if (!container) return;

  const miniMap = L.map(container, {
    center: [-2.2, 118.0],
    zoom: 4.8,
    minZoom: 3,
    maxZoom: 9,
    zoomSnap: 0.1,
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: false,
    doubleClickZoom: false,
  });

  const osmLayer = L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    },
  );

  const satLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Earthstar Geographics',
    },
  );

  osmLayer.addTo(miniMap);

  const layerBtns = document.querySelectorAll("[data-radar-layer]");
  layerBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = btn.dataset.radarLayer;
      layerBtns.forEach((b) => b.classList.remove("radar-tag--active"));
      btn.classList.add("radar-tag--active");

      if (target === "satellite") {
        if (miniMap.hasLayer(osmLayer)) miniMap.removeLayer(osmLayer);
        satLayer.addTo(miniMap);
      } else {
        if (miniMap.hasLayer(satLayer)) miniMap.removeLayer(satLayer);
        osmLayer.addTo(miniMap);
      }
    });
  });

  // Sunda Megathrust subduction trench line
  const trenchCoords = [
    [10.2, 92.4],
    [5.8, 94.6],
    [2.1, 96.5],
    [-0.5, 98.2],
    [-3.2, 100.4],
    [-6.3, 103.5],
    [-7.8, 105.9],
    [-9.2, 108.5],
    [-9.8, 111.5],
    [-10.4, 115.0],
    [-10.9, 118.5],
    [-11.2, 122.0],
    [-10.8, 125.5],
    [-9.5, 128.5],
    [-7.5, 131.0],
    [-4.5, 133.5],
  ];

  const trenchLine = L.polyline(trenchCoords, {
    color: "#f43f5e",
    weight: 2.8,
    opacity: 0.85,
    dashArray: "6, 6",
    className: "sunda-trench-path",
  }).addTo(miniMap);

  trenchLine.bindTooltip("Palung Sunda (Sunda Megathrust Arc)", {
    className: "mini-map-tooltip",
    sticky: true,
  });

  // Epicenter 1: Palu-Koro fault
  const quakeIcon1 = L.divIcon({
    className: "mini-map-custom-icon",
    html: `
      <div class="mini-map-epicenter">
        <span class="mini-map-pulse-ring"></span>
        <span class="mini-map-pulse-ring"></span>
        <span class="mini-map-pulse-ring"></span>
        <span class="mini-map-epicenter-core"></span>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });

  const quake1 = L.marker([-0.89, 119.87], { icon: quakeIcon1 }).addTo(miniMap);
  quake1.bindTooltip("Palu-Koro &bull; M 6.2 (Simulasi Sensor)", {
    className: "mini-map-tooltip",
    direction: "top",
    offset: [0, -14],
  });
  quake1.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    quake1.openTooltip();
  });

  // Epicenter 2: Megathrust Selatan Jawa
  const quakeIcon2 = L.divIcon({
    className: "mini-map-custom-icon",
    html: `
      <div class="mini-map-epicenter mini-map-epicenter--amber">
        <span class="mini-map-pulse-ring"></span>
        <span class="mini-map-pulse-ring"></span>
        <span class="mini-map-epicenter-core"></span>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });

  const quake2 = L.marker([-8.85, 108.45], { icon: quakeIcon2 }).addTo(miniMap);
  quake2.bindTooltip("Megathrust S. Jawa &bull; M 5.4 Kedalaman 24 km", {
    className: "mini-map-tooltip",
    direction: "top",
    offset: [0, -14],
  });
  quake2.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    quake2.openTooltip();
  });

  // Volcano 1: Gunung Merapi
  const volcanoIcon = L.divIcon({
    className: "mini-map-custom-icon",
    html: `
      <div class="mini-map-volcano">
        <div class="mini-map-volcano-cone"></div>
        <div class="mini-map-volcano-dot"></div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  const volcanoMerapi = L.marker([-7.54, 110.44], {
    icon: volcanoIcon,
  }).addTo(miniMap);
  volcanoMerapi.bindTooltip("G. Merapi &bull; Level III (Siaga)", {
    className: "mini-map-tooltip",
    direction: "top",
    offset: [0, -12],
  });
  volcanoMerapi.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    volcanoMerapi.openTooltip();
  });

  // Volcano 2: Gunung Semeru
  const volcanoSemeru = L.marker([-8.108, 112.92], {
    icon: volcanoIcon,
  }).addTo(miniMap);
  volcanoSemeru.bindTooltip("G. Semeru &bull; Level III (Siaga)", {
    className: "mini-map-tooltip",
    direction: "top",
    offset: [0, -12],
  });
  volcanoSemeru.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    volcanoSemeru.openTooltip();
  });

  const quakeGroup = L.layerGroup([
    quake1,
    quake2,
    volcanoMerapi,
    volcanoSemeru,
  ]).addTo(miniMap);

  const toggleBtns = document.querySelectorAll("[data-radar-toggle]");
  toggleBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const toggleType = btn.dataset.radarToggle;
      btn.classList.toggle("radar-tag--active");
      const isActive = btn.classList.contains("radar-tag--active");

      if (toggleType === "quakes") {
        if (isActive) {
          miniMap.addLayer(quakeGroup);
        } else {
          miniMap.removeLayer(quakeGroup);
        }
      } else if (toggleType === "trench") {
        if (isActive) {
          miniMap.addLayer(trenchLine);
        } else {
          miniMap.removeLayer(trenchLine);
        }
      }
    });
  });

  const coordDisplay = document.querySelector("#landing-radar-coords");
  if (coordDisplay) {
    miniMap.on("mousemove", (e) => {
      const lat = e.latlng.lat.toFixed(2);
      const lng = e.latlng.lng.toFixed(2);
      coordDisplay.textContent = `${lat}°, ${lng}°`;
    });
  }

  setTimeout(() => miniMap.invalidateSize(), 300);
  window.addEventListener("resize", () => miniMap.invalidateSize());
}

initLandingMiniMap(map, enterMap);

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

// ---------- Cek risiko: pencarian, lokasi saya, dan pilih titik ----------
const riskDetail = createRiskDetail($("#detail-view"), {
  sidebar,
  onClose: () => risk.clear(),
  onFit: () => risk.fitToResult(),
  onRetry: () => risk.retry(),
});
const toolbar = new MapToolbar({
  basemaps,
  onHome: () => flyToBounds(map, INDONESIA_BOUNDS, viewPadding()),
  onLocate: locateUser,
  onPick: togglePicking,
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
});

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

const symbol = {
  quake: `<span class="sym quake-swatch" style="--c:${DEPTH_CLASSES[0].color}"></span>`,
  volcano: volcanoSwatch(3),
  fault: '<span class="sym sym-line" style="--sym:var(--fault-color)"></span>',
  plate:
    '<span class="sym sym-line sym-line--thick" style="--sym:var(--plate-color)"></span>',
  boundary:
    '<span class="sym sym-line sym-line--thin" style="--sym:var(--boundary-color)"></span>',
  rain: `<span class="sym rain-swatch" style="--c:${CEWS_LEVELS[1].color}"></span>`,
  imerg: `<span class="sym ramp-swatch">${[0, 3, 5].map((i) => `<span style="background:${IMERG_RAMP[i].color}"></span>`).join("")}</span>`,
  landslide: landslideSymbol(),
};

createLayerPanel({
  map,
  container: $("#layer-controls"),
  legend,
  groups: [
    {
      id: "kejadian",
      title: "Kejadian & status",
      items: [
        {
          label: "Gempa BMKG",
          description: "7 hari terakhir · diperbarui tiap menit",
          legendTitle: "Gempa BMKG (7 hari)",
          symbol: symbol.quake,
          layer: earthquakes.layer,
          legend: earthquakeLegend,
          on: true,
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
      note: "BMKG · NASA · PVMBG",
      items: [
        {
          label: "Peringatan hujan tinggi BMKG",
          description: "Per dasarian · kab/kota Waspada ke atas",
          legendTitle: "Peringatan hujan tinggi (BMKG)",
          symbol: symbol.rain,
          layer: rainWarnings,
          legend: rainWarningLegend,
          on: true,
        },
        {
          label: "Hujan terkini dari satelit",
          description: "NASA IMERG · rata-rata 30 menit, terlambat ±5 jam",
          legendTitle: "Hujan satelit (NASA IMERG)",
          symbol: symbol.imerg,
          layer: rainNow,
          legend: imergLegend,
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
  rainList: $("#rain-warnings"),
  rainMeta: $("#rain-warning-meta"),
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
});

let rainSummary = null;
async function refreshRainWarnings() {
  try {
    rainSummary = await getJson("/api/rain-warnings/summary");
    overview.renderRainWarnings(
      rainSummary,
      formatDasarian(rainSummary.dasarian, { short: true }),
    );
    freshness.ok("Peringatan hujan", rainSummary.fetched_at);
  } catch (err) {
    overview.showError(
      $("#rain-warnings"),
      "Peringatan hujan BMKG gagal dimuat. Dicoba lagi otomatis.",
    );
    freshness.fail("Peringatan hujan", err);
  }
}

async function refreshEarthquakes() {
  try {
    const collection = await earthquakes.load();
    overview.renderQuakes(collection);
    freshness.ok("Gempa", collection.meta.synced_at);
  } catch (err) {
    overview.showError(
      $("#quake-list"),
      "Data gempa gagal dimuat. Dicoba lagi otomatis tiap menit.",
    );
    freshness.fail("Gempa", err);
  }
}

async function refreshVolcanoes() {
  try {
    const collection = await volcanoes.load();
    overview.renderVolcanoes(collection);
    freshness.ok("Gunung api", collection.meta.synced_at);
  } catch (err) {
    overview.showError($("#volcano-alerts"), "Status gunung api gagal dimuat.");
    freshness.fail("Gunung api", err);
  }
}

// Layar pembuka hilang setelah data gempa dan gunung api pertama selesai dimuat.
hideSplashWhen(
  $("#splash"),
  Promise.allSettled([refreshEarthquakes(), refreshVolcanoes()]),
);
setInterval(refreshEarthquakes, EARTHQUAKE_REFRESH_MS);
setInterval(refreshVolcanoes, VOLCANO_REFRESH_MS);
refreshRainWarnings();
setInterval(refreshRainWarnings, RAIN_WARNING_REFRESH_MS);
