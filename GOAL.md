# PixelPlein — Goal

Build an event-ready photo wall system that feels alive, polished, and reliable on two side-by-side screens.

## Primary outcome

Show newly taken event photos in near real time with a visually engaging mix of fullscreen, side-by-side, and dynamic mosaic layouts, while minimizing duplicates between screens.

## Product goals

- Run two coordinated screens (`screen=1` and `screen=2`) at an event venue.
- Keep visuals exciting: non-uniform mosaics, in-layout swaps, and smooth transitions.
- Keep storytelling coherent by grouping photos by folder-based event groups (for example: `ceremony`, `speeches`, `dancefloor`).
- Prefer smart composition: place photos into slots based on aspect ratio so layouts look intentional.
- Avoid showing the same photos on both screens at the same time whenever possible.
- Stay robust under live upload bursts (watch folder, cache display images, recover from disconnects).
- Provide an operator-friendly admin UI with clear live health and understandable controls.

## Operational goals

- Be easy to run on event day with minimal technical intervention.
- Surface clear health signals (screen online status, queue depth, cache readiness, failures).
- Support quick style tuning during the event without restarts.

## Experience goals

- Blend cinematic moments (hero images) with live-feed energy (frequent mosaic updates).
- Keep both screens complementary, not mirrored.
- Ensure photos generally fill slots appropriately, with exceptions for extreme portrait cases where readability is better with contain.
