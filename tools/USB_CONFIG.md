# USB Configuration File Format

This document describes the `pixelplein-screen.json` configuration file format for zero-touch provisioning via USB stick.

## Quick Start

1. Format USB stick as **FAT32**
2. Create `pixelplein-screen.json` in root directory
3. Insert USB into PixelPlein device
4. Configuration is automatically detected and applied

## Basic Configuration

Minimum required configuration:

```json
{
  "version": 1,
  "serverUrl": "http://192.168.1.100:3000",
  "screenId": "1"
}
```

## Full Configuration Schema

```json
{
  "version": 1,
  "serverUrl": "http://192.168.1.100:3000",
  "screenId": "2",
  "deviceLabel": "Zaal Links",
  "wifi": {
    "ssid": "Event WiFi",
    "password": "secret123",
    "hidden": false
  },
  "network": {
    "interface": "eth0",
    "mode": "static",
    "ip": "192.168.1.20",
    "prefix": 24,
    "gateway": "192.168.1.1",
    "dns": ["8.8.8.8", "1.1.1.1"]
  },
  "kiosk": {
    "autostart": true
  },
  "localServer": {
    "enabled": false,
    "publicBaseUrl": "http://192.168.1.20:3000"
  }
}
```

## Field Reference

### `version` (required)

- **Type**: Number
- **Value**: `1`
- **Description**: Config file format version

### `serverUrl` (required)

- **Type**: String (URL)
- **Format**: `http://` or `https://` followed by hostname/IP and optional port
- **Example**: `"http://192.168.1.100:3000"`, `"https://photos.example.com"`
- **Description**: Backend server URL (without trailing slash)
- **Validation**: Must be valid HTTP(S) URL

### `screenId` (required)

- **Type**: String
- **Values**: `"1"`, `"2"`, `"3"`, or `"4"`
- **Default**: `"1"`
- **Description**: Which screen layout to display (1-4)

### `deviceLabel` (optional)

- **Type**: String
- **Max length**: 120 characters
- **Default**: `"Screen {screenId}"`
- **Example**: `"Zaal Links"`, `"Main Display"`, `"Photo Wall 1"`
- **Description**: Human-readable device name shown in backend admin UI

### `wifi` (optional)

WiFi connection configuration. Omit entire object if using wired ethernet only.

#### `wifi.ssid` (required if `wifi` present)

- **Type**: String
- **Example**: `"Event WiFi"`
- **Description**: WiFi network name (SSID)

#### `wifi.password` (optional)

- **Type**: String
- **Example**: `"secret123"`
- **Description**: WiFi password (WPA/WPA2). Omit for open networks.

#### `wifi.hidden` (optional)

- **Type**: Boolean
- **Default**: `false`
- **Description**: Set to `true` if SSID is hidden (not broadcast)

### `network` (optional)

Wired network interface configuration. Omit entire object to use DHCP (default).

#### `network.interface` (optional)

- **Type**: String
- **Default**: `"eth0"`
- **Common values**: `"eth0"`, `"eth1"`, `"enp0s3"`, `"ens18"`
- **Description**: Network interface name
- **Find yours**: Run `ip link` on device

#### `network.mode` (required if `network` present)

- **Type**: String
- **Values**: `"static"` or `"dhcp"`
- **Description**: IP address assignment mode

#### `network.ip` (required if `mode` is `"static"`)

- **Type**: String (IP address)
- **Example**: `"192.168.1.20"`
- **Description**: Static IP address

#### `network.prefix` (optional, for `"static"` mode)

- **Type**: Number
- **Default**: `24`
- **Common values**: `24` (255.255.255.0), `16` (255.255.0.0), `8` (255.0.0.0)
- **Description**: Subnet prefix length (CIDR notation)

#### `network.gateway` (optional, for `"static"` mode)

- **Type**: String (IP address)
- **Example**: `"192.168.1.1"`
- **Description**: Default gateway/router IP address

#### `network.dns` (optional)

- **Type**: Array of strings (IP addresses)
- **Max length**: 4 entries
- **Example**: `["8.8.8.8", "1.1.1.1"]`
- **Common values**:
  - Google: `["8.8.8.8", "8.8.4.4"]`
  - Cloudflare: `["1.1.1.1", "1.0.0.1"]`
  - Quad9: `["9.9.9.9", "149.112.112.112"]`
