#!/bin/bash
# PixelPlein audio output selector
# Usage: pixelplein-audio.sh default|hdmi|analog|bluetooth [user]
set -euo pipefail

MODE="${1:-default}"
APP_USER="${2:-pixelplein}"
BT_DEVICE="${3:-}"
APP_UID="$(id -u "$APP_USER" 2>/dev/null || id -u)"
APP_RUNTIME_DIR="/tmp/pixelplein-runtime-${APP_UID}"

if [[ "$MODE" != "default" && "$MODE" != "hdmi" && "$MODE" != "analog" && "$MODE" != "bluetooth" ]]; then
	echo "Unsupported audio output: $MODE" >&2
	exit 2
fi

run_as_user() {
	if id "$APP_USER" >/dev/null 2>&1; then
		mkdir -p "$APP_RUNTIME_DIR"
		chown "$APP_USER:$APP_USER" "$APP_RUNTIME_DIR" 2>/dev/null || true
		chmod 700 "$APP_RUNTIME_DIR"
		runuser -u "$APP_USER" -- env XDG_RUNTIME_DIR="$APP_RUNTIME_DIR" "$@"
	else
		"$@"
	fi
}

match_regex() {
	case "$MODE" in
		hdmi) echo 'hdmi|displayport' ;;
		analog) echo 'analog|headphone|headphones|line[ -]?out|speaker' ;;
		bluetooth) echo 'bluez|bluetooth|a2dp' ;;
		*) echo '' ;;
	esac
}

is_bluetooth_address() {
	[[ "$1" =~ ^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$ ]]
}

prepare_bluetooth_audio() {
	[[ "$MODE" == "bluetooth" ]] || return 0
	command -v pactl >/dev/null 2>&1 || return 1

	if ! run_as_user pactl list short modules 2>/dev/null | awk '$2 == "module-bluetooth-policy" { found=1 } END { exit found ? 0 : 1 }'; then
		run_as_user pactl load-module module-bluetooth-policy >/dev/null 2>&1 || true
	fi
	if ! run_as_user pactl list short modules 2>/dev/null | awk '$2 == "module-bluetooth-discover" { found=1 } END { exit found ? 0 : 1 }'; then
		run_as_user pactl load-module module-bluetooth-discover >/dev/null 2>&1 || true
	fi
	if is_bluetooth_address "$BT_DEVICE" && command -v bluetoothctl >/dev/null 2>&1; then
		bluetoothctl trust "$BT_DEVICE" >/dev/null 2>&1 || true
		bluetoothctl connect "$BT_DEVICE" >/dev/null 2>&1 || true
		sleep 2
	fi
	if ! run_as_user pactl list short cards 2>/dev/null | awk '$2 ~ /^bluez_card[.]/ { found=1 } END { exit found ? 0 : 1 }'; then
		run_as_user pactl unload-module module-bluez5-discover >/dev/null 2>&1 || true
		run_as_user pactl unload-module module-bluetooth-discover >/dev/null 2>&1 || true
		run_as_user pactl load-module module-bluetooth-discover >/dev/null 2>&1 || true
		sleep 2
	fi
	run_as_user pactl list short cards 2>/dev/null |
		awk '$2 ~ /^bluez_card[.]/ { print $2 }' |
		while read -r card; do
			[[ -n "$card" ]] || continue
			# Toggle via 'off' first so a card already on a2dp_sink still re-acquires
			# the stream — needed when a multipoint speaker (e.g. JBL) handed playback
			# to another phone and our profile is "connected" but silent.
			run_as_user pactl set-card-profile "$card" off >/dev/null 2>&1 || true
			run_as_user pactl set-card-profile "$card" a2dp_sink >/dev/null 2>&1 ||
				run_as_user pactl set-card-profile "$card" headset_head_unit >/dev/null 2>&1 ||
				run_as_user pactl set-card-profile "$card" handsfree_head_unit >/dev/null 2>&1 ||
				true
		done
}

