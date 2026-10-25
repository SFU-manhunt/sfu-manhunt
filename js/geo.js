// Geometry, zone schedule and border tracking. No UI in here.
(function () {
  const SFU = window.SFU = window.SFU || {};
  const R = 6371000, K = Math.PI / 180;

  // Firebase sometimes returns arrays as objects; normalise.
  SFU.toArr = v => Array.isArray(v) ? v : Object.values(v || {});

  SFU.haversine = (a, b) => {
    const dLat = (b.lat - a.lat) * K, dLng = (b.lng - a.lng) * K;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * K) * Math.cos(b.lat * K) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  // Flat x/y metres around a reference point (fine at campus scale).
  SFU.toXY = (ref, p) => ({
    x: (p.lng - ref.lng) * K * R * Math.cos(ref.lat * K),
    y: (p.lat - ref.lat) * K * R
  });
  SFU.fromXY = (ref, q) => ({
    lat: ref.lat + q.y / (R * K),
    lng: ref.lng + q.x / (R * K * Math.cos(ref.lat * K))
  });
  SFU.offsetM = (ref, eastM, northM) => SFU.fromXY(ref, { x: eastM, y: northM });

  SFU.circlePolygon = (center, radiusM, n = 48) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n;
      pts.push(SFU.fromXY(center, { x: radiusM * Math.cos(a), y: radiusM * Math.sin(a) }));
    }
    return pts;
  };

  function inPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > pt.y) !== (b.y > pt.y) &&
          pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function edgeDist(p, poly) {
    let m = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) m = Math.min(m, segDist(p, poly[j], poly[i]));
    return m;
  }

  SFU.insideLatLngPoly = (p, polyLL) => {
    const poly = SFU.toArr(polyLL);
    if (poly.length < 3) return false;
    return inPoly(SFU.toXY(poly[0], p), poly.map(v => SFU.toXY(poly[0], v)));
  };

  // A zone = play-area polygon that shrinks (scales) toward the final point.
  SFU.makeZone = (area, anchor, offLimits) => {
    const baseXY = SFU.toArr(area).map(p => SFU.toXY(anchor, p));
    const offXY = SFU.toArr(offLimits).map(o => ({
      name: o.name || 'Off-limits',
      poly: SFU.toArr(o.coords).map(p => SFU.toXY(anchor, p))
    }));
    return {
      anchor,
      polygonAt(s) {
        return baseXY.map(q => SFU.fromXY(anchor, { x: q.x * s, y: q.y * s }));
      },
      // -> { inside, off }  inside includes the GPS buffer; off = name of off-limits zone or null
      check(p, s, bufferM) {
        const q = SFU.toXY(anchor, p);
        const poly = baseXY.map(v => ({ x: v.x * s, y: v.y * s }));
        const inside = poly.length >= 3 && (inPoly(q, poly) || edgeDist(q, poly) <= bufferM);
        let off = null;
        for (const o of offXY) if (o.poly.length >= 3 && inPoly(q, o.poly)) { off = o.name; break; }
        return { inside, off };
      }
    };
  };

  // Zone schedule: hold firstHoldSec, then (close closeSec, hold holdSec) repeated.
  // Also returns step (shrinks finished so far) and steps (total shrinks in a game).
  SFU.scheduleAt = (c, t) => {
    const f = Math.min(0.99, Math.max(0.05, c.shrinkPercent / 100));
    const minS = c.minScale;
    const steps = Math.max(1, Math.ceil(Math.log(minS) / Math.log(f) - 1e-9));
    let time = t - c.firstHoldSec, s = 1, step = 0;
    const final = () => ({ phase: 'final', scale: s, nextScale: null, nextChangeIn: null, step, steps });
    if (time < 0) return { phase: 'hold', scale: 1, nextScale: Math.max(minS, f), nextChangeIn: -time, step, steps };
    for (let guard = 0; guard < 500; guard++) {
      if (s <= minS + 1e-9) return final();
      const target = Math.max(minS, s * f);
      if (time < c.closeSec) {
        return { phase: 'closing', scale: s + (target - s) * (time / c.closeSec), nextScale: target, nextChangeIn: c.closeSec - time, step, steps };
      }
      time -= c.closeSec; s = target; step++;
      if (s <= minS + 1e-9) return final();
      if (time < c.holdSec) return { phase: 'hold', scale: s, nextScale: Math.max(minS, s * f), nextChangeIn: c.holdSec - time, step, steps };
      time -= c.holdSec;
    }
    return final();
  };

  // Random point inside the zone at this scale (not in off-limits), optionally filtered.
  SFU.randomInZone = (zone, scale, ok, tries = 80) => {
    const poly = zone.polygonAt(scale);
    const lats = poly.map(p => p.lat), lngs = poly.map(p => p.lng);
    const s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lngs), e = Math.max(...lngs);
    for (let i = 0; i < tries; i++) {
      const p = { lat: s + Math.random() * (n - s), lng: w + Math.random() * (e - w) };
      const chk = zone.check(p, scale, 0);
      if (chk.inside && !chk.off && (!ok || ok(p))) return p;
    }
    return null;
  };

  // "Placement AI": scores random candidate spots and returns the best one.
  // Good spots are safely inside the zone, survive the next shrink, are not
  // right next to any seeker, are spread out from other powerups, sit about
  // 120 m from the nearest hider (worth the trip but risky), and are often
  // near a landmark. Tweak the weights below to change the feel.
  SFU.placePowerup = ({ zone, scale, nextScale, seekers, hiders, existing, landmarks }) => {
    const minDist = (p, list) => list.length ? Math.min(...list.map(q => SFU.haversine(p, q))) : null;
    let best = null;
    for (let i = 0; i < 60; i++) {
      const p = SFU.randomInZone(zone, scale * 0.92, null, 20);   // keep a margin from the edge
      if (!p) continue;
      let score = Math.random() * 0.8;                            // a little unpredictability
      if (nextScale != null && zone.check(p, nextScale, 0).inside) score += 2;
      const ds = minDist(p, seekers || []);   // nearest seeker
      if (ds != null) {
        if (ds < 60) continue;
        score += Math.min(ds, 300) / 100;
      }
      const dh = minDist(p, hiders);
      if (dh != null) score += 2 - Math.abs(dh - 120) / 80;
      const de = minDist(p, existing);
      if (de != null) { if (de < 80) continue; score += Math.min(de, 250) / 125; }
      if (landmarks.some(l => SFU.haversine(p, l) < 40)) score += 1;
      if (!best || score > best.score) best = { p, score };
    }
    return best && best.p;
  };

  SFU.fmt = sec => {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  };

  // Tracks one player's out-of-bounds state. Only distinct GPS readings
  // (new seq) count, and only after several in a row does the countdown start.
  SFU.BorderTracker = class {
    constructor() { this.strikes = 0; this.oobSince = null; this.reason = null; this.lastSeq = -1; this.poor = false; }

    update(check, acc, seq, c) {
      if (seq !== this.lastSeq && acc <= c.gpsMaxAccuracyM) {
        this.lastSeq = seq;
        this.poor = acc > c.poorAccuracyM;
        if (check.inside && !check.off) {
          this.strikes = 0; this.oobSince = null; this.reason = null;
        } else {
          this.strikes++;
          this.reason = check.off ? 'Off-limits: ' + check.off : 'Outside the zone';
          if (this.strikes >= c.borderStrikesRequired && this.oobSince == null) this.oobSince = Date.now();
        }
      }
      return this.state(c);
    }

    // Pause the countdown (e.g. GPS lost) by pushing the start time forward.
    hold(ms) { if (this.oobSince != null) this.oobSince += ms; }

    state(c) {
      if (this.oobSince == null) return { warn: false };
      const grace = c.graceSec * (this.poor ? c.indoorGraceMultiplier : 1);
      const left = grace - (Date.now() - this.oobSince) / 1000;
      return { warn: true, left, expired: left <= 0, reason: this.reason };
    }
  };
})();
