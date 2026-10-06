// Data permukaan untuk latar bumi halaman depan (ui/globe-scene.js), dihitung di luar
// thread utama supaya halaman tidak tersendat. Hasilnya tekstur RGBA per wilayah:
//   R  tutupan daratan (0–255, tepi antialias)
//   G  tutupan daratan Indonesia
//   B  ketinggian daratan, 0–ELEV_MAX m
//   A  jarak ke pantai Indonesia, 0–DIST_MAX derajat (hanya wilayah rinci)
// Warna akhirnya baru dipilih di shader.
//
// Pesan masuk: { pantai, tiers, region: {box, width, height}, world: {...}, elevMax, distMax }
// Pesan keluar: { region: ArrayBuffer, world: ArrayBuffer } atau { error }.

async function bitmapPixels(url) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return { w: bitmap.width, h: bitmap.height, d: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
}

// Ketinggian dibaca bilinear supaya batas tingkatnya halus. Wilayah Indonesia memakai
// tekstur yang lebih rinci.
function elevation(tiers) {
  const at = ({ img, bbox, maxHeight }, lon, lat) => {
    const fx = ((lon - bbox[0]) / (bbox[2] - bbox[0])) * img.w - 0.5;
    const fy = ((bbox[3] - lat) / (bbox[3] - bbox[1])) * img.h - 0.5;
    const x0 = Math.max(0, Math.min(img.w - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(img.h - 2, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - x0));
    const ty = Math.min(1, Math.max(0, fy - y0));
    const g = (x, y) => img.d[(y * img.w + x) * 4];
    return (((g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty) / 255) * maxHeight;
  };
  const [world, detail] = tiers;
  const inner = (lon, lat) => lon > detail.bbox[0] + 0.5 && lon < detail.bbox[2] - 0.5 && lat > detail.bbox[1] + 0.5 && lat < detail.bbox[3] - 0.5;
  return (lon, lat) => at(inner(lon, lat) ? detail : world, lon, lat);
}

// Tutupan poligon per piksel. Cincin digambar dua kali (+360°) supaya wilayah yang
// melewati 180° BT tetap terisi.
function coverage(rings, [lon0, lat0, lon1, lat1], W, H) {
  const canvas = new OffscreenCanvas(W, H);
  const x = canvas.getContext('2d', { willReadFrequently: true });
  const sx = W / (lon1 - lon0);
  const sy = H / (lat1 - lat0);
  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);
  x.fillStyle = '#fff';
  for (const off of [0, 360]) {
    x.beginPath();
    for (const ring of rings) {
      ring.forEach(([lon, lat], i) => (i ? x.lineTo : x.moveTo).call(x, (lon + off - lon0) * sx, (lat1 - lat) * sy));
      x.closePath();
    }
    x.fill('nonzero');
  }
  const d = x.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return out;
}

// Jarak ke piksel daratan terdekat (dalam piksel): transformasi jarak chamfer dua lintasan.
function distance(mask, W, H) {
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] > 127 ? 0 : 1e6;
  const S = Math.SQRT2;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      let v = d[k];
      if (v === 0) continue;
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) {
        v = Math.min(v, d[k - W] + 1);
        if (i > 0) v = Math.min(v, d[k - W - 1] + S);
        if (i < W - 1) v = Math.min(v, d[k - W + 1] + S);
      }
      d[k] = v;
    }
  }
  for (let j = H - 1; j >= 0; j--) {
    for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i;
      let v = d[k];
      if (v === 0) continue;
      if (i < W - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < H - 1) {
        v = Math.min(v, d[k + W] + 1);
        if (i < W - 1) v = Math.min(v, d[k + W + 1] + S);
        if (i > 0) v = Math.min(v, d[k + W - 1] + S);
      }
      d[k] = v;
    }
  }
  return d;
}

function surface(pantai, elev, { box, width: W, height: H }, { elevMax, distMax, withDistance }) {
  const land = coverage(pantai.land, box, W, H);
  const idn = coverage(pantai.idn, box, W, H);
  const dist = withDistance ? distance(idn, W, H) : null;
  const deg = (box[2] - box[0]) / W;
  const latStep = (box[3] - box[1]) / H;
  const data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const lat = box[3] - (j + 0.5) * latStep;
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      let lon = box[0] + (i + 0.5) * deg;
      if (lon > 180) lon -= 360;
      data[k * 4] = land[k];
      data[k * 4 + 1] = idn[k];
      data[k * 4 + 2] = land[k] > 20 ? Math.min(255, Math.round((elev(lon, lat) / elevMax) * 255)) : 0;
      data[k * 4 + 3] = dist ? Math.min(255, Math.round(((dist[k] * deg) / distMax) * 255)) : 255;
    }
  }
  return data.buffer;
}

self.onmessage = async ({ data: job }) => {
  try {
    const [pantai, ...imgs] = await Promise.all([fetch(job.pantai).then((r) => r.json()), ...job.tiers.map((t) => bitmapPixels(t.url))]);
    const elev = elevation(job.tiers.map((t, i) => ({ ...t, img: imgs[i] })));
    const options = { elevMax: job.elevMax, distMax: job.distMax };
    const region = surface(pantai, elev, job.region, { ...options, withDistance: true });
    const world = surface(pantai, elev, job.world, { ...options, withDistance: false });
    self.postMessage({ region, world }, [region, world]);
  } catch (err) {
    self.postMessage({ error: String(err?.message || err) });
  }
};
