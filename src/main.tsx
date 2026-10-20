import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const scope = new URL(import.meta.env.BASE_URL, location.origin).href;
    // 以前の場所(/ai-world-game/)に登録されていたサービスワーカーを削除する
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.filter((r) => r.scope !== scope).forEach((r) => r.unregister());
    });
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