- **Description**: DNS server addresses

### `kiosk` (optional)

Kiosk behavior configuration.

#### `kiosk.autostart` (optional)

- **Type**: Boolean
- **Default**: `true`
- **Description**: Whether to auto-start kiosk browser. Set to `false` for setup-only mode.

### `localServer` (optional)

Local PixelPlein server configuration (for standalone/demo mode).

#### `localServer.enabled` (optional)

- **Type**: Boolean
- **Default**: `false`
- **Description**: Whether to run local PixelPlein server on this device

#### `localServer.publicBaseUrl` (optional)

- **Type**: String (URL)
- **Example**: `"http://192.168.1.20:3000"`
- **Description**: Public URL where server is accessible (for QR codes, uploads, etc.)

## Configuration Examples

### Example 1: Basic Remote Server (DHCP)

Simplest configuration for a device connecting to a remote server via DHCP:

```json
{
  "version": 1,
  "serverUrl": "http://192.168.1.100:3000",
  "screenId": "1",
  "deviceLabel": "Main Display"
}
```

### Example 2: WiFi Connection

Device connecting to WiFi network:

```json
{
  "version": 1,
  "serverUrl": "https://photos.example.com",
  "screenId": "2",
  "deviceLabel": "Wireless Display",
  "wifi": {
    "ssid": "Event WiFi",
    "password": "secret123"
  }
}
```

### Example 3: Static IP Configuration

Device with static IP address on wired network:

```json
{
  "version": 1,
  "serverUrl": "http://192.168.1.100:3000",
  "screenId": "3",
  "deviceLabel": "Zaal Rechts",
  "network": {
    "interface": "eth0",
    "mode": "static",
    "ip": "192.168.1.21",
    "prefix": 24,
    "gateway": "192.168.1.1",
    "dns": ["8.8.8.8", "1.1.1.1"]
  }
}
```

### Example 4: Hidden WiFi Network

Device connecting to hidden WiFi:

```json
{
  "version": 1,
  "serverUrl": "http://10.0.0.100:3000",
  "screenId": "1",
  "deviceLabel": "VIP Room",
  "wifi": {
    "ssid": "Hidden_Event_Network",
    "password": "supersecret",
    "hidden": true
  }
}
```

### Example 5: Local Server Mode

Device running its own PixelPlein server:

```json
{
  "version": 1,
  "serverUrl": "http://127.0.0.1:3000",
  "screenId": "1",
  "deviceLabel": "Standalone Demo",
  "localServer": {
    "enabled": true,
    "publicBaseUrl": "http://192.168.1.50:3000"
  }
}
```

### Example 6: Multi-Display Event Setup

Complete setup for a 4-screen event with static IPs:

**USB Stick 1** (`pixelplein-screen.json`):
```json
{
  "version": 1,
  "serverUrl": "http://192.168.1.100:3000",
  "screenId": "1",
  "deviceLabel": "Ingang Links",
  "wifi": {
    "ssid": "Bruiloft2024",
    "password": "welkom123"
  },
  "network": {
    "interface": "eth0",
    "mode": "static",
    "ip": "192.168.1.201",
    "prefix": 24,
    "gateway": "192.168.1.1",
    "dns": ["8.8.8.8"]
  }
}
```

**USB Stick 2** (change `screenId` and `deviceLabel` and `ip`):
```json
{
  "version": 1,
  "serverUrl": "http://192.168.1.100:3000",
  "screenId": "2",
  "deviceLabel": "Ingang Rechts",
  "wifi": {
    "ssid": "Bruiloft2024",
    "password": "welkom123"
  },
  "network": {
    "interface": "eth0",
    "mode": "static",
    "ip": "192.168.1.202",
    "prefix": 24,
    "gateway": "192.168.1.1",
    "dns": ["8.8.8.8"]
  }
}
```

*Repeat for screens 3 and 4 with IPs 192.168.1.203 and 192.168.1.204*

## Auto-Provisioning Workflow

