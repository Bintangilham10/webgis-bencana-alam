import * as THREE from 'three';
import { GLOBE_TIERS } from '../lib/globe-tiers.js';
import { easeOutCubic, prefersReducedMotion, tween } from '../lib/motion.js';
import { depthColor, VOLCANO_LEVELS } from '../lib/symbology.js';
import { cssVar, currentTheme, onThemeChange } from '../lib/theme.js';
import { createOrbits } from './globe-orbits.js';

// Latar halaman depan "Atlas alam": bumi besar yang hanya terlihat lengkungnya di bawah
// hero, seperti cakrawala dilihat dari orbit. Permukaannya datar dengan warna yang
// dipilih dari data, bukan foto:
// - laut empat tingkat dari laut dalam sampai paparan dangkal (kecerahan citra
//   batimetri NASA Blue Marble);
// - Indonesia hijau menurut ketinggian (< 400 m, 400–1.500 m, > 1.500 m), benua lain
//   satu warna netral;
// - laut di luar Indonesia memudar ke warna halaman mulai 1,5° sampai 7° dari pantai;
// - cahaya dari kiri atas, dibagi empat tingkat warna rata (bukan gradasi).
// Gunung api Waspada ke atas berdiri sebagai kerucut, gempa terkini sebagai cincin yang
// membesar. Bumi berayun pelan di sekitar Indonesia; menggulir memutarnya sedikit dan
// menurunkan cakrawala supaya bagian berisi teks tetap lega. Pengunjung bisa memutarnya
// sendiri dengan menahan dan menggeser. Di atasnya satelit GPM dan Himawari-9 di orbit 3D
// sungguhan (ui/globe-orbits.js); pita sapuan GPM digambar di shader permukaan ini.
const RAD = Math.PI / 180;
const ASSETS = '/images/landing/bumi/';
// Wilayah rinci yang selalu terlihat di cakrawala; di luar itu tekstur seluruh bumi.
const REGION_BOX = [40, -55, 200, 45];
const WORLD_BOX = [-180, -90, 180, 90];
const ELEV_MAX = 6000;
const DIST_MAX = 12;
const SUN = new THREE.Vector3(-0.45, 0.6, 0.66).normalize();
const INTRO_MS = 3000;
// Saat diam cukup ±30 fps; saat digulir atau kursor bergerak digambar tiap frame.
const IDLE_MS = 33;

// sea: laut dalam → paparan dangkal; idn: hijau rendah → tinggi; rest: benua lain;
// fog: kekuatan pudar laut di luar Indonesia; shade: warna dan kekuatan sisi gelap.
const PALETTE = {
  light: {
    sea: ['#2f5f9e', '#3f75b8', '#6d9fd3', '#a9cde9'],
    idn: ['#6fa35a', '#a9b75d', '#a7845a'],
    rest: '#e7e9e4',
    fog: 0.55,
    shade: ['#22324a', 0.3],
  },
  dark: {
    sea: ['#0b1a33', '#122a4c', '#1c3d66', '#2c5a86'],
    idn: ['#4f9157', '#8c9f47', '#977249'],
    rest: '#2a2f36',
    fog: 0.45,
    shade: ['#020509', 0.45],
  },
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
const mix = (a, b, t) => a + (b - a) * t;
// Bujur 0 menghadap kamera (+z), utara ke atas (+y), 90° BT di +x.
const sph = (lon, lat) => [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)];
const rgb = (hex) => new THREE.Color(hex).toArray();

// ---------- GLSL ----------
const INTRO_GLSL = `
  uniform float uIntro;
  float stagger(float d, float span) { return smoothstep(d, d + span, uIntro); }`;
const ORIENT_GLSL = `
  void basis(vec3 n, out vec3 t, out vec3 b) {
    t = normalize(abs(n.y) > 0.99 ? cross(vec3(1.0, 0.0, 0.0), n) : cross(vec3(0.0, 1.0, 0.0), n));
    b = cross(n, t);
  }`;

