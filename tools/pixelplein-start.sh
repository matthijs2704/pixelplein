#!/bin/bash
# Start PixelPlein screen services after install.
set -euo pipefail

APP_USER=pixelplein
PROVISIONER_URL=http://127.0.0.1:3987

if [[ $EUID -ne 0 ]]; then
	echo "ERROR: Run as root: sudo pixelplein-start" >&2
	exit 1
fi

echo "Starting PixelPlein services..."
systemctl daemon-reload
systemctl start pixelplein-provisioner
systemctl start pixelplein-kiosk

echo ""
echo "Service status:"
systemctl --no-pager --lines=0 status pixelplein-provisioner pixelplein-kiosk || true

echo ""
if [[ -S /tmp/.X11-unix/X0 ]]; then
	echo "X display is running on :0. Kiosk should launch shortly."
else
	echo "X display :0 is not running yet."
	echo "On a fresh install, reboot once so auto-login starts the X/Openbox session:"
	echo "  sudo reboot"
	echo ""
	echo "If you are at the physical console, logging in as ${APP_USER} on tty1 also starts X."
fi

echo ""
echo "Provisioner:"
echo "  ${PROVISIONER_URL}"
echo ""
echo "Logs:"
echo "  journalctl -u pixelplein-provisioner -f"
echo "  journalctl -u pixelplein-kiosk -f"
