#!/bin/bash
# Deploy the current local working tree to an already-installed PixelPlein NUC.
#
# Normal installs/deploys should still use the public repository + tools/install.sh.
# This helper is for private event branches or uncommitted local changes that
# should not be pushed publicly.
set -euo pipefail

APP_DIR=/opt/pixelplein
APP_USER=pixelplein

INCLUDE_PHOTOS=0
INCLUDE_DATA=0
RESTART_KIOSK=0
RESTART_AGENT=0
ADMIN_REMOTE=""
REMOTE=""

usage() {
	cat <<'EOF'
Usage:
  tools/deploy-nuc.sh [options] user@host

Options:
  --photos          Also sync ./photos/ to /opt/pixelplein/photos/
  --data            Also sync ./data/ to /opt/pixelplein/data/
  --restart-kiosk   Restart pixelplein-kiosk after restarting the server
  --restart-agent   Restart pixelplein-agent (provisioner) after deploy
  --admin USER@HOST Update sudoers and systemd service files using a privileged user
  --app-dir DIR     Remote app directory (default: /opt/pixelplein)
  -h, --help        Show this help

Examples:
  tools/deploy-nuc.sh pixelplein@192.168.1.50
  tools/deploy-nuc.sh --photos pixelplein@192.168.1.50
  tools/deploy-nuc.sh --admin matthijs@192.168.1.50 --restart-agent pixelplein@192.168.1.50
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--photos)
			INCLUDE_PHOTOS=1
			shift
			;;
		--data)
			INCLUDE_DATA=1
			shift
			;;
		--restart-kiosk)
			RESTART_KIOSK=1
			shift
			;;
		--restart-agent)
			RESTART_AGENT=1
			shift
			;;
		--admin)
			ADMIN_REMOTE="${2:-}"
			if [[ -z "$ADMIN_REMOTE" ]]; then
				echo "ERROR: --admin requires a value" >&2
				exit 1
			fi
			shift 2
			;;
		--app-dir)
			APP_DIR="${2:-}"
			if [[ -z "$APP_DIR" ]]; then
				echo "ERROR: --app-dir requires a value" >&2
				exit 1
			fi
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		-*)
			echo "ERROR: Unknown option: $1" >&2
			usage >&2
			exit 1
			;;
		*)
			if [[ -n "$REMOTE" ]]; then
				echo "ERROR: Only one remote target may be provided" >&2
				exit 1
			fi
			REMOTE="$1"
			shift
			;;
	esac
done

if [[ -z "$REMOTE" ]]; then
	echo "ERROR: Missing remote target" >&2
	usage >&2
	exit 1
fi

REMOTE_USER="${REMOTE%@*}"
if [[ "$REMOTE" != *"@"* ]]; then
	echo "ERROR: Remote target must include a user, for example: $APP_USER@device-ip" >&2
	exit 1
fi

if [[ "$REMOTE_USER" != "$APP_USER" ]]; then
	echo "ERROR: Deploy target must be $APP_USER@host, got $REMOTE" >&2
	echo "" >&2
	echo "For a clean device, sync to the admin user's home and run the installer:" >&2
	echo "  rsync -az ./ $REMOTE:~/photodisplay/" >&2
	echo "  ssh -t $REMOTE 'cd ~/photodisplay && sudo bash tools/install.sh'" >&2
	echo "" >&2
	echo "After install, deploy updates with:" >&2
	echo "  tools/deploy-nuc.sh $APP_USER@${REMOTE#*@}" >&2
	exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
	echo "ERROR: rsync is required" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ ! -f "$REPO_ROOT/package.json" ]]; then
	echo "ERROR: Could not find package.json at $REPO_ROOT" >&2
	exit 1
fi

echo "Deploying current working tree to $REMOTE:$APP_DIR"
echo "  photos: $([[ $INCLUDE_PHOTOS -eq 1 ]] && echo yes || echo no)"
echo "  data:   $([[ $INCLUDE_DATA -eq 1 ]] && echo yes || echo no)"
echo ""

ssh "$REMOTE" "sudo mkdir -p '$APP_DIR' && sudo chown -R '$APP_USER:$APP_USER' '$APP_DIR'"

RSYNC_EXCLUDES=(
	--exclude '.git/'
	--exclude 'node_modules/'
	--exclude '*.log'
	--exclude 'cache/'
	--exclude 'cache-*'
	--exclude '.DS_Store'
)

if [[ $INCLUDE_PHOTOS -ne 1 ]]; then
	RSYNC_EXCLUDES+=(--exclude '/photos/')
fi

if [[ $INCLUDE_DATA -ne 1 ]]; then
	RSYNC_EXCLUDES+=(--exclude '/data/')
fi

rsync -azc --delete \
	"${RSYNC_EXCLUDES[@]}" \
	"$REPO_ROOT/" "$REMOTE:$APP_DIR/"

VERIFY_OUTPUT="$(rsync -azcn --delete --itemize-changes \
	"${RSYNC_EXCLUDES[@]}" \
	"$REPO_ROOT/" "$REMOTE:$APP_DIR/")"

if [[ -n "$VERIFY_OUTPUT" ]]; then
	echo "$VERIFY_OUTPUT" | sed -n '1,80p' >&2
	if [[ "$(echo "$VERIFY_OUTPUT" | wc -l | tr -d ' ')" -gt 80 ]]; then
		echo "... output truncated ..." >&2
	fi
	echo "ERROR: deploy verification failed; remote files still differ from local working tree" >&2
	exit 1
fi

if [[ -n "$ADMIN_REMOTE" ]]; then
	echo "Updating sudoers and service files via $ADMIN_REMOTE (may prompt for sudo password)..."
	scp "$REPO_ROOT/tools/sudoers.d/pixelplein" "$ADMIN_REMOTE:/tmp/pixelplein-sudoers"
	ssh -t "$ADMIN_REMOTE" "
		sudo cp /tmp/pixelplein-sudoers /etc/sudoers.d/pixelplein &&
		sudo chmod 440 /etc/sudoers.d/pixelplein &&
		sudo cp '$APP_DIR/tools/pixelplein-server.service' /etc/systemd/system/ &&
		sudo cp '$APP_DIR/tools/pixelplein-agent.service' /etc/systemd/system/ &&
		sudo cp '$APP_DIR/tools/pixelplein-kiosk.service' /etc/systemd/system/ &&
		sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target &&
		rm /tmp/pixelplein-sudoers
	"
fi

ssh "$REMOTE" "cd '$APP_DIR' && npm ci --omit=dev --quiet && sudo chown -R '$APP_USER:$APP_USER' '$APP_DIR' && sudo systemctl daemon-reload && sudo systemctl restart pixelplein-server"

if [[ $RESTART_AGENT -eq 1 ]]; then
	ssh "$REMOTE" "sudo systemctl restart pixelplein-agent"
fi

if [[ $RESTART_KIOSK -eq 1 ]]; then
	ssh "$REMOTE" "sudo systemctl restart pixelplein-kiosk"
fi

echo ""
echo "Deploy complete."
