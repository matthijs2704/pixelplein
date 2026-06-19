'use strict';

// Template-backed content provider for ambient comments/chat. It deliberately
// has the same shape a future AI provider can implement.

const GENERAL_COMMENTS = [
  'kamp update net binnen',
  'dit is precies de vibe vandaag',
  'welpen takeover op De Hype',
  'wie heeft deze foto gemaakt?',
  'kamp live gaat hard vandaag',
  'dit verdient meer likes',
];

const CHAT_POOL = [
  'ik zie mezelf op het scherm!',
  'wie gaat er vandaag winnen?',
  'Kamp Live is echt overal bij',
  'meer keukenupdates pls',
  'deze challenge was niet normaal',
  'volgers gaan ineens snel',
  'dit platform slaapt nooit',
];

const HARRY_POOL = [
  'hoe heet je huisdier eigenlijk?',
  'ik weet echt alles van deze influencer',
  'wachtwoordhint gevonden...',
  'is dit toeval of niet?',
  'ik ben gewoon een grote fan hoor',
];

const PHASE_MESSAGES = {
  normal: [
    'Kamp Live is actief',
    'de influencer race loopt',
    'nieuwe reacties verschijnen',
    'collab update staat klaar',
    'nieuwe challenge-posts komen binnen',
    'de stream kan elk moment live gaan',
  ],
  tension: [
    'kleine storing gedetecteerd',
    'een onbekend account kijkt mee',
    'iemand typte iets en verwijderde het weer',
  ],
};

function _pick(items) {
  if (!items || !items.length) return '';
  return items[Math.floor(Math.random() * items.length)];
}

function _tone(ctx) {
  return ctx?.settings?.platformOff ? 'tension' : 'normal';
}

async function generateComment(ctx = {}) {
  const account = ctx.account || ctx.settings?.generalAccount;
  if (ctx.channel) {
    return {
      author: ctx.channel.handle || ctx.channel.name,
      text: `${_pick([
        'geholpen door de welpen',
        'challenge update staat live',
        'teamwork levert volgers op',
        'deze actie gaat rond',
      ])}`,
      source: 'template',
    };
  }
  return {
    author: account?.handle || '@kamp_live',
    text: _pick(GENERAL_COMMENTS),
    source: 'template',
  };
}

async function generateChatMessage(ctx = {}) {
  const count = Number(ctx.chatCount || 0);
  const tone = _tone(ctx);
  const harryChance = tone === 'tension' ? 0.08 : 0.015;
  const useHarry = count > 3 && Math.random() < harryChance;
  return {
    author: useHarry ? 'Harry Ecker' : _pick(['Kamp Live', 'WelpenChat', 'De Hype', 'Rikketiks']),
    text: useHarry ? _pick(HARRY_POOL) : _pick(CHAT_POOL),
    source: 'template',
    meta: { harry: useHarry },
  };
}

async function generatePlatformMessage(ctx = {}) {
  return {
    author: 'De Hype',
    text: _pick(PHASE_MESSAGES[_tone(ctx)] || PHASE_MESSAGES.normal),
    source: 'template',
  };
}

async function generateJuicePost(ctx = {}) {
  return {
    author: 'Juice Kanaal',
    text: _pick([
      'er gebeurt iets bij de influencers...',
      'kampgerucht: iemand weet meer over het wachtwoord',
      'de keukenstream heeft ineens veel kijkers',
      'de welpen maken vandaag het verschil',
    ]),
    source: 'template',
  };
}

module.exports = {
  generateComment,
  generateChatMessage,
  generatePlatformMessage,
  generateJuicePost,
};
