import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    /**
     * The API runs on its own origin and sets an httpOnly session cookie, so
     * requests go out with credentials. Proxying `/api` in development keeps
     * the browser treating both as one origin, which means the dev setup does
     * not need SameSite=None.
     */
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
