#!/bin/bash
# PixelPlein install script for Raspberry Pi
#
# NOTE: This script is deprecated. Use install.sh instead.
# The unified install.sh automatically detects Raspberry Pi and configures accordingly.
#
# Run: sudo bash install.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/install.sh"
