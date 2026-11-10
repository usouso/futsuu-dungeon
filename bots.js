// bots.js — 測定用ボット（作り直し版）。 node bots.js [試行回数]
// ボットは地図を全部知っている前提で動く（難しさの目安用。人間の初見とは別）。
'use strict';
const Sim = require('./sim.js');

function walkable(st, x, y, forPlayer) {
  if (Sim.tileAt(st, x, y) === 0) return false;
  if (forPlayer) {
    if (Sim.enemyAt(st, x, y)) return false;
    if (Sim.dekaiTileAt(st, x, y)) return false;
  }
  return true;
}
// BFS：(sx,sy) から (tx,ty) への最初の一歩の dir を返す。たどり着けなければ -1。
function bfsDir(st, sx, sy, tx, ty, avoidEnemies) {
  if (sx === tx && sy === ty) return -2;
  const W = st.map.w, H = st.map.h;
  const prev = new Map();
  const key = (x, y) => y * W + x;
  const q = [[sx, sy]];
  prev.set(key(sx, sy), null);
  while (q.length) {
    const [x, y] = q.shift();
    for (let d = 0; d < 8; d++) {
      const nx = x + Sim.DIRS[d].dx, ny = y + Sim.DIRS[d].dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (prev.has(key(nx, ny))) continue;
      if (Sim.tileAt(st, nx, ny) === 0) continue;
      if (Sim.DIRS[d].dx !== 0 && Sim.DIRS[d].dy !== 0 &&
          Sim.tileAt(st, x + Sim.DIRS[d].dx, y) === 0 && Sim.tileAt(st, x, y + Sim.DIRS[d].dy) === 0) continue;
      const isTarget = nx === tx && ny === ty;
      if (!isTarget) {
        if (Sim.enemyAt(st, nx, ny)) continue;
        if (Sim.dekaiTileAt(st, nx, ny)) continue;
        if (avoidEnemies && st.enemies.some((e) => e.awake && Math.max(Math.abs(e.x - nx), Math.abs(e.y - ny)) <= 1)) continue;
      }
      prev.set(key(nx, ny), key(x, y));
      if (isTarget) {
        // 経路をたどって最初の一歩を返す
        let cur = key(nx, ny), last = null;
        while (prev.get(cur) !== null && prev.get(cur) !== undefined) { last = cur; cur = prev.get(cur); if (cur === key(sx, sy)) break; }
        const fx = last % W, fy = Math.floor(last / W);
        for (let dd = 0; dd < 8; dd++) if (sx + Sim.DIRS[dd].dx === fx && sy + Sim.DIRS[dd].dy === fy) return dd;
        return -1;
      }
      q.push([nx, ny]);
    }
  }
  return -1;
}

function adjacentEnemyDir(st) {
  const p = st.player;
  for (let d = 0; d < 8; d++) {
    if (Sim.enemyAt(st, p.x + Sim.DIRS[d].dx, p.y + Sim.DIRS[d].dy)) return d;
  }
  return -1;
}

function dekaiNear(st, r) {
  const d = st.dekai;
  if (!d || !d.active) return false;
  return Math.max(Math.abs(d.x - st.player.x), Math.abs(d.y - st.player.y)) <= r;
}

function fleeDekai(st) {
  const d = st.dekai, p = st.player;
  let best = -1, bestScore = -1;
  for (let dir = 0; dir < 8; dir++) {
    const nx = p.x + Sim.DIRS[dir].dx, ny = p.y + Sim.DIRS[dir].dy;
    if (!walkable(st, nx, ny, true)) continue;
    const score = Math.max(Math.abs(d.x - nx), Math.abs(d.y - ny)) * 10 - Math.abs(st.stairs.x - nx) - Math.abs(st.stairs.y - ny);
    if (score > bestScore) { bestScore = score; best = dir; }
  }
  return best;
}

