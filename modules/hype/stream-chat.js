'use strict';

// Bridge naar de fake-chat sidecar (los Python-proces, aparte repo).
// Eén SSE-verbinding hier; berichten worden via de bestaande WS-broadcast
// uitgefand naar alle schermen. De sidecar genereert alleen tokens zolang
// er een consument hangt, dus: stream.enabled uit → disconnect → 0 kosten.
// Sidecar starten/stoppen gebeurt bewust NIET hier maar via het regiepaneel.

const state = require('./state');

const NS = 'hype';
const POLL_MS = 5000;

let _ctx = null;
let _abort = null;      // AbortController van de lopende verbinding
let _pollTimer = null;
let _connected = false;
let _connectedUrl = ''; // base-URL van de lopende verbinding
let _msgSeq = 0;
let _viewerOffset = 0;

function _sidecarBase() {
  const settings = state.getSettings();
  const url = (settings.stream && settings.stream.chatUrl) || 'http://127.0.0.1:8787';
  return url.replace(/\/$/, '');
}

function isFeeding() {
  return _connected;
}

async function sidecarRequest(method, path, body) {
  const upperMethod = String(method || 'GET').toUpperCase();
  const canHaveBody = upperMethod !== 'GET' && upperMethod !== 'HEAD';
  const hasBody = canHaveBody && body && Object.keys(body).length > 0;
  const opts = { method: upperMethod };
  if (hasBody) {
    opts.headers = { 'content-type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${_sidecarBase()}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function start(ctx) {
  _ctx = ctx;
  stop();
  _pollTimer = setInterval(_ensureConnection, POLL_MS);
}

function stop() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  _disconnect();
}

function _disconnect() {
  if (_abort) { _abort.abort(); _abort = null; }
  _connected = false;
}

function _ensureConnection() {
  const enabled = Boolean(state.getSettings().stream?.enabled);
  // Gewijzigde sidecar-URL → oude verbinding sluiten, volgende poll verbindt opnieuw.
  if (_abort && _connectedUrl && _connectedUrl !== _sidecarBase()) _disconnect();
  if (enabled && !_abort) _connect();
  else if (!enabled && _abort) _disconnect();
}

async function _connect() {
  const abort = new AbortController();
  _abort = abort;
  _connectedUrl = _sidecarBase();
  try {
    const res = await fetch(`${_connectedUrl}/events`, {
      signal: abort.signal,
      headers: { accept: 'text/event-stream' },
    });
    if (!res.ok || !res.body) throw new Error(`sidecar ${res.status}`);
    _connected = true;
    console.log('[hype] stream-chat sidecar verbonden');

    let buf = '';
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try { _handle(JSON.parse(line.slice(6))); } catch { /* kapotte frame, skip */ }
        }
      }
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      console.warn('[hype] stream-chat sidecar:', err.message);
    }
  } finally {
    if (_abort === abort) { _abort = null; _connected = false; }
  }
}

function _handle(msg) {
  if (!msg || !msg.type || !_ctx) return;

  if (msg.type === 'chat' || msg.type === 'join') {
    const item = { id: `sc_${Date.now()}_${_msgSeq++}`, ts: Date.now(), ...msg };
    state.addStreamChat(item);
    _ctx.broadcast({ type: `${NS}:stream_chat`, item });
    // Moderatie-theater: na deleteAfterMs wordt het bericht op alle schermen
    // (en in de ring buffer, voor laat-verbindende schermen) "verwijderd".
    if (item.deleteAfterMs > 0) {
      setTimeout(() => {
        const updated = state.markStreamChatDeleted(item.id);
        if (updated && _ctx) _ctx.broadcast({ type: `${NS}:stream_chat_update`, item: updated });
      }, item.deleteAfterMs);
    }
    return;
  }

  if (msg.type === 'meta' && msg.running) {
    const baseViewers = Math.max(0, Number(msg.viewers) | 0);
    const maxOffset = Math.max(4, Math.min(18, Math.round(baseViewers * 0.035)));
    let drift = Math.floor(Math.random() * 7) - 3;
    if (drift === 0) drift = Math.random() < 0.5 ? -1 : 1;
    _viewerOffset = Math.max(-maxOffset, Math.min(maxOffset, _viewerOffset + drift));
    const viewers = Math.max(0, baseViewers + _viewerOffset);
    const stats = {
      viewers,
      online: viewers,
      title: msg.title,
      subtitle: msg.subtitle,
      source: 'sidecar',
      updatedAt: Date.now(),
    };
    state.setStreamStats(stats);
    _ctx.broadcast({ type: `${NS}:stream_stats`, stats });
  }
}

module.exports = { start, stop, isFeeding, sidecarRequest };
