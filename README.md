# SFU Manhunt

A campus-wide manhunt game for phones (works on iPhone). Hiders hide, and up to 3 seekers hunt them. The play area **shrinks over time**. Every few minutes the seekers get a **ping** showing where the hiders are. Hiders can collect **powerups** that the app places around campus to dodge or fool those pings.

**Play:** https://sfu-manhunt.github.io/sfu-manhunt/ · **Case designer:** https://sfu-manhunt.github.io/sfu-manhunt/cad/wrist_case.html · **Code:** https://github.com/SFU-manhunt/sfu-manhunt

This is a **base version**. Expect to tweak coordinates and timings once you've walked the campus.

## How the game works

| Feature | How it works |
|---|---|
| GPS tracker | Each phone uploads its position every ~4 s. Hiders see only themselves; spectators see everyone. |
| Pings | When hiding time ends, and then every 3 min, the seeker's map shows every alive hider as a red dot for 30 s (fading out from 25 s). Hiders get a sound and a message each time they're pinged. |
| Faster pings | If the seeker catches nobody for 12.5 min, pings come every 1 min. After 15 min they come every 30 s and stay there until someone is caught, which resets to normal. |
| Shrinking zone | The SFU Burnaby outline (or a circle) shrinks in steps toward a final point such as Convocation Mall. A dashed line shows the next zone. |
| Border elimination | If you're outside for 3 GPS readings in a row (with a 15 m buffer), a 30 s countdown starts. Indoors (poor GPS) you get double time. Off-limits zones count as outside. |
| Tagging | The seeker taps **Tag**, picks a hider within 30 m, and the hider confirms on their phone. |
| Powerups | The host's phone drops one every 4 min (max 3 at a time). A hider collects one by walking within 15 m of it. |
| 🛡️ Shield | You're left off the next ping. |
| 🎭 Decoy | You tap anywhere on the map, and the next ping shows you there instead. |
| 🧭 Border Pass | For 90 s you may leave the shrunken zone, as long as you stay inside the **original** border from the start of the game. Off-limits zones still count. |
| Wrist device | An Arduino UNO R4 WiFi on your wrist with a Grove LCD, button and buzzer. It shows the game stage, when the ring closes and for how long, and how many people are left. It buzzes when the ring starts closing, when a hider is out, and when a ping reveals you. Tap to pick a powerup, hold to use it. See section 5. In Test mode, "Hold wrist button" does the same as a hold. |
| Safety | The host can press **Stop game**, which ends the game for everyone and tells them where to meet. |
| Test mode | Simulated players (they collect and use powerups too), a draggable "you" dot and 1×–60× speed. No Firebase or GPS needed. |

### The powerup "AI"

`SFU.placePowerup` in [js/geo.js](js/geo.js) tries 60 random spots and scores each one. A good spot:
- is safely inside the zone and will survive the next shrink,
- is at least 60 m from the seeker and ideally far from them,
- is about 120 m from the nearest hider, so it's worth the trip but risky,
- is spread out from other powerups,
- is often near a landmark.

Change the weights in that function to change how the game feels. By default the seeker can see powerups too (`seekerSeesPowerups`), so they can camp them.

## Files

```
index.html                 the whole web app (one page)
css/style.css
js/config.js               <- Firebase config + all game settings + powerup types (edit this)
js/campus.js               <- SFU campus outlines & landmarks (APPROXIMATE, verify!)
js/geo.js                  zone geometry, shrink schedule, border logic, powerup placement
js/db.js                   Firebase / in-memory backends
js/sound.js                ping sounds
js/app.js                  UI and game logic
js/testmode.js             bots for desk testing
firmware/wrist_device_r4/  Arduino UNO R4 WiFi wrist device sketch (Grove LCD, button, buzzer)
database.rules.json        Firebase security rules
```

## 1. Try it right now (test mode)

```bash
python -m http.server 8080
```

Open http://localhost:8080 and click **Test mode**. Drag the blue dot (or use WASD), walk onto 🛡️/🎭 to collect them, and use the speed buttons. Play as a hider to see the three SeekerBots get fooled by your decoys and shields.

### Judge demo (3-minute rounds)

On the home screen, tap **Judge demo (3 min)**, then **Play as hider** (recommended) or **Watch everyone**. It's a scripted round on the SFU Burnaby map with simulated players and captions explaining each feature as it happens. No GPS, walking or second phone needed.

| Time | What happens |
|---|---|
| 0:00 | Intro, then hiding phase (15 s) |
| 0:15 | First **ping**, then one every 20 s |
| ~0:18 | A **Shield** drops near you. Autopilot walks you to it, and the "wrist button" uses it, so the next ping misses you. |
| 0:40 | The **ring starts closing** |
| ~0:50 | **Drifter** leaves the zone and is eliminated |
| ~1:00 | A **Border Pass** drops and gets used |
| 1:30 / 2:00 | No catch, so **pings speed up** (every 10 s, then every 6 s) |
| ~2:10 | One of the 3 SeekerBots **tags** a hider, and pings reset to normal |
| 3:00 | Time's up, **Hiders win**, and a summary lists every feature shown |

