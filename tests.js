// tests.js — 土台ルールの自動テスト（作り直し版／シレン6寄せ）。node tests.js で実行。
'use strict';
const Sim = require('./sim.js');
const Keys = require('./keys.js');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.log('NG: ' + name); }
}
function eq(a, b, name) { ok(a === b, name + '（' + a + ' != ' + b + '）'); }

// 小さい更地の状態を作る（生成された状態の地図と中身を差し替える）
function arena(seed) {
  const st = Sim.newGame(seed || 7);
  const W = 12, H = 12;
  const tiles = new Array(W * H).fill(1);
  const roomOf = new Array(W * H).fill(0);
  for (let x = 0; x < W; x++) { tiles[x] = 0; tiles[(H - 1) * W + x] = 0; }
  for (let y = 0; y < H; y++) { tiles[y * W] = 0; tiles[y * W + W - 1] = 0; }
  st.map = { w: W, h: H, tiles, roomOf, rooms: [{ x: 1, y: 1, w: W - 2, h: H - 2, cx: 6, cy: 6 }] };
  st.enemies = []; st.items = []; st.traps = [];
  st.dekai = null; st.dekaiHole = null; st.houseRoom = -1;
  st.player.x = 5; st.player.y = 5; st.player.dir = 4;
  st.player.hp = st.player.maxhp = 50;
  st.stairs = { x: 9, y: 9 };
  st.explored = {};
  return st;
}
function addEnemy(st, kind, x, y) {
  const d = Sim.ENEMIES[kind];
  const e = {
    kind, name: d.name, x, y, room: 0, hp: d.hp, maxhp: d.hp, atk: d.atk, def: d.def,
    exp: d.exp, speed: d.speed, glyph: d.glyph, awake: true, paralyze: 0, dir: 4,
  };
  st.enemies.push(e);
  return e;
}

// 1. 角抜け不可：両側が壁の斜めは進めない／片側だけなら進める
{
  const st = arena();
  st.map.tiles[5 * 12 + 6] = 0; // 東を壁
  st.map.tiles[6 * 12 + 5] = 0; // 南を壁
  Sim.step(st, { type: 'move', dir: 3 }); // 南東
  ok(st.player.x === 5 && st.player.y === 5, '角抜け不可：両側が壁の斜めは進めない');
  st.map.tiles[6 * 12 + 5] = 1; // 南を開ける
  Sim.step(st, { type: 'move', dir: 3 });
  ok(st.player.x === 6 && st.player.y === 6, '片側が開いていれば斜めに進める');
}

// 2. 向きと素振り：攻撃ボタンでターンを渡せる（敵が近づく）
{
  const st = arena();
  const e = addEnemy(st, 'marubou', 5, 8);
  Sim.step(st, { type: 'attack' }); // 素振り（南向き・敵は遠い）
  eq(st.turn, 1, '素振りで1ターン進む');
  ok(e.y < 8, '素振りの間に敵が近づく');
}

// 3. ぶつかり攻撃と攻撃ボタンは同じ働き
{
  const st = arena();
  const e = addEnemy(st, 'marubou', 5, 6);
  e.hp = 999; e.def = 0;
  st.rng = () => 0.5; // 命中させる
  Sim.step(st, { type: 'move', dir: 4 }); // 南へ進む＝ぶつかり攻撃
  ok(e.hp < 999, 'ぶつかり攻撃でダメージ');
}

// 4. 命中とダメージの幅（乱数 87.5%〜112.5%）
{
  const st = arena();
  const e = addEnemy(st, 'ganko', 5, 6);
  e.hp = 100000; e.def = 2; e.speed = 0; e.atk = 0;
  const p = st.player; p.str = 10; p.weapon = null; p.level = 1;
  let lo = Infinity, hi = -Infinity;
  st.rng = Math.random;
  for (let i = 0; i < 300; i++) {
    const before = e.hp;
    Sim.step(st, { type: 'attack' });
    const dmg = before - e.hp;
    if (dmg > 0) { lo = Math.min(lo, dmg); hi = Math.max(hi, dmg); }
    e.x = 5; e.y = 6; p.hp = p.maxhp;
  }
  const base = (10 - 2 + 1);
  ok(lo >= Math.floor(base * 0.875) - 0 && hi <= Math.ceil(base * 1.125), 'ダメージが±12.5%の範囲（' + lo + '〜' + hi + '）');
  ok(hi > lo, 'ダメージにばらつきがある');
}

