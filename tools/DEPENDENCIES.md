# PixelPlein System Dependencies

Complete reference of system packages required for PixelPlein kiosk installation.

## Dependency Categories

### Core System Utilities (Always Present on Server OS)

These are typically pre-installed on minimal server installations:

- **bash** - Shell (required by all scripts)
- **coreutils** - Basic utilities (cp, mv, rm, mkdir, etc.)
- **systemd** - Init system (Ubuntu/Debian/Raspberry Pi OS default)
- **udev** - Device manager (USB detection)

### Network & Download Tools

| Package | Purpose | Used By | Critical? |
|---------|---------|---------|-----------|
| `curl` | HTTP requests | Install script, USB scan, provisioner | Yes |
| `gnupg` | GPG signature verification | NodeSource repo setup | Yes |
| `ca-certificates` | SSL/TLS certificate validation | HTTPS downloads | Yes |
| `network-manager` | Network configuration (`nmcli`) | Provisioner (WiFi, static IP) | Yes |

**Note**: `network-manager` may conflict with `systemd-networkd` on some minimal server installs. The install script enables NetworkManager.

### System Management

| Package | Purpose | Used By | Critical? |
|---------|---------|---------|-----------|
| `sudo` | Privilege escalation | Provisioner, kiosk script | Yes |
| `systemd` | Service management | All services | Yes |
| `udev` | Device event handling | USB auto-config | Yes |

### Utility Tools

| Package | Purpose | Used By | Critical? |
|---------|---------|---------|-----------|
| `jq` | JSON parsing | Install script | Yes |
| `rsync` | File copying | Install script | Yes |
| `git` | Version control | Updates, development | Recommended |

### X11 Display Stack

| Package | Purpose | Size | Critical? |
|---------|---------|------|-----------|
| `xorg` | X11 server | ~150MB | Yes |
| `openbox` | Window manager | ~2MB | Yes |
| `unclutter` | Hide mouse cursor | <1MB | Yes |
| `xinput` | Input device management | ~1MB | Yes |

**Total X11 footprint**: ~150-200MB

### Browser

| Package | Purpose | Size | Alternatives |
|---------|---------|------|--------------|
| `chromium-browser` | Kiosk display | ~300MB | `chromium`, `google-chrome` |

**Note**: Package name varies by distro:
- Ubuntu/Debian: `chromium-browser`
- Raspberry Pi OS: `chromium-browser`
- Some Debian versions: `chromium`

The kiosk script auto-detects available binary.

### Media Processing (Server Mode Only)

| Package | Purpose | Used By | Critical? |
|---------|---------|---------|-----------|
| `ffmpeg` | Video transcoding | Server (video uploads) | If running local server |

### Node.js Dependencies

| Package | Purpose | How Installed |
|---------|---------|---------------|
| `nodejs` (24.x) | JavaScript runtime | NodeSource repository |
| `npm` | Package manager | Bundled with Node.js |

**Native npm modules** (compiled during `npm install`):
- `sharp` - Image processing (bundles libvips, no system deps needed)
- `sqlite3` - Database (builds against system SQLite)
- `ws` - WebSocket (pure JS, no native deps)

## Minimal Server OS Compatibility

### Ubuntu Server 22.04/24.04 (Minimal Install)

**Pre-installed**:
- bash, coreutils, systemd, udev
- sudo (if installed with admin user)

**Missing** (installed by script):
- X11 stack (xorg, openbox, unclutter, xinput)
- Chromium browser
- curl, gnupg, ca-certificates (may be missing on minimal)
- network-manager (uses systemd-networkd by default)
- jq, rsync, git, ffmpeg

### Debian 12 Server (Minimal Install)

**Pre-installed**:
- bash, coreutils, systemd, udev
- sudo (if configured)

**Missing** (installed by script):
- Same as Ubuntu (X11, Chromium, etc.)

### Raspberry Pi OS Lite (Bookworm)

**Pre-installed**:
- bash, coreutils, systemd, udev, sudo
- Some X11 components (if not ultra-minimal)

**Missing** (installed by script):
- OpenBox, Chromium
- network-manager (uses dhcpcd by default)
- ffmpeg

## Package Size Reference

Approximate installed sizes (varies by architecture):

```
Total install size: ~500-600MB

Core system utils:       ~50MB
  - curl, gnupg, ca-certs, jq, rsync, git
  - network-manager
  - sudo (if not present)

X11 display stack:       ~150MB
  - xorg, openbox, unclutter, xinput

Chromium browser:        ~300MB

Node.js 24 + npm:        ~50MB

Media processing:        ~100MB
  - ffmpeg

npm packages:            ~200MB
  - node_modules (with native builds)
```

**Total system requirements**:
- Disk: ~1GB free (plus space for photos)
- RAM: 2GB minimum, 4GB recommended
- CPU: Any modern ARM/x86 CPU

