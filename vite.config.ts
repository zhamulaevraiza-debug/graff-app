import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Приложение может стоять как в корне домена, так и в подпапке (GitHub Pages: /graff-app/).
  // Путь задаётся переменной VITE_BASE при сборке; по умолчанию — корень.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: { port: 5173, strictPort: false },
  build: { target: 'es2020', sourcemap: false },
});
