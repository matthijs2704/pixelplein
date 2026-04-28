# PixelPlein Kiosk Installation Guide

Complete guide for installing PixelPlein on dedicated kiosk hardware (Raspberry Pi, Intel NUC, or x86 PC).

## Supported Platforms

- **Raspberry Pi**: Raspberry Pi OS Bookworm (64-bit, lite recommended)
- **Ubuntu**: 22.04 LTS or 24.04 LTS
- **Debian**: 12 (Bookworm)

## Prerequisites

- Fresh OS installation (headless/server install preferred)
- Network connectivity (ethernet recommended for initial setup)
- SSH access for remote installation
- Root/sudo access
- At least 2GB RAM, 8GB storage

## Installation

### 1. Prepare the System

```bash
# Update system packages (recommended but optional)
sudo apt update
sudo apt upgrade -y

# Optional: Set hostname for easier identification
sudo hostnamectl set-hostname pixelplein-001
```

### 2. Copy Installation Files

```bash
# Option A: Clone from repository
git clone https://github.com/yourusername/photodisplay.git
cd photodisplay

# Option B: Copy via SCP
scp -r /path/to/photodisplay user@device-ip:/home/user/
```

### 3. Run Installation Script

```bash
cd photodisplay
sudo bash tools/install.sh
```

The script will:
- Detect platform (Raspberry Pi or generic Linux)
- Install system packages (X11, OpenBox, Chromium, Node.js 24)
- Create `pixelplein` user with appropriate groups
- Configure auto-login on tty1
- Set up X11 session with cursor hiding and screen blanking disabled
- Install application to `/opt/pixelplein`
- Install npm dependencies
- Configure systemd services (provisioner, kiosk, server)
- Set up USB auto-configuration
- Configure Chromium policies for autoplay

**Installation takes 5-15 minutes depending on internet speed.**

### 4. Start Provisioner

```bash
sudo systemctl start pixelplein-provisioner
```

The provisioner service:
- Runs on port **3987**
- Provides setup UI at `http://device-ip:3987`
- Scans for USB configuration files
- Manages device pairing with backend
- Controls local server service
- Handles system commands from backend

## Configuration Methods

After installation, configure the device using one of these methods:

### Method A: USB Configuration (Recommended for Field Deployment)

1. Create `pixelplein-screen.json` on USB stick (FAT32 formatted)
2. Insert USB into device
3. Configuration is auto-detected and applied
4. Device pairs with backend automatically

See [USB_CONFIG.md](USB_CONFIG.md) for config file format.

### Method B: Web UI (Recommended for Single Device Setup)

1. Open `http://device-ip:3987` in browser
2. Fill in configuration form:
   - **Server URL**: Backend server address (e.g., `http://192.168.1.100:3000`)
   - **Screen ID**: 1-4
   - **Device Label**: Descriptive name
   - **WiFi**: SSID and password (optional)
   - **Network**: Static IP or DHCP (optional)
3. Click **Save**
4. Device pairs with backend automatically

### Method C: Manual Configuration

```bash
# Edit config file directly
sudo -u pixelplein nano /home/pixelplein/.config/pixelplein-screen/config.json
```

## Device Pairing

After configuration, the device automatically:
1. Requests pairing from backend (generates pairing code)
2. Waits for admin approval in backend UI
3. Receives authentication token once approved
4. Establishes WebSocket connection as "agent"
5. Displays status: **"Display online · Agent online"**

**Important**: Approve pairing in backend admin UI (`Devices` tab) to complete setup.

## Reboot and Auto-Start

```bash
sudo reboot
```

On reboot:
1. System auto-logs in as `pixelplein` user on tty1
2. `.bash_profile` starts X server
3. `.xinitrc` launches OpenBox window manager with cursor hiding
4. Provisioner service starts
5. Kiosk service launches Chromium in fullscreen
6. Display shows configured screen or provisioner UI

## Services

Three systemd services are installed:

### pixelplein-provisioner.service

