import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 文章AIの比較テスト環境。ゲーム本体とは別のページ(/ai-world-game/lab/)として公開する
export default defineConfig({
  root: 'lab',
  base: '/ai-world-game/lab/',
  build: { outDir: '../dist/lab', emptyOutDir: true },
  server: { fs: { allow: ['..'] } },
  plugins: [react()],
});