const SURFACE_VS = `varying vec3 vDir; varying vec3 vN;
  void main() {
    vDir = position;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const SURFACE_FS = `uniform sampler2D uRegion, uWorld, uSeaW, uSeaI;
  uniform vec4 uRegionBox;
  uniform vec4 uSeaBox;
  uniform vec3 uSea[4], uIdn[3], uRest, uShade, uFogCol;
  uniform float uShadeAmt, uFogAmt;
  uniform vec3 uSun;
  // Pita sapuan GPM (ui/globe-orbits.js): normal bidang orbit, titik di bawah satelit, arah
  // terbangnya; uSwath = setengah lebar GMI dan DPR (radian), panjang jejak (radian), kekuatan.
  uniform vec3 uOrbN, uOrbS, uOrbF, uSwathCol, uDprCol, uTrackCol;
  uniform vec4 uSwath;
  uniform vec2 uSwathA; // kepekatan pita GMI dan DPR (per tema)
  ${INTRO_GLSL}
  varying vec3 vDir; varying vec3 vN;
  float aaStep(float v, float e) { return clamp((v - e) / max(fwidth(v), 1e-4) + 0.5, 0.0, 1.0); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  void main() {
    vec3 d = normalize(vDir);
    float lon = degrees(atan(d.x, d.z));
    float lat = degrees(asin(clamp(d.y, -1.0, 1.0)));
    float lonR = lon < 0.0 ? lon + 360.0 : lon;
    vec2 uvR = vec2((lonR - uRegionBox.x) / uRegionBox.z, (uRegionBox.y - lat) / uRegionBox.w);
    vec4 tr = texture2D(uRegion, uvR);
    vec4 tw = texture2D(uWorld, vec2((lon + 180.0) / 360.0, (90.0 - lat) / 180.0));
    float inR = step(0.0, uvR.x) * step(uvR.x, 1.0) * step(0.0, uvR.y) * step(uvR.y, 1.0);
    vec4 t = mix(tw, tr, inR);
    float land = aaStep(t.r, 0.5);
    float idnLand = aaStep(t.g, 0.5);
    float elev = t.b * ${ELEV_MAX.toFixed(1)};
    float focusDist = mix(${DIST_MAX.toFixed(1)}, t.a * ${DIST_MAX.toFixed(1)}, inR);
    // Pembuka: hijau Indonesia mengisi dari barat ke timur.
    float k = clamp((lon - 95.0) / 46.0, 0.0, 1.0) * 0.6;
    float reveal = stagger(0.25 + k * 0.7, 0.25);
    // Laut: kecerahan citra batimetri dari tingkat mipmap yang lebih kasar supaya batas
    // tingkatnya halus; citra Indonesia yang lebih rinci dilebur 1,5° di tepinya.
    vec2 uvW = vec2((lon + 180.0) / 360.0, (lat + 90.0) / 180.0);
    vec2 uvI = vec2((lon - uSeaBox.x) / (uSeaBox.z - uSeaBox.x), (lat - uSeaBox.y) / (uSeaBox.w - uSeaBox.y));
    float fI = clamp(min(min(lon - uSeaBox.x, uSeaBox.z - lon), min(lat - uSeaBox.y, uSeaBox.w - lat)) / 1.5, 0.0, 1.0);
    float sl = luma(mix(texture2D(uSeaW, uvW, 2.0).rgb, texture2D(uSeaI, uvI, 2.0).rgb, fI));
    vec3 sea = mix(uSea[0], uSea[1], aaStep(sl, 0.006));
    sea = mix(sea, uSea[2], aaStep(sl, 0.02));
    sea = mix(sea, uSea[3], aaStep(sl, 0.035));
    vec3 green = mix(mix(uIdn[0], uIdn[1], aaStep(elev, 400.0)), uIdn[2], aaStep(elev, 1500.0));
    vec3 c = mix(sea, mix(uRest, green, idnLand * reveal), land);
    // Sapuan GPM digambar sebelum cahaya dan kabut supaya menyatu dengan peta.
    if (uSwath.w > 0.0) {
      float cr = asin(clamp(dot(d, uOrbN), -1.0, 1.0));
      vec3 pp = d - uOrbN * dot(d, uOrbN);
      float al = atan(dot(pp, uOrbF), dot(pp, uOrbS));
      // Ujung jejak tanpa antialias: atan melompat di sisi seberang bumi.
      float tail = step(-uSwath.z, al) * step(al, 0.0);
      float older = step(al, -uSwath.z * 0.5);
      float gmi = 1.0 - aaStep(abs(cr), uSwath.x);
      float dpr = 1.0 - aaStep(abs(cr), uSwath.y);
      // Pita GMI lebar dan jalur radar DPR di tengahnya, dua warna rata; separuh yang lebih
      // lama lebih pucat.
      float strength = tail * mix(1.0, 0.55, older) * uSwath.w;
      c = mix(c, uSwathCol, gmi * uSwathA.x * strength);
      c = mix(c, uDprCol, dpr * uSwathA.y * strength);
      // Jejak tanah dan titik tepat di bawah satelit (lingkaran kecil dengan titik tengah).
      float track = (1.0 - clamp(abs(cr) / max(fwidth(cr), 1e-6) - 0.4, 0.0, 1.0)) * tail;
      float rr = length(d - uOrbS);
      float pip = max(1.0 - clamp(abs(rr - 0.012) / max(fwidth(rr), 1e-6) - 0.4, 0.0, 1.0), 1.0 - aaStep(rr, 0.0035));
      c = mix(c, uTrackCol, max(track * 0.7, pip * 0.9) * uSwath.w);
    }
    vec3 n = normalize(vN);
    float q = floor(clamp((dot(n, uSun) + 0.2) / 1.1, 0.0, 0.9999) * 4.0) / 3.0;
    c = mix(c, uShade, (1.0 - q) * uShadeAmt);
    // Laut di luar Indonesia memudar ke warna halaman.
    float fog = max(smoothstep(1.5, 7.0, focusDist), 1.0 - reveal) * uFogAmt * (1.0 - land);
    c = mix(c, uFogCol, fog);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

// Penanda berdiri tegak lurus permukaan; ukurannya tetap dalam piksel (uScale).
const STAND_VS = `attribute vec3 aDir; attribute vec3 aColor; attribute float aLen; uniform float uWidth, uFrom, uScale;
  varying vec3 vView; varying vec3 vColor;
  ${INTRO_GLSL}
  ${ORIENT_GLSL}
  void main() {
    vec3 t, b; basis(aDir, t, b);
    float g = stagger(uFrom, 0.25);
    vec3 p = aDir * (1.0 + position.y * aLen * uScale * g) + (t * position.x + b * position.z) * uWidth * uScale * min(1.0, g * 3.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = mv.xyz; vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }`;
const STAND_FS = `uniform vec3 uSun; varying vec3 vView; varying vec3 vColor;
  void main() {
    vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
    if (n.z < 0.0) n = -n;
    float q = floor(clamp((dot(n, uSun) + 0.3) / 1.2, 0.0, 0.9999) * 3.0) / 2.0;
    gl_FragColor = vec4(vColor * (0.55 + 0.45 * q), 1.0);
    #include <colorspace_fragment>
  }`;
const RING_VS = `attribute vec3 aDir; attribute vec3 aColor; attribute float aM; attribute float aPhase; uniform float uTime, uScale;
  varying vec3 vColor; varying float vA;
  ${INTRO_GLSL}
  ${ORIENT_GLSL}
  void main() {
    float ph = fract(uTime / 2.6 + aPhase);
    float s = (0.005 + ph * (0.02 + max(0.0, aM - 2.0) * 0.012)) * uScale;
    vec3 t, b; basis(aDir, t, b);
    vec3 p = aDir * 1.003 + (t * position.x + b * position.y) * s;
    vColor = aColor; vA = (1.0 - ph) * stagger(0.8, 0.2);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const RING_FS = `varying vec3 vColor; varying float vA;
  void main() {
    gl_FragColor = vec4(vColor, vA);
    #include <colorspace_fragment>
  }`;
// Pita atmosfer 9 px dan garis tepi 1 px di luar bola, satu warna rata. Digambar di bidang
// cakrawala (z = 0) supaya orbit di depan bumi lewat di depannya dan yang di belakang tertutup.
const BAND_VS = `varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const BAND_FS = `uniform vec3 uAtmo, uRim;
  uniform float uPx, uShow;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    if (r < 1.0) discard;
    float aa = max(fwidth(r), 1e-6);
    float band = 1.0 - clamp((r - (1.0 + 9.0 * uPx)) / aa + 0.5, 0.0, 1.0);
    float rim = clamp(1.0 - abs(r - (1.0 + 0.5 * uPx)) / aa, 0.0, 1.0);
    float a = max(band, rim) * uShow;
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uAtmo, uRim, rim), a);
    #include <colorspace_fragment>
  }`;

function instanced(base, attrs, count) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.attributes[name]);
  for (const [name, [data, size]] of Object.entries(attrs)) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(data), size));
  g.instanceCount = count;
  return g;
}
function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.frustumCulled = false;
  return m;
}

