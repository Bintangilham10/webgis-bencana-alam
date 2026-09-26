import { defineConfig } from 'vite';

// Saat pengembangan, /api diteruskan ke server Express (npm run dev di server/).
const apiProxy = { '/api': 'http://localhost:3000' };

export default defineConfig({
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
});
