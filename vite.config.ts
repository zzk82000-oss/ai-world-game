import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages では https://<ユーザー名>.github.io/ai-world-game/ で公開されるため base を指定する
export default defineConfig({
  base: '/ai-world-game/',
  plugins: [react()],
});
