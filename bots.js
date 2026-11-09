// bots.js — ボット4種。ルール側（sim.js）だけを使って、画面なしで何百回も遊ばせる。
// 実行: node bots.js [回数=500] [最初のseed=1]
// ブラウザでは ?auto=1 の自動プレイがここの「アイテムを使う」ボットを使う。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim.js'));
  else root.Bots = factory(root.Sim);
})(typeof self !== 'undefined' ? self : this, function (Sim) {
  'use strict';
  const { DIRS, cheb } = Sim;

  function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
  function toward(p, o) { return { type: 'move', dx: sign(o.x - p.x), dy: sign(o.y - p.y) }; }
  function isBomb(state, x, y) { const e = Sim.enemyAt(state, x, y); return !!e && e.kind === 'bomb'; }

  // goal(x,y) が真の一番近いマスへ向かう最初の1歩。ばくだん岩は、できれば避けて通る。
  function stepTo(state, goal) {
    const p = state.player;
    const path = Sim.findPath(state, p.x, p.y, goal, (x, y) => isBomb(state, x, y)) || Sim.findPath(state, p.x, p.y, goal);
    if (!path) return null;
    return { type: 'move', dx: path[0].x - p.x, dy: path[0].y - p.y };
  }
  const atStairs = (state) => (x, y) => x === state.stairs.x && y === state.stairs.y;

  // ボット専用の乱数（ルール側の乱数を乱さない）
  function botRnd(mem) {
    mem.rng = (mem.rng * 1664525 + 1013904223) >>> 0;
    return mem.rng / 4294967296;
  }

  // 1) 何も考えない：できることの中から、でたらめに選ぶ
  function random(state, mem) {
    const p = state.player, opts = [];
    for (const [dx, dy] of DIRS) {
      if (!Sim.isWall(state, p.x + dx, p.y + dy) || Sim.enemyAt(state, p.x + dx, p.y + dy)) opts.push({ type: 'move', dx, dy });
    }
    opts.push({ type: 'wait' });
    p.inv.forEach((it, slot) => {
      const d = DIRS[Math.floor(botRnd(mem) * 8)];
      if (it.kind === 'scroll' && Sim.roomAt(state, p.x, p.y) < 0) return;
      opts.push({ type: 'use', slot, dx: d[0], dy: d[1] });
      opts.push({ type: 'throw', slot, dx: d[0], dy: d[1] });
    });
    return opts[Math.floor(botRnd(mem) * opts.length)];
  }

  // 4) 階段直行：階段への最短の道を歩くだけ。道をふさぐ敵だけ叩く（ぶつかり攻撃）
  function direct(state) {
    return stepTo(state, atStairs(state)) || { type: 'wait' };
  }

  // 「アイテムを使う」ボットの、使いどころの判断
  function itemAction(state) {
    const p = state.player, inv = p.inv;
    const slot = (k) => inv.findIndex((it) => it.kind === k);
    const threats = state.enemies.filter((e) => e.awake && e.kind !== 'bomb');
    const adj = threats.filter((e) => cheb(e, p) === 1);
    const room = Sim.roomAt(state, p.x, p.y);
    const inRoom = room >= 0 ? threats.filter((e) => Sim.roomAt(state, e.x, e.y) === room) : [];
    const danger = adj.reduce((s, e) => s + Sim.ENEMIES[e.kind].atk, 0);
    const low = p.hp <= Math.max(8, danger * 2);

    // おにぎり：満腹度+50がむだにならない所まで減ったら食べる
    if (slot('onigiri') >= 0 && p.hunger <= Sim.SPEC.HUNGER_MAX - Sim.SPEC.ONIGIRI_FOOD) return { type: 'use', slot: slot('onigiri') };
    // 巻物：部屋に敵が2体以上、またはピンチ
    if (slot('scroll') >= 0 && room >= 0 && (inRoom.length >= 2 || (low && inRoom.length >= 1))) return { type: 'use', slot: slot('scroll') };
    // かえんの杖：直線に2体以上、または遠くから撃ってくる相手・ピンチのとき
    if (slot('fire') >= 0) {
      let best = null, bestN = 0, bestWorth = false;
      for (const [dx, dy] of DIRS) {
        const cells = Sim.fireCells(state, dx, dy);
        let n = 0, worth = false, risky = false;
        for (const c of cells) {
          const e = Sim.enemyAt(state, c.x, c.y);
          if (!e) continue;
          if (e.kind === 'bomb') { if (cheb(e, p) === 1 && e.hp <= Sim.SPEC.FIRE_DMG) risky = true; continue; }
          if (!e.awake) continue;
          n++;
          if (e.kind === 'yumi' || e.kind === 'ghost') worth = true;
        }
        if (risky || n === 0) continue;
        if (n > bestN || (n === bestN && worth && !bestWorth)) { best = { dx, dy }; bestN = n; bestWorth = worth; }
      }
      if (best && (bestN >= 2 || bestWorth || low)) return { type: 'use', slot: slot('fire'), dx: best.dx, dy: best.dy };
    }
    // やくそう：+15がむだにならず、ピンチか、敵が隣にいないとき
    if (slot('herb') >= 0 && p.hp <= p.maxHp - Sim.SPEC.HERB_HEAL && (low || adj.length === 0)) return { type: 'use', slot: slot('herb') };
    // ワープの杖：囲まれたとき・ピンチのとき、いちばん元気な隣の敵を飛ばす
    if (slot('warp') >= 0 && adj.length >= 1 && (low || adj.length >= 2)) {
      const e = adj.slice().sort((a, b) => b.hp - a.hp)[0];
      return { type: 'use', slot: slot('warp'), dx: sign(e.x - p.x), dy: sign(e.y - p.y) };
    }
    return null;
  }

  // 2) 3) 寄り道する：アイテムを全部拾ってから階段へ。隣の敵は叩く。近づいてくる敵は待って先に叩く。
  function explore(state, mem, useItems) {
    const p = state.player;
    if (useItems) { const a = itemAction(state); if (a) { mem.waits = 0; return a; } }
    const adj = state.enemies.filter((e) => e.kind !== 'bomb' && cheb(e, p) === 1);
    if (adj.length) {
      mem.waits = 0;
      return toward(p, adj.slice().sort((a, b) => a.hp - b.hp)[0]);
    }
    // 2マス先まで来た敵は、待てば向こうが隣に来る（こちらが先に叩ける）
    const dist = Sim.distMap(state, p.x, p.y);
    const coming = state.enemies.some((e) => e.awake && ((e.kind === 'maru' && dist[e.y * state.map.w + e.x] === 2) || (e.kind === 'ghost' && cheb(e, p) === 2)));
    if (coming && (mem.waits || 0) < 4) { mem.waits = (mem.waits || 0) + 1; return { type: 'wait' }; }
    mem.waits = 0;
    // ゆみへいが気づいているなら、先に追いかける（放っておくと撃たれ続ける）
    const archer = state.enemies.filter((e) => e.kind === 'yumi' && e.awake && cheb(e, p) <= 4)[0];
    if (archer && (mem.chase || 0) < 8) {
      mem.chase = (mem.chase || 0) + 1;
      const a = stepTo(state, (x, y) => x === archer.x && y === archer.y);
      if (a) return a;
    }
    if (!archer) mem.chase = 0;
    let a = null;
    if (p.inv.length < Sim.SPEC.INV_MAX && state.items.length) a = stepTo(state, (x, y) => !!Sim.itemAt(state, x, y) && !(x === p.x && y === p.y));
    return a || stepTo(state, atStairs(state)) || { type: 'wait' };
  }
  function noItem(state, mem) { return explore(state, mem, false); }
  function useItem(state, mem) { return explore(state, mem, true); }

  const BOTS = {
    random: { name: '何も考えない', fn: random },
    noItem: { name: 'アイテムを使わない（寄り道）', fn: noItem },
    useItem: { name: 'アイテムを使う（寄り道）', fn: useItem },
    direct: { name: '階段直行', fn: direct },
  };

  // 1回ぶん遊ばせる
  function runOne(key, seed, maxTurns) {
    const state = Sim.create(seed), mem = { rng: seed >>> 0 };
    const bot = BOTS[key].fn;
    let refused = 0, minHunger = state.player.hunger;
    const floorTurns = [];
    let lastFloor = 1, lastTurn = 0;
    while (!state.over && state.turn < maxTurns) {
      const before = state.turn;
      let a = bot(state, mem);
      if (refused >= 3) a = { type: 'wait' };
      Sim.step(state, a);
      refused = state.turn === before && !state.over ? refused + 1 : 0;
      if (state.player.hunger < minHunger) minHunger = state.player.hunger;
      if (state.floor !== lastFloor) { floorTurns.push(state.turn - lastTurn); lastTurn = state.turn; lastFloor = state.floor; }
    }
    const used = state.stats.used;
    return {
      seed, result: state.over || 'timeout', floor: state.floor, turns: state.turn,
      lv: state.player.lv, hp: state.player.hp, hunger: state.player.hunger, minHunger,
      hungerZero: state.stats.hungerZero, kills: state.stats.kills, dmgTaken: state.stats.dmgTaken,
      used, usedTotal: Object.keys(used).reduce((s, k) => s + used[k], 0), thrown: state.stats.thrown,
      left: state.player.inv.length,
      cause: state.over === 'dead' ? Sim.causeText(state.cause).replace(/^\dFで /, '') : null,
    };
  }

  function summarize(key, runs) {
    const n = runs.length;
    const avg = (f) => runs.reduce((s, r) => s + f(r), 0) / n;
    const clears = runs.filter((r) => r.result === 'clear');
    const deaths = runs.filter((r) => r.result === 'dead');
    const causes = {}, deathFloor = [0, 0, 0, 0, 0, 0];
    for (const r of deaths) { causes[r.cause] = (causes[r.cause] || 0) + 1; deathFloor[r.floor]++; }
    const usedKinds = {};
    for (const r of runs) for (const k of Object.keys(r.used)) usedKinds[k] = (usedKinds[k] || 0) + r.used[k];
    return {
      key, name: BOTS[key].name, n,
      clear: clears.length, dead: deaths.length, timeout: n - clears.length - deaths.length,
      clearRate: clears.length / n,
      avgFloor: avg((r) => r.floor), avgTurns: avg((r) => r.turns), avgLv: avg((r) => r.lv),
      avgTurnsClear: clears.length ? clears.reduce((s, r) => s + r.turns, 0) / clears.length : 0,
      avgHpClear: clears.length ? clears.reduce((s, r) => s + r.hp, 0) / clears.length : 0,
      avgLvClear: clears.length ? clears.reduce((s, r) => s + r.lv, 0) / clears.length : 0,
      avgUsed: avg((r) => r.usedTotal), avgThrown: avg((r) => r.thrown), avgLeft: avg((r) => r.left),
      avgKills: avg((r) => r.kills), avgDmg: avg((r) => r.dmgTaken),
      hungerZeroRuns: runs.filter((r) => r.hungerZero).length,
      avgMinHunger: avg((r) => r.minHunger),
      causes, deathFloor: deathFloor.slice(1), usedKinds,
    };
  }

  return { BOTS, runOne, summarize, random, noItem, useItem, direct, itemAction };
});

