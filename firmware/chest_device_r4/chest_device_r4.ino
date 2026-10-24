// =====================================================================
// SFU Manhunt – chest device for Arduino UNO R4 WiFi + Grove Base Shield
// Parts: Grove 16x2 I2C LCD, Grove Button, Grove Buzzer
//
// What it does
//   Line 1 (always): time until the next ping + hiders alive    e.g.  PING 2:53    @4/5
//   Line 2 (rotates every 3 s):
//     zone timer        Zone shrink 9:42 / CLOSING!   0:40 / Hiding     2:10 / Final zone
//     your powerup      >SHIELD      1/3   (TAP the button = next, HOLD = use it)
//     active effects    HIDDEN PASS 1:25
//   Buzzer: 3 long beeps = a ping revealed you, 2 = the seeker saw your decoy,
//           1 short = your shield blocked it, tiny chirp 10 s before each ping,
//           long beep = you're out.
//
// How it talks to the game
//   The R4 joins the wearer's iPhone hotspot and uses Firebase over HTTPS:
//     devices/<DEVICE_ID>/state  <- written by the wearer's game app (read here every 3 s)
//     devices/<DEVICE_ID>/cmd    -> written here when you use a powerup
//     devices/<DEVICE_ID>/clock  -> used to sync this clock with Firebase
//   In the app lobby, type the same DEVICE_ID into "Chest device ID".
//
// Arduino IDE setup
//   Boards Manager: "Arduino UNO R4 Boards". Board: "Arduino UNO R4 WiFi".
//   Libraries (Tools > Manage Libraries):
//     "ArduinoHttpClient" (by Arduino), "ArduinoJson" (by Benoit Blanchon, v7),
//     "Grove - LCD RGB Backlight" (by Seeed Studio)   <- for Grove 16x2 LCDs
//     or "LiquidCrystal I2C" (by Frank de Brabander)   <- only if LCD_TYPE_GROVE is 0
//
// Grove wiring (Base Shield power switch on 5V – the LCD needs 5 V)
//   Grove Button -> port D2      Grove Buzzer -> port D4      Grove LCD -> any I2C port
// =====================================================================
#include <WiFiS3.h>
#include <ArduinoHttpClient.h>
#include <ArduinoJson.h>
#include <Wire.h>

// ----------------------------- CONFIG: change for each device ---------
const char *WIFI_SSID = "YOUR-HOTSPOT-NAME";      // wearer's iPhone hotspot (Settings > General > About > Name)
const char *WIFI_PASS = "YOUR-HOTSPOT-PASSWORD";
const char *DEVICE_ID = "chest-01";               // unique per device; same ID in the app lobby

// Same Firebase project as js/config.js
const char *API_KEY   = "AIzaSyDZS8EsOIZogspxxCchz0nklfidSg5x4jo";
const char *DB_HOST   = "sfu-manhunt-default-rtdb.firebaseio.com";
const char *AUTH_HOST = "identitytoolkit.googleapis.com";

// 1 = Grove 16x2 LCD (RGB backlight or white-on-blue), uses the "Grove - LCD RGB Backlight" library
// 0 = generic 16x2 LCD with a PCF8574 I2C backpack, uses the "LiquidCrystal I2C" library
#define LCD_TYPE_GROVE  1
#define LCD_I2C_ADDR    0x27       // only for LCD_TYPE_GROVE 0 (sometimes 0x3F)

#define BUTTON_PIN      2          // Grove port D2 (supports interrupts)
#define BUTTON_PRESSED  HIGH       // Grove Button outputs HIGH when pressed
#define BUZZER_PIN      4          // Grove port D4

#define POLL_MS            3000    // how often to fetch the game state
#define LONG_PRESS_MS      700     // hold this long to USE the selected powerup
#define ROTATE_MS          3000    // line 2 switches every 3 s
#define WARN_BEFORE_PING_S 10      // tiny chirp before each ping (0 = off)
#define STALE_MS           60000   // no update from the phone for this long = "phone offline"
#define TOKEN_MAX_AGE_MS   (50UL * 60 * 1000)

