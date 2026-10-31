// De Hype — physical showtime button (M5 Atom Lite / Matrix)
//
// One press fires whatever action is armed in the hype admin
// ("Fysieke knop" select). The server is one-shot: after firing it disarms
// itself (reveal auto-advances to trace), so stray presses are harmless.
//
// LED:  red    = no wifi / server unreachable
//       off    = connected, button disarmed (press does nothing)
//       green  = ARMED — one press fires the action
//       blue   = press sent, waiting for server
//       white  = fired OK (flashes, then back to polling)
//
// Build/flash: pio run -t upload (from this directory).

#include <Arduino.h>
#include <M5Atom.h>
#include <WiFi.h>
#include <HTTPClient.h>

// ── Config ──────────────────────────────────────────────────────────────
const char* WIFI_SSID = "DeHype";
const char* WIFI_PASS = "tbv5WZD7dxz!efr0ywb";
const char* SERVER    = "http://192.168.1.200:3000"; // PixelPlein server (IoT-subnet address)
const unsigned long POLL_MS = 3000;

const IPAddress STATIC_IP(192, 168, 1, 205);
const IPAddress GATEWAY(192, 168, 1, 1);
const IPAddress SUBNET(255, 255, 255, 0);
const IPAddress DNS(192, 168, 1, 1);

// ────────────────────────────────────────────────────────────────────────
String url;
unsigned long lastPoll = 0;
bool armed = false;

void led(uint32_t rgb) { M5.dis.fillpix(rgb); }

void setup() {
  M5.begin(true, false, true);
  led(0xff0000); // red until connected
  url = String(SERVER) + "/api/modules/hype/trigger";
  WiFi.config(STATIC_IP, GATEWAY, SUBNET, DNS);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void poll() {
  HTTPClient http;
  http.setTimeout(2000);
  http.begin(url);
  int code = http.GET();
  if (code == 200) {
    // Tiny JSON: {"armed":"reveal"} or {"armed":null} — string match is enough.
    armed = http.getString().indexOf("null") < 0;
    led(armed ? 0x00ff00 : 0x000000); // green when armed, off when not
  } else {
    led(0xff0000); // server unreachable
  }
  http.end();
}

void fire() {
  led(0x0000ff); // blue: sending
  HTTPClient http;
  http.setTimeout(4000);
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST("{}");
  http.end();
  if (code == 200) {
    // White flash: it happened.
    for (int i = 0; i < 6; i++) { led(i % 2 ? 0x000000 : 0xffffff); delay(150); }
    led(0x000000);
  } else {
    // 409 = not armed (someone disarmed it), red blink = real failure.
    led(code == 409 ? 0x000000 : 0xff0000);
    delay(800);
  }
  lastPoll = 0; // re-poll immediately for fresh LED state
}

void loop() {
  M5.update();

  if (WiFi.status() != WL_CONNECTED) {
    led(0xff0000);
    delay(250);
    return;
  }

  if (M5.Btn.wasPressed()) fire();

  if (millis() - lastPoll > POLL_MS) {
    lastPoll = millis();
    poll();
  }
  delay(20);
}
