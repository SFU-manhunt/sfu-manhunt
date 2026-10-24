// Test mode: in-memory backend and simulated players.
// Lets you try the whole game at a desk with no Firebase, GPS or hardware.
(function () {
  const SFU = window.SFU;
  const T = SFU.Test = { active: false };
  const CODE = 'TEST';
  let app = null, db = null, bots = [], timer = null;

  function moveToward(a, b, m) {
    const q = SFU.toXY(a, b), d = Math.hypot(q.x, q.y);
    if (d <= m) return { lat: b.lat, lng: b.lng };
    return SFU.fromXY(a, { x: q.x / d * m, y: q.y / d * m });
  }

  T.begin = function (api, role) {
    app = api;
    db = SFU.makeLocalDb();
    T.active = true;
    api.useBackend(db, 'me', 'You');

    // Short timings so a whole game fits in a few minutes (use the speed buttons too).
    const config = api.defaultConfig('burnaby', {
      headStartSec: 20, pingIntervalSec: 60, pingShowSec: 20,
      powerupEverySec: 30, maxPowerups: 3,
      firstHoldSec: 90, closeSec: 40, holdSec: 60,
      graceSec: 10, gameDurationMin: 15, positionIntervalSec: 1
    });
    const area = SFU.toArr(config.area);
    const zone0 = SFU.makeZone(area, config.finalPoint, config.offLimits);

    bots = ['Alice', 'Bob', 'Chen', 'Dana'].map((n, i) => ({ uid: 'bot' + i, name: n, kind: 'hider' }));
    bots.push({ uid: 'drift', name: 'Drifter', kind: 'drifter' });   // walks out of the zone on purpose
    if (role === 'hider') bots.push({ uid: 'seekbot', name: 'SeekerBot', kind: 'seeker' });

    const now = Date.now();
    const players = { me: { name: 'You', role: 'hider', status: 'alive', joinedAt: now } };
    for (const b of bots) {
      b.pos = SFU.randomInZone(zone0, 0.9) || config.finalPoint;
      b.tracker = new SFU.BorderTracker(); b.seq = 0; b.target = null;
      players[b.uid] = { name: b.name, role: 'hider', status: 'alive', joinedAt: now, lat: b.pos.lat, lng: b.pos.lng, acc: 8, ts: now };
    }
    db.set('games/' + CODE, { hostUid: 'me', state: 'lobby', createdAt: now, seekerUid: role === 'seeker' ? 'me' : 'seekbot', config, players });
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
    timer = setInterval(step, 1000);
  };

  T.end = function () {
    clearInterval(timer); timer = null;
    T.active = false; bots = []; db = null;
  };

  function step() {
    const g = app.getGame();
    if (!g || !db) return;
    const ll = app.myLatLng();
    if (ll) app.onFix({ lat: ll.lat, lng: ll.lng, acc: 8 });

    const c = app.cfg();
    const running = g.state === 'running';
    const t = running ? (db.now() - g.startedAt) / 1000 : 0;
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
    db.update('games/' + CODE, updates);
  }

  function hiderMove(b, g, c, updates) {
    const pus = g.powerups || {};
    if (b.goingFor && !pus[b.goingFor]) { b.goingFor = null; b.target = null; }

    // Sometimes go for a nearby powerup
    if (b.kind === 'hider' && !b.goingFor && Math.random() < 0.15) {
      const near = Object.entries(pus).map(([id, pu]) => ({ id, pu, d: SFU.haversine(b.pos, pu) }))
        .filter(x => x.d < 250).sort((x, y) => x.d - y.d)[0];
      if (near) { b.goingFor = near.id; b.target = { lat: near.pu.lat, lng: near.pu.lng }; }
    }

    const okSpot = p => { const r = app.checkPoint(p); return r.inside && !r.off; };
    if (b.kind === 'drifter') b.target = SFU.offsetM(c.finalPoint, 900, -100);
    else if (!b.goingFor && (!b.target || SFU.haversine(b.pos, b.target) < 5 || !okSpot(b.target) || Math.random() < 0.02)) {
      b.target = app.randomZoneSpot() || c.finalPoint;
    }
    b.pos = moveToward(b.pos, b.target, 1.4 * db.scale);

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

  // SeekerBot plays fair: it only knows what the pings show (so shields and decoys work on it).
  function seekerMove(b, g, c, t, updates) {
    if (t < c.headStartSec) return;
    const k = app.pingIndex();
    if (k >= 0 && k !== b.lastK) {
      b.lastK = k;
      const dots = app.computePingDots(k).dots;
      b.chase = dots.sort((x, y) => SFU.haversine(b.pos, x) - SFU.haversine(b.pos, y))[0] || null;
    }
    if (b.chase) {
      b.pos = moveToward(b.pos, b.chase, 1.8 * db.scale);
      if (SFU.haversine(b.pos, b.chase) < 3) b.chase = null;   // reached the ping spot; wait for the next
    }
    // Tag anyone (real position) within 8 m
    for (const [uid, p] of Object.entries(g.players)) {
      if (uid === b.uid || p.status === 'out' || p.lat == null || SFU.haversine(b.pos, p) >= 8) continue;
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