set_pulse_sink() {
	command -v pactl >/dev/null 2>&1 || return 1

	if ! run_as_user pactl info >/dev/null 2>&1; then
		if command -v pulseaudio >/dev/null 2>&1; then
			run_as_user pulseaudio --start >/dev/null 2>&1 || true
		fi
	fi
	prepare_bluetooth_audio

	local regex sink
	regex="$(match_regex)"

	# When a specific Bluetooth device is requested, target *its* sink by MAC
	# (bluez sink names embed the address as AA_BB_CC_DD_EE_FF). Without this we
	# pick the first bluez sink, which may be a different speaker.
	# ponytail: substring match, exact enough for bluez naming.
	if [[ "$MODE" == "bluetooth" ]] && is_bluetooth_address "$BT_DEVICE"; then
		local mac_us
		mac_us="${BT_DEVICE//:/_}"
		sink="$(
			run_as_user pactl list short sinks 2>/dev/null |
				awk -v mac="$mac_us" 'index(toupper($2), toupper(mac)) { print $2; exit }'
		)"
	fi

	[[ -n "$sink" ]] || sink="$(
		run_as_user pactl list sinks 2>/dev/null |
			awk -v mode="$MODE" -v regex="$regex" '
				/^Sink #/ { name=""; desc=""; ports=""; next }
				/^[[:space:]]*Name:/ { name=$2 }
				/^[[:space:]]*Description:/ { sub(/^[[:space:]]*Description:[[:space:]]*/, ""); desc=$0 }
				/^[[:space:]]*[A-Za-z0-9_.-]+: / { ports=ports " " $0 }
				/^[[:space:]]*Active Port:/ {
					text=tolower(name " " desc " " ports " " $0)
					if (text ~ regex && name != "") { print name; exit }
				}
			'
	)"

	if [[ -z "$sink" ]]; then
		sink="$(
			run_as_user pactl list short sinks 2>/dev/null |
				awk -v regex="$regex" 'BEGIN{IGNORECASE=1} $0 ~ regex { print $2; exit }'
		)"
	fi

	[[ -n "$sink" ]] || return 1
	run_as_user pactl set-default-sink "$sink"
	run_as_user pactl list short sink-inputs 2>/dev/null |
		awk '{print $1}' |
		while read -r input; do
			[[ -n "$input" ]] && run_as_user pactl move-sink-input "$input" "$sink" >/dev/null 2>&1 || true
		done
	echo "Pulse/PipeWire default sink set to $sink"
	return 0
}

set_rpi_amixer() {
	command -v amixer >/dev/null 2>&1 || return 1
	[[ -e /proc/device-tree/model ]] || return 1
	grep -qi 'raspberry pi' /proc/device-tree/model 2>/dev/null || return 1

	case "$MODE" in
		hdmi) amixer cset numid=3 2 >/dev/null 2>&1 || return 1 ;;
		analog) amixer cset numid=3 1 >/dev/null 2>&1 || return 1 ;;
		default) return 0 ;;
	esac
	echo "Raspberry Pi ALSA output set to $MODE"
	return 0
}

set_alsa_default() {
	command -v aplay >/dev/null 2>&1 || return 1

	if [[ "$MODE" == "default" ]]; then
		rm -f /etc/asound.conf
		echo "Removed PixelPlein ALSA default override"
		return 0
	fi

	local regex card device
	regex="$(match_regex)"
	read -r card device < <(
		aplay -l 2>/dev/null |
			awk -v regex="$regex" '
				BEGIN{IGNORECASE=1}
				/^card [0-9]+:/ {
					line=$0
					if (line ~ regex) {
						sub(/^card /, "", line)
						card=line
						sub(/:.*/, "", card)
						device=line
						sub(/^.*device /, "", device)
						sub(/:.*/, "", device)
						print card, device
						exit
					}
				}
			'
	)

	[[ -n "${card:-}" && -n "${device:-}" ]] || return 1
	cat >/etc/asound.conf <<EOF
pcm.!default {
  type plug
  slave.pcm "hw:${card},${device}"
}

ctl.!default {
  type hw
  card ${card}
}
EOF
	echo "ALSA default output set to card $card device $device"
	return 0
}

if [[ "$MODE" == "default" ]]; then
	set_alsa_default
	exit 0
fi

if set_pulse_sink; then
	exit 0
fi

if set_rpi_amixer; then
	exit 0
fi

if set_alsa_default; then
	exit 0
fi

if [[ "$MODE" == "bluetooth" ]] && is_bluetooth_address "$BT_DEVICE" && command -v bluetoothctl >/dev/null 2>&1; then
	if bluetoothctl devices Connected 2>/dev/null | grep -qi "$BT_DEVICE"; then
		echo "Bluetooth device $BT_DEVICE is connected; PulseAudio sink was not visible in this runtime"
		exit 0
	fi
fi

if [[ "$MODE" == "bluetooth" ]] && command -v pactl >/dev/null 2>&1; then
	echo "PulseAudio modules:" >&2
	run_as_user pactl list short modules >&2 2>/dev/null || true
	echo "PulseAudio cards:" >&2
	run_as_user pactl list short cards >&2 2>/dev/null || true
	echo "PulseAudio sinks:" >&2
	run_as_user pactl list short sinks >&2 2>/dev/null || true
	echo "BlueZ connected devices:" >&2
	bluetoothctl devices Connected >&2 2>/dev/null || true
fi

echo "Could not find a matching $MODE audio output" >&2
exit 1