// Short names for the LCD (keys must match SFU.POWERUPS in js/config.js)
const char *powerupName(const String &type) {
  if (type == "shield") return "SHIELD";
  if (type == "decoy")  return "DECOY";
  if (type == "pass")   return "BORDER PASS";
  return "POWERUP";
}
// ---------------------------------------------------------------------

#if LCD_TYPE_GROVE
  #include "rgb_lcd.h"
  rgb_lcd lcd;
  void lcdStart() { lcd.begin(16, 2); }
  void backlight(int r, int g, int b) {      // colour only on RGB Grove LCDs; harmless on others
    static long last = -1;
    long c = ((long)r << 16) | (g << 8) | b;
    if (c != last) { last = c; lcd.setRGB(r, g, b); }
  }
#else
  #include <LiquidCrystal_I2C.h>
  LiquidCrystal_I2C lcd(LCD_I2C_ADDR, 16, 2);
  void lcdStart() { lcd.init(); lcd.backlight(); }
  void backlight(int, int, int) {}
#endif

const char ICON_PERSON = 1;        // custom LCD character
byte personGlyph[8] = { 0b00100, 0b01010, 0b00100, 0b01110, 0b10101, 0b00100, 0b01010, 0b10001 };

WiFiSSLClient dbSsl, authSsl;
HttpClient dbHttp(dbSsl, DB_HOST, 443);
HttpClient authHttp(authSsl, AUTH_HOST, 443);

// ---- game state received from the phone ----
struct Item { String id, type; };
struct Feed {
  bool valid = false;              // a state exists for this device
  String game, role, status, zonePhase, winner, meeting;
  int alive = 0, total = 0;
  double ts = 0, hidingUntil = 0, nextPingAt = 0, zoneAt = 0, endsAt = 0, passUntil = 0;
  bool shieldNext = false, decoyNext = false;
  int pingK = -1; String pingResult;
  Item inv[8]; int invCount = 0;
};
Feed feed;

bool wifiOk = false, clockOk = false, fetchOk = false;
double clockOffset = 0;            // Firebase server time = millis() + clockOffset
String idToken; uint32_t tokenAt = 0;
String cmdUse; bool cmdPending = false;

double serverNow() { return (double)millis() + clockOffset; }

// =====================================================================
// Firebase over HTTPS
// =====================================================================
int request(HttpClient &http, const char *method, const String &path, const String &body, String &out) {
  int err;
  if (!strcmp(method, "GET")) err = http.get(path);
  else if (!strcmp(method, "PUT")) err = http.put(path, "application/json", body);
  else err = http.post(path, "application/json", body);
  if (err != 0) { http.stop(); return -1; }
  int code = http.responseStatusCode();
  out = http.responseBody();
  if (code < 0) http.stop();
  return code;
}

String dbPath(const char *child) {
  return String("/devices/") + DEVICE_ID + "/" + child + ".json?auth=" + idToken;
}

bool signIn() {
  String out;
  int code = request(authHttp, "POST", String("/v1/accounts:signUp?key=") + API_KEY, "{\"returnSecureToken\":true}", out);
  authHttp.stop();
  if (code != 200) { Serial.print("Sign-in failed: "); Serial.println(code); Serial.println(out); return false; }
  JsonDocument doc;
  if (deserializeJson(doc, out)) return false;
  idToken = (const char *)(doc["idToken"] | "");
  tokenAt = millis();
  Serial.println("Signed in to Firebase");
  return idToken.length() > 0;
}

bool tokenValid() { return idToken.length() && millis() - tokenAt < TOKEN_MAX_AGE_MS; }

// PUT a server timestamp and read it back to learn Firebase's clock.
bool syncClock() {
  String out;
  uint32_t t0 = millis();
  int code = request(dbHttp, "PUT", dbPath("clock"), "{\".sv\":\"timestamp\"}", out);
  uint32_t t1 = millis();
  if (code != 200) { Serial.print("Clock sync failed: "); Serial.println(code); if (code == 401) idToken = ""; return false; }
  clockOffset = strtod(out.c_str(), nullptr) - (t0 + t1) / 2.0;
  return true;
}

bool sendCommand(const String &use) {
  String out;
  int code = request(dbHttp, "PUT", dbPath("cmd"), "{\"ts\":{\".sv\":\"timestamp\"},\"use\":\"" + use + "\"}", out);
  Serial.print("Command sent: "); Serial.println(code);
  if (code == 401) idToken = "";
  return code == 200;
}

