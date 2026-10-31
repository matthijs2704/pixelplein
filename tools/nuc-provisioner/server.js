'use strict';

const childProcess = require('child_process');
const crypto       = require('crypto');
const fs           = require('fs');
const fsp          = require('fs').promises;
const http         = require('http');
const os           = require('os');
const path         = require('path');
const WebSocket    = require('ws');

const PORT = Number(process.env.PORT || 3987);
const HOST = process.env.HOST || process.env.PIXELPLEIN_PROVISIONER_HOST || '0.0.0.0';
const CONFIG_DIR  = process.env.PIXELPLEIN_NUC_CONFIG_DIR || path.join(os.homedir(), '.config', 'pixelplein-screen');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const USB_FILE    = 'pixelplein-screen.json';
const ENABLE_LAUNCH = process.env.PIXELPLEIN_NUC_LAUNCH === '1';
const SERVER_ENV_FILE = process.env.PIXELPLEIN_SERVER_ENV || '/etc/pixelplein/server.env';
const HOTSPOT_FALLBACK_DELAY_MS = 5 * 60_000;
const WIFI_RECONNECT_INTERVAL_MS = 30_000;
const WIFI_RECONNECT_RETRY_MS = 15_000;
const WIFI_HOTSPOT_RECHECK_MS = 5 * 60_000;

let _lastError = '';
let _lastAppliedAt = 0;
let _agentWs = null;
let _agentTimer = null;
let _agentHeartbeatTimer = null;
let _reconnectDelay = 2000;   // current backoff delay (ms); doubles on each failure
let _reconnectAttempts = 0;   // total failed connection attempts since last success
let _agentStatus = {
  connected: false,
  pairingCode: '',
  lastSeenAt: 0,
  lastError: '',
  reconnectAttempts: 0,
};