// ---- Node から直接実行したとき：4種を同じseedで回して、表を出す --------------
if (typeof module === 'object' && module.exports && require.main === module) {
  const Bots = module.exports;
  const Sim = require('./sim.js');
  const N = parseInt(process.argv[2] || '500', 10);
  const seed0 = parseInt(process.argv[3] || '1', 10);
  const MAX_TURNS = 3000;
  const pct = (v) => (v * 100).toFixed(1) + '%';
  const f1 = (v) => v.toFixed(1);
  const sums = [];
  for (const key of Object.keys(Bots.BOTS)) {
    const runs = [];
    for (let i = 0; i < N; i++) runs.push(Bots.runOne(key, seed0 + i, MAX_TURNS));
    sums.push(Bots.summarize(key, runs));
  }
  console.log('ボット検証：各 ' + N + ' 回（seed ' + seed0 + '〜' + (seed0 + N - 1) + '、1回の上限 ' + MAX_TURNS + ' 手）\n');
  console.log('| ボット | クリア率 | 死亡 | 時間切れ | 平均到達フロア | 平均手数 | クリア時の手数 | クリア時の体力 | 終了時レベル | 使ったアイテム数 | 倒した敵 | 受けたダメージ |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of sums) {
    console.log('| ' + [s.name, pct(s.clearRate) + '（' + s.clear + '）', s.dead, s.timeout, f1(s.avgFloor), f1(s.avgTurns), f1(s.avgTurnsClear), f1(s.avgHpClear), f1(s.avgLv), f1(s.avgUsed), f1(s.avgKills), f1(s.avgDmg)].join(' | ') + ' |');
  }
  console.log('\n死んだフロアの内訳（1F〜5F）と、多い死因');
  console.log('| ボット | 1F | 2F | 3F | 4F | 5F | 多い死因（上位3つ） |');
  console.log('|---|---|---|---|---|---|---|');
  for (const s of sums) {
    const top = Object.keys(s.causes).sort((a, b) => s.causes[b] - s.causes[a]).slice(0, 3).map((c) => c + ' ' + s.causes[c]).join('／');
    console.log('| ' + [s.name].concat(s.deathFloor).concat([top || 'なし']).join(' | ') + ' |');
  }
  console.log('\n満腹度とアイテムの使われ方');
  console.log('| ボット | 満腹度が0になった回数 | 満腹度の最低値（平均） | 使った内訳（' + N + '回の合計） | 投げた数（平均） | 使わずに残った数（平均） |');
  console.log('|---|---|---|---|---|---|');
  for (const s of sums) {
    const kinds = Object.keys(Sim.ITEMS).map((k) => Sim.ITEMS[k].name + ' ' + (s.usedKinds[k] || 0)).join('／');
    console.log('| ' + [s.name, s.hungerZeroRuns, f1(s.avgMinHunger), kinds, f1(s.avgThrown), f1(s.avgLeft)].join(' | ') + ' |');
  }
}