- **Autopilot** (on by default) walks you around so the presenter can just talk. Untick it to drag the blue dot yourself.
- **Wrist device:** type its ID into the demo panel and it reacts live (timers, buzzes, powerups). The demo syncs its clock with Firebase for this.
- **Run the demo again** on the summary screen starts the next round instantly.

## 2. Firebase (done)

The project `sfu-manhunt` is set up: anonymous sign-in is on and the config is in `js/config.js`.

**Re-publish the rules:** they changed for powerups and the wrist device. In Realtime Database, open the **Rules** tab, paste [`database.rules.json`](database.rules.json) again, and click **Publish**.

Old games stay in the database. Delete the `games` node in the console now and then.

## 3. Publish on GitHub Pages (free HTTPS, needed for GPS on phones)

1. On github.com, click **New repository** and name it `sfu-manhunt`. Make it **Public** (free Pages needs that). Don't add a README.
2. On the empty repository page, click **uploading an existing file**. Drag in everything in this folder (`index.html`, `manifest.json`, `README.md`, `database.rules.json`, `BUILD_PROMPT.md`, `.gitignore`, and the `css` and `js` folders), then click **Commit changes**.
3. Go to **Settings → Pages → Source: Deploy from a branch → `main` / (root) → Save**.
4. After 1–2 minutes it's live at `https://sfu-manhunt.github.io/sfu-manhunt/`.
5. In Firebase, go to **Authentication → Settings → Authorized domains → Add domain** and add `sfu-manhunt.github.io`.

**Before pushing a change to the app,** run `powershell -File tools\bump-version.ps1` in the project folder. It bumps the version in `version.json`, `js/config.js` and `index.html`, so phones on an older copy get an **"A new version is available → Update"** bar.