function makeBot(kind, seed) {
  const st = Sim.newGame(seed);
  let rngState = seed * 7919 + 13;
  const rnd = () => { rngState = (rngState * 1103515245 + 12345) % 2147483648; return rngState / 2147483648; };
  return { st, rnd, kind };
}

function botStep(bot) {
  const st = bot.st, p = st.player, kind = bot.kind;
  if (st.over || st.clear) return;

  if (kind === 'random') {
    const r = bot.rnd();
    if (r < 0.7) Sim.step(st, { type: 'move', dir: Math.floor(bot.rnd() * 8) });
    else if (r < 0.85) Sim.step(st, { type: 'attack' });
    else if (st.inv[0]) Sim.step(st, { type: 'use', index: 0 });
    else Sim.step(st, { type: 'wait' });
    if (p.x === st.stairs.x && p.y === st.stairs.y) Sim.step(st, { type: 'descend' });
    return;
  }

  // デッ怪から逃げる（全ボット共通の安全装置：本体から2マス以上あける）
  if (dekaiNear(st, 4)) {
    const d = fleeDekai(st);
    if (d >= 0) { Sim.step(st, { type: 'move', dir: d }); return; }
  }

  // 囲まれて危ないときは1歩引く（smart のみ：通路に引けば同時に叩かれにくい）
  if (kind === 'smart') {
    const nearCount = st.enemies.filter((e) => e.awake && Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) <= 2).length;
    if (nearCount >= 2 && p.hp < p.maxhp * 0.6) {
      let bestDir = -1, bestScore = -1;
      for (let d = 0; d < 8; d++) {
        const nx = p.x + Sim.DIRS[d].dx, ny = p.y + Sim.DIRS[d].dy;
        if (!walkable(st, nx, ny, true)) continue;
        const minDist = Math.min(...st.enemies.filter((e) => e.awake).map((e) => Math.max(Math.abs(e.x - nx), Math.abs(e.y - ny))));
        if (minDist > bestScore) { bestScore = minDist; bestDir = d; }
      }
      if (bestDir >= 0 && bestScore >= 2) { Sim.step(st, { type: 'move', dir: bestDir }); return; }
    }
  }

  // ゆみへいの射線上にいて距離があるなら、線を外す1歩を優先（smart のみ）
  if (kind === 'smart') {
    const archers = st.enemies.filter((e) => e.awake && e.kind === 'yumiya');
    for (const a of archers) {
      const dx = p.x - a.x, dy = p.y - a.y;
      const cheb = Math.max(Math.abs(dx), Math.abs(dy));
      if (cheb < 2 || cheb > 5) continue;
      if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) continue;
      // 今のマスが射線。射線から外れる隣接マスへ
      let done = false;
      for (let d = 0; d < 8 && !done; d++) {
        const nx = p.x + Sim.DIRS[d].dx, ny = p.y + Sim.DIRS[d].dy;
        if (!walkable(st, nx, ny, true)) continue;
        const ndx = nx - a.x, ndy = ny - a.y;
        const inLine = ndx === 0 || ndy === 0 || Math.abs(ndx) === Math.abs(ndy);
        if (!inLine) { Sim.step(st, { type: 'move', dir: d }); done = true; }
      }
      if (done) return;
    }
  }

  // 隣接する敵は叩く（一番弱っているものから）
  const adj = adjacentEnemyDir(st);
  if (adj >= 0) {
    let targetDir = adj, lowest = Infinity;
    for (let d = 0; d < 8; d++) {
      const e = Sim.enemyAt(st, p.x + Sim.DIRS[d].dx, p.y + Sim.DIRS[d].dy);
      if (e && e.hp < lowest) { lowest = e.hp; targetDir = d; }
    }
    Sim.step(st, { type: 'move', dir: targetDir });
    return;
  }
  if (Sim.dekaiTileAt(st, p.x + Sim.DIRS[p.dir].dx, p.y + Sim.DIRS[p.dir].dy)) {
    Sim.step(st, { type: 'move', dir: (p.dir + 3) % 8 }); return;
  }

  if (kind === 'smart') {
    // 持ち物がいっぱいなら、価値の低い物を投げて空ける（置く代わり）
    if (st.inv.length >= 15) {
      const ji = st.inv.findIndex((it) => {
        const tk = Sim.itemTrueKind(st, it);
        return (it.kind === 'scroll' && tk !== 'makimodoshi' && tk !== 'shikibetsu') ||
               (it.kind === 'grass' && tk !== 'yakusou') ||
               (it.kind === 'wand' && tk !== 'kaen' && tk !== 'kanashibari');
      });
      if (ji >= 0) { Sim.step(st, { type: 'throw', index: ji }); return; }
    }
    // 装備：より強い武器・盾を持ったら替える
    for (let i = 0; i < st.inv.length; i++) {
      const it = st.inv[i];
      if (it.kind === 'weapon' && Sim.equipPow(it) > Sim.equipPow(p.weapon)) { Sim.step(st, { type: 'equip', index: i }); return; }
      if (it.kind === 'shield' && Sim.equipPow(it) > Sim.equipPow(p.shield)) { Sim.step(st, { type: 'equip', index: i }); return; }
    }
    // 回復待ち：敵が見えず HP が低く、お腹に余裕がある間は足踏みで回復
    const vis = Sim.visibleSet(st);
    const enemyVisible = st.enemies.some((e) => e.awake && vis.has(e.y * st.map.w + e.x));
    if (p.hp < p.maxhp * 0.85 && p.hunger > 25 && !enemyVisible) { Sim.step(st, { type: 'wait' }); return; }
    // 食べる
    if (p.hunger < 45) {
      const i = st.inv.findIndex((it) => it.kind === 'onigiri_big' || it.kind === 'onigiri');
      if (i >= 0) { Sim.step(st, { type: 'use', index: i }); return; }
    }
    // 部屋に敵が3体以上起きていたら まきもどし
    {
      const pr = Sim.roomAt(st, p.x, p.y);
      const inRoom = st.enemies.filter((e) => e.awake && Sim.roomAt(st, e.x, e.y) === pr && pr >= 0);
      if (inRoom.length >= 3) {
        const i = st.inv.findIndex((it) => it.kind === 'scroll' && Sim.itemTrueKind(st, it) === 'makimodoshi');
        if (i >= 0) { Sim.step(st, { type: 'use', index: i }); return; }
      }
    }
    // 速い・固い敵が一直線にいたら かなしばり の杖／ねむり草を投げる
    {
      const visE = st.enemies.filter((e) => e.awake);
      for (const e of visE) {
        const dx = e.x - p.x, dy = e.y - p.y;
        const cheb = Math.max(Math.abs(dx), Math.abs(dy));
        if (cheb < 2 || cheb > 5) continue;
        if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) continue;
        const strong = e.speed === 2 || e.def >= 5 || e.kind === 'ganko';
        if (!strong) continue;
        p.dir = Sim.DIRS.findIndex((d) => d.dx === Math.sign(dx) && d.dy === Math.sign(dy));
        const wi = st.inv.findIndex((it) => it.kind === 'wand' && Sim.itemTrueKind(st, it) === 'kanashibari');
        if (wi >= 0) { Sim.step(st, { type: 'use', index: wi }); return; }
        const gi = st.inv.findIndex((it) => it.kind === 'grass' && Sim.itemTrueKind(st, it) === 'nemuri');
        if (gi >= 0) { Sim.step(st, { type: 'throw', index: gi }); return; }
      }
    }
    // 危ないときは やくそう
    if (p.hp < p.maxhp * 0.35) {
      const i = st.inv.findIndex((it) => it.kind === 'grass' && Sim.itemTrueKind(st, it) === 'yakusou');
      if (i >= 0) { Sim.step(st, { type: 'use', index: i }); return; }
    }
    // 固い敵に かえん の杖（一直線にいるとき）
    const tough = st.enemies.find((e) => e.awake && e.def >= 5);
    if (tough) {
      const dx = tough.x - p.x, dy = tough.y - p.y;
      if ((dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) && Math.max(Math.abs(dx), Math.abs(dy)) <= 8) {
        const i = st.inv.findIndex((it) => it.kind === 'wand' && Sim.itemTrueKind(st, it) === 'kaen');
        if (i >= 0) {
          p.dir = Sim.DIRS.findIndex((d) => d.dx === Math.sign(dx) && d.dy === Math.sign(dy));
          Sim.step(st, { type: 'use', index: i });
          return;
        }
      }
    }
  }

  // 行き先：rush と noitem は階段直行／smart は装備→未探索の部屋→階段
  let target = st.stairs;
  if (kind === 'smart') {
    const gear = st.items.filter((it) =>
      (it.kind === 'weapon' && Sim.equipPow(it) > Sim.equipPow(p.weapon)) ||
      (it.kind === 'shield' && Sim.equipPow(it) > Sim.equipPow(p.shield)))
      .sort((a, b) => (Math.abs(a.x - p.x) + Math.abs(a.y - p.y)) - (Math.abs(b.x - p.x) + Math.abs(b.y - p.y)))[0];
    if (gear) target = { x: gear.x, y: gear.y };
    else {
      const unvisited = st.map.rooms.find((r) => !st.explored[r.cy * st.map.w + r.cx]);
      if (unvisited) target = { x: unvisited.cx, y: unvisited.cy };
    }
  }
  if (p.x === st.stairs.x && p.y === st.stairs.y) { Sim.step(st, { type: 'descend' }); return; }
  let dir = bfsDir(st, p.x, p.y, target.x, target.y, kind === 'rush');
  if (dir === -2) { Sim.step(st, { type: 'wait' }); return; }
  if (dir === -1) {
    // 敵が道をふさいでいる等：階段に一番近い敵へ向かう
    const near = st.enemies.slice().sort((a, b) =>
      (Math.abs(a.x - st.stairs.x) + Math.abs(a.y - st.stairs.y)) - (Math.abs(b.x - st.stairs.x) + Math.abs(b.y - st.stairs.y)))[0];
    if (near) dir = bfsDir(st, p.x, p.y, near.x, near.y, false);
  }
  if (dir >= 0) Sim.step(st, { type: 'move', dir });
  else Sim.step(st, { type: 'wait' });
}

