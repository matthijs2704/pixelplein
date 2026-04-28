'use strict';

const express = require('express');
const os      = require('os');

const { broadcast, broadcastToScreens, broadcastToScreenAgent, _getWss } = require('../ws/broadcast');
const {
  requestPairing,
  getPairingStatus,
  listScreenDevices,
  approveScreenDevice,
  revokeScreenDevice,
  updateScreenDevice,
} = require('./devices');

const publicRouter = express.Router();
const adminRouter  = express.Router();
const DEVICE_COMMANDS = new Set(['restart_kiosk', 'reboot', 'shutdown']);

function _liveDeviceInfo() {
  const live = new Map();
  const wss = _getWss?.();
  if (!wss) return live;

  for (const ws of wss.clients) {
    if (ws.readyState !== 1 || !ws.deviceId) continue;
    const info = live.get(ws.deviceId) || {
      displayConnected: false,
      agentConnected:   false,
      agentCapabilities: [],
      displayLastSeenAt: 0,
      agentLastSeenAt:  0,
    };

    if (ws.clientType === 'screen') {
      info.displayConnected = true;
      info.displayLastSeenAt = Date.now();
    }
    if (ws.clientType === 'agent') {
      info.agentConnected = true;
      info.agentCapabilities = Array.isArray(ws.agentCapabilities) ? ws.agentCapabilities : [];
      info.agentLastSeenAt = ws.agentLastSeenAt || Date.now();
    }

    live.set(ws.deviceId, info);
  }

  return live;
}

// ---------------------------------------------------------------------------
// GET /api/screens/info — public, no auth
// Returns server LAN IPs so the settings overlay can display connection info.
// ---------------------------------------------------------------------------
publicRouter.get('/info', (req, res) => {
  const lanIps = Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
  const port = Number(process.env.PORT) || 3000;
  res.json({ lanIps, port, origin: `${req.protocol}://${req.get('host')}` });
});

publicRouter.post('/pair/request', async (req, res) => {
  try {
    const result = await requestPairing({
      deviceId:  req.body?.deviceId,
      screenId:  req.body?.screenId,
      label:     req.body?.label,
      userAgent: req.get('user-agent') || '',
      ip:        req.ip,
    });
    broadcast({ type: 'screen_pairing_update' });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

publicRouter.post('/pair/status', async (req, res) => {
  try {
    const result = await getPairingStatus({
      deviceId:      req.body?.deviceId,
      pairingSecret: req.body?.pairingSecret,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

adminRouter.get('/devices', async (_req, res) => {
  try {
    const result = await listScreenDevices();
    const live = _liveDeviceInfo();
    result.devices = result.devices.map(device => ({
      ...device,
      ...(live.get(device.deviceId) || {
        displayConnected: false,
        agentConnected:   false,
        agentCapabilities: [],
        displayLastSeenAt: 0,
        agentLastSeenAt:  0,
      }),
    }));
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

adminRouter.post('/devices/:deviceId/approve', async (req, res) => {
  try {
    const device = await approveScreenDevice(req.params.deviceId, req.body || {});
    broadcast({ type: 'screen_pairing_update' });
    return res.json({ ok: true, device });
  } catch (err) {
    return res.status(404).json({ ok: false, error: err.message });
  }
});

adminRouter.delete('/devices/:deviceId', async (req, res) => {
  try {
    const device = await revokeScreenDevice(req.params.deviceId);
    broadcast({ type: 'screen_pairing_update' });
    broadcastToScreens({ type: 'screen_revoked', deviceId: req.params.deviceId });
    return res.json({ ok: true, device });
  } catch (err) {
    return res.status(404).json({ ok: false, error: err.message });
  }
});

adminRouter.patch('/devices/:deviceId', async (req, res) => {
  try {
    const device = await updateScreenDevice(req.params.deviceId, req.body || {});
    broadcast({ type: 'screen_pairing_update' });
    return res.json({ ok: true, device });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

adminRouter.post('/devices/:deviceId/command', (req, res) => {
  const command = String(req.body?.command || '');
  if (!DEVICE_COMMANDS.has(command)) {
    return res.status(400).json({ ok: false, error: 'Unsupported device command' });
  }

  const sent = broadcastToScreenAgent(req.params.deviceId, {
    type:      'agent_command',
    commandId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    command,
    issuedAt:  Date.now(),
  });

  if (!sent) return res.status(404).json({ ok: false, error: 'Screen device agent is not connected' });
  return res.json({ ok: true });
});

adminRouter.post('/reload', (_req, res) => {
  broadcastToScreens({ type: 'reload', delayMs: 1500 });
  return res.json({ ok: true });
});

module.exports = { publicRouter, adminRouter };
