# SFU Manhunt

A campus-wide manhunt game for phones (works on iPhone). Hiders hide, and one seeker hunts them. The play area **shrinks over time**. Every few minutes the seeker gets a **ping** showing where the hiders are. Hiders can collect **powerups** that the app places around campus to dodge or fool those pings.

This is a **base version**. Expect to tweak coordinates and timings once you've walked the campus.

## How the game works

| Feature | How it works |
|---|---|
| GPS tracker | Each phone uploads its position every ~4 s. Hiders see only themselves; spectators see everyone. |
| Pings | When hiding time ends, and then every 3 min, the seeker's map shows every alive hider as a red dot for 60 s. Hiders get a sound and a message each time they're pinged. |
| Shrinking zone | The SFU Burnaby outline (or a circle) shrinks in steps toward a final point such as Convocation Mall. A dashed line shows the next zone. |
| Border elimination | If you're outside for 3 GPS readings in a row (with a 15 m buffer), a 30 s countdown starts. Indoors (poor GPS) you get double time. Off-limits zones count as outside. |
| Tagging | The seeker taps **Tag**, picks a hider within 30 m, and the hider confirms on their phone. |
| Powerups | The host's phone drops one every 4 min (max 3 at a time). A hider collects one by walking within 15 m of it. |
| 🛡️ Shield | You're left off the next ping. |
| 🎭 Decoy | You tap anywhere on the map, and the next ping shows you there instead. |
| 🧭 Border Pass | For 90 s you may leave the shrunken zone, as long as you stay inside the **original** border from the start of the game. Off-limits zones still count. |
| Chest device | An Arduino UNO R4 WiFi on your chest with a Grove LCD, button and buzzer. It shows the time to the next ping and to the next zone change, how many hiders are alive, and your powerups. Tap to pick a powerup, hold to use it. It beeps when a ping reveals you. See section 5. In Test mode, "Press chest button" acts like a hold. |
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
firmware/chest_device_r4/  Arduino UNO R4 WiFi chest device sketch (Grove LCD, button, buzzer)
database.rules.json        Firebase security rules
```

## 1. Try it right now (test mode)

```bash
python -m http.server 8080
```

Open http://localhost:8080 and click **Test mode**. Drag the blue dot (or use WASD), walk onto 🛡️/🎭 to collect them, and use the speed buttons. Play as a hider to see SeekerBot get fooled by your decoys and shields.

## 2. Firebase (done)

The project `sfu-manhunt` is set up: anonymous sign-in is on and the config is in `js/config.js`.

**Re-publish the rules:** they changed for powerups and the chest button. In Realtime Database, open the **Rules** tab, paste [`database.rules.json`](database.rules.json) again, and click **Publish**.

Old games stay in the database. Delete the `games` node in the console now and then.

## 3. Publish on GitHub Pages (free HTTPS, needed for GPS on phones)

1. On github.com, click **New repository** and name it `sfu-manhunt`. Make it **Public** (free Pages needs that). Don't add a README.
2. On the empty repository page, click **uploading an existing file**. Drag in everything in this folder (`index.html`, `manifest.json`, `README.md`, `database.rules.json`, `BUILD_PROMPT.md`, `.gitignore`, and the `css` and `js` folders), then click **Commit changes**.
3. Go to **Settings → Pages → Source: Deploy from a branch → `main` / (root) → Save**.
4. After 1–2 minutes it's live at `https://YOURNAME.github.io/sfu-manhunt/`.
5. In Firebase, go to **Authentication → Settings → Authorized domains → Add domain** and add `YOURNAME.github.io`.

To update the site later, upload the changed files again the same way. Or install [GitHub Desktop](https://desktop.github.com) to sync the folder with one click.

## 4. Playing on iPhone

- Open the link in **Safari** and allow location when asked. If you denied it, go to Settings → Privacy & Security → Location Services → Safari Websites → "While Using".
- **Keep the app open with the screen on.** iPhone pauses GPS for web pages in the background, and if your position stops updating you'll see a "GPS signal lost" banner. Turn Auto-Lock off (Settings → Display & Brightness) or set it to 5 min.
- Tap the screen once after opening the game so ping sounds can play. iPhones don't support vibration from web pages.
- Optional: Share → **Add to Home Screen** for a full-screen app.

## 5. Chest device (Arduino UNO R4 WiFi + Grove)

Each hider wears an Arduino UNO R4 WiFi with a Grove Base Shield in a 3D-printed case on an elastic strap. The 16×2 LCD shows:

```
PING 2:53    ☺4/5      <- line 1, always: time to next ping + hiders alive
Zone shrink 9:42       <- line 2 rotates every 3 s between:
>SHIELD          1/3   <-   the zone timer (or "CLOSING! 0:40" / "Hiding 2:10" / "Final zone"),
HIDDEN PASS 1:25       <-   your selected powerup, and active effects (if any)
```

- **Tap** the button to choose the next powerup (line 2 stays on it for 5 s). **Hold** it (0.7 s) to use the selected one. A decoy used from the device is placed automatically 150–400 m from you.
- On the RGB Grove LCD the backlight is green when playing, orange while the zone is closing, red when you're pinged, and grey when you're out.
- **Buzzer:**
  - 3 long beeps + "PINGED!" means the seeker saw your location.
  - 2 beeps means they saw your decoy.
  - 1 short beep means your shield blocked the ping.
  - A tiny chirp 10 s before every ping.
  - A long beep when you're out.
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
4. Open [firmware/chest_device_r4/chest_device_r4.ino](firmware/chest_device_r4/chest_device_r4.ino) and edit the CONFIG block:
   - `WIFI_SSID` / `WIFI_PASS`: the wearer's hotspot name and password. The name is in Settings → General → About → Name.
   - `DEVICE_ID`: a different ID for each device, e.g. `chest-01`, `chest-02`.
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
2. In the lobby, type that ID into **Chest device ID**. The device switches to **LOBBY**.
3. Hold the device button. The phone shows "Chest device works!".

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
