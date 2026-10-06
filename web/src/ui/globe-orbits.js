import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

// Orbit satelit di atas cakrawala bumi (ui/globe-scene.js), digambar sungguhan dalam 3D di
// adegan yang sama dengan bumi, jadi menyatu saat melintasinya:
// - GPM (NASA dan JAXA, sumber utama data hujan IMERG di peta) di orbit miring 65°. Seperti
//   orbit sungguhan, bidang orbitnya diam dan bumi berputar di bawahnya (ayunan, gulir, dan
//   geseran pengunjung), jadi lintasannya selalu memotong tengah pandangan di atas
//   Indonesia. Garis orbit dan satelitnya tertutup bumi tepat di cakrawala; bagian orbit di
//   belakang bidang cakrawala putus-putus.
// - Pita sapuan yang diukurnya (radiometer GMI 885 km, radar DPR 245 km), jejak tanah, dan
//   titik di bawah satelit digambar di shader permukaan bumi, jadi ikut tingkat cahaya dan
//   kabut laut yang sama dengan peta. Modul ini hanya mengisi uniform-nya.
// - Himawari-9 (JMA, citranya dipakai BMKG) di orbit geostasioner di atas 140,7° BT; bila
//   di luar layar, penunjuk kecil di tepi.
// Jarak orbit berskala untuk GPM (407 km = 1,064 jari-jari bumi) dan tidak berskala untuk
// orbit geostasioner (1,18, aslinya 6,6) supaya terlihat.
const RAD = Math.PI / 180;
const sph = (lon, lat) => new THREE.Vector3(Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD));
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

// node: bujur simpul naik saat bujur tengah pandangan = CENTER_LON (6° di barat tengah).
export const GPM = { incl: 65 * RAD, node: 112, rho: 1.064 };
const CENTER_LON = 118;
const GEO_RHO = 1.18;
const HIMAWARI_LON = 140.7;
// Setengah lebar sapuan (radian busur bumi) dan panjang jejak di belakang satelit.
export const SWATH = { gmi: 442.5 / 6371, dpr: 122.5 / 6371, trail: 0.62 };

// Bidang orbit GPM: simpul naik N, arah terbang di simpul V0, normal bidang.
const N = sph(GPM.node, 0);
const V0 = sph(GPM.node + 90, 0).multiplyScalar(Math.cos(GPM.incl)).add(new THREE.Vector3(0, Math.sin(GPM.incl), 0));
export const ORBIT_NORMAL = N.clone().cross(V0).normalize();
// Titik orbit pada argumen lintang u (radian) dan arah terbangnya.
const pointAt = (u, rho, out = new THREE.Vector3()) => out.copy(N).multiplyScalar(Math.cos(u)).addScaledVector(V0, Math.sin(u)).multiplyScalar(rho);
const dirAt = (u, out = new THREE.Vector3()) => out.copy(N).multiplyScalar(-Math.sin(u)).addScaledVector(V0, Math.cos(u));

const SAT = {
  himawari: { name: 'Himawari-9', role: 'Citra awan untuk BMKG, tiap 10 menit', fact: '35.786 km · 140,7° BT' },
  gpm: { name: 'GPM', role: 'Sumber data hujan IMERG di peta' },
};
// Warna garis per tema: front/back = orbit di depan/belakang bidang cakrawala;
// swathA: kepekatan pita GMI dan jalur DPR.
const COLORS = {
  light: { front: '#3d5f93', back: '#8197b8', geo: '#8fa3c2', trail: '#1d3f73', swath: '#ffffff', dpr: '#1f5fd1', track: '#16325f', swathA: [0.34, 0.3] },
  dark: { front: '#9db8e6', back: '#5c739b', geo: '#5d7398', trail: '#d4e3ff', swath: '#9cc0ff', dpr: '#79aaff', track: '#e1ebff', swathA: [0.16, 0.22] },
};

const dec1 = (v) => v.toFixed(1).replace('.', ',');
const fmtLat = (lat) => (Math.abs(lat) < 0.05 ? '0°' : `${dec1(Math.abs(lat))}° ${lat > 0 ? 'LU' : 'LS'}`);
const fmtLon = (lon) => {
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  return `${dec1(Math.abs(l))}° ${l >= 0 ? 'BT' : 'BB'}`;
};