function runBot(kind, seed, maxTurns) {
  const bot = makeBot(kind, seed);
  const st = bot.st;
  let dekaiFloorDeath = false;
  for (let i = 0; i < (maxTurns || 4000); i++) {
    botStep(bot);
    if (st.over) { dekaiFloorDeath = st.floor === Sim.SPEC.DEKAI_FLOOR; break; }
    if (st.clear) break;
  }
  return {
    kind, seed,
    result: st.clear ? 'clear' : st.over ? 'dead' : 'timeout',
    floor: st.floor, turns: st.turn, cause: st.deathCause || '',
    dekaiFloorDeath, level: st.player.level, kills: st.stats.kills,
  };
}

if (require.main === module) {
  const n = parseInt(process.argv[2] || '30', 10);
  for (const kind of ['random', 'noitem', 'smart', 'rush']) {
    let clear = 0, dead = 0, timeout = 0, dekaiDeaths = 0;
    const causes = {};
    for (let s = 1; s <= n; s++) {
      const r = runBot(kind, 1000 + s * 37);
      if (r.result === 'clear') clear++;
      else if (r.result === 'dead') { dead++; causes[r.cause] = (causes[r.cause] || 0) + 1; }
      else timeout++;
      if (r.dekaiFloorDeath) dekaiDeaths++;
    }
    const top = Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + '×' + v).join('、');
    console.log(kind + ': クリア ' + (clear / n * 100).toFixed(1) + '% 死 ' + dead + ' 時間切れ ' + timeout + ' デッ怪フロア死 ' + dekaiDeaths + (top ? '（主な死因：' + top + '）' : ''));
  }
}
module.exports = { runBot };
