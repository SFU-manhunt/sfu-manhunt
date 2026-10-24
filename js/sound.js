// Phone sounds (needs one user tap first to unlock on iPhone / mobile browsers).
(function () {
  const SFU = window.SFU = window.SFU || {};
  SFU.Audio = {
    ctx: null,
    unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!this.ctx && AC) this.ctx = new AC();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    beep(ms = 80, freq = 1200, delayMs = 0) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime + delayMs / 1000;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.value = freq; g.gain.value = 0.25;
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t0); o.stop(t0 + ms / 1000);
    },
    ping() { this.beep(120, 1000); this.beep(120, 1400, 180); }
  };
})();