// ---------- Model 3D satelit ----------
// Bahan toon tiga tingkat cahaya: warna rata seperti kerucut gunung api, bukan gradasi.
const TOON3 = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([105, 180, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();
const SAT_COLORS = { gold: '#d29a2e', silver: '#cfd6df', white: '#eef1f5', panel: '#21407c', dark: '#2a3038' };
// Bahan sendiri per satelit supaya masing-masing bisa dipudarkan saat lewat di belakang teks.
const satMaterials = () => Object.fromEntries(Object.entries(SAT_COLORS).map(([k, hex]) => [k, new THREE.MeshToonMaterial({ color: hex, gradientMap: TOON3, transparent: true })]));
const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const dishG = (r) => new THREE.CylinderGeometry(r, r * 0.3, r * 0.24, 20);
function part(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
// Sumbu model: +Y menjauhi bumi, −Y menghadap bumi (nadir), X searah sayap.
// Himawari-9: badan berfoil emas, satu sayap surya panjang (cirinya), layar penyeimbang di
// sisi lain, antena piring, dan pencitra AHI menghadap bumi.
function himawariModel() {
  const M = satMaterials();
  const g = new THREE.Group();
  g.add(part(boxG(1, 1.1, 1), M.gold));
  g.add(part(boxG(1.08, 0.08, 1.08), M.silver, 0, 0.59, 0));
  g.add(part(new THREE.CylinderGeometry(0.22, 0.28, 0.32, 14), M.dark, 0, -0.7, 0));
  g.add(part(boxG(0.06, 0.3, 0.06), M.silver, -0.18, 0.75, 0));
  const dish = part(dishG(0.36), M.white, -0.3, 0.92, 0);
  dish.rotation.z = 0.5;
  g.add(dish);
  const wing = new THREE.Group();
  wing.position.x = 0.5;
  wing.add(part(boxG(0.5, 0.05, 0.05), M.silver, 0.25, 0, 0));
  for (let k = 0; k < 3; k++) wing.add(part(boxG(0.9, 0.82, 0.04), M.panel, 0.98 + k * 0.95, 0, 0));
  const sail = new THREE.Group();
  sail.position.x = -0.5;
  sail.add(part(boxG(1.0, 0.04, 0.04), M.silver, -0.5, 0, 0));
  sail.add(part(boxG(0.42, 0.7, 0.03), M.white, -1.2, 0, 0));
  g.add(wing, sail);
  g.userData = { wings: [wing], spin: null };
  return g;
}
// GPM: badan perak, radar DPR lebar menghadap bumi, radiometer GMI berupa piringan di atas
// yang berputar 32 kali per menit seperti aslinya, dan dua sayap surya.
function gpmModel() {
  const M = satMaterials();
  const g = new THREE.Group();
  g.add(part(boxG(0.95, 1.2, 0.9), M.silver));
  g.add(part(boxG(0.97, 0.3, 0.92), M.gold, 0, -0.32, 0));
  g.add(part(boxG(1.8, 0.1, 1.15), M.white, 0, -0.68, 0));
  g.add(part(boxG(0.07, 0.32, 0.07), M.silver, 0, 0.75, 0));
  const gmi = new THREE.Group();
  gmi.position.set(0, 0.95, 0);
  const dish = part(dishG(0.42), M.white, 0.16, 0.05, 0);
  dish.rotation.z = -0.75;
  gmi.add(dish);
  g.add(gmi);
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.x = 0.48 * side;
    wing.add(part(boxG(0.36, 0.05, 0.05), M.silver, 0.18 * side, 0, 0));
    for (let k = 0; k < 2; k++) wing.add(part(boxG(0.82, 0.72, 0.04), M.panel, (0.79 + k * 0.86) * side, 0, 0));
    g.add(wing);
    wings.push(wing);
  }
  g.userData = { wings, spin: gmi };
  return g;
}
// Arahkan model: +Y ke `up` (menjauhi bumi), +X ke `fwd` (arah terbang).
function orient(obj, up, fwd) {
  const y = up.clone().normalize();
  const x = fwd.clone().addScaledVector(y, -fwd.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
function setOpacity(obj, a) {
  if (obj.userData.opacity === a) return;
  obj.userData.opacity = a;
  obj.traverse((m) => {
    if (m.material) m.material.opacity = a;
  });
}

// ---------- Garis ----------
// Garis berketebalan piksel (Line2) yang diuji kedalaman terhadap bumi. Bidang potong
// FRONT/BACK memisahkan bagian di depan dan di belakang bidang cakrawala (z = 0).
const FRONT = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)];
const BACK = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)];
function line(points, { width = 1, opacity = 1, dash = 0, clip = null, order = 2 }) {
  const geometry = new LineGeometry();
  geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  const material = new LineMaterial({ color: 0xffffff, linewidth: width, transparent: true, depthWrite: false, dashed: dash > 0, clippingPlanes: clip });
  const l = new Line2(geometry, material);
  l.computeLineDistances();
  l.frustumCulled = false;
  l.renderOrder = order;
  l.userData = { width, opacity, dash };
  return l;
}
const ring = (fn, n = 240) => Array.from({ length: n + 1 }, (_, k) => fn((k / n) * Math.PI * 2));

