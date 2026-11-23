/**
 * bioQuad Stream - Progressive Web App Controller
 * Pure vanilla JavaScript. Handles Service Worker registration, in-app install prompt, and offline detection.
 */
(function () {
  let deferredPrompt = null;
  const isIOS = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  const isEmbeddedIframe = (() => {
    try { return window.self !== window.top; } catch (e) { return true; }
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      if (isEmbeddedIframe) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => r.unregister().catch(() => {}));
        }).catch(() => {});
        return;
      }
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        console.log('[PWA] ServiceWorker registered with scope:', reg.scope);
      }).catch((err) => {
        console.warn('[PWA] ServiceWorker registration failed:', err);
      });
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallButtonUI(true);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    updateInstallButtonUI(false);
  });

  function updateInstallButtonUI(canInstall) {
    const installBtn = document.getElementById('btn-pwa-install');
    if (!installBtn) return;
    if (isStandalone) {
      installBtn.style.display = 'none';
      return;
    }
    installBtn.style.display = (canInstall || isIOS) ? 'inline-flex' : 'none';
  }

  window.triggerPWAInstall = async function () {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        deferredPrompt = null;
        updateInstallButtonUI(false);
      }
    } else if (isIOS) {
      const modal = document.getElementById('ios-pwa-modal');
      if (modal) modal.style.display = 'flex';
    }
  };

  window.closeIOSPWAModal = function () {
    const modal = document.getElementById('ios-pwa-modal');
    if (modal) modal.style.display = 'none';
  };

  function updateOnlineStatus() {
    const indicator = document.getElementById('offline-indicator');
    if (!indicator) return;
    if (!navigator.onLine) {
      indicator.style.display = 'flex';
      indicator.textContent = 'OFFLINE';
    } else {
      indicator.style.display = 'none';
    }
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  document.addEventListener('DOMContentLoaded', () => {
    updateOnlineStatus();
    updateInstallButtonUI(false);
  });
})();
