'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const { getConfig, getPublicConfig, saveConfig } = require('../../config');
const { broadcast } = require('../ws/broadcast');

const router = express.Router();

// ---------------------------------------------------------------------------
// Middleware: require PIN when one is configured.
// Attach as middleware before any protected API router.
// Requests from display screens (WebSocket upgrade, /screen.html, static
// assets, /api/auth/status) are intentionally left open.
// ---------------------------------------------------------------------------
async function requirePin(req, res, next) {
  const cfg = getConfig();
  if (!cfg.adminPinHash) return next(); // no PIN set → open

  const pin = String(req.headers['x-admin-pin'] || req.body?.adminPin || '').trim();
  if (!pin) return res.status(401).json({ ok: false, error: 'PIN required' });

  const ok = await bcrypt.compare(pin, cfg.adminPinHash);
  if (!ok) return res.status(401).json({ ok: false, error: 'Invalid PIN' });

  next();
}

router.get('/status', (_req, res) => {
  const cfg = getConfig();
  res.json({ pinSet: Boolean(cfg.adminPinHash) });
});

router.post('/pin', async (req, res) => {
  const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : null;
  if (pin == null) return res.status(400).json({ error: 'pin is required' });

  if (pin === '') {
    const cfg = getConfig();
    cfg.adminPinHash = null;
    saveConfig();
    broadcast({ type: 'config_update', config: getPublicConfig() });
    return res.json({ ok: true, pinSet: false });
  }

  if (!/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4-8 digits' });
  }

  const cfg = getConfig();
  cfg.adminPinHash = await bcrypt.hash(pin, 10);
  saveConfig();
  broadcast({ type: 'config_update', config: getPublicConfig() });
  return res.json({ ok: true, pinSet: true });
});

module.exports = router;
module.exports.requirePin = requirePin;
