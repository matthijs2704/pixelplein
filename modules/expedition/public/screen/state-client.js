// Expedition screen state — fetches current stop from server on load,
// then stays in sync via WS `expedition:state` messages.

let _level  = 0;
let _manual = true;

export function getLevel()   { return _level; }
export function isManual()   { return _manual; }

function _apply(data) {
  if (data && typeof data.level  === 'number') _level  = data.level;
  if (data && typeof data.manual === 'boolean') _manual = data.manual;
}

export async function hydrate() {
  try {
    const res = await fetch('/api/modules/expedition/snapshot', { credentials: 'include' });
    if (res.ok) _apply(await res.json());
  } catch { /* server not running expedition module — stay at defaults */ }
}

export function handleWsMessage(msg) {
  if (msg.type === 'expedition:state') _apply(msg);
}
