import { defineConfig } from 'vite';

// Saat pengembangan, /api diteruskan ke server Express (npm run dev di server/).
const apiProxy = { '/api': 'http://localhost:3000' };

export default defineConfig({
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
  // three.js untuk latar halaman depan (ui/globe-scene.js) ±540 kB, tetapi dimuat
  // terpisah setelah halaman tampil. Dua halaman: peta (index.html) dan dokumentasi
  // API untuk pengembang (pengembang.html).
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: { input: { main: 'index.html', pengembang: 'pengembang.html' } },
  },
});
