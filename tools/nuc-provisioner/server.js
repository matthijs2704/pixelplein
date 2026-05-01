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

let _lastError = '';
let _lastAppliedAt = 0;
let _agentWs = null;
let _agentTimer = null;
let _agentHeartbeatTimer = null;
let _agentStatus = {
  connected: false,
  pairingCode: '',
  lastSeenAt: 0,
  lastError: '',
};

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

function _getLocalIPs() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

function _id() {
  return crypto.randomBytes(16).toString('hex');
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

  // Static / DHCP IP config
  const network = src.network && typeof src.network === 'object'
    ? {
        interface: String(src.network.interface || 'eth0').trim(),
        mode:      src.network.mode === 'static' ? 'static' : 'dhcp',
        ip:        String(src.network.ip || '').trim(),
        prefix:    Number(src.network.prefix) || 24,
        gateway:   String(src.network.gateway || '').trim(),
        dns:       Array.isArray(src.network.dns)
          ? src.network.dns.map(String).filter(Boolean).slice(0, 4)
          : [],
      }
    : null;

  // Local server control
  const localServer = src.localServer && typeof src.localServer === 'object'
    ? {
        enabled:       Boolean(src.localServer.enabled),
        publicBaseUrl: String(src.localServer.publicBaseUrl || '').trim(),
      }
    : null;

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
    network:     network?.interface ? network : null,
    kiosk:       { autostart: src.kiosk?.autostart !== false },
    localServer: localServer,
    updatedAt:   Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Network config via nmcli
// ---------------------------------------------------------------------------

async function _applyNetwork(config) {
  if (!config.network) return;
  const { interface: iface, mode, ip, prefix, gateway, dns } = config.network;
  if (mode === 'static') {
    if (!ip) throw new Error('network.ip required for static mode');
    const dnsStr = dns.length ? dns.join(' ') : '';
    await _run('nmcli', ['con', 'mod', iface, 'ipv4.addresses', `${ip}/${prefix}`, 'ipv4.gateway', gateway, 'ipv4.method', 'manual']);
    if (dnsStr) await _run('nmcli', ['con', 'mod', iface, 'ipv4.dns', dnsStr]);
  } else {
    await _run('nmcli', ['con', 'mod', iface, 'ipv4.method', 'auto']);
  }
  await _run('nmcli', ['con', 'up', iface]).catch(() => {});
}

// ---------------------------------------------------------------------------
// WiFi via nmcli
// ---------------------------------------------------------------------------

async function _applyWifi(config) {
  if (!config.wifi?.ssid) return;
  const args = ['device', 'wifi', 'connect', config.wifi.ssid];
  if (config.wifi.password) args.push('password', config.wifi.password);
  if (config.wifi.hidden) args.push('hidden', 'yes');
  await _run('nmcli', args);
}

// ---------------------------------------------------------------------------
// Local server control via systemctl
// ---------------------------------------------------------------------------

async function _applyLocalServer(config) {
  if (!config.localServer) return;

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
// Apply full provisioning
// ---------------------------------------------------------------------------

async function applyProvisioning(raw) {
  const existing = await _readConfig();
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
  // Order: network → wifi → local-server control
  await _applyNetwork(config);
  await _applyWifi(config);
  await _applyLocalServer(config);
  _lastAppliedAt = Date.now();
  _lastError = '';
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

async function _scanWifi() {
  const out = await _run('nmcli', ['-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes']);
  return out.split('\n')
    .map(line => line.split(':'))
    .filter(parts => parts[0])
    .map(([ssid, signal, security]) => ({ ssid, signal, security }));
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

async function _restartKiosk() {
  await _run('sudo', ['systemctl', 'restart', 'pixelplein-kiosk']);
  return { ok: true, action: 'restart_kiosk' };
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
      await _restartKiosk();
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
  if (command === 'restart_kiosk') return await _restartKiosk();
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
      _agentStatus = { ..._agentStatus, connected: true, lastSeenAt: Date.now(), lastError: '' };
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
      _saveAgentPatch({ token: '' }).catch(() => {});
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
    _agentStatus = { ..._agentStatus, connected: false };
    if (_agentHeartbeatTimer) clearInterval(_agentHeartbeatTimer);
    _agentHeartbeatTimer = null;
    _scheduleAgentConnect();
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

function _scheduleAgentConnect(delayMs = 5000) {
  if (_agentTimer) clearTimeout(_agentTimer);
  _agentTimer = setTimeout(() => {
    _agentStep()
      .catch(err => {
        _agentStatus = { ..._agentStatus, connected: false, lastError: err.message };
      })
      .finally(() => {
        if (!_agentWs || _agentWs.readyState === WebSocket.CLOSED) _scheduleAgentConnect();
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
  return {
    ok:            true,
    config,
    screenUrl:     _screenUrl(config),
    lanIps:        _getLocalIPs(),
    serverRunning: await _serverRunning(),
    kioskRunning:  await _kioskRunning(),
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

function _esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _page(status) {
  const cfg        = status?.config;
  const ips        = (status?.lanIps || []).join(', ') || '—';
  const running    = status?.serverRunning;
  const modeLabel  = cfg?.localServer?.enabled === false ? 'Extern' : 'Lokaal';
  const screenUrl  = _esc(status?.screenUrl || '');
  const agent       = status?.agent || {};
  const agentSig    = `${agent.connected ? '1' : '0'}|${agent.pairingCode || ''}|${agent.lastError || ''}`;
  const configJson = cfg ? _esc(JSON.stringify({ serverUrl: cfg.serverUrl, screenId: cfg.screenId, deviceLabel: cfg.deviceLabel }, null, 2)) : '';

  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PixelPlein Scherm Setup</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0a0e14;color:#e2eaf4;padding:24px;line-height:1.5}
h1{font-size:22px;font-weight:700;margin-bottom:4px}
.sub{color:#8899aa;font-size:13px;margin-bottom:24px}
.card{background:#111820;border:1px solid #1e2d3e;border-radius:14px;padding:20px;margin-bottom:16px}
.card h2{font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#6a8aaa;margin-bottom:12px}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap}
.label{font-size:13px;color:#8899aa}
.val{font-size:14px;font-weight:500;font-family:monospace}
.pill{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
.pill.on{background:rgba(74,222,128,.15);color:#4ade80;border:1px solid rgba(74,222,128,.3)}
.pill.off{background:rgba(248,113,113,.12);color:#f87171;border:1px solid rgba(248,113,113,.25)}
.btns{display:flex;gap:8px;flex-wrap:wrap}
button,input,textarea{font:inherit}
button{padding:9px 16px;border-radius:8px;border:0;font-size:13px;font-weight:600;cursor:pointer;background:#1e3a5f;color:#7dd3fc;transition:background .15s}
button:hover{background:#254a73}
button.danger{background:#3d1f1f;color:#f87171}
button.danger:hover{background:#4d2828}
button.primary{background:#4ea1ff;color:#06101b}
button.primary:hover{background:#62adff}
input,textarea{width:100%;background:#0d151e;color:#e2eaf4;border:1px solid #1e2d3e;border-radius:8px;padding:9px 12px}
textarea{font-family:monospace;font-size:12px}
.error{color:#f87171;font-size:13px;margin-top:8px}
.success{color:#4ade80;font-size:13px;margin-top:8px}
pre{background:#0d151e;padding:12px;border-radius:8px;font-size:12px;white-space:pre-wrap;overflow-wrap:break-word}
</style></head>
<body>
<h1>PixelPlein Scherm Setup</h1>
<p class="sub">Lokale provisioner · poort ${PORT}</p>

<div class="card">
  <h2>Status</h2>
  <div class="row"><span class="label">LAN IP's</span><span class="val">${_esc(ips)}</span></div>
  <div class="row"><span class="label">Server</span><span class="pill ${running ? 'on' : 'off'}">${running ? 'Actief' : 'Gestopt'}</span></div>
  <div class="row"><span class="label">Agent</span><span class="pill ${agent.connected ? 'on' : 'off'}">${agent.connected ? 'Verbonden' : (agent.pairingCode ? `Koppelcode ${_esc(agent.pairingCode)}` : 'Niet verbonden')}</span></div>
  ${agent.lastError ? `<div class="error">Agent: ${_esc(agent.lastError)}</div>` : ''}
  <div class="row"><span class="label">Modus</span><span class="val">${_esc(modeLabel)}</span></div>
  ${cfg ? `<div class="row"><span class="label">Scherm URL</span><span class="val" style="font-size:12px">${screenUrl}</span></div>` : ''}
</div>

<div class="card">
  <h2>USB-stick</h2>
  <p style="font-size:13px;color:#8899aa;margin-bottom:12px">Plaats een USB-stick met <code>${USB_FILE}</code> en klik Scan.</p>
  <div class="btns">
    <button onclick="scanUsb()">Scan USB</button>
    <button onclick="launchScreen()" class="primary">Start kiosk</button>
  </div>
  <div id="usb-msg"></div>
</div>

<div class="card">
  <h2>Handmatige configuratie</h2>
  <textarea id="config" rows="8" placeholder='{"serverUrl":"http://192.168.1.10:3000","screenId":"1"}'>${configJson}</textarea>
  <p style="margin-top:8px"><button onclick="saveConfig()" class="primary">Toepassen</button></p>
  <div id="cfg-msg"></div>
</div>

<div class="card">
  <h2>Wi-Fi</h2>
  <div class="btns"><button onclick="scanWifi()">Scan netwerken</button></div>
  <pre id="wifi" style="margin-top:12px;display:none"></pre>
</div>

<script>
const initialAgentSig = ${JSON.stringify(agentSig)};
async function api(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});return r.json();}
function msg(id,text,ok){const el=document.getElementById(id);if(el){el.textContent=text;el.className=ok?'success':'error';}}
async function scanUsb(){msg('usb-msg','Bezig…',true);const r=await api('/api/scan-usb');msg('usb-msg',r.ok?(r.config?'Toegepast: '+r.config.serverUrl:'Geen bestand gevonden'):('Fout: '+r.error),r.ok&&r.config);}
async function saveConfig(){try{const val=document.getElementById('config').value;const r=await api('/api/apply',JSON.parse(val));msg('cfg-msg',r.ok?'Toegepast':'Fout: '+r.error,r.ok);if(r.ok)setTimeout(()=>location.reload(),1000);}catch(e){msg('cfg-msg','Ongeldige JSON: '+e.message,false);}}
async function launchScreen(){const r=await api('/api/launch');if(!r.ok)alert(r.error||'Launch mislukt');}
async function scanWifi(){const el=document.getElementById('wifi');el.style.display='block';el.textContent='Bezig…';const r=await fetch('/api/wifi').then(x=>x.json());el.textContent=JSON.stringify(r.networks||r,null,2);}
setInterval(async()=>{try{const r=await fetch('/api/status').then(x=>x.json());const a=r.agent||{};const sig=(a.connected?'1':'0')+'|'+(a.pairingCode||'')+'|'+(a.lastError||'');if(sig!==initialAgentSig)location.reload();}catch{}},3000);
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
    if (req.method === 'GET' && req.url === '/') {
      const st = await _status();
      return _html(res, _page(st));
    }
    if (req.method === 'GET'  && req.url === '/api/status')   return _json(res, 200, await _status());
    if (req.method === 'GET'  && req.url === '/api/wifi')     return _json(res, 200, { ok: true, networks: await _scanWifi() });
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
    if (req.method === 'POST' && req.url === '/api/kiosk/restart') return _json(res, 200, await _restartKiosk());
    if (req.method === 'POST' && req.url === '/api/system/reboot')  return _json(res, 200, _scheduleSystemAction('reboot'));
    if (req.method === 'POST' && req.url === '/api/system/shutdown') return _json(res, 200, _scheduleSystemAction('poweroff'));
    _json(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    _lastError = err.message;
    _json(res, 400, { ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Boot: auto-scan USB, optionally launch kiosk
// ---------------------------------------------------------------------------

scanUsb()
  .then(config => {
    if (ENABLE_LAUNCH && config?.kiosk?.autostart !== false) _launchChromium(config);
    _scheduleAgentConnect(500);
  })
  .catch(err => {
    _lastError = err.message;
    _scheduleAgentConnect(500);
  });

server.listen(PORT, HOST, () => {
  console.log(`PixelPlein provisioner running on http://${HOST}:${PORT}`);
  const ips = _getLocalIPs();
  if (ips.length) console.log(`LAN IPs: ${ips.join(', ')}`);
});