- **Purpose**: Device provisioning and management
- **Port**: 3987
- **Auto-start**: Yes (always enabled)
- **User**: pixelplein
- **Logs**: `journalctl -u pixelplein-provisioner -f`

**Commands**:
```bash
sudo systemctl start pixelplein-provisioner
sudo systemctl stop pixelplein-provisioner
sudo systemctl restart pixelplein-provisioner
sudo systemctl status pixelplein-provisioner
```

### pixelplein-kiosk.service

- **Purpose**: Launch Chromium in kiosk mode
- **Auto-start**: Yes (always enabled)
- **Auto-restart**: Yes (infinite loop)
- **User**: pixelplein
- **Environment**: DISPLAY=:0
- **Logs**: `journalctl -u pixelplein-kiosk -f`

**Commands**:
```bash
sudo systemctl start pixelplein-kiosk
sudo systemctl restart pixelplein-kiosk  # Restart browser
sudo systemctl status pixelplein-kiosk
```

### pixelplein-server.service

- **Purpose**: Local PixelPlein backend server (optional)
- **Port**: 3000 (configurable via `/etc/pixelplein/server.env`)
- **Auto-start**: No (controlled by provisioner based on USB config)
- **User**: pixelplein
- **WorkingDirectory**: /opt/pixelplein
- **Logs**: `journalctl -u pixelplein-server -f`

**Commands**:
```bash
sudo systemctl start pixelplein-server
sudo systemctl stop pixelplein-server
sudo systemctl status pixelplein-server
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│ Physical Device Boot Sequence                       │
├─────────────────────────────────────────────────────┤
│ 1. Auto-login on tty1 (getty)                       │
│    ↓                                                │
│ 2. .bash_profile → startx                           │
│    ↓                                                │
│ 3. X Server starts (DISPLAY=:0)                     │
│    ↓                                                │
│ 4. .xinitrc executes:                               │
│    - unclutter (hide cursor)                        │
│    - xset (disable screensaver)                     │
│    - openbox-session                                │
│    ↓                                                │
│ 5. Systemd services start:                          │
│    - pixelplein-provisioner (port 3987)             │
│    - pixelplein-kiosk                               │
│    - pixelplein-server (if enabled)                 │
│    ↓                                                │
│ 6. pixelplein-kiosk.sh launches Chromium:           │
│    - Reads config from ~/.config/pixelplein-screen/ │
│    - Builds URL with deviceId/token                 │
│    - Opens fullscreen kiosk mode                    │
│    - Auto-restarts on crash                         │
└─────────────────────────────────────────────────────┘
```

## File Locations

```
/opt/pixelplein/                          # Application root
  ├── server/                             # Backend server code
  ├── public/                             # Frontend assets
  ├── tools/                              # Installation tools
  │   ├── install.sh                      # Unified install script
  │   ├── pixelplein-kiosk.sh             # Kiosk launch script
  │   ├── nuc-provisioner/                # Provisioner code
  │   └── *.service                       # Systemd unit files
  └── package.json

/etc/pixelplein/                          # System config
  └── server.env                          # Server environment variables

/home/pixelplein/                         # User home
  ├── .bash_profile                       # Auto-start X on tty1
  ├── .xinitrc                            # X session config
  └── .config/
      └── pixelplein-screen/
          └── config.json                 # Device configuration

/etc/systemd/system/                      # Systemd services
  ├── getty@tty1.service.d/
  │   └── autologin.conf                  # Auto-login override
  ├── pixelplein-provisioner.service
  ├── pixelplein-kiosk.service
  └── pixelplein-server.service

/etc/udev/rules.d/                        # USB detection
  └── 99-pixelplein-usb.rules

/usr/local/bin/                           # System scripts
  └── pixelplein-usb-scan.sh

/etc/sudoers.d/                           # Sudo permissions
  └── pixelplein

/etc/chromium/policies/managed/           # Browser policies
  └── pixelplein.json
```

## Troubleshooting

### Device Not Showing Display