void fetchState() {
  String out;
  int code = request(dbHttp, "GET", dbPath("state"), "", out);
  if (code == 401) idToken = "";
  if (code != 200) { fetchOk = false; return; }
  JsonDocument doc;
  if (deserializeJson(doc, out)) { fetchOk = false; return; }
  Feed f;
  f.valid = !doc.isNull();
  if (f.valid) {
    f.game = (const char *)(doc["game"] | "");
    f.role = (const char *)(doc["role"] | "");
    f.status = (const char *)(doc["status"] | "");
    f.zonePhase = (const char *)(doc["zonePhase"] | "");
    f.winner = (const char *)(doc["winner"] | "");
    f.meeting = (const char *)(doc["meeting"] | "");
    f.alive = doc["alive"] | 0;
    f.total = doc["total"] | 0;
    f.ts = doc["ts"] | 0.0;
    f.hidingUntil = doc["hidingUntil"] | 0.0;
    f.nextPingAt = doc["nextPingAt"] | 0.0;
    f.zoneAt = doc["zoneAt"] | 0.0;
    f.endsAt = doc["endsAt"] | 0.0;
    f.passUntil = doc["passUntil"] | 0.0;
    f.shieldNext = doc["shieldNext"] | false;
    f.decoyNext = doc["decoyNext"] | false;
    f.pingK = doc["lastPing"]["k"] | -1;
    f.pingResult = (const char *)(doc["lastPing"]["result"] | "");
    for (JsonObject it : doc["inv"].as<JsonArray>()) {
      if (f.invCount >= 8) break;
      f.inv[f.invCount].id = (const char *)(it["id"] | "");
      f.inv[f.invCount].type = (const char *)(it["type"] | "");
      f.invCount++;
    }
  }
  feed = f;
  fetchOk = true;
}

void onCommandResult(bool ok);

// One network job per loop pass (HTTPS calls block for ~0.5-2 s; the button
// is caught by an interrupt meanwhile, so presses are never lost).
void networkStep() {
  static uint32_t lastWifiTry = 0, lastAuthTry = 0, lastPoll = 0, lastSync = 0;
  if (WiFi.status() != WL_CONNECTED) {
    wifiOk = false;
    if (!lastWifiTry || millis() - lastWifiTry > 15000) {
      lastWifiTry = millis();
      Serial.print("Connecting to "); Serial.println(WIFI_SSID);
      WiFi.begin(WIFI_SSID, WIFI_PASS);
    }
    return;
  }
  wifiOk = true;
  if (!tokenValid()) {
    if (!lastAuthTry || millis() - lastAuthTry > 15000) { lastAuthTry = millis(); signIn(); }
    return;
  }
  if (!clockOk || millis() - lastSync > 600000UL) { lastSync = millis(); clockOk = syncClock(); return; }
  if (cmdPending) { bool ok = sendCommand(cmdUse); cmdPending = false; onCommandResult(ok); lastPoll = 0; return; }
  if (!lastPoll || millis() - lastPoll > POLL_MS) { lastPoll = millis(); fetchState(); }
}

// =====================================================================
// LCD, button, buzzer
// =====================================================================
void beeps(int n, int onMs, int offMs) {
  for (int i = 0; i < n; i++) { digitalWrite(BUZZER_PIN, HIGH); delay(onMs); digitalWrite(BUZZER_PIN, LOW); delay(offMs); }
}

String fmt(double sec) {
  if (sec < 0) sec = 0;
  long s = (long)(sec + 0.5);
  char b[12];
  snprintf(b, sizeof(b), "%ld:%02ld", s / 60, s % 60);
  return b;
}

String fit(String s) {                       // exactly 16 characters
  if (s.length() > 16) s = s.substring(0, 16);
  while (s.length() < 16) s += ' ';
  return s;
}

String spread(const String &left, const String &right) {   // left text, right-aligned text
  String s = left;
  while (s.length() + right.length() < 16) s += ' ';
  return fit(s + right);
}