To update the site later, upload the changed files again the same way. Or install [GitHub Desktop](https://desktop.github.com) to sync the folder with one click.

## 4. Playing on iPhone

- Open the link in **Safari** and allow location when asked. If you denied it, go to Settings → Privacy & Security → Location Services → Safari Websites → "While Using".
- **Keep the app open with the screen on.** iPhone pauses GPS for web pages in the background, and if your position stops updating you'll see a "GPS signal lost" banner. Turn Auto-Lock off (Settings → Display & Brightness) or set it to 5 min.
- Tap the screen once after opening the game so ping sounds can play. iPhones don't support vibration from web pages.
- Optional: Share → **Add to Home Screen** for a full-screen app.

## 5. Wrist device (Arduino UNO R4 WiFi + Grove)

Each hider wears an Arduino UNO R4 WiFi with a Grove Base Shield on the wrist, in a 3D-printed case with a strap. The 16×2 LCD shows:

```
STAGE 2/7   ☺4/5       <- line 1: game stage + people left
Ring closes 4:10       <- line 2: when the ring starts closing
```
While the ring is shrinking:
```
RING CLOSING☺4/5
Done in     0:40       <- how long until it finishes closing
```

- **Line 1, game stage:** `HIDING`, then `STAGE 1/7`, `STAGE 2/7`… (each shrink moves to the next stage), `RING CLOSING` while it shrinks, `FINAL STAGE`, then `HIDERS WIN!` / `SEEKER WINS` / `GAME OVER`.
- **People left (☺4/5):** hiders still in the game (green). When someone turns red (tagged or out of the zone), the count drops and the screen shows **HIDER OUT**.
- **Line 2:** mostly the ring timer. Every few seconds it also shows `Next ping 1:23` and your selected powerup. While the ring is closing and during hiding time, it stays on the timer.
- **Button:** **tap** to show and choose the next powerup (line 2 stays on it for 5 s), **hold** for 0.7 s to use it. A decoy used from the device is placed automatically 150–400 m from you.
- **Backlight (RGB Grove LCD):** blue while hiding, green while playing, orange while the ring closes, red when someone is out or you're pinged, and grey when you're out.
- **Buzzer:**

  | Sound | Meaning |
  |---|---|
  | 4 short beeps + **RING CLOSING!** | The ring is starting to close |
  | 2 beeps + **HIDER OUT** | A hider was tagged or eliminated |
  | 3 long beeps + **PINGED!** | The seeker saw your location |
  | 2 beeps + **PINGED (DECOY)** | They saw your decoy |
  | 1 short beep + **PING BLOCKED** | Your shield hid you |
  | 1 long beep | You're out |

- It also shows the lobby, "YOU'RE OUT", the winner and the meeting point, plus "phone app offline" if the phone stops updating it.

**How it connects:** the R4 joins the wearer's **iPhone hotspot** over Wi-Fi. The wearer's game app writes a small summary to `devices/<DEVICE_ID>/state` in Firebase whenever something changes. The device reads it every 3 s. When you use a powerup, the device writes `devices/<DEVICE_ID>/cmd`, and the phone carries it out. Bluetooth isn't used, because web pages on iPhone can't use it.

### Parts and wiring (Grove, no soldering)

| Part | Grove Base Shield port |
|---|---|
| Grove Button | **D2** |
| Grove Buzzer | **D4** |
| Grove 16×2 I2C LCD | any **I2C** port |

- Set the Base Shield's power switch to **5V**. The Grove LCD needs 5 V.
- Power the R4 from a small USB-C power bank.
- If your LCD is a generic one with a black PCF8574 adapter on the back (not a Grove LCD), set `LCD_TYPE_GROVE 0` in the sketch and connect it to an I2C port with a Grove-to-jumper cable.

### Flash it (Arduino IDE)
1. Install the [Arduino IDE](https://www.arduino.cc/en/software).
2. **Tools → Board → Boards Manager:** install **Arduino UNO R4 Boards**.
3. **Tools → Manage Libraries:** install
   - **ArduinoHttpClient** (by Arduino)
   - **ArduinoJson** (by Benoit Blanchon, version 7)
   - **Grove - LCD RGB Backlight** (by Seeed Studio). Use **LiquidCrystal I2C** instead only if `LCD_TYPE_GROVE` is 0.
4. Open [firmware/wrist_device_r4/wrist_device_r4.ino](firmware/wrist_device_r4/wrist_device_r4.ino) and edit the CONFIG block:
   - `WIFI_SSID` / `WIFI_PASS`: the wearer's hotspot name and password. The name is in Settings → General → About → Name.
   - `DEVICE_ID`: a different ID for each device, e.g. `wrist-01`, `wrist-02`.
5. Connect the R4 by USB-C, choose **Tools → Board → Arduino UNO R4 WiFi** and its port, then click **Upload**.
6. **Tools → Serial Monitor** (115200 baud) shows "Signed in to Firebase".

Troubleshooting:
- **LCD blank or full of blocks:** check the 5V switch and turn the contrast screw if there is one.
- **Generic LCD:** try `LCD_I2C_ADDR 0x3F`.
- **Button reversed:** set `BUTTON_PRESSED LOW`.
- **Stuck on "Signing in…":** update the R4's Wi-Fi firmware with the Arduino IDE's **Tools → Firmware Updater**.

**iPhone hotspot:** the R4 only supports 2.4 GHz Wi-Fi, so turn on **Settings → Personal Hotspot → Maximize Compatibility**. Keep the Personal Hotspot screen open while the device connects the first time.

### Pair it in the game
1. The device shows **NOT PAIRED** and its ID.
2. In the lobby, type that ID into **Wrist device ID**. The device switches to **LOBBY**.
3. Hold the device button. The phone shows "Wrist device works!".

The game app must stay open on the phone, because the phone is what keeps the device updated. It needs to stay open anyway for GPS.

## 6. Tailoring to SFU

- **The coordinates in `js/campus.js` are approximate.** Before playing, open the lobby as host, check the outline against the real campus, and redraw it with **Draw area** if needed. Then use **Copy area as code** and paste the result into `campus.js`.
- Use **Draw off-limits** for roads (Gaglardi Way, University Drive), construction, steep forest edges/trails and parkades.
- Choose a **final safe zone** from the landmarks, or tap the map to set one.

## 7. Before you play (safety and rules)

- **Get permission.** A large organised game may need approval from SFU (e.g. Campus Public Safety, or through a club or the SFSS).
- **Play in daylight** if you can. Burnaby Mountain has roads, steep terrain and wildlife (bears have been seen). Mark the forest edges as off-limits.
- Agree on a **meeting point** and set it in the lobby. Everyone is shown it if the host presses Stop.
- Bring **power banks**. GPS and an always-on screen drain batteries fast.

## Field-test checklist

- [ ] Two iPhones join the same code, and each shows **GPS ✓** in the lobby
- [ ] The play-area outline matches the real campus. Fix it if not.
- [ ] Walk out of the zone: a warning appears after ~3 readings, then the countdown and elimination
- [ ] Indoors: does GPS accuracy get worse, and is the grace period long enough?
- [ ] The ping shows the right positions, and hiders hear it
- [ ] Powerups appear in sensible, reachable places (not in buildings you can't enter)
- [ ] Shield hides you from the next ping; decoy moves your dot
- [ ] Tag → the hider confirms → "Hiders left" goes down
- [ ] Zone shrink timing and ping interval feel right (change them in the lobby Rules)
- [ ] Stop game shows everyone the meeting point
- [ ] Battery after 30 min of play
