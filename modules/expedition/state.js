'use strict';

// In-memory state — ephemeral, intentionally. For a 2-hour booth event a
// DB round-trip adds nothing; if the server restarts it resets to stop 0.

let _level  = 0;   // active journey stop (0-3)
let _manual = true; // true = presenter controls; false = auto-cycle

module.exports = {
  getState:  () => ({ level: _level, manual: _manual }),
  setLevel:  (n) => { _level  = Math.max(0, Math.min(3, n | 0)); },
  setManual: (v) => { _manual = Boolean(v); },
};