function dataTexture(buffer, width, height) {
  const tex = new THREE.DataTexture(new Uint8Array(buffer), width, height, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
async function imageTexture(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
function buildData(small) {
  const tier = (name) => GLOBE_TIERS.find((t) => t.name === name);
  const job = {
    pantai: new URL(`${ASSETS}pantai.json`, location.href).href,
    tiers: ['bumi', 'indonesia'].map((name) => ({ ...tier(name), url: new URL(`${ASSETS}${name}-tinggi.webp`, location.href).href })),
    region: { box: REGION_BOX, width: small ? 2048 : 4096, height: small ? 1280 : 2560 },
    world: { box: WORLD_BOX, width: 2048, height: 1024 },
    elevMax: ELEV_MAX,
    distMax: DIST_MAX,
  };
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./globe-data.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve({ job, ...data });
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'worker gagal'));
    };
    worker.postMessage(job);
  });
}

// box: wadah latar yang menempel; canvas: kanvas WebGL; marks: kanvas 2D untuk keterangan
// satelit; root: elemen gulir halaman depan.
export function createGlobeScene({ box, canvas, marks, root }) {
  const reduced = prefersReducedMotion();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  // Garis orbit dipotong di bidang cakrawala (ui/globe-orbits.js).
  renderer.localClippingEnabled = true;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const mctx = marks.getContext('2d');

  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 20000);
  camera.position.z = 10000;
  const black = () => new THREE.Color(0, 0, 0);
  const u = {
    uRegion: { value: null },
    uWorld: { value: null },
    uSeaW: { value: null },
    uSeaI: { value: null },
    uRegionBox: { value: new THREE.Vector4(REGION_BOX[0], REGION_BOX[3], REGION_BOX[2] - REGION_BOX[0], REGION_BOX[3] - REGION_BOX[1]) },
    uSeaBox: { value: new THREE.Vector4(...GLOBE_TIERS.find((t) => t.name === 'indonesia').bbox) },
    uSea: { value: [black(), black(), black(), black()] },
    uIdn: { value: [black(), black(), black()] },
    uRest: { value: black() },
    uShade: { value: black() },
    uFogCol: { value: black() },
    uShadeAmt: { value: 0 },
    uFogAmt: { value: 0 },
    uSun: { value: SUN },
    uIntro: { value: reduced ? 1 : 0 },
    uOrbN: { value: new THREE.Vector3(0, 1, 0) },
    uOrbS: { value: new THREE.Vector3(0, 0, 1) },
    uOrbF: { value: new THREE.Vector3(1, 0, 0) },
    uSwathCol: { value: black() },
    uDprCol: { value: black() },
    uSwathA: { value: new THREE.Vector2(0.3, 0.3) },
    uTrackCol: { value: black() },
    uSwath: { value: new THREE.Vector4() },
  };
  const surface = mesh(new THREE.SphereGeometry(1, 320, 220), new THREE.ShaderMaterial({ vertexShader: SURFACE_VS, fragmentShader: SURFACE_FS, uniforms: u }));
  surface.visible = false;
  group.add(surface);
  const bandU = { uAtmo: { value: black() }, uRim: { value: black() }, uPx: { value: 0.001 }, uShow: { value: 0 } };
  const band = mesh(new THREE.PlaneGeometry(2.1, 2.1), new THREE.ShaderMaterial({ vertexShader: BAND_VS, fragmentShader: BAND_FS, uniforms: bandU, transparent: true }));
  band.renderOrder = 1;
  band.visible = false;
  scene.add(band);
  const orbits = createOrbits({ scene, group, sun: SUN, uniforms: u, reduced });

  // ---------- Warna per tema ----------
  let ink = null;
  const withAlpha = (hex, a) => {
    const n = Number.parseInt(hex.replace('#', ''), 16) || 0;
    return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`;
  };
  function applyTheme() {
    const p = PALETTE[currentTheme()];
    p.sea.forEach((hex, i) => u.uSea.value[i].set(hex));
    p.idn.forEach((hex, i) => u.uIdn.value[i].set(hex));
    u.uRest.value.set(p.rest);
    u.uShade.value.set(p.shade[0]);
    u.uShadeAmt.value = p.shade[1];
    u.uFogAmt.value = p.fog;
    u.uFogCol.value.set(cssVar('--lp-bg', root) || '#0e1013');
    bandU.uAtmo.value.set(cssVar('--lp-globe-atmo', root) || '#16223a');
    bandU.uRim.value.set(cssVar('--lp-globe-rim', root) || '#2a3a58');
    orbits.applyTheme(currentTheme());
    ink = {
      ink: cssVar('--ink', root),
      ink2: cssVar('--ink-2', root),
      ink3: cssVar('--ink-3', root),
      halo: withAlpha(cssVar('--lp-bg', root) || '#0e1013', 0.9),
      font: cssVar('--font', root) || 'sans-serif',
      mono: cssVar('--mono', root) || 'monospace',
    };
  }
  applyTheme();

  // ---------- Penanda ----------
  let markers = [];
  const ringTime = { value: 0 };
  function setMarkers(kind, build) {
    for (const m of markers.filter((m) => m.userData.kind === kind)) {
      group.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    markers = markers.filter((m) => m.userData.kind !== kind);
    const m = build();
    if (!m) return;
    m.userData.kind = kind;
    markers.push(m);
    group.add(m);
    invalidate();
  }
  function standing(base, items, width, from) {
    if (!items.length) return null;
    const uu = { uWidth: { value: width }, uFrom: { value: from }, uSun: { value: SUN }, uIntro: u.uIntro, uScale: { value: 1 } };
    return mesh(
      instanced(base.translate(0, 0.5, 0), { aDir: [items.flatMap((i) => i.dir), 3], aColor: [items.flatMap((i) => i.color), 3], aLen: [items.map((i) => i.len), 1] }, items.length),
      new THREE.ShaderMaterial({ vertexShader: STAND_VS, fragmentShader: STAND_FS, uniforms: uu }),
    );
  }
  function rings(quakes) {
    if (!quakes.length) return null;
    const uu = { uTime: ringTime, uIntro: u.uIntro, uScale: { value: 1 } };
    return mesh(
      instanced(
        new THREE.RingGeometry(0.78, 1, 40),
        { aDir: [quakes.flatMap((q) => q.dir), 3], aColor: [quakes.flatMap((q) => q.color), 3], aM: [quakes.map((q) => q.m), 1], aPhase: [quakes.map((_, i) => (i * 0.37) % 1), 1] },
        quakes.length,
      ),
      new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, uniforms: uu, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
  }

  // ---------- Ukuran dan posisi ----------
  let size = { w: 1, h: 1, dpr: 1 };
  const radiusFor = (w) => (w < 760 ? w * 1.7 : w * 1.25);
  // Teks dan mockup halaman yang tidak boleh tertimpa keterangan satelit; posisinya dibaca
  // tiap bingkai karena laptop di tur fitur menempel saat digulir.
  const BLOCK_SEL = 'h1, h2, h3, h4, p, li, figure, .lp-btn, .lp-nav, .lp-tablet, .lp-laptop, .lp-phone';
  let blockEls = [];
  function textBlocks() {
    const origin = root.getBoundingClientRect();
    const out = [];
    for (const el of blockEls) {
      const r = el.getBoundingClientRect();
      if (r.bottom < origin.top || r.top > origin.bottom || !r.width) continue;
      out.push({ x0: r.left - origin.left - 8, x1: r.right - origin.left + 8, y0: r.top - origin.top - 6, y1: r.bottom - origin.top + 6 });
    }
    return out;
  }
  function layout() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    // Batasi jumlah piksel di layar besar supaya GPU tidak berat.
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (w * h)));
    size = { w, h, dpr };
    box.style.height = `${h}px`;
    box.style.marginBottom = `-${h}px`;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    marks.width = Math.round(w * dpr);
    marks.height = Math.round(h * dpr);
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    camera.right = w;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
    orbits.resize(size, radiusFor(w));
    blockEls = [...root.querySelectorAll(BLOCK_SEL)].filter((el) => !el.closest('.lp-globe'));
    invalidate();
  }

  // Cakrawala: jari-jari tetap (tanpa zoom). Di hero lengkungnya setinggi 42% layar,
  // setelah hero turun ke 13% (HP: 22% dan 10%). k = tinggi Indonesia di atas pusat bola,
  // dipilih supaya Indonesia di tengah lengkung.
  let intro = reduced ? 1 : 0;
  // Putaran dari menahan dan menggeser bumi (derajat), plus laju bujur untuk inersia
  // setelah dilepas. swayT = jam ayunan; berhenti selama bumi dipegang.
  const drag = { lon: 0, lat: 0, v: 0, id: null, x: 0, y: 0, at: 0 };
  let swayT = 0;
  function placement() {
    const { w, h } = size;
    const narrow = w < 760;
    const r = radiusFor(w);
    const cap = h * (narrow ? 0.22 : 0.42);
    const lowCap = h * (narrow ? 0.1 : 0.13);
    const sink = smooth((root.scrollTop - h * 0.2) / (h * 0.9));
    const c = mix(cap, lowCap, sink);
    const kAt = mix(1 - (cap * 0.5) / r, 1 - (lowCap * 0.55) / r, sink);
    const rise = 1 - easeOutCubic(clamp01(intro * 1.6));
    const cy = h - c + r + rise * h * 0.45;
    // Bujur di tengah: berayun ±18° tiap 90 detik di sekitar Indonesia (mulai ke timur, ke
    // arah Himawari-9), gulir memutarnya sampai 15°, lalu ditambah putaran dari menggeser.
    const sway = reduced ? 0 : 18 * Math.sin((swayT * Math.PI * 2) / 90);
    const lon = 118 + sway - Math.min(15, root.scrollTop * 0.006) + rise * 60 + drag.lon;
    const lat0 = -2 - Math.asin(Math.min(0.999, kAt)) / RAD + drag.lat;
    return { cx: w / 2, cy, r, lon, lat0, show: clamp01(intro * 3) };
  }

  // ---------- Gambar ----------
  let ready = false;
  let playing = false;
  let stopped = false;
  let frame = 0;
  let lastDraw = 0;
  let dirty = true;
  let lastTick = 0;
  let lastRender = 0;
  let lastL = null;
  const t0 = performance.now();

  function render(now) {
    const t = reduced ? 6 : (now - t0) / 1000;
    const dt = lastRender ? Math.min(0.1, (now - lastRender) / 1000) : 0;
    lastRender = now;
    const L = placement();
    lastL = L;
    group.position.set(L.cx, -L.cy, 0);
    group.scale.setScalar(L.r);
    group.rotation.set(L.lat0 * RAD, -L.lon * RAD, 0);
    band.position.set(L.cx, -L.cy, 0);
    band.scale.setScalar(L.r);
    bandU.uPx.value = 1 / L.r;
    bandU.uShow.value = L.show;
    ringTime.value = t;
    const scale = Math.min(1.5, 430 / L.r);
    for (const m of markers) m.material.uniforms.uScale.value = scale;
    const blocks = textBlocks();
    orbits.update(t, dt, L, size, intro, blocks);
    renderer.render(scene, camera);
    mctx.clearRect(0, 0, size.w, size.h);
    orbits.drawLabels(mctx, size, intro, ink, blocks);
  }

  function tick(now) {
    frame = 0;
    if (stopped || !ready) return;
    const dt = Math.min(0.1, (now - (lastTick || now)) / 1000);
    lastTick = now;
    // Inersia setelah dilepas: laju putar habis dalam ±1 detik.
    const coasting = drag.id === null && Math.abs(drag.v) > 0.05;
    if (coasting) {
      drag.lon += drag.v * dt;
      drag.v *= 0.04 ** dt;
    } else if (drag.id === null) drag.v = 0;
    if (!reduced && drag.id === null) swayT += dt;
    if (dirty || coasting || (!reduced && now - lastDraw >= IDLE_MS)) {
      dirty = false;
      render(now);
      lastDraw = now;
    }
    if (!reduced || dirty || coasting) frame = requestAnimationFrame(tick);
    else lastTick = 0;
  }
  function invalidate() {
    dirty = true;
    if (!frame && !stopped && ready) frame = requestAnimationFrame(tick);
  }

  function startIntro() {
    if (!ready || !playing || reduced || intro > 0) return;
    tween(INTRO_MS, (p) => {
      intro = p;
      u.uIntro.value = p;
      invalidate();
    });
  }

  const onScroll = () => invalidate();

  // ---------- Memutar: tahan dan geser ----------
  // Hanya di bagian bumi yang tidak tertutup isi halaman: teks tetap bisa diseleksi dan
  // tombol, tautan, serta mockup tetap bisa diklik. Di layar sentuh hanya geser mendatar;
  // geser tegak tetap menggulir halaman (touch-action: pan-y di .landing).
  const NO_GRAB = 'a, button, input, select, textarea, label, summary, figure, [data-tilt], p, h1, h2, h3, h4, h5, li, dt, dd, .lp-nav, footer';
  function grabbable(e) {
    if (!ready || !lastL || e.target.closest(NO_GRAB)) return false;
    const rect = root.getBoundingClientRect();
    return Math.hypot(e.clientX - rect.left - lastL.cx, e.clientY - rect.top - lastL.cy) <= lastL.r;
  }
  const onDown = (e) => {
    if (e.button !== 0 || drag.id !== null || !grabbable(e)) return;
    Object.assign(drag, { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), v: 0 });
    root.setPointerCapture?.(e.pointerId);
    root.classList.add('is-grabbing');
    // Mencegah seleksi teks yang ikut tertarik saat menggeser dengan mouse.
    if (e.pointerType !== 'touch') e.preventDefault();
  };
  const onMove = (e) => {
    if (drag.id !== e.pointerId) {
      if (e.pointerType === 'mouse') root.classList.toggle('can-grab', grabbable(e));
      return;
    }
    // Satu piksel = satu piksel di permukaan dekat pusat bola.
    const k = 180 / Math.PI / lastL.r;
    const now = performance.now();
    const dx = e.clientX - drag.x;
    const dy = e.pointerType === 'touch' ? 0 : e.clientY - drag.y;
    drag.lon -= dx * k;
    drag.lat = Math.max(-15, Math.min(15, drag.lat + dy * k));
    drag.v = mix(drag.v, (-dx * k) / (Math.max(8, now - drag.at) / 1000), 0.5);
    Object.assign(drag, { x: e.clientX, y: e.clientY, at: now });
    invalidate();
  };
  const onUp = (e) => {
    if (drag.id !== e.pointerId) return;
    drag.id = null;
    root.classList.remove('is-grabbing');
    // Tanpa inersia bila gerakan dikurangi atau bumi dilepas setelah diam sejenak.
    if (reduced || performance.now() - drag.at > 90) drag.v = 0;
    invalidate();
  };
  root.addEventListener('scroll', onScroll, { passive: true });
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  const resize = new ResizeObserver(layout);
  resize.observe(root);
  onThemeChange(() => {
    // Variabel CSS tema baru sudah berlaku saat pendengar dipanggil.
    applyTheme();
    invalidate();
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    stopped = true;
  });
  layout();

  // Data permukaan (worker) dan citra batimetri dimuat bersamaan; latar baru tampil
  // setelah semuanya siap, supaya tidak sempat terlihat setengah jadi.
  const small = Math.min(innerWidth, innerHeight) < 700;
  Promise.all([buildData(small), imageTexture(`${ASSETS}bumi-warna.webp`), imageTexture(`${ASSETS}indonesia-warna.webp`)])
    .then(([data, seaW, seaI]) => {
      if (stopped) return;
      u.uRegion.value = dataTexture(data.region, data.job.region.width, data.job.region.height);
      u.uWorld.value = dataTexture(data.world, data.job.world.width, data.job.world.height);
      for (const tex of [u.uRegion.value, u.uWorld.value, seaW, seaI]) tex.anisotropy = aniso;
      u.uSeaW.value = seaW;
      u.uSeaI.value = seaI;
      surface.visible = true;
      band.visible = true;
      ready = true;
      box.classList.add('is-ready');
      startIntro();
      invalidate();
    })
    .catch((err) => console.warn('Latar bumi dimatikan:', err));

  return {
    play() {
      playing = true;
      startIntro();
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      frame = 0;
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
      root.classList.remove('can-grab', 'is-grabbing');
      resize.disconnect();
      // Halaman depan tidak muncul lagi: lepaskan memori GPU untuk peta.
      scene.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      for (const key of ['uRegion', 'uWorld', 'uSeaW', 'uSeaI']) u[key].value?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
    setQuakes(features) {
      setMarkers('quakes', () => rings(features.map(({ geometry, properties: p }) => ({ dir: sph(...geometry.coordinates), color: rgb(depthColor(p.depth_class)), m: p.magnitude }))));
    },
    setVolcanoes(features) {
      setMarkers('volcanoes', () =>
        standing(
          new THREE.ConeGeometry(1, 1, 5),
          features
            .filter((f) => f.properties.level >= 2)
            .map(({ geometry, properties: p }) => ({ dir: sph(...geometry.coordinates), color: rgb(VOLCANO_LEVELS[p.level].color), len: p.level >= 3 ? 0.04 : 0.025 })),
          0.0075,
          0.6,
        ),
      );
    },
  };
}
