// Slide renderer: video
// Returns a Promise that resolves when the video has finished playing
// (or when durationSec elapses for looping videos).

/**
 * @param {object} slide  – the slide object from the library
 * @returns {{ el: HTMLElement, play: () => Promise<void> }}
 */
export function buildVideoSlide(slide) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;background:#000;display:flex;align-items:center;justify-content:center;';

  const video = document.createElement('video');
  video.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
  video.src     = `/slide-assets/videos/${encodeURIComponent(slide.filename)}`;
  video.muted   = slide.muted !== false;
  video.preload = 'auto';
  video.playsInline = true;

  wrap.appendChild(video);

  const playCount = typeof slide.playCount === 'number' ? slide.playCount : 1;

  function play() {
    return new Promise(resolve => {
      let playsLeft = playCount === 0 ? Infinity : playCount;

      function onEnded() {
        playsLeft -= 1;
        if (playsLeft <= 0) {
          video.removeEventListener('ended', onEnded);
          resolve();
        } else {
          video.currentTime = 0;
          video.play().catch(() => resolve());
        }
      }

      video.addEventListener('ended', onEnded);
      video.addEventListener('error', () => resolve(), { once: true });

      video.play().catch(() => resolve());
    });
  }

  return { el: wrap, play };
}
