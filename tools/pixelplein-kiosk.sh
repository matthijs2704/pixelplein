#!/bin/bash
# PixelPlein Kiosk Launch Script
# Launches Chromium in kiosk mode with auto-restart
# Reads config from ~/.config/pixelplein-screen/config.json
set -euo pipefail

readonly CONFIG_FILE="$HOME/.config/pixelplein-screen/config.json"
readonly DEFAULT_URL="http://127.0.0.1:3987"
readonly LOG_TAG="pixelplein-kiosk"
readonly DEFAULT_CHROMIUM_EXTRA_FLAGS="--no-sandbox --enable-logging=stderr --log-level=0 --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy"
readonly KIOSK_BACKEND="${PIXELPLEIN_KIOSK_BACKEND:-wayland}"

# Logging helpers (uses systemd journal when available)
log_info() {
	local msg="[$LOG_TAG] $*"
	echo "$msg" >&2
	if command -v systemd-cat &>/dev/null; then
		printf '%s\n' "$msg" | systemd-cat -t "$LOG_TAG" -p info
	fi
}

log_error() {
	local msg="[$LOG_TAG] ERROR: $*"
	echo "$msg" >&2
	if command -v systemd-cat &>/dev/null; then
		printf '%s\n' "$msg" | systemd-cat -t "$LOG_TAG" -p err
	fi
}

