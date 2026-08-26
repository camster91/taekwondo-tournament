export function registerOfflineShell(scriptUrl = '/sw.js'): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(scriptUrl).catch((error: unknown) => {
      console.warn('[offline-shell] Service worker registration failed; online mode remains available.', error);
    });
  }, { once: true });
}
