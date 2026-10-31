'use strict';

// Default channels seeded on first migrate. Cubs camp "De Hype" needs channels
// with distinct personalities/visuals so kids recognize them.
const DEFAULT_CHANNELS = [
  // Everyone starts at 0 followers; spotlight days: za=1 … vr=7 (see draaiboek).
  { id: 'chnl_manager', name: 'Mark Suikerberg',      handle: '@markmywords2',      color: '#f5d904', avatar_url: '', follower_base: 0, featured_days: [1, 7],    race_participant: false },
  { id: 'chnl_natuur',  name: 'Wild van Fred',        handle: '@wildvanfred',       color: '#32d74b', avatar_url: '', follower_base: 0, featured_days: [1, 3],    race_participant: true },
  { id: 'chnl_kook',    name: 'The Real Gordon Bleu', handle: '@TheRealGordonBleu', color: '#ff8a00', avatar_url: '', follower_base: 0, featured_days: [1, 2, 3], race_participant: true },
  { id: 'chnl_game',    name: 'Mein en Kraft',        handle: '@meinenkraft',       color: '#7c4dff', avatar_url: '', follower_base: 0, featured_days: [1, 4],    race_participant: true },
  { id: 'chnl_beauty',  name: 'Mascara Mara',         handle: '@mascaramara',       color: '#ff4db8', avatar_url: '', follower_base: 0, featured_days: [1, 2],    race_participant: true },
  { id: 'chnl_fit',     name: 'Powermaatjes',         handle: '@depowermaatjes',    color: '#27d6c6', avatar_url: '', follower_base: 0, featured_days: [1, 5],    race_participant: true },
];