## Dependency Conflicts

### NetworkManager vs systemd-networkd

Many minimal server installs use `systemd-networkd` for networking. NetworkManager is required for the provisioner's WiFi and network configuration features.

**The install script**:
1. Installs `network-manager`
2. Enables and starts NetworkManager service
3. NetworkManager takes precedence over systemd-networkd

**If you need to keep systemd-networkd**, the provisioner won't work for WiFi/network config. You'll need to configure networking manually before installation.

### Chromium Browser Variants

Different distros package Chromium with different names:
- `chromium-browser` (Ubuntu, Debian, Raspberry Pi OS)
- `chromium` (some Debian-based distros)
- `google-chrome` (not in repos, manual install)

The kiosk script checks for all variants:
```bash
command -v chromium-browser || command -v chromium
```

### FFmpeg Codecs

The `ffmpeg` package in Debian/Ubuntu repos may have limited codec support due to patent/licensing restrictions.

For full codec support, consider:
```bash
apt install -y ffmpeg libavcodec-extra
```

Or use a third-party repository like `ppa:savoury1/ffmpeg4` (Ubuntu) or `deb-multimedia.org` (Debian).

## Verifying Dependencies

### Check Missing Packages

```bash
# Check if all required commands are available
for cmd in curl gnupg nmcli systemctl sudo jq rsync git \
           startx openbox chromium-browser unclutter xinput \
           node npm ffmpeg; do
  command -v $cmd >/dev/null && echo "✓ $cmd" || echo "✗ $cmd MISSING"
done
```

### Check Package Installation

```bash
# On Debian/Ubuntu/Raspberry Pi OS
dpkg -l | grep -E "curl|gnupg|network-manager|xorg|openbox|chromium|unclutter|ffmpeg"
```

### Check Service Status

```bash
# NetworkManager
systemctl is-active NetworkManager

# X11 prerequisites
systemctl is-enabled getty@tty1

# Node.js version
node --version  # Should be v24.x.x
```

## Installing on Truly Minimal Systems

If installing on an extremely minimal base (like Docker container or custom embedded Linux):

### Additional Base Packages May Be Needed

```bash
apt-get install -y \
  apt-transport-https \
  gnupg2 \
  lsb-release \
  software-properties-common \
  wget
```

### Build Tools (for npm native modules)

Sharp and sqlite3 compile native code during `npm install`. Build tools are typically present on server OS, but if missing:

```bash
apt-get install -y \
  build-essential \
  python3
```

**Note**: The install script runs `npm install --omit=dev` which may need these during first install. After that, you can remove build tools if desired (though not recommended for updates).

## Offline Installation

For airgapped/offline systems:

1. **Download Node.js DEB manually** from nodejs.org
2. **Cache all APT packages**:
   ```bash
   apt-get install --download-only -y <packages>
   # Packages saved to /var/cache/apt/archives/
   ```
3. **Bundle npm dependencies**:
   ```bash
   npm pack  # Create tarball with bundled deps
   ```
4. Transfer all packages to target system

## Security Considerations

### Unnecessary Packages to Avoid

The script uses `--no-install-recommends` to minimize installation. Without this flag, APT would install:
- Desktop environment components
- Extra fonts and themes
- Documentation packages
- Example/demo applications

This can add 500MB+ of unnecessary packages.

### Minimal Surface Area

For maximum security, consider:
- Not installing `git` (if no updates needed)
- Using `chromium` in a sandboxed container
- Disabling NetworkManager after initial config (if using static IP only)
- Removing `ffmpeg` if not running local server

## Platform-Specific Notes

### Raspberry Pi OS

**Additional groups** added to `pixelplein` user:
- `gpio`, `spi`, `i2c`, `render` - Hardware access

**GPU memory allocation**:
```bash
# /boot/firmware/config.txt
gpu_mem=128
```

### Ubuntu Server

**NetworkManager conflict**: Ubuntu Server uses `systemd-networkd` + `netplan`. The install script switches to NetworkManager.

**Preserve netplan** (advanced):
Edit `/etc/netplan/01-netcfg.yaml` to use NetworkManager:
```yaml
network:
  version: 2
  renderer: NetworkManager
```

### Debian Minimal

**Non-free repos** may be needed for full Chromium codec support:
```bash
# /etc/apt/sources.list
deb http://deb.debian.org/debian bookworm main non-free-firmware
```

## See Also

- [INSTALLATION.md](INSTALLATION.md) - Complete installation guide
- [Node.js 24 LTS](https://github.com/nodesource/distributions) - NodeSource setup
- [NetworkManager](https://wiki.archlinux.org/title/NetworkManager) - Network configuration
- [OpenBox](http://openbox.org/) - Window manager documentation
