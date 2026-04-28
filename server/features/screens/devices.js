'use strict';

const crypto = require('crypto');

const { getSettingJson, setSettingJson } = require('../../db');

const STORE_KEY = 'screenDevices';
const PAIRING_TTL_MS = 10 * 60 * 1000;

function _now() {
  return Date.now();
}

function _hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function _id() {
  return crypto.randomBytes(16).toString('hex');
}

function _pairingCode() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

async function _loadStore() {
  const raw = await getSettingJson(STORE_KEY);
  const store = raw && typeof raw === 'object' ? raw : {};
  return {
    devices: Array.isArray(store.devices) ? store.devices : [],
    pending: Array.isArray(store.pending) ? store.pending : [],
  };
}

async function _saveStore(store) {
  const now = _now();
  store.pending = (store.pending || []).filter(p => p.expiresAt > now && !p.consumedAt);
  await setSettingJson(STORE_KEY, store);
}

function _publicDevice(device) {
  return {
    deviceId:   device.deviceId,
    screenId:   device.screenId,
    label:      device.label || '',
    approvedAt: device.approvedAt || 0,
    lastSeenAt: device.lastSeenAt || 0,
    revokedAt:  device.revokedAt || null,
  };
}

function _publicPending(pending) {
  return {
    deviceId:  pending.deviceId,
    screenId:  pending.screenId,
    label:     pending.label || '',
    code:      pending.code,
    createdAt: pending.createdAt,
    expiresAt: pending.expiresAt,
  };
}

function _cleanScreenId(value) {
  const id = String(value || '1').trim();
  return /^[1-4]$/.test(id) ? id : '1';
}

function _cleanDeviceId(value) {
  return String(value || '').trim().slice(0, 120);
}

function _cleanLabel(value) {
  return String(value || '').trim().slice(0, 120);
}

async function requestPairing({ deviceId, screenId, label, userAgent, ip }) {
  const cleanDeviceId = _cleanDeviceId(deviceId) || _id();
  const cleanScreenId = _cleanScreenId(screenId);
  const now = _now();
  const store = await _loadStore();

  const active = store.devices.find(d => d.deviceId === cleanDeviceId && !d.revokedAt);
  if (active) {
    active.lastSeenAt = now;
    await _saveStore(store);
    return {
      status: 'already_paired',
      deviceId: cleanDeviceId,
      screenId: active.screenId,
    };
  }

  store.pending = store.pending.filter(p => p.deviceId !== cleanDeviceId);

  const pairingSecret = _id();
  const pending = {
    deviceId: cleanDeviceId,
    screenId: cleanScreenId,
    label: _cleanLabel(label),
    userAgent: String(userAgent || '').slice(0, 300),
    ip: String(ip || '').slice(0, 120),
    code: _pairingCode(),
    pairingSecretHash: _hash(pairingSecret),
    createdAt: now,
    expiresAt: now + PAIRING_TTL_MS,
    approvedAt: null,
    oneTimeToken: null,
    consumedAt: null,
  };

  store.pending.push(pending);
  await _saveStore(store);

  return {
    status: 'pending',
    deviceId: cleanDeviceId,
    screenId: cleanScreenId,
    code: pending.code,
    pairingSecret,
    expiresAt: pending.expiresAt,
  };
}

async function getPairingStatus({ deviceId, pairingSecret }) {
  const cleanDeviceId = _cleanDeviceId(deviceId);
  const store = await _loadStore();
  const pending = store.pending.find(p =>
    p.deviceId === cleanDeviceId &&
    p.pairingSecretHash === _hash(pairingSecret) &&
    p.expiresAt > _now() &&
    !p.consumedAt
  );

  if (!pending) {
    await _saveStore(store);
    return { status: 'expired' };
  }

  if (!pending.oneTimeToken) {
    return {
      status: 'pending',
      code: pending.code,
      screenId: pending.screenId,
      expiresAt: pending.expiresAt,
    };
  }

  const token = pending.oneTimeToken;
  pending.consumedAt = _now();
  pending.oneTimeToken = null;
  await _saveStore(store);

  return {
    status: 'approved',
    deviceId: pending.deviceId,
    screenId: pending.screenId,
    token,
  };
}

async function listScreenDevices() {
  const store = await _loadStore();
  await _saveStore(store);
  return {
    devices: store.devices.map(_publicDevice),
    pending: store.pending
      .filter(p => !p.approvedAt && !p.oneTimeToken)
      .map(_publicPending),
  };
}

async function approveScreenDevice(deviceId, patch = {}) {
  const cleanDeviceId = _cleanDeviceId(deviceId);
  const store = await _loadStore();
  const pending = store.pending.find(p => p.deviceId === cleanDeviceId && p.expiresAt > _now());
  if (!pending) throw new Error('Pairing request not found or expired');

  const now = _now();
  const token = _id() + _id();
  const screenId = _cleanScreenId(patch.screenId || pending.screenId);
  const label = _cleanLabel(patch.label || pending.label);

  const existing = store.devices.find(d => d.deviceId === cleanDeviceId);
  const device = {
    deviceId: cleanDeviceId,
    screenId,
    label,
    tokenHash: _hash(token),
    approvedAt: existing?.approvedAt || now,
    lastSeenAt: now,
    revokedAt: null,
  };

  store.devices = store.devices.filter(d => d.deviceId !== cleanDeviceId);
  store.devices.push(device);

  pending.screenId = screenId;
  pending.label = label;
  pending.approvedAt = now;
  pending.oneTimeToken = token;

  await _saveStore(store);
  return _publicDevice(device);
}

async function revokeScreenDevice(deviceId) {
  const cleanDeviceId = _cleanDeviceId(deviceId);
  const store = await _loadStore();
  const device = store.devices.find(d => d.deviceId === cleanDeviceId && !d.revokedAt);
  if (!device) throw new Error('Screen device not found');
  device.revokedAt = _now();
  await _saveStore(store);
  return _publicDevice(device);
}

async function verifyScreenToken({ deviceId, token, screenId }) {
  const cleanDeviceId = _cleanDeviceId(deviceId);
  if (!cleanDeviceId || !token) return null;

  const store = await _loadStore();
  const device = store.devices.find(d =>
    d.deviceId === cleanDeviceId &&
    !d.revokedAt &&
    d.tokenHash === _hash(token)
  );
  if (!device) return null;

  if (screenId && _cleanScreenId(screenId) !== device.screenId) return null;

  device.lastSeenAt = _now();
  await _saveStore(store);
  return _publicDevice(device);
}

module.exports = {
  requestPairing,
  getPairingStatus,
  listScreenDevices,
  approveScreenDevice,
  revokeScreenDevice,
  verifyScreenToken,
};
