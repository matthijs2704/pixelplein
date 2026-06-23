'use strict';

// Default channels seeded on first migrate. Cubs camp "De Hype" needs channels
// with distinct personalities/visuals so kids recognize them.
const DEFAULT_CHANNELS = [
  { id: 'chnl_manager', name: 'De Hype Manager',   handle: '@dehypemanager', color: '#f5d904', avatar_url: '', follower_base: 0,     featured_days: [], race_participant: false },
  { id: 'chnl_natuur',  name: 'Dusty in het Wild', handle: '@dustywild',     color: '#32d74b', avatar_url: '', follower_base: 24800, featured_days: [], race_participant: true },
  { id: 'chnl_kook',    name: 'Jochem Kookt',      handle: '@jochemkookt',    color: '#ff8a00', avatar_url: '', follower_base: 18200, featured_days: [], race_participant: true },
  { id: 'chnl_game',    name: 'CJ Plays',          handle: '@cjplays',        color: '#7c4dff', avatar_url: '', follower_base: 31500, featured_days: [], race_participant: true },
  { id: 'chnl_beauty',  name: 'Roos Beauty',       handle: '@roosbeauty',     color: '#ff4db8', avatar_url: '', follower_base: 27300, featured_days: [], race_participant: true },
  { id: 'chnl_fit',     name: 'FitDuo F&S',        handle: '@fitduofs',       color: '#27d6c6', avatar_url: '', follower_base: 14600, featured_days: [], race_participant: true },
];

// Per-channel comment pool: weighted snippets the engine injects on photos.
// Toon afgestemd op het kanaal — vooral kort, herkenbaar voor welpen (7-11).
const DEFAULT_COMMENT_POOLS = {
  chnl_manager: [
    { text: 'De Hype is officieel open', weight: 5 },
    { text: 'Manager checkt de livefeed', weight: 4 },
    { text: 'Nieuwe kampupdate staat klaar', weight: 4 },
    { text: 'Alles loopt via De Hype', weight: 3 },
  ],
  chnl_natuur: [
    { text: 'WAUW wat een beestje', weight: 5 },
    { text: 'is dit echt??', weight: 3 },
    { text: 'Dusty doet het weer', weight: 4 },
    { text: 'pak m vast!!', weight: 3 },
    { text: 'wist je dit ook al?', weight: 2 },
  ],
  chnl_kook: [
    { text: 'recept pls', weight: 5 },
    { text: 'ik kwijl nu', weight: 4 },
    { text: 'Jochem chef!!', weight: 4 },
    { text: 'wat zit hierin??', weight: 3 },
    { text: 'mijn moeder zou trots zijn', weight: 2 },
  ],
  chnl_game: [
    { text: 'GG', weight: 5 },
    { text: 'no way dat lukt', weight: 4 },
    { text: 'cracked', weight: 3 },
    { text: 'CJ voor altijd', weight: 4 },
    { text: 'speedrun wanneer??', weight: 2 },
  ],
  chnl_beauty: [
    { text: 'GLOW', weight: 5 },
    { text: 'tutorial!!', weight: 4 },
    { text: 'Roos is een queen', weight: 4 },
    { text: 'iconisch', weight: 3 },
    { text: 'welk merk is dit?', weight: 2 },
  ],
  chnl_fit: [
    { text: 'beast mode', weight: 5 },
    { text: 'F&S goals', weight: 4 },
    { text: 'hoeveel sets??', weight: 3 },
    { text: 'ik probeer dit morgen!', weight: 3 },
    { text: 'sterk man', weight: 4 },
  ],
};

// Engine tuning. Tweak via /api/modules/hype/config later if needed.
const DEFAULT_ENGINE = {
  tickMs: 4000,
  activityTickMs: 7000,
  baseLikesPerTick: 1.5,       // visible-photo baseline
  generalLikesPerTick: 0.9,
  viralMultiplier: 4.0,
  commentChancePerTick: 0.12,  // per visible photo
  chatChancePerTick: 0.45,
  viralCommentBoost: 2.5,
};

const DEFAULT_SETTINGS = {
  // Operator-controlled. platformOff persists across server restart.
  mode: 'normal',
  harryHeat: 0,
  spotlightDay: 1,
  platformOff: false,
  // True for fresh installs — screens show a pre-launch idle teaser until
  // admin clicks Launch for the first time. Persists across restarts so
  // re-opening the server doesn't accidentally re-arm the teaser.
  preLaunch: true,
  launchActive: false,
  generalAccount: {
    name: 'Scouting Ridder Fulco',
    handle: '@scoutingridderfulco',
    color: '#00b2ff',
    avatarUrl: '',
  },
  feedMix: {
    generalWeight: 2,
    influencerWeight: 1,
  },
  contentProvider: 'template',
  activeVideo: null,
  stream: {
    enabled: false,
    sourceType: 'video',
    videoId: null,
    url: '',
    deviceId: '',
    title: 'Keuken Live',
    subtitle: 'live vanaf het kamp',
  },
};

module.exports = {
  DEFAULT_CHANNELS,
  DEFAULT_COMMENT_POOLS,
  DEFAULT_ENGINE,
  DEFAULT_SETTINGS,
};
