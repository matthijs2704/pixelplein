# PixelPlein

PixelPlein is een live fotomuur-systeem voor evenementen. Zodra een fotograaf een foto neerzet, wordt die verwerkt en op twee schermen getoond — met cinematische overgangen, slimme lay-outs en realtime bediening.

Gebouwd voor **RSW 2026**, de Regionale Scouting Wedstrijden van Regio Utrechtse Heuvelrug.

---

## Hoe het werkt

1. Foto's komen binnen in de map `photos/` — via een Samba-share, gekoppelde camera, of drag-and-drop in de beheeromgeving.
2. De server verwerkt elke foto meteen: verkleind, geoptimaliseerd en klaar binnen enkele seconden.
3. Beide schermen pakken de nieuwe foto op en verwerken hem in de volgende lay-outcyclus, onafhankelijk van elkaar, zonder dezelfde foto tegelijk te tonen.
4. Via de beheeromgeving pas je alles live aan — tempo, groepsfocus, overlays, thema's — zonder de schermen aan te raken.

---

## Schermen

Vijf lay-outtypen, automatisch gekozen op basis van de beschikbare foto's en ingestelde gewichten:

- **Volledig scherm** — één hoofdfoto van rand tot rand, met Ken Burns-beweging.
- **Naast elkaar** — twee foto's horizontaal gesplitst.
- **Featured duo** — één grote hoofdfoto met een ondersteunende foto.
- **Mozaïek** — CSS-grid lay-outs uit een bibliotheek van 9 sjablonen (hero-left, uniform-9, portrait-bias, recent-strip, …). Niet-hero tegels wisselen live tijdens de cyclus.
- **Polaroid** — foto's als verspreid liggende, licht gedraaide polaroidkaarten over het scherm.

Beide schermen draaien onafhankelijk met een instelbare fase-offset (standaard 900 ms) zodat ze nooit precies tegelijk overgaan. Ze delen een hero-vergrendeling zodat dezelfde foto niet op beide schermen tegelijk als hoofdfoto verschijnt, en wisselen zichtbare foto-ID's uit om duplicaten te vermijden.

---

## Afspeellijsten

Tussen fotocycli door kan PixelPlein dia's uit een afspeellijst invoegen:

- **Tekstkaart** — titel en tekst met een gestylde accentlijn.
- **Video** — speelt een instelbaar aantal keren af, daarna terug naar foto's.
- **QR-code** — server-side gegenereerd, met titel en onderschrift.
- **Artikel** — kop, tekst en een foto uit de pool of apart geüpload.
- **Afbeelding** — statisch geüploade afbeelding.
- **Webpagina** — iframe-embed.

Er kunnen meerdere afspeellijsten worden aangemaakt en per scherm toegewezen. In gecoördineerde modus wachten beide schermen bij elke dia-grens op elkaar en gaan tegelijk verder.

---

## Thema's

Zet een map in `themes/` met een manifest, een stylesheet met CSS custom properties, en optioneel een decoratief HTML-overlay (`frame.html`). Het thema wordt meteen toegepast op alle schermen vanuit de beheeromgeving — geen herlaad, geen herstart.

Zie [THEMING.md](THEMING.md) voor de volledige variabelenreferentie.

---

## Installatie

### Vereisten

- Node.js 20+
- Linux aanbevolen voor productie (getest op Debian/Ubuntu)

### Installeren

```bash
git clone <repo>
cd pixelplein
npm install
```

### Starten

```bash
npm start
```

| URL | Wat |
|---|---|
| `http://localhost:3000/screen.html?screen=1` | Scherm 1 |
| `http://<HOST-IP>:3000/screen.html?screen=2` | Scherm 2 |
| `http://<HOST-IP>:3000/admin.html` | Beheeromgeving |
| `http://<HOST-IP>:3000/preview.html` | Live voorvertoning (beide schermen verkleind) |

---

## Foto's aanleveren

### Optie A — Samba-share (aanbevolen voor fotografen)

```bash
sudo apt install -y samba
```

Voeg toe aan `/etc/samba/smb.conf`:

```ini
[photos]
   path = /path/to/pixelplein/photos
   browseable = yes
   writable = yes
   guest ok = yes
   create mask = 0664
```

```bash
sudo systemctl restart smbd
```

Fotografen verbinden met `\\<HOST-IP>\photos` en zetten bestanden direct neer vanaf hun geheugenkaartlezer of gekoppelde camera.

### Optie B — Upload via beheeromgeving

Sleep tot 200 foto's tegelijk naar het tabblad Foto's. Wijs ze bij het uploaden toe aan een groep.

### Mapgroepen

Submappen onder `photos/` worden automatisch evenementgroepen:

```
photos/
  opening/
  spellen/
  kampvuur/
```

Groepen kunnen worden gefocust, gemengd of op een timer geroteerd — per scherm instelbaar in de beheeromgeving.

---

## Kiosk-modus

**Scherm 1 (lokaal):**
```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  "http://localhost:3000/screen.html?screen=1"
```

**Scherm 2 (tweede apparaat):**
```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  "http://<HOST-IP>:3000/screen.html?screen=2"
```

---

## Automatisch opstarten

Maak `/etc/systemd/system/pixelplein.service` aan:

```ini
[Unit]
Description=PixelPlein
After=network.target

[Service]
WorkingDirectory=/path/to/pixelplein
ExecStart=/usr/bin/node server/index.js
Restart=always
User=<your-user>

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now pixelplein
```

---

## Beheeromgeving

Zeven pagina's:

| Pagina | Wat je kunt doen |
|---|---|
| **Schermen** | Gezondheidsoverzicht, snelle bediening (tempo, energie, recency bias, Ken Burns) |
| **Afspeellijsten** | Afspeellijsten aanmaken, dia's toewijzen en herordenen |
| **Inhoud** | Dia-bibliotheek beheren (alle 6 typen), Play Soon activeren |
| **Foto's** | Uploaden, bladeren per groep, hero-kandidaten instellen, verwijderen |
| **Overlays** | Ticker, hoek-bug, QR-bug — per scherm |
| **Geavanceerd** | Alle ruwe instellingen per scherm: lay-outs, sjablonen, overgang, groepsconfiguratie, wissel-cadans, hero-afstelling |
| **Instellingen** | Evenementnaam, aantal schermen, resolutie, thema, beheerders-PIN |

---

## Ondersteunde bestandstypen

Foto's: `.jpg` `.jpeg` `.png` `.webp` `.gif`

Video's: `.mp4` `.webm` `.mov`

---

## API

| Methode | Pad | Omschrijving |
|---|---|---|
| `GET` | `/api/config` | Huidige configuratie |
| `POST` | `/api/config` | Configuratie bijwerken (gevalideerd en begrensd) |
| `GET` | `/api/photos` | Fotoregister met status en afmetingen |
| `GET` | `/api/stats` | Runtime-gezondheid: heartbeat, wachtrijdiepte, cachedekking, fouten |
| `GET` | `/api/slides` | Dia-bibliotheek |
| `GET` | `/api/themes` | Beschikbare thema's |
