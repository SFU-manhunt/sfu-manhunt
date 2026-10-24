// =====================================================================
// SFU Manhunt – configuration. This is the file you edit most.
// =====================================================================
window.SFU = window.SFU || {};

// ---------------------------------------------------------------------
// 1) FIREBASE CONFIG  <<< PASTE YOUR OWN VALUES HERE >>>
// Firebase console -> Project settings -> Your apps -> Web app -> Config.
// Until this is filled in, only Test mode works.
// ---------------------------------------------------------------------
SFU.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDZS8EsOIZogspxxCchz0nklfidSg5x4jo",
  authDomain: "sfu-manhunt.firebaseapp.com",
  databaseURL: "https://sfu-manhunt-default-rtdb.firebaseio.com",
  projectId: "sfu-manhunt",
  storageBucket: "sfu-manhunt.firebasestorage.app",
  messagingSenderId: "1089567756959",
  appId: "1:1089567756959:web:b59a1c70b83ba7da8088aa"
};

// ---------------------------------------------------------------------
// 2) GAME DEFAULTS. The host can change most of these in the lobby.
// ---------------------------------------------------------------------
SFU.GAME_DEFAULTS = {
  gameDurationMin: 60,       // game length; hiders win when it runs out
  headStartSec: 300,         // hiding time before the seeker is released

  // Zone: waits firstHoldSec, then closes over closeSec, pauses holdSec, closes again...
  firstHoldSec: 600,
  closeSec: 120,
  holdSec: 480,
  shrinkPercent: 75,         // each shrink keeps this % of the previous size
  minScale: 0.2,             // final zone = 20% of the starting size

  // Border fairness (GPS is only accurate to ~5-15 m, worse near buildings)
  borderBufferM: 15,         // extra metres outside the line that still count as inside
  borderStrikesRequired: 3,  // consecutive outside readings before the countdown starts
  graceSec: 30,              // countdown before elimination
  gpsMaxAccuracyM: 60,       // readings worse than this are ignored
  poorAccuracyM: 35,         // readings worse than this count as "indoors"...
  indoorGraceMultiplier: 2,  // ...and get this many times the grace period
  seekerBorderElimination: false, // seeker only gets warnings

  // Tagging
  tagRangeM: 30,
  tagExpireSec: 60,

  // Pings: once per interval the seeker's map shows every alive hider.
  // The first ping happens the moment hiding time ends.
  pingIntervalSec: 180,
  pingShowSec: 60,           // how long the dots stay on the seeker's map
  // If the seeker catches nobody for droughtStartSec, pings speed up through
  // droughtIntervals, one step every droughtStepSec. A catch resets to normal.
  // Default: no catch for 10 min -> every 1:30, 13 min -> every 1:00, 16 min -> every 0:30.
  droughtStartSec: 600,
  droughtStepSec: 180,
  droughtIntervals: [90, 60, 30],
  staleSec: 60,              // positions older than this aren't shown (counted as "hidden")
  positionIntervalSec: 4,    // how often phones upload GPS

  // Powerups (placed by the host's app – see SFU.placePowerup in geo.js)
  powerupEverySec: 240,      // a new one appears this often (from the end of hiding time)
  maxPowerups: 3,            // max on the map at once
  powerupLifetimeSec: 900,   // uncollected ones disappear after this
  pickupRangeM: 15,          // walk this close to collect
  seekerSeesPowerups: true,  // seeker can camp powerups (risky for hiders = fun)
  powerupWeights: { shield: 1, decoy: 1, pass: 1 },
  borderPassSec: 90          // how long a Border Pass lasts
};

// Powerup types. Add new ones here, then handle them in usePowerup() in app.js
// (and add the short name to POWERUP_NAMES in the chest device firmware).
SFU.POWERUPS = {
  shield: { icon: '🛡️', name: 'Shield',      desc: 'You are not shown on the next ping' },
  decoy:  { icon: '🎭', name: 'Decoy',       desc: 'The next ping shows you wherever you choose' },
  pass:   { icon: '🧭', name: 'Border Pass', desc: 'For a short time you may leave the shrunken zone, as long as you stay inside the original border' }
};