# Build URL from config file
build_url() {
	local url=""

	if [[ ! -f "$CONFIG_FILE" ]]; then
		log_info "No config file found at $CONFIG_FILE, using default URL"
		echo "$DEFAULT_URL"
		return
	fi

	# Use Node.js to safely parse JSON and build URL
	url=$(node -e "
    try {
      const fs = require('fs');
      const c = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
      
      // When local server is enabled: prefer publicBaseUrl, else loopback
      const localEnabled = c.localServer && c.localServer.enabled;
      const serverUrl = localEnabled
        ? (c.localServer.publicBaseUrl || 'http://localhost:3000')
        : (c.serverUrl || '');
      if (!serverUrl) {
        console.log('$DEFAULT_URL');
        process.exit(0);
      }

      if (c.customUrl) { console.log(c.customUrl); process.exit(0); }

      const screenId = c.screenId || '1';
      let url = serverUrl + '/screen?screen=' + encodeURIComponent(screenId);
      
      // Add agent credentials to URL fragment if available
      const agent = c.agent || {};
      if (agent.deviceId && agent.token) {
        url += '#deviceId=' + encodeURIComponent(agent.deviceId) + 
               '&token=' + encodeURIComponent(agent.token);
      }
      
      console.log(url);
    } catch (err) {
      console.error('Config parse error:', err.message);
      console.log('$DEFAULT_URL');
    }
  " 2>&1)

	# Fallback to default if Node.js failed
	if [[ -z "$url" ]] || [[ "$url" == *"Error"* ]]; then
		log_error "Failed to parse config, using default URL"
		echo "$DEFAULT_URL"
	else
		echo "$url"
	fi
}

# Find Chromium binary (different package names on different distros)
find_chromium() {
	local candidate

	# ponytail: snap stubs are shell scripts containing the word "snap"; skip them
	for candidate in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome-stable /usr/bin/google-chrome; do
		if [[ -x "$candidate" ]] && ! grep -q snap "$candidate" 2>/dev/null; then
			echo "$candidate"
			return 0
		fi
	done

	if command -v google-chrome-stable &>/dev/null; then
		command -v google-chrome-stable
	elif command -v chromium &>/dev/null; then
		command -v chromium
	else
		log_error "Chromium not found in PATH"
		return 1
	fi
}

launch_cage_if_needed() {
	if [[ "$KIOSK_BACKEND" != "wayland" || -n "${WAYLAND_DISPLAY:-}" ]]; then
		return
	fi

	if ! command -v cage &>/dev/null; then
		log_error "Cage not found; install the cage package or set PIXELPLEIN_KIOSK_BACKEND=x11"
		exit 1
	fi

	if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
		export XDG_RUNTIME_DIR="/tmp/pixelplein-runtime-$(id -u)"
	fi
	mkdir -p "$XDG_RUNTIME_DIR"
	chmod 700 "$XDG_RUNTIME_DIR"

	log_info "Starting Wayland kiosk session with Cage"
	local cage_status=0
	if command -v dbus-run-session &>/dev/null; then
		dbus-run-session -- cage -s -- "$0"
		cage_status=$?
	else
		cage -s -- "$0"
		cage_status=$?
	fi
	log_error "Cage exited with status $cage_status"
	exit "$cage_status"
}

wait_for_x() {
	local display="${DISPLAY:-:0}"
	local display_num="${display#:}"
	display_num="${display_num%%.*}"
	local socket="/tmp/.X11-unix/X${display_num}"
	local waited=0

	while [[ ! -S "$socket" ]]; do
		if (( waited == 0 )); then
			log_info "Waiting for X display ${display} (${socket})"
		fi
		sleep 2
		waited=$((waited + 2))
		if (( waited % 30 == 0 )); then
			log_info "Still waiting for X display ${display}; check auto-login/startx if this continues"
		fi
	done

	if [[ -n "${XAUTHORITY:-}" ]]; then
		while [[ ! -f "$XAUTHORITY" ]]; do
			log_info "Waiting for Xauthority file $XAUTHORITY"
			sleep 2
		done
	fi
}

ensure_audio() {
	if ! command -v pulseaudio &>/dev/null; then
		return
	fi

	if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
		export XDG_RUNTIME_DIR="/tmp/pixelplein-runtime-$(id -u)"
		mkdir -p "$XDG_RUNTIME_DIR"
		chmod 700 "$XDG_RUNTIME_DIR"
	fi

	if command -v pactl &>/dev/null && pactl info >/dev/null 2>&1; then
		log_info "Audio server already available"
		return
	fi

	if pulseaudio --start >/dev/null 2>&1; then
		log_info "Started PulseAudio for kiosk session"
	else
		log_error "Could not start PulseAudio; browser audio may be unavailable"
	fi
}

# Main loop
main() {
	local chromium_bin

	log_info "Starting kiosk shell"
	log_info "Backend=$KIOSK_BACKEND DISPLAY=${DISPLAY:-unset} WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-unset} PATH=$PATH"

	launch_cage_if_needed
	if ! chromium_bin=$(find_chromium); then
		log_error "Unable to resolve a Chromium binary"
		exit 1
	fi

	log_info "Starting kiosk loop"
	log_info "Chromium binary: $chromium_bin"
	ensure_audio
	if [[ "$KIOSK_BACKEND" == "x11" ]]; then
		wait_for_x
	fi

	local restart_count=0
	local url
	local extra_flags
	local chromium_backend_flags=()
	extra_flags="${CHROMIUM_EXTRA_FLAGS:-$DEFAULT_CHROMIUM_EXTRA_FLAGS}"
	read -r -a extra_flag_args <<<"$extra_flags"
	if [[ "$KIOSK_BACKEND" == "wayland" ]]; then
		chromium_backend_flags=(
			--ozone-platform=wayland
			--enable-features=UseOzonePlatform
		)
	fi

	while true; do
		# Rebuild URL each iteration (config may change)
		url=$(build_url)
		log_info "Launching Chromium with URL: ${url%%#*}" # Log without credentials

		# Launch Chromium in kiosk mode
		set +e
		# ponytail: no pipe — a pipe subshell blocks TERM from exiting until chromium closes stdout
		"$chromium_bin" \
			--kiosk \
			--noerrdialogs \
			--disable-infobars \
			--disable-session-crashed-bubble \
			--disable-restore-session-state \
			--disable-component-update \
			--disable-translate \
			--no-first-run \
			--check-for-update-interval=31536000 \
			--autoplay-policy=no-user-gesture-required \
			--use-fake-ui-for-media-stream \
			--disable-features=TranslateUI,Translate \
			--disable-breakpad \
			"${chromium_backend_flags[@]}" \
			"${extra_flag_args[@]}" \
			"$url" >>/tmp/pixelplein-chrome.log 2>&1
		local chromium_status=$?
		set -e

		# Chromium exited (crash or manual kill)
		restart_count=$((restart_count + 1))
		log_info "Chromium exited with status $chromium_status (restart #$restart_count), restarting in 2 seconds..."
		sleep 2
	done
}

# Trap signals for clean logging
trap 'log_info "Received shutdown signal, exiting"; exit 0' TERM INT

# Run main loop
main