/** Active session tokens (in-memory; cleared on process restart). */
const _sessions = new Set();
let _webPin     = '';
let _hotspotFallbackTimer = null;
let _wifiReconnectTimer = null;
let _wifiReconnectInFlight = false;
let _networkLostAt = 0;
let _lastHotspotRecheckAt = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ..._corsHeaders(),
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function _html(res, body) {
  res.writeHead(200, { ..._corsHeaders(), 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function _corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Vary': 'Origin, Access-Control-Request-Private-Network',
  };
}

function _run(cmd, args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(cmd, args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        err.message = (stderr || err.message || '').trim();
        reject(err);
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function _runInput(cmd, args, input, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Command timed out'));
    }, timeoutMs);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Command exited ${code}`).trim()));
        return;
      }
      resolve(stdout.trim());
    });
    child.stdin.end(input);
  });
}

function _runBluetoothScan(timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn('sudo', ['/usr/bin/bluetoothctl'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let done = false;

    const finish = (err, output) => {
      if (done) return;
      done = true;
      clearTimeout(stopTimer);
      clearTimeout(killTimer);
      if (err) reject(err);
      else resolve(output);
    };

    const stopTimer = setTimeout(() => {
      try {
        child.stdin.write('scan off\n');
        child.stdin.write('devices\n');
        child.stdin.write('quit\n');
        child.stdin.end();
      } catch {}
    }, timeoutMs);

    const killTimer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error('Bluetooth scan timed out'));
    }, timeoutMs + 5000);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => finish(err));
    child.on('close', code => {
      if (code !== 0 && !stdout) {
        finish(new Error((stderr || `Bluetooth scan exited ${code}`).trim()));
        return;
      }
      finish(null, `${stdout}\n${stderr}`.trim());
    });

    child.stdin.write('power on\n');
    child.stdin.write('agent on\n');
    child.stdin.write('default-agent\n');
    child.stdin.write('scan bredr\n');
  });
}

function _getLocalIPs() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

function _id() {
  return crypto.randomBytes(16).toString('hex');
}

function _parseCookies(req) {
  const header = req.headers.cookie || '';
  const result = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    result[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return result;
}

function _isAuthed(req) {
  if (!_webPin) return true;
  const token = _parseCookies(req).prov_session;
  return Boolean(token && _sessions.has(token));
}

// ---------------------------------------------------------------------------
// Config read / write
// ---------------------------------------------------------------------------

async function _readConfig() {
  try {
    const raw = await fsp.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function _writeConfig(config) {
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  await fsp.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function _sanitizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const serverUrl = String(src.serverUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+/.test(serverUrl)) throw new Error('serverUrl must be an http(s) URL');

  const screenId = /^[1-4]$/.test(String(src.screenId || '1')) ? String(src.screenId || '1') : '1';

  const wifi = src.wifi && typeof src.wifi === 'object'
    ? {
        ssid:     String(src.wifi.ssid || '').trim(),
        password: String(src.wifi.password || ''),
        hidden:   Boolean(src.wifi.hidden),
      }
    : null;

  // Static / DHCP IP config, keyed by interface so eth0 and wlan0 can each
  // hold their own settings at the same time. Also accepts the legacy
  // single-interface shape { interface, mode, ip, ... }.
  let network = null;
  if (src.network && typeof src.network === 'object') {
    const entries = src.network.interface
      ? { [String(src.network.interface).trim()]: src.network }
      : src.network;
    network = {};
    for (const [iface, entry] of Object.entries(entries)) {
      if (!iface || !entry || typeof entry !== 'object') continue;
      network[iface] = {
        mode:    entry.mode === 'static' ? 'static' : 'dhcp',
        ip:      String(entry.ip || '').trim(),
        prefix:  Number(entry.prefix) || 24,
        gateway: String(entry.gateway || '').trim(),
        dns:     Array.isArray(entry.dns) ? entry.dns.map(String).filter(Boolean).slice(0, 4) : [],
      };
    }
    if (!Object.keys(network).length) network = null;
  }

  // Hotspot
  const hotspot = src.hotspot && typeof src.hotspot === 'object'
    ? {
        enabled:  Boolean(src.hotspot.enabled),
        ssid:     String(src.hotspot.ssid || 'PixelPlein').trim(),
        password: String(src.hotspot.password || '').trim(),
        source:   src.hotspot.source === 'manual' ? 'manual' : 'fallback',
      }
    : null;

  // Local server control
  const localServer = src.localServer && typeof src.localServer === 'object'
    ? {
        enabled:       Boolean(src.localServer.enabled),
        publicBaseUrl: String(src.localServer.publicBaseUrl || '').trim(),
      }
    : null;

  const audioOutput = ['default', 'hdmi', 'analog', 'bluetooth'].includes(String(src.audio?.output || '').toLowerCase())
    ? String(src.audio.output).toLowerCase()
    : 'default';
  const bluetooth = src.bluetooth && typeof src.bluetooth === 'object'
    ? {
        device: String(src.bluetooth.device || '').trim().toUpperCase(),
      }
    : null;

  const camera = {
    enabled: Boolean(src.camera?.enabled),
    device:  String(src.camera?.device || '/dev/video0').trim() || '/dev/video0',
    fps:     Math.max(1, Math.min(30, Number(src.camera?.fps) || 30)),
  };

  return {
    version:     1,
    serverUrl,
    screenId,
    deviceLabel: String(src.deviceLabel || `Screen ${screenId}`).trim().slice(0, 120),
    agent:       {
      deviceId:      String(src.agent?.deviceId || src.deviceId || '').trim().slice(0, 120),
      token:         String(src.agent?.token || '').trim(),
      pairingSecret: String(src.agent?.pairingSecret || '').trim(),
      pairingCode:   String(src.agent?.pairingCode || '').trim(),
      pairingExpiresAt: Number(src.agent?.pairingExpiresAt || 0),
    },
    wifi:        wifi?.ssid ? wifi : null,
    network,
    hotspot:     hotspot?.ssid ? hotspot : null,
    kiosk:       { autostart: src.kiosk?.autostart !== false },
    audio:       { output: audioOutput },
    bluetooth:   bluetooth?.device ? bluetooth : null,
    camera,
    localServer: localServer,
    webPin:      String(src.webPin || '').trim().toUpperCase() || undefined,
    updatedAt:   Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Network config via nmcli
// ---------------------------------------------------------------------------

async function _applyNetwork(config) {
  if (!config.network) return;
  const errors = [];
  for (const [iface, entry] of Object.entries(config.network)) {
    await _applyNetworkInterface(iface, entry, config).catch(err => {
      console.warn(`[network] apply failed for "${iface}":`, err.message);
      errors.push(`${iface}: ${err.message}`);
    });
  }
  if (errors.length) throw new Error(errors.join('; '));
}

async function _applyNetworkInterface(iface, entry, config) {
  const { mode, ip, prefix, gateway, dns } = entry;
  const conName = await _networkConnectionName(iface, config);
  if (mode === 'static') {
    if (!ip) throw new Error(`network.${iface}.ip required for static mode`);
    const dnsStr = dns.length ? dns.join(' ') : '';
    const args = ['nmcli', 'con', 'mod', conName, 'ipv4.addresses', `${ip}/${prefix}`, 'ipv4.method', 'manual'];
    if (gateway) args.push('ipv4.gateway', gateway);
    await _run('sudo', args);
    await _run('sudo', ['nmcli', 'con', 'mod', conName, 'ipv4.dns', dnsStr]);
  } else {
    await _run('sudo', ['nmcli', 'con', 'mod', conName, 'ipv4.method', 'auto']);
  }
  await _run('sudo', ['nmcli', 'con', 'up', conName]).catch(() => {});
}

async function _networkDeviceType(iface) {
  const out = await _run('nmcli', ['-t', '-f', 'DEVICE,TYPE', 'device']).catch(() => '');
  const match = out.split('\n')
    .map(line => line.split(':'))
    .find(([device]) => device === iface);
  return match?.[1] || '';
}

async function _networkConnectionName(iface, config = {}) {
  if (!iface) throw new Error('network.interface required');

  const type = await _networkDeviceType(iface);
  if (type !== 'ethernet' && type !== 'wifi') throw new Error(`Unsupported network interface "${iface}"`);

  const active = await _run('nmcli', ['-t', '-f', 'NAME,DEVICE', 'connection', 'show', '--active']).catch(() => '');
  const activeMatch = active.split('\n')
    .map(line => {
      const i = line.lastIndexOf(':');
      return [line.slice(0, i), line.slice(i + 1)];
    })
    .find(([, device]) => device === iface);
  if (activeMatch?.[0]) return activeMatch[0];

  const deviceCon = await _run('nmcli', ['-g', 'GENERAL.CONNECTION', 'device', 'show', iface]).catch(() => '');
  const name = String(deviceCon || '').split('\n')[0].trim();
  if (name && name !== '--') return name;

  const profiles = await _run('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show']).catch(() => '');
  const expectedType = type === 'wifi' ? '802-11-wireless' : '802-3-ethernet';
  const configuredSsid = type === 'wifi' ? config?.wifi?.ssid || '' : '';
  const existing = profiles.split('\n')
    .map(line => {
      const i = line.lastIndexOf(':');
      return [line.slice(0, i), line.slice(i + 1)];
    })
    .find(([profileName, profileType]) =>
      profileType === expectedType && (profileName === iface || profileName === configuredSsid));
  if (existing?.[0]) return existing[0];

  if (type === 'wifi') throw new Error(`No Wi-Fi connection profile found for "${iface}". Connect Wi-Fi first, then apply static IP.`);

  await _run('sudo', ['nmcli', 'con', 'add', 'type', 'ethernet', 'ifname', iface, 'con-name', iface]);
  return iface;
}

async function _networkTargetsWifi(config) {
  if (!config?.network) return false;
  for (const iface of Object.keys(config.network)) {
    if (await _networkDeviceType(iface) === 'wifi') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// WiFi via nmcli
// ---------------------------------------------------------------------------

async function _applyWifi(config) {
  if (!config.wifi?.ssid) return;
  await _run('sudo', ['nmcli', 'connection', 'delete', config.wifi.ssid]).catch(() => {});
  const args = ['sudo', 'nmcli', 'device', 'wifi', 'connect', config.wifi.ssid];
  if (config.wifi.password) args.push('password', config.wifi.password);
  if (config.wifi.hidden) args.push('hidden', 'yes');
  await _run(args[0], args.slice(1));
  await _run('sudo', ['nmcli', 'connection', 'modify', config.wifi.ssid, 'connection.autoconnect', 'yes']).catch(() => {});
}

async function _savedWifiNames() {
  const out = await _run('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show']).catch(() => '');
  return out.split('\n')
    .map(line => {
      const i = line.lastIndexOf(':');
      return [line.slice(0, i), line.slice(i + 1)];
    })
    .filter(([, type]) => type === '802-11-wireless')
    .map(([name]) => name)
    .filter(name => name && name !== HOTSPOT_CON);
}

async function _tryReconnectWifi(config, options = {}) {
  const allowStopHotspot = options.allowStopHotspot === true;
  if (await _hasNetworkConnection()) return true;
  if (!(await _wifiDevice().catch(() => ''))) return false;
  if (config?.hotspot?.enabled && config.hotspot.source === 'manual') return false;

  const configuredSsid = config?.wifi?.ssid || '';
  const savedNames = await _savedWifiNames();
  const names = [...new Set([configuredSsid, ...savedNames].filter(Boolean))];
  if (!names.length) return false;

  let lastErr = null;
  let stoppedHotspot = false;
  if (await _hotspotActive()) {
    // A single Wi-Fi radio can't scan/connect as a client while also
    // running as an AP, so the hotspot has to come down before we can look.
    if (!allowStopHotspot) return false;
    await _stopHotspot().catch(err => { lastErr = err; });
    stoppedHotspot = true;
  }

  await _run('sudo', ['nmcli', 'device', 'wifi', 'rescan']).catch(() => {});

  for (const name of names) {
    try {
      if (savedNames.includes(name)) {
        await _run('sudo', ['nmcli', 'connection', 'up', name]);
      } else if (configuredSsid && name === configuredSsid && config?.wifi) {
        // _applyWifi deletes+recreates the connection profile (defaults to
        // DHCP), so any static IP for this interface must be reasserted.
        await _applyWifi(config);
        await _applyNetwork(config).catch(() => {});
      } else {
        await _run('sudo', ['nmcli', 'connection', 'up', name]);
      }
      if (await _hasNetworkConnection()) {
        const cfg = await _readConfig() || {};
        if (cfg.hotspot?.source === 'fallback') {
          cfg.hotspot.enabled = false;
          await _writeConfig(cfg);
        }
        console.log(`[wifi] Reconnected to "${name}"`);
        return true;
      }
    } catch (err) {
      lastErr = err;
      console.warn(`[wifi] reconnect to "${name}" failed:`, err.message);
    }
  }

  if (stoppedHotspot) {
    // Couldn't reconnect after taking the hotspot down to check — restore
    // it so the admin portal stays reachable instead of leaving the device
    // with neither a real network nor a hotspot.
    await _startFallbackHotspot().catch(err => console.warn('[hotspot] restart after failed reconnect failed:', err.message));
  }

  if (lastErr) _lastError = lastErr.message;
  return false;
}

function _clearWifiReconnectTimer() {
  if (_wifiReconnectTimer) clearTimeout(_wifiReconnectTimer);
  _wifiReconnectTimer = null;
}

function _scheduleWifiReconnect(delayMs = WIFI_RECONNECT_INTERVAL_MS) {
  _clearWifiReconnectTimer();
  _wifiReconnectTimer = setTimeout(() => {
    _wifiReconnectTimer = null;
    _wifiReconnectStep().catch(err => console.warn('[wifi] reconnect monitor failed:', err.message));
  }, delayMs);
}

async function _wifiReconnectStep() {
  if (_wifiReconnectInFlight) {
    _scheduleWifiReconnect(WIFI_RECONNECT_RETRY_MS);
    return;
  }

  _wifiReconnectInFlight = true;
  let keepMonitoring = true;
  try {
    const cfg = await _readConfig();
    if (!cfg) return;
    if (cfg.hotspot?.enabled && cfg.hotspot.source === 'manual') {
      keepMonitoring = false;
      return;
    }
    if (await _hasNetworkConnection()) {
      _networkLostAt = 0;
      _clearHotspotFallbackTimer();
      return;
    }
    if (await _hotspotActive()) {
      // Single Wi-Fi radio can't scan for a known network while also
      // serving as an AP, so checking requires briefly dropping the
      // hotspot. Do that rarely, not every poll, to avoid kicking off
      // connected hotspot clients too often; _tryReconnectWifi restores
      // the hotspot itself if no known network is actually reachable.
      const dueForRecheck = Date.now() - _lastHotspotRecheckAt > WIFI_HOTSPOT_RECHECK_MS;
      if (dueForRecheck) {
        _lastHotspotRecheckAt = Date.now();
        await _tryReconnectWifi(cfg, { allowStopHotspot: true });
      }
      return;
    }

    _scheduleHotspotFallbackAfterNetworkLoss();
    const connected = await _tryReconnectWifi(cfg);
    if (connected) {
      _networkLostAt = 0;
      _clearHotspotFallbackTimer();
    }
  } finally {
    _wifiReconnectInFlight = false;
    if (keepMonitoring) _scheduleWifiReconnect();
  }
}

// ---------------------------------------------------------------------------
// Local server control via systemctl
// ---------------------------------------------------------------------------

async function _applyLocalServer(config) {
  if (!config?.localServer) return;

  const { enabled, publicBaseUrl } = config.localServer;

  // Write PUBLIC_BASE_URL to server env file if publicBaseUrl given
  if (publicBaseUrl) {
    try {
      await fsp.mkdir(path.dirname(SERVER_ENV_FILE), { recursive: true });
      const lines = [`PORT=3000`, `PUBLIC_BASE_URL=${publicBaseUrl}`].join('\n') + '\n';
      await fsp.writeFile(SERVER_ENV_FILE, lines);
    } catch (err) {
      console.warn('Could not write server env file:', err.message);
    }
  }

  const action = enabled ? 'start' : 'stop';
  try {
    await _run('sudo', ['systemctl', action, 'pixelplein-server']);
  } catch (err) {
    console.warn(`systemctl ${action} pixelplein-server:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Audio output
// ---------------------------------------------------------------------------

async function _applyAudio(config) {
  const output = config.audio?.output || 'default';
  const attempts = output === 'bluetooth' ? 12 : 1;
  const args = ['/opt/pixelplein/tools/pixelplein-audio.sh', output, 'pixelplein'];
  if (output === 'bluetooth' && config.bluetooth?.device) args.push(config.bluetooth.device);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await _run('sudo', args);
      return;
    } catch (err) {
      if (attempt >= attempts) {
        console.warn(`[audio] failed to select ${output}:`, err.message);
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// ---------------------------------------------------------------------------
// Bluetooth audio via BlueZ
// ---------------------------------------------------------------------------

function _isBluetoothAddress(value) {
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(String(value || '').trim());
}

function _parseBluetoothDevices(out) {
  return String(out || '').split('\n')
    .map(line => {
      const match = line.match(/^(?:\[[^\]]+\]\s+)?Device\s+([0-9A-F:]{17})\s+(.+)$/i);
      return match ? { address: match[1].toUpperCase(), name: match[2].trim() } : null;
    })
    .filter(Boolean);
}

function _bluetoothLooksLikeAudio(info) {
  return /UUID:.*(Audio Sink|Advanced Audio Distribution|Headset|Handsfree|A\/V Remote Control)/i.test(String(info || ''));
}

function _bluetoothIsConnected(info) {
  return /^(\s*)Connected:\s+yes\s*$/im.test(String(info || ''));
}

async function _bluetoothctl(commands, timeoutMs) {
  return await _runInput('sudo', ['/usr/bin/bluetoothctl'], `${commands.join('\n')}\n`, timeoutMs);
}

async function _bluetoothctlCommand(args, timeoutMs = 30_000) {
  return await new Promise((resolve, reject) => {
    childProcess.execFile('sudo', ['/usr/bin/bluetoothctl', '--agent', 'NoInputNoOutput', ...args], {
      timeout: timeoutMs,
    }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`.trim();
      if (err) {
        err.message = out || err.message;
        reject(err);
        return;
      }
      resolve(out);
    });
  });
}

async function _ensureBluetooth() {
  await _run('sudo', ['systemctl', 'enable', 'bluetooth']).catch(() => {});
  await _run('sudo', ['systemctl', 'start', 'bluetooth']).catch(() => {});
  await _bluetoothctl(['power on', 'agent NoInputNoOutput', 'default-agent'], 10_000).catch(() => {});
}

async function _bluetoothDevices() {
  await _ensureBluetooth();
  const pairedOut = await _bluetoothctl(['paired-devices'], 10_000).catch(() => '');
  const knownOut = await _bluetoothctl(['devices'], 10_000).catch(() => '');
  const connectedOut = await _bluetoothctl(['devices Connected'], 10_000).catch(() => '');
  const paired = new Set(_parseBluetoothDevices(pairedOut).map(d => d.address));
  const connected = new Set(_parseBluetoothDevices(connectedOut).map(d => d.address));
  const devices = _parseBluetoothDevices(`${pairedOut}\n${knownOut}`)
    .filter((device, idx, devices) => devices.findIndex(d => d.address === device.address) === idx)
    .map(device => ({ ...device, paired: paired.has(device.address), connected: connected.has(device.address) }));

  for (const device of devices) {
    const info = await _bluetoothctl([`info ${device.address}`], 8000).catch(() => '');
    device.audio = _bluetoothLooksLikeAudio(info);
  }

  return devices.sort((a, b) => Number(b.audio) - Number(a.audio) || Number(b.connected) - Number(a.connected));
}

async function _scanBluetooth() {
  await _ensureBluetooth();
  const scanOut = await _runBluetoothScan();
  const scanned = _parseBluetoothDevices(scanOut);
  const devices = await _bluetoothDevices();
  const byAddress = new Map();
  for (const device of scanned) {
    byAddress.set(device.address, {
      ...device,
      paired:    false,
      connected: false,
      audio:     false,
    });
  }
  for (const device of devices) {
    byAddress.set(device.address, {
      ...(byAddress.get(device.address) || {}),
      ...device,
    });
  }
  return [...byAddress.values()]
    .map(device => ({
      ...device,
      paired:    Boolean(device.paired),
      connected: Boolean(device.connected),
      audio:     Boolean(device.audio),
    }))
    .sort((a, b) => Number(b.audio) - Number(a.audio) || Number(b.connected) - Number(a.connected));
}

async function _connectBluetooth(address) {
  const device = String(address || '').trim().toUpperCase();
  if (!_isBluetoothAddress(device)) throw new Error('Invalid Bluetooth address');

  await _ensureBluetooth();

  // If already connected, force a reclaim: multipoint speakers (e.g. JBL) keep the
  // BlueZ link up while handing active playback to another phone, so a plain
  // 'connect' is a no-op. Dropping and re-establishing makes the speaker switch
  // its active source back to us.
  const wasConnected = _bluetoothIsConnected(
    await _bluetoothctlCommand(['info', device], 8000).catch(() => '')
  );
  if (wasConnected) {
    await _bluetoothctlCommand(['disconnect', device], 15_000).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  const pairOut = [
    await _bluetoothctlCommand(['scan', 'off'], 10_000).catch(err => err.message),
    await _bluetoothctlCommand(['pair', device], 45_000).catch(err => err.message),
    await _bluetoothctlCommand(['trust', device], 15_000).catch(err => err.message),
  ].join('\n');

  let connected = false;
  let lastConnectOut = '';
  let lastInfo = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    lastConnectOut = await _bluetoothctlCommand(['connect', device], 20_000).catch(err => err.message);
    const info = await _bluetoothctlCommand(['info', device], 8000).catch(() => '');
    lastInfo = info;
    connected = _bluetoothIsConnected(info);
    if (connected) break;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  if (!connected) {
    throw new Error(`Bluetooth device did not report Connected: yes\n\npair/trust:\n${pairOut || '(no output)'}\n\nlast connect:\n${lastConnectOut || '(no output)'}\n\ninfo:\n${lastInfo || '(no output)'}`);
  }

  const cfg = await _readConfig() || {};
  cfg.bluetooth = { device };
  cfg.audio = { ...(cfg.audio || {}), output: 'bluetooth' };
  await _writeConfig(cfg);
  await _applyAudio(cfg);
  return { ok: true, device };
}

async function _applyBluetooth(config) {
  const device = String(config?.bluetooth?.device || '').trim().toUpperCase();
  if (!_isBluetoothAddress(device)) return;
  await _ensureBluetooth();
  await _bluetoothctlCommand(['trust', device], 15_000).catch(() => {});
  await _bluetoothctlCommand(['connect', device], 20_000).catch(err => console.warn('[bluetooth] connect failed:', err.message));
}

async function _disconnectBluetooth(address) {
  const device = String(address || '').trim().toUpperCase();
  if (!_isBluetoothAddress(device)) throw new Error('Invalid Bluetooth address');
  await _bluetoothctlCommand(['disconnect', device], 15_000);
  return { ok: true, device };
}

async function _forgetBluetooth(address) {
  const device = String(address || '').trim().toUpperCase();
  if (!_isBluetoothAddress(device)) throw new Error('Invalid Bluetooth address');
  await _bluetoothctlCommand(['disconnect', device], 15_000).catch(() => {});
  await _bluetoothctlCommand(['remove', device], 15_000);

  const cfg = await _readConfig() || {};
  if (cfg.bluetooth?.device === device) {
    delete cfg.bluetooth;
    if (cfg.audio?.output === 'bluetooth') cfg.audio.output = 'default';
    await _writeConfig(cfg);
  }
  return { ok: true, device };
}

// ---------------------------------------------------------------------------
// Hotspot boot apply
// ---------------------------------------------------------------------------

async function _applyHotspot(config) {
  if (!config?.hotspot?.ssid) return;
  if (config.hotspot.enabled) {
    await _startHotspot(config.hotspot.ssid, config.hotspot.password).catch(err =>
      console.warn('[hotspot] start failed:', err.message));
  } else {
    await _stopHotspot().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Apply full provisioning
// ---------------------------------------------------------------------------

async function applyProvisioning(raw) {
  const existing = await _readConfig();
  const shouldApplyWifi = Object.prototype.hasOwnProperty.call(raw || {}, 'wifi');
  const shouldApplyHotspot = Object.prototype.hasOwnProperty.call(raw || {}, 'hotspot');
  const merged = {
    ...(existing || {}),
    ...(raw || {}),
    agent: {
      ...((existing || {}).agent || {}),
      ...((raw || {}).agent || {}),
    },
  };
  const config = _sanitizeConfig(merged);
  await _writeConfig(config);
  if (config.webPin) _webPin = config.webPin;
  // Wi-Fi profiles must exist before static IP can be applied to them.
  const networkTargetsWifi = await _networkTargetsWifi(config);
  if (networkTargetsWifi && shouldApplyWifi) await _applyWifi(config);
  await _applyNetwork(config);
  if (!networkTargetsWifi && shouldApplyWifi) await _applyWifi(config);
  if (shouldApplyHotspot) await _applyHotspot(config);
  await _applyBluetooth(config);
  await _applyAudio(config);
  await _applyLocalServer(config);
  _applyCamera(config);
  _lastAppliedAt = Date.now();
  _lastError = '';
  if (config.hotspot?.enabled && config.hotspot.source === 'manual') {
    _clearWifiReconnectTimer();
  } else {
    _scheduleWifiReconnect(shouldApplyWifi ? WIFI_RECONNECT_RETRY_MS : WIFI_RECONNECT_INTERVAL_MS);
  }
  _scheduleAgentConnect(0);
  return config;
}

// ---------------------------------------------------------------------------
// USB scan
// ---------------------------------------------------------------------------

async function _mountRoots() {
  const roots = ['/media', '/mnt', '/run/media'];
  const dirs = [];
  for (const root of roots) {
    try {
      const entries = await fsp.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) dirs.push(path.join(root, entry.name));
      }
    } catch {}
  }

  const nested = [...dirs];
  for (const dir of dirs) {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) nested.push(path.join(dir, entry.name));
      }
    } catch {}
  }
  return nested;
}

async function scanUsb() {
  const roots = await _mountRoots();
  for (const root of roots) {
    const file = path.join(root, USB_FILE);
    try {
      const stat = await fsp.stat(file);
      if (!stat.isFile()) continue;
      const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
      return await applyProvisioning(raw);
    } catch (err) {
      _lastError = `USB ${file}: ${err.message}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// WiFi status / scan
// ---------------------------------------------------------------------------

async function _wifiStatus() {
  try {
    const active = await _run('nmcli', ['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show', '--active']);
    const ip = await _run('hostname', ['-I']).catch(() => '');
    return { available: true, active, ip };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

async function _hasNetworkConnection() {
  try {
    const out = await _run('nmcli', ['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show', '--active']);
    return out.split('\n').some(l => {
      const [name, type, device] = l.split(':');
      return device && name !== HOTSPOT_CON && (type === '802-3-ethernet' || type === '802-11-wireless');
    });
  } catch {
    return false;
  }
}

async function _scanWifi() {
  const out = await _run('nmcli', ['-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes']);
  return out.split('\n')
    .map(line => line.split(':'))
    .filter(parts => parts[0])
    .map(([ssid, signal, security]) => ({ ssid, signal, security }));
}

async function _wifiDevice() {
  const out = await _run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE', 'device']);
  const devices = out.split('\n')
    .map(line => line.split(':'))
    .map(([device, type, state]) => ({ device, type, state }))
    .filter(item => item.device && item.type === 'wifi' && item.state !== 'unavailable' && item.state !== 'unmanaged');
  return devices[0]?.device || '';
}

async function _knownWifiAvailable(config) {
  if (!(await _wifiDevice().catch(() => ''))) return false;

  const known = new Set();
  if (config?.wifi?.ssid) known.add(config.wifi.ssid);

  const conOut = await _run('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show']).catch(() => '');
  conOut.split('\n')
    .map(line => line.split(':'))
    .filter(([, type]) => type === '802-11-wireless')
    .map(([name]) => name)
    .filter(name => name && name !== HOTSPOT_CON)
    .forEach(name => known.add(name));

  if (!known.size) return false;

  const networks = await _scanWifi().catch(() => []);
  return networks.some(network => known.has(network.ssid));
}

// ---------------------------------------------------------------------------
// Hotspot control via nmcli
// ---------------------------------------------------------------------------

const HOTSPOT_CON = 'pixelplein-hotspot';

async function _hotspotActive() {
  try {
    const out = await _run('nmcli', ['-t', '-f', 'NAME', 'connection', 'show', '--active']);
    return out.split('\n').some(l => l.trim() === HOTSPOT_CON);
  } catch {
    return false;
  }
}

async function _startHotspot(ssid, password) {
  const wifiDevice = await _wifiDevice();
  if (!wifiDevice) throw new Error('No available Wi-Fi device found for hotspot');

  await _run('sudo', ['nmcli', 'connection', 'delete', HOTSPOT_CON]).catch(() => {});
  if (password) {
    await _run('sudo', ['nmcli', 'device', 'wifi', 'hotspot', 'ifname', wifiDevice, 'con-name', HOTSPOT_CON, 'ssid', ssid, 'password', password]);
  } else {
    // Open hotspot — nmcli hotspot always sets a random password, so build the profile manually
    await _run('sudo', ['nmcli', 'con', 'add', 'type', 'wifi', 'ifname', wifiDevice, 'con-name', HOTSPOT_CON,
      'autoconnect', 'no', 'ssid', ssid,
      '802-11-wireless.mode', 'ap',
      'ipv4.method', 'shared']);
    await _run('sudo', ['nmcli', 'con', 'up', HOTSPOT_CON]);
  }
}

async function _stopHotspot() {
  await _run('sudo', ['nmcli', 'connection', 'delete', HOTSPOT_CON]).catch(() => {});
}

function _clearHotspotFallbackTimer() {
  if (_hotspotFallbackTimer) clearTimeout(_hotspotFallbackTimer);
  _hotspotFallbackTimer = null;
}

function _scheduleHotspotFallback(delayMs) {
  _clearHotspotFallbackTimer();
  _hotspotFallbackTimer = setTimeout(() => {
    _hotspotFallbackTimer = null;
    _startFallbackHotspot().catch(err => console.warn('[hotspot] fallback failed:', err.message));
  }, delayMs);
}

function _scheduleHotspotFallbackAfterNetworkLoss() {
  if (!_networkLostAt) _networkLostAt = Date.now();
  const elapsed = Date.now() - _networkLostAt;
  _scheduleHotspotFallback(Math.max(0, HOTSPOT_FALLBACK_DELAY_MS - elapsed));
}

async function _startFallbackHotspot() {
  const cfg = await _readConfig() || {};
  if (await _hasNetworkConnection()) {
    await _stopHotspot().catch(() => {});
    return;
  }

  const ssid     = cfg?.hotspot?.ssid     || 'PixelPlein';
  const password = cfg?.hotspot?.password || '';
  console.log(`[hotspot] No network detected — starting fallback hotspot "${ssid}"`);
  await _startHotspot(ssid, password);

  cfg.hotspot = { enabled: true, ssid, password, source: 'fallback' };
  await _writeConfig(cfg);
}

// ---------------------------------------------------------------------------
// Camera stream — re-publishes an attached webcam as MJPEG over HTTP so
// multiple screens (on other devices) can show the same feed via a module's
// "Stream URL" source, instead of each screen opening its own local
// getUserMedia camera. ffmpeg does the v4l2 capture + MJPEG muxing; this
// process just fans the resulting byte stream out to any connected clients.
// ---------------------------------------------------------------------------

const CAMERA_DEVICE_POLL_MS = 3000;
const CAMERA_RESPAWN_MS = 2000;

let _camProc = null;
let _camClients = new Set();
let _camRetryTimer = null;
let _camDesired = false;
let _camDevice = '/dev/video0';
let _camFps = 10;
let _camLastError = '';

function _stopCameraStream() {
  _camDesired = false;
  if (_camRetryTimer) { clearTimeout(_camRetryTimer); _camRetryTimer = null; }
  if (_camProc) { _camProc.kill('SIGTERM'); _camProc = null; }
  for (const res of _camClients) res.end();
  _camClients.clear();
}

function _scheduleCameraRetry(delayMs) {
  if (_camRetryTimer) clearTimeout(_camRetryTimer);
  _camRetryTimer = setTimeout(() => {
    _camRetryTimer = null;
    _spawnCameraProc();
  }, delayMs);
}

// Device disappearing (unplugged) or ffmpeg exiting (device error) both just
// fall through to a retry loop — same handling either way, so reconnecting
// the webcam recovers automatically without operator action.
function _spawnCameraProc() {
  if (!_camDesired || _camProc) return;
  if (!fs.existsSync(_camDevice)) {
    _scheduleCameraRetry(CAMERA_DEVICE_POLL_MS);
    return;
  }

  const proc = childProcess.spawn('ffmpeg', [
    // Most USB webcams can only do 1080p in their hardware-compressed MJPEG
    // mode, not raw capture (raw 1080p exceeds USB2 bandwidth) — request
    // that format explicitly and remux instead of re-encoding.
    '-f', 'v4l2', '-input_format', 'mjpeg', '-framerate', String(_camFps), '-video_size', '1920x1080', '-i', _camDevice,
    '-c:v', 'copy', '-f', 'mpjpeg', '-boundary_tag', 'pixelplein',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  _camProc = proc;
  proc.stdout.once('data', () => { _camLastError = ''; });
  proc.stdout.on('data', chunk => {
    // A slow/congested client (e.g. weak wifi to one screen) shouldn't stall
    // or backlog frames for the others — drop this chunk for anyone who
    // hasn't drained their previous write yet instead of buffering it.
    for (const res of _camClients) {
      if (res._pixelpleinBackpressured) continue;
      if (!res.write(chunk)) {
        res._pixelpleinBackpressured = true;
        res.once('drain', () => { res._pixelpleinBackpressured = false; });
      }
    }
  });
  let stderrTail = '';
  proc.stderr.on('data', chunk => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000);
  });
  proc.on('exit', code => {
    if (_camProc === proc) _camProc = null;
    if (code !== 0 && code !== null) _camLastError = stderrTail.trim().split('\n').slice(-5).join('\n') || `ffmpeg exited ${code}`;
    for (const res of _camClients) res.end();
    _camClients.clear();
    if (_camDesired) _scheduleCameraRetry(CAMERA_RESPAWN_MS);
  });
  proc.on('error', err => {
    if (_camProc === proc) _camProc = null;
    _camLastError = err.message;
  });
}

function _applyCamera(config) {
  const nextDevice = config?.camera?.device || '/dev/video0';
  const nextFps = Math.max(1, Math.min(30, Number(config?.camera?.fps) || 30));
  const changed = nextDevice !== _camDevice || nextFps !== _camFps;
  _camDevice = nextDevice;
  _camFps = nextFps;
  if (config?.camera?.enabled) {
    _camDesired = true;
    // Kill and let the exit handler's retry respawn with the new settings —
    // don't spawn a replacement here, the old process may still hold the
    // v4l2 device for a moment after SIGTERM.
    if (changed && _camProc) { _camProc.kill('SIGTERM'); }
    else if (!_camProc && !_camRetryTimer) _spawnCameraProc();
  } else {
    _stopCameraStream();
  }
}

// GET /camera/stream — multipart MJPEG. 503 while the camera isn't
// producing frames so the screen client's reconnect loop retries quickly
// instead of hanging on an open-but-silent connection. CORS is open because
// screens fetch() this cross-origin (different host:port than the app
// server) to demux it themselves — Chrome doesn't repaint a multipart
// response embedded via plain <img src>.
function _handleCameraStream(req, res) {
  if (!_camDesired || !_camProc) {
    res.writeHead(503, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('camera unavailable');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace;boundary=pixelplein',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    Connection: 'close',
  });
  _camClients.add(res);
  req.on('close', () => _camClients.delete(res));
}

// Pulls a single JPEG frame off the already-running mjpeg producer (rather
// than opening the v4l2 device a second time, which most webcams refuse
// while it's already in use by the stream). Used by the admin "snapshot"
// button to inject the current frame into the chat sidecar.
function _grabCameraSnapshot() {
  return new Promise((resolve, reject) => {
    if (!_camProc) return reject(new Error('camera not running'));
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => { cleanup(); reject(new Error('snapshot timed out')); }, 4000);
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = buf.slice(0, headerEnd).toString('latin1');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) return;
      const len = Number(m[1]);
      const start = headerEnd + 4;
      if (buf.length < start + len) return;
      cleanup();
      resolve(buf.slice(start, start + len));
    };
    const cleanup = () => { clearTimeout(timer); _camProc?.stdout.off('data', onData); };
    _camProc.stdout.on('data', onData);
  });
}

// Public + CORS: fetched cross-origin from the app admin page (a different
// origin than the provisioner) to build a data URL for the chat sidecar.
async function _handleCameraSnapshot(req, res) {
  try {
    const jpeg = await _grabCameraSnapshot();
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(jpeg);
  } catch (err) {
    res.writeHead(503, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end(err.message);
  }
}

// ---------------------------------------------------------------------------
// Server status
// ---------------------------------------------------------------------------

async function _serverRunning() {
  try {
    await _run('systemctl', ['is-active', '--quiet', 'pixelplein-server']);
    return true;
  } catch {
    return false;
  }
}

async function _kioskRunning() {
  try {
    await _run('systemctl', ['is-active', '--quiet', 'pixelplein-kiosk']);
    return true;
  } catch {
    return false;
  }
}

function _restartKiosk() {
  // ponytail: fire-and-forget like _scheduleSystemAction; systemctl restart blocks
  // until the old process dies (TimeoutStopSec=10) which exceeds _run's 15s timeout
  setTimeout(() => {
    const child = childProcess.spawn('sudo', ['systemctl', 'restart', 'pixelplein-kiosk'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }, 250);
  return { ok: true, action: 'restart_kiosk' };
}

function _clearKioskCache() {
  // stop → wipe cache → start, sequentially via execFile (allowed by sudoers)
  _run('sudo', ['systemctl', 'stop', 'pixelplein-kiosk'])
    .catch(() => {})
    .then(() => Promise.all([
      _run('sudo', ['rm', '-rf', '/home/pixelplein/.cache/chromium']).catch(() => {}),
      _run('sudo', ['rm', '-rf', '/home/pixelplein/.cache/google-chrome']).catch(() => {}),
    ]))
    .then(() => _run('sudo', ['systemctl', 'start', 'pixelplein-kiosk']).catch(() => {}));
  return { ok: true, action: 'clear_cache' };
}

function _scheduleSystemAction(action) {
  setTimeout(() => {
    const child = childProcess.spawn('sudo', ['systemctl', action], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }, 250);
  return { ok: true, action };
}

// ---------------------------------------------------------------------------
// Backend agent connection
// ---------------------------------------------------------------------------

function _wsUrl(serverUrl) {
  try {
    const url = new URL(serverUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

async function _saveAgentPatch(patch) {
  const config = await _readConfig();
  if (!config?.serverUrl) return null;
  // Handle screenId separately (top-level field)
  if ('screenId' in patch) {
    config.screenId = patch.screenId;
    delete patch.screenId;
  }
  config.agent = { ...(config.agent || {}), ...patch };
  await _writeConfig(config);
  return config;
}

async function _ensureAgentDeviceId(config) {
  if (config.agent?.deviceId) return config;
  return await _saveAgentPatch({ deviceId: _id() });
}

async function _agentApi(config, pathName, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${config.serverUrl}${pathName}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload || {}),
      signal:  controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function _requestAgentPairing(config) {
  console.log(`[agent] requesting pairing for ${config.agent.deviceId} at ${config.serverUrl}`);
  const result = await _agentApi(config, '/api/screens/pair/request', {
    deviceId: config.agent.deviceId,
    screenId: config.screenId,
    label:    config.deviceLabel || `Screen ${config.screenId}`,
  });

  if (result.status === 'already_paired') {
    _agentStatus = {
      ..._agentStatus,
      connected: false,
      lastError: 'Agent is paired on the backend, but this provisioner has no token. Revoke and approve it again.',
    };
    return config;
  }

  const next = await _saveAgentPatch({
    pairingSecret:    result.pairingSecret || '',
    pairingCode:      result.code || '',
    pairingExpiresAt: result.expiresAt || 0,
  });

  _agentStatus = {
    ..._agentStatus,
    connected: false,
    pairingCode: result.code || '',
    lastError: '',
  };
  return next || config;
}

async function _pollAgentPairing(config) {
  if (!config.agent?.pairingSecret) return config;
  console.log(`[agent] polling pairing status for ${config.agent.deviceId}`);
  const result = await _agentApi(config, '/api/screens/pair/status', {
    deviceId:      config.agent.deviceId,
    pairingSecret: config.agent.pairingSecret,
  });

  if (result.status === 'approved' && result.token) {
    _agentStatus = { ..._agentStatus, pairingCode: '', lastError: '' };
    const patch = {
      token:            result.token,
      pairingSecret:    '',
      pairingCode:      '',
      pairingExpiresAt: 0,
    };
    // If backend assigned a different screenId, update config and restart kiosk
    if (result.screenId && result.screenId !== config.screenId) {
      console.log(`[agent] screenId changed from ${config.screenId} to ${result.screenId}, restarting kiosk`);
      patch.screenId = result.screenId;
      const updated = await _saveAgentPatch(patch);
      _restartKiosk();
      return updated;
    }
    return await _saveAgentPatch(patch);
  }

  if (result.status === 'expired') {
    await _saveAgentPatch({ pairingSecret: '', pairingCode: '', pairingExpiresAt: 0 });
  }

  return config;
}

async function _runAgentCommand(command) {
  if (command === 'restart_kiosk') return _restartKiosk();
  if (command === 'reboot') return _scheduleSystemAction('reboot');
  if (command === 'shutdown') return _scheduleSystemAction('poweroff');
  throw new Error('Unsupported agent command');
}

function _sendAgentHeartbeat() {
  if (!_agentWs || _agentWs.readyState !== WebSocket.OPEN) return;
  _agentWs.send(JSON.stringify({
    type: 'agent_heartbeat',
    status: {
      kioskRunning: _agentStatus.kioskRunning,
      serverRunning: _agentStatus.serverRunning,
    },
  }));
}

function _connectAgentWs(config) {
  if (_agentWs && (_agentWs.readyState === WebSocket.OPEN || _agentWs.readyState === WebSocket.CONNECTING)) return;
  const url = _wsUrl(config.serverUrl);
  if (!url) return;

  _agentWs = new WebSocket(url);
  _agentWs.on('open', () => {
    _agentWs.send(JSON.stringify({
      type:         'agent_auth',
      deviceId:     config.agent.deviceId,
      screenId:     config.screenId,
      token:        config.agent.token,
      capabilities: ['restart_kiosk', 'reboot', 'shutdown'],
    }));
  });

  _agentWs.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'agent_auth_ok') {
      // Reset backoff on successful authentication
      _reconnectDelay    = 2000;
      _reconnectAttempts = 0;
      _agentStatus = { ..._agentStatus, connected: true, lastSeenAt: Date.now(), lastError: '', reconnectAttempts: 0 };
      if (_agentHeartbeatTimer) clearInterval(_agentHeartbeatTimer);
      _agentHeartbeatTimer = setInterval(() => {
        Promise.all([_kioskRunning(), _serverRunning()])
          .then(([kioskRunning, serverRunning]) => {
            _agentStatus = { ..._agentStatus, kioskRunning, serverRunning };
            _sendAgentHeartbeat();
          })
          .catch(() => _sendAgentHeartbeat());
      }, 5000);
      _sendAgentHeartbeat();
      return;
    }

    if (msg.type === 'agent_auth_failed') {
      // Bad/revoked token — clear it and immediately restart the pairing cycle.
      _saveAgentPatch({ token: '' }).catch(() => {});
      _scheduleAgentConnect(0);
      return;
    }

    if (msg.type === 'agent_command') {
      const commandId = String(msg.commandId || '');
      const command = String(msg.command || '');
      _runAgentCommand(command)
        .then(() => {
          if (_agentWs?.readyState === WebSocket.OPEN) {
            _agentWs.send(JSON.stringify({ type: 'agent_command_result', commandId, command, ok: true }));
          }
        })
        .catch(err => {
          if (_agentWs?.readyState === WebSocket.OPEN) {
            _agentWs.send(JSON.stringify({ type: 'agent_command_result', commandId, command, ok: false, error: err.message }));
          }
        });
      return;
    }

    if (msg.type === 'device_reassigned') {
      // Admin changed this device's screen assignment
      if (msg.screenId) {
        console.log(`[agent] Device reassigned to screen ${msg.screenId}, updating config and restarting kiosk`);
        _saveAgentPatch({ screenId: msg.screenId })
          .then(() => _restartKiosk())
          .catch(err => console.error('[agent] Failed to apply reassignment:', err));
      }
      return;
    }
  });

  _agentWs.on('close', () => {
    _reconnectAttempts += 1;
    _agentStatus = { ..._agentStatus, connected: false, reconnectAttempts: _reconnectAttempts };
    if (_agentHeartbeatTimer) clearInterval(_agentHeartbeatTimer);
    _agentHeartbeatTimer = null;
    _scheduleAgentConnect(_reconnectDelay);
    // Double the delay for next time, capped at 60 s
    _reconnectDelay = Math.min(_reconnectDelay * 2, 60_000);
  });

  _agentWs.on('error', err => {
    _agentStatus = { ..._agentStatus, connected: false, lastError: err.message };
  });
}

async function _agentStep() {
  let config = await _readConfig();
  if (!config?.serverUrl) return;

  config = await _ensureAgentDeviceId(config);
  if (!config.agent?.token) {
    if (!config.agent?.pairingSecret || Number(config.agent.pairingExpiresAt || 0) < Date.now()) {
      config = await _requestAgentPairing(config);
    } else {
      config = await _pollAgentPairing(config);
    }
  }

  if (config?.agent?.token) _connectAgentWs(config);
}

function _scheduleAgentConnect(delayMs = 2000) {
  if (_agentTimer) clearTimeout(_agentTimer);
  _agentTimer = setTimeout(() => {
    _agentStep()
      .catch(err => {
        _reconnectAttempts += 1;
        _agentStatus = { ..._agentStatus, connected: false, lastError: err.message, reconnectAttempts: _reconnectAttempts };
        // Grow backoff on step-level errors too (e.g. server unreachable for HTTP pairing)
        _reconnectDelay = Math.min(_reconnectDelay * 2, 60_000);
      })
      .finally(() => {
        if (!_agentWs || _agentWs.readyState === WebSocket.CLOSED) _scheduleAgentConnect(_reconnectDelay);
      });
  }, delayMs);
}

// ---------------------------------------------------------------------------
// Kiosk launch
// ---------------------------------------------------------------------------

function _screenUrl(config) {
  if (!config?.serverUrl) return '';
  return `${config.serverUrl}/screen?screen=${encodeURIComponent(config.screenId || '1')}`;
}

function _launchChromium(config) {
  const url = _screenUrl(config);
  if (!url) throw new Error('No screen URL configured');

  const candidates = [
    process.env.CHROMIUM_BIN,
    'chromium-browser',
    'chromium',
    'google-chrome',
  ].filter(Boolean);

  let lastErr = null;
  for (const bin of candidates) {
    try {
      const found = bin.includes('/')
        ? fs.existsSync(bin)
        : childProcess.spawnSync('which', [bin]).status === 0;
      if (!found) continue;
      const child = childProcess.spawn(bin, [
        '--kiosk',
        '--noerrdialogs',
        '--disable-infobars',
        '--disable-session-crashed-bubble',
        '--disable-restore-session-state',
        '--disable-component-update',
        '--disable-translate',
        '--no-first-run',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=TranslateUI,Translate',
        url,
      ], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { ok: true, bin, url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(lastErr?.message || 'Chromium executable not found');
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

async function _status() {
  const config = await _readConfig();
  const [serverRunning, kioskRunning, hotspotActive] = await Promise.all([_serverRunning(), _kioskRunning(), _hotspotActive()]);
  return {
    ok:            true,
    config,
    screenUrl:     _screenUrl(config),
    lanIps:        _getLocalIPs(),
    serverRunning,
    kioskRunning,
    hotspotActive,
    agent:         {
      ..._agentStatus,
      pairingCode: _agentStatus.pairingCode || config?.agent?.pairingCode || '',
    },
    wifi:          await _wifiStatus(),
    lastAppliedAt: _lastAppliedAt,
    lastError:     _lastError,
  };
}

// ---------------------------------------------------------------------------
// Setup page
// ---------------------------------------------------------------------------

const _pageStyles = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#0d0d12;color:#e2e2f0;padding:24px;line-height:1.5;font-size:14px}
h1{font-size:22px;font-weight:700;margin-bottom:4px;color:#fff}
.sub{color:#7070a0;font-size:13px;margin-bottom:24px}
.card{background:#1c1c28;border:1px solid #272736;border-radius:10px;padding:20px;margin-bottom:16px}
.card h2{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7070a0;margin-bottom:12px}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap}
.label{font-size:13px;color:#7070a0}
.val{font-size:14px;font-weight:500;font-family:monospace}
.pill{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
.pill.on{background:rgba(62,207,142,.15);color:#3ecf8e;border:1px solid rgba(62,207,142,.3)}
.pill.off{background:rgba(224,92,92,.12);color:#e05c5c;border:1px solid rgba(224,92,92,.25)}
.pill.warn{background:rgba(245,166,35,.12);color:#f5a623;border:1px solid rgba(245,166,35,.3)}
.btns{display:flex;gap:8px;flex-wrap:wrap}
button,input,textarea{font:inherit}
button{padding:8px 18px;border-radius:8px;border:1px solid #272736;font-size:13px;font-weight:600;cursor:pointer;background:#222230;color:#e2e2f0;transition:background .12s,opacity .12s}
button:hover{background:#2a2a3e;opacity:1}
button.danger{background:#222230;color:#e05c5c;border-color:#e05c5c}
button.danger:hover{background:#2d1f1f}
button.primary{background:#6c63ff;color:#fff;border-color:#6c63ff}
button.primary:hover{background:#7b73ff}
input,textarea{width:100%;background:#222230;color:#e2e2f0;border:1px solid #272736;border-radius:7px;padding:9px 12px;font-size:13px;transition:border-color .15s}
input:focus,textarea:focus{outline:none;border-color:#6c63ff}
textarea{font-family:monospace;font-size:12px;resize:vertical}
.error{color:#e05c5c;font-size:13px;margin-top:8px}
.success{color:#3ecf8e;font-size:13px;margin-top:8px}
pre{background:#14141c;padding:12px;border-radius:8px;font-size:12px;white-space:pre-wrap;overflow-wrap:break-word;border:1px solid #272736}
a{color:#6c63ff}`;

function _loginPage(errorMsg) {
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PixelPlein Agent — Inloggen</title>
<style>${_pageStyles}
.login-wrap{max-width:360px;margin:80px auto 0}
</style></head>
<body>
<div class="login-wrap">
<h1>PixelPlein Agent</h1>
<p class="sub">Lokale agent · poort ${PORT}</p>
<div class="card">
  <h2>Toegangscode</h2>
  <input id="pin" type="password" inputmode="numeric" placeholder="Voer PIN in" autofocus>
  ${errorMsg ? `<div class="error">${_esc(errorMsg)}</div>` : '<div id="err" class="error" style="display:none"></div>'}
  <p style="margin-top:12px"><button class="primary" onclick="login()">Inloggen</button></p>
</div>
</div>
<script>
document.getElementById('pin').addEventListener('keydown',e=>{if(e.key==='Enter')login();});
async function login(){
  const pin=document.getElementById('pin').value.trim();
  const r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});
  const d=await r.json();
  if(d.ok){location.reload();}
  else{const el=document.getElementById('err');if(el){el.textContent=d.error||'Fout';el.style.display='';}}
}
</script>
</body></html>`;
}

function _esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _ago(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)  return 'zojuist';
  if (s < 60) return `${s}s geleden`;
  if (s < 3600) return `${Math.floor(s / 60)}m geleden`;
  return `${Math.floor(s / 3600)}u geleden`;
}

function _page(status) {
  const cfg           = status?.config;
  const ips           = (status?.lanIps || []).join(', ') || '—';
  const serverRunning = status?.serverRunning;
  const kioskRunning  = status?.kioskRunning;
  const hotspotActive = status?.hotspotActive;
  const screenUrl     = _esc(status?.screenUrl || '');
  const agent         = status?.agent || {};
  const agentSig      = `${agent.connected ? '1' : '0'}|${agent.pairingCode || ''}|${agent.lastError || ''}|${agent.reconnectAttempts || 0}`;
  const adminUrl      = cfg?.serverUrl ? _esc(`${cfg.serverUrl}/admin`) : '';

  const pairingSection = (!agent.connected && agent.pairingCode) ? `
<div class="card" style="border-color:rgba(108,99,255,.4)">
  <h2>Koppelen</h2>
  <p style="font-size:13px;color:#7070a0;margin-bottom:12px">Ga in de admin naar <strong>Instellingen → Schermen &amp; apparaten</strong> en keur dit apparaat goed.</p>
  <div class="row"><span class="label">Koppelcode</span><span class="val" style="font-size:22px;letter-spacing:.15em;color:#6c63ff">${_esc(agent.pairingCode)}</span></div>
  <div class="row"><span class="label">Apparaat-ID</span><span class="val" style="font-size:11px">${_esc(cfg?.agent?.deviceId || '—')}</span></div>
  ${adminUrl ? `<div class="row" style="margin-top:8px"><a href="${adminUrl}" target="_blank" style="font-size:13px;font-weight:600">→ Open admin (${_esc(cfg.serverUrl)})</a></div>` : ''}
</div>` : '';

  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PixelPlein Agent</title>
<style>${_pageStyles}</style></head>
<body>
<h1>PixelPlein Agent</h1>
<p class="sub">Lokale agent · poort ${PORT}</p>

${pairingSection}

<div class="card">
  <h2>Status</h2>
  <div class="row"><span class="label">LAN IP's</span><span class="val">${_esc(ips)}</span></div>
  <div class="row"><span class="label">Kiosk</span><span class="pill ${kioskRunning ? 'on' : 'off'}">${kioskRunning ? 'Actief' : 'Gestopt'}</span></div>
  <div class="row"><span class="label">Server</span><span class="pill ${serverRunning ? 'on' : 'off'}">${serverRunning ? 'Actief' : 'Gestopt'}</span></div>
  <div class="row">
    <span class="label">Agent</span>
    <span class="pill ${agent.connected ? 'on' : (agent.pairingCode ? 'warn' : 'off')}">
      ${agent.connected ? `Verbonden · ${_ago(agent.lastSeenAt)}` : (agent.pairingCode ? `Koppelen · code ${_esc(agent.pairingCode)}` : 'Niet verbonden')}
    </span>
  </div>
  ${agent.reconnectAttempts > 0 ? `<div class="row"><span class="label">Herverbindingen</span><span class="val">${agent.reconnectAttempts}</span></div>` : ''}
  ${agent.lastError ? `<div class="error">Fout: ${_esc(agent.lastError)}</div>` : ''}
  ${cfg ? `<div class="row"><span class="label">Scherm</span><span class="val">${_esc(cfg.deviceLabel || `Scherm ${cfg.screenId}`)} · #${_esc(cfg.screenId)}</span></div>` : ''}
  ${screenUrl ? `<div class="row"><span class="label">Scherm URL</span><span class="val" style="font-size:11px"><a href="${screenUrl}" target="_blank">${screenUrl}</a></span></div>` : ''}
  <div class="btns" style="margin-top:12px">
    <button onclick="reloadKiosk()">Herladen</button>
    <button onclick="clearKioskCache()">Cache wissen</button>
    <button onclick="restartKiosk()">Herstart kiosk</button>
    <button onclick="revertPairing()" class="danger">Opnieuw koppelen</button>
    <button onclick="doReboot()" class="danger">Herstart NUC</button>
  </div>
  <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
    <input id="custom-url" type="url" placeholder="https://..." style="flex:1;background:#222230;color:#e2e2f0;border:1px solid #272736;border-radius:7px;padding:9px 12px;font-size:13px" value="${_esc(cfg?.customUrl||'')}">
    <button onclick="openCustomUrl()">Openen</button>
    ${cfg?.customUrl ? `<button onclick="resetUrl()" class="danger">Reset</button>` : ''}
  </div>
  <div id="action-msg"></div>
</div>

<div class="card">
  <h2>Configuratie</h2>
  <div class="row"><label class="label" for="f-serverUrl">Server URL</label><input id="f-serverUrl" type="url" placeholder="http://192.168.1.10:3000" value="${_esc(cfg?.serverUrl||'')}"></div>
  <div class="row"><label class="label" for="f-screenId">Scherm-ID</label>
    <select id="f-screenId" style="background:#222230;color:#e2e2f0;border:1px solid #272736;border-radius:7px;padding:9px 12px;font-size:13px">
      ${['1','2','3','4'].map(n=>`<option value="${n}"${cfg?.screenId===n?' selected':''}>${n}</option>`).join('')}
    </select>
  </div>
  <div class="row"><label class="label" for="f-deviceLabel">Apparaatnaam</label><input id="f-deviceLabel" type="text" placeholder="Zaal Links" value="${_esc(cfg?.deviceLabel||'')}"></div>
  <div class="row">
    <label class="label" for="f-localServer">Lokale server</label>
    <input id="f-localServer" type="checkbox"${cfg?.localServer?.enabled?' checked':''} style="width:auto">
  </div>
  <div class="row"><label class="label" for="f-publicBaseUrl">Publieke basis-URL</label><input id="f-publicBaseUrl" type="url" placeholder="http://192.168.1.10:3000" value="${_esc(cfg?.localServer?.publicBaseUrl||'')}"></div>
  <div class="row">
    <label class="label" for="f-autostart">Kiosk autostart</label>
    <input id="f-autostart" type="checkbox"${cfg?.kiosk?.autostart!==false?' checked':''} style="width:auto">
  </div>
  <div class="row"><label class="label" for="f-audioOutput">Audio-uitgang</label>
    <select id="f-audioOutput" style="background:#222230;color:#e2e2f0;border:1px solid #272736;border-radius:7px;padding:9px 12px;font-size:13px">
      ${[
        ['default','Systeemstandaard'],
        ['hdmi','HDMI'],
        ['analog','Analoog / koptelefoon'],
        ['bluetooth','Bluetooth'],
      ].map(([value,label])=>`<option value="${value}"${(cfg?.audio?.output||'default')===value?' selected':''}>${label}</option>`).join('')}
    </select>
  </div>
  <hr style="border:none;border-top:1px solid #272736;margin:12px 0">
  <div class="row">
    <label class="label" for="f-cameraEnabled">Camera-stream</label>
    <input id="f-cameraEnabled" type="checkbox"${cfg?.camera?.enabled ? ' checked' : ''} style="width:auto">
  </div>
  <div class="row"><label class="label" for="f-cameraDevice">Camera device</label><input id="f-cameraDevice" type="text" placeholder="/dev/video0" value="${_esc(cfg?.camera?.device || '/dev/video0')}"></div>
  <div class="row"><label class="label" for="f-cameraFps">Camera fps</label><input id="f-cameraFps" type="number" min="1" max="30" value="${_esc(String(cfg?.camera?.fps || 30))}"></div>
  <p style="font-size:12px;color:#7070a0;margin:-4px 0 0">Stream-URL voor de andere schermen: <code>http://${_esc(_getLocalIPs()[0] || '<nuc-ip>')}:${PORT}/camera/stream</code></p>
  <div class="row"><span class="label">Camera-status</span><span class="pill ${_camProc ? 'on' : (cfg?.camera?.enabled ? 'warn' : 'off')}">${_camProc ? 'Actief' : (cfg?.camera?.enabled ? 'Bezig met verbinden…' : 'Uit')}</span></div>
  ${_camLastError ? `<pre style="font-size:11px;color:#ff6b6b;white-space:pre-wrap;background:#1a1420;border-radius:7px;padding:8px;margin:4px 0">${_esc(_camLastError)}</pre>` : ''}
  <hr style="border:none;border-top:1px solid #272736;margin:12px 0">
  <details open>
    <summary style="cursor:pointer;font-size:12px;color:#7070a0;margin-bottom:10px">Vaste IP-instellingen</summary>
    <p style="font-size:12px;color:#7070a0;margin-bottom:8px">Ethernet en Wi-Fi kunnen tegelijk een eigen (vaste) IP hebben.</p>
    <div id="network-ifaces"><span style="color:#7070a0;font-size:12px">Interfaces laden…</span></div>
  </details>
  <p style="margin-top:12px"><button onclick="saveConfig()" class="primary">Toepassen</button></p>
  <div id="cfg-msg"></div>
</div>

<div class="card">
  <h2>Wi-Fi</h2>
  <p style="font-size:12px;color:#7070a0;margin-bottom:8px">Opgeslagen netwerken</p>
  <div id="wifi-saved" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px"></div>
  <hr style="border:none;border-top:1px solid #272736;margin:12px 0">
  <p style="font-size:12px;color:#7070a0;margin-bottom:8px">Verbinden</p>
  <div class="btns"><button onclick="scanWifiNetworks()">Scan netwerken</button></div>
  <div id="wifi-scan-list" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px"></div>
  <div class="row" style="margin-top:10px"><label class="label" for="w-ssid">SSID</label><input id="w-ssid" type="text" placeholder="Netwerknaam"></div>
  <div class="row"><label class="label" for="w-pass">Wachtwoord</label><input id="w-pass" type="password"></div>
  <p style="margin-top:12px"><button onclick="connectWifi()" class="primary">Verbinden</button></p>
  <div id="wifi-msg"></div>
</div>

<div class="card">
  <h2>Bluetooth audio</h2>
  <div class="row"><span class="label">Geselecteerd</span><span class="val">${_esc(cfg?.bluetooth?.device || '—')}</span></div>
  <div class="btns"><button onclick="scanBluetooth()">Scan apparaten</button></div>
  <div id="bt-list" style="margin-top:10px;display:flex;flex-direction:column;gap:8px"></div>
  <div id="bt-msg"></div>
</div>

<div class="card">
  <h2>Hotspot</h2>
  <div class="row"><span class="label">Status</span><span class="pill ${hotspotActive ? 'on' : 'off'}" id="hotspot-pill">${hotspotActive ? 'Actief' : 'Uit'}</span></div>
  <div class="row"><label class="label" for="h-ssid">SSID</label><input id="h-ssid" type="text" placeholder="PixelPlein" value="${_esc(cfg?.hotspot?.ssid || 'PixelPlein')}"></div>
  <div class="row"><label class="label" for="h-pass">Wachtwoord</label><input id="h-pass" type="password" placeholder="min. 8 tekens" value="${_esc(cfg?.hotspot?.password || '')}"></div>
  <div class="btns" style="margin-top:12px">
    <button onclick="startHotspot()" class="primary">Starten</button>
    <button onclick="stopHotspot()" class="danger">Stoppen</button>
  </div>
  <div id="hotspot-msg"></div>
</div>

<div class="card">
  <h2>USB-stick</h2>
  <p style="font-size:13px;color:#8899aa;margin-bottom:12px">Plaats een USB-stick met <code>${USB_FILE}</code> en klik Scan om de configuratie te laden.</p>
  <div class="btns">
    <button onclick="scanUsb()">Scan USB</button>
  </div>
  <div id="usb-msg"></div>
</div>

<div class="card">
  <h2>Toegangscode</h2>
  <div class="row"><label class="label" for="p-new">Nieuwe PIN</label><input id="p-new" type="text" placeholder="4–8 tekens" maxlength="8" style="text-transform:uppercase"></div>
  <p style="margin-top:12px"><button onclick="changePin()" class="primary">Wijzigen</button></p>
  <div id="pin-msg"></div>
</div>

<script>
const initialAgentSig = ${JSON.stringify(agentSig)};
const hotspotCurrentlyActive = ${hotspotActive ? 'true' : 'false'};
async function api(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});return r.json();}
function msg(id,text,ok){const el=document.getElementById(id);if(el){el.textContent=text;el.className=ok?'success':'error';}}
function v(id){const el=document.getElementById(id);return el?el.value.trim():'';}
function _e(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function collectNetwork(){
  const network={};
  document.querySelectorAll('.net-iface').forEach(el=>{
    const iface=el.dataset.iface;
    const mode=el.querySelector('.net-mode').value;
    const dns=el.querySelector('.net-dns').value.trim();
    network[iface]={
      mode,
      ip:el.querySelector('.net-ip').value.trim(),
      prefix:Number(el.querySelector('.net-prefix').value)||24,
      gateway:el.querySelector('.net-gateway').value.trim(),
      dns:dns?dns.split(',').map(s=>s.trim()).filter(Boolean):[],
    };
  });
  return Object.keys(network).length?network:null;
}
async function saveConfig(){
  const body={
    serverUrl:v('f-serverUrl'),
    screenId:v('f-screenId'),
    deviceLabel:v('f-deviceLabel'),
    localServer:{enabled:document.getElementById('f-localServer').checked,publicBaseUrl:v('f-publicBaseUrl')},
    kiosk:{autostart:document.getElementById('f-autostart').checked},
    audio:{output:v('f-audioOutput')},
    camera:{enabled:document.getElementById('f-cameraEnabled').checked,device:v('f-cameraDevice'),fps:Number(v('f-cameraFps'))||30},
    network:collectNetwork(),
  };
  const r=await api('/api/apply',body);
  msg('cfg-msg',r.ok?'Toegepast':'Fout: '+r.error,r.ok);
  if(r.ok)setTimeout(()=>location.reload(),1000);
}
async function scanUsb(){msg('usb-msg','Bezig…',true);const r=await api('/api/scan-usb');msg('usb-msg',r.ok?(r.config?'Toegepast: '+r.config.serverUrl:'Geen bestand gevonden'):('Fout: '+r.error),r.ok&&r.config);}
function forgetWifi(el){const name=el.dataset.net;if(!confirm('Netwerk "'+name+'" vergeten?'))return;api('/api/wifi/forget',{name}).then(r=>{msg('wifi-msg',r.ok?'Vergeten':'Fout: '+r.error,r.ok);if(r.ok)loadSavedWifi();});}
function pickSsid(el){document.getElementById('w-ssid').value=el.dataset.ssid;}
async function loadSavedWifi(){
  const r=await fetch('/api/wifi/saved').then(x=>x.json()).catch(()=>({networks:[]}));
  const el=document.getElementById('wifi-saved');
  if(!r.networks||!r.networks.length){el.innerHTML='<span style="color:#7070a0;font-size:12px">Geen opgeslagen netwerken</span>';return;}
  el.innerHTML=r.networks.map(n=>'<span style="display:inline-flex;align-items:center;gap:4px;background:#222230;border:1px solid #272736;border-radius:6px;padding:3px 8px;font-size:12px">'+_e(n)+'<button data-net="'+_e(n)+'" onclick="forgetWifi(this)" style="padding:0 4px;font-size:11px;background:none;border:none;color:#e05c5c;cursor:pointer">✕</button></span>').join('');
}
async function scanWifiNetworks(){
  const list=document.getElementById('wifi-scan-list');
  list.innerHTML='<span style="color:#7070a0;font-size:12px">Bezig…</span>';
  const r=await fetch('/api/wifi').then(x=>x.json()).catch(()=>({networks:[]}));
  const nets=r.networks||[];
  if(!nets.length){list.innerHTML='<span style="color:#7070a0;font-size:12px">Geen netwerken gevonden</span>';return;}
  list.innerHTML=nets.map(n=>'<button data-ssid="'+_e(n.ssid)+'" onclick="pickSsid(this)" style="padding:4px 10px;font-size:12px">'+_e(n.ssid)+' ('+n.signal+'%)</button>').join('');
}
async function connectWifi(){
  if(!v('w-ssid'))return msg('wifi-msg','Voer een SSID in',false);
  if(hotspotCurrentlyActive&&!confirm('Hotspot wordt gestopt om verbinding te maken. Je verliest de verbinding met dit portaal. Doorgaan?'))return;
  msg('wifi-msg',hotspotCurrentlyActive?'Hotspot stoppen en verbinden…':'Verbinden…',true);
  const r=await api('/api/wifi/connect',{ssid:v('w-ssid'),password:v('w-pass')});
  msg('wifi-msg',r.ok?(hotspotCurrentlyActive?'Verbonden — herverbind met het Wi-Fi netwerk en open dit portaal opnieuw':'Verbonden'):'Fout: '+r.error,r.ok);
}
function renderBluetooth(devices){
  const list=document.getElementById('bt-list');
  if(!devices||!devices.length){list.innerHTML='<span style="color:#7070a0;font-size:12px">Geen apparaten gevonden</span>';return;}
  list.innerHTML=devices.map(d=>{
    const status=d.connected?'verbonden':(d.paired?'gekoppeld':'nieuw');
    return '<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;background:#222230;border:1px solid #272736;border-radius:7px;padding:8px 10px">'+
      '<span><strong>'+_e(d.name||d.address)+'</strong><br><span style="font-size:11px;color:#7070a0">'+_e(d.address)+' · '+status+'</span></span>'+
      '<span class="btns">'+
        '<button data-address="'+_e(d.address)+'" onclick="connectBluetooth(this)">Verbinden</button>'+
        (d.connected?'<button data-address="'+_e(d.address)+'" onclick="disconnectBluetooth(this)">Loskoppelen</button>':'')+
        (d.paired?'<button data-address="'+_e(d.address)+'" onclick="forgetBluetooth(this)" class="danger">Vergeten</button>':'')+
      '</span></div>';
  }).join('');
}
async function loadBluetooth(){
  const r=await fetch('/api/bluetooth/devices').then(x=>x.json()).catch(()=>({devices:[]}));
  renderBluetooth(r.devices||[]);
}
async function scanBluetooth(){
  msg('bt-msg','Scannen… zet je speaker/headset in pairing-modus',true);
  const r=await api('/api/bluetooth/scan');
  msg('bt-msg',r.ok?'Scan klaar':'Fout: '+r.error,r.ok);
  renderBluetooth(r.devices||[]);
}
async function connectBluetooth(el){
  const address=el.dataset.address;
  msg('bt-msg','Koppelen en verbinden…',true);
  const r=await api('/api/bluetooth/connect',{address});
  msg('bt-msg',r.ok?'Verbonden, audio staat op Bluetooth':'Fout: '+r.error,r.ok);
  if(r.ok)setTimeout(()=>location.reload(),1200);else loadBluetooth();
}
async function disconnectBluetooth(el){
  const r=await api('/api/bluetooth/disconnect',{address:el.dataset.address});
  msg('bt-msg',r.ok?'Losgekoppeld':'Fout: '+r.error,r.ok);
  loadBluetooth();
}
async function forgetBluetooth(el){
  if(!confirm('Bluetooth apparaat vergeten?'))return;
  const r=await api('/api/bluetooth/forget',{address:el.dataset.address});
  msg('bt-msg',r.ok?'Vergeten':'Fout: '+r.error,r.ok);
  if(r.ok)setTimeout(()=>location.reload(),1000);else loadBluetooth();
}
async function startHotspot(){msg('hotspot-msg','Bezig…',true);const r=await api('/api/hotspot/start',{ssid:v('h-ssid'),password:v('h-pass')});msg('hotspot-msg',r.ok?'Hotspot gestart':'Fout: '+r.error,r.ok);if(r.ok)setTimeout(()=>location.reload(),1500);}
async function stopHotspot(){msg('hotspot-msg','Bezig…',true);const r=await api('/api/hotspot/stop');msg('hotspot-msg',r.ok?'Hotspot gestopt':'Fout: '+r.error,r.ok);if(r.ok)setTimeout(()=>location.reload(),1500);}
async function restartKiosk(){const r=await api('/api/kiosk/restart');msg('action-msg',r.ok?'Kiosk herstart…':'Fout: '+r.error,r.ok);}
async function reloadKiosk(){const r=await api('/api/kiosk/reload');msg('action-msg',r.ok?'Kiosk herladen…':'Fout: '+r.error,r.ok);}
async function clearKioskCache(){if(!confirm('Cache wissen en kiosk herstarten?'))return;const r=await api('/api/kiosk/clear-cache');msg('action-msg',r.ok?'Cache gewist, kiosk herstart…':'Fout: '+r.error,r.ok);}
async function openCustomUrl(){const url=document.getElementById('custom-url').value.trim();if(!url)return;const r=await api('/api/kiosk/open-url',{url});msg('action-msg',r.ok?'Kiosk opent URL…':'Fout: '+r.error,r.ok);if(r.ok)setTimeout(()=>location.reload(),1500);}
async function resetUrl(){const r=await api('/api/kiosk/reset-url');msg('action-msg',r.ok?'URL gereset, kiosk herstart…':'Fout: '+r.error,r.ok);if(r.ok)setTimeout(()=>location.reload(),1500);}
async function revertPairing(){if(!confirm('Token wissen en opnieuw koppelen?'))return;const r=await api('/api/revert-pairing');msg('action-msg',r.ok?'Koppeling gereset':'Fout: '+r.error,r.ok);if(r.ok)setTimeout(()=>location.reload(),2000);}
async function doReboot(){if(!confirm('NUC opnieuw opstarten?'))return;const r=await api('/api/system/reboot');msg('action-msg',r.ok?'Herstart gepland…':'Fout: '+r.error,r.ok);}
async function changePin(){const r=await api('/api/change-pin',{newPin:v('p-new')});msg('pin-msg',r.ok?'PIN gewijzigd':'Fout: '+r.error,r.ok);}
loadSavedWifi();
loadBluetooth();
(async function loadInterfaces(){
  const r=await fetch('/api/network/interfaces').then(x=>x.json()).catch(()=>({interfaces:[]}));
  const savedNetwork=${JSON.stringify(cfg?.network||{})};
  const box=document.getElementById('network-ifaces');
  const ifaces=r.interfaces||[];
  if(!ifaces.length){box.innerHTML='<span style="color:#7070a0;font-size:12px">Geen interfaces gevonden</span>';return;}
  box.innerHTML=ifaces.map(i=>{
    const s=savedNetwork[i.device]||{};
    const mode=s.mode==='static'?'static':'dhcp';
    return '<div class="net-iface" data-iface="'+_e(i.device)+'" style="border:1px solid #272736;border-radius:8px;padding:10px;margin-bottom:10px">'
      +'<div style="font-size:12px;color:#a0a0c0;margin-bottom:8px">'+_e(i.device)+' ('+_e(i.type)+(i.state==='connected'?' · verbonden':'')+')</div>'
      +'<div class="row"><label class="label">IP-modus</label><select class="net-mode" style="background:#222230;color:#e2e2f0;border:1px solid #272736;border-radius:7px;padding:9px 12px;font-size:13px">'
        +'<option value="dhcp"'+(mode!=='static'?' selected':'')+'>DHCP</option>'
        +'<option value="static"'+(mode==='static'?' selected':'')+'>Statisch</option>'
      +'</select></div>'
      +'<div class="row"><label class="label">IP-adres</label><input class="net-ip" type="text" placeholder="192.168.1.20" value="'+_e(s.ip||'')+'"></div>'
      +'<div class="row"><label class="label">Prefix</label><input class="net-prefix" type="number" min="1" max="32" placeholder="24" value="'+_e(String(s.prefix||''))+'"></div>'
      +'<div class="row"><label class="label">Gateway</label><input class="net-gateway" type="text" placeholder="192.168.1.1" value="'+_e(s.gateway||'')+'"></div>'
      +'<div class="row"><label class="label">DNS (kommagescheiden)</label><input class="net-dns" type="text" placeholder="8.8.8.8,1.1.1.1" value="'+_e((s.dns||[]).join(','))+'"></div>'
    +'</div>';
  }).join('');
})();
setInterval(async()=>{try{const r=await fetch('/api/status').then(x=>x.json());const a=r.agent||{};const sig=(a.connected?'1':'0')+'|'+(a.pairingCode||'')+'|'+(a.lastError||'')+'|'+(a.reconnectAttempts||0);if(sig!==initialAgentSig)location.reload();}catch{}},3000);
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Request body reader
// ---------------------------------------------------------------------------

async function _readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, _corsHeaders());
      return res.end();
    }

    // Auth endpoints — always accessible
    if (req.method === 'POST' && req.url === '/auth/login') {
      const { pin } = await _readBody(req);
      if (_webPin && String(pin || '').trim().toUpperCase() !== _webPin) {
        return _json(res, 401, { ok: false, error: 'Verkeerde toegangscode' });
      }
      const token = crypto.randomBytes(32).toString('hex');
      _sessions.add(token);
      const headers = {
        ..._corsHeaders(),
        'Content-Type': 'application/json',
        'Set-Cookie': `prov_session=${token}; HttpOnly; SameSite=Strict; Path=/`,
      };
      const data = JSON.stringify({ ok: true });
      res.writeHead(200, { ...headers, 'Content-Length': Buffer.byteLength(data) });
      return res.end(data);
    }

    if (req.method === 'POST' && req.url === '/auth/logout') {
      const token = _parseCookies(req).prov_session;
      if (token) _sessions.delete(token);
      const headers = {
        ..._corsHeaders(),
        'Content-Type': 'application/json',
        'Set-Cookie': 'prov_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
      };
      const data = JSON.stringify({ ok: true });
      res.writeHead(200, { ...headers, 'Content-Length': Buffer.byteLength(data) });
      return res.end(data);
    }

    // Public — screens on other devices load this as a plain <img src>, not
    // an authenticated provisioner-portal session.
    // Path-only match (not exact req.url) — the screen client cache-busts
    // reconnect attempts with a ?_= query param.
    const urlPath = req.url.split('?')[0];
    if (req.method === 'GET' && urlPath === '/camera/stream') {
      return _handleCameraStream(req, res);
    }
    if (req.method === 'GET' && urlPath === '/camera/snapshot') {
      return _handleCameraSnapshot(req, res);
    }

    // Auth gate — all other routes require a valid session
    if (!_isAuthed(req)) {
      if (req.method === 'GET' && req.url === '/') {
        return _html(res, _loginPage());
      }
      return _json(res, 401, { ok: false, error: 'Unauthorized' });
    }

    if (req.method === 'GET' && req.url === '/') {
      const st = await _status();
      return _html(res, _page(st));
    }
    if (req.method === 'GET'  && req.url === '/api/status')   return _json(res, 200, await _status());
    if (req.method === 'GET'  && req.url === '/api/wifi')     return _json(res, 200, { ok: true, networks: await _scanWifi() });
    if (req.method === 'GET'  && req.url === '/api/network/interfaces') {
      const out = await _run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE', 'device']).catch(() => '');
      const ifaces = out.split('\n')
        .map(l => { const p = l.split(':'); return { device: p[0], type: p[1], state: p[2] }; })
        .filter(i => i.device && (i.type === 'ethernet' || i.type === 'wifi') && i.device !== 'lo' && !i.device.startsWith('p2p-dev-'));
      return _json(res, 200, { ok: true, interfaces: ifaces });
    }
    if (req.method === 'GET'  && req.url === '/api/wifi/saved') {
      const out = await _run('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show']).catch(() => '');
      const networks = out.split('\n')
        .map(l => { const i = l.lastIndexOf(':'); return [l.slice(0, i), l.slice(i + 1)]; })
        .filter(([, type]) => type === '802-11-wireless')
        .map(([name]) => name)
        .filter(n => n && n !== HOTSPOT_CON);
      return _json(res, 200, { ok: true, networks });
    }
    if (req.method === 'POST' && req.url === '/api/wifi/forget') {
      const { name } = await _readBody(req);
      if (!name) return _json(res, 400, { ok: false, error: 'name vereist' });
      await _run('sudo', ['nmcli', 'connection', 'delete', name]);
      return _json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && req.url === '/api/bluetooth/devices') {
      return _json(res, 200, { ok: true, devices: await _bluetoothDevices() });
    }
    if (req.method === 'POST' && req.url === '/api/bluetooth/scan') {
      return _json(res, 200, { ok: true, devices: await _scanBluetooth() });
    }
    if (req.method === 'POST' && req.url === '/api/bluetooth/connect') {
      const { address } = await _readBody(req);
      return _json(res, 200, await _connectBluetooth(address));
    }
    if (req.method === 'POST' && req.url === '/api/bluetooth/disconnect') {
      const { address } = await _readBody(req);
      return _json(res, 200, await _disconnectBluetooth(address));
    }
    if (req.method === 'POST' && req.url === '/api/bluetooth/forget') {
      const { address } = await _readBody(req);
      return _json(res, 200, await _forgetBluetooth(address));
    }
    if (req.method === 'POST' && req.url === '/api/scan-usb') return _json(res, 200, { ok: true, config: await scanUsb() });
    if (req.method === 'POST' && req.url === '/api/apply') {
      const body   = await _readBody(req);
      const config = await applyProvisioning(body);
      if (ENABLE_LAUNCH && config.kiosk?.autostart !== false) {
        try { _launchChromium(config); } catch {}
      }
      return _json(res, 200, { ok: true, config });
    }
    if (req.method === 'POST' && req.url === '/api/launch')   return _json(res, 200, _launchChromium(await _readConfig()));
    if (req.method === 'POST' && req.url === '/api/kiosk/restart') return _json(res, 200, _restartKiosk());
    if (req.method === 'POST' && req.url === '/api/kiosk/open-url') {
      const { url } = await _readBody(req);
      if (!url) return _json(res, 400, { ok: false, error: 'url vereist' });
      const cfg = await _readConfig() || {};
      cfg.customUrl = url;
      await _writeConfig(cfg);
      return _json(res, 200, _restartKiosk());
    }
    if (req.method === 'POST' && req.url === '/api/kiosk/reset-url') {
      const cfg = await _readConfig() || {};
      delete cfg.customUrl;
      await _writeConfig(cfg);
      return _json(res, 200, _restartKiosk());
    }
    if (req.method === 'POST' && req.url === '/api/kiosk/reload') return _json(res, 200, _restartKiosk());
    if (req.method === 'POST' && req.url === '/api/kiosk/clear-cache') return _json(res, 200, _clearKioskCache());
    if (req.method === 'POST' && req.url === '/api/system/reboot')  return _json(res, 200, _scheduleSystemAction('reboot'));
    if (req.method === 'POST' && req.url === '/api/system/shutdown') return _json(res, 200, _scheduleSystemAction('poweroff'));
    if (req.method === 'POST' && req.url === '/api/change-pin') {
      const { newPin } = await _readBody(req);
      const pin = String(newPin || '').trim().toUpperCase();
      if (pin && !/^[A-Z0-9]{4,8}$/.test(pin)) return _json(res, 400, { ok: false, error: 'PIN moet leeg zijn of 4-8 alfanumerieke tekens zijn' });
      const cfg = await _readConfig() || {};
      if (pin) cfg.webPin = pin;
      else delete cfg.webPin;
      await _writeConfig(cfg);
      _webPin = pin;
      return _json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/api/wifi/connect') {
      const { ssid, password } = await _readBody(req);
      if (!ssid) return _json(res, 400, { ok: false, error: 'ssid vereist' });
      // Stop hotspot first — adapter can't be in AP mode and connect as client simultaneously
      _clearHotspotFallbackTimer();
      await _stopHotspot().catch(() => {});
      await _applyWifi({ wifi: { ssid, password: password || '', hidden: false } });
      // Persist wifi + disabled hotspot to config
      const cfg = await _readConfig() || {};
      cfg.wifi = { ssid, password: password || '', hidden: false };
      if (cfg.hotspot) {
        cfg.hotspot.enabled = false;
        cfg.hotspot.source = 'fallback';
      }
      await _writeConfig(cfg);
      // _applyWifi deletes+recreates the profile (defaults to DHCP), so any
      // configured static IP for the Wi-Fi interface must be reasserted.
      await _applyNetwork(cfg).catch(() => {});
      _networkLostAt = 0;
      _clearHotspotFallbackTimer();
      _scheduleWifiReconnect();
      return _json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/api/hotspot/start') {
      const { ssid, password } = await _readBody(req);
      if (!ssid) return _json(res, 400, { ok: false, error: 'ssid vereist' });
      // Persist hotspot config
      _clearHotspotFallbackTimer();
      _clearWifiReconnectTimer();
      const cfg = await _readConfig() || {};
      cfg.hotspot = { enabled: true, ssid, password: password || '', source: 'manual' };
      await _writeConfig(cfg);
      _networkLostAt = 0;
      await _startHotspot(ssid, password);
      return _json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/api/hotspot/stop') {
      const cfg = await _readConfig() || {};
      _clearHotspotFallbackTimer();
      if (cfg.hotspot) {
        cfg.hotspot.enabled = false;
        cfg.hotspot.source = 'fallback';
        await _writeConfig(cfg);
      }
      await _stopHotspot();
      _networkLostAt = Date.now();
      _scheduleHotspotFallbackAfterNetworkLoss();
      _scheduleWifiReconnect(WIFI_RECONNECT_RETRY_MS);
      return _json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/api/revert-pairing') {
      // Clear token + pairing state and immediately restart the pairing cycle.
      await _saveAgentPatch({ token: '', pairingSecret: '', pairingCode: '', pairingExpiresAt: 0 });
      if (_agentWs) { try { _agentWs.terminate(); } catch {} _agentWs = null; }
      _reconnectDelay    = 2000;
      _reconnectAttempts = 0;
      _agentStatus = { ..._agentStatus, connected: false, pairingCode: '', lastError: '', reconnectAttempts: 0 };
      _scheduleAgentConnect(0);
      return _json(res, 200, { ok: true });
    }
    _json(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    _lastError = err.message;
    _json(res, 400, { ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Boot: auto-scan USB, optionally launch kiosk
// ---------------------------------------------------------------------------

async function _boot() {
  let cfg = await _readConfig();
  _webPin = String(cfg?.webPin || '').trim().toUpperCase();

  // Auto-start hotspot if no active network connection
  const hasNet = await _hasNetworkConnection();
  const manualHotspot = cfg?.hotspot?.enabled && cfg.hotspot.source === 'manual';
  if (manualHotspot) {
    _networkLostAt = 0;
    _clearWifiReconnectTimer();
    await _startHotspot(cfg.hotspot.ssid || 'PixelPlein', cfg.hotspot.password || '')
      .catch(err => console.warn('[hotspot] manual start failed:', err.message));
  } else if (hasNet) {
    _networkLostAt = 0;
    _clearHotspotFallbackTimer();
    await _stopHotspot().catch(() => {});
    if (cfg?.hotspot?.enabled) {
      cfg.hotspot.enabled = false;
      cfg.hotspot.source = 'fallback';
      await _writeConfig(cfg);
    }
    _scheduleWifiReconnect();
  } else {
    if (await _hotspotActive()) {
      await _stopHotspot().catch(err => console.warn('[hotspot] stop fallback before Wi-Fi retry failed:', err.message));
    }
    if (cfg?.hotspot?.enabled && cfg.hotspot.source === 'fallback') {
      cfg.hotspot.enabled = false;
      await _writeConfig(cfg);
    }

    await _tryReconnectWifi(cfg, { allowStopHotspot: true })
      .catch(err => console.warn('[wifi] boot reconnect failed:', err.message));

    if (await _hasNetworkConnection()) {
      _networkLostAt = 0;
      _clearHotspotFallbackTimer();
      await _stopHotspot().catch(() => {});
    } else {
      _networkLostAt = Date.now();
      console.log(`[hotspot] No network detected — trying infrastructure Wi-Fi for ${Math.round(HOTSPOT_FALLBACK_DELAY_MS / 1000)}s before fallback hotspot`);
      _scheduleWifiReconnect(WIFI_RECONNECT_RETRY_MS);
      _scheduleHotspotFallbackAfterNetworkLoss();
    }
  }

  if (cfg?.audio?.output === 'bluetooth' && cfg?.bluetooth?.device) {
    await _applyBluetooth(cfg);
    await _applyAudio(cfg).catch(err => console.warn('[audio] boot apply failed:', err.message));
  }

  await _applyLocalServer(cfg);
  _applyCamera(cfg);

  // Auto-scan USB on startup
  try {
    const config = await scanUsb();
    if (ENABLE_LAUNCH && config?.kiosk?.autostart !== false) _launchChromium(config);
  } catch (err) {
    _lastError = err.message;
  }
  _scheduleAgentConnect(500);
}

_boot().catch(err => { _lastError = err.message; });

server.listen(PORT, HOST, () => {
  console.log(`PixelPlein provisioner running on http://${HOST}:${PORT}`);
  const ips = _getLocalIPs();
  if (ips.length) console.log(`LAN IPs: ${ips.join(', ')}`);
  console.log(`PIN:     ${_webPin || '(none)'}`);
});