```bash
# Check kiosk service status
sudo systemctl status pixelplein-kiosk

# View kiosk logs
journalctl -u pixelplein-kiosk -n 50

# Check X server
echo $DISPLAY  # Should be :0
ps aux | grep X  # Should see Xorg process

# Restart kiosk
sudo systemctl restart pixelplein-kiosk
```

### Provisioner Not Accessible

```bash
# Check provisioner status
sudo systemctl status pixelplein-provisioner

# View logs
journalctl -u pixelplein-provisioner -n 50

# Check port binding
sudo netstat -tlnp | grep 3987

# Restart provisioner
sudo systemctl restart pixelplein-provisioner
```

### USB Config Not Detected

```bash
# Check if USB is mounted
lsblk
mount | grep /media

# Test USB scan manually
curl -X POST http://127.0.0.1:3987/api/scan-usb

# Check udev rules
cat /etc/udev/rules.d/99-pixelplein-usb.rules
journalctl -f  # Then insert USB to see events
```

### Device Not Pairing

```bash
# Check agent status in provisioner UI
curl http://127.0.0.1:3987/api/status | jq .agent

# View config
sudo -u pixelplein cat /home/pixelplein/.config/pixelplein-screen/config.json

# Check backend connectivity
ping backend-server
curl -I http://backend-server:3000
```

### Screen Blanking/Cursor Issues

```bash
# Verify xset settings (as pixelplein user)
sudo -u pixelplein DISPLAY=:0 xset q

# Check .xinitrc
cat /home/pixelplein/.xinitrc

# Restart X session
sudo systemctl restart pixelplein-kiosk
```

### Update Application

```bash
# Pull latest code
cd /opt/pixelplein
sudo git pull

# Update dependencies
sudo -u pixelplein npm install --omit=dev

# Restart services
sudo systemctl restart pixelplein-provisioner
sudo systemctl restart pixelplein-kiosk
# Optional: sudo systemctl restart pixelplein-server
```

## Security Hardening (Optional)

### SSH Configuration

Edit `/etc/ssh/sshd_config`:
```
PermitRootLogin no
PasswordAuthentication no  # If using SSH keys
PubkeyAuthentication yes
ClientAliveInterval 300
ClientAliveCountMax 2
```

```bash
sudo systemctl restart sshd
```

### Firewall

```bash
# Install UFW
sudo apt install ufw

# Allow SSH (if needed)
sudo ufw allow 22/tcp

# Allow provisioner (local only)
sudo ufw allow from 192.168.0.0/16 to any port 3987

# Allow server (if running local server)
sudo ufw allow from 192.168.0.0/16 to any port 3000

# Enable firewall
sudo ufw enable
```

### Automatic Security Updates

```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

## Uninstallation

```bash
# Stop and disable services
sudo systemctl stop pixelplein-kiosk pixelplein-provisioner pixelplein-server
sudo systemctl disable pixelplein-kiosk pixelplein-provisioner pixelplein-server

# Remove service files
sudo rm /etc/systemd/system/pixelplein-*.service
sudo systemctl daemon-reload

# Remove application
sudo rm -rf /opt/pixelplein

# Remove config
sudo rm -rf /etc/pixelplein
sudo rm -rf /home/pixelplein/.config/pixelplein-screen

# Remove system files
sudo rm /etc/udev/rules.d/99-pixelplein-usb.rules
sudo rm /usr/local/bin/pixelplein-usb-scan.sh
sudo rm /etc/sudoers.d/pixelplein
sudo rm -rf /etc/chromium/policies/managed/pixelplein.json

# Reload udev
sudo udevadm control --reload-rules

# Optional: Remove user
sudo userdel -r pixelplein

# Optional: Remove auto-login
sudo rm /etc/systemd/system/getty@tty1.service.d/autologin.conf
sudo systemctl daemon-reload
```

## Support

- **Logs**: `journalctl -u pixelplein-kiosk -f`
- **Status**: `curl http://127.0.0.1:3987/api/status | jq`
- **Config**: `sudo -u pixelplein cat /home/pixelplein/.config/pixelplein-screen/config.json`
