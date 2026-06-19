// Hype module — screen entry point. Dynamically imported by
// /screen/modules-loader.js when 'hype' is in window.PIXELPLEIN_MODULES.
//
// Registers: 3 slide builders, 3 layouts, 1 overlay, 4 alert renderers,
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

import { buildFollowersSlide } from './slides/followers.js';
import { buildFeedSlide      } from './slides/feed.js';
import { buildTrendingSlide  } from './slides/trending.js';

import { layout as postGridLayout      } from './layouts/post-grid.js';
import { layout as storyLayout         } from './layouts/story.js';
import { layout as reelsVerticalLayout } from './layouts/reels-vertical.js';

import { overlay as chromeOverlay } from './overlay-chrome.js';
import { takeover as socialOnlyTakeover } from './social-dashboard.js';

import { renderGlitchAlert  } from './alerts/glitch.js';
import { renderHackerAlert  } from './alerts/hacker.js';
import { renderOfflineAlert } from './alerts/offline.js';
import { renderRestartAlert } from './alerts/restart.js';
import { renderLaunchAlert  } from './alerts/launch.js';
import { renderPreLaunchAlert } from './alerts/prelaunch.js';

import { hydrate, handleWsMessage } from './state-client.js';
import { ensureAudioUnlock } from './audio-unlock.js';

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

  // Slide builders
  registerSlideBuilder('hype-followers', buildFollowersSlide);
  registerSlideBuilder('hype-feed',      buildFeedSlide);
  registerSlideBuilder('hype-trending',  buildTrendingSlide);

  // Layouts (auto-included when module is enabled)
  registerLayout(postGridLayout);
  registerLayout(storyLayout);
  registerLayout(reelsVerticalLayout);

  // Chrome overlay
  registerOverlay(chromeOverlay);
  registerScreenTakeover(socialOnlyTakeover);

  // Alert renderers
  registerAlertRenderer('hype-launch',  renderLaunchAlert);
  registerAlertRenderer('hype-glitch',  renderGlitchAlert);
  registerAlertRenderer('hype-hacker',  renderHackerAlert);
  registerAlertRenderer('hype-offline', renderOfflineAlert);
  registerAlertRenderer('hype-restart', renderRestartAlert);
  registerAlertRenderer('hype-prelaunch', renderPreLaunchAlert);

  // WS namespace router: anything with type "hype:*" lands here.
  registerWsHandler('hype', handleWsMessage);

  // Hydrate initial state (channels, follower counts, etc.) so slides + chrome
  // have data even before the first WS update.
  await hydrate();

  console.log('[hype] screen module registered');
}
