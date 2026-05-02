#!/bin/bash
# PixelPlein unified install script
# Supports: Ubuntu 22.04/24.04, Debian 12, Raspberry Pi OS Bookworm
# Run as root: sudo bash install.sh
set -euo pipefail

APP_DIR=/opt/pixelplein
APP_USER=pixelplein
NODE_PREFERRED_VERSION=24
NODE_MIN_VERSION=20

# ── Platform detection ──────────────────────────────────────────────────────
detect_platform() {
	if [[ -f /proc/device-tree/model ]] && grep -qi 'raspberry pi' /proc/device-tree/model 2>/dev/null; then
		echo "rpi"
	elif command -v raspi-config &>/dev/null; then
		echo "rpi"
	else
		echo "generic"
	fi
}

PLATFORM=$(detect_platform)

if [[ $EUID -ne 0 ]]; then
	echo "ERROR: Run as root: sudo bash $0" >&2
	exit 1
fi

echo "PixelPlein Installation"
echo "Platform detected: $PLATFORM"
echo ""

configure_apt_sources() {
	if [[ ! -f /etc/os-release ]]; then
		return
	fi

	local os_id=""
	# shellcheck disable=SC1091
	. /etc/os-release
	os_id="${ID:-}"

	# Fresh Debian installs sometimes keep only the installer CD-ROM source
	# enabled, or use deb822 sources with only "main". Chromium and firmware
	# packages should come from normal network repositories.
	find /etc/apt -type f \( -name '*.list' -o -name '*.sources' \) -print0 2>/dev/null |
		while IFS= read -r -d '' file; do
			if grep -qE '^[[:space:]]*deb[[:space:]]+cdrom:' "$file"; then
				sed -i -E 's/^([[:space:]]*deb[[:space:]]+cdrom:)/# \1/' "$file"
			fi
		done

	# If a previous installer run added Debian components to a third-party
	# NodeSource repo, repair it. NodeSource only publishes the "main"
	# component.
	find /etc/apt -type f -name '*.list' -print0 2>/dev/null |
		while IFS= read -r -d '' file; do
			sed -i -E '/deb\.nodesource\.com/ s#(deb([[:space:]]+\[[^]]+\])?[[:space:]]+[^[:space:]]*deb\.nodesource\.com[^[:space:]]*[[:space:]]+[^[:space:]]+[[:space:]]+).*#\1main#' "$file"
		done

	find /etc/apt -type f -name '*.sources' -print0 2>/dev/null |
		while IFS= read -r -d '' file; do
			if grep -q 'deb\.nodesource\.com' "$file"; then
				sed -i -E 's/^Components:.*/Components: main/' "$file"
			fi
		done

	if [[ "$os_id" != "debian" && "$os_id" != "raspbian" ]]; then
		return
	fi

	find /etc/apt -type f -name '*.list' -print0 2>/dev/null |
		while IFS= read -r -d '' file; do
			sed -i -E '/^[[:space:]]*deb[[:space:]].*(debian|raspbian|raspberrypi)/ {
				/ contrib/! s/[[:space:]]+main([[:space:]]|$)/ main contrib\1/
				/ non-free-firmware/! s/[[:space:]]+contrib([[:space:]]|$)/ contrib non-free-firmware\1/
				/ non-free([[:space:]]|$)/! s/[[:space:]]+non-free-firmware([[:space:]]|$)/ non-free non-free-firmware\1/
			}' "$file"
		done

	find /etc/apt -type f -name '*.sources' -print0 2>/dev/null |
		while IFS= read -r -d '' file; do
			if grep -qE '^URIs:.*(debian|raspbian|raspberrypi)' "$file" && grep -q '^Components:' "$file"; then
				sed -i -E '/^Components:/ {
					/ contrib/! s/$/ contrib/
					/ non-free-firmware/! s/$/ non-free-firmware/
					/ non-free([[:space:]]|$)/! s/$/ non-free/
				}' "$file"
			fi
		done
}

install_chromium() {
	echo "Installing Chromium..."
	if apt-get install -y --no-install-recommends chromium; then
		return
	fi

	if apt-get install -y --no-install-recommends chromium-browser; then
		return
	fi

	echo "ERROR: Neither chromium nor chromium-browser is available from apt." >&2
	echo "Enable the Debian/Raspberry Pi OS main repository or install Chromium manually." >&2
	exit 1
}

node_major() {
	if ! command -v node &>/dev/null; then
		echo 0
		return
	fi
	node -e 'process.stdout.write(process.versions.node.split(".")[0])' 2>/dev/null || echo 0
}