// 5. 眠りと気づき：別の部屋の敵は動かない／同じ部屋で起きる
{
  const st = Sim.newGame(11);
  const sleeping = st.enemies.filter((e) => !e.awake);
  ok(sleeping.length > 0, '開始時、別の部屋の敵は眠っている');
  const before = sleeping.map((e) => e.x + ',' + e.y).join('|');
  for (let i = 0; i < 5; i++) Sim.step(st, { type: 'wait' });
  const after = st.enemies.filter((e) => sleeping.includes(e)).map((e) => e.x + ',' + e.y).join('|');
  eq(after, before, '眠っている敵は動かない');
}

// 6. 速度：倍速は1ターンに2回、鈍足は2ターンに1回（攻撃回数で数える）
{
  const count = (kind, turns) => {
    const st = arena();
    const e = addEnemy(st, kind, 5, 6);
    e.atk = 1; e.def = 99;
    st.player.hp = st.player.maxhp = 100000;
    st.player.shield = null;
    let hits = 0;
    const origRng = st.rng; st.rng = () => 0.1; // 必ず命中
    for (let i = 0; i < turns; i++) {
      const hpBefore = st.player.hp;
      Sim.step(st, { type: 'wait' });
      hits += (hpBefore - st.player.hp) > 0 ? 1 : 0;
      e.x = 5; e.y = 6;
    }
    st.rng = origRng;
    return hits;
  };
  eq(count('hayate', 3), 3, '倍速の攻撃判定は毎ターン起きる（2回行動のうち隣接攻撃は1回分を数えた）');
  const slowHits = count('ganko', 4);
  ok(slowHits <= 2, '鈍足は2ターンに1回しか行動しない（4ターンで' + slowHits + '回）');
}

// 7. 識別：対応は冒険の間固定／使うと分かり、その後ずっと分かる
{
  const st = arena();
  const look = 'あかい草';
  const tk1 = st.ident.grass[look];
  const it = { kind: 'grass', look, x: 0, y: 0 };
  st.inv.push(it);
  Sim.step(st, { type: 'use', index: 0 });
  ok(st.known[tk1] === true, '草を使うと正体が分かり、known に残る');
  const it2 = { kind: 'grass', look, x: 0, y: 0 };
  eq(Sim.itemTrueKind(st, it2), tk1, '同じ見た目は同じ正体（対応は固定）');
  ok(Sim.itemName(st, it2).indexOf('草') >= 0 && Sim.itemName(st, it2) !== look, '分かった後は本当の名前で表示される');
}

// 8. 罠の検知：素振りで見つけられる（踏まない）
{
  const st = arena();
  st.traps.push({ x: 5, y: 6, kind: 'ya', found: false });
  const hpBefore = st.player.hp;
  st.player.dir = 4;
  Sim.step(st, { type: 'attack' });
  eq(st.traps.length, 1, '素振りでは罠は発動しない');
  eq(st.traps[0].found, true, '素振りで罠が見つかる');
  eq(st.player.hp, hpBefore, '素振りではダメージを受けない');
}

// 9. 満腹度：10ターンで1減る／0でHPが減る
{
  const st = arena();
  st.player.hunger = 100;
  for (let i = 0; i < 10; i++) Sim.step(st, { type: 'wait' });
  eq(st.player.hunger, 99, '10ターンで満腹度-1');
  st.player.hunger = 0;
  const hp = st.player.hp;
  Sim.step(st, { type: 'wait' });
  ok(st.player.hp < hp, '満腹度0では行動ごとにHPが減る');
}

