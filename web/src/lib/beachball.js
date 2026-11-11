// Bola fokus ("beach ball") mekanisme sumber gempa: proyeksi sama-luas belahan
// bawah. Kuadran berwarna = gerak tanah pertama menjauhi sumber (kompresi),
// kuadran putih = mendekati sumber (dilatasi). Digambar per piksel dari satu
// bidang nodal (jurus, kemiringan, rake dalam derajat; konvensi Aki & Richards),
// jadi bentuk kuadrannya tidak perlu dihitung.

const RAD = Math.PI / 180;
const cache = new Map();

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Penguji kuadran untuk satu bidang nodal: (timur, utara), dengan jarak dari
// pusat ≤ 1 pada proyeksi → true bila arah itu berada di kuadran kompresi.
export function compressionTester({ strike, dip, rake }) {
  const [phi, delta, lambda] = [strike * RAD, dip * RAD, rake * RAD];
  // Normal bidang patahan dan arah gesernya dalam sumbu (utara, timur, bawah).
  const normal = [-Math.sin(delta) * Math.sin(phi), Math.sin(delta) * Math.cos(phi), -Math.cos(delta)];
  const slip = [
    Math.cos(lambda) * Math.cos(phi) + Math.cos(delta) * Math.sin(lambda) * Math.sin(phi),
    Math.cos(lambda) * Math.sin(phi) - Math.cos(delta) * Math.sin(lambda) * Math.cos(phi),
    -Math.sin(lambda) * Math.sin(delta),
  ];
  return (east, north) => {
    // Proyeksi sama-luas: r = √2·sin(i/2), i = sudut dari arah lurus ke bawah.
    const incidence = 2 * Math.asin(Math.min(1, Math.hypot(east, north)) / Math.SQRT2);
    // Azimut dihitung dari utara searah jarum jam.
    const azimuth = Math.atan2(east, north);
    const ray = [Math.sin(incidence) * Math.cos(azimuth), Math.sin(incidence) * Math.sin(azimuth), Math.cos(incidence)];
    return dot(ray, normal) * dot(ray, slip) > 0;
  };
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

// Bola fokus sebagai URL data PNG. `size` = sisi dalam piksel layar; kanvasnya
// 3× supaya garis nodalnya halus juga di layar rapat. `fill` dan `outline`
// berupa "#rrggbb".
export function beachballUrl(plane, { size = 48, fill = '#d7301f', outline = '#111c2a' } = {}) {
  const key = [plane.strike, plane.dip, plane.rake, size, fill, outline].join('|');
  if (cache.has(key)) return cache.get(key);

  const side = size * 3;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext('2d');
  const image = context.createImageData(side, side);
  const center = side / 2;
  const radius = center - 3;
  const colored = [...hexToRgb(fill), 255];
  const isCompression = compressionTester(plane);

  for (let py = 0; py < side; py++) {
    for (let px = 0; px < side; px++) {
      const x = (px + 0.5 - center) / radius;
      const y = (center - (py + 0.5)) / radius;
      if (Math.hypot(x, y) > 1) continue;
      image.data.set(isCompression(x, y) ? colored : [255, 255, 255, 255], 4 * (py * side + px));
    }
  }
  context.putImageData(image, 0, 0);
  // Garis tepi digambar di atasnya supaya tepi lingkaran halus.
  context.beginPath();
  context.arc(center, center, radius, 0, 2 * Math.PI);
  context.lineWidth = 4;
  context.strokeStyle = outline;
  context.stroke();

  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
