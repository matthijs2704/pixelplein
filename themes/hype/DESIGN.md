# De Hype — design reference

Het visuele systeem van De Hype zoals gebruikt in het thema, de reboot-console
(10.1" tablet), de big-screen takeovers (launch/offline/restart/glitch) en de
game mirror. Gebruik dit als referentie voor nieuwe elementen zodat alles één
geheel blijft.

---

## 1. Kleuren

### Merk-palet
| Token | Hex | Gebruik |
|---|---|---|
| `--hype-yellow` / `--y` | `#f5d904` | Primair accent. Gele knop/speler (links), aandacht, charge |
| `--hype-accent` / `--r` | `#f52368` | Hot pink. Rode knop/speler (rechts), energie, danger-pills |
| `--hype-blue` / `--b` | `#00b2ff` | Data, sync, packets, info, ringen |
| `--g` | `#32d74b` | Succes, ONLINE, checks geslaagd, boot-groen (screens) |
| `--t` | `#27d6c6` | Teal secundair (lampjes, boot-bar-gradient) |
| `--o` | `#ff8a00` | Spanning, RPM/fans, warm accent |
| CRT-groen | `#4dff70` | Terminal boot-tekst (alleen in terminals) |
| Alarm-rood | `#ff5860` / `#ff3b30` | Offline/error koppen, LIVE-dot |

### Ondergronden
| Token | Waarde | Gebruik |
|---|---|---|
| `--hype-bg` | `#0b0d12` (thema) / `#07080c` (console) | Near-black basis |
| `--hype-surface` | `#15181f` / `rgba(14,17,24,0.92)` | Kaart-ondergrond |
| Kaart-gradient | `linear-gradient(180deg, rgba(20,24,33,.96), rgba(11,13,18,.96))` | Game-cards |
| `--border` | `rgba(255,255,255,0.09–0.12)` | 1px randen |
| `--muted` | `rgba(255,255,255,0.46)` | Secundaire tekst (kinder-UI: liever 0.8–0.9 + bold) |

### Merk-gradient
`linear-gradient(100deg, #f5d904 0%, #f52368 100%)` — geel→pink, altijd in deze
richting. Gebruik: kaart-topranden (5–7px strip), nummer-badges, logo-tekst-clip.

### Kleur-semantiek (consequent volhouden)
- **Geel = links / gele knop / opladen / let op**
- **Pink = rechts / rode knop / merk-energie**
- **Blauw = data, verbinding, sync, neutrale voortgang**
- **Groen = gelukt, online, boot**
- **Rood(alarm) = offline, storing, Harry**
- **Oranje = spanning, oplopende druk**

Zelfde mapping geldt voor de LED-strip en PAR-lampen (CRGB(245,217,4) /
(245,35,104) / (0,178,255)).

## 2. Typografie

| Rol | Font | Regels |
|---|---|---|
| Display | **Bebas Neue** (`--display` / `--hype-display`) | ALTIJD CAPS, letter-spacing 1–6px, line-height 0.88–1.05. Voor titels, callouts, cijfers, pills |
| Body/UI | **DM Sans** (`--body`) | Gewichten 700/800/900 voor UI-labels; kinder-instructies minimaal 700 |
| Tech/terminal | Courier New / JetBrains Mono | Crashlogs, bootlogs, checklist-chips, err-codes |

Logo-lockup: `de` (DM Sans 900, lowercase, geel, klein) + `HYPE` (Bebas, wit) +
`!` (Bebas, geel). Nooit andere kleurverdeling.

Maten op 10" tablet: instructietekst `clamp(20px,3vw,32px)` bold; display-titels
`clamp(34px,6vw,68px)`; grote cijfers/countdown `clamp(90px,16vw,190px)`.
Big screen: alles een slag groter (`clamp(48px,7vw,120px)` titels).

## 3. Achtergrond-stack (vaste laagvolgorde)

Elke fullscreen-view bouwt dezelfde sandwich, van achter naar voor:
1. **Base** — near-black vlak
2. **Glow** — radiale gloed bovenin, kleur = state (rood offline, geel actief,
   oranje spanning, groen boot, geel-breed celebratie)
3. **Grid** — perspectief-vloer: 64–72px wit 5%-lijnen,
   `perspective(900px) rotateX(56deg) translateY(20%)`, opacity ~0.26–0.32.
   NIET animeren (repaint te duur op oude tablets)
4. **Scanlines** — `repeating-linear-gradient` 1px/4px, opacity ~0.18, blend overlay
5. **Vignette** — radiaal naar `rgba(0,0,0,0.82+)` op de randen
6. **Paint stripes** — geel boven (~12–16vh), pink onder (~84–90vh);
   clip-path parallellogram (14% schuine kant), rotate ∓2deg.
   Verschijnen pas NA de sleutel (niet op idle), entrance = translateX van
   buiten beeld, daarna trage drift (±2.5% translateX, 7–8.5s ease-in-out, via
   transform — GPU-goedkoop)

## 4. Kaarten (game-card patroon)

```
positie relative + overflow hidden
breedte: min(1000–1500px, 92–96vw)
achtergrond: kaart-gradient (zie boven)
rand: 1px rgba(255,255,255,0.12), radius 14–18px
schaduw: 0 24px 70px rgba(0,0,0,0.55) + inset 0 1px 0 rgba(255,255,255,0.06)
::before topstrip: 5–7px merk-gradient
```
Alle spel/instructie-content staat op zo'n kaart zodat tekst leesbaar blijft
over de paint stripes.

## 5. Componenten-vocabulaire

- **Checklist-chips**: pill, Courier, dot links. States: dim (todo) →
  geel + pulse (actief) → groen + glow-dot (done). Zelfde chips op tablet en
  big screen.
- **Step-cards** (uitleg): rij van max 3, elk met gradient-nummerbadge (rond,
  Bebas, donkere tekst) + korte Bebas-regel. Kleurwoorden inline:
  `<b class="y/cy">GEEL</b>` / `<b class="r/cr">ROOD</b>`.
- **Start-bar pills**: afgeronde pills met icoon + Bebas-tekst; actief = wit +
  blauwe rand + glow + pulse; klaar = groen + ` ✓` suffix.
- **Voortgangsbalken**: radius 999px, donkere track met 1px rand, gradient-fill
  in spelerskleur(en) met glow-shadow, `transition: width 0.12s linear`.
- **Lampen** (voortgang per treffer): cirkels, dim → kleur + glow + slam-in.
- **Prompt-pill** (actie NU): Bebas op gekleurd vlak met zware glow;
  pink/rood = doe iets ("⚡ LOSLATEN!"), donkerder rood = fout-toestand
  ("🔥 OVERBELAST!"), groen = geslaagd ("✓ CHECK GESLAAGD!").
- **Countdown-cijfer**: gigantisch Bebas-geel met glow, slam per tik.
- **Terminal** (boot/hacker): monospace op donkergroene/zwarte kaart; regels met
  gekleurde linkerrand (groen ok / geel special / rood err), status rechts,
  knipperende cursor, voortgangsbalk groen→teal.

## 6. Bewegings-vocabulaire

| Naam | Gedrag | Gebruik |
|---|---|---|
| `slam` | scale 1.28–1.35 → 0.97 → 1, ~0.4–0.8s | Binnenkomers met impact (titels, lampen, cijfers) |
| `reveal` | fade + 14px omhoog | Zachte binnenkomers |
| `pulse` | scale 1↔1.06–1.09 loop | "Kijk hier / actief" |
| `blink` | opacity 1↔0.15 | LIVE-dots, wachtstanden |
| flash-pop | wit vlak 0.55–0.62 → 0, ~0.45s | Beat-punch, transitie |
| colour-flash | fullscreen merkkleur, `mix-blend: screen`, pop | Audio-beats |
| shake (s/m/l) | translate ±3/±8/±14px + lichte rotate | Hits, surges; 3 gradaties |
| glitch-blip | translateX + skew + RGB-textshadow split, steps(2) | Kapotte/hacker-sfeer |
| confetti | canvas, 260–420 deeltjes, zwaartekracht, 28% ribbons, merkkleuren | Finales; escalerend (klein → groot → groter) |

**Choreografie-principe**: grote sequenties zijn audio-locked — elk visueel
accent hangt op een exact tijdstip in de track (zie beat-map van reboot.wav:
2880 / 3616 / 4107 / 4416 / 6315 / 7051 / 7787 / 8032 / 9760 / 10613 / 10741 /
12949 ms). Nieuwe grote momenten: eerst de audio, dan de beats aflezen, dan
flashes + shakes + reveals op die beats hangen. Live game-elementen zijn
event-locked: de Arduino streamt de waarheid (packet-positie, simon-flash) en
schermen spiegelen — nooit zelf timen.

## 7. Copy-regels (7–11 jaar)

- Nederlands, kort, één actie per regel, ALL CAPS voor display-regels.
- Imperatieven: "DRUK", "VANG", "HOU VAST", "LOSLATEN!".
- Kleurwoorden altijd in hun kleur: GEEL geel, ROOD pink.
- Uitleg vóór het spel (op de gate), max 3 stappen, tijdens het spel alleen
  een one-liner als geheugensteun.
- Fouten zijn nooit straffend geformuleerd: "NET NIET — WACHT OP DE VONK!",
  "GEMIST — DAAR KOMT-IE WEER!".
- Story-framing: het systeem praat ("SYSTEEMCHECK", "VERBINDING GEVONDEN"),
  Harry is de oorzaak ("harry_ecker.exe heeft root toegang").

## 8. Z-index-kaart (screens)

| Laag | z |
|---|---|
| Content/layouts | 0–100 |
| Thema-frames (camp) | 9000–9001 |
| Generieke alerts | 9500 |
| Hype takeover-alerts (`.hype-alert`: offline/restart/launch) | 9600 |
| Game mirror | 9700 |
| Glitch-effect | 9800 |

Console (tablet) intern: color-flashes 88, wit flash 90, confetti 95, topbar 10.

## 9. Performance-regels (oude 10" tablet / kiosk)

- Animeer alleen `transform` en `opacity` (GPU). Geen continue
  `background-position`/gradient-animaties, geen `backdrop-filter`.
- Confetti canvas: dpr gecapt op 2, één burst tegelijk.
- Statische grid/scanlines; beweging komt van paint-drift (transform) en
  content-animaties.

## 10. Hardware-spiegel (LED-strip + PARs)

De strip (128 px) volgt hetzelfde systeem: geel vult van links, pink van
rechts, blauw = packet/sync, groen = geslaagd-sweep, rood = storing/overload,
wit = flash/beat. PARs volgen de dominante kleur van het moment. Status-pixel
(pixel 0) = fase-kleur voor debug. Alles wat op de schermen flitst hoort op de
strip terug te komen en andersom — drie oppervlakken, één taal.
