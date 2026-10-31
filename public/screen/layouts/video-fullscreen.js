// Fullscreen video layout — media-driven duration via onDidShow.
//
// Plays a session of cfg.videoBatchSize pool videos back-to-back with a
// reels-style scroll-up between them. Frequency is deterministic: the
// schedule() hook returns 'now' after every cfg.videoEveryCycles photo
// cycles (0 = only via the admin "play videos now" button), never leaving
// it to the random layout draw. Modules can re-skin the player by
// registering a 'pool-video' slide builder (e.g. hype's reel chrome).

import { el } from '../../shared/utils.js';
import { buildVideoSlide } from '../slides/video.js';
import { getModuleSlideBuilder, onScreenEvent, emitScreenEvent } from '../module-registry.js';
import { getVideoPool } from '../video-pool.js';
import { displayState } from './index.js';

const SCROLL_MS = 650;

let _cyclesSinceVideo = 0;
let _pendingRun = null;   // 'all' | 'batch' | positive integer
let _pendingVideoId = null;

onScreenEvent('layout:cycle', ({ layoutType }) => {
  _cyclesSinceVideo = layoutType === 'video-fullscreen' ? 0 : _cyclesSinceVideo + 1;
});

// Called from app.js on the 'play_videos_now' WS message.
export function requestVideoSession(count, videoId) {
  _pendingRun = count === 'all' ? 'all' : Number.isInteger(count) && count > 0 ? count : 'batch';
  _pendingVideoId = videoId || null;
  emitScreenEvent('layout:request-cycle'); // cut the current layout short
}

function _buildSlide(video) {
  const moduleBuilder = getModuleSlideBuilder('pool-video');
  return moduleBuilder ? moduleBuilder(video) : buildVideoSlide(video);
}

function _wait(ms, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export const layout = {
  name:      'video-fullscreen',
  minPhotos: 0,
  needsVideo: true,

  // 'skip' | 'now' — never a random candidate.
  schedule(cfg) {
    if (_pendingRun) return 'now';
    const every = Number(cfg?.videoEveryCycles) || 0;
    if (every <= 0) return 'skip';
    return _cyclesSinceVideo >= every ? 'now' : 'skip';
  },

  pick(cfg, helpers) {
    const run = _pendingRun;
    const forcedId = _pendingVideoId;
    _pendingRun = null;
    _pendingVideoId = null;

    if (forcedId) {
      const forced = getVideoPool().find(v => v.id === forcedId);
      if (forced) return { videos: [forced] };
    }

    const batch = Math.max(1, Number(cfg?.videoBatchSize) || 1);
    const want = run === 'all' ? Infinity : typeof run === 'number' ? run : batch;

    const videos = [];
    let lastId = null;
    while (videos.length < want) {
      const v = helpers.pickVideo(lastId);
      if (!v || videos.some(x => x.id === v.id)) break; // pool exhausted
      videos.push(v);
      lastId = v.id;
    }
    return { videos };
  },

  build(picked) {
    const root = el('div', { cls: 'layout layout-video-fullscreen' });
    const videos = picked.videos || [];
    if (!videos.length) {
      return { el: root, visibleIds: [], startMotion: () => {}, onDidShow: null };
    }

    const pages = [];

    return {
      el: root,
      visibleIds: [],
      startMotion: () => {},

      async onDidShow({ signal } = {}) {
        let current = null;
        for (const video of videos) {
          if (signal?.aborted) return;
          const page = await _buildSlide(video);
          if (signal?.aborted) { page.destroy?.(); return; }
          pages.push(page);
          page.el.classList.add('video-page');

          if (current) {
            page.el.classList.add('video-page-enter');
            root.appendChild(page.el);
            void page.el.offsetHeight; // reflow so the transition animates
            page.el.classList.remove('video-page-enter');
            current.el.classList.add('video-page-exit');
            await _wait(SCROLL_MS, signal);
            current.el.remove();
            current.destroy?.();
          } else {
            root.appendChild(page.el);
          }

          current = page;
          // Report the playing video as "visible" so module engagement
          // logic keyed on visibleIds treats it like a photo.
          displayState.visibleIds = [video.id];
          await page.play(signal);
        }
      },

      destroy() {
        pages.forEach(p => p?.destroy?.()); // double destroy is safe
      },
    };
  },
};
