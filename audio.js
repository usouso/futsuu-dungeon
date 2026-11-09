// audio.js — 最小限の合成音（WebAudio）。素材ファイルは使わない。
// 音量の優先度は「プレイヤーへの影響度」で決める（決着 > 当たり > 拾う・使う > 足音）。
(function (root) {
  'use strict';
  let ctx = null, master = null;
  let volume = 0.3; // 初期値は控えめ
  let muted = false;

  function ensure() {
    if (muted) return false;
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return false;
      try { ctx = new AC(); } catch (e) { return false; }
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  // 音程のある短い音。f0→f1 へすべらせる。アタック強め・残響なし。
  function tone(f0, f1, dur, type, gain, delay) {
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // 雑音（打撃・爆発・炎）
  function noise(dur, gain, cutoff, delay) {
    const t = ctx.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff || 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    step() { tone(140, 110, 0.04, 'triangle', 0.08); },
    bump() { tone(90, 70, 0.05, 'triangle', 0.12); },
    nope() { tone(160, 120, 0.07, 'square', 0.1); },
    hit() { noise(0.09, 0.6, 900); tone(190, 80, 0.1, 'square', 0.35); },
    kill() { noise(0.12, 0.5, 1400); tone(330, 660, 0.12, 'square', 0.35, 0.03); },
    hurt() { noise(0.12, 0.6, 500); tone(120, 55, 0.16, 'sawtooth', 0.4); },
    arrow() { tone(900, 500, 0.08, 'triangle', 0.3); },
    pickup() { tone(660, 660, 0.05, 'square', 0.25); tone(990, 990, 0.08, 'square', 0.25, 0.06); },
    eat() { tone(300, 240, 0.06, 'square', 0.28); tone(300, 240, 0.06, 'square', 0.28, 0.1); tone(480, 600, 0.1, 'triangle', 0.3, 0.2); },
    drink() { tone(400, 800, 0.18, 'sine', 0.35); tone(800, 1000, 0.1, 'sine', 0.25, 0.16); },
    fire() { noise(0.3, 0.6, 2200); tone(220, 90, 0.3, 'sawtooth', 0.25); },
    warp() { tone(300, 1400, 0.2, 'sine', 0.35); tone(1400, 400, 0.15, 'sine', 0.25, 0.18); },
    scroll() { tone(523, 523, 0.25, 'triangle', 0.3); tone(659, 659, 0.25, 'triangle', 0.3, 0.03); tone(784, 784, 0.3, 'triangle', 0.3, 0.06); },
    throw() { tone(500, 800, 0.08, 'triangle', 0.22); },
    boom() { noise(0.4, 0.9, 700); tone(100, 35, 0.4, 'sawtooth', 0.5); },
    wake() { tone(880, 880, 0.05, 'square', 0.18); },
    warn() { tone(220, 220, 0.12, 'square', 0.3); tone(196, 196, 0.16, 'square', 0.3, 0.14); },
    levelup() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.12, 'square', 0.4, i * 0.08)); },
    stairs() { [392, 330, 262].forEach((f, i) => tone(f, f, 0.08, 'triangle', 0.35, i * 0.07)); },
    dead() { [330, 262, 196, 131].forEach((f, i) => tone(f, f * 0.94, 0.22, 'sawtooth', 0.5, i * 0.16)); },
    clear() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.16, 'square', 0.55, i * 0.11)); },
  };

  root.Sfx = {
    play(name) {
      if (!SOUNDS[name] || !ensure()) return;
      try { SOUNDS[name](); } catch (e) { /* 音が出せなくても遊べる */ }
    },
    unlock() { ensure(); },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volume; },
    getVolume() { return volume; },
    setMuted(m) { muted = !!m; if (muted && ctx && ctx.state === 'running') ctx.suspend(); },
    isMuted() { return muted; },
    // 確認用：音の仕組み（AudioContext）がもう作られたか
    started() { return !!ctx; },
  };
})(typeof self !== 'undefined' ? self : this);