String shown[2];
void line(int row, const String &text) {    // only rewrite lines that changed (no flicker)
  String s = fit(text);
  if (s == shown[row]) return;
  shown[row] = s;
  lcd.setCursor(0, row);
  lcd.print(s);
}

// Message shown instead of the normal screen for a moment (e.g. "PINGED!")
String msg1, msg2; uint32_t msgUntil = 0;
void showMsg(const String &a, const String &b, uint32_t ms) { msg1 = a; msg2 = b; msgUntil = millis() + ms; }

String selectedId;                 // selection is remembered by id so it survives list changes
uint32_t powerupPinnedUntil = 0;   // after a tap, keep line 2 on the powerup for a while

int selectedIndex() {
  for (int i = 0; i < feed.invCount; i++) if (feed.inv[i].id == selectedId) return i;
  return feed.invCount ? 0 : -1;
}

void onCommandResult(bool ok) {
  if (ok) showMsg("SENT", "Check your phone", 1500);
  else { showMsg("FAILED", "No connection", 2000); beeps(3, 60, 60); }
}

void usePressed() {
  if (cmdPending) { showMsg("WAIT", "Still sending...", 1000); return; }
  int sel = selectedIndex();
  cmdUse = sel >= 0 ? feed.inv[sel].id : "";
  cmdPending = true;
  if (sel >= 0) { showMsg("USING", powerupName(feed.inv[sel].type), 2000); beeps(1, 100, 0); }
  else showMsg("PRESSED", "Test sent", 1500);
}

void tapPressed() {
  powerupPinnedUntil = millis() + 5000;
  if (feed.invCount == 0) { showMsg("NO POWERUPS", "Walk onto one", 1200); return; }
  int sel = selectedIndex();
  selectedId = feed.inv[(sel + 1) % feed.invCount].id;
  beeps(1, 15, 0);
}

// Button is read by an interrupt so presses during network calls still count
volatile bool isrDown = false, isrReleased = false;
volatile uint32_t isrDownAt = 0, isrUpAt = 0;
void onButtonChange() {
  bool d = digitalRead(BUTTON_PIN) == BUTTON_PRESSED;
  uint32_t t = millis();
  if (d && !isrDown) { isrDown = true; isrDownAt = t; }
  else if (!d && isrDown) { isrDown = false; isrUpAt = t; isrReleased = true; }
}

void handleButton() {
  static bool longFired = false;
  noInterrupts();
  bool down = isrDown, released = isrReleased;
  uint32_t downAt = isrDownAt, upAt = isrUpAt;
  isrReleased = false;
  interrupts();
  if (down && !longFired && millis() - downAt > LONG_PRESS_MS) { longFired = true; usePressed(); }
  if (released) {
    uint32_t held = upAt - downAt;
    if (!longFired) {
      if (held >= LONG_PRESS_MS) usePressed();
      else if (held > 30) tapPressed();
    }
    longFired = false;
  }
}

void handleGameEvents() {
  static bool initialised = false;
  static int lastPingK = -1;
  static String lastStatus;
  static double lastWarnFor = 0;
  if (!feed.valid) return;
  if (!initialised) { initialised = true; lastPingK = feed.pingK; lastStatus = feed.status; }
  if (feed.pingK != lastPingK) {
    lastPingK = feed.pingK;
    if (feed.pingResult == "seen")         { backlight(255, 0, 0); showMsg("PINGED!", "Seeker saw you", 3000); beeps(3, 250, 120); }
    else if (feed.pingResult == "decoy")   { showMsg("PINGED (DECOY)", "Seeker saw decoy", 3000); beeps(2, 120, 100); }
    else if (feed.pingResult == "blocked") { showMsg("PING BLOCKED", "Shield hid you", 3000); beeps(1, 80, 0); }
  }
  if (feed.status != lastStatus) {
    if (feed.status == "out") { showMsg("YOU'RE OUT", "", 4000); beeps(1, 1200, 0); }
    lastStatus = feed.status;
  }
  double toPing = (feed.nextPingAt - serverNow()) / 1000;
  if (WARN_BEFORE_PING_S && feed.game == "running" && feed.status == "alive" && toPing > 0 &&
      toPing <= WARN_BEFORE_PING_S && feed.nextPingAt != lastWarnFor) {
    lastWarnFor = feed.nextPingAt;
    beeps(1, 40, 0);
  }
}