install_nodejs() {
	local major
	major="$(node_major)"
	if [[ "$major" =~ ^[0-9]+$ ]] && (( major >= NODE_MIN_VERSION )); then
		echo "Node $(node --version) already installed"
		return
	fi

	echo "Installing Node.js..."
	if curl --connect-timeout 10 --retry 2 -fsSL "https://deb.nodesource.com/setup_${NODE_PREFERRED_VERSION}.x" | bash -; then
		apt-get install -y nodejs
	else
		echo "WARNING: NodeSource unavailable, falling back to distro nodejs/npm packages." >&2
		apt-get install -y nodejs npm
	fi

	major="$(node_major)"
	if ! [[ "$major" =~ ^[0-9]+$ ]] || (( major < NODE_MIN_VERSION )); then
		echo "ERROR: Node.js ${NODE_MIN_VERSION}+ is required; installed version is $(node --version 2>/dev/null || echo unavailable)." >&2
		echo "Fix DNS/network access or install Node.js ${NODE_MIN_VERSION}+ manually, then rerun this script." >&2
		exit 1
	fi
}

# ── 1. System packages ──────────────────────────────────────────────────────
echo "Installing system packages..."
configure_apt_sources
apt-get update -qq

# Core system utilities and dependencies
# - curl, gnupg, ca-certificates: for downloading packages
# - sudo: required by provisioner for service management
# - systemd, udev: system init and device management
# - network-manager: provides nmcli for WiFi/network configuration
# - git, rsync, jq: utility tools
apt-get install -y --no-install-recommends \
	curl gnupg ca-certificates \
	sudo systemd udev \
	network-manager \
	jq rsync git

# Wayland kiosk display
# - cage: fullscreen Wayland compositor for one kiosk app
# - seatd/dbus-user-session: session plumbing for wlroots/Chromium
# - chromium/chromium-browser: kiosk browser package name differs per distro
apt-get install -y --no-install-recommends \
	cage seatd dbus-user-session
install_chromium

# Media processing (for server mode)
# - ffmpeg: video transcoding for uploaded videos
# Note: Sharp (image processing) uses bundled libvips via npm
apt-get install -y --no-install-recommends \
	ffmpeg

# Ensure NetworkManager is enabled and running (critical for provisioner)
mkdir -p /etc/NetworkManager/conf.d
cat >/etc/NetworkManager/conf.d/pixelplein-ifupdown-managed.conf <<'EOF'
[ifupdown]
managed=true
EOF
cat >/etc/NetworkManager/conf.d/pixelplein-managed-devices.conf <<'EOF'
[keyfile]
unmanaged-devices=none
EOF
systemctl enable NetworkManager 2>/dev/null || true
systemctl enable seatd 2>/dev/null || true
# Do not restart NetworkManager here: on fresh installs the active SSH/DNS
# connection may still be owned by ifupdown. The config takes effect after the
# final reboot without disrupting the installation session.

# Raspberry Pi specific: GPU memory
if [[ $PLATFORM == "rpi" ]]; then
	if [[ -f /boot/firmware/config.txt ]] && ! grep -q '^gpu_mem=' /boot/firmware/config.txt; then
		echo 'gpu_mem=128' >>/boot/firmware/config.txt
		echo "Set GPU memory to 128MB in /boot/firmware/config.txt"
	fi
fi

# ── 2. Node.js ──────────────────────────────────────────────────────────────
install_nodejs
echo "Node $(node --version) / npm $(npm --version)"

# ── 3. pixelplein user + groups ────────────────────────────────────────────
echo "Creating $APP_USER user..."
USER_GROUPS="video,audio,plugdev,netdev,render"
if getent group seat >/dev/null; then
	USER_GROUPS="$USER_GROUPS,seat"
fi
if ! id "$APP_USER" &>/dev/null; then
	if [[ $PLATFORM == "rpi" ]]; then
		useradd -m -s /bin/bash -G "$USER_GROUPS,gpio,spi,i2c" "$APP_USER"
	else
		useradd -m -s /bin/bash -G "$USER_GROUPS" "$APP_USER"
	fi
else
	usermod -a -G "$USER_GROUPS" "$APP_USER" 2>/dev/null || true
fi

# ── 4. Console setup ────────────────────────────────────────────────────────
echo "Configuring console session..."
# The kiosk service owns tty1 directly. Remove the old X11 autologin drop-in
# if it exists from an earlier installer version.
rm -f /etc/systemd/system/getty@tty1.service.d/autologin.conf

# ── 5. Kiosk session setup ──────────────────────────────────────────────────
echo "Configuring Wayland kiosk session..."

