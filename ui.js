// ui.js — 画面側。ルール（sim.js）が返す「1手ごとのイベント記録」を順番に再生するだけ。
// ルールの判断はここに書かない（押せる・押せないの見た目も Sim に聞く）。
//
// URL の切り替え:
//   ?seed=N  種を固定      ?auto=1  自動プレイ（最初から無音）
//   ?mute=1  最初から無音   ?bg=1    タイマーで進める（画面が裏でも進む）
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const AUTO = params.get('auto') === '1';
  const BG = params.get('bg') === '1';
  const LOOP = params.get('loop') === '1';
  const START_MUTED = AUTO || params.get('mute') === '1';
  const seedParam = params.get('seed');
  const SEED_FIXED = seedParam != null && /^\d+$/.test(seedParam);
  const seedBase = SEED_FIXED ? parseInt(seedParam, 10) : (Math.floor(Math.random() * 900000) + 1);
  let runIndex = 0;

  const $ = (id) => document.getElementById(id);
  const { ITEMS, ENEMIES, SPEC, DIRS } = Sim;

  // ---- 設定（音量・ゆれ）。覚えておく -------------------------------------
  const SHAKE_COEF = { normal: 1, weak: 0.5, off: 0 };
  const settings = { vol: 0.3, shake: 'normal' };
  try {
    const saved = JSON.parse(localStorage.getItem('futsuu-settings') || 'null');
    if (saved && typeof saved.vol === 'number') settings.vol = Math.max(0, Math.min(1, saved.vol));
    if (saved && SHAKE_COEF[saved.shake] != null) settings.shake = saved.shake;
  } catch (e) { /* 保存できない環境でも遊べる */ }
  function saveSettings() {
    try { localStorage.setItem('futsuu-settings', JSON.stringify(settings)); } catch (e) { /* 同上 */ }
  }
  Sfx.setVolume(settings.vol);
  Sfx.setMuted(START_MUTED);

  // ---- 状態 ---------------------------------------------------------------
  let state = null; // ルール側の本当の状態
  let view = null; // 画面に出ている状態（イベントの再生で少しずつ追いつく）
  let firsts = {}; // はじめて起きたこと（叩く・拾う・食べる）
  let sel = -1; // えらんでいる持ち物
  let aim = null; // むきをえらんでいる途中 {slot, mode:'use'|'throw'}
  let autoMem = {};
  let autoTimer = null;
  let clock = 0;
  let quiet = false; // 早送り中は音を出さない
  let hudDirty = true, invDirty = true;
  let turnInfo = null;
  let logLines = [];
  let bannerRank = 0;
  const speed = AUTO ? 0.7 : 1;

  function sfx(name) { if (!quiet) Sfx.play(name); }

  // ---- 画面に出ている状態を、本当の状態に合わせる --------------------------
  function snapshot() {
    const p = state.player;
    view = {
      map: state.map,
      floor: state.floor,
      stairs: { x: state.stairs.x, y: state.stairs.y },
      p: { x: p.x, y: p.y, dx: p.dx, dy: p.dy, hp: p.hp, maxHp: p.maxHp, atk: p.atk, lv: p.lv, xp: p.xp, hunger: p.hunger, inv: p.inv.map((it) => Object.assign({}, it)), ox: 0, oy: 0, lx: 0, ly: 0, flashT: -1e9, alpha: state.over === 'dead' ? 0.3 : 1 },
      enemies: state.enemies.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, awake: e.awake, alert: e.fresh, ox: 0, oy: 0, lx: 0, ly: 0, flashT: -1e9, alpha: 1, scale: 1 })),
      items: state.items.map((it) => Object.assign({}, it)),
      fx: [],
      fade: 0,
    };
    hudDirty = true; invDirty = true;
  }
  function venemy(id) { return view.enemies.find((e) => e.id === id) || null; }

  // ---- できごとの行 -------------------------------------------------------
  function say(text, cls, key) {
    const line = { text, cls: cls || '', key: key || null };
    const i = key ? logLines.findIndex((l) => l.key === key) : -1;
    if (i >= 0) logLines[i] = line; else logLines.push(line);
    renderLog();
  }
  function renderLog() {
    const box = $('log');
    box.textContent = '';
    for (const l of logLines.slice(-3)) {
      const d = document.createElement('div');
      if (l.cls) d.className = l.cls;
      d.textContent = l.text;
      box.appendChild(d);
    }
  }
  function lineOut(ev) {
    const t = turnInfo;
    t.outs.push({ name: ENEMIES[ev.kind].name, dmg: ev.dmg });
    if (t.outs.length === 1) say(t.melee ? `${t.outs[0].name}を たたいた　${ev.dmg}ダメージ` : `${t.outs[0].name}に ${ev.dmg}ダメージ`, '', 'out');
    else say(`敵${t.outs.length}体に ダメージ`, '', 'out');
  }
  function lineKill(ev) {
    const t = turnInfo;
    t.kills.push({ name: ENEMIES[ev.kind].name, xp: ENEMIES[ev.kind].xp });
    const sum = t.kills.reduce((s, k) => s + k.xp, 0);
    if (t.kills.length === 1) say(`${t.kills[0].name}を たおした　経験値+${sum}`, 'good', 'kill');
    else say(`敵を${t.kills.length}体 たおした　経験値+${sum}`, 'good', 'kill');
  }
  function lineHurt(ev) {
    const t = turnInfo, by = ev.by || {};
    const name = by.kind ? ENEMIES[by.kind].name : '';
    let text;
    if (by.how === 'melee') text = `${name}に たたかれた　${ev.dmg}ダメージ`;
    else if (by.how === 'arrow') text = `${name}の 矢が あたった　${ev.dmg}ダメージ`;
    else if (by.how === 'explosion') text = `爆発に まきこまれた　${ev.dmg}ダメージ`;
    else text = `おなかが へって　${ev.dmg}ダメージ`;
    t.hurts.push(ev.dmg);
    if (t.hurts.length === 1) say(text, 'bad', 'hurt');
    else say(`${t.hurts.length}回 やられた　合計${t.hurts.reduce((s, d) => s + d, 0)}ダメージ`, 'bad', 'hurt');
  }

  // ---- ひとこと（はじめて起きた瞬間に1行だけ。次の手まで出ている） ----------
  function banner(text, rank) {
    if (rank < bannerRank) return;
    bannerRank = rank;
    const b = $('banner');
    b.textContent = text;
    b.hidden = false;
    placeBanner(b);
    b.classList.remove('fx-banner');
    void b.offsetWidth;
    b.classList.add('fx-banner');
  }
  // ひとことの置き場所：地図の上端か下端のうち、自分・敵・アイテム・階段をなるべく隠さない所
  function placeBanner(b) {
    const s = tile, W = view.map.w * s, H = view.map.h * s;
    const bw = b.offsetWidth, bh = b.offsetHeight;
    const things = [view.p, view.stairs].concat(view.enemies, view.items);
    const xs = [(W - bw) / 2, 6, W - bw - 6];
    const ys = view.p.y < view.map.h / 2 ? [H - bh - 6, 6] : [6, H - bh - 6];
    let best = null;
    for (const y of ys) for (const x of xs) {
      let n = 0;
      for (const t of things) {
        const tx = t.x * s, ty = t.y * s - s * 0.3; // 敵の体力の棒のぶん、少し上まで
        if (tx < x + bw && tx + s > x && ty < y + bh && ty + s * 1.3 > y) n += t === view.p ? 10 : 1;
      }
      if (!best || n < best.n) best = { x, y, n };
    }
    b.style.left = Math.round(best.x) + 'px';
    b.style.top = Math.round(best.y) + 'px';
  }
  function clearBanner() { $('banner').hidden = true; bannerRank = 0; }
  function first(key, text) {
    if (firsts[key]) return;
    firsts[key] = true;
    banner(text, 2);
  }
  function pop(el) {
    el.classList.remove('fx-pop');
    void el.offsetWidth;
    el.classList.add('fx-pop');
  }

  // ---- ゆれ（弱めから。設定で弱める・切れる） ------------------------------
  const shakeState = { amp: 0, t0: 0, dur: 1 };
  function shake(amp, dur) {
    if (quiet) return;
    const left = shakeState.amp * Math.max(0, 1 - (clock - shakeState.t0) / shakeState.dur);
    if (amp < left) return;
    shakeState.amp = amp; shakeState.t0 = clock; shakeState.dur = dur || 160;
  }

  // ---- 再生（イベント記録 → 短い動きの列） ---------------------------------
  const queue = [];
  const D = { move: 70, bump: 70, lunge: 60, hurt: 90, kill: 150, pick: 60, use: 120, fire: 240, warp: 200, read: 260, cell: 28, boom: 280, arrow: 130, descend: 300, dead: 450, clear: 200, wait: 50 };
  function add(dur, fn) { queue.push({ dur: dur * speed, fn, t0: -1, st: {} }); }
  function ease(k) { return 1 - (1 - k) * (1 - k); }

  function advance(now) {
    let guard = 0;
    while (queue.length && guard++ < 100) {
      const b = queue[0];
      if (b.t0 < 0) b.t0 = now;
      const k = b.dur <= 0 ? 1 : Math.min(1, (now - b.t0) / b.dur);
      b.fn(k, b.st);
      if (k < 1) break;
      queue.shift();
      if (!queue.length) onIdle();
    }
  }
  // 再生の途中で次の入力が来たら、残りを一気に終わらせる（待たせない）
  function flush() {
    if (!queue.length) return;
    quiet = true;
    while (queue.length) { const b = queue.shift(); b.fn(1, b.st); }
    quiet = false;
    onIdle();
  }

  const BEAT = {
    pmove(ev) {
      add(D.move, (k, st) => {
        const p = view.p;
        if (!st.i) { st.i = 1; st.fx = p.x - ev.x; st.fy = p.y - ev.y; p.x = ev.x; p.y = ev.y; sfx('step'); }
        const r = 1 - ease(k);
        p.ox = st.fx * r; p.oy = st.fy * r;
      });
    },
    bump(ev) {
      add(D.bump, (k, st) => {
        if (!st.i) { st.i = 1; sfx('bump'); }
        const a = Math.sin(Math.PI * k) * 0.14;
        view.p.ox = ev.dx * a; view.p.oy = ev.dy * a;
      });
    },
    wait() { add(D.wait, () => {}); },
    pattack(ev) {
      add(D.lunge, (k, st) => {
        const p = view.p;
        if (!st.i) { st.i = 1; st.dx = Math.sign(ev.x - p.x); st.dy = Math.sign(ev.y - p.y); turnInfo.melee = true; first('attack', 'たたいた！'); }
        p.lx = st.dx * 0.42 * ease(k); p.ly = st.dy * 0.42 * ease(k);
      });
    },
    ehurt(ev) {
      add(D.hurt, (k, st) => {
        if (st.i) return;
        st.i = 1;
        const e = venemy(ev.id);
        if (e) { e.hp = ev.hp; e.flashT = clock; e.awake = true; e.alert = false; }
        sfx('hit'); shake(1.2, 90);
        lineOut(ev);
      });
    },
    kill(ev) {
      add(D.kill, (k, st) => {
        const e = venemy(ev.id);
        if (!st.i) { st.i = 1; sfx('kill'); lineKill(ev); }
        if (e) { e.alpha = 1 - k; e.scale = 1 + 0.5 * k; }
        if (k >= 1 && e) view.enemies.splice(view.enemies.indexOf(e), 1);
      });
    },
    xp(ev) { add(0, () => { view.p.xp = ev.total; hudDirty = true; }); },
    levelup(ev) {
      add(0, () => {
        const p = view.p;
        p.lv = ev.lv; p.maxHp = ev.maxHp; p.atk = ev.atk; hudDirty = true;
        sfx('levelup');
        say(`レベル${ev.lv}に あがった　最大体力+${SPEC.LEVEL_HP} 攻撃+${SPEC.LEVEL_ATK}`, 'good');
        banner('レベルアップ！', 1);
        pop($('hud-lv')); pop($('hud-atk'));
      });
    },
    pickup(ev) {
      add(D.pick, (k, st) => {
        if (st.i) return;
        st.i = 1;
        const i = view.items.findIndex((it) => it.id === ev.id);
        if (i >= 0) view.items.splice(i, 1);
        sfx('pickup');
        say(`${ITEMS[ev.kind].name}を ひろった`, 'good');
        first('pickup', 'ひろった！');
        st.pop = true;
        turnInfo.popSlot = true;
      });
    },
    inv(ev) {
      add(0, () => {
        view.p.inv = ev.inv; invDirty = true;
        if (turnInfo.popSlot) { turnInfo.popSlot = false; turnInfo.popIndex = ev.inv.length - 1; }
      });
    },
    full(ev) { add(0, () => { sfx('nope'); say(`持ち物が いっぱいで ${ITEMS[ev.kind].name}を ひろえない`, 'bad'); }); },
    eat(ev) {
      add(D.use, (k, st) => {
        if (st.i) return;
        st.i = 1;
        view.p.hunger = ev.hunger; hudDirty = true;
        sfx('eat');
        say(`${ITEMS[ev.kind].name}を 食べた　満腹度+${ev.gain}`, 'good');
        first('eat', `食べた！ 満腹度+${ev.gain}`);
        pop($('m-food'));
      });
    },
    drink(ev) {
      add(D.use, (k, st) => {
        if (st.i) return;
        st.i = 1;
        view.p.hp = ev.hp; hudDirty = true;
        sfx('drink');
        say(`${ITEMS[ev.kind].name}を 飲んだ　体力+${ev.gain}`, 'good');
        pop($('m-hp'));
      });
    },
    fire(ev) {
      add(D.fire, (k, st) => {
        if (!st.i) {
          st.i = 1; st.fx = { type: 'fire', cells: ev.cells, k: 0 }; view.fx.push(st.fx);
          sfx('fire');
          say(`${ITEMS[ev.kind].name}を 振った　${ev.charges > 0 ? 'のこり' + ev.charges + '回' : '使いきった'}`);
        }
        st.fx.k = k;
        if (k >= 1) removeFx(st.fx);
      });
    },
    warp(ev) {
      add(D.warp, (k, st) => {
        if (!st.i) {
          st.i = 1; st.fx = { type: 'bolt', path: ev.path, from: { x: view.p.x, y: view.p.y }, to: ev.to, k: 0 }; view.fx.push(st.fx);
          sfx('warp');
          say(`${ITEMS[ev.kind].name}を 振った　${ev.charges > 0 ? 'のこり' + ev.charges + '回' : '使いきった'}`);
        }
        st.fx.k = k;
        if (k >= 1) {
          removeFx(st.fx);
          const e = ev.id != null ? venemy(ev.id) : null;
          if (e && ev.to) { e.x = ev.to.x; e.y = ev.to.y; e.flashT = clock; say(`${ENEMIES[ev.ekind].name}を どこかへ 飛ばした`, 'good'); }
          else say('何にも 当たらなかった');
        }
      });
    },
    read(ev) {
      add(D.read, (k, st) => {
        if (!st.i) {
          st.i = 1; st.fx = { type: 'room', room: ev.room, k: 0 }; view.fx.push(st.fx);
          sfx('scroll');
          say(ev.n > 0 ? `巻物を 読んだ　部屋の敵に ${SPEC.SCROLL_DMG}ダメージ` : '巻物を 読んだ　部屋に 敵は いなかった');
        }
        st.fx.k = k;
        if (k >= 1) removeFx(st.fx);
      });
    },
    throw(ev) {
      add(Math.max(70, ev.path.length * D.cell), (k, st) => {
        if (!st.i) {
          st.i = 1; st.fx = { type: 'fly', kind: ev.kind, path: ev.path, from: { x: view.p.x, y: view.p.y }, k: 0 }; view.fx.push(st.fx);
          sfx('throw');
          say(ev.id != null ? `${ITEMS[ev.kind].name}を 投げた` : `${ITEMS[ev.kind].name}を 投げた　床に おちた`);
        }
        st.fx.k = k;
        if (k >= 1) {
          removeFx(st.fx);
          if (ev.land) view.items.push({ id: -1, kind: ev.kind, x: ev.land.x, y: ev.land.y });
        }
      });
    },
    explode(ev) {
      add(D.boom, (k, st) => {
        if (!st.i) {
          st.i = 1; st.fx = { type: 'boom', x: ev.x, y: ev.y, k: 0 }; view.fx.push(st.fx);
          sfx('boom'); shake(5, 260);
          say('ばくだん岩が 爆発した！', 'bad');
        }
        st.fx.k = k;
        if (k >= 1) removeFx(st.fx);
      });
    },
    eattack(ev) {
      add(D.lunge, (k, st) => {
        const e = venemy(ev.id);
        if (!e) return;
        if (!st.i) { st.i = 1; st.dx = Math.sign(view.p.x - e.x); st.dy = Math.sign(view.p.y - e.y); e.alert = false; }
        e.lx = st.dx * 0.42 * ease(k); e.ly = st.dy * 0.42 * ease(k);
      });
    },
    arrow(ev) {
      add(D.arrow, (k, st) => {
        if (!st.i) { st.i = 1; st.fx = { type: 'arrow', from: { x: ev.x, y: ev.y }, to: { x: view.p.x, y: view.p.y }, k: 0 }; view.fx.push(st.fx); sfx('arrow'); }
        st.fx.k = k;
        if (k >= 1) removeFx(st.fx);
      });
    },
    phurt(ev) {
      add(D.hurt, (k, st) => {
        if (st.i) return;
        st.i = 1;
        view.p.hp = ev.hp; view.p.flashT = clock; hudDirty = true;
        sfx('hurt'); shake(2.5, 160);
        lineHurt(ev);
      });
    },
    wake(ev) {
      add(0, () => {
        const e = venemy(ev.id);
        if (e) { e.awake = true; e.alert = true; }
        sfx('wake');
      });
    },
    hunger(ev) { add(0, () => { view.p.hunger = ev.hunger; hudDirty = true; }); },
    hungry() { add(0, () => { sfx('warn'); say('おなかが からっぽだ　体力が へっていく', 'bad'); }); },
    regen(ev) { add(0, () => { view.p.hp = ev.hp; hudDirty = true; }); },
    refuse(ev) {
      add(0, () => {
        sfx('nope');
        if (ev.why === 'noRoom') say('巻物は 部屋の中でしか 読めない', 'bad');
        else if (ev.why === 'noTarget') say('となりに 敵が いない', 'bad');
      });
    },
    descend(ev) {
      add(D.descend, (k, st) => {
        if (!st.i) { st.i = 1; sfx('stairs'); }
        if (k >= 0.5 && !st.swap) { st.swap = 1; snapshot(); say(`${ev.floor}Fに おりた`, 'good'); }
        view.fade = k < 0.5 ? k * 2 : (1 - k) * 2;
      });
    },
    dead() {
      add(D.dead, (k, st) => {
        if (!st.i) { st.i = 1; sfx('dead'); }
        view.p.alpha = 1 - 0.7 * k;
      });
    },
    clear() { add(D.clear, (k, st) => { if (!st.i) { st.i = 1; sfx('clear'); } }); },
  };
  function removeFx(fx) { const i = view.fx.indexOf(fx); if (i >= 0) view.fx.splice(i, 1); }

  function buildBeats(evs) {
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (ev.t === 'emove') {
        // 敵の移動は、まとめて同時に動かす（待たせない）
        const group = [ev];
        while (i + 1 < evs.length && evs[i + 1].t === 'emove' && !group.some((g) => g.id === evs[i + 1].id)) group.push(evs[++i]);
        add(D.move, (k, st) => {
          if (!st.i) {
            st.i = 1; st.from = [];
            for (const g of group) {
              const e = venemy(g.id);
              st.from.push(e ? { e, fx: e.x - g.x, fy: e.y - g.y } : null);
              if (e) { e.x = g.x; e.y = g.y; e.alert = false; }
            }
          }
          const r = 1 - ease(k);
          for (const f of st.from) if (f) { f.e.ox = f.fx * r; f.e.oy = f.fy * r; }
        });
        continue;
      }
      if (BEAT[ev.t]) BEAT[ev.t](ev);
    }
    if (!queue.length) add(0, () => {});
  }

  // ---- 入力 → ルールへ1手 ---------------------------------------------------
  function act(action) {
    if (!state || state.over) return;
    flush();
    clearBanner();
    logLines = [];
    turnInfo = { melee: false, outs: [], kills: [], hurts: [], popSlot: false, popIndex: -1 };
    const evs = Sim.step(state, action);
    if (!evs.length) return;
    renderLog();
    buildBeats(evs);
    refreshControls();
  }

  function onIdle() {
    snapshot();
    refreshControls();
    if (state.over) { showEnd(); return; }
    if (AUTO && !autoTimer) autoTimer = setTimeout(autoStep, 110);
  }

  function botStep() {
    if (!state || state.over) return false;
    act(Bots.useItem(state, autoMem));
    return true;
  }
  function autoStep() {
    autoTimer = null;
    if (!$('settings').hidden) { autoTimer = setTimeout(autoStep, 300); return; }
    botStep();
  }

  function newGame() {
    const seed = seedBase + runIndex;
    runIndex += 1;
    state = Sim.create(seed);
    queue.length = 0;
    firsts = {};
    sel = -1; aim = null;
    autoMem = {};
    logLines = [];
    turnInfo = { melee: false, outs: [], kills: [], hurts: [], popSlot: false, popIndex: -1 };
    snapshot();
    clearBanner();
    $('end').hidden = true;
    $('seed-line').textContent = 'seed ' + state.seed;
    say('ダンジョンに 入った（1F）');
    layout();
    refreshControls();
    if (AUTO) { clearTimeout(autoTimer); autoTimer = setTimeout(autoStep, 400); }
  }

  // ---- 表示の更新（文字のある部分は DOM） -----------------------------------
  function renderHud() {
    const p = view.p;
    $('hud-floor').textContent = `${view.floor}F／${SPEC.FLOORS}F`;
    $('hud-lv-text').textContent = `Lv ${p.lv}`;
    const lo = p.lv > 1 ? Sim.xpNeed(p.lv - 1) : 0, hi = Sim.xpNeed(p.lv);
    $('xp-fill').style.width = Math.max(0, Math.min(100, ((p.xp - lo) / (hi - lo)) * 100)) + '%';
    $('hud-atk').textContent = `攻撃 ${p.atk}`;
    $('hp-num').textContent = `${p.hp}/${p.maxHp}`;
    $('hp-fill').style.width = Math.max(0, (p.hp / p.maxHp) * 100) + '%';
    $('m-hp').classList.toggle('low', p.hp <= p.maxHp * 0.3);
    $('food-num').textContent = `${p.hunger}/${SPEC.HUNGER_MAX}`;
    $('food-fill').style.width = Math.max(0, (p.hunger / SPEC.HUNGER_MAX) * 100) + '%';
    $('m-food').classList.toggle('low', p.hunger <= 10);
  }

  const slots = [];
  function buildInv() {
    const box = $('inv');
    for (let i = 0; i < SPEC.INV_MAX; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot empty';
      const cv = document.createElement('canvas');
      cv.width = 72; cv.height = 72;
      const pips = document.createElement('span');
      pips.className = 'pips';
      b.appendChild(cv); b.appendChild(pips);
      b.addEventListener('click', () => selectSlot(i));
      box.appendChild(b);
      slots.push({ b, cv, pips, sig: '' });
    }
  }
  function renderInv() {
    const inv = view.p.inv;
    slots.forEach((s, i) => {
      const it = inv[i];
      const sig = it ? it.kind + ':' + (it.charges || 0) : '';
      if (sig !== s.sig) {
        s.sig = sig;
        s.b.classList.toggle('empty', !it);
        s.b.setAttribute('aria-label', it ? ITEMS[it.kind].name : 'から');
        s.pips.textContent = '';
        const c = s.cv.getContext('2d');
        c.clearRect(0, 0, 72, 72);
        if (it) {
          drawItem(c, it.kind, 36, it.charges ? 32 : 36, 64);
          for (let n = 0; n < (it.charges || 0); n++) s.pips.appendChild(document.createElement('i'));
        }
      }
      s.b.classList.toggle('selected', i === sel && !!it);
    });
    if (turnInfo && turnInfo.popIndex >= 0 && slots[turnInfo.popIndex]) { pop(slots[turnInfo.popIndex].b); turnInfo.popIndex = -1; }
  }

  function itemLabel(it) {
    return ITEMS[it.kind].name + (it.charges ? `（のこり${it.charges}回）` : '');
  }
  function refreshControls() {
    // 攻撃ボタン：隣に敵がいるときだけ押せる（相手の名前も出す）
    const btn = $('btn-attack');
    const tg = state && !state.over ? Sim.attackTarget(state) : null;
    const was = btn.disabled;
    btn.disabled = !tg;
    $('attack-target').textContent = tg ? ENEMIES[tg.kind].name : '';
    if (was && tg) { btn.classList.remove('fx-ready'); void btn.offsetWidth; btn.classList.add('fx-ready'); }

    const inv = state ? state.player.inv : [];
    if (sel >= inv.length) { sel = -1; aim = null; }
    if (aim && (aim.slot !== sel || state.over)) aim = null;
    const row = $('itemrow');
    const it = sel >= 0 ? inv[sel] : null;
    row.classList.toggle('off', !it);
    row.classList.toggle('aiming', !!aim);
    if (it) {
      const def = ITEMS[it.kind];
      $('item-name').textContent = aim ? `${def.name}：むきを えらぶ` : itemLabel(it);
      $('btn-use').textContent = def.verbName;
    }
    $('dpad').classList.toggle('fx-aim', !!aim);
    centerBtn.textContent = aim ? 'やめる' : '待つ';
    invDirty = true;
  }

  function selectSlot(i) {
    if (!state || state.over || AUTO) return;
    flush();
    if (!state.player.inv[i]) return;
    aim = null;
    sel = sel === i ? -1 : i;
    refreshControls();
  }
  function useSelected() {
    const it = state.player.inv[sel];
    if (!it) return;
    if (ITEMS[it.kind].aim) { aim = { slot: sel, mode: 'use' }; refreshControls(); return; }
    const slot = sel;
    sel = -1; aim = null;
    act({ type: 'use', slot });
    refreshControls();
  }
  function throwSelected() {
    if (!state.player.inv[sel]) return;
    aim = { slot: sel, mode: 'throw' };
    refreshControls();
  }
  function cancelSelected() {
    if (aim) aim = null; else sel = -1;
    refreshControls();
  }
  function pressDir(dx, dy) {
    if (!state || state.over || AUTO) return;
    if (aim) {
      const a = { type: aim.mode, slot: aim.slot, dx, dy };
      aim = null; sel = -1;
      act(a);
      refreshControls();
      return;
    }
    act({ type: 'move', dx, dy });
  }
  function pressCenter() {
    if (!state || state.over || AUTO) return;
    if (aim) { cancelSelected(); return; }
    act({ type: 'wait' });
  }
  function pressAttack() {
    if (!state || state.over || AUTO) return;
    if (aim || sel >= 0) { aim = null; sel = -1; }
    act({ type: 'attack' });
    refreshControls();
  }

  // ---- 方向ボタン ----------------------------------------------------------
  let centerBtn = null;
  function buildDpad() {
    const pad = $('dpad');
    const names = { '0,-1': '上', '1,-1': '右上', '1,0': '右', '1,1': '右下', '0,1': '下', '-1,1': '左下', '-1,0': '左', '-1,-1': '左上' };
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const b = document.createElement('button');
      b.type = 'button';
      if (dx === 0 && dy === 0) {
        b.className = 'center';
        b.textContent = '待つ';
        b.addEventListener('click', pressCenter);
        centerBtn = b;
      } else {
        const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
        b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 L20 19 L12 15 L4 19 Z" fill="currentColor" transform="rotate(${deg} 12 12)"/></svg>`;
        b.setAttribute('aria-label', names[dx + ',' + dy]);
        b.dataset.dir = dx + ',' + dy;
        b.addEventListener('click', () => pressDir(dx, dy));
      }
      pad.appendChild(b);
    }
  }

  // ---- キーボード ----------------------------------------------------------
  const KEY_DIR = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    KeyW: [0, -1], KeyX: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], KeyQ: [-1, -1], KeyE: [1, -1], KeyZ: [-1, 1], KeyC: [1, 1],
    Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0], Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
  };
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    Sfx.unlock();
    if (!$('settings').hidden) { if (e.code === 'Escape') { closeSettings(); e.preventDefault(); } return; }
    if (!$('end').hidden) { if (e.code === 'Enter' || e.code === 'Space') { retry(); e.preventDefault(); } return; }
    const dir = KEY_DIR[e.code];
    if (dir) { pressDir(dir[0], dir[1]); e.preventDefault(); return; }
    if (e.code === 'KeyS' || e.code === 'Numpad5' || e.code === 'Period') { pressCenter(); e.preventDefault(); return; }
    if (/^Digit[1-8]$/.test(e.code)) { selectSlot(parseInt(e.code.slice(5), 10) - 1); e.preventDefault(); return; }
    if (e.code === 'Escape') { cancelSelected(); e.preventDefault(); return; }
    if (e.code === 'KeyT' && sel >= 0) { throwSelected(); e.preventDefault(); return; }
    if (e.code === 'Enter' && sel >= 0 && !aim) { useSelected(); e.preventDefault(); return; }
    if (e.code === 'Space' || e.code === 'KeyF' || e.code === 'Enter') { pressAttack(); e.preventDefault(); }
  }

  // ---- せってい ------------------------------------------------------------
  function renderSettings() {
    const muted = Sfx.isMuted();
    $('btn-sound').textContent = muted ? 'オフ' : 'オン';
    $('btn-sound').classList.toggle('on', !muted);
    $('vol').value = String(Math.round(settings.vol * 100));
    $('vol-num').textContent = String(Math.round(settings.vol * 100));
    document.querySelectorAll('.shake-opt').forEach((b) => b.classList.toggle('on', b.dataset.shake === settings.shake));
  }
  function openSettings() { flush(); renderSettings(); $('settings').hidden = false; }
  function closeSettings() { $('settings').hidden = true; }

  // ---- 結果（死因を1行で。すぐやり直せる） ---------------------------------
  // 連打の勢いで結果を読む前に消してしまわないよう、出てすぐの一瞬だけは「もういちど」を受けつけない
  let endShownAt = 0;
  function retry() {
    if (performance.now() - endShownAt < 500) return;
    newGame();
  }
  function showEnd() {
    if (!$('end').hidden) return;
    endShownAt = performance.now();
    const p = state.player, clear = state.over === 'clear';
    $('end-title').textContent = clear ? 'クリア！' : '力つきた…';
    $('end-title').classList.toggle('clear', clear);
    $('end-cause').textContent = clear ? `${SPEC.FLOORS}フロアを ぬけて 帰ってきた` : Sim.causeText(state.cause);
    $('end-stats').textContent = `レベル ${p.lv}　たおした敵 ${state.stats.kills}　歩数 ${p.steps}`;
    const left = p.inv.map((it) => ITEMS[it.kind].name);
    $('end-left').textContent = clear || !left.length ? '' : '使わずに のこった持ち物：' + left.join('、');
    $('end-left').hidden = clear || !left.length;
    $('end-seed').textContent = 'seed ' + state.seed;
    $('end').hidden = false;
    if (AUTO && LOOP) setTimeout(newGame, 2500);
  }

  // ---- 地図の大きさ --------------------------------------------------------
  const canvas = $('map');
  const ctx = canvas.getContext('2d');
  let tile = 18, dpr = 1;
  function layout() {
    if (!view) return;
    const W = view.map.w, H = view.map.h;
    const wide = window.matchMedia('(min-width: 900px)').matches;
    let t;
    if (wide) t = Math.floor(Math.min((window.innerWidth - 372 - 48) / W, (window.innerHeight - 32) / H));
    else t = Math.floor((Math.min(window.innerWidth, 480) - 12) / W);
    tile = Math.max(12, Math.min(44, t));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.style.width = W * tile + 'px';
    canvas.style.height = H * tile + 'px';
    canvas.width = Math.round(W * tile * dpr);
    canvas.height = Math.round(H * tile * dpr);
  }

  // ---- 絵（文字は使わない。形と明るさで見分けられるように） ---------------
  function circ(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); }
  function ell(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
  function outline(c, s) { c.lineWidth = Math.max(1, s * 0.055); c.strokeStyle = '#14100a'; c.lineJoin = 'round'; }

  function drawPlayer(c, x, y, s) {
    outline(c, s);
    c.fillStyle = '#3f86e8';
    c.beginPath(); c.moveTo(x - s * 0.2, y + s * 0.36); c.lineTo(x - s * 0.15, y + s * 0.02); c.lineTo(x + s * 0.15, y + s * 0.02); c.lineTo(x + s * 0.2, y + s * 0.36); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#ffe2b4'; circ(c, x, y - s * 0.1, s * 0.17); c.fill(); c.stroke();
    c.fillStyle = '#ffd23f';
    c.beginPath(); c.moveTo(x - s * 0.34, y - s * 0.14); c.lineTo(x, y - s * 0.45); c.lineTo(x + s * 0.34, y - s * 0.14); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#14100a'; circ(c, x - s * 0.06, y - s * 0.06, s * 0.028); c.fill(); circ(c, x + s * 0.06, y - s * 0.06, s * 0.028); c.fill();
  }
  const ENEMY_DRAW = {
    maru(c, x, y, s) {
      outline(c, s);
      c.fillStyle = '#e8564d'; circ(c, x, y + s * 0.04, s * 0.33); c.fill(); c.stroke();
      c.fillStyle = '#fff'; circ(c, x - s * 0.12, y - s * 0.02, s * 0.085); c.fill(); circ(c, x + s * 0.12, y - s * 0.02, s * 0.085); c.fill();
      c.fillStyle = '#14100a'; circ(c, x - s * 0.1, y, s * 0.04); c.fill(); circ(c, x + s * 0.1, y, s * 0.04); c.fill();
    },
    usagi(c, x, y, s) {
      outline(c, s);
      c.fillStyle = '#f6f2ff';
      ell(c, x - s * 0.11, y - s * 0.25, s * 0.075, s * 0.2); c.fill(); c.stroke();
      ell(c, x + s * 0.11, y - s * 0.25, s * 0.075, s * 0.2); c.fill(); c.stroke();
      ell(c, x, y + s * 0.1, s * 0.27, s * 0.24); c.fill(); c.stroke();
      c.fillStyle = '#d6336c'; circ(c, x - s * 0.1, y + s * 0.05, s * 0.04); c.fill(); circ(c, x + s * 0.1, y + s * 0.05, s * 0.04); c.fill();
    },
    ghost(c, x, y, s) {
      outline(c, s);
      c.save();
      c.globalAlpha *= 0.88;
      c.fillStyle = '#a9e6f3';
      c.beginPath();
      c.arc(x, y - s * 0.04, s * 0.3, Math.PI, 0);
      c.lineTo(x + s * 0.3, y + s * 0.34);
      c.lineTo(x + s * 0.15, y + s * 0.24); c.lineTo(x, y + s * 0.34); c.lineTo(x - s * 0.15, y + s * 0.24); c.lineTo(x - s * 0.3, y + s * 0.34);
      c.closePath(); c.fill(); c.stroke();
      c.restore();
      c.fillStyle = '#16314a'; ell(c, x - s * 0.1, y - s * 0.04, s * 0.05, s * 0.08); c.fill(); ell(c, x + s * 0.1, y - s * 0.04, s * 0.05, s * 0.08); c.fill();
    },
    bomb(c, x, y, s) {
      outline(c, s);
      c.fillStyle = '#596072';
      c.beginPath();
      c.moveTo(x - s * 0.14, y - s * 0.26); c.lineTo(x + s * 0.18, y - s * 0.24); c.lineTo(x + s * 0.36, y + s * 0.02); c.lineTo(x + s * 0.28, y + s * 0.34);
      c.lineTo(x - s * 0.26, y + s * 0.36); c.lineTo(x - s * 0.38, y + s * 0.06); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#868fa6';
      c.beginPath(); c.moveTo(x - s * 0.12, y - s * 0.2); c.lineTo(x + s * 0.12, y - s * 0.18); c.lineTo(x - s * 0.02, y + s * 0.02); c.lineTo(x - s * 0.26, y + s * 0.04); c.closePath(); c.fill();
      c.strokeStyle = '#14100a'; c.lineWidth = Math.max(1, s * 0.05);
      c.beginPath(); c.moveTo(x + s * 0.04, y - s * 0.25); c.lineTo(x + s * 0.1, y - s * 0.4); c.stroke();
      c.fillStyle = '#ff9f1a'; circ(c, x + s * 0.11, y - s * 0.42, s * 0.075); c.fill();
      c.fillStyle = '#fff2a8'; circ(c, x + s * 0.11, y - s * 0.42, s * 0.035); c.fill();
    },
    yumi(c, x, y, s) {
      outline(c, s);
      c.fillStyle = '#58b860';
      c.beginPath(); c.moveTo(x - s * 0.26, y + s * 0.36); c.lineTo(x - s * 0.16, y - s * 0.02); c.lineTo(x + s * 0.1, y - s * 0.02); c.lineTo(x + s * 0.16, y + s * 0.36); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#c9f0c0'; circ(c, x - s * 0.04, y - s * 0.16, s * 0.17); c.fill(); c.stroke();
      c.fillStyle = '#14100a'; circ(c, x - s * 0.1, y - s * 0.16, s * 0.028); c.fill(); circ(c, x + s * 0.02, y - s * 0.16, s * 0.028); c.fill();
      c.strokeStyle = '#a8672c'; c.lineWidth = Math.max(1.5, s * 0.08);
      c.beginPath(); c.arc(x + s * 0.14, y + s * 0.04, s * 0.32, -Math.PI * 0.42, Math.PI * 0.42); c.stroke();
      c.strokeStyle = '#f3ead2'; c.lineWidth = Math.max(1, s * 0.03);
      c.beginPath(); c.moveTo(x + s * 0.2, y - s * 0.26); c.lineTo(x + s * 0.2, y + s * 0.34); c.stroke();
    },
  };
  function drawStaff(c, x, y, s) {
    c.strokeStyle = '#14100a'; c.lineWidth = Math.max(2, s * 0.15); c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - s * 0.26, y + s * 0.3); c.lineTo(x + s * 0.1, y - s * 0.08); c.stroke();
    c.strokeStyle = '#b07a3c'; c.lineWidth = Math.max(1, s * 0.08);
    c.beginPath(); c.moveTo(x - s * 0.26, y + s * 0.3); c.lineTo(x + s * 0.1, y - s * 0.08); c.stroke();
    c.lineCap = 'butt';
  }
  const ITEM_DRAW = {
    onigiri(c, x, y, s) {
      outline(c, s);
      c.fillStyle = '#fbfbf4';
      c.beginPath(); c.moveTo(x, y - s * 0.32); c.quadraticCurveTo(x + s * 0.1, y - s * 0.3, x + s * 0.33, y + s * 0.2); c.quadraticCurveTo(x + s * 0.34, y + s * 0.3, x + s * 0.24, y + s * 0.3);
      c.lineTo(x - s * 0.24, y + s * 0.3); c.quadraticCurveTo(x - s * 0.34, y + s * 0.3, x - s * 0.33, y + s * 0.2); c.quadraticCurveTo(x - s * 0.1, y - s * 0.3, x, y - s * 0.32); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#1f2a22'; c.fillRect(x - s * 0.13, y + s * 0.06, s * 0.26, s * 0.24);
    },
    herb(c, x, y, s) {
      outline(c, s);
      c.fillStyle = '#4fc267';
      c.beginPath(); c.moveTo(x, y + s * 0.3); c.quadraticCurveTo(x - s * 0.42, y + s * 0.08, x - s * 0.22, y - s * 0.28); c.quadraticCurveTo(x + s * 0.02, y - s * 0.06, x, y + s * 0.3); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#8be08f';
      c.beginPath(); c.moveTo(x, y + s * 0.3); c.quadraticCurveTo(x + s * 0.44, y + s * 0.1, x + s * 0.26, y - s * 0.22); c.quadraticCurveTo(x + s * 0.02, y - s * 0.02, x, y + s * 0.3); c.closePath(); c.fill(); c.stroke();
    },
    fire(c, x, y, s) {
      drawStaff(c, x, y, s);
      outline(c, s);
      c.fillStyle = '#ff5a2c';
      c.beginPath(); c.moveTo(x + s * 0.16, y - s * 0.4); c.quadraticCurveTo(x + s * 0.4, y - s * 0.14, x + s * 0.2, y + s * 0.02); c.quadraticCurveTo(x - s * 0.04, y - s * 0.04, x + s * 0.16, y - s * 0.4); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#ffd95c'; circ(c, x + s * 0.17, y - s * 0.12, s * 0.065); c.fill();
    },
    warp(c, x, y, s) {
      drawStaff(c, x, y, s);
      outline(c, s);
      c.fillStyle = '#9a7bf0'; circ(c, x + s * 0.17, y - s * 0.17, s * 0.17); c.fill(); c.stroke();
      c.strokeStyle = '#f1eaff'; c.lineWidth = Math.max(1, s * 0.045);
      c.beginPath(); c.arc(x + s * 0.17, y - s * 0.17, s * 0.085, 0.4, Math.PI * 1.7); c.stroke();
    },
    scroll(c, x, y, s) {
      outline(c, s);
      c.fillStyle = '#f0e2b6';
      c.beginPath(); c.rect(x - s * 0.26, y - s * 0.2, s * 0.52, s * 0.4); c.fill(); c.stroke();
      c.fillStyle = '#c9a66b';
      c.beginPath(); c.rect(x - s * 0.34, y - s * 0.26, s * 0.12, s * 0.52); c.fill(); c.stroke();
      c.beginPath(); c.rect(x + s * 0.22, y - s * 0.26, s * 0.12, s * 0.52); c.fill(); c.stroke();
      c.fillStyle = '#c0392b'; c.fillRect(x - s * 0.05, y - s * 0.2, s * 0.1, s * 0.4);
    },
  };
  function drawItem(c, kind, x, y, s) { if (ITEM_DRAW[kind]) ITEM_DRAW[kind](c, x, y, s); }

  function drawStairs(c, x, y, s, now) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 420);
    c.fillStyle = '#5a4a16'; c.fillRect(x - s * 0.5 + 1, y - s * 0.5 + 1, s - 2, s - 2);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const v = 235 - i * 48;
      c.fillStyle = `rgb(${v},${Math.round(v * 0.86)},${Math.round(v * 0.42)})`;
      c.fillRect(x - s * 0.36 + (i * s * 0.72) / n, y - s * 0.34 + (i * s * 0.68) / n, s * 0.72 - (i * s * 0.72) / n, (s * 0.68) / n + 0.5);
    }
    c.strokeStyle = `rgba(255,224,138,${0.65 + 0.35 * pulse})`; c.lineWidth = Math.max(1.5, s * 0.08);
    c.strokeRect(x - s * 0.5 + 1.5, y - s * 0.5 + 1.5, s - 3, s - 3);
  }

  function drawZ(c, x, y, s) {
    c.strokeStyle = '#14100a'; c.lineWidth = Math.max(2.5, s * 0.13); c.lineJoin = 'round'; c.lineCap = 'round';
    const path = () => { c.beginPath(); c.moveTo(x - s * 0.1, y - s * 0.1); c.lineTo(x + s * 0.1, y - s * 0.1); c.lineTo(x - s * 0.1, y + s * 0.1); c.lineTo(x + s * 0.1, y + s * 0.1); c.stroke(); };
    path();
    c.strokeStyle = '#cfd8ff'; c.lineWidth = Math.max(1.2, s * 0.06);
    path();
    c.lineCap = 'butt';
  }
  function drawBang(c, x, y, s) {
    c.fillStyle = '#14100a';
    c.fillRect(x - s * 0.08, y - s * 0.2, s * 0.16, s * 0.3); c.fillRect(x - s * 0.08, y + s * 0.13, s * 0.16, s * 0.13);
    c.fillStyle = '#ffd23f';
    c.fillRect(x - s * 0.045, y - s * 0.17, s * 0.09, s * 0.24); c.fillRect(x - s * 0.045, y + s * 0.15, s * 0.09, s * 0.09);
  }

  function aimCells() {
    // むきをえらんでいる間：8方向それぞれ、届くマスを点で見せる
    const out = [];
    const it = state.player.inv[aim.slot];
    if (!it) return out;
    for (const [dx, dy] of DIRS) {
      if (aim.mode === 'use' && it.kind === 'fire') out.push(Sim.fireCells(state, dx, dy));
      else out.push(Sim.lineShot(state, dx, dy, aim.mode === 'throw' ? Sim.OWN.THROW_RANGE : Sim.OWN.WARP_RANGE).path);
    }
    return out;
  }

  function draw(now) {
    if (!view) return;
    const c = ctx, s = tile, m = view.map;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = '#0c0e14';
    c.fillRect(0, 0, m.w * s, m.h * s);
    // ゆれ
    const sk = (now - shakeState.t0) / shakeState.dur;
    const mag = sk < 1 ? shakeState.amp * (1 - sk) * SHAKE_COEF[settings.shake] : 0;
    if (mag > 0) c.translate(Math.sin(now * 0.09) * mag, Math.cos(now * 0.11) * mag);

    // 床と壁（背景は目立たせない。部屋は通路より少し明るい）
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const t = m.tiles[y * m.w + x];
      if (t === Sim.WALL) { c.fillStyle = '#171a25'; c.fillRect(x * s, y * s, s, s); continue; }
      c.fillStyle = t === Sim.ROOM ? '#3c4260' : '#2f344b';
      c.fillRect(x * s, y * s, s, s);
      c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = 1;
      c.strokeRect(x * s + 0.5, y * s + 0.5, s - 1, s - 1);
    }
    // 巻物：部屋が光る（全画面ではなく、その部屋だけ）
    for (const f of view.fx) if (f.type === 'room') {
      c.fillStyle = `rgba(255,236,160,${0.5 * Math.sin(Math.PI * f.k)})`;
      for (let i = 0; i < m.room.length; i++) if (m.room[i] === f.room) c.fillRect((i % m.w) * s, Math.floor(i / m.w) * s, s, s);
    }

    drawStairs(c, (view.stairs.x + 0.5) * s, (view.stairs.y + 0.5) * s, s, now);
    for (const it of view.items) drawItem(c, it.kind, (it.x + 0.5) * s, (it.y + 0.5) * s, s * 0.92);

    // 自分の足もとの明かり（どれが自分か分かるように）
    const p = view.p;
    const px = (p.x + p.ox + p.lx + 0.5) * s, py = (p.y + p.oy + p.ly + 0.5) * s;
    c.fillStyle = 'rgba(255,240,170,0.2)'; ell(c, (p.x + p.ox + 0.5) * s, (p.y + p.oy + 0.5) * s + s * 0.3, s * 0.42, s * 0.18); c.fill();

    // 敵
    const target = !queue.length && state && !state.over ? Sim.attackTarget(state) : null;
    for (const e of view.enemies) {
      const ex = (e.x + e.ox + e.lx + 0.5) * s, ey = (e.y + e.oy + e.ly + 0.5) * s;
      c.save();
      c.globalAlpha = Math.max(0, e.alpha);
      if (e.scale !== 1) { c.translate(ex, ey); c.scale(e.scale, e.scale); c.translate(-ex, -ey); }
      ENEMY_DRAW[e.kind](c, ex, ey, s);
      const fl = 1 - (now - e.flashT) / 140;
      if (fl > 0) { c.globalAlpha = fl * 0.85; c.fillStyle = '#fff'; circ(c, ex, ey, s * 0.4); c.fill(); }
      c.restore();
      if (e.alpha >= 1) {
        // 体力の棒
        const bw = s * 0.8, bh = Math.max(3, s * 0.11), bx = (e.x + e.ox + 0.5) * s - bw / 2, by = (e.y + e.oy) * s - bh * 0.2;
        c.fillStyle = '#14100a'; c.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        c.fillStyle = '#5b1f1a'; c.fillRect(bx, by, bw, bh);
        c.fillStyle = '#ff8f7a'; c.fillRect(bx, by, bw * Math.max(0, e.hp / e.maxHp), bh);
        if (!e.awake) drawZ(c, ex + s * 0.3, ey - s * 0.26 + Math.sin(now / 500 + e.id) * s * 0.04, s);
        else if (e.alert) drawBang(c, ex + s * 0.32, ey - s * 0.28, s);
      }
      if (target && target.id === e.id) {
        // 攻撃ボタンで叩く相手の印
        const r = s * (0.5 + 0.04 * Math.sin(now / 160));
        c.strokeStyle = '#14100a'; c.lineWidth = Math.max(3, s * 0.14);
        for (let q = 0; q < 4; q++) { c.beginPath(); c.arc(ex, ey, r, q * Math.PI / 2 + 0.25, q * Math.PI / 2 + Math.PI / 2 - 0.25); c.stroke(); }
        c.strokeStyle = '#ffd0c8'; c.lineWidth = Math.max(1.5, s * 0.07);
        for (let q = 0; q < 4; q++) { c.beginPath(); c.arc(ex, ey, r, q * Math.PI / 2 + 0.25, q * Math.PI / 2 + Math.PI / 2 - 0.25); c.stroke(); }
      }
    }

    // 自分
    c.save();
    c.globalAlpha = Math.max(0, p.alpha);
    drawPlayer(c, px, py, s);
    const pf = 1 - (now - p.flashT) / 160;
    if (pf > 0) { c.globalAlpha = pf * 0.8; c.fillStyle = '#ff6f61'; circ(c, px, py, s * 0.42); c.fill(); }
    c.restore();

    // 演出
    for (const f of view.fx) {
      if (f.type === 'fire') {
        f.cells.forEach((cell, i) => {
          const start = (i / Math.max(1, f.cells.length)) * 0.5;
          if (f.k < start) return;
          const a = Math.max(0, 1 - Math.max(0, f.k - 0.55) / 0.45);
          const cx = (cell.x + 0.5) * s, cy = (cell.y + 0.5) * s;
          c.globalAlpha = a;
          c.fillStyle = '#ff5a2c'; circ(c, cx, cy, s * 0.46); c.fill();
          c.fillStyle = '#ffd95c'; circ(c, cx, cy + s * 0.04, s * 0.26); c.fill();
          c.globalAlpha = 1;
        });
      } else if (f.type === 'bolt') {
        const pts = [f.from].concat(f.path);
        const u = Math.min(pts.length - 1, f.k * 1.25 * (pts.length - 1));
        const i = Math.floor(u), fr = u - i, a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)];
        const bx = (a.x + (b.x - a.x) * fr + 0.5) * s, by = (a.y + (b.y - a.y) * fr + 0.5) * s;
        c.fillStyle = '#c9b6ff'; circ(c, bx, by, s * 0.2); c.fill();
        c.strokeStyle = '#7a56e0'; c.lineWidth = Math.max(1.5, s * 0.07); circ(c, bx, by, s * 0.3); c.stroke();
        if (f.to && f.k > 0.7) { c.strokeStyle = '#c9b6ff'; circ(c, (f.to.x + 0.5) * s, (f.to.y + 0.5) * s, s * (0.2 + (f.k - 0.7) * 1.6)); c.stroke(); }
      } else if (f.type === 'fly') {
        const pts = [f.from].concat(f.path);
        const u = f.k * (pts.length - 1);
        const i = Math.min(pts.length - 1, Math.floor(u)), fr = u - i, a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)];
        drawItem(c, f.kind, (a.x + (b.x - a.x) * fr + 0.5) * s, (a.y + (b.y - a.y) * fr + 0.5) * s, s * 0.8);
      } else if (f.type === 'boom') {
        const cx = (f.x + 0.5) * s, cy = (f.y + 0.5) * s;
        c.globalAlpha = Math.max(0, 1 - f.k);
        c.fillStyle = '#ff7a1a'; circ(c, cx, cy, s * (0.5 + 1.1 * ease(f.k))); c.fill();
        c.fillStyle = '#ffe9a0'; circ(c, cx, cy, s * (0.3 + 0.6 * ease(f.k))); c.fill();
        c.globalAlpha = 1;
      } else if (f.type === 'arrow') {
        const ax = (f.from.x + (f.to.x - f.from.x) * f.k + 0.5) * s, ay = (f.from.y + (f.to.y - f.from.y) * f.k + 0.5) * s;
        const len = Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y) || 1;
        const ux = (f.to.x - f.from.x) / len, uy = (f.to.y - f.from.y) / len;
        c.strokeStyle = '#14100a'; c.lineWidth = Math.max(3, s * 0.14); c.lineCap = 'round';
        c.beginPath(); c.moveTo(ax - ux * s * 0.3, ay - uy * s * 0.3); c.lineTo(ax + ux * s * 0.3, ay + uy * s * 0.3); c.stroke();
        c.strokeStyle = '#f3ead2'; c.lineWidth = Math.max(1.5, s * 0.07);
        c.beginPath(); c.moveTo(ax - ux * s * 0.3, ay - uy * s * 0.3); c.lineTo(ax + ux * s * 0.3, ay + uy * s * 0.3); c.stroke();
        c.lineCap = 'butt';
      }
    }

    // むきをえらぶ：届くマスの点
    if (aim && !queue.length && state && !state.over) {
      for (const line of aimCells()) for (const cell of line) {
        const cx = (cell.x + 0.5) * s, cy = (cell.y + 0.5) * s;
        const hit = Sim.enemyAt(state, cell.x, cell.y);
        c.fillStyle = '#14100a'; circ(c, cx, cy, hit ? s * 0.2 : s * 0.13); c.fill();
        c.fillStyle = hit ? '#ff6f61' : '#ffb84a'; circ(c, cx, cy, hit ? s * 0.15 : s * 0.085); c.fill();
      }
    }

    // フロアの切り替え（地図だけ暗くする。全画面は光らせない）
    if (view.fade > 0) { c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = `rgba(12,14,20,${Math.min(1, view.fade)})`; c.fillRect(0, 0, m.w * s, m.h * s); }
  }

  // 叩いたあとの「のめり」が自然に戻る
  let lastFrame = 0;
  function relax(now) {
    const dt = Math.min(50, now - lastFrame);
    lastFrame = now;
    const keep = Math.pow(0.82, dt / 16.7);
    const head = queue[0];
    const lunging = head && head.dur > 0 && head.t0 >= 0 && head.dur === D.lunge * speed;
    if (lunging) return;
    view.p.lx *= keep; view.p.ly *= keep;
    for (const e of view.enemies) { e.lx *= keep; e.ly *= keep; }
  }

  function frame() {
    const now = performance.now();
    clock = now;
    if (view) {
      advance(now);
      relax(now);
      if (hudDirty) { hudDirty = false; renderHud(); }
      if (invDirty) { invDirty = false; renderInv(); }
      draw(now);
    }
    if (BG) setTimeout(frame, 16); else requestAnimationFrame(frame);
  }

  // ---- 起動 ---------------------------------------------------------------
  buildInv();
  buildDpad();
  $('btn-attack').addEventListener('click', pressAttack);
  $('btn-use').addEventListener('click', () => { if (!AUTO && state && !state.over) { flush(); useSelected(); } });
  $('btn-throw').addEventListener('click', () => { if (!AUTO && state && !state.over) { flush(); throwSelected(); } });
  $('btn-cancel').addEventListener('click', cancelSelected);
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-close-settings').addEventListener('click', closeSettings);
  $('btn-sound').addEventListener('click', () => { Sfx.setMuted(!Sfx.isMuted()); renderSettings(); if (!Sfx.isMuted()) Sfx.play('pickup'); });
  $('vol').addEventListener('input', () => { settings.vol = parseInt($('vol').value, 10) / 100; Sfx.setVolume(settings.vol); saveSettings(); renderSettings(); });
  $('vol').addEventListener('change', () => Sfx.play('hit'));
  document.querySelectorAll('.shake-opt').forEach((b) => b.addEventListener('click', () => {
    settings.shake = b.dataset.shake; saveSettings(); renderSettings();
    clock = performance.now(); shake(5, 260); // ためしにゆらして見せる
  }));
  $('btn-retry').addEventListener('click', retry);
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', () => Sfx.unlock(), { passive: true });
  window.addEventListener('resize', layout);

  newGame();
  frame();

  // 確認用（スクリーンショットの道具や、手で調べるときに使う）
  window.__game = {
    get state() { return state; },
    get view() { return view; },
    get firsts() { return firsts; },
    get busy() { return queue.length > 0; },
    get tile() { return tile; },
    act, botStep, flush, newGame,
    params: { AUTO, BG, START_MUTED, seedBase },
  };
})();
