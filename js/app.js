// SFU Manhunt – UI and game logic.
// Data lives at games/<CODE> = { hostUid, state: lobby|running|ended, seekerUid,
//   startedAt, winner, config: {...}, players: {uid: {...}}, tags: {hiderUid: {...}} }
(function () {
  'use strict';
  const SFU = window.SFU;
  const $ = id => document.getElementById(id);
  const arr = SFU.toArr;
  const clean = o => JSON.parse(JSON.stringify(o));

  // Number settings shown in the lobby: [key, label, step]
  const SETTINGS = [
    ['gameDurationMin', 'Game length (min)', 1],
    ['headStartSec', 'Hiding head start (s)', 10],
    ['pingIntervalSec', 'Ping every (s)', 30],
    ['pingShowSec', 'Ping dots stay (s)', 10],
    ['droughtStartSec', 'No catch: pings speed up after (s)', 30],
    ['droughtStepSec', 'No catch: faster again every (s)', 30],
    ['firstHoldSec', 'First shrink after (s)', 30],
    ['closeSec', 'Each shrink takes (s)', 10],
    ['holdSec', 'Pause between shrinks (s)', 30],
    ['shrinkPercent', 'Each shrink keeps (%)', 5],
    ['powerupEverySec', 'New powerup every (s)', 30],
    ['maxPowerups', 'Max powerups on map', 1],
    ['graceSec', 'Out-of-bounds grace (s)', 5],
    ['borderBufferM', 'Border GPS buffer (m)', 5],
    ['tagRangeM', 'Tag range (m)', 5],
    ['pickupRangeM', 'Pickup range (m)', 5],
    ['borderPassSec', 'Border pass lasts (s)', 10]
  ];

  const S = {
    db: null, test: false, uid: null, name: '', code: null, game: null,
    map: null, layers: {}, meMarker: null, meAcc: null, dragging: false,
    fix: null, fixSeq: 0, geoId: null, geoErr: null,
    tracker: new SFU.BorderTracker(), lastUpload: 0, lastUploadSeq: -1, eliminating: false,
    zone: null, zoneKey: '', zoneDrawKey: '', fitKey: '', screen: 'home',
    phase: 'none', ending: false,
    ping: null, lastPingK: -1, pingDrawn: null, hiderLastK: null,
    lastSpawnGame: 0, picking: {}, pickMode: null, puKey: '',
    devId: '', devUnsub: null, devLast: undefined, devFeedKey: '', devFeedAt: 0, devPing: null,
    tool: 'none', draft: [], wake: null, unsub: null, tickTimer: null,
    pendingTag: null, tagShownFor: null, toastTimer: null
  };

  // ------------------------------------------------------------------ helpers
  const G = () => S.game || {};
  const cfg = () => Object.assign({}, SFU.GAME_DEFAULTS, G().config || {});
  const players = () => G().players || {};
  const me = () => players()[S.uid] || {};
  const isAlive = p => p && p.status !== 'out';
  const amHost = () => G().hostUid === S.uid;
  const elapsedSec = () => (S.db.now() - G().startedAt) / 1000;
  const gamePath = sub => 'games/' + S.code + (sub ? '/' + sub : '');

  function roleOf(uid) {
    const p = players()[uid];
    if (!p) return 'none';
    if (p.role === 'spectator') return 'spectator';
    return uid === G().seekerUid ? 'seeker' : 'hider';
  }
  const myRole = () => roleOf(S.uid);
  const hiderUids = () => Object.keys(players()).filter(u => roleOf(u) === 'hider');

  function toast(msg, ms = 3000) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function modal(title, body, actions) {
    $('modal-title').textContent = title;
    const b = $('modal-body');
    b.innerHTML = '';
    if (typeof body === 'string') b.textContent = body; else b.appendChild(body);
    const a = $('modal-actions');
    a.innerHTML = '';
    for (const x of actions) {
      const btn = el('button', x.label, x.cls);
      btn.onclick = () => { $('modal').hidden = true; if (x.fn) x.fn(); };
      a.appendChild(btn);
    }
    $('modal').hidden = false;
  }

  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function showScreen(name) {
    if (S.screen === name) return;
    S.screen = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    setTimeout(() => S.map && S.map.invalidateSize(), 60);
  }

  const fbConfigured = () => SFU.FIREBASE_CONFIG.apiKey && !SFU.FIREBASE_CONFIG.apiKey.startsWith('YOUR_');
  const homeMsg = m => { $('home-msg').textContent = m || ''; };

  function readName() {
    const n = $('in-name').value.trim();
    if (!n) { homeMsg('Enter your name first.'); return null; }
    try { localStorage.setItem('sfu_name', n); } catch (e) {}
    S.name = n;
    return n;
  }

  // ------------------------------------------------------------------ config
  function defaultConfig(campusId, over) {
    const base = SFU.GAME_DEFAULTS;
    const c = SFU.CAMPUSES[campusId];
    const lm = c.landmarks[0];
    const finalPoint = lm ? { lat: lm.lat, lng: lm.lng } : { lat: c.center.lat, lng: c.center.lng };
    return Object.assign({}, base, over || {}, {
      campus: campusId,
      shape: c.area ? 'polygon' : 'circle',
      circleRadiusM: c.radiusM,
      finalPoint,
      finalName: lm ? lm.name : 'Campus centre',
      area: c.area || SFU.circlePolygon(finalPoint, c.radiusM),
      offLimits: c.offLimits || [],
      meetingPoint: c.meetingPoint || ''
    });
  }

  // Host-only: change config, keeping the circle in sync. Applied locally right away.
  function patchCfg(patch) {
    const preset = SFU.CAMPUSES[cfg().campus];
    if (patch.shape === 'polygon' && !('area' in patch) && preset && preset.area) patch = Object.assign({}, patch, { area: preset.area });
    const next = Object.assign({}, cfg(), patch);
    if (next.shape === 'circle' && (patch.shape || patch.circleRadiusM || patch.finalPoint)) {
      patch = Object.assign({}, patch, { area: SFU.circlePolygon(next.finalPoint, next.circleRadiusM) });
    }
    S.game.config = Object.assign({}, S.game.config, patch);
    S.db.update(gamePath('config'), clean(patch)).catch(e => toast('Save failed: ' + e.message));
    render();
  }

  function applyCampus(id) {
    const d = defaultConfig(id);
    S.fitKey = '';
    patchCfg({ campus: id, shape: d.shape, circleRadiusM: d.circleRadiusM, finalPoint: d.finalPoint,
      finalName: d.finalName, area: d.area, offLimits: d.offLimits, meetingPoint: d.meetingPoint });
  }

  // ------------------------------------------------------------------ backend / joining
  async function ensureBackend() {
    if (S.db) return true;
    if (!fbConfigured()) { homeMsg('Firebase is not configured yet. Use Test mode, or see the README.'); return false; }
    try {
      S.db = SFU.makeFirebaseDb(SFU.FIREBASE_CONFIG);
      S.uid = await S.db.init();
      return true;
    } catch (e) {
      S.db = null;
      homeMsg('Could not connect to Firebase: ' + e.message);
      return false;
    }
  }

  function randomCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  async function createGame() {
    const name = readName();
    if (!name || !await ensureBackend()) return;
    SFU.Audio.unlock();
    let lastErr;
    for (let i = 0; i < 5; i++) {
      const code = randomCode();
      const game = {
        hostUid: S.uid, state: 'lobby', createdAt: S.db.realNow(),
        config: defaultConfig('burnaby'),
        players: { [S.uid]: { name, role: $('in-spectate').checked ? 'spectator' : 'hider', status: 'alive', joinedAt: S.db.realNow() } }
      };
      try { await S.db.set('games/' + code, clean(game)); enterGame(code); return; } catch (e) { lastErr = e; }
    }
    homeMsg('Could not create a game (check your Firebase rules): ' + (lastErr && lastErr.message));
  }

  async function joinGame() {
    const name = readName();
    const code = $('in-code').value.trim().toUpperCase();
    if (!name) return;
    if (code.length < 4) { homeMsg('Enter the game code.'); return; }
    if (!await ensureBackend()) return;
    SFU.Audio.unlock();
    try {
      const g = await S.db.get('games/' + code);
      if (!g) { homeMsg('No game with code ' + code + '.'); return; }
      if (!(g.players && g.players[S.uid])) {
        if (g.state !== 'lobby') { homeMsg('That game has already started.'); return; }
        await S.db.set('games/' + code + '/players/' + S.uid, { name, role: 'hider', status: 'alive', joinedAt: S.db.realNow() });
      }
      enterGame(code);
    } catch (e) { homeMsg('Could not join: ' + e.message); }
  }

  function enterGame(code) {
    S.code = code; S.phase = 'none'; S.ending = false; S.game = null; S.fitKey = ''; S.zoneDrawKey = '';
    if (!S.test) try { localStorage.setItem('sfu_code', code); } catch (e) {}
    initMap();
    startGeo();
    if (S.unsub) S.unsub();
    S.unsub = S.db.on('games/' + code, g => {
      if (!g) { leaveGame('The game no longer exists.'); return; }
      S.game = g;
      render();
    });
    clearInterval(S.tickTimer);
    S.tickTimer = setInterval(tick, 1000);
    $('device-row').hidden = S.test;
    let dev = '';
    try { dev = localStorage.getItem('sfu_device') || ''; } catch (e) {}
    $('in-device').value = dev;
    linkDevice(dev);
  }

  // ------------------------------------------------------------------ chest device
  // Phone -> device: this app writes a small summary to devices/<id>/state
  //   whenever it changes (the Arduino polls it and shows it on its screen).
  // Device -> phone: the Arduino writes devices/<id>/cmd = { ts, use: <powerup id> }.
  //   We react to changes after subscribing (the first value is just the old command).
  function linkDevice(id) {
    if (S.devUnsub) { S.devUnsub(); S.devUnsub = null; }
    S.devId = (id || '').trim();
    S.devLast = undefined; S.devFeedKey = '';
    try { localStorage.setItem('sfu_device', S.devId); } catch (e) {}
    const status = $('device-status');
    status.textContent = '';
    if (!S.devId || !S.db || S.test) return;
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(S.devId)) { status.textContent = 'Use only letters, numbers, - and _'; return; }
    status.textContent = 'Linked to "' + S.devId + '". Hold the device button to test it.';
    S.devUnsub = S.db.on('devices/' + S.devId + '/cmd', v => {
      const ts = v && v.ts;
      if (S.devLast === undefined) { S.devLast = ts; return; }
      if (ts === S.devLast) return;
      S.devLast = ts;
      if (S.phase !== 'running') { toast('Chest device works! (' + S.devId + ')'); SFU.Audio.beep(150, 900); return; }
      const type = v.use && (me().inv || {})[v.use];
      if (type && myRole() === 'hider' && isAlive(me())) usePowerup(v.use, type, true);
      else deviceButtonPressed();
    });
    publishDevice(true);
  }

  function deviceFeed() {
    const g = G(), c = cfg(), p = me(), hs = hiderUids();
    const f = {
      name: p.name || '', role: myRole(), game: g.state || 'lobby', status: isAlive(p) ? 'alive' : 'out',
      alive: hs.filter(u => isAlive(players()[u])).length, total: hs.length,
      inv: Object.entries(p.inv || {}).map(([id, type]) => ({ id, type })),
      passUntil: p.passUntil || 0
    };
    if (g.state === 'running' && g.startedAt) {
      const t = elapsedSec(), sch = SFU.scheduleAt(c, t), nk = nextPingK(t, c);
      f.hidingUntil = t < c.headStartSec ? g.startedAt + c.headStartSec * 1000 : 0;
      f.nextPingAt = g.startedAt + pingSchedule(t, c).nextAt * 1000;
      f.zonePhase = sch.phase;
      f.zoneAt = sch.nextChangeIn == null ? 0 : Math.round((g.startedAt + (t + sch.nextChangeIn) * 1000) / 1000) * 1000;
      f.endsAt = g.startedAt + c.gameDurationMin * 60000;
      f.shieldNext = p.shieldK != null && p.shieldK >= nk;
      f.decoyNext = !!(p.decoy && p.decoy.k >= nk);
    }
    if (S.devPing) f.lastPing = S.devPing;
    if (g.state === 'ended') { f.winner = g.winner || ''; f.meeting = c.meetingPoint || ''; }
    return f;
  }

  function publishDevice(force) {
    if (!S.devId || S.test || !S.db || !S.game || !/^[A-Za-z0-9_-]{1,32}$/.test(S.devId)) return;
    const f = deviceFeed();
    const key = JSON.stringify(f);
    if (!force && key === S.devFeedKey && Date.now() - S.devFeedAt < 30000) return;
    S.devFeedKey = key; S.devFeedAt = Date.now();
    S.db.set('devices/' + S.devId + '/state', Object.assign(f, { ts: Math.round(S.db.now()) }))
      .catch(e => console.warn('device feed failed', e));
  }

  function leaveGame(msg) {
    if (S.unsub) S.unsub();
    S.unsub = null;
    if (S.devUnsub) { S.devUnsub(); S.devUnsub = null; }
    clearInterval(S.tickTimer);
    releaseWake();
    S.pickMode = null; $('pick-bar').hidden = true;
    S.ping = null; S.pingDrawn = null; S.puKey = '';
    if (S.geoId != null) { navigator.geolocation.clearWatch(S.geoId); S.geoId = null; }
    if (SFU.Test) SFU.Test.end();
    if (S.test) { S.db = null; S.uid = null; S.test = false; }
    try { localStorage.removeItem('sfu_code'); } catch (e) {}
    S.game = null; S.code = null; S.phase = 'none'; S.fix = null;
    if (S.meMarker) { S.meMarker.remove(); S.meMarker = null; }
    if (S.meAcc) { S.meAcc.remove(); S.meAcc = null; }
    if (S.map) Object.values(S.layers).forEach(l => l.clearLayers());
    setTool('none');
    showScreen('home');
    homeMsg(msg || '');
  }

  // ------------------------------------------------------------------ GPS
  function startGeo() {
    if (S.test || S.geoId != null) return;
    if (!navigator.geolocation) { S.geoErr = 'This browser has no GPS support'; return; }
    S.geoId = navigator.geolocation.watchPosition(
      p => { S.geoErr = null; onFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
      e => { S.geoErr = e.code === 1 ? 'Location permission denied – allow it in browser settings' : 'GPS error: ' + e.message; },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
  }

  function onFix(f) {
    S.fixSeq++;
    S.fix = { lat: f.lat, lng: f.lng, acc: f.acc, seq: S.fixSeq, ts: Date.now() };
    updateMeMarker();
  }

  function uploadPos() {
    if (!S.fix || myRole() === 'spectator' || myRole() === 'none') return;
    if (S.fix.seq === S.lastUploadSeq) return;
    if (Date.now() - S.lastUpload < cfg().positionIntervalSec * 1000) return;
    S.lastUpload = Date.now(); S.lastUploadSeq = S.fix.seq;
    S.db.update(gamePath('players/' + S.uid), {
      lat: +S.fix.lat.toFixed(6), lng: +S.fix.lng.toFixed(6), acc: Math.round(S.fix.acc), ts: S.db.realNow()
    }).catch(e => console.warn('upload failed', e));
  }

  function updateGpsChip() {
    const chip = $('lobby-gps');
    if (S.test) chip.textContent = 'Test mode: drag the blue dot or use WASD';
    else if (S.geoErr) chip.textContent = 'GPS: ' + S.geoErr;
    else if (!S.fix) chip.textContent = 'GPS: waiting…';
    else chip.textContent = 'GPS: OK (±' + Math.round(S.fix.acc) + ' m)';
  }

  async function requestWake() {
    try { if (navigator.wakeLock) S.wake = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
  function releaseWake() { try { if (S.wake) S.wake.release(); } catch (e) {} S.wake = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.phase === 'running') requestWake();
  });

  // ------------------------------------------------------------------ map
  function initMap() {
    if (S.map) return;
    const c = SFU.CAMPUSES.burnaby;
    S.map = L.map('map', { zoomControl: false }).setView([c.center.lat, c.center.lng], c.zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(S.map);
    ['zone', 'marks', 'pu', 'players', 'ping', 'draft'].forEach(k => { S.layers[k] = L.layerGroup().addTo(S.map); });
    S.map.on('click', onMapClick);
  }

  function buildZone() {
    const c = cfg();
    const key = JSON.stringify([c.area, c.finalPoint, c.offLimits]);
    if (key !== S.zoneKey) {
      S.zoneKey = key;
      S.zone = (arr(c.area).length >= 3 && c.finalPoint) ? SFU.makeZone(c.area, c.finalPoint, c.offLimits) : null;
    }
    return S.zone;
  }

  function drawZone(scale, nextScale) {
    const c = cfg();
    buildZone();
    const key = [S.zoneKey, scale.toFixed(3), nextScale == null ? '' : nextScale.toFixed(3), c.campus, S.phase].join('|');
    if (!S.zone || key === S.zoneDrawKey) return;
    S.zoneDrawKey = key;
    const zl = S.layers.zone, ml = S.layers.marks;
    zl.clearLayers(); ml.clearLayers();
    const ll = poly => poly.map(p => [p.lat, p.lng]);
    const now = ll(S.zone.polygonAt(scale));
    const world = [[-85, -180], [-85, 180], [85, 180], [85, -180]];
    L.polygon([world, now], { stroke: false, fillColor: '#A6192E', fillOpacity: 0.28, interactive: false }).addTo(zl);
    L.polygon(now, { color: '#A6192E', weight: 3, fill: false, interactive: false }).addTo(zl);
    if (nextScale != null && nextScale < scale - 0.001) {
      L.polygon(ll(S.zone.polygonAt(nextScale)), { color: '#fff', weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(zl);
    }
    for (const o of arr(c.offLimits)) {
      L.polygon(ll(arr(o.coords)), { color: '#d97706', weight: 2, fillColor: '#d97706', fillOpacity: 0.35, interactive: false })
        .bindTooltip(o.name || 'Off-limits').addTo(zl);
    }
    const camp = SFU.CAMPUSES[c.campus];
    if (camp) for (const lm of camp.landmarks) {
      L.circleMarker([lm.lat, lm.lng], { radius: 3, color: '#555', weight: 1, fillOpacity: 0.8, interactive: false })
        .bindTooltip(lm.name, { permanent: S.phase === 'lobby', direction: 'right', className: 'lm-label' }).addTo(ml);
    }
    L.circleMarker([c.finalPoint.lat, c.finalPoint.lng], { radius: 6, color: '#A6192E', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false })
      .bindTooltip('Final zone: ' + (c.finalName || ''), { direction: 'top' }).addTo(ml);

    const fk = S.zoneKey + S.phase;
    if (fk !== S.fitKey) {
      S.fitKey = fk;
      // Keep the area visible above the lobby sheet / below the game HUD
      const bottom = S.phase === 'lobby' && amHost() ? window.innerHeight * 0.58 : 150;
      S.map.fitBounds(L.latLngBounds(ll(S.zone.polygonAt(1))), { paddingTopLeft: [20, 80], paddingBottomRight: [20, bottom] });
    }
  }

  function updateMeMarker() {
    if (!S.map || !S.fix) return;
    const ll = [S.fix.lat, S.fix.lng];
    if (!S.meMarker) {
      S.meMarker = L.marker(ll, { draggable: S.test, zIndexOffset: 1000, icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(S.map);
      S.meMarker.on('dragstart', () => { S.dragging = true; });
      S.meMarker.on('dragend', () => { S.dragging = false; });
      S.meAcc = L.circle(ll, { radius: S.fix.acc, color: '#1a73e8', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(S.map);
    } else if (!S.dragging) {
      S.meMarker.setLatLng(ll);
    }
    S.meAcc.setLatLng(ll); S.meAcc.setRadius(S.fix.acc);
  }

  // Only spectators/host-spectators see other players.
  function updatePlayerMarkers() {
    const pl = S.layers.players;
    if (!pl) return;
    pl.clearLayers();
    if (myRole() !== 'spectator') return;
    for (const [uid, p] of Object.entries(players())) {
      if (p.lat == null || roleOf(uid) === 'spectator') continue;
      const role = roleOf(uid);
      const col = !isAlive(p) ? '#999' : role === 'seeker' ? '#A6192E' : '#1f8a4c';
      L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 })
        .bindTooltip(p.name + (role === 'seeker' ? ' (seeker)' : ''), { permanent: true, direction: 'right', className: 'lm-label' })
        .addTo(pl);
    }
  }

  // ------------------------------------------------------------------ lobby (host tools)
  function onMapClick(e) {
    const p = { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) };
    if (S.phase === 'running' && S.pickMode) { setDecoy(S.pickMode.id, p); return; }
    if (S.phase !== 'lobby' || !amHost()) return;
    if (S.tool === 'final') { patchCfg({ finalPoint: p, finalName: 'Custom point' }); setTool('none'); }
    else if (S.tool === 'area' || S.tool === 'off') { S.draft.push(p); drawDraft(); }
  }

  function setTool(t) {
    S.tool = t; S.draft = [];
    document.querySelectorAll('#tool-btns button').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    $('draw-controls').hidden = !(t === 'area' || t === 'off');
    $('draw-hint').textContent = t === 'area' ? 'Tap the map to outline the play area.' : 'Tap the map to outline an off-limits zone.';
    if (t === 'final') toast('Tap the map to set the final safe point');
    drawDraft();
  }

  function drawDraft() {
    const d = S.layers.draft;
    if (!d) return;
    d.clearLayers();
    if (!S.draft.length) return;
    const ll = S.draft.map(p => [p.lat, p.lng]);
    L.polyline(ll.concat(ll.length > 2 ? [ll[0]] : []), { color: S.tool === 'off' ? '#d97706' : '#1a73e8', weight: 3, dashArray: '4 4', interactive: false }).addTo(d);
    ll.forEach(p => L.circleMarker(p, { radius: 4, interactive: false }).addTo(d));
  }

  function finishDraw() {
    if (S.draft.length < 3) { toast('Tap at least 3 points'); return; }
    if (S.tool === 'area') {
      patchCfg({ area: S.draft.slice(), shape: 'polygon', campus: 'custom' });
    } else {
      const name = prompt('Name for this off-limits zone?', 'Off-limits') || 'Off-limits';
      patchCfg({ offLimits: arr(cfg().offLimits).concat([{ name, coords: S.draft.slice() }]) });
    }
    setTool('none');
  }

  function exportArea() {
    const c = cfg();
    const fmt = p => `{ lat: ${p.lat}, lng: ${p.lng} }`;
    const txt = 'area: [\n  ' + arr(c.area).map(fmt).join(',\n  ') + '\n],\noffLimits: ' +
      JSON.stringify(arr(c.offLimits).map(o => ({ name: o.name, coords: arr(o.coords) })), null, 2);
    const pre = el('textarea'); pre.value = txt; pre.rows = 10; pre.style.width = '100%';
    modal('Paste this into js/campus.js', pre, [{ label: 'Close' }]);
    try { navigator.clipboard.writeText(txt); toast('Copied to clipboard'); } catch (e) {}
  }

  function buildHostControls() {
    const sel = $('cfg-campus');
    for (const [id, c] of Object.entries(SFU.CAMPUSES)) sel.add(new Option(c.name, id));
    sel.add(new Option('Custom (drawn on map)', 'custom'));
    sel.onchange = () => { if (sel.value !== 'custom') applyCampus(sel.value); };
    $('cfg-shape').onchange = e => patchCfg({ shape: e.target.value });
    $('cfg-radius').onchange = e => { const v = +e.target.value; if (v >= 20) patchCfg({ circleRadiusM: v }); };
    $('cfg-final').onchange = e => {
      const lm = (SFU.CAMPUSES[cfg().campus] || { landmarks: [] }).landmarks[+e.target.value];
      if (lm) patchCfg({ finalPoint: { lat: lm.lat, lng: lm.lng }, finalName: lm.name });
    };
    $('cfg-meeting').onchange = e => patchCfg({ meetingPoint: e.target.value.trim() });
    document.querySelectorAll('#tool-btns button').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
    $('btn-draw-undo').onclick = () => { S.draft.pop(); drawDraft(); };
    $('btn-draw-cancel').onclick = () => setTool('none');
    $('btn-draw-finish').onclick = finishDraw;
    $('btn-clear-off').onclick = () => patchCfg({ offLimits: [] });
    $('btn-export').onclick = exportArea;
    $('btn-use-loc').onclick = () => {
      if (!S.fix) { toast('No GPS position yet'); return; }
      patchCfg({ finalPoint: { lat: +S.fix.lat.toFixed(6), lng: +S.fix.lng.toFixed(6) }, finalName: 'Host location' });
    };
    const grid = $('cfg-grid');
    for (const [key, label, step] of SETTINGS) {
      const lab = el('label', label + ' ');
      const inp = el('input');
      inp.type = 'number'; inp.step = step; inp.min = 0; inp.dataset.key = key;
      inp.onchange = () => { const v = parseFloat(inp.value); if (!isNaN(v)) patchCfg({ [key]: v }); };
      lab.appendChild(inp); grid.appendChild(lab);
    }
    $('btn-start').onclick = startGame;
  }

  function setVal(id, v) { const e = $(id); if (document.activeElement !== e && e.value !== String(v)) e.value = v; }

  function syncHostControls() {
    const c = cfg();
    setVal('cfg-campus', c.campus);
    setVal('cfg-shape', c.shape);
    setVal('cfg-radius', c.circleRadiusM);
    setVal('cfg-meeting', c.meetingPoint || '');
    $('row-radius').hidden = c.shape !== 'circle';
    $('cfg-shape').options[0].disabled = !(SFU.CAMPUSES[c.campus] || {}).area && c.campus !== 'custom';
    const fin = $('cfg-final');
    const lms = (SFU.CAMPUSES[c.campus] || { landmarks: [] }).landmarks;
    const key = c.campus + lms.length;
    if (fin.dataset.key !== key) {
      fin.dataset.key = key; fin.innerHTML = '';
      lms.forEach((lm, i) => fin.add(new Option(lm.name, i)));
      fin.add(new Option('Custom point (use map tool)', 'custom'));
    }
    const idx = lms.findIndex(lm => lm.name === c.finalName);
    setVal('cfg-final', idx >= 0 ? idx : 'custom');
    document.querySelectorAll('#cfg-grid input').forEach(inp => {
      if (document.activeElement !== inp) inp.value = c[inp.dataset.key];
    });
  }

  function renderLobby() {
    showScreen('lobby');
    const host = amHost();
    $('lobby-code').textContent = S.code;
    $('host-controls').hidden = !host;
    $('guest-msg').hidden = host;
    $('screen-lobby').classList.toggle('full', !host);
    updateGpsChip();

    const ul = $('lobby-players');
    ul.innerHTML = '';
    for (const [uid, p] of Object.entries(players())) {
      const li = el('li');
      const left = el('span', p.name);
      if (uid === S.uid) left.appendChild(el('span', 'you', 'tag'));
      if (uid === G().hostUid) left.appendChild(el('span', 'host', 'tag'));
      if (p.role === 'spectator') left.appendChild(el('span', 'spectating', 'tag'));
      if (p.lat != null) left.appendChild(el('span', 'GPS ✓', 'tag'));
      li.appendChild(left);
      const role = roleOf(uid);
      if (host && role !== 'spectator') {
        const b = el('button', role === 'seeker' ? 'Seeker ✓' : 'Make seeker', 'small' + (role === 'seeker' ? ' active' : ''));
        b.onclick = () => S.db.update(gamePath(), { seekerUid: uid });
        li.appendChild(b);
      } else {
        li.appendChild(el('span', role, 'small muted'));
      }
      ul.appendChild(li);
    }
    if (host) syncHostControls();
    drawZone(1, null);
  }

  function startGame() {
    const seeker = G().seekerUid;
    if (!seeker || roleOf(seeker) !== 'seeker') { $('lobby-msg').textContent = 'Pick a seeker first.'; return; }
    if (!hiderUids().length) { $('lobby-msg').textContent = 'Need at least one hider.'; return; }
    if (!buildZone()) { $('lobby-msg').textContent = 'The play area is not set.'; return; }
    $('lobby-msg').textContent = '';
    setTool('none');
    S.db.update(gamePath(), { state: 'running', startedAt: Math.round(S.db.now()), winner: null });
  }

  // ------------------------------------------------------------------ game
  function startSession() {
    S.tracker = new SFU.BorderTracker();
    S.ending = false; S.eliminating = false;
    S.pendingTag = null; S.zoneDrawKey = '';
    S.ping = null; S.pingDrawn = null; S.hiderLastK = null; S.lastSpawnGame = 0;
    S.picking = {}; S.pickMode = null; S.puKey = '';
    S.lastPingK = -1; S.devPing = null;
    try { S.lastPingK = +(localStorage.getItem(pingStoreKey()) || -1); } catch (e) {}
    requestWake();
  }

  function endSession() {
    releaseWake();
    S.pickMode = null; $('pick-bar').hidden = true;
    S.layers.ping.clearLayers(); S.layers.pu.clearLayers();
  }

  function renderGame() {
    showScreen('game');
    const role = myRole(), p = me(), c = cfg();
    const badge = $('hud-role');
    badge.textContent = role === 'seeker' ? 'SEEKER' : role === 'hider' ? (isAlive(p) ? 'HIDER' : 'OUT') : 'SPECTATOR';
    badge.className = 'badge ' + role;
    const hs = hiderUids();
    $('hud-alive').textContent = 'Hiders left: ' + hs.filter(u => isAlive(players()[u])).length + '/' + hs.length;

    $('seeker-panel').hidden = role !== 'seeker';
    $('hider-panel').hidden = role !== 'hider';
    $('spec-list').hidden = role !== 'spectator';
    $('host-panel').hidden = !amHost();
    $('test-panel').hidden = !S.test;
    $('btn-chest').hidden = !(S.test && role === 'hider');

    if (role === 'hider') {
      const m = $('hider-msg');
      if (isAlive(p)) { m.className = ''; m.textContent = 'Stay hidden and inside the red line. Walk onto 🛡️/🎭 to collect powerups.'; }
      else { m.className = 'out'; m.textContent = 'You are out (' + (p.outReason === 'tagged' ? 'tagged' : 'left the zone') + '). Please do not help the other hiders.'; }
      $('hider-ping').hidden = $('inv').hidden = $('effects').hidden = !isAlive(p);
      if (isAlive(p)) renderInventory();
    }
    if (role === 'spectator') renderSpecList();
    checkIncomingTag();
    checkTagResult();
  }

  function renderSpecList() {
    const box = $('spec-list');
    box.innerHTML = '';
    const now = S.db.realNow();
    for (const [uid, p] of Object.entries(players())) {
      const role = roleOf(uid);
      if (role === 'spectator') continue;
      const row = el('div');
      row.appendChild(el('span', p.name + (role === 'seeker' ? ' (seeker)' : ''), isAlive(p) ? '' : 'out'));
      const age = p.ts ? Math.round((now - p.ts) / 1000) + 's ago' : 'no GPS';
      row.appendChild(el('span', isAlive(p) ? age : (p.outReason || 'out'), 'muted'));
      box.appendChild(row);
    }
  }

  function tick() {
    if (!S.game) return;
    if (S.phase === 'lobby') updateGpsChip();
    uploadPos();
    publishDevice(false);
    if (S.phase !== 'running') return;
    const c = cfg(), t = elapsedSec();
    const sch = SFU.scheduleAt(c, t);
    drawZone(sch.scale, sch.nextScale);
    renderHud(t, c, sch);
    borderCheck(sch, c);
    const role = myRole();
    if (role === 'seeker') { seekerPingTick(t, c); drawPing(c); }
    if (role === 'hider' && isAlive(me())) { hiderPingTick(t, c); pickupTick(c); }
    if (amHost()) { hostPowerupTick(t, c, sch); winCheck(t, c); }
    drawPowerups(c);
    if (myRole() === 'spectator') { updatePlayerMarkers(); renderSpecList(); }
    checkTagResult();
  }

  function renderHud(t, c, sch) {
    $('hud-time').textContent = SFU.fmt(c.gameDurationMin * 60 - t) + ' left';
    const z = $('hud-zone');
    let txt;
    if (t < c.headStartSec) txt = 'Hiding time: seeker released in ' + SFU.fmt(c.headStartSec - t);
    else if (sch.phase === 'closing') txt = 'ZONE CLOSING – ' + SFU.fmt(sch.nextChangeIn);
    else if (sch.phase === 'hold') txt = 'Zone shrinks in ' + SFU.fmt(sch.nextChangeIn) + ' (dashed line = next zone)';
    else txt = 'Final zone: ' + (c.finalName || '');
    z.textContent = txt;
    z.className = 'small' + (sch.phase === 'closing' ? ' closing' : '');

    const role = myRole(), hiding = t < c.headStartSec;
    if (role === 'seeker') {
      $('ping-main').textContent = hiding ? SFU.fmt(c.headStartSec - t) : 'Next ping ' + SFU.fmt(nextPingIn(t, c));
      const faster = hiding ? '' : fasterNote(t, c);
      $('ping-sub').textContent = hiding ? 'Wait here. The first ping comes when hiding time ends.' : pingSummary(c) + (faster ? ' · ' + faster : '');
      $('btn-tag').disabled = hiding;
    }
    if (role === 'hider') {
      const faster = hiding ? '' : fasterNote(t, c);
      $('hider-ping').textContent = (hiding ? 'First ping in ' : 'Next ping in ') + SFU.fmt(nextPingIn(t, c)) + (faster ? ' · ' + faster : '');
    }
  }

  function borderCheck(sch, c) {
    const w = $('warn'), role = myRole(), p = me();
    if (role === 'spectator' || !isAlive(p) || !S.zone) { w.hidden = true; return; }
    if (!S.fix || Date.now() - S.fix.ts > 20000) {
      S.tracker.hold(1000);
      w.hidden = false; w.className = 'warn soft';
      w.textContent = S.geoErr || 'GPS signal lost – go outside / keep the app open';
      return;
    }
    // Border Pass: only the original (full-size) border counts until it runs out
    const passLeft = p.passUntil ? (p.passUntil - S.db.now()) / 1000 : 0;
    const st = S.tracker.update(S.zone.check(S.fix, passLeft > 0 ? 1 : sch.scale, c.borderBufferM), S.fix.acc, S.fix.seq, c);
    if (!st.warn) {
      if (passLeft > 0) {
        w.hidden = false; w.className = 'warn soft';
        w.textContent = '🧭 Border pass: ' + SFU.fmt(passLeft) + ' left. Stay inside the original border.';
      } else w.hidden = true;
      return;
    }
    const elim = role === 'hider' || c.seekerBorderElimination;
    w.hidden = false; w.className = 'warn';
    w.textContent = st.reason + (elim ? ' – get back in ' + Math.max(0, Math.ceil(st.left)) + 's!' : ' – please go back (warning only)');
    if (navigator.vibrate) navigator.vibrate(200);
    if (st.expired && elim && !S.eliminating) {
      S.eliminating = true;
      S.db.update(gamePath('players/' + S.uid), { status: 'out', outReason: 'border', outAt: Math.round(S.db.now()) });
    }
  }

  function winCheck(t, c) {
    if (S.ending || G().state !== 'running') return;
    const hs = hiderUids();
    if (hs.length && !hs.some(u => isAlive(players()[u]))) endGame('seeker');
    else if (t >= c.gameDurationMin * 60) endGame('hiders');
  }

  function endGame(winner) {
    if (S.ending) return;
    S.ending = true;
    S.db.update(gamePath(), { state: 'ended', winner, endedAt: S.db.realNow() })
      .catch(e => { S.ending = false; toast('Could not end game: ' + e.message); });
  }

  // ------------------------------------------------------------------ pings
  // Ping schedule. Ping k = 0 is the moment hiding ends. After that the gap is
  // pingIntervalSec, but when the seeker hasn't caught anyone for droughtStartSec
  // the gap shrinks through droughtIntervals (one step every droughtStepSec).
  // A catch (confirmed tag) resets it. Every client computes the same schedule
  // from the game start time and the catch times (players' outAt).
  function catchTimes() {
    const start = G().startedAt;
    return Object.values(players()).filter(p => p.outReason === 'tagged' && p.outAt).map(p => (p.outAt - start) / 1000);
  }

  // The gap the seeker should currently get between pings, at game time t
  function pingGapAt(t, c, catches) {
    let lastCatch = c.headStartSec;
    for (const x of catches) if (x <= t && x > lastCatch) lastCatch = x;
    const dry = t - lastCatch;
    const steps = arr(c.droughtIntervals);
    if (dry < c.droughtStartSec || !steps.length) return c.pingIntervalSec;
    const i = Math.min(steps.length - 1, Math.floor((dry - c.droughtStartSec) / c.droughtStepSec));
    return Math.min(c.pingIntervalSec, steps[i]);
  }

  // -> { k (index of the last ping, -1 before the first), lastAt, nextAt, gap } in game seconds
  function pingSchedule(t, c) {
    const catches = catchTimes();
    const key = [Math.floor(t), G().startedAt, catches.join(','), c.headStartSec, c.pingIntervalSec,
      c.droughtStartSec, c.droughtStepSec, arr(c.droughtIntervals).join(',')].join('|');
    if (S.pingMemo && S.pingMemo.key === key) return S.pingMemo.val;
    let val;
    if (t < c.headStartSec) val = { k: -1, lastAt: null, nextAt: c.headStartSec, gap: c.pingIntervalSec };
    else {
      // the next ping fires as soon as the time since the last one reaches the current gap
      const nextAfter = prev => { let s = 1; while (s < pingGapAt(prev + s, c, catches)) s++; return prev + s; };
      let k = 0, at = c.headStartSec, next = nextAfter(at);
      while (next <= t) { at = next; k++; next = nextAfter(at); }
      val = { k, lastAt: at, nextAt: next, gap: pingGapAt(t, c, catches) };
    }
    S.pingMemo = { key, val };
    return val;
  }

  const pingIndex = (t, c) => pingSchedule(t, c).k;
  const nextPingK = (t, c) => pingSchedule(t, c).k + 1;
  const nextPingIn = (t, c) => pingSchedule(t, c).nextAt - t;
  const fasterNote = (t, c) => {
    const gap = pingSchedule(t, c).gap;
    return gap < c.pingIntervalSec ? 'Pings every ' + SFU.fmt(gap) + ' (no catch for a while)' : '';
  };
  const pingStoreKey = () => 'sfu_ping_' + S.code + '_' + G().startedAt;

  // What the seeker sees on ping k: shields hide you, decoys move your dot.
  function computePingDots(k) {
    const c = cfg(), now = S.db.realNow();
    const dots = [];
    let hidden = 0;
    for (const uid of hiderUids()) {
      const p = players()[uid];
      if (!isAlive(p)) continue;
      if (p.shieldK === k) { hidden++; continue; }
      if (p.decoy && p.decoy.k === k) { dots.push({ uid, name: p.name, lat: p.decoy.lat, lng: p.decoy.lng }); continue; }
      if (p.lat == null || !p.ts || now - p.ts > c.staleSec * 1000) { hidden++; continue; }
      dots.push({ uid, name: p.name, lat: p.lat, lng: p.lng });
    }
    return { dots, hidden };
  }

  function seekerPingTick(t, c) {
    const k = pingIndex(t, c);
    if (k < 0 || k <= S.lastPingK) return;
    S.lastPingK = k;
    try { localStorage.setItem(pingStoreKey(), k); } catch (e) {}
    const r = computePingDots(k);
    S.ping = { k, atGame: S.db.now(), dots: r.dots, hidden: r.hidden };
    SFU.Audio.ping();
    if (navigator.vibrate) navigator.vibrate([100, 60, 100]);
    toast('PING! ' + r.dots.length + ' hider(s) on the map' + (r.hidden ? ', ' + r.hidden + ' hidden' : ''));
  }

  function pingSummary(c) {
    if (!S.ping) return 'No ping yet.';
    const age = (S.db.now() - S.ping.atGame) / 1000;
    return 'Last ping ' + SFU.fmt(age) + ' ago: ' + S.ping.dots.length + ' shown' + (S.ping.hidden ? ', ' + S.ping.hidden + ' hidden' : '') +
      (age < c.pingShowSec ? ' (dots fade in ' + SFU.fmt(c.pingShowSec - age) + ')' : '');
  }

  function drawPing(c) {
    const visible = S.ping && (S.db.now() - S.ping.atGame) / 1000 < c.pingShowSec;
    const key = visible ? S.ping.k : null;
    if (key === S.pingDrawn) return;
    S.pingDrawn = key;
    const l = S.layers.ping;
    l.clearLayers();
    if (!visible) return;
    for (const d of S.ping.dots) {
      L.marker([d.lat, d.lng], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="ping-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) })
        .bindTooltip(d.name, { permanent: true, direction: 'right', className: 'lm-label' }).addTo(l);
    }
  }

  function hiderPingTick(t, c) {
    const k = pingIndex(t, c);
    if (k < 0 || k === S.hiderLastK) return;
    const fresh = t - pingSchedule(t, c).lastAt < 3;
    const first = S.hiderLastK == null;
    S.hiderLastK = k;
    if (first && !fresh) return;   // joined/reloaded mid-interval: don't announce an old ping
    const p = me();
    // Tell the chest device so it can buzz
    S.devPing = { k, result: p.shieldK === k ? 'blocked' : (p.decoy && p.decoy.k === k) ? 'decoy' : 'seen', at: Math.round(S.db.now()) };
    publishDevice(true);
    const msg = p.shieldK === k ? '🛡️ Ping blocked – the seeker did not see you'
      : (p.decoy && p.decoy.k === k) ? '🎭 Ping! The seeker saw your decoy'
      : 'PING! The seeker just saw your location';
    SFU.Audio.ping();
    if (navigator.vibrate) navigator.vibrate([100, 60, 100]);
    toast(msg, 4000);
    renderInventory();
  }

  // ------------------------------------------------------------------ powerups
  function hostPowerupTick(t, c, sch) {
    if (t < c.headStartSec || !S.zone) return;
    const now = S.db.now(), live = [];
    for (const [id, pu] of Object.entries(G().powerups || {})) {
      if (now - pu.at > c.powerupLifetimeSec * 1000 || !S.zone.check(pu, sch.scale, 0).inside) S.db.remove(gamePath('powerups/' + id));
      else live.push(pu);
    }
    if (live.length >= c.maxPowerups || now - S.lastSpawnGame < c.powerupEverySec * 1000) return;
    S.lastSpawnGame = now;
    const sk = players()[G().seekerUid];
    const hiders = hiderUids().map(u => players()[u]).filter(p => isAlive(p) && p.lat != null);
    const spot = SFU.placePowerup({
      zone: S.zone, scale: sch.scale, nextScale: sch.nextScale,
      seeker: sk && sk.lat != null ? sk : null, hiders, existing: live,
      landmarks: (SFU.CAMPUSES[c.campus] || { landmarks: [] }).landmarks
    });
    if (!spot) return;
    const id = 'p' + Math.round(now).toString(36) + Math.random().toString(36).slice(2, 5);
    S.db.set(gamePath('powerups/' + id), { type: pickType(c), lat: +spot.lat.toFixed(6), lng: +spot.lng.toFixed(6), at: Math.round(now) });
  }

  function pickType(c) {
    const w = Object.entries(c.powerupWeights || {}).filter(([type, n]) => SFU.POWERUPS[type] && n > 0);
    let r = Math.random() * w.reduce((s, [, n]) => s + n, 0);
    for (const [type, n] of w) { if ((r -= n) <= 0) return type; }
    return w.length ? w[0][0] : 'shield';
  }

  function drawPowerups(c) {
    const show = myRole() !== 'seeker' || c.seekerSeesPowerups;
    const pus = show ? (G().powerups || {}) : {};
    const key = JSON.stringify(pus);
    if (key === S.puKey) return;
    S.puKey = key;
    const l = S.layers.pu;
    l.clearLayers();
    for (const pu of Object.values(pus)) {
      const d = SFU.POWERUPS[pu.type];
      if (!d) continue;
      L.marker([pu.lat, pu.lng], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="pu">' + d.icon + '</div>', iconSize: [32, 32], iconAnchor: [16, 16] }) })
        .addTo(l);
    }
  }

  function pickupTick(c) {
    if (!S.fix) return;
    for (const [id, pu] of Object.entries(G().powerups || {})) {
      if (S.picking[id] || SFU.haversine(S.fix, pu) > c.pickupRangeM) continue;
      S.picking[id] = true;
      const d = SFU.POWERUPS[pu.type] || { icon: '', name: pu.type };
      S.db.update(gamePath(), { ['powerups/' + id]: null, ['players/' + S.uid + '/inv/' + id]: pu.type })
        .then(() => { toast('Picked up ' + d.icon + ' ' + d.name + '!'); SFU.Audio.beep(150, 900); });
    }
  }

  function renderInventory() {
    if (myRole() !== 'hider' || !G().startedAt) return;
    const p = me(), c = cfg(), nk = nextPingK(elapsedSec(), c);
    const eff = [];
    if (p.shieldK != null && p.shieldK >= nk) eff.push('🛡️ Shield on: hidden from the next ping');
    if (p.decoy && p.decoy.k >= nk) eff.push('🎭 Decoy set for the next ping');
    if (p.passUntil && p.passUntil > S.db.now()) eff.push('🧭 Border pass active');
    $('effects').textContent = eff.join(' · ');
    const box = $('inv');
    box.innerHTML = '';
    for (const [id, type] of Object.entries(p.inv || {})) {
      const d = SFU.POWERUPS[type];
      if (!d) continue;
      const b = el('button', d.icon + ' Use ' + d.name, 'small');
      b.title = d.desc;
      b.onclick = () => usePowerup(id, type, false);
      box.appendChild(b);
    }
    if (!box.children.length) box.appendChild(el('span', 'No powerups yet.', 'muted small'));
  }

  // auto = triggered by the chest button (no screen): decoys get placed automatically.
  function usePowerup(id, type, auto) {
    const c = cfg(), k = nextPingK(elapsedSec(), c), p = me();
    if (type === 'shield') {
      if (p.shieldK === k) { toast('Shield is already on for the next ping'); return; }
      S.db.update(gamePath('players/' + S.uid), { shieldK: k, ['inv/' + id]: null });
      toast('🛡️ Shield on: you are hidden from the next ping');
    } else if (type === 'pass') {
      if (p.passUntil && p.passUntil > S.db.now()) { toast('A border pass is already active'); return; }
      S.db.update(gamePath('players/' + S.uid), { passUntil: Math.round(S.db.now() + c.borderPassSec * 1000), ['inv/' + id]: null });
      toast('🧭 Border pass: you may leave the zone for ' + SFU.fmt(c.borderPassSec) + ' (stay inside the original border)', 4000);
    } else if (type === 'decoy') {
      if (auto) {
        const spot = S.zone && S.fix && SFU.randomInZone(S.zone, SFU.scheduleAt(c, elapsedSec()).scale,
          q => { const d = SFU.haversine(q, S.fix); return d > 150 && d < 400; });
        if (spot) setDecoy(id, spot); else toast('Could not find a decoy spot');
      } else {
        S.pickMode = { id };
        $('pick-bar').hidden = false;
      }
    }
  }

  function setDecoy(id, p) {
    const k = nextPingK(elapsedSec(), cfg());
    S.db.update(gamePath('players/' + S.uid), { decoy: { k, lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }, ['inv/' + id]: null });
    S.pickMode = null;
    $('pick-bar').hidden = true;
    toast('🎭 Decoy placed: the next ping shows you there');
  }

  // Chest device hook: one press uses a shield if you have one, otherwise a decoy.
  // The hardware (not built yet) will trigger this; Test mode has a button for it.
  function deviceButtonPressed() {
    if (S.phase !== 'running' || myRole() !== 'hider' || !isAlive(me())) return;
    const inv = Object.entries(me().inv || {});
    if (!inv.length) { toast('Chest button: no powerups to use'); return; }
    const pick = inv.find(([, type]) => type === 'shield') || inv[0];
    usePowerup(pick[0], pick[1], true);
  }

  // ------------------------------------------------------------------ tagging
  function openTagModal() {
    const c = cfg();
    if (!S.fix) { toast('No GPS position yet'); return; }
    const now = S.db.realNow();
    const near = hiderUids().map(u => ({ uid: u, p: players()[u] }))
      .filter(x => isAlive(x.p) && x.p.lat != null && now - x.p.ts < c.staleSec * 1000)
      .map(x => Object.assign(x, { d: SFU.haversine(S.fix, x.p) }))
      .filter(x => x.d <= c.tagRangeM)
      .sort((a, b) => a.d - b.d);
    if (!near.length) { modal('Tag', 'No hider within ' + c.tagRangeM + ' m (by GPS). Get closer, or wait a few seconds for positions to update.', [{ label: 'OK' }]); return; }
    modal('Who did you tag?', 'They will be asked to confirm.', near.map(x => ({
      label: x.p.name + ' (~' + Math.round(x.d) + ' m)', cls: 'primary',
      fn: () => {
        S.pendingTag = { uid: x.uid, ts: S.db.realNow() };
        S.db.set(gamePath('tags/' + x.uid), { by: S.uid, ts: S.pendingTag.ts, status: 'pending' });
        toast('Waiting for ' + x.p.name + ' to confirm…');
      }
    })).concat([{ label: 'Cancel' }]));
  }

  function checkIncomingTag() {
    if (myRole() !== 'hider' || !isAlive(me())) return;
    const tg = (G().tags || {})[S.uid];
    if (!tg || tg.status !== 'pending' || S.tagShownFor === tg.ts) return;
    if (S.db.realNow() - tg.ts > cfg().tagExpireSec * 1000) return;
    S.tagShownFor = tg.ts;
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    const by = (players()[tg.by] || {}).name || 'The seeker';
    modal('Were you tagged?', by + ' says they tagged you. Be honest!', [
      { label: 'Yes, I\'m out', cls: 'primary', fn: () => S.db.update(gamePath(), {
        ['players/' + S.uid + '/status']: 'out', ['players/' + S.uid + '/outReason']: 'tagged',
        ['players/' + S.uid + '/outAt']: Math.round(S.db.now()), ['tags/' + S.uid + '/status']: 'confirmed' }) },
      { label: 'No', fn: () => S.db.update(gamePath('tags/' + S.uid), { status: 'declined' }) }
    ]);
  }

  function checkTagResult() {
    const pt = S.pendingTag;
    if (!pt) return;
    const tg = (G().tags || {})[pt.uid];
    const name = (players()[pt.uid] || {}).name || 'Hider';
    if (tg && tg.ts === pt.ts && tg.status === 'confirmed') { toast('Tagged ' + name + '!'); S.pendingTag = null; }
    else if (tg && tg.ts === pt.ts && tg.status === 'declined') { toast(name + ' says you missed.'); S.pendingTag = null; }
    else if (S.db.realNow() - pt.ts > cfg().tagExpireSec * 1000) { toast(name + ' did not respond.'); S.pendingTag = null; }
  }

  // ------------------------------------------------------------------ end
  function renderEnd() {
    showScreen('end');
    const g = G(), c = cfg();
    const hs = hiderUids();
    const left = hs.filter(u => isAlive(players()[u]));
    const title = $('end-title'), body = $('end-body');
    title.style.color = '';
    if (g.winner === 'seeker') { title.textContent = 'Seeker wins!'; body.textContent = 'All hiders were found.'; }
    else if (g.winner === 'hiders') { title.textContent = 'Hiders win!'; body.textContent = left.length + ' hider(s) survived until time ran out.'; }
    else {
      title.textContent = 'GAME STOPPED'; title.style.color = 'var(--red)';
      body.textContent = 'The host stopped the game. Go to the meeting point: ' + (c.meetingPoint || 'ask the host') + '.';
    }
    const ul = $('end-list');
    ul.innerHTML = '';
    for (const [uid, p] of Object.entries(players())) {
      const role = roleOf(uid);
      if (role === 'spectator') continue;
      const li = el('li');
      li.appendChild(el('span', p.name + (role === 'seeker' ? ' (seeker)' : ''), isAlive(p) || role === 'seeker' ? '' : 'out'));
      li.appendChild(el('span', role === 'seeker' ? '' : isAlive(p) ? 'survived' : (p.outReason || 'out'), 'muted small'));
      ul.appendChild(li);
    }
  }

  // ------------------------------------------------------------------ main render
  function render() {
    const g = S.game;
    if (!g) return;
    const phase = g.state === 'running' ? 'running' : g.state === 'ended' ? 'ended' : 'lobby';
    if (phase !== S.phase) {
      const prev = S.phase;
      S.phase = phase;
      S.zoneDrawKey = ''; S.fitKey = '';
      if (phase === 'running') startSession();
      if (phase === 'ended' && prev === 'running') endSession();
    }
    if (phase === 'lobby') renderLobby();
    else if (phase === 'running') { renderGame(); tickNowOnce(); }
    else renderEnd();
    updatePlayerMarkers();
  }

  let tickedOnce = false;
  function tickNowOnce() { if (!tickedOnce) { tickedOnce = true; setTimeout(() => { tick(); tickedOnce = false; }, 0); } }

  // ------------------------------------------------------------------ wiring
  function wire() {
    try {
      $('in-name').value = localStorage.getItem('sfu_name') || '';
    } catch (e) {}
    $('fb-warn').hidden = fbConfigured();
    $('btn-create').onclick = createGame;
    $('btn-join').onclick = joinGame;
    $('btn-test').onclick = () => {
      SFU.Audio.unlock();
      modal('Test mode', 'Play as which role? Simulated players move around the Burnaby campus.', [
        { label: 'Seeker', cls: 'primary', fn: () => SFU.Test.begin(api, 'seeker') },
        { label: 'Hider', fn: () => SFU.Test.begin(api, 'hider') },
        { label: 'Cancel' }
      ]);
    };
    $('btn-leave').onclick = () => leaveGame();
    $('btn-home').onclick = () => leaveGame();
    $('btn-tag').onclick = openTagModal;
    $('btn-pick-cancel').onclick = () => { S.pickMode = null; $('pick-bar').hidden = true; };
    $('btn-chest').onclick = deviceButtonPressed;
    $('in-device').onchange = e => linkDevice(e.target.value);
    // iPhone only allows sound after a tap; unlock on any tap (also after a reload).
    document.addEventListener('pointerdown', () => SFU.Audio.unlock());
    $('btn-stop').onclick = () => modal('Stop the game for everyone?', 'Everyone will be told to go to: ' + (cfg().meetingPoint || 'the meeting point'), [
      { label: 'Stop game', cls: 'primary', fn: () => endGame('stopped') }, { label: 'Cancel' }
    ]);
    $('btn-recenter').onclick = () => { if (S.fix && S.map) S.map.setView([S.fix.lat, S.fix.lng], Math.max(S.map.getZoom(), 17)); };
    buildHostControls();

    // Rejoin after a refresh
    let saved = null;
    try { saved = localStorage.getItem('sfu_code'); } catch (e) {}
    if (saved && fbConfigured()) {
      ensureBackend().then(ok => ok && S.db.get('games/' + saved)).then(g => {
        if (g && g.players && g.players[S.uid] && g.state !== 'ended') enterGame(saved);
      }).catch(() => {});
    }
  }

  // Hooks used by testmode.js
  const api = {
    useBackend(db, uid, name) { S.db = db; S.uid = uid; S.name = name; S.test = true; },
    enterGame, onFix, defaultConfig,
    getGame: () => S.game,
    cfg,
    myLatLng: () => S.meMarker ? S.meMarker.getLatLng() : null,
    checkPoint(p, uid) {
      const z = buildZone();
      if (!z || !S.game || !S.game.startedAt) return { inside: true, off: null };
      const sch = SFU.scheduleAt(cfg(), elapsedSec());
      const pl = uid && players()[uid];
      const pass = pl && pl.passUntil && S.db.now() < pl.passUntil;
      return z.check(p, pass ? 1 : sch.scale, cfg().borderBufferM);
    },
    scaleNow() { return S.game && S.game.state === 'running' ? SFU.scheduleAt(cfg(), elapsedSec()).scale : 1; },
    pingIndex: () => pingIndex(elapsedSec(), cfg()),
    nextPingK: () => nextPingK(elapsedSec(), cfg()),
    pingScheduleAt: t => pingSchedule(t, cfg()),
    computePingDots,
    randomZoneSpot() { const z = buildZone(); return z && SFU.randomInZone(z, api.scaleNow()); },
    deviceButtonPressed,
    db: () => S.db
  };
  SFU.app = api;

  wire();
})();
