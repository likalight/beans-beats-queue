/* Optional ready-board audio, triggered only when orders become ready. */
(function () {
  'use strict';
  const C = window.Core;
  let audio = null;
  let enabled = false;

  // ---- voice
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function say(n) {
    n = Number(n);
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
    if (n >= 1000) return String(n);
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
    if (!window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      voicePick = voicePick || pickVoice(); if (voicePick) u.voice = voicePick;
      u.rate = 0.95; u.pitch = 1.02; u.volume = 1;
      speechSynthesis.speak(u);
    } catch (e) { /* voice optional */ }
  }
  function chime() {
    if (!audio || audio.state !== 'running') return;
    try {
      const ctx = audio;
      [659, 988, 1319, 1760].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; o.type = i % 2 ? 'triangle' : 'sine'; o.connect(g); g.connect(ctx.destination);
        const t = ctx.currentTime + i * 0.11;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        o.start(t); o.stop(t + 0.75);
      });
    } catch (e) { /* audio blocked */ }
  }

  function setEnabled(on) {
    if (enabled === on) return;
    enabled = on;
    if (!enabled) {
      window.speechSynthesis?.cancel();
      return;
    }
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio) {
        audio ||= new Audio();
        audio.resume().catch(() => {});
      }
      // Unlock voice on the same tap as the chime.
      if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    } catch (e) { /* audio optional */ }
  }

  function announce(orders) {
    if (!enabled || !orders.length) return;
    chime();
    for (const order of orders) {
      const drinks = C.orderCups(order) > 1 ? 'your drinks are' : 'your ' + (C.describeItems(order) || 'drink') + ' is';
      speak('Order ' + say(order.no) + (order.name ? ', ' + order.name : '') + '. ' + drinks + ' ready.');
    }
  }

  window.Stage = { get enabled() { return enabled; }, setEnabled, announce };
})();
