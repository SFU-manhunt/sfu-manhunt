> NOTE: This is the original build prompt, kept for reference. The design has since changed: the Bluetooth
> hint device was replaced by seeker pings + powerups (shield, decoy) and a chest-worn powerup button. See README.md.

Build a base version of a campus-wide manhunt game called "SFU Manhunt" in this folder. It must be a working base model that I can change and fix later once I have my specific hardware. Target campus first: SFU Burnaby (Burnaby Mountain).

GAME
Normal manhunt: hiders hide, one seeker finds them. Players use their phones. The play area is a border that shrinks over time. The seeker also carries a small hardware device that gives a distance hint.

REQUIRED FUNCTIONS
1. GPS tracker: every phone shares its position (every ~3-5s) through a realtime backend. Map with Leaflet + OpenStreetMap. Show the player's own position and the border. The seeker does NOT see hider dots on the map (the hardware hint is the point). A host/spectator view shows everyone.
2. Zone/border: host sets center (host's current location or a tap on the map), starting radius, shrink interval, shrink amount, and grace period. The border shrinks on a timer. Players outside get a warning and a countdown, then are eliminated. Add a ~15-20m GPS buffer and require several consecutive bad readings before eliminating, so single GPS glitches don't eliminate anyone.
3. Elimination: the seeker taps "Tag" and picks a nearby hider (within ~30m); the hider confirms on their phone. Border elimination also applies. Game ends when all hiders are eliminated (seeker wins) or time runs out (hiders win).
4. Hint device: the seeker's phone computes the distance to the nearest alive hider (haversine), smooths it, and converts it to bands: >200m, 100-200, 50-100, 25-50, <25m. Send the band/distance to an ESP32 over Web Bluetooth (Android Chrome). The ESP32 beeps a buzzer faster as the seeker gets closer and shows "Nearest: ~XX m" on a 0.96-inch SSD1306 128x64 OLED over I2C (address 0x3C), with a large distance number and a bar that fills as the seeker gets closer. The hint refreshes every N seconds (configurable by host, default 10).

SFU CAMPUS TAILORING
- Campus presets (dropdown): Burnaby (build first), Surrey and Vancouver/Harbour Centre (stub with center and zoom only). Each has a map center, zoom and default starting radius.
- Play area can be a polygon that follows the real campus, not just a circle; the shrink targets a chosen final point. Keep polygon coordinates in one editable config file, mark them as approximate, and let the host redraw/adjust them by clicking points on the map.
- Named landmark zones (e.g. Convocation Mall, AQ, Library, Transportation Centre, WMC Bennett, residences) usable as the final safe zone and shown in the shrink schedule ("next safe zone: AQ"). Coordinates are approximate and editable.
- Off-limits polygons (roads like Gaglardi Way and University Drive, construction, steep forest edges/trails, parking structures): entering gives a warning, then counts as out of bounds.
- Indoor/covered GPS leniency: configurable longer grace period, and optional "safe / out of play" building zones so players aren't unfairly eliminated.
- SFU look: red and white theme.
- Safety: a host "Stop game" button that ends the game for everyone and shows a meeting point; a note in the README about getting SFU permission, daylight play, wildlife on the mountain, and power banks.

TECH CHOICES
- Single-page web app (plain HTML/JS, no build step if possible), Firebase Realtime Database, hosted on GitHub Pages. Keep Firebase config in one clearly marked placeholder block.
- Lobby: join with a game code and a name; host starts the game and assigns the seeker.
- Fallback if Bluetooth is unavailable: the seeker's phone itself beeps and vibrates by distance band.
- A "Test mode" with simulated players moving around, so I can test the border, tagging, and hints at my desk with no GPS and no hardware.
- ESP32 firmware (Arduino C++): BLE service with one writable characteristic that accepts a distance in metres; drives an active buzzer and the SSD1306 OLED (Adafruit SSD1306 + GFX libraries). Use generic defaults: buzzer on GPIO 25, OLED I2C address 0x3C (SDA 21, SCL 22). Put pins and address in a config block at the top so I can change them (note SH1106 variant for 1.3" screens). Also include a short WiFi/HTTP alternative note for iPhone seekers, but don't build it yet.
- Make everything easy to change: all game settings (radius, shrink timing, grace period, bands, hint rate) in one config object.

DELIVERABLES
- The web app, the ESP32 firmware, and a README with: Firebase setup steps (what to click, where to paste the config), how to publish on GitHub Pages, how to flash the ESP32, a wiring list (ESP32, active buzzer, OLED), and a field-test checklist.
- Firebase security rules suitable for a short-lived game (simple but not wide open for abuse).
- Create a git repo and commit as you go; ask before pushing to GitHub.

WORKING STYLE
- Build the web app first and verify it in test mode in the browser, then the firmware, then the Bluetooth integration.
- Tell me anything you can't do yourself (like creating the Firebase project) as a clear step for me to do.
- Keep it simple and readable, since I'll be changing it after I get my parts.
