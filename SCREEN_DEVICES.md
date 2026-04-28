# Screen Devices

PixelPlein separates logical screens from the physical or browser clients that
show them.

## Terms

- **Screen slot**: a logical output channel such as `Screen 1` or `Screen 2`.
  Screen slots own display configuration: playlist assignment, overlays, timing,
  layout settings, and photo-selection behavior.
- **Display**: a browser tab or kiosk Chromium instance showing
  `/screen?screen=<id>`.
- **Agent**: the local provisioner service on a managed Linux screen computer.
  Agents can restart the kiosk browser, reboot, and shut down the computer.
- **Device**: a paired identity known to the backend. A device can have a
  display connection, an agent connection, or both.

The admin UI groups devices by screen slot, but display and agent connections
are joined into one row only when they share the same `deviceId`.

## Why `screenId` Is Not Enough

Multiple displays may intentionally show the same screen slot:

```text
Screen 1
  Main hall NUC       Display online · Agent online
  Operator laptop     Display online · No agent
```

Both devices are attached to `Screen 1`, but only the NUC has a trusted agent.
Management commands must target the NUC's `deviceId`, not every device using
`screenId=1`. This prevents accidentally rebooting the wrong machine.

## Plain Browser Flow

Plain browsers do not need the provisioner.

1. Open `/screen?screen=1`.
2. If the browser has no token, it generates a local `deviceId` and requests
   pairing from the backend.
3. The screen shows a pairing code.
4. An admin approves the pending request under Settings -> Displays & Devices.
   The admin can change the screen assignment (e.g., requested screen 1 but
   approved as screen 2) using the dropdown before approval.
5. The browser receives a one-time token and the assigned `screenId`. If the
   `screenId` differs from the URL parameter, the browser automatically updates
   the URL and reloads (e.g., `/screen?screen=1` becomes `/screen?screen=2`).
6. After reload, the browser authenticates over WebSocket as a display with the
   correct screen identity.

Storage keys:

```text
pixelplein.screen.deviceId
pixelplein.screen.token
pixelplein.screen.pairingSecret
```

A plain browser is display-only. It cannot restart Chromium, reboot, or shut
down a computer.

## Managed Kiosk Flow

Managed kiosks run the provisioner service plus Chromium.

1. The provisioner reads `~/.config/pixelplein-screen/config.json`.
2. If `agent.deviceId` is missing, the provisioner generates one.
3. If `agent.token` is missing, the provisioner requests pairing from the
   backend and exposes the pairing code on its local setup page.
4. After admin approval (potentially with a different screen assignment), the
   provisioner polls the backend and receives a one-time token and assigned
   `screenId`.
5. If the `screenId` differs from the config file, the provisioner updates
   `config.json` and restarts the kiosk to load the correct screen URL.
6. The provisioner opens an outbound WebSocket to the backend as an agent.
7. `pixelplein-kiosk.sh` launches Chromium with the agent identity in the URL
   fragment:

```text
http://server:3000/screen?screen=1#deviceId=<id>&token=<token>
```

8. The screen page imports that identity into `localStorage`, removes the
   fragment from the visible URL, and authenticates as the same device.

The backend then sees one device row:

```text
Main hall NUC    Display online · Agent online
```

## Management Commands

Management commands are sent only to connected agents:

- restart kiosk
- reboot
- shutdown

The browser display never executes these commands. This avoids browser
localhost, CORS, private-network, and mixed-content issues.

Buttons in the admin UI are disabled when `agentConnected` is false.

## Editing Device Assignments

After a device is paired, its screen assignment and label can be changed without
revoking and re-pairing:

1. In Settings -> Displays & Devices, click **Edit** next to a paired device.
2. Change the screen number (1-N based on screen count) and/or label.
3. Save the changes.
4. The device will reconnect with the new assignment (usually within 30 seconds).

This is useful for reusing devices across different events or venues. For
example:

- **Event A**: Device "NUC-123" is assigned to Screen 2
- **Event B**: Edit Device "NUC-123" → assign to Screen 4

The device identity and token remain the same; only the screen slot changes.

**Note for managed kiosks**: When a screen assignment changes, the provisioner
detects the change on its next WebSocket reconnect and automatically restarts
the kiosk browser to load the correct URL (`?screen=N`).

## Multiple Displays

Multiple displays per screen slot are allowed. This is useful for mirrors,
backup laptops, or temporary previews.

The admin UI shows a warning when a screen slot has more than one online
display. This is informational; it does not block the setup.

## Stale Or Split Devices

A managed kiosk can appear split into two rows if Chromium was paired before the
provisioner identity-sharing flow existed:

```text
Screen 1
  Main hall NUC       Display offline · Agent online
  Old browser ID      Display online · No agent
```

Restarting the kiosk through the managed launch script should make Chromium
import the provisioner identity. After that, revoke the stale display-only
device from Settings -> Displays & Devices.

## Provisioner Config Shape

The managed device identity is stored in the local screen config:

```json
{
  "serverUrl": "http://192.168.1.10:3000",
  "screenId": "1",
  "deviceLabel": "Main hall NUC",
  "agent": {
    "deviceId": "generated-device-id",
    "token": "backend-issued-token"
  }
}
```

Do not manually copy one screen computer's `agent.deviceId` and token to another
machine. Each physical managed device needs its own identity.
