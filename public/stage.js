/* Beans&Beats "stage": the ready board as part of the DJ set.
 * - Audio-reactive visuals: listens to the booth's music through the laptop
 *   mic (Web Audio analyser) and pulses bars, glow and snow on the beat.
 *   Without a mic it runs a gentle synthetic 120 BPM groove.
 * - Ready takeover: a fresh order drops in full-screen, on the beat.
 * - Voice call-out (speechSynthesis): "Order forty-two, Mei, your iced oat
 *   flat white is ready." Works offline, no external service.
 * - Confetti for charity milestones.
 * Everything runs on-device; no audio ever leaves the laptop. */
(function () {
  'use strict';
  const RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const St = {
    canvas: null, ctx: null, w: 0, h: 0, dpr: 1, raf: 0,
    audio: null, analyser: null, freq: null, mic: false, started: false,
    beat: 0, bass: 0, avgBass: 0.15, lastBeat: 0,
    snow: [], confetti: [],
    voice: localStorage.getItem('bb.stage.voice') !== 'off',
    queue: [], showing: false,
  };
  const t0 = performance.now();

  function size() {
    if (!St.canvas) return;
    St.dpr = Math.min(2, window.devicePixelRatio || 1);
    St.w = St.canvas.clientWidth; St.h = St.canvas.clientHeight;
    St.canvas.width = St.w * St.dpr; St.canvas.height = St.h * St.dpr;
    St.ctx.setTransform(St.dpr, 0, 0, St.dpr, 0, 0);
  }
  function seedSnow() {
    St.snow = [];
    const n = Math.round(Math.min(160, St.w * St.h / 9000));
    for (let i = 0; i < n; i++) St.snow.push({ x: Math.random() * St.w, y: Math.random() * St.h, r: 0.6 + Math.random() * 2.2, s: 0.25 + Math.random() * 0.8, d: Math.random() * Math.PI * 2 });
  }

  // ---- audio
  function ensureAudio() {
    if (!St.audio) {
      St.audio = new (window.AudioContext || window.webkitAudioContext)();
      St.analyser = St.audio.createAnalyser(); St.analyser.fftSize = 256; St.analyser.smoothingTimeConstant = 0.78;
      St.freq = new Uint8Array(St.analyser.frequencyBinCount);
    }
    if (St.audio.state === 'suspended') St.audio.resume();
    return St.audio;
  }
  async function useMic() {
    ensureAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
      St.audio.createMediaStreamSource(stream).connect(St.analyser);
      St.mic = true; return true;
    } catch (e) { St.mic = false; return false; }
  }
  function sample(t) {
    // Returns 64 band levels 0..1 and a bass level.
    const bands = new Array(64);
    if (St.mic && St.analyser) {
      St.analyser.getByteFrequencyData(St.freq);
      for (let i = 0; i < 64; i++) {
        const a = Math.floor(Math.pow(i / 64, 1.6) * 110), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / 64, 1.6) * 110));
        let m = 0; for (let k = a; k < b; k++) m = Math.max(m, St.freq[k]);
        bands[i] = m / 255;
      }
      let bass = 0; for (let k = 1; k < 6; k++) bass += St.freq[k]; bass /= 5 * 255;
      return { bands, bass };
    }
    // Synthetic groove: 120 BPM kick + swaying mids. Calm enough for a lobby.
    const beatT = (t / 500) % 1, kick = Math.exp(-beatT * 7);
    for (let i = 0; i < 64; i++) {
      const x = i / 64;
      bands[i] = Math.max(0, 0.18 + 0.22 * Math.sin(t / 900 + i * 0.45) * Math.sin(t / 1700 + i * 0.13) + kick * 0.55 * Math.exp(-x * 5) + 0.06 * Math.sin(t / 130 + i));
    }
    return { bands, bass: 0.2 + kick * 0.6 };
  }

  // ---- draw loop
  function frame(now) {
    St.raf = 0;
    if (!St.canvas || !St.canvas.isConnected) return; // board left the screen
    const t = now - t0, c = St.ctx, W = St.w, H = St.h;
    const { bands, bass } = sample(t);
    St.avgBass = St.avgBass * 0.97 + bass * 0.03;
    if (bass > St.avgBass * 1.32 && bass > 0.28 && t - St.lastBeat > 280) { St.lastBeat = t; St.beat = 1; }
    St.beat *= 0.9; St.bass = bass;
    document.documentElement.style.setProperty('--beat', St.beat.toFixed(3));

    c.clearRect(0, 0, W, H);
    // Glow that breathes with the bass.
    const gx = W * 0.78, gy = H * 0.18, gr = Math.max(W, H) * (0.45 + bass * 0.18);
    const g = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, 'rgba(250,97,5,' + (0.10 + St.beat * 0.12) + ')'); g.addColorStop(1, 'rgba(250,97,5,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const g2 = c.createRadialGradient(W * 0.12, H * 0.95, 0, W * 0.12, H * 0.95, W * 0.5);
    g2.addColorStop(0, 'rgba(255,255,255,' + (0.035 + bass * 0.04) + ')'); g2.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g2; c.fillRect(0, 0, W, H);

    // Equaliser along the bottom edge, mirrored from the centre.
    const n = 64, gap = W / (n * 2), bw = gap * 0.56, maxH = H * 0.2;
    for (let i = 0; i < n; i++) {
      const v = bands[i], bh = Math.max(2, v * v * maxH * 1.4);
      const a = 0.08 + v * 0.32;
      c.fillStyle = 'rgba(250,97,5,' + a.toFixed(3) + ')';
      const xr = W / 2 + i * gap + (gap - bw) / 2, xl = W / 2 - (i + 1) * gap + (gap - bw) / 2;
      c.fillRect(xr, H - bh, bw, bh); c.fillRect(xl, H - bh, bw, bh);
    }

    // Snow. Falls a little faster on the beat.
    c.fillStyle = 'rgba(255,255,255,0.75)';
    for (const f of St.snow) {
      f.y += f.s * (1 + St.beat * 1.6); f.x += Math.sin(t / 1400 + f.d) * 0.3;
      if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; }
      c.globalAlpha = 0.25 + f.r / 4;
      c.beginPath(); c.arc(f.x, f.y, f.r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;

    // Confetti bursts.
    if (St.confetti.length) {
      for (const p of St.confetti) {
        p.vy += 0.12; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 1;
        c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
        c.fillStyle = p.col; c.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); c.restore();
      }
      St.confetti = St.confetti.filter((p) => p.life > 0 && p.y < H + 40);
      c.globalAlpha = 1;
    }
    if (!RM) St.raf = requestAnimationFrame(frame);
  }
  function confetti(n) {
    const cols = ['#fa6105', '#ffffff', '#ff8a3d', '#ffd2b3', '#1d1b1b'];
    for (let i = 0; i < (n || 160); i++) {
      const left = i % 2 === 0;
      St.confetti.push({ x: left ? -10 : St.w + 10, y: St.h * (0.55 + Math.random() * 0.3), vx: (left ? 1 : -1) * (6 + Math.random() * 9), vy: -(7 + Math.random() * 9),
        s: 8 + Math.random() * 10, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, col: cols[i % cols.length], life: 160 + Math.random() * 80 });
    }
    if (RM) frame(performance.now());
  }

  // ---- voice
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function say(n) {
    n = Number(n);
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
    return ONES[Math.floor(n / 100)] + ' ' + (n % 100 ? (n % 100 < 10 ? 'oh ' + ONES[n % 100] : say(n % 100)) : 'hundred');
  }
  let voicePick = null;
  function pickVoice() {
    if (!window.speechSynthesis) return null;
    const vs = speechSynthesis.getVoices();
    const pref = [/en-SG/i, /Google UK English Female/i, /en-GB/i, /Samantha|Karen|Moira/i, /en-AU/i, /en-US/i, /^en/i];
    for (const p of pref) { const v = vs.find((x) => p.test(x.lang) || p.test(x.name)); if (v) return v; }
    return vs[0] || null;
  }
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { voicePick = pickVoice(); };
  function speak(text) {
    if (!St.voice || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      voicePick = voicePick || pickVoice(); if (voicePick) u.voice = voicePick;
      u.rate = 0.95; u.pitch = 1.02; u.volume = 1;
      speechSynthesis.speak(u);
    } catch (e) { /* voice optional */ }
  }
  function chime() {
    try {
      const ctx = ensureAudio();
      [659, 988, 1319, 1760].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; o.type = i % 2 ? 'triangle' : 'sine'; o.connect(g); g.connect(ctx.destination);
        const t = ctx.currentTime + i * 0.11;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        o.start(t); o.stop(t + 0.75);
      });
    } catch (e) { /* audio blocked */ }
  }

  // ---- ready takeover
  function announce(o) {
    St.queue.push(o);
    if (!St.showing) next();
  }
  function next() {
    const el = document.getElementById('takeover');
    const o = St.queue.shift();
    if (!o || !el) { St.showing = false; if (el) el.className = ''; return; }
    St.showing = true;
    el.innerHTML = '<div class="tk-inner"><div class="tk-kicker">Ready to collect</div><div class="tk-no num">' + o.no + '</div>' +
      '<div class="tk-name">' + esc(o.name || '') + '</div><div class="tk-items">' + esc(o.items || '') + '</div></div>';
    el.className = 'on';
    chime();
    const drinks = o.cups > 1 ? 'your drinks are' : 'your ' + (o.items || 'drink') + ' is';
    setTimeout(() => speak('Order ' + say(parseInt(o.no, 10)) + (o.name ? ', ' + o.name : '') + '. ' + drinks + ' ready.'), 650);
    const hold = St.queue.length ? 2600 : 3800;
    setTimeout(() => { el.className = 'off'; setTimeout(next, 450); }, hold);
  }
  function milestone(text) {
    confetti(220);
    const el = document.getElementById('milestone');
    if (el) { el.textContent = text; el.className = 'on'; setTimeout(() => { el.className = ''; }, 6000); }
    setTimeout(() => speak(text), 400);
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mount(canvas) {
    if (St.canvas === canvas) return;
    St.canvas = canvas; St.ctx = canvas.getContext('2d');
    size(); seedSnow();
    if (!St.raf) St.raf = requestAnimationFrame(frame);
  }
  window.addEventListener('resize', () => { if (St.canvas && St.canvas.isConnected) { size(); seedSnow(); } });

  window.Stage = {
    mount, announce, milestone, confetti, chime, speak,
    get started() { return St.started; },
    get mic() { return St.mic; },
    get voice() { return St.voice; },
    setVoice(v) { St.voice = v; localStorage.setItem('bb.stage.voice', v ? 'on' : 'off'); if (!v && window.speechSynthesis) speechSynthesis.cancel(); },
    async start(withMic) {
      ensureAudio();
      St.started = true;
      if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(''); speechSynthesis.speak(u); } // unlock voice on this tap
      if (withMic) return useMic();
      return false;
    },
  };
})();