// ---------- Keterangan 2D ----------
const clearOf = (b, list) => !list.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
function haloText(ctx, text, x, y, color, halo) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
// Keterangan bergaris penunjuk: garis miring pendek dari satelit lalu mendatar ke teks. Sisi
// dicoba kanan-atas, kiri-atas, kanan-bawah, kiri-bawah; sisi terakhir dipakai lagi selama
// masih muat supaya keterangan tidak melompat-lompat.
function annotate(ctx, memo, id, ax, ay, lines, gap, ink, size, blocks, placed, alpha) {
  const widths = lines.map((l) => {
    ctx.font = l.font;
    return ctx.measureText(l.text).width;
  });
  const W = Math.max(...widths);
  const H = lines.length * 15;
  const cands = [[1, -1], [-1, -1], [1, 1], [-1, 1]];
  const last = memo[id];
  const order = last ? [last, ...cands.filter((s) => s[0] !== last[0] || s[1] !== last[1])] : cands;
  for (const [sx, sy] of order) {
    const x0 = ax + sx * gap * 0.7;
    const y0 = ay + sy * gap * 0.7;
    const bx = x0 + sx * 13;
    const by = y0 + sy * 13;
    const tx = sx > 0 ? bx + 9 : bx - 9 - W;
    const ty = by - H / 2;
    const box = { x0: tx - 4, x1: tx + W + 4, y0: ty - 2, y1: ty + H + 2 };
    if (box.x0 < 8 || box.x1 > size.w - 8 || box.y0 < 8 || box.y1 > size.h - 8) continue;
    if (!clearOf(box, blocks) || !clearOf(box, placed)) continue;
    memo[id] = [sx, sy];
    placed.push(box);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ink.ink3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + sx * 6, by);
    ctx.stroke();
    ctx.fillStyle = ink.ink3;
    ctx.beginPath();
    ctx.arc(x0, y0, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      ctx.font = l.font;
      haloText(ctx, l.text, tx, ty + 7.5 + i * 15, l.color, ink.halo);
    });
    return;
  }
}
// Penunjuk di tepi untuk satelit yang sedang di luar layar; tulisan dicoba di tengah, di
// bawah, lalu di atas panah.
function edgeMarker(ctx, edge, lines, ink, blocks, placed, alpha) {
  const { side, x, y } = edge;
  const W = Math.max(
    ...lines.map((l) => {
      ctx.font = l.font;
      return ctx.measureText(l.text).width;
    }),
  );
  const tx = side > 0 ? x - 12 - W : x + 12;
  const dy = [0, 26, -26, 48].find((d) => {
    const b = { x0: tx - 4, x1: tx + W + 4, y0: y + d - 16, y1: y + d + 16 };
    return clearOf(b, blocks) && clearOf(b, placed);
  });
  if (dy === undefined) return;
  placed.push({ x0: tx - 4, x1: tx + W + 4, y0: y + dy - 16, y1: y + dy + 16 });
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ink.ink2;
  ctx.beginPath();
  ctx.moveTo(x + side * 5, y);
  ctx.lineTo(x - side * 2, y - 5);
  ctx.lineTo(x - side * 2, y + 5);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.font = l.font;
    haloText(ctx, l.text, tx, y + dy - 7 + i * 14, l.color, ink.halo);
  });
  if (dy) {
    ctx.strokeStyle = ink.ink3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - side * 4, y + Math.sign(dy) * 6);
    ctx.lineTo(x - side * 4, y + dy - Math.sign(dy) * 12);
    ctx.stroke();
  }
}

