#!/bin/bash
# PixelPlein Kiosk Launch Script
# Launches Chromium in kiosk mode with auto-restart
# Reads config from ~/.config/pixelplein-screen/config.json
set -euo pipefail

readonly CONFIG_FILE="$HOME/.config/pixelplein-screen/config.json"
readonly DEFAULT_URL="http://127.0.0.1:3987"
readonly LOG_TAG="pixelplein-kiosk"
readonly DEFAULT_CHROMIUM_EXTRA_FLAGS="--disable-gpu-compositing --disable-gpu-rasterization --disable-zero-copy"

# Logging helpers (uses systemd journal when available)
log_info() {
	echo "[$LOG_TAG] $*" >&2
}

log_error() {
	echo "[$LOG_TAG] ERROR: $*" >&2
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
      
      // Build base URL
      const serverUrl = c.serverUrl || '';
      if (!serverUrl) {
        console.log('$DEFAULT_URL');
        process.exit(0);
      }
      
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
	if command -v chromium-browser &>/dev/null; then
		echo "chromium-browser"
	elif command -v chromium &>/dev/null; then
		echo "chromium"
	else
		log_error "Chromium not found in PATH"
		return 1
	fi
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

# Main loop
main() {
	local chromium_bin
	chromium_bin=$(find_chromium)

	log_info "Starting kiosk loop"
	log_info "Chromium binary: $chromium_bin"
	log_info "DISPLAY=${DISPLAY:-unset}"
	wait_for_x

	local restart_count=0
	local url
	local extra_flags
	# Older Intel iGPUs, including Haswell NUCs, can show black frames during
	# opacity transitions when Chromium uses GPU compositing/zero-copy. Keep
	# conservative defaults, but allow installs to override via systemd env.
	extra_flags="${CHROMIUM_EXTRA_FLAGS:-$DEFAULT_CHROMIUM_EXTRA_FLAGS}"
	read -r -a extra_flag_args <<<"$extra_flags"

	while true; do
		# Rebuild URL each iteration (config may change)
		url=$(build_url)
		log_info "Launching Chromium with URL: ${url%%#*}" # Log without credentials

		# Launch Chromium in kiosk mode
		"$chromium_bin" \
			--kiosk \
			--noerrdialogs \
			--disable-infobars \
			--disable-session-crashed-bubble \
			--disable-restore-session-state \
			--disable-component-update \
			--no-first-run \
			--check-for-update-interval=31536000 \
			--autoplay-policy=no-user-gesture-required \
			--disable-features=TranslateUI \
			--disable-breakpad \
			"${extra_flag_args[@]}" \
			"$url" 2>&1 | while IFS= read -r line; do
			# Only log errors and important messages
			if [[ "$line" =~ (ERROR|FATAL|Failed) ]]; then
				log_error "$line"
			fi
		done

		# Chromium exited (crash or manual kill)
		restart_count=$((restart_count + 1))
		log_info "Chromium exited (restart #$restart_count), restarting in 2 seconds..."
		sleep 2
	done
}

# Trap signals for clean logging
trap 'log_info "Received shutdown signal, exiting"; exit 0' TERM INT

# Run main loop
main
