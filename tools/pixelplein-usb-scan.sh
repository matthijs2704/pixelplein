#!/bin/bash
# Triggered by udev when a FAT/NTFS/exFAT USB partition appears.
# Waits for automount then asks the provisioner to scan for a config file.
sleep 3
curl -s -X POST http://127.0.0.1:3987/api/scan-usb
