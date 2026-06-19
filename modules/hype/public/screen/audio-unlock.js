// Audio autoplay unlock for the screen page.
//
// Browsers block <audio>.play() until the page has received a user gesture.
// For kiosk setups (Raspberry Pi etc.) the screen never gets clicked, so the
// launch/prelaunch SFX silently fail. This module:
//
//   1. Probes autoplay capability on import.
//   2. If blocked, shows a small dismissible banner inviting one tap.
//   3. On any pointer/key/touch interaction, plays a silent buffer to satisfy
//      the autoplay gate, then removes the banner.
//
// Once unlocked, subsequent Audio().play() calls (launch.wav, prelaunch.wav)
// will work for the remainder of the page session.

let _unlocked = false;

export function isAudioUnlocked() { return _unlocked; }

export function ensureAudioUnlock() {
  if (_unlocked) return;

  // Cheap probe: try to play a 1-sample silent WAV. If it resolves, we're good.
  const probe = new Audio(
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
  );
  probe.volume = 0;
  const test = probe.play();
  if (test && typeof test.then === 'function') {
    test.then(() => { _unlocked = true; }).catch(() => _showUnlockBanner());
  } else {
    _unlocked = true;
  }
}

function _showUnlockBanner() {
  if (document.getElementById('hype-audio-unlock')) return;
  const bar = document.createElement('div');
  bar.id = 'hype-audio-unlock';
  bar.textContent = '🔊 Tik op het scherm om geluid aan te zetten';
  Object.assign(bar.style, {
    position: 'fixed', left: '50%', bottom: '20px', transform: 'translateX(-50%)',
    background: 'rgba(20,20,30,0.92)', color: '#fff',
    padding: '12px 22px', borderRadius: '999px',
    fontSize: '16px', fontFamily: 'Inter, system-ui, sans-serif',
    border: '1px solid rgba(255,255,255,0.15)',
    boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
    zIndex: 99999, cursor: 'pointer',
  });
  document.body.appendChild(bar);

  const unlock = () => {
    // Play silent buffer to claim user-gesture credit.
    const a = new Audio(
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
    );
    a.volume = 0;
    const p = a.play();
    if (p && typeof p.then === 'function') p.then(() => {}).catch(() => {});
    _unlocked = true;
    bar.remove();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
  window.addEventListener('touchstart', unlock, { once: false });
}
