// Tiny data layer with two backends sharing one API:
//   init() -> uid, now() (game clock), realNow(), on(path, cb) -> unsubscribe,
//   get(path), set(path, v), update(path, obj), remove(path)
(function () {
  const SFU = window.SFU = window.SFU || {};
  const clone = v => v == null ? null : JSON.parse(JSON.stringify(v));
  const split = p => p.split('/').filter(Boolean);

  // ---- Firebase Realtime Database (real games) ----
  SFU.makeFirebaseDb = cfg => {
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    const db = firebase.database();
    let offset = 0;
    db.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; });
    return {
      uid: null,
      async init() {
        const cred = await firebase.auth().signInAnonymously();
        this.uid = cred.user.uid;
        return this.uid;
      },
      now: () => Date.now() + offset,
      realNow: () => Date.now() + offset,
      onConnection(cb) { db.ref('.info/connected').on('value', s => cb(!!s.val())); },
      on(path, cb) {
        const ref = db.ref(path);
        const h = ref.on('value', s => cb(s.val()));
        return () => ref.off('value', h);
      },
      get: path => db.ref(path).once('value').then(s => s.val()),
      set: (path, v) => db.ref(path).set(v),
      update: (path, o) => db.ref(path).update(o),
      remove: path => db.ref(path).remove()
    };
  };

  // ---- In-memory (Test mode). Supports speeding up the game clock. ----
  SFU.makeLocalDb = () => {
    let tree = {};
    const listeners = [];
    let scale = 1, realBase = Date.now(), simBase = Date.now(), queued = false;

    function get(path) {
      let n = tree;
      for (const k of split(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; }
      return n === undefined ? null : n;
    }
    function put(path, val) {
      const ks = split(path);
      let n = tree;
      for (let i = 0; i < ks.length - 1; i++) {
        if (typeof n[ks[i]] !== 'object' || n[ks[i]] === null) n[ks[i]] = {};
        n = n[ks[i]];
      }
      const last = ks[ks.length - 1];
      if (val == null) delete n[last]; else n[last] = clone(val);
    }
    function fire() {
      queued = false;
      for (const l of listeners) {
        const v = get(l.path), s = JSON.stringify(v);
        if (s !== l.last) { l.last = s; l.cb(clone(v)); }
      }
    }
    const schedule = () => { if (!queued) { queued = true; queueMicrotask(fire); } };

    return {
      uid: 'me',
      async init() { return 'me'; },
      now: () => simBase + (Date.now() - realBase) * scale,
      realNow: () => Date.now(),
      get scale() { return scale; },
      setScale(n) { simBase = this.now(); realBase = Date.now(); scale = n; },
      syncTo(now) { simBase = now; realBase = Date.now(); },   // match another clock (e.g. Firebase)
      on(path, cb) {
        const l = { path, cb, last: undefined };
        listeners.push(l);
        schedule();
        return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
      },
      get: async path => clone(get(path)),
      async set(path, v) { put(path, v); schedule(); },
      async update(path, o) {
        for (const [k, v] of Object.entries(o)) put(path + '/' + k, v);
        schedule();
      },
      async remove(path) { put(path, null); schedule(); }
    };
  };
})();
