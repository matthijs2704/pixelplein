# event signage roadmap

This document captures the implementation plan we agreed on for turning PixelPlein into a flexible event-focused digital signage replacement.

## goals

- Add a flexible alert system with banner, popup, and countdown modes.
- Support manual alerts, scheduled alerts, and auto-generated alerts from an event schedule.
- Add attendee submissions via QR-code web form.
- Add admin moderation queue (approve/reject).
- Support approved submissions in display rotation with social-wall style visuals.
- Keep operation simple for event-day staff.

## scope decisions

- Submission channel: web form via QR code.
- Submission fields: photo, message/caption, configurable submitter field label (for example: `Subcamp`).
- Fun facts / did-you-know content: use existing slides system.
- Moderation UI: separate admin tab with queue.
- Social wall: both single-item and multi-tile styles.

## phased implementation todo

### phase 1 — foundation

- [x] Extend config schema for alerts, schedule, and submission settings.
- [x] Add server-side alert + schedule storage helpers.
- [x] Add server-side submission storage/model helpers.
- [x] Add API routes for alerts, schedule, and submissions.
- [x] Wire new feature routers in `server/index.js`.

### phase 2 — realtime + runtime behavior

- [x] Add WebSocket broadcasts for alert fire/dismiss and submission updates.
- [x] Add schedule runner to trigger timed alerts and pre-event reminders.
- [x] Add screen-side alert renderer (banner / popup / countdown).
- [x] Add public submission page (`/submit`) and endpoint integration.

### phase 3 — admin UX

- [x] Add Alerts admin page for manual + scheduled alerts and event schedule management.
- [x] Add Submissions admin page for moderation queue and history.
- [x] Add submission settings controls (enable toggle, label text, photo requirement).
- [x] Show pending moderation count in admin navigation.

### phase 4 — social wall visuals

- [x] Add single-submission social wall mode (polaroid-inspired overlay).
- [x] Add multi-tile social wall mode.
- [x] Add display mode/config integration.
- [x] Ensure graceful fallback when few submissions are approved.

### phase 5 — hardening

- [ ] Add basic public submission rate limiting.
- [ ] Validate and sanitize all alert/submission payloads.
- [ ] Add manual verification checklist for event-day testing.
- [ ] Update docs with operator workflow.

## manual acceptance checklist

- [ ] Admin can create and fire banner alerts instantly.
- [ ] Scheduled alert appears at the configured time.
- [ ] Countdown alert shows live remaining time.
- [ ] Attendee can submit photo + message from phone.
- [ ] Submission lands in pending queue without auto-publishing.
- [ ] Admin approve/reject updates screen behavior in real time.
- [ ] Approved submission appears in social-wall style rotation.