// Per-channel comment pool: weighted snippets the engine injects on photos.
// Toon afgestemd op het kanaal — vooral kort, herkenbaar voor welpen (7-11).
const DEFAULT_COMMENT_POOLS = {
  chnl_manager: [
    { text: 'welkom op De Hype iedereen!! 🎉', weight: 5 },
    { text: 'wat een dag op het platform', weight: 4 },
    { text: 'de servers draaien op volle toeren', weight: 4 },
    { text: 'deze foto is trending 📈', weight: 4 },
    { text: 'mooi bezig allemaal, blijf posten', weight: 3 },
    { text: 'dit is waarom we De Hype gebouwd hebben', weight: 3 },
    { text: 'record aantal likes vandaag!', weight: 3 },
    { text: 'gecheckt en goedgekeurd ✅', weight: 3 },
    { text: 'de volgersrace wordt spannend…', weight: 2 },
    { text: 'ik zie jullie wel hè 👀', weight: 2 },
  ],
  chnl_natuur: [
    { text: 'WAUW wat een beestje', weight: 5 },
    { text: 'Fred pak m niet vast!!', weight: 5 },
    { text: 'is dit echt??', weight: 4 },
    { text: 'die heb ik ook een keer gezien!!', weight: 4 },
    { text: 'zo cool 🐛', weight: 4 },
    { text: 'wat eet dat beest eigenlijk?', weight: 3 },
    { text: 'ik durf dat echt nooit', weight: 3 },
    { text: 'Fred is de nieuwe Freek', weight: 3 },
    { text: 'mijn hond zou hier gek van worden', weight: 2 },
    { text: 'bijt ie??', weight: 3 },
    { text: 'volgend filmpje een slang pls', weight: 2 },
    { text: 'natuur is echt het beste kanaal', weight: 2 },
  ],
  chnl_kook: [
    { text: 'recept pls 🙏', weight: 5 },
    { text: 'ik heb nu ZO veel honger', weight: 5 },
    { text: 'HET IS RAUW!!', weight: 4 },
    { text: 'Gordon zou trots zijn', weight: 4 },
    { text: 'dit ziet er beter uit dan thuis', weight: 4 },
    { text: 'wat zit hierin??', weight: 3 },
    { text: 'mag ik proeven pls', weight: 3 },
    { text: 'chef!! 👨‍🍳', weight: 3 },
    { text: 'ik ruik het bijna door het scherm', weight: 3 },
    { text: 'maak dit morgen weer', weight: 2 },
    { text: 'beter dan het eetcafé bij ons in de straat', weight: 2 },
    { text: 'mijn moeder wil dit recept', weight: 2 },
  ],
  chnl_game: [
    { text: 'GG', weight: 5 },
    { text: 'no way dat dit lukt', weight: 5 },
    { text: 'Mein en Kraft is cracked 🎮', weight: 4 },
    { text: 'CLUTCH', weight: 4 },
    { text: 'ik was er live bij!!', weight: 4 },
    { text: 'dat is toch niet eerlijk haha', weight: 3 },
    { text: 'speedrun wanneer??', weight: 3 },
    { text: 'welke seed is dit??', weight: 3 },
    { text: 'mijn controller zou al kapot zijn', weight: 3 },
    { text: 'rematch!! ik wil revanche', weight: 2 },
    { text: 'die build ga ik thuis namaken', weight: 2 },
    { text: 'beste duo van De Hype', weight: 2 },
  ],
  chnl_beauty: [
    { text: 'GLOW ✨', weight: 5 },
    { text: 'tutorial pls!!', weight: 5 },
    { text: 'Mara is een queen 👑', weight: 4 },
    { text: 'iconisch', weight: 4 },
    { text: 'welke kleur is dit??', weight: 4 },
    { text: 'oké dit is echt kunst', weight: 3 },
    { text: 'ik heb dit geprobeerd… het werd niks 😅', weight: 3 },
    { text: 'slay', weight: 3 },
    { text: 'mag je dit ook bij mij doen?', weight: 3 },
    { text: 'de belichting is perfect', weight: 2 },
    { text: 'mijn zus wil dit ook', weight: 2 },
    { text: 'beste kanaal van De Hype, punt', weight: 2 },
  ],
  chnl_fit: [
    { text: 'BEAST MODE 💪', weight: 5 },
    { text: 'hoeveel sets??', weight: 4 },
    { text: 'Powermaatjes goals', weight: 4 },
    { text: 'ik probeer dit morgen!', weight: 4 },
    { text: 'sterk man', weight: 4 },
    { text: 'na 3 keer lag ik al plat 😂', weight: 3 },
    { text: 'doe je wel een warming-up?', weight: 3 },
    { text: 'spierpijn alleen al van het kijken', weight: 3 },
    { text: 'dit team is niet te stoppen', weight: 3 },
    { text: 'wie van de twee is sterker eigenlijk?', weight: 2 },
    { text: 'morgen samen trainen?', weight: 2 },
    { text: 'proteïne check 🥛', weight: 2 },
  ],
};

// Engine tuning. Tweak via /api/modules/hype/config later if needed.
const DEFAULT_ENGINE = {
  tickMs: 4000,
  activityTickMs: 7000,
  baseLikesPerTick: 1.5,       // visible-photo baseline
  generalLikesPerTick: 1.5,    // Scouting Ridder Fulco posts juice equally hard
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
  launchedAt: null,
  // Thursday-night finale progress: null | armed | reveal | offline | trace.
  // Drives the admin draaiboek-stepper and silences auto-glitches once armed.
  nachtspelStage: null,
  // Where Mark's trace ends up (set from admin, persisted so the operator
  // can prepare it in the afternoon).
  traceTarget: { location: '', lat: null, lon: null },
  // What the physical button (M5 Atom) fires on its next press. One-shot:
  // the trigger endpoint clears it after firing, admin re-arms per moment.
  physicalTrigger: null,
  generalAccount: {
    name: 'Kamp Live',
    handle: '@kamplive',
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
    chatUrl: 'http://127.0.0.1:8787',   // fake-chat sidecar (los proces)
    screenId: '',   // empty = every screen takes over; else only this one
  },
};

module.exports = {
  DEFAULT_CHANNELS,
  DEFAULT_COMMENT_POOLS,
  DEFAULT_ENGINE,
  DEFAULT_SETTINGS,
};
