import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages では https://<ユーザー名>.github.io/ai-world-game/app/ で公開する
// (/ai-world-game/ 直下には、app/ へ移動する案内ページだけを置く)
export default defineConfig({
  base: '/ai-world-game/app/',
  build: { outDir: 'dist/app', emptyOutDir: true },
  plugins: [react()],
});