// scene: adegan three.js; group: grup bumi (berskala jari-jari, berputar bersama bumi);
// sun: arah cahaya; uniforms: uniform shader permukaan yang diisi (pita sapuan).
export function createOrbits({ scene, group, sun, uniforms, reduced }) {
  scene.add(new THREE.AmbientLight('#ffffff', 1.1));
  const light = new THREE.DirectionalLight('#ffffff', 2.1);
  light.position.copy(sun);
  scene.add(light);

  // Orbit GPM di "ruang": grup yang memutar balik putaran bujur bumi, jadi bidang orbitnya
  // diam terhadap pandangan. Orbit geostasioner dan Himawari-9 menempel di bumi.
  const space = new THREE.Group();
  group.add(space);
  const gpmRing = ring((u) => pointAt(u, GPM.rho));
  const geoRing = ring((a) => sph(a / RAD, 0).multiplyScalar(GEO_RHO));
  const lines = {
    gpmFront: line(gpmRing, { width: 1.25, opacity: 0.8, clip: FRONT }),
    gpmBack: line(gpmRing, { width: 1, opacity: 0.6, dash: 4, clip: BACK }),
    geoFront: line(geoRing, { width: 1, opacity: 0.7, clip: FRONT }),
    geoBack: line(geoRing, { width: 1, opacity: 0.45, dash: 4, clip: BACK }),
  };
  space.add(lines.gpmFront, lines.gpmBack);
  group.add(lines.geoFront, lines.geoBack);

  // Rangka orbit GPM yang diputar sepanjang orbit (sudut u terhadap normal bidang): jejak di
  // belakang satelit (dua tingkat), garis tegak ke titik di bawahnya, dan satelitnya.
  const frame = new THREE.Group();
  space.add(frame);
  const trailOf = (from, to) => Array.from({ length: 31 }, (_, k) => pointAt(from + ((to - from) * k) / 30, GPM.rho));
  lines.trailOld = line(trailOf(-SWATH.trail, -SWATH.trail / 2), { width: 1.6, opacity: 0.45 });
  lines.trailNew = line(trailOf(-SWATH.trail / 2, -0.01), { width: 2.2, opacity: 0.95 });
  lines.drop = line([N.clone(), N.clone().multiplyScalar(GPM.rho - 0.004)], { width: 1, opacity: 0.75, dash: 3 });
  frame.add(lines.trailOld, lines.trailNew, lines.drop);
  const gpm = gpmModel();
  gpm.position.copy(N).multiplyScalar(GPM.rho);
  orient(gpm, N, V0);
  frame.add(gpm);

  const himawari = himawariModel();
  const hDir = sph(HIMAWARI_LON, 0);
  himawari.position.copy(hDir).multiplyScalar(GEO_RHO);
  orient(himawari, hDir, sph(HIMAWARI_LON + 90, 0));
  group.add(himawari);
  for (const m of [gpm, himawari]) m.renderOrder = 4;

  uniforms.uSwath.value.set(SWATH.gmi, SWATH.dpr, SWATH.trail, 0);

  let colors = COLORS.dark;
  let radius = 1;
  // pass: kepekatan pita sapuan; memudar setelah GPM tenggelam di balik bumi dan muncul lagi
  // saat lintasan berikutnya terlihat.
  const state = { u: -0.5, pass: 0, fade: {}, labelSide: {} };
  const tmp = new THREE.Vector3();
  const tmpW = new THREE.Vector3();
  const tmpZ = new THREE.Vector3();
  // Putaran "ruang" terhadap bumi (koordinat bola): balikan putaran bujur bumi.
  const spaceQ = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const inSpace = (p) => p.applyQuaternion(spaceQ);

  // Titik di bola (koordinat bola) → layar: x, y piksel; hidden = di balik bumi.
  function screenOf(p, L) {
    tmpW.copy(p).applyMatrix4(group.matrixWorld);
    tmpZ.copy(p).applyQuaternion(group.quaternion);
    const x = tmpW.x;
    const y = -tmpW.y;
    return { x, y, z: tmpZ.z, hidden: tmpZ.z < 0 && Math.hypot(x - L.cx, y - L.cy) < L.r };
  }
  const onScreen = (p, size, m) => p.x > -m && p.x < size.w + m && p.y > -m && p.y < size.h + m;

  // Kepekatan satelit: pudar ke 30% selama menabrak teks halaman, dihaluskan.
  function fade(id, p, half, blocks) {
    const box = { x0: p.x - half, x1: p.x + half, y0: p.y - half * 0.6, y1: p.y + half * 0.6 };
    const target = clearOf(box, blocks) ? 1 : 0.3;
    const cur = state.fade[id] ?? target;
    const next = reduced ? target : cur + (target - cur) * 0.12;
    state.fade[id] = next;
    return Math.round(next * 50) / 50;
  }

  let info = null;
  return {
    applyTheme(theme) {
      colors = COLORS[theme];
      lines.gpmFront.material.color.set(colors.front);
      lines.gpmBack.material.color.set(colors.back);
      lines.geoFront.material.color.set(colors.geo);
      lines.geoBack.material.color.set(colors.geo);
      for (const l of [lines.trailOld, lines.trailNew, lines.drop]) l.material.color.set(colors.trail);
      uniforms.uSwathCol.value.set(colors.swath);
      uniforms.uDprCol.value.set(colors.dpr);
      uniforms.uSwathA.value.set(...colors.swathA);
      uniforms.uTrackCol.value.set(colors.track);
    },
    // Ketebalan garis dalam piksel layar dan ukuran satelit tetap dalam piksel.
    resize(size, r) {
      radius = r;
      for (const l of Object.values(lines)) {
        l.material.resolution.set(size.w * size.dpr, size.h * size.dpr);
        l.material.linewidth = l.userData.width * size.dpr;
        if (l.userData.dash) {
          l.material.dashSize = l.userData.dash / r;
          l.material.gapSize = (l.userData.dash + 1) / r;
        }
      }
      const px = (size.w < 760 ? 11 : 15) / r;
      gpm.userData.size = himawari.userData.size = px;
    },
    // Dipanggil tiap bingkai setelah grup bumi diletakkan.
    update(t, dt, L, size, intro, blocks) {
      spaceQ.setFromAxisAngle(Y, (L.lon - CENTER_LON) * RAD);
      space.quaternion.copy(spaceQ);
      group.updateMatrixWorld(true);
      // GPM bergerak pelan selama terlihat dan cepat selama di balik bumi atau di luar layar,
      // jadi cepat muncul lagi tanpa terlihat dipercepat.
      const cur = screenOf(inSpace(pointAt(state.u, GPM.rho, tmp)), L);
      const shown = !cur.hidden && onScreen(cur, size, 0);
      if (reduced) state.u = 0.12;
      else state.u = ((state.u + dt * (shown ? 4.4 : 70) * RAD + Math.PI) % (2 * Math.PI)) - Math.PI;
      const u = state.u;
      frame.quaternion.setFromAxisAngle(ORBIT_NORMAL, u);
      frame.updateMatrixWorld(true);
      // Uniform pita sapuan dalam koordinat bumi.
      uniforms.uOrbN.value.copy(ORBIT_NORMAL).applyQuaternion(spaceQ);
      uniforms.uOrbS.value.copy(inSpace(pointAt(u, 1, tmp))).normalize();
      uniforms.uOrbF.value.copy(inSpace(dirAt(u, tmp)));

      const orbitIn = smooth((intro - 0.45) / 0.3);
      const satIn = smooth((intro - 0.6) / 0.3);
      state.pass = reduced ? 1 : state.pass + ((shown ? 1 : 0) - state.pass) * Math.min(1, dt * 2.5);
      uniforms.uSwath.value.w = orbitIn * state.pass;
      for (const l of Object.values(lines)) l.material.opacity = l.userData.opacity * orbitIn;
      lines.drop.visible = lines.trailOld.visible = lines.trailNew.visible = orbitIn > 0;

      // Satelit: ukuran tetap dalam piksel, membesar saat pembuka; panel berayun pelan
      // mengikuti matahari; piringan GMI berputar 32 kali per menit.
      const g = screenOf(inSpace(pointAt(u, GPM.rho, tmp)), L);
      const hPos = screenOf(sph(HIMAWARI_LON, 0).multiplyScalar(GEO_RHO), L);
      const gVisible = !g.hidden && onScreen(g, size, 30);
      const hVisible = !hPos.hidden && onScreen(hPos, size, -24);
      const sizePx = gpm.userData.size * radius;
      for (const [obj, p, id, seed] of [[gpm, g, 'gpm', 1.3], [himawari, hPos, 'himawari', 2.1]]) {
        obj.visible = satIn > 0;
        obj.scale.setScalar(Math.max(1e-5, obj.userData.size * satIn));
        setOpacity(obj, fade(id, p, sizePx * 3, blocks));
        for (const w of obj.userData.wings) w.rotation.x = -0.4 + 0.22 * Math.sin(t * 0.22 + seed);
        if (obj.userData.spin) obj.userData.spin.rotation.y = reduced ? 0.6 : t * (32 / 60) * Math.PI * 2;
      }

      // Penunjuk tepi untuk Himawari-9 bila di luar layar tetapi di sisi depan bumi.
      let edge = null;
      if (!hVisible && hPos.z > 0) {
        const side = Math.sign(hPos.x - L.cx) || 1;
        const ex = side > 0 ? size.w - 14 : 14;
        let best = null;
        for (const p of geoRing) {
          const q = screenOf(p, L);
          if (q.z <= 0 || q.hidden || Math.hypot(q.x - L.cx, q.y - L.cy) < L.r) continue;
          if (!best || Math.abs(q.x - ex) < Math.abs(best.x - ex)) best = q;
        }
        if (best && Math.abs(best.x - ex) < 60) edge = { side, x: ex, y: best.y };
      }
      const ground = inSpace(pointAt(u, 1, tmp));
      info = {
        gpm: { x: g.x, y: g.y, visible: gVisible, coords: `${fmtLat(Math.asin(ground.y) / RAD)} · ${fmtLon(Math.atan2(ground.x, ground.z) / RAD)}` },
        himawari: { x: hPos.x, y: hPos.y, visible: hVisible, edge },
        satIn,
        sizePx,
      };
    },
    // Keterangan di kanvas 2D di atas bumi; tidak pernah menimpa teks halaman.
    drawLabels(ctx, size, intro, ink, blocks) {
      if (!info) return;
      const labIn = smooth((intro - 0.85) / 0.15);
      if (labIn <= 0) return;
      const small = size.w < 760;
      const placed = [];
      const nameFont = `750 ${small ? 12 : 13}px ${ink.font}`;
      const roleFont = `500 11.5px ${ink.font}`;
      const factFont = `500 10.5px ${ink.mono}`;
      ctx.save();
      for (const id of ['gpm', 'himawari']) {
        const s = info[id];
        const meta = SAT[id];
        const lines = [{ text: meta.name, font: nameFont, color: ink.ink }];
        if (!small) {
          lines.push({ text: meta.role, font: roleFont, color: ink.ink2 });
          lines.push({ text: id === 'gpm' ? `di atas ${s.coords}` : meta.fact, font: factFont, color: ink.ink3 });
        }
        if (s.visible && info.satIn > 0.5) annotate(ctx, state.labelSide, id, s.x, s.y, lines, info.sizePx * 1.7, ink, size, blocks, placed, labIn);
        else if (s.edge) edgeMarker(ctx, s.edge, [{ text: meta.name, font: `700 ${small ? 11 : 12}px ${ink.font}`, color: ink.ink }, { text: '140,7° BT', font: `500 10px ${ink.mono}`, color: ink.ink3 }], ink, blocks, placed, labIn);
      }
      ctx.restore();
    },
  };
}
