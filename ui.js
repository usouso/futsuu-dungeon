// ui.js — 画面側。作り直し版（シレン6寄せ）。
// ルールは sim.js にだけある。ここは「見せる・入力を受ける・音と揺れ」だけ。
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const startSeed = params.get('seed') ? parseInt(params.get('seed'), 10) : (Date.now() % 100000) + 1;

  // ---- 設定（音量・揺れ・キー） ------------------------------------------
  const LS_SET = 'futsuu2-settings', LS_KEYS = 'futsuu2-keys';
  let settings = { volume: 0.3, muted: params.get('mute') === '1', shake: 'weak' };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(LS_SET) || '{}')); } catch (e) { /* そのまま */ }
  if (params.get('mute') === '1') settings.muted = true;
  let keycfg;
  try { keycfg = Keys.load(JSON.parse(localStorage.getItem(LS_KEYS) || 'null')); }
  catch (e) { keycfg = Keys.defaults(); }
  function saveSettings() { try { localStorage.setItem(LS_SET, JSON.stringify(settings)); } catch (e) {} }
  function saveKeys() { try { localStorage.setItem(LS_KEYS, JSON.stringify(keycfg)); } catch (e) {} }
  Sfx.setVolume(settings.volume);
  Sfx.setMuted(settings.muted);

  // ---- ゲーム状態 ----------------------------------------------------------
  let st = Sim.newGame(startSeed);
  let selected = -1;      // 選択中の持ち物 index（-1 = 未選択）
  let faceMode = false;   // 次の方向入力を「振り向き」にする
  let dashOn = false;
  let dashTimer = null;
  let over = false;

  const ITEM_GLYPH = { onigiri: '食', onigiri_big: '食', grass: '草', scroll: '巻', wand: '杖', weapon: '武', shield: '盾' };
  const ITEM_COLOR = { onigiri: '#f2c14e', onigiri_big: '#f2c14e', grass: '#7bc96f', scroll: '#e8e3d9', wand: '#c792ea', weapon: '#ef5350', shield: '#64b5f6' };

  // ---- 描画 ------------------------------------------------------------------
  const cv = $('map'), ctx = cv.getContext('2d');
  const mm = $('minimap'), mmctx = mm.getContext('2d');
  const VIEW_W = 17, VIEW_H = 13;

  function fitCanvas() {
    const stage = $('stage');
    const w = stage.clientWidth, h = stage.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mm.width = 126 * dpr; mm.height = 90 * dpr;
    mmctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function render() {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    const ts = Math.floor(Math.min(w / VIEW_W, h / VIEW_H));
    const ox = Math.floor((w - ts * VIEW_W) / 2), oy = Math.floor((h - ts * VIEW_H) / 2);
    const p = st.player;
    const camX = Math.max(0, Math.min(st.map.w - VIEW_W, p.x - (VIEW_W >> 1)));
    const camY = Math.max(0, Math.min(st.map.h - VIEW_H, p.y - (VIEW_H >> 1)));
    const vis = Sim.visibleSet(st);
    ctx.fillStyle = '#10131c';
    ctx.fillRect(0, 0, w, h);

    for (let vy = 0; vy < VIEW_H; vy++) for (let vx = 0; vx < VIEW_W; vx++) {
      const x = camX + vx, y = camY + vy;
      if (x < 0 || y < 0 || x >= st.map.w || y >= st.map.h) continue;
      const idx = y * st.map.w + x;
      const seen = vis.has(idx), explored = st.explored[idx];
      if (!seen && !explored) continue;
      const t = Sim.tileAt(st, x, y);
      const px = ox + vx * ts, py = oy + vy * ts;
      if (t === 0) ctx.fillStyle = seen ? '#3a4157' : '#232838';
      else if (t === 1) ctx.fillStyle = seen ? '#8a7f5c' : '#4c4636';
      else ctx.fillStyle = seen ? '#6f6a58' : '#3e3a30';
      ctx.fillRect(px, py, ts - 1, ts - 1);
      if (st.stairs.x === x && st.stairs.y === y && (seen || explored)) {
        ctx.fillStyle = '#ffd54f';
        ctx.font = 'bold ' + Math.floor(ts * 0.7) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('階', px + ts / 2, py + ts / 2 + 1);
      }
      if (st.dekaiHole && st.dekaiHole.x === x && st.dekaiHole.y === y && (seen || explored)) {
        ctx.fillStyle = '#14100e';
        ctx.beginPath(); ctx.arc(px + ts / 2, py + ts / 2, ts * 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e0e0e0';
        ctx.font = 'bold ' + Math.floor(ts * 0.5) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('穴', px + ts / 2, py + ts / 2 + 1);
      }
      const trap = st.traps.find((t2) => t2.x === x && t2.y === y && t2.found);
      if (trap && seen) {
        ctx.strokeStyle = '#ff7043'; ctx.lineWidth = 2;
        ctx.strokeRect(px + 3, py + 3, ts - 7, ts - 7);
      }
      const it = st.items.find((i) => i.x === x && i.y === y);
      if (it && seen) {
        ctx.fillStyle = ITEM_COLOR[it.kind] || '#fff';
        const s = ts * 0.62;
        ctx.fillRect(px + (ts - s) / 2, py + (ts - s) / 2, s, s);
        ctx.fillStyle = '#14161f';
        ctx.font = 'bold ' + Math.floor(ts * 0.42) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(ITEM_GLYPH[it.kind] || '？', px + ts / 2, py + ts / 2 + 1);
      }
    }

    // デッ怪（3×3）
    const dk = st.dekai;
    if (dk && dk.active) {
      const px = ox + (dk.x - 1 - camX) * ts, py = oy + (dk.y - 1 - camY) * ts;
      if (px + ts * 3 > 0 && py + ts * 3 > 0) {
        for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) {
          const tx = dk.x - 1 + xx, ty = dk.y - 1 + yy;
          const vuln = Sim.dekaiVulnerable(st, tx, ty);
          ctx.fillStyle = vuln ? '#8e3b2f' : '#5d4037';
          ctx.fillRect(px + xx * ts + 1, py + yy * ts + 1, ts - 2, ts - 2);
        }
        // バリア側（前・左右）を明るい枠で示す
        ctx.fillStyle = '#cfd8dc';
        ctx.font = 'bold ' + Math.floor(ts * 0.6) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('デ', px + ts * 1.5, py + ts * 1.5);
        ctx.fillStyle = '#ffab91';
        ctx.font = 'bold ' + Math.floor(ts * 0.34) + 'px sans-serif';
        ctx.fillText('弱点は中心と背中', px + ts * 1.5, py + ts * 0.35);
      }
    }
    // 敵
    for (const e of st.enemies) {
      const idx = e.y * st.map.w + e.x;
      if (!vis.has(idx)) continue;
      const px = ox + (e.x - camX) * ts, py = oy + (e.y - camY) * ts;
      ctx.fillStyle = e.awake ? '#b03a2e' : '#6e6e6e';
      ctx.beginPath(); ctx.arc(px + ts / 2, py + ts / 2, ts * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.floor(ts * 0.44) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(e.glyph, px + ts / 2, py + ts / 2 + 1);
      if (!e.awake) {
        ctx.fillStyle = '#cfd8dc';
        ctx.font = 'bold ' + Math.floor(ts * 0.34) + 'px sans-serif';
        ctx.fillText('z', px + ts * 0.78, py + ts * 0.2);
      }
      if (e.paralyze > 0) {
        ctx.fillStyle = '#ffe082';
        ctx.font = 'bold ' + Math.floor(ts * 0.34) + 'px sans-serif';
        ctx.fillText('止', px + ts * 0.2, py + ts * 0.2);
      }
    }
    // プレイヤー
    {
      const px = ox + (p.x - camX) * ts, py = oy + (p.y - camY) * ts;
      ctx.fillStyle = p.dosukoi ? '#ff9800' : '#fdd835';
      ctx.beginPath(); ctx.arc(px + ts / 2, py + ts / 2, ts * (p.dosukoi ? 0.48 : 0.4), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#14161f';
      ctx.font = 'bold ' + Math.floor(ts * 0.46) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('シ', px + ts / 2, py + ts / 2 + 1);
      const d = Sim.DIRS[p.dir];
      ctx.fillStyle = '#14161f';
      ctx.beginPath();
      ctx.arc(px + ts / 2 + d.dx * ts * 0.52, py + ts / 2 + d.dy * ts * 0.52, Math.max(2, ts * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }
    renderMinimap();
    renderHud();
  }

  function renderMinimap() {
    const W = 126, H = 90;
    mmctx.fillStyle = '#0b0e16';
    mmctx.fillRect(0, 0, W, H);
    const sx = W / st.map.w, sy = H / st.map.h;
    for (let y = 0; y < st.map.h; y++) for (let x = 0; x < st.map.w; x++) {
      if (!st.explored[y * st.map.w + x]) continue;
      if (Sim.tileAt(st, x, y) === 0) continue;
      mmctx.fillStyle = '#7d7460';
      mmctx.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy));
    }
    mmctx.fillStyle = '#ffd54f';
    mmctx.fillRect(st.stairs.x * sx - 1, st.stairs.y * sy - 1, 3, 3);
    if (st.dekaiHole) {
      mmctx.fillStyle = '#ff7043';
      mmctx.fillRect(st.dekaiHole.x * sx - 1, st.dekaiHole.y * sy - 1, 3, 3);
    }
    if (st.dekai && st.dekai.active) {
      mmctx.fillStyle = '#ef5350';
      mmctx.fillRect(st.dekai.x * sx - 2, st.dekai.y * sy - 2, 5, 5);
    }
    mmctx.fillStyle = '#fff';
    mmctx.fillRect(st.player.x * sx - 1, st.player.y * sy - 1, 3, 3);
  }

  function renderHud() {
    const p = st.player;
    $('hud-floor').textContent = st.floor + 'F／' + Sim.SPEC.FLOORS + 'F';
    $('hud-lv-text').textContent = 'Lv ' + p.level;
    $('xp-fill').style.width = Math.min(100, (p.exp / (p.level * 20)) * 100) + '%';
    $('hud-atk').textContent = '攻撃 ' + Sim.playerAtk(st);
    $('hud-str').textContent = 'ちから ' + p.str + '/' + p.maxstr;
    $('hud-dosukoi').hidden = !p.dosukoi;
    $('hud-weapon').textContent = '武器：' + Sim.itemName(st, p.weapon);
    $('hud-shield').textContent = '盾：' + Sim.itemName(st, p.shield);
    $('hp-fill').style.width = Math.max(0, (p.hp / p.maxhp) * 100) + '%';
    $('hp-num').textContent = p.hp + '/' + p.maxhp;
    $('food-fill').style.width = Math.max(0, Math.min(100, (p.hunger / (p.maxhunger + 50)) * 100)) + '%';
    $('food-num').textContent = p.hunger + '/' + p.maxhunger + (p.dosukoi ? '（ドスコイ中）' : '');
    const facing = Sim.enemyAt(st, p.x + Sim.DIRS[p.dir].dx, p.y + Sim.DIRS[p.dir].dy);
    const dkFace = Sim.dekaiTileAt(st, p.x + Sim.DIRS[p.dir].dx, p.y + Sim.DIRS[p.dir].dy);
    $('attack-target').textContent = facing ? '→ ' + facing.name : (dkFace ? '→ デッ怪' : '（素振り）');
    $('btn-descend').disabled = !(p.x === st.stairs.x && p.y === st.stairs.y);
    renderInv();
  }

  function renderInv() {
    const box = $('inv');
    box.innerHTML = '';
    st.inv.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inv-item' + (i === selected ? ' sel' : '');
      b.textContent = (i + 1) + '. ' + Sim.itemName(st, it);
      b.addEventListener('click', () => { selectItem(i); });
      box.appendChild(b);
    });
    if (!st.inv.length) {
      const s = document.createElement('span');
      s.className = 'inv-empty';
      s.textContent = '持ち物はない';
      box.appendChild(s);
    }
    const it = st.inv[selected];
    $('item-name').textContent = it ? Sim.itemName(st, it) : '';
    $('btn-use').disabled = !it;
    $('btn-throw').disabled = !it;
    $('btn-use').textContent = it && (it.kind === 'weapon' || it.kind === 'shield') ? '装備' : '使う';
  }

  // ---- ログ・演出 -----------------------------------------------------------
  function pushLog(s) {
    const log = $('log');
    const div = document.createElement('div');
    div.textContent = s;
    log.appendChild(div);
    while (log.children.length > 40) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function shake(px) {
    if (settings.shake === 'off') return;
    const mag = settings.shake === 'weak' ? Math.min(3, px) : px;
    cv.style.transform = 'translate(' + (Math.random() * mag * 2 - mag) + 'px,' + (Math.random() * mag * 2 - mag) + 'px)';
    setTimeout(() => { cv.style.transform = ''; }, 90);
  }

  // ---- 行動 -------------------------------------------------------------------
  function stopDash() { dashOn = false; $('btn-dash').textContent = 'ダッシュ：オフ'; if (dashTimer) { clearTimeout(dashTimer); dashTimer = null; } }

  function act(action) {
    if (over) return;
    Sfx.unlock();
    const ev = Sim.step(st, action);
    let hurt = false;
    for (const e of ev) {
      if (e.t === 'msg') pushLog(e.s);
      else if (e.t === 'pdmg') { hurt = true; Sfx.play('hurt'); }
      else if (e.t === 'edmg') Sfx.play('hit');
      else if (e.t === 'edie') Sfx.play('kill');
      else if (e.t === 'move') Sfx.play('step');
      else if (e.t === 'floor') pushLog('―― ' + e.floor + 'フロア目 ――');
    }
    if (hurt) shake(4);
    if (selected >= st.inv.length) selected = -1;
    render();
    if (st.over) return endGame(false);
    if (st.clear) return endGame(true);
  }

  function endGame(won) {
    over = true;
    stopDash();
    const p = st.player;
    $('end-title').textContent = won ? '踏破した！' : 'たおれた…';
    $('end-cause').textContent = won ? Sim.SPEC.FLOORS + 'フロアを抜けきった。' : '死因：' + (st.deathCause || '不明');
    $('end-stats').textContent = '到達 ' + st.floor + 'F／' + st.turn + 'ターン／倒した敵 ' + st.stats.kills + '／使った道具 ' + st.stats.usedItems;
    $('end-left').textContent = '武器：' + Sim.itemName(st, p.weapon) + '　盾：' + Sim.itemName(st, p.shield);
    $('end-seed').textContent = 'シード ' + st.seed;
    $('end').hidden = false;
    Sfx.play(won ? 'kill' : 'hurt');
  }

  function selectItem(i) {
    selected = (selected === i) ? -1 : i;
    renderInv();
  }

  function dashStep(dir) {
    if (!dashOn || over) return;
    const before = { x: st.player.x, y: st.player.y, hp: st.player.hp, floor: st.floor };
    act({ type: 'move', dir });
    const p = st.player;
    const vis = Sim.visibleSet(st);
    const enemyNear = st.enemies.some((e) => e.awake && vis.has(e.y * st.map.w + e.x));
    const dekaiNear = st.dekai && st.dekai.active && Math.max(Math.abs(st.dekai.x - p.x), Math.abs(st.dekai.y - p.y)) <= 4;
    // 分かれ道（今いる場所から、来た方向以外に2つ以上の出口）
    let exits = 0;
    for (let i = 0; i < 8; i++) {
      const nx = p.x + Sim.DIRS[i].dx, ny = p.y + Sim.DIRS[i].dy;
      if (Sim.tileAt(st, nx, ny) !== 0 && !Sim.enemyAt(st, nx, ny)) exits++;
    }
    const stopped =
      p.hp < before.hp || p.floor !== before.floor ||
      (p.x === before.x && p.y === before.y) ||
      (p.x === st.stairs.x && p.y === st.stairs.y) ||
      enemyNear || dekaiNear || exits >= 4 || st.over || st.clear;
    if (stopped) { stopDash(); return; }
    dashTimer = setTimeout(() => dashStep(dir), 95);
  }

  function setFaceMode(on) {
    faceMode = on;
    $('btn-face').textContent = on ? 'むき：オン（方向を押して）' : 'むき：オフ';
  }
  function doMove(dir) {
    if (faceMode) { setFaceMode(false); act({ type: 'face', dir }); return; }
    if (dashOn) { dashStep(dir); return; }
    act({ type: 'move', dir });
  }

  // ---- 入力（ボタン） --------------------------------------------------------------
  const dpad = $('dpad');
  const DIR_ORDER = [7, 0, 1, 6, -1, 2, 5, 4, 3]; // 左上,上,右上,左,中央,右,左下,下,右下
  const DIR_LABEL = ['↖', '↑', '↗', '←', '・', '→', '↙', '↓', '↘'];
  DIR_ORDER.forEach((dir, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = DIR_LABEL[i];
    b.setAttribute('aria-label', dir >= 0 ? Sim.DIRS[dir].name + 'へ動く' : '足踏み');
    b.addEventListener('click', () => {
      if (dir < 0) { stopDash(); act({ type: 'wait' }); }
      else doMove(dir);
    });
    dpad.appendChild(b);
  });
  $('btn-attack').addEventListener('click', () => { stopDash(); act({ type: 'attack' }); });
  $('btn-use').addEventListener('click', () => { if (selected >= 0) { stopDash(); act({ type: 'use', index: selected }); } });
  $('btn-throw').addEventListener('click', () => { if (selected >= 0) { stopDash(); act({ type: 'throw', index: selected }); selected = -1; renderInv(); } });
  $('btn-cancel').addEventListener('click', () => { selected = -1; renderInv(); });
  $('btn-descend').addEventListener('click', () => { stopDash(); act({ type: 'descend' }); });
  $('btn-face').addEventListener('click', () => { setFaceMode(!faceMode); });
  $('btn-dash').addEventListener('click', () => {
    dashOn = !dashOn;
    $('btn-dash').textContent = dashOn ? 'ダッシュ：オン' : 'ダッシュ：オフ';
    if (!dashOn && dashTimer) { clearTimeout(dashTimer); dashTimer = null; }
  });
  $('btn-retry').addEventListener('click', () => {
    $('end').hidden = true;
    over = false; selected = -1; stopDash();
    $('log').innerHTML = '';
    st = Sim.newGame((Date.now() % 100000) + 1);
    pushLog('新しい冒険が始まった。');
    render();
  });

  // ---- 入力（キーボード） --------------------------------------------------------------
  let capturing = null; // キー設定で「次のキー」を待っている操作id
  document.addEventListener('keydown', (e) => {
    if (capturing) {
      e.preventDefault();
      const r = Keys.assign(keycfg, capturing, e.code, Keys.labelFromEvent(e));
      $('key-msg').textContent = r.ok ? '割り当てた。' : 'そのキーは使えない。';
      capturing = null;
      saveKeys();
      buildKeyCfg();
      return;
    }
    if (!$('keycfg').hidden || !$('settings').hidden) {
      if (e.code === 'Escape') { $('keycfg').hidden = true; $('settings').hidden = true; }
      return;
    }
    const id = Keys.lookup(keycfg, e.code);
    if (!id) {
      if (/^Digit[1-8]$/.test(e.code)) {
        const n = parseInt(e.code.slice(5), 10) - 1;
        if (st.inv[n]) selectItem(n);
      }
      return;
    }
    e.preventDefault();
    const a = Keys.BY_ID[id];
    if (a && a.dir) {
      const dir = Sim.DIRS.findIndex((d) => d.dx === a.dir[0] && d.dy === a.dir[1]);
      if (e.shiftKey) { setFaceMode(false); act({ type: 'face', dir }); }
      else doMove(dir);
    } else if (id === 'attack') { stopDash(); act({ type: 'attack' }); }
    else if (id === 'wait') { stopDash(); act({ type: 'wait' }); }
    else if (id === 'item') {
      if (st.inv.length) selectItem(((selected + 1) % st.inv.length));
    } else if (id === 'use') { if (selected >= 0) { stopDash(); act({ type: 'use', index: selected }); } }
    else if (id === 'throw') { if (selected >= 0) { stopDash(); act({ type: 'throw', index: selected }); selected = -1; renderInv(); } }
    else if (id === 'cancel') { selected = -1; renderInv(); }
  });

  // ---- 設定画面 ---------------------------------------------------------------------
  $('btn-settings').addEventListener('click', () => {
    $('vol').value = Math.round(settings.volume * 100);
    $('vol-num').textContent = Math.round(settings.volume * 100);
    $('btn-sound').textContent = settings.muted ? 'オフ' : 'オン';
    document.querySelectorAll('.shake-opt').forEach((b) => b.classList.toggle('sel', b.dataset.shake === settings.shake));
    $('seed-line').textContent = 'シード ' + st.seed + '（URLに ?seed=数字 で同じ冒険を再現できる）';
    $('settings').hidden = false;
  });
  $('btn-close-settings').addEventListener('click', () => { $('settings').hidden = true; });
  $('btn-sound').addEventListener('click', () => {
    settings.muted = !settings.muted;
    Sfx.setMuted(settings.muted);
    $('btn-sound').textContent = settings.muted ? 'オフ' : 'オン';
    saveSettings();
  });
  $('vol').addEventListener('input', () => {
    settings.volume = parseInt($('vol').value, 10) / 100;
    $('vol-num').textContent = $('vol').value;
    Sfx.setVolume(settings.volume);
    saveSettings();
  });
  document.querySelectorAll('.shake-opt').forEach((b) => b.addEventListener('click', () => {
    settings.shake = b.dataset.shake;
    document.querySelectorAll('.shake-opt').forEach((x) => x.classList.toggle('sel', x === b));
    saveSettings();
  }));
  $('btn-keycfg').addEventListener('click', () => { buildKeyCfg(); $('keycfg').hidden = false; });
  $('btn-close-keycfg').addEventListener('click', () => { $('keycfg').hidden = true; });
  $('btn-key-reset').addEventListener('click', () => {
    keycfg = Keys.defaults();
    saveKeys();
    buildKeyCfg();
    $('key-msg').textContent = 'はじめのキーに戻した。';
  });

  function buildKeyCfg() {
    const dirs = $('key-dirs'), acts = $('key-acts');
    dirs.innerHTML = ''; acts.innerHTML = '';
    for (const a of Keys.ACTIONS) {
      const row = document.createElement('div');
      row.className = 'key-row';
      const name = document.createElement('span');
      name.textContent = a.name;
      const cur = document.createElement('span');
      cur.className = 'key-cur';
      cur.textContent = Keys.label(keycfg, a.id) || 'なし';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '変える';
      btn.addEventListener('click', () => {
        capturing = a.id;
        $('key-msg').textContent = '「' + a.name + '」に割り当てるキーを押して。';
      });
      row.appendChild(name); row.appendChild(cur); row.appendChild(btn);
      (a.dir || a.id === 'wait' ? dirs : acts).appendChild(row);
    }
  }

  window.addEventListener('resize', fitCanvas);
  pushLog('ダンジョンに入った。階段を探そう。');
  pushLog('攻撃ボタンで、向いている方向に振る。敵がいなければ素振り（罠探しにもなる）。');
  pushLog('壁の方向を押すと、ターンを進めずに向きだけ変わる。開けた方向には「むき」ボタン→方向でも変えられる。');
  fitCanvas();
  render();
})();
