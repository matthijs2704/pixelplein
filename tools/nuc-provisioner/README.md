# PixelPlein NUC Provisioner

Small local setup service for Linux + Chromium screen NUCs.

It solves the bootstrapping problem before the screen knows the PixelPlein server URL:

- reads `pixelplein-screen.json` from a USB stick,
- optionally connects Wi-Fi through NetworkManager (`nmcli`),
- stores the local screen config,
- exposes a local setup page at `http://127.0.0.1:3987`,
- connects outbound to the PixelPlein backend as a managed device agent.

See [`../../SCREEN_DEVICES.md`](../../SCREEN_DEVICES.md) for the screen slot,
display, agent, and device identity model.

## USB file

Place this at the USB root as `pixelplein-screen.json`:

```json
{
  "version": 1,
  "serverUrl": "http://192.168.1.10:3000",
  "screenId": "1",
  "deviceLabel": "main hall left",
  "wifi": {
    "ssid": "Event WiFi",
    "password": "optional-password",
    "hidden": false
  },
  "kiosk": {
    "autostart": true
  }
}
```

`serverUrl` is required. `wifi` is optional.

The provisioner creates and stores its own `agent.deviceId` and token after
pairing. Do not put those values in the USB file unless you are intentionally
restoring the same physical device.

## Run locally

```bash
node tools/nuc-provisioner/server.js
```

Open `http://127.0.0.1:3987`.

## Pairing and kiosk launch

After provisioning, the agent requests pairing from the backend. Approve the
pending device in the admin under Settings -> Displays & Devices.

Once approved, `pixelplein-kiosk.sh` launches Chromium at:

```text
<serverUrl>/screen?screen=<screenId>#deviceId=<agent.deviceId>&token=<agent.token>
```

The URL fragment is imported by the screen page and removed from the visible URL.
This makes the browser display and provisioner agent share one backend device
row.

For production images, run this tool as `pixelplein-provisioner.service` and run
Chromium through `pixelplein-kiosk.service`.

## Management commands

The backend can send these fixed commands to a connected agent:

- restart kiosk
- reboot
- shutdown

The browser display does not execute management commands. Plain browser displays
can still pair and show a screen, but they have no agent and no OS management
controls.
