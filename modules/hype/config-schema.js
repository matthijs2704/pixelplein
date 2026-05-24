'use strict';

// Default channels seeded on first migrate. Cubs camp "De Hype" needs 4
// channels with distinct personalities/visuals so kids recognize them.
const DEFAULT_CHANNELS = [
  { id: 'chnl_wild',   name: 'Wild Welpen',     handle: '@wildwelpen',   color: '#ff5b8a', emoji: '🐺', follower_base: 12400, growth_rate: 1.2 },
  { id: 'chnl_chef',   name: 'Kampkok',         handle: '@kampkok',      color: '#ffb347', emoji: '🍳', follower_base:  8700, growth_rate: 0.8 },
  { id: 'chnl_avon',   name: 'Avonturiers',     handle: '@avonturiers',  color: '#4ec9b0', emoji: '🏕️', follower_base: 15200, growth_rate: 1.5 },
  { id: 'chnl_stunt',  name: 'Stuntsquad',      handle: '@stuntsquad',   color: '#7c5cff', emoji: '🎯', follower_base:  6100, growth_rate: 1.0 },
];

// Per-channel comment pool: weighted snippets the engine injects on photos.
const DEFAULT_COMMENT_POOLS = {
  chnl_wild: [
    { text: 'WAUW 🔥🔥🔥', weight: 5 },
    { text: 'echt vet man', weight: 4 },
    { text: 'wie is dit?? 😍', weight: 3 },
    { text: 'goals 💯', weight: 4 },
    { text: 'omg dit moet viraal', weight: 2 },
  ],
  chnl_chef: [
    { text: 'recept pls 🙏', weight: 5 },
    { text: 'ik kwijl nu', weight: 4 },
    { text: 'wat zit hierin??', weight: 3 },
    { text: 'mijn moeder zou trots zijn', weight: 2 },
  ],
  chnl_avon: [
    { text: 'iconisch', weight: 5 },
    { text: 'breng me hierheen 😤', weight: 4 },
    { text: 'dit is ART', weight: 3 },
    { text: 'oef die vibes', weight: 4 },
  ],
  chnl_stunt: [
    { text: 'HOE DAN', weight: 5 },
    { text: 'niet proberen thuis kids', weight: 3 },
    { text: 'send location', weight: 4 },
    { text: 'absolute legend', weight: 3 },
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
