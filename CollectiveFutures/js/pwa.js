/**
 * bioQuad Stream - Progressive Web App Controller
 * Pure vanilla JavaScript. Handles Service Worker registration, in-app install prompt, and offline detection.
 */

(function () {
  let deferredPrompt = null;
  const isIOS = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  // 1. Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // Use relative path for GitHub Pages subfolder support
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        console.log('[PWA] ServiceWorker registered with scope:', reg.scope);
      }).catch((err) => {
        console.warn('[PWA] ServiceWorker registration failed:', err);
      });
    });
  }

  // 2. Install Prompt Handling
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent default mini-infobar
    e.preventDefault();
    deferredPrompt = e;
    updateInstallButtonUI(true);
  });

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App successfully installed');
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

    if (canInstall || isIOS) {
      installBtn.style.display = 'inline-flex';
    } else {
      installBtn.style.display = 'none';
    }
  }

  // Hook up install trigger
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
    } else {
      alert('bioQuad Stream is ready for offline use. You can also install it via your browser menu (Install / Add to Home Screen).');
    }
  };

  window.closeIOSPWAModal = function () {
    const modal = document.getElementById('ios-pwa-modal');
    if (modal) modal.style.display = 'none';
  };

  // 3. Online / Offline Connectivity Monitor
  function updateOnlineStatus() {
    const indicator = document.getElementById('offline-indicator');
    if (!indicator) return;

    if (!navigator.onLine) {
      indicator.style.display = 'flex';
      indicator.textContent = '⚡ OFFLINE MODE — Running local cache & files';
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