# The kiosk is started by pixelplein-kiosk.service. Keep tty1 login quiet so
# systemd owns the fullscreen Cage/Wayland session instead of a shell profile.
cat >"/home/$APP_USER/.bash_profile" <<'EOF'
# PixelPlein kiosk is managed by systemd.
EOF
chown "$APP_USER:$APP_USER" "/home/$APP_USER/.bash_profile"

# ── 6. Install app ──────────────────────────────────────────────────────────
echo "Installing PixelPlein app to $APP_DIR..."
mkdir -p "$APP_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ -f "$REPO_ROOT/package.json" ]]; then
	echo "Copying app from $REPO_ROOT"
	rsync -a --exclude=node_modules --exclude='.git' --exclude='*.log' "$REPO_ROOT/" "$APP_DIR/"
else
	echo "WARNING: Could not find app source. Copy it manually to $APP_DIR." >&2
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

cd "$APP_DIR"
echo "Installing npm dependencies..."
sudo -u "$APP_USER" npm install --omit=dev --quiet

# ── 7. Config directory ─────────────────────────────────────────────────────
echo "Setting up configuration..."
mkdir -p /etc/pixelplein
if [[ ! -f /etc/pixelplein/server.env ]]; then
	cat >/etc/pixelplein/server.env <<'EOF'
PORT=3000
# PUBLIC_BASE_URL=https://example.com
EOF
fi

# ── 8. Systemd services ─────────────────────────────────────────────────────
echo "Installing systemd services..."
cp "$APP_DIR/tools/pixelplein-server.service" /etc/systemd/system/
cp "$APP_DIR/tools/pixelplein-agent.service" /etc/systemd/system/
cp "$APP_DIR/tools/pixelplein-kiosk.service" /etc/systemd/system/

# Migrate: disable and remove the old provisioner service name if present
if systemctl is-enabled pixelplein-provisioner &>/dev/null; then
	systemctl disable pixelplein-provisioner 2>/dev/null || true
fi
rm -f /etc/systemd/system/pixelplein-provisioner.service

systemctl daemon-reload
systemctl enable pixelplein-agent
systemctl enable pixelplein-kiosk
# Note: pixelplein-server is managed by agent based on config

# ── 9. Kiosk launch script ──────────────────────────────────────────────────
chmod +x "$APP_DIR/tools/pixelplein-kiosk.sh"

# ── 10. USB auto-configuration ──────────────────────────────────────────────
echo "Setting up USB auto-configuration..."
cp "$APP_DIR/tools/99-pixelplein-usb.rules" /etc/udev/rules.d/
cp "$APP_DIR/tools/pixelplein-usb-scan.sh" /usr/local/bin/
cp "$APP_DIR/tools/pixelplein-start.sh" /usr/local/bin/pixelplein-start
chmod +x /usr/local/bin/pixelplein-usb-scan.sh
chmod +x /usr/local/bin/pixelplein-start
udevadm control --reload-rules

# ── 11. sudoers ─────────────────────────────────────────────────────────────
cp "$APP_DIR/tools/sudoers.d/pixelplein" /etc/sudoers.d/
chmod 440 /etc/sudoers.d/pixelplein

# ── 12. Chromium policies ───────────────────────────────────────────────────
echo "Configuring Chromium..."
CHROMIUM_POLICIES=/etc/chromium/policies/managed
mkdir -p "$CHROMIUM_POLICIES"
cat >"$CHROMIUM_POLICIES/pixelplein.json" <<'EOF'
{
  "AutoplayAllowed": true,
  "AutoplayAllowlist": ["*"]
}
EOF

# ── 13. Optional: SSH hardening ─────────────────────────────────────────────
if [[ -f /etc/ssh/sshd_config ]]; then
	if ! grep -q 'PixelPlein security' /etc/ssh/sshd_config; then
		echo ""
		echo "Recommend SSH hardening (add to /etc/ssh/sshd_config):"
		echo "  PermitRootLogin no"
		echo "  PasswordAuthentication no  # if using keys"
		echo "  ClientAliveInterval 300"
		echo "  ClientAliveCountMax 2"
	fi
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PixelPlein Installation Complete ($PLATFORM)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo ""
echo "  1. Start services now:"
echo "     pixelplein-start"
echo ""
echo "  2. Configure via web UI:"
echo "     http://127.0.0.1:3987"
echo ""
echo "  3. Or insert USB stick with pixelplein-screen.json"
echo "     See tools/USB_CONFIG.md for config format"
echo ""
echo "  4. Reboot to auto-start kiosk:"
echo "     reboot"
echo ""
echo "Manual controls:"
echo "  Start helper:         pixelplein-start"
echo "  Start local server:   systemctl start pixelplein-server"
echo "  Restart kiosk:        systemctl restart pixelplein-kiosk"
echo "  View logs:            journalctl -u pixelplein-kiosk -f"
echo ""
