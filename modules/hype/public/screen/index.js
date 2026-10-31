// Hype module — screen entry point. Dynamically imported by
// /screen/modules-loader.js when 'hype' is in window.PIXELPLEIN_MODULES.
//
// Registers: slide builders, 7 layouts, 1 overlay, alert renderers,
// and 1 WS namespace handler. Also hydrates the state cache from
// /api/modules/hype/snapshot on first load.

import {
  registerSlideBuilder,
  registerLayout,
  registerOverlay,
  registerAlertRenderer,
  registerWsHandler,
  registerScreenTakeover,
} from '/screen/module-registry.js';

import { buildReelSlide      } from './slides/reel.js';
import { buildFollowersSlide } from './slides/followers.js';
import { buildFeedSlide      } from './slides/feed.js';
import { buildTrendingSlide  } from './slides/trending.js';
import { buildViralSlide     } from './slides/viral.js';

import { layout as storyLayout         } from './layouts/story.js';
import { layout as reelsVerticalLayout } from './layouts/reels-vertical.js';
import { layout as postCardLayout      } from './layouts/post-card.js';
import { layout as polaroidLayout      } from './layouts/polaroid.js';
import { layout as storiesRowLayout    } from './layouts/stories-row.js';
import { layout as exploreGridLayout   } from './layouts/explore-grid.js';
import { layout as duoPostLayout       } from './layouts/duo-post.js';

import { overlay as chromeOverlay } from './overlay-chrome.js';
import { takeover as socialOnlyTakeover } from './social-dashboard.js';
import { streamTakeover } from './stream-takeover.js';

import { renderGlitchAlert  } from './alerts/glitch.js';
import { renderRevealAlert  } from './alerts/reveal.js';
import { renderTraceAlert   } from './alerts/trace.js';
import { renderOfflineAlert } from './alerts/offline.js';
import { renderRestartAlert } from './alerts/restart.js';
import { renderLaunchAlert  } from './alerts/launch.js';
import { renderPreLaunchAlert } from './alerts/prelaunch.js';

import { hydrate, startHydrateRefresh, handleWsMessage } from './state-client.js';
import { ensureAudioUnlock } from './audio-unlock.js';
import { initGameMirror } from './game-mirror.js';

function _loadStyle() {
  if (document.getElementById('hype-style')) return;
  const link = document.createElement('link');
  link.id = 'hype-style';
  link.rel = 'stylesheet';
  link.href = '/modules/hype/screen/style.css';
  document.head.appendChild(link);
}

export async function register() {
  _loadStyle();
  ensureAudioUnlock();

  // Slide builders — video is overridden to add hype chrome (reel layout)
  registerSlideBuilder('video',          buildReelSlide);
  registerSlideBuilder('pool-video',     buildReelSlide);
  registerSlideBuilder('hype-followers', buildFollowersSlide);
  registerSlideBuilder('hype-feed',      buildFeedSlide);
  registerSlideBuilder('hype-trending',  buildTrendingSlide);
  registerSlideBuilder('hype-viral',     buildViralSlide);

  // Layouts (auto-included when module is enabled)
  registerLayout(postCardLayout);
  registerLayout(storyLayout);
  registerLayout(reelsVerticalLayout);
  registerLayout(polaroidLayout);
  registerLayout(storiesRowLayout);
  registerLayout(exploreGridLayout);
  registerLayout(duoPostLayout);

  // Chrome overlay
  registerOverlay(chromeOverlay);
  registerScreenTakeover(streamTakeover);     // checked first — stream wins over dashboard
  registerScreenTakeover(socialOnlyTakeover);

  // Alert renderers
  registerAlertRenderer('hype-launch',  renderLaunchAlert);
  registerAlertRenderer('hype-glitch',  renderGlitchAlert);
  registerAlertRenderer('hype-reveal',  renderRevealAlert);
  registerAlertRenderer('hype-trace',   renderTraceAlert);
  registerAlertRenderer('hype-offline', renderOfflineAlert);
  registerAlertRenderer('hype-restart', renderRestartAlert);
  registerAlertRenderer('hype-prelaunch', renderPreLaunchAlert);

  // WS namespace router: anything with type "hype:*" lands here.
  registerWsHandler('hype', handleWsMessage);

  // Hydrate initial state (channels, follower counts, etc.) so slides + chrome
  // have data even before the first WS update. The refresh loop retries fast
  // until the server answers (screen may boot before the server) and then
  // keeps the cache fresh across server restarts.
  await hydrate();
  startHydrateRefresh();

  initGameMirror(); // live spectator mirror of the reboot-ritual minigames

  console.log('[hype] screen module registered');
}
