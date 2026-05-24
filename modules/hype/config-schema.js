'use strict';

// Default channels seeded on first migrate. Cubs camp "De Hype" needs 4
// channels with distinct personalities/visuals so kids recognize them.
const DEFAULT_CHANNELS = [
  { id: 'chnl_natuur', name: 'Dusty in het Wild', handle: '@dustywild',     color: '#3fa66b', emoji: '🦎', follower_base: 24800, growth_rate: 1.4 },
  { id: 'chnl_kook',   name: 'Jochem Kookt',      handle: '@jochemkookt',   color: '#ff8a3d', emoji: '🍳', follower_base: 18200, growth_rate: 1.1 },
  { id: 'chnl_game',   name: 'CJ Plays',          handle: '@cjplays',       color: '#7c5cff', emoji: '🎮', follower_base: 31500, growth_rate: 1.7 },
  { id: 'chnl_beauty', name: 'Roos Beauty',       handle: '@roosbeauty',    color: '#ff5b8a', emoji: '💄', follower_base: 27300, growth_rate: 1.5 },
  { id: 'chnl_fit',    name: 'FitDuo F&S',        handle: '@fitduofs',      color: '#4ec9b0', emoji: '💪', follower_base: 14600, growth_rate: 1.3 },
];

// Per-channel comment pool: weighted snippets the engine injects on photos.
// Toon afgestemd op het kanaal — vooral kort, herkenbaar voor welpen (7-11).
const DEFAULT_COMMENT_POOLS = {
  chnl_natuur: [
    { text: 'WAUW wat een beestje 🦎', weight: 5 },
    { text: 'is dit echt??', weight: 3 },
    { text: 'Dusty doet het weer 🙌', weight: 4 },
    { text: 'pak m vast!! 😱', weight: 3 },
    { text: 'wist je dit ook al?', weight: 2 },
  ],
  chnl_kook: [
    { text: 'recept pls 🙏', weight: 5 },
    { text: 'ik kwijl nu', weight: 4 },
    { text: 'Jochem chef!! 👨‍🍳', weight: 4 },
    { text: 'wat zit hierin??', weight: 3 },
    { text: 'mijn moeder zou trots zijn', weight: 2 },
  ],
  chnl_game: [
    { text: 'GG 🎮', weight: 5 },
    { text: 'no way dat lukt', weight: 4 },
    { text: 'cracked', weight: 3 },
    { text: 'CJ voor altijd', weight: 4 },
    { text: 'speedrun wanneer??', weight: 2 },
  ],
  chnl_beauty: [
    { text: 'GLOW 💖', weight: 5 },
    { text: 'tutorial!!', weight: 4 },
    { text: 'Roos is een queen 👑', weight: 4 },
    { text: 'iconisch 😍', weight: 3 },
    { text: 'welk merk is dit?', weight: 2 },
  ],
  chnl_fit: [
    { text: 'beast mode 💪', weight: 5 },
    { text: 'F&S goals', weight: 4 },
    { text: 'hoeveel sets??', weight: 3 },
    { text: 'ik probeer dit morgen!', weight: 3 },
    { text: 'sterk man 🔥', weight: 4 },
  ],
};

// Engine tuning. Tweak via /api/modules/hype/config later if needed.
const DEFAULT_ENGINE = {
  tickMs: 4000,
  baseLikesPerTick: 1.5,       // visible-photo baseline
  viralMultiplier: 4.0,
  commentChancePerTick: 0.12,  // per visible photo
  viralCommentBoost: 2.5,
};

module.exports = {
  DEFAULT_CHANNELS,
  DEFAULT_COMMENT_POOLS,
  DEFAULT_ENGINE,
};