void draw() {
  const Feed &f = feed;
  double now = serverNow();

  if (millis() < msgUntil) { line(0, msg1); line(1, msg2); return; }
  if (!wifiOk)             { backlight(0, 0, 255); line(0, "Wi-Fi..."); line(1, WIFI_SSID); return; }
  if (!tokenValid() || !clockOk) { backlight(0, 0, 255); line(0, "SFU MANHUNT"); line(1, "Signing in..."); return; }
  if (!f.valid)            { backlight(255, 255, 255); line(0, "NOT PAIRED"); line(1, String("ID: ") + DEVICE_ID); return; }
  if (f.ts && now - f.ts > STALE_MS) { backlight(255, 120, 0); line(0, "Phone app"); line(1, "offline?"); return; }

  if (f.game == "lobby") {
    backlight(0, 120, 255);
    line(0, spread("LOBBY", String(ICON_PERSON) + String(f.total)));
    line(1, "Waiting for host");
    return;
  }
  if (f.game == "ended") {
    backlight(255, 255, 255);
    line(0, f.winner == "seeker" ? "SEEKER WINS" : f.winner == "hiders" ? "HIDERS WIN!" : "GAME STOPPED");
    line(1, f.meeting.length() ? String("Meet: ") + f.meeting : String(""));
    return;
  }
  String alive = String(ICON_PERSON) + String(f.alive) + "/" + String(f.total);
  if (f.status == "out") {
    backlight(80, 80, 80);
    line(0, spread("YOU'RE OUT", alive));
    line(1, "Ends in " + fmt((f.endsAt - now) / 1000));
    return;
  }

  // ---- running, alive ----
  line(0, spread("PING " + fmt((f.nextPingAt - now) / 1000), alive));

  String zone;
  if (f.hidingUntil > now) zone = spread("Hiding", fmt((f.hidingUntil - now) / 1000));
  else if (f.zonePhase == "closing") zone = spread("CLOSING!", fmt((f.zoneAt - now) / 1000));
  else if (f.zonePhase == "hold") zone = spread("Zone shrink", fmt((f.zoneAt - now) / 1000));
  else zone = "Final zone";

  int sel = selectedIndex();
  String power = sel < 0 ? String("No powerups")
               : spread(String(">") + powerupName(f.inv[sel].type), String(sel + 1) + "/" + String(f.invCount));

  String eff;
  if (f.shieldNext) eff += "HIDDEN ";
  if (f.decoyNext) eff += "DECOY ";
  if (f.passUntil > now) eff += "PASS " + fmt((f.passUntil - now) / 1000);

  if (f.role == "seeker") { line(1, zone); backlight(255, 0, 0); return; }

  // line 2 rotates: zone -> powerup -> effects (if any); a tap pins the powerup
  String options[3] = { zone, power, eff };
  int count = eff.length() ? 3 : 2;
  int idx = millis() < powerupPinnedUntil ? 1 : (millis() / ROTATE_MS) % count;
  line(1, options[idx]);
  if (f.zonePhase == "closing") backlight(255, 120, 0); else backlight(0, 255, 60);
}

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT);              // Grove Button has its own pull-down
  attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), onButtonChange, CHANGE);
  Wire.begin();
  lcdStart();
  lcd.createChar(ICON_PERSON, personGlyph);
  backlight(0, 0, 255);
  line(0, "SFU MANHUNT");
  line(1, String("ID: ") + DEVICE_ID);
  if (WiFi.status() == WL_NO_MODULE) { line(1, "No Wi-Fi module!"); while (true) delay(1000); }
  dbHttp.connectionKeepAlive();            // reuse the Firebase connection (faster polling)
  dbHttp.setHttpResponseTimeout(8000);
  authHttp.setHttpResponseTimeout(8000);
  beeps(1, 60, 0);                         // hello
}

void loop() {
  static uint32_t lastDraw = 0;
  handleButton();
  handleGameEvents();
  if (millis() - lastDraw > 250) { lastDraw = millis(); draw(); }
  networkStep();                           // may block ~1-2 s during HTTPS calls
  handleButton();
}
