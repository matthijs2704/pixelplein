'use strict';

// wss is set by ws/index.js after the server is created to avoid circular deps
let _wss = null;

function setWss(wss) {
  _wss = wss;
}

/** Send a payload to every connected WebSocket client */
function broadcast(payload) {
  if (!_wss) return;
  const msg = JSON.stringify(payload);
  _wss.clients.forEach(ws => {
    if (ws.readyState === 1 && ws.authenticated) ws.send(msg);
  });
}

/** Send a payload only to clients that have identified themselves as screens */
function broadcastToScreens(payload) {
  if (!_wss) return;
  const msg = JSON.stringify(payload);
  _wss.clients.forEach(ws => {
    if (ws.readyState === 1 && ws.clientType === 'screen' && ws.screenId) ws.send(msg);
  });
}

/** Send a payload to a specific paired screen device */
function broadcastToScreenAgent(deviceId, payload) {
  if (!_wss) return false;
  const msg = JSON.stringify(payload);
  let sent = false;
  _wss.clients.forEach(ws => {
    if (ws.readyState === 1 && ws.clientType === 'agent' && ws.deviceId === deviceId) {
      ws.send(msg);
      sent = true;
    }
  });
  return sent;
}

function _getWss() { return _wss; }

module.exports = { setWss, broadcast, broadcastToScreens, broadcastToScreenAgent, _getWss };
