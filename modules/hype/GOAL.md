# De Hype — module goal

## In one line
A camp photo display dressed up as a big, mainstream social-media platform
called **De Hype**, with a week-long hidden storyline (the "Harry Ecker" hack)
running underneath it.

## The core idea
The screens in the camp hall mostly do one job all week: **show the photos taken
during camp**, but presented as if they're posts on a real social network. It
should read like opening TikTok/Instagram — not like a slideshow, and not like a
"camp app". De Hype is a fictional *general* platform that just happens to be
where these photos live.

Two things sit on top of that resting state:
1. **A dashboard** the operators can switch to during theme moments, showing how
   the platform / its creators are doing (the follower race).
2. **A storyline** that makes the platform slowly misbehave across the week and
   culminates in a grand finale night game.

## Look & feel
Brand defined in the De Hype style guide and the exported design tokens
(`/Downloads/tokens/*.css`, mirrored into `public/screen/style.css`):
- Near-black background (`#0B0D12`), **yellow** (`#F5D904`) + **hot-pink**
  (`#F52368`) accents, marker/graffiti energy.
- **Bebas Neue** display headlines, **DM Sans** body/UI.
- Six creator channels, each its own brand colour.

Keep the familiar PixelPlein photo layouts (fullscreen, mosaic, polaroid,
side-by-side, featured-duo, hero/uniform templates) — just **re-skinned** to the
De Hype look so it feels familiar — and add a few extra social-media-style
layouts (post card, story, reels) for flavour.

## The accounts
- **Scouting Ridder Fulco** `@scoutingridderfulco` (blue) — the general account
  that posts most photos.
- Five creator channels (kids help make their content during the week):
  - **Wild van Fred** `@dustywild` — green — nature/animals (Freek Vonk vibe)
  - **Jochem Kookt** `@jochemkookt` — orange — cooking
  - **CJ Plays** `@cjplays` — purple — gaming duo
  - **Roos Beauty** `@roosbeauty` — magenta — beauty
  - **FitDuo F&S** `@fitduofs` — teal — fitness duo

Photos are either tagged to a creator channel or posted by the general account.

## Screen states
The module owns a set of full-screen states; the resting one is the photo feed.

| State | Trigger | Look |
|---|---|---|
| **Photo feed** (resting) | default | themed PixelPlein layouts + social layouts |
| **Dashboard** | operator summons | follower race + spotlight-of-the-day |
| **Glitch** | auto, scaled by intensity | transient overlay, returns to feed |
| **Hacker** | auto/manual | Harry Ecker terminal takeover, transient |
| **Down / offline** | manual (Thursday) | **full takeover in the module**, stays until restart |
| **Restart / boot** | **Arduino** (HTTP) | boot animation → back to feed |
| **Launch** (optional) | day 1 | celebratory "DeHype gaat live" reveal |

## The follower mechanic
Each camp day, **one or two creators are "in de spotlight"** — the kids make
content for them, so those channels surge hardest that day; the others still
drift up. Everything generally climbs over the week. The dashboard's job is to
show **who's spotlighted today + the live race**. (A creator may briefly dip if
Harry targets them — TBD, design tolerates a downward arrow.)

## The storyline (the only real plot)
A superfan, **Harry Ecker**, is obsessed with one creator (which one: TBD). Over
the week he escalates — digging for that influencer's personal info — and the
platform **misbehaves more and more** (glitches, creepy chat). On **Thursday** he
accidentally takes the whole platform **down**, kicking off the night game
(grand finale):
1. The kids find Harry in real life and ask what he did; he apologises.
2. The platform is still offline — so the kids go to "the servers" and
   **restart** it (via the Arduino), bringing De Hype back online.

Nothing hard-ends at the finale — afterwards the platform just keeps being a
photo display, so the theme can comfortably stretch to Friday.

## Intensity control ("Harry heat", 0–5)
Glitches fire **automatically**, scaled by a single operator-controlled dial so
leaders don't have to babysit it:
- **0** — clean, no interference (Sat–Sun)
- **1–2** — rare subtle glitches, occasional creepy Harry chat (Mon–Tue)
- **3–4** — frequent glitches, Harry openly fishing for info (Wed–Thu)
- **5** — breaking point → operator triggers the **Down** state (Thursday)

A dial (not a hard calendar) so rehearsals and an extended Friday just work.

## Hard constraints
- **"Niet te veel werk voor ons tussen door."** The engine runs autonomously
  most of the day; leaders only press buttons at plot moments.
- The **server restart is physical**: a repurposed Arduino POSTs to a tokened
  endpoint to fire the restart/boot animation — the kids "fix the servers" for real.

## Build status
**Done**
- Module enabled; brand tokens (palette, Bebas Neue + DM Sans) applied to the
  screen styles; channel palette + general account aligned to the style guide.
- Existing engine (auto-likes/comments, ambient chat incl. Harry), lifecycle
  (pre-launch → launch → live → power-off → restart), glitch/hacker triggers,
  follower pulse, admin tab.

**Next (the "complete" revision, in slices)**
1. Split the resting state into **themed photo feed** vs **summoned dashboard**
   (today they're crammed into one `social-only` takeover).
2. Re-skin the core PixelPlein layouts to De Hype; finish the social post-card
   (reaction bar: vind-ik-hype / reacties / hype / deel) to match the mockup.
3. Rebuild the **dashboard** around spotlight-of-the-day + animated follower race.
4. **"Harry heat" intensity dial** driving auto-glitch frequency/severity.
5. **Down state as a real module takeover**; **tokened HTTP restart endpoint**
   for the Arduino + boot animation.
6. Wire **featured-of-the-day** into the follower engine (uses `featured_days`).
