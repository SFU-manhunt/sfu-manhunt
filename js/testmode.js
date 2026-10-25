// Test mode + Judge demo: in-memory backend and simulated players.
// Test mode lets you try the whole game at a desk with no Firebase, GPS or hardware.
// The judge demo is a scripted 3-minute round with captions (see DEMO below).
(function () {
  const SFU = window.SFU;
  const T = SFU.Test = { active: false, demo: false, role: 'hider' };
  const CODE = 'TEST';
  const $ = id => document.getElementById(id);
  let app = null, db = null, bots = [], timer = null;

  const TEST_CONFIG = {
    headStartSec: 20, pingIntervalSec: 60,
    powerupEverySec: 30, maxPowerups: 3,
    firstHoldSec: 90, closeSec: 40, holdSec: 60,
    graceSec: 10, gameDurationMin: 15, positionIntervalSec: 1
  };

  // ---- Judge demo: everything squeezed into 3 minutes ----
  //  0:00 hiding  ·  0:15 first ping, then every 20 s  ·  0:18 a Shield drops near you
  //  0:40 ring starts closing  ·  ~1:00 a Border Pass drops  ·  1:30 / 2:00 pings speed up
  //  ~2:10 a SeekerBot catches someone (pings reset)  ·  3:00 time's up
  const DEMO_CONFIG = {
    gameDurationMin: 3, headStartSec: 15,
    pingIntervalSec: 20, pingShowSec: 8, pingFadeSec: 2,
    drought1Sec: 75, drought1Gap: 10, drought2Sec: 105, drought2Gap: 6,
    firstHoldSec: 40, closeSec: 15, holdSec: 25, shrinkPercent: 70, minScale: 0.35,
    powerupEverySec: 35, maxPowerups: 2, graceSec: 8, borderPassSec: 25,
    tagExpireSec: 20, positionIntervalSec: 1
  };
  const FEATURES = [
    ['zone', 'Live GPS map + shrinking SFU zone'],
    ['ping', 'Seeker pings (hiders revealed)'],
    ['faster', 'Faster pings when nobody is caught'],
    ['ai', 'AI-placed powerups'],
    ['pickup', 'Collecting a powerup'],
    ['shield', 'Shield hides you from a ping'],
    ['pass', 'Border Pass (leave the shrunken zone)'],
    ['border', 'Out-of-zone elimination'],
    ['tag', 'Tagging + ping reset after a catch'],
    ['device', 'Wrist device (Arduino) live updates']
  ];
  let D = null;   // demo director state

  function moveToward(a, b, m) {
    const q = SFU.toXY(a, b), d = Math.hypot(q.x, q.y);
    if (d <= m) return { lat: b.lat, lng: b.lng };
    return SFU.fromXY(a, { x: q.x / d * m, y: q.y / d * m });
  }

  T.begin = async function (api, role, opts = {}) {
    app = api;
    T.demo = !!opts.demo;
    T.role = role;
    db = SFU.makeLocalDb();
    T.active = true;
    api.useBackend(db, 'me', 'You');
    if (T.demo) {
      api.caption('Starting the judge demo…');
      const now = await api.deviceClock();   // match Firebase's clock so the wrist device stays in sync
      if (now) db.syncTo(now);
    }

    const config = api.defaultConfig('burnaby', T.demo ? DEMO_CONFIG : TEST_CONFIG);
    const area = SFU.toArr(config.area);
    const zone0 = SFU.makeZone(area, config.finalPoint, config.offLimits);

    bots = ['Alice', 'Bob', 'Chen', 'Dana'].map((n, i) => ({ uid: 'bot' + i, name: n, kind: 'hider' }));
    bots.push({ uid: 'drift', name: 'Drifter', kind: 'drifter' });   // walks out of the zone on purpose
    // 3 seekers: three SeekerBots, or you + two SeekerBots when you play as the seeker
    const botSeekers = role === 'seeker' ? 2 : 3;
    for (let i = 1; i <= botSeekers; i++) bots.push({ uid: 'seekbot' + i, name: 'SeekerBot ' + i, kind: 'seeker' });

    const now = Math.round(db.now());
    const players = { me: { name: 'You', role: role === 'spectator' ? 'spectator' : 'hider', status: 'alive', joinedAt: now } };
    for (const b of bots) {
      b.pos = (b.kind === 'drifter' && T.demo ? SFU.randomInZone(zone0, 0.9, p => SFU.haversine(p, config.finalPoint) > 200) : null)
        || SFU.randomInZone(zone0, 0.9) || config.finalPoint;
      b.tracker = new SFU.BorderTracker(); b.seq = 0; b.target = null;
      players[b.uid] = { name: b.name, role: 'hider', status: 'alive', joinedAt: now, lat: b.pos.lat, lng: b.pos.lng, acc: 8, ts: Date.now() };
    }
    const seekers = {};
    for (const b of bots) if (b.kind === 'seeker') seekers[b.uid] = true;
    if (role === 'seeker') seekers.me = true;
    const game = { hostUid: 'me', state: 'lobby', createdAt: now, seekers, config, players };
    if (T.demo) { game.state = 'running'; game.startedAt = now; }   // the demo skips the lobby
    db.set('games/' + CODE, game);
    api.enterGame(CODE);
    const start = SFU.offsetM(config.finalPoint, 0, 60);
    api.onFix({ lat: start.lat, lng: start.lng, acc: 8 });

    document.querySelectorAll('#test-panel .scale').forEach(b => {
      b.classList.toggle('active', b.dataset.scale === '1');
      b.onclick = () => {
        db.setScale(+b.dataset.scale);
        document.querySelectorAll('#test-panel .scale').forEach(x => x.classList.toggle('active', x === b));
      };
    });

    if (T.demo) {
      D = { seen: {}, queue: [], until: 0, lastK: -1, lastGap: null, outs: {}, invCount: 0, pressAt: 0, dropped: {}, closingSeen: false, passSeen: false, spot: null };
      app.caption('');
      say(role === 'spectator'
        ? 'Judge demo: a 3-minute SFU Manhunt round on the Burnaby campus. You are watching every player live.'
        : 'Judge demo: a 3-minute SFU Manhunt round on the Burnaby campus. You are a hider (blue dot); three SeekerBots are hunting.', 7000);
      say('Hiding phase: hiders get a head start before the seeker is released. Everything here also runs live on real phones with GPS.', 7000);
      D.seen.zone = true;
    }
    timer = setInterval(step, 1000);
  };

  T.end = function () {
    clearInterval(timer); timer = null;
    T.active = false; bots = []; db = null;
    if (D) { app.caption(''); D = null; }
  };

  T.features = () => { const s = D ? D.seen : (T._lastSeen || {}); return FEATURES.map(([k, label]) => [label, !!s[k]]); };
  T.noteDevice = () => { if (D) D.seen.device = true; };

  function step() {
    const g = app.getGame();
    if (!g || !db) return;
    const c = app.cfg();
    const running = g.state === 'running';
    const t = running ? (db.now() - g.startedAt) / 1000 : 0;

    if (D && running && T.role === 'hider' && $('demo-auto').checked) autopilot(g, c, t);
    const ll = app.myLatLng();
    if (ll) app.onFix({ lat: ll.lat, lng: ll.lng, acc: 8 });

    const updates = {};
    for (const b of bots) {
      const p = g.players[b.uid];
      if (!p || p.status === 'out') continue;
      if (running) {
        if (b.kind === 'seeker') seekerMove(b, g, c, t, updates);
        else { hiderMove(b, g, c, updates); borderBot(b, c, updates); answerTag(b, g, updates); }
      }
      updates['players/' + b.uid + '/lat'] = +b.pos.lat.toFixed(6);
      updates['players/' + b.uid + '/lng'] = +b.pos.lng.toFixed(6);
      updates['players/' + b.uid + '/acc'] = 8;
      updates['players/' + b.uid + '/ts'] = Date.now();
    }
    if (D && running) director(g, c, t, updates);
    db.update('games/' + CODE, updates);
    if (D) showCaptions();
  }

  // ---------------------------------------------------------------- demo director
  function say(text, ms = 6500) { if (D) D.queue.push({ text, ms }); }

  function showCaptions() {
    if (Date.now() < D.until) return;
    const next = D.queue.shift();
    // when several things happen at once, show each caption for less time so they don't lag behind
    if (next) { app.caption(next.text); D.until = Date.now() + (D.queue.length ? Math.min(next.ms, 4000) : next.ms); }
    else if (D.until) { app.caption(''); D.until = 0; }
  }

  // Drop a powerup a short walk from you (so the demo always shows one being used)
  function drop(type, g, c, updates) {
    const me = g.players.me;
    const near = me && me.lat != null ? me : c.finalPoint;
    const spot = app.randomZoneSpot(p => { const d = SFU.haversine(p, near); return d > 35 && d < 80; }) || app.randomZoneSpot();
    if (!spot) return;
    updates['powerups/demo' + type] = { type, lat: +spot.lat.toFixed(6), lng: +spot.lng.toFixed(6), at: Math.round(db.now()) };
  }

  function director(g, c, t, updates) {
    const me = g.players.me || {};
    const hider = T.role === 'hider';

    // scripted powerup drops for the hider
    if (hider && t >= c.headStartSec + 3 && !D.dropped.shield) { D.dropped.shield = true; drop('shield', g, c, updates); }
    if (hider && t >= 60 && !D.dropped.pass) { D.dropped.pass = true; drop('pass', g, c, updates); }

    // first powerup on the map
    if (!D.seen.ai && Object.keys(g.powerups || {}).length) {
      D.seen.ai = true;
      say('The placement AI drops powerups: inside the zone, away from the seeker, close enough to hiders to be worth the risk.');
    }

    // pings
    const k = app.pingIndex();
    if (k >= 0 && k !== D.lastK) {
      D.lastK = k;
      const gap = app.pingScheduleAt((db.now() - g.startedAt) / 1000).gap;
      if (k === 0) {
        D.seen.ping = true;
        say('PING! The seeker sees every hider on the map for a few seconds. In a real game this happens every 3 minutes.');
      } else if (me.shieldK === k) {
        if (!D.seen.shield) say('Your Shield hid you from that ping: the seekers only saw the other hiders.');
        D.seen.shield = true;
      } else if (me.decoy && me.decoy.k === k) {
        if (!D.decoySaid) say('Your Decoy worked: the seekers saw a fake location for you.');
        D.decoySaid = true;
      } else if (D.lastGap != null && gap < D.lastGap) {
        D.seen.faster = true;
        say(`Nobody has been caught for a while, so pings speed up: now every ${gap} s. (Real game: after 12.5 and 15 minutes.)`);
      }
      D.lastGap = gap;
    }

    // ring closing
    const sch = SFU.scheduleAt(c, t);
    if (sch.phase === 'closing' && !D.closingSeen) {
      D.closingSeen = true;
      say('The ring is closing: the play area shrinks toward Convocation Mall. The wrist device buzzes and counts it down.');
    }

    // eliminations (green -> red)
    for (const [uid, p] of Object.entries(g.players)) {
      if (p.status !== 'out' || D.outs[uid]) continue;
      D.outs[uid] = true;
      if (p.outReason === 'tagged') {
        if (!D.seen.tag) say(`${p.name} was tagged and confirmed it on their phone. A catch resets the ping speed back to normal.`);
        else {
          const left = Object.entries(g.players).filter(([u, q]) => q.status !== 'out' && q.role !== 'spectator' && !(g.seekers || {})[u]).length;
          say(`${p.name} was tagged too. ${left} hiders left.`, 4000);
        }
        D.seen.tag = true;
      } else {
        D.seen.border = true;
        say(`${p.name} stayed outside the zone too long and was eliminated after the grace countdown.`);
      }
    }

    // your powerups
    const inv = Object.keys(me.inv || {}).length;
    if (inv > D.invCount) {
      D.seen.pickup = true;
      const type = Object.values(me.inv)[inv - 1];
      const name = (SFU.POWERUPS[type] || {}).name || 'a powerup';
      D.pickedTypes = D.pickedTypes || {};
      if (!D.pickedTypes[type]) {
        D.pickedTypes[type] = true;
        say(Object.keys(D.pickedTypes).length === 1
          ? `You picked up a ${name}. Pressing the wrist device button uses it, with no need to take out your phone.`
          : `You picked up a ${name}. Using it with the wrist button.`);
      }
      if ($('demo-auto').checked) D.pressAt = Date.now() + 4000;
    }
    D.invCount = inv;
    if (D.pressAt && Date.now() >= D.pressAt) { D.pressAt = 0; app.deviceButtonPressed(); }
    if (me.passUntil && me.passUntil > db.now() && !D.passSeen) {
      D.passSeen = true; D.seen.pass = true;
      say('Border Pass active: for 25 s you can step outside the shrunken zone, but not outside the original border.');
    }

    if (t >= c.gameDurationMin * 60 - 15 && !D.finalSaid) {
      D.finalSaid = true;
      say('Final seconds: the hiders win if anyone survives until time runs out.');
    }
    T._lastSeen = D.seen;
  }

  // Walks "you" to powerups (or a safe spot) so the presenter can just talk
  function autopilot(g, c, t) {
    const ll = app.myLatLng();
    if (!ll || t < 2) return;
    const pos = { lat: ll.lat, lng: ll.lng };
    const pus = Object.values(g.powerups || {}).sort((a, b) => SFU.haversine(pos, a) - SFU.haversine(pos, b));
    let target = pus[0] && SFU.haversine(pos, pus[0]) < 300 ? pus[0] : null;
    if (!target) {
      const ok = p => { const r = app.checkPoint(p); return r.inside && !r.off; };
      if (!D.spot || SFU.haversine(pos, D.spot) < 5 || !ok(D.spot)) D.spot = app.randomZoneSpot(p => SFU.haversine(p, pos) < 120) || c.finalPoint;
      target = D.spot;
    }
    const next = moveToward(pos, target, 3);
    app.onFix({ lat: next.lat, lng: next.lng, acc: 8 });
  }

  // ---------------------------------------------------------------- bots
  function hiderMove(b, g, c, updates) {
    const pus = g.powerups || {};
    if (b.goingFor && !pus[b.goingFor]) { b.goingFor = null; b.target = null; }

    // Sometimes go for a nearby powerup (in the demo, leave the scripted ones for "you")
    if (b.kind === 'hider' && !b.goingFor && Math.random() < 0.15) {
      const near = Object.entries(pus).filter(([id]) => !(T.demo && id.startsWith('demo')))
        .map(([id, pu]) => ({ id, pu, d: SFU.haversine(b.pos, pu) }))
        .filter(x => x.d < 250).sort((x, y) => x.d - y.d)[0];
      if (near) { b.goingFor = near.id; b.target = { lat: near.pu.lat, lng: near.pu.lng }; }
    }

    const okSpot = p => { const r = app.checkPoint(p); return r.inside && !r.off; };
    if (b.kind === 'drifter') b.target = SFU.offsetM(c.finalPoint, 900, -100);
    else if (!b.goingFor && (!b.target || SFU.haversine(b.pos, b.target) < 5 || !okSpot(b.target) || Math.random() < 0.02)) {
      b.target = app.randomZoneSpot() || c.finalPoint;
    }
    const speed = T.demo ? (b.kind === 'drifter' ? 4 : 2) : 1.4;
    b.pos = moveToward(b.pos, b.target, speed * db.scale);

    // Pick up and use straight away
    const pu = b.goingFor && pus[b.goingFor];
    if (pu && SFU.haversine(b.pos, pu) <= c.pickupRangeM) {
      updates['powerups/' + b.goingFor] = null;
      const k = app.nextPingK();
      if (pu.type === 'shield') updates['players/' + b.uid + '/shieldK'] = k;
      else if (pu.type === 'pass') updates['players/' + b.uid + '/passUntil'] = db.now() + c.borderPassSec * 1000;
      else {
        const spot = app.randomZoneSpot() || c.finalPoint;
        updates['players/' + b.uid + '/decoy'] = { k, lat: spot.lat, lng: spot.lng };
      }
      b.goingFor = null; b.target = null;
    }
  }

  function borderBot(b, c, updates) {
    const st = b.tracker.update(app.checkPoint(b.pos, b.uid), 8, ++b.seq, c);
    if (st.expired) {
      updates['players/' + b.uid + '/status'] = 'out';
      updates['players/' + b.uid + '/outReason'] = 'border';
      updates['players/' + b.uid + '/outAt'] = Math.round(db.now());
    }
  }

  function answerTag(b, g, updates) {
    const tg = (g.tags || {})[b.uid];
    if (!tg || tg.status !== 'pending') { b.confirmAt = null; return; }
    if (!b.confirmAt) b.confirmAt = Date.now() + 2000;
    else if (Date.now() >= b.confirmAt) {
      updates['players/' + b.uid + '/status'] = 'out';
      updates['players/' + b.uid + '/outReason'] = 'tagged';
      updates['players/' + b.uid + '/outAt'] = Math.round(db.now());
      updates['tags/' + b.uid + '/status'] = 'confirmed';
      b.confirmAt = null;
    }
  }

  // SeekerBots play fair: they only know what the pings show (so shields and decoys work on them).
  // In the demo they never tag "you", don't tag anyone before ~2:05, then make sure someone is caught.
  function seekerMove(b, g, c, t, updates) {
    if (t < c.headStartSec) return;
    const k = app.pingIndex();
    if (k >= 0 && k !== b.lastK) {
      b.lastK = k;
      const dots = app.computePingDots(k).dots.filter(d => !(T.demo && d.uid === 'me'));
      b.chase = dots.sort((x, y) => SFU.haversine(b.pos, x) - SFU.haversine(b.pos, y))[0] || null;
    }
    let speed = T.demo ? 2.5 : 1.8;
    if (T.demo && t >= 125 && !Object.values(g.players).some(p => p.outReason === 'tagged')) {
      // scripted catch: close in on the nearest bot hider
      const prey = Object.entries(g.players).filter(([uid, p]) => uid.startsWith('bot') && p.status !== 'out' && p.lat != null)
        .map(([uid, p]) => p).sort((x, y) => SFU.haversine(b.pos, x) - SFU.haversine(b.pos, y))[0];
      if (prey) { b.chase = { lat: prey.lat, lng: prey.lng }; speed = 6; }
    }
    if (b.chase) {
      b.pos = moveToward(b.pos, b.chase, speed * db.scale);
      if (SFU.haversine(b.pos, b.chase) < 3) b.chase = null;   // reached the ping spot; wait for the next
    }
    // Tag any hider (real position) within 8 m
    if (T.demo && t < 125) return;   // keep the demo's story: the first catch comes after the ping speed-ups
    for (const [uid, p] of Object.entries(g.players)) {
      if ((g.seekers || {})[uid] || p.role === 'spectator' || p.status === 'out' || p.lat == null || SFU.haversine(b.pos, p) >= 8) continue;
      if (T.demo && uid === 'me') continue;
      const tg = (g.tags || {})[uid];
      const busy = tg && tg.status === 'pending' && Date.now() - tg.ts < c.tagExpireSec * 1000;
      if (!busy && Date.now() > (b.cooldown || 0)) {
        updates['tags/' + uid] = { by: b.uid, ts: Date.now(), status: 'pending' };
        b.cooldown = Date.now() + 15000;
      }
      break;
    }
  }

  // WASD / arrow keys move you 8 m per press
  document.addEventListener('keydown', e => {
    if (!T.active || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const dir = { w: [0, 8], arrowup: [0, 8], s: [0, -8], arrowdown: [0, -8], a: [-8, 0], arrowleft: [-8, 0], d: [8, 0], arrowright: [8, 0] }[e.key.toLowerCase()];
    const ll = app && app.myLatLng();
    if (!dir || !ll) return;
    e.preventDefault();
    const p = SFU.offsetM({ lat: ll.lat, lng: ll.lng }, dir[0], dir[1]);
    app.onFix({ lat: p.lat, lng: p.lng, acc: 8 });
  });
})();