// 10. ドスコイ：150で発動（罠無効・最大HP増）／120未満で解除し最大満腹度-5
{
  const st = arena();
  st.player.hunger = 155;
  Sim.step(st, { type: 'wait' });
  eq(st.player.dosukoi, true, '満腹度150以上でドスコイ発動');
  const maxhpIn = st.player.maxhp;
  ok(maxhpIn > Sim.OWN.PLAYER_HP, 'ドスコイで最大HPが増える');
  st.traps.push({ x: 5, y: 6, kind: 'ya', found: false });
  const hpBefore = st.player.hp;
  Sim.step(st, { type: 'move', dir: 4 });
  eq(st.player.hp, hpBefore, 'ドスコイ中は罠が発動しない');
  st.player.hunger = 110;
  const maxhBefore = st.player.maxhunger;
  Sim.step(st, { type: 'wait' });
  eq(st.player.dosukoi, false, '満腹度120未満でドスコイ解除');
  eq(st.player.maxhunger, maxhBefore - 5, '解除で最大満腹度-5');
}

// 11. デッ怪バリア：前からは通らず、中心と背後からは通る
{
  const st = arena();
  st.floor = 3;
  st.dekai = { x: 6, y: 5, hp: 120, maxhp: 120, dir: 0, active: true, life: 70 }; // 北向き
  st.player.x = 6; st.player.y = 3; st.player.dir = 4; // デッ怪の前（北側）から
  const hp0 = st.dekai.hp;
  Sim.step(st, { type: 'attack' });
  eq(st.dekai.hp, hp0, '前からの攻撃はバリアで通らない');
  ok(Sim.dekaiVulnerable(st, 6, 5) === true, '中心は弱点');
  ok(Sim.dekaiVulnerable(st, 6, 6) === true, '背後（南）は弱点');
  ok(Sim.dekaiVulnerable(st, 6, 4) === false, '前（北）は弱点ではない');
  st.player.x = 6; st.player.y = 7; st.player.dir = 0; // 背後（南側）から中心の隣＝背後のマスを叩く
  st.rng = () => 0.5;
  Sim.step(st, { type: 'attack' });
  ok(st.dekai.hp < hp0, '背後からの攻撃は通る');
}

// 12. デッ怪を倒しても経験値は小さい／アイテムは落とさない
{
  eq(Sim.SPEC.DEKAI_EXP, 30, 'デッ怪の経験値は10×レベルの小さい値');
}

// 13. 階段：最終フロアで降りると踏破
{
  const st = arena();
  st.floor = 5;
  st.player.x = st.stairs.x; st.player.y = st.stairs.y;
  Sim.step(st, { type: 'descend' });
  eq(st.clear, true, '5Fの階段で踏破');
}

// 14. 持ち物の上限
{
  const st = arena();
  for (let i = 0; i < Sim.OWN.INV_MAX; i++) st.inv.push({ kind: 'onigiri', x: 0, y: 0 });
  st.items.push({ kind: 'onigiri', x: 5, y: 6 });
  Sim.step(st, { type: 'move', dir: 4 });
  eq(st.inv.length, Sim.OWN.INV_MAX, '持ち物がいっぱいだと拾えない');
}

// 15. キーコンフィグ（keys.js）：割り当ては1つだけ・奪ったら元は空く
{
  const cfg = Keys.defaults();
  const freeKey = ['KeyP', 'KeyO', 'KeyU', 'KeyM', 'Semicolon'].find((c) => Keys.lookup(cfg, c) === null);
  ok(!!freeKey, '初期に未使用のキーが1つはある');
  const r = Keys.assign(cfg, 'attack', freeKey);
  ok(r.ok, '割り当てできる');
  eq(Keys.lookup(cfg, freeKey), 'attack', '割り当てたキーで引ける');
  const upKeys = cfg.map['up'];
  const stolen = upKeys[0];
  Keys.assign(cfg, 'attack', stolen);
  eq(Keys.lookup(cfg, stolen), 'attack', '別の操作のキーを奪える');
  ok(!cfg.map['up'].includes(stolen), '奪われた側から外れる');
}

console.log('テスト結果： ' + pass + ' 件合格 / ' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
