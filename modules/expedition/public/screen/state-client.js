// Expedition screen state — fetches current stop from server on load,
// then stays in sync via WS `expedition:state` messages.

let _level  = 0;
let _manual = true;
let _levelChangedAt = 0;

export function getLevel()   { return _level; }
export function isManual()   { return _manual; }
export function getLevelChangedAt() { return _levelChangedAt; }

function _apply(data, options = {}) {
  if (data && typeof data.level === 'number') {
    const nextLevel = data.level;
    if (!options.initial && nextLevel !== _level) _levelChangedAt = Date.now();
    _level = nextLevel;
  }
  if (data && typeof data.manual === 'boolean') _manual = data.manual;
}

export async function hydrate() {
  try {
    const res = await fetch('/api/modules/expedition/snapshot', { credentials: 'include' });
    if (res.ok) _apply(await res.json(), { initial: true });
  } catch { /* server not running expedition module — stay at defaults */ }
}

export function handleWsMessage(msg) {
  if (msg.type === 'expedition:state') _apply(msg);
}