```
┌─────────────────────────────────────────────────────┐
│ 1. Insert USB with pixelplein-screen.json          │
│    ↓                                                │
│ 2. udev detects USB (99-pixelplein-usb.rules)      │
│    ↓                                                │
│ 3. pixelplein-usb-scan.sh triggers provisioner API │
│    ↓                                                │
│ 4. Provisioner validates and applies config:       │
│    - Configure network interface (nmcli)            │
│    - Connect to WiFi                                │
│    - Save config to ~/.config/pixelplein-screen/    │
│    - Start/stop local server if needed              │
│    ↓                                                │
│ 5. Provisioner initiates agent pairing:            │
│    - Generate deviceId (if not present)             │
│    - Request pairing code from backend              │
│    - Poll for admin approval                        │
│    - Store authentication token                     │
│    ↓                                                │
│ 6. Admin approves pairing in backend UI             │
│    ↓                                                │
│ 7. Provisioner receives token and opens WebSocket  │
│    ↓                                                │
│ 8. Kiosk restarts Chromium with new URL            │
│    ↓                                                │
│ 9. Display shows photos, agent reports "online"    │
└─────────────────────────────────────────────────────┘
```

## Validation Rules

The provisioner validates configuration and will reject invalid files. Common validation errors:

### Invalid serverUrl
```
ERROR: serverUrl must be an http(s) URL
```
**Fix**: Ensure `serverUrl` starts with `http://` or `https://` and includes a hostname.

### Invalid screenId
```
WARNING: Invalid screenId, using default '1'
```
**Fix**: Use only `"1"`, `"2"`, `"3"`, or `"4"` (as strings).

### Invalid JSON syntax
```
ERROR: USB /media/.../pixelplein-screen.json: Unexpected token
```
**Fix**: Validate JSON syntax with online validator or `jq`:
```bash
jq . pixelplein-screen.json
```

### Missing required fields
```
ERROR: serverUrl must be an http(s) URL
```
**Fix**: Ensure `version`, `serverUrl`, and `screenId` are present.

## Testing Configuration

Before deploying, test configuration file:

### Validate JSON Syntax
```bash
# macOS/Linux with jq installed
jq . pixelplein-screen.json

# Node.js
node -e "console.log(JSON.parse(require('fs').readFileSync('pixelplein-screen.json')))"

# Python
python3 -m json.tool pixelplein-screen.json
```

### Manual Apply (On Device)
```bash
# Copy file to device
scp pixelplein-screen.json pi@device-ip:/tmp/

# Trigger scan via API
curl -X POST http://device-ip:3987/api/scan-usb

# Check status
curl http://device-ip:3987/api/status | jq
```

### View Applied Config
```bash
ssh pixelplein@device-ip
cat ~/.config/pixelplein-screen/config.json | jq
```

## Troubleshooting

### USB Not Detected

**Check USB filesystem**:
```bash
lsblk -f
```
Ensure filesystem is `vfat` (FAT32), `ntfs`, or `exfat`.

**Check udev rule**:
```bash
cat /etc/udev/rules.d/99-pixelplein-usb.rules
journalctl -f  # Insert USB and watch for events
```

**Trigger manually**:
```bash
/usr/local/bin/pixelplein-usb-scan.sh
```

### Configuration Not Applied

**Check provisioner logs**:
```bash
journalctl -u pixelplein-provisioner -n 50
```

**Check file location**:
```bash
ls -la /media/*/pixelplein-screen.json
ls -la /mnt/*/pixelplein-screen.json
ls -la /run/media/*/pixelplein-screen.json
```

**Validate file manually**:
```bash
jq . /media/usb0/pixelplein-screen.json
```

### Network Configuration Failed

**Check NetworkManager**:
```bash
nmcli device status
nmcli connection show
journalctl -u NetworkManager -n 50
```

**Test WiFi manually**:
```bash
nmcli device wifi list
nmcli device wifi connect "SSID" password "password"
```

**Test static IP manually**:
```bash
nmcli connection add type ethernet con-name test-static ifname eth0 \
  ip4 192.168.1.20/24 gw4 192.168.1.1
nmcli connection up test-static
```

## Security Notes

- **WiFi passwords are stored in plain text** in config file and on device
- **USB auto-execution** is a potential attack vector - only use trusted USB sticks
- Consider encrypting the USB stick or using read-only mounts
- Rotate WiFi passwords after event deployment
- Use WPA3 WiFi if available

## File Format Changelog

### Version 1 (Current)
- Initial format
- Support for WiFi, static IP, local server
- Agent pairing credentials

## See Also

- [INSTALLATION.md](INSTALLATION.md) - Full installation guide
- Backend admin UI - Approve device pairing
- Provisioner web UI - Manual configuration at `http://device-ip:3987`
