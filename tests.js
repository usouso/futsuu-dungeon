// tests.js — 仕様書（docs/試作仕様書.md 4章）の数値が、文面どおりに動くことを確かめる。
// 実行: node tests.js
'use strict';
const Sim = require('./sim.js');
const { SPEC, OWN } = Sim;

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name); console.log('  NG  ' + name + '\n      ' + (e && e.message)); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' 期待 ' + JSON.stringify(b) + ' / 実際 ' + JSON.stringify(a));
}
function ok(v, msg) { if (!v) throw new Error(msg || '条件を満たさない'); }

const A = Sim.fromAscii;
const move = (dx, dy) => ({ type: 'move', dx, dy });
const WAIT = { type: 'wait' };
const types = (ev) => ev.map((e) => e.t);
const find = (ev, t) => ev.find((e) => e.t === t);
function waitN(s, n) { const all = []; for (let i = 0; i < n; i++) all.push(...Sim.step(s, WAIT)); return all; }
// 広い空き部屋（敵なし）
function emptyRoom(opts) {
  return A([
    '#########',
    '#.......#',
    '#...@...#',
    '#.......#',
    '#########',
  ], opts);
}

console.log('■ ターンと移動');
test('自分が1手動くと、敵全員が1手動く', () => {
  const s = A([
    '###########',
    '#m.......m#',
    '#....@....#',
    '#m.......m#',
    '###########',
  ]);
  const before = s.enemies.map((e) => Sim.cheb(e, s.player));
  const ev = Sim.step(s, WAIT);
  eq(ev.filter((e) => e.t === 'emove').length, 4, '動いた敵の数');
  s.enemies.forEach((e, i) => eq(Sim.cheb(e, s.player), before[i] - 1, '1歩ぶん近づく'));
});
test('移動は8方向（斜めあり）', () => {
  for (const [dx, dy] of Sim.DIRS) {
    const s = emptyRoom();
    const x = s.player.x, y = s.player.y;
    Sim.step(s, move(dx, dy));
    eq([s.player.x, s.player.y], [x + dx, y + dy]);
  }
  eq(Sim.DIRS.length, 8);
});
test('敵のいる方向へ進むと通常攻撃（ぶつかり攻撃）になり、自分は動かない', () => {
  const s = A(['#####', '#@m.#', '#####']);
  const ev = Sim.step(s, move(1, 0));
  eq(s.player.x, 1);
  eq(find(ev, 'ehurt').dmg, 4);
  eq(s.enemies[0].hp, Sim.ENEMIES.maru.hp - 4);
});
test('壁にぶつかると手番は進まない（敵も動かない・歩数も増えない）', () => {
  const s = A(['######', '#@..m#', '######']);
  const ev = Sim.step(s, move(0, -1));
  eq(types(ev), ['bump']);
  eq(s.turn, 0); eq(s.player.steps, 0); eq(s.enemies[0].x, 4);
});
test('攻撃ボタン：一番近い隣の敵を叩く（縦横の隣が、斜めの隣より先）', () => {
  const s = A(['#####', '#..m#', '#m@.#', '#####']);
  const tg = Sim.attackTarget(s);
  eq([tg.x, tg.y], [1, 2]);
  const ev = Sim.step(s, { type: 'attack' });
  eq(find(ev, 'pattack').x, 1);
  eq(tg.hp, Sim.ENEMIES.maru.hp - 4);
});
test('攻撃ボタン：隣に敵がいなければ押せない（手番は進まない）', () => {
  const s = A(['######', '#@..m#', '######']);
  eq(Sim.attackTarget(s), null);
  const ev = Sim.step(s, { type: 'attack' });
  eq(types(ev), ['refuse']); eq(ev[0].why, 'noTarget'); eq(s.turn, 0);
});

console.log('■ 自分');
test('体力25、通常攻撃4で始まる', () => {
  const s = Sim.create(1);
  eq([s.player.hp, s.player.maxHp, s.player.atk, s.player.lv], [25, 25, 4, 1]);
});
test('敵を倒すと経験値。レベルアップで最大体力+3・攻撃+1', () => {
  const s = A(['#####', '#@m.#', '#####']);
  s.player.xp = Sim.xpNeed(1) - 1;
  s.enemies[0].hp = 1;
  const ev = Sim.step(s, move(1, 0));
  ok(find(ev, 'kill'), '倒した');
  eq(find(ev, 'xp').xp, Sim.ENEMIES.maru.xp);
  eq(find(ev, 'levelup').lv, 2);
  eq([s.player.lv, s.player.maxHp, s.player.atk], [2, 28, 5]);
});
test('満腹度：最大100', () => { eq(SPEC.HUNGER_MAX, 100); });
test('満腹度：10歩で1減る', () => {
  const s = emptyRoom({ hunger: 100 });
  waitN(s, 9); eq(s.player.hunger, 100, '9歩ではまだ減らない');
  waitN(s, 1); eq(s.player.hunger, 99, '10歩で1減る');
  waitN(s, 90); eq(s.player.hunger, 90, '100歩で10減る');
});
test('満腹度が残っている間は、8歩ごとに体力が1回復する', () => {
  const s = emptyRoom({ hunger: 100, hp: 10 });
  waitN(s, 7); eq(s.player.hp, 10, '7歩ではまだ');
  waitN(s, 1); eq(s.player.hp, 11, '8歩で1回復');
  waitN(s, 16); eq(s.player.hp, 13, '24歩で3回復');
});
test('自然回復は最大体力を超えない', () => {
  const s = emptyRoom({ hunger: 100 });
  waitN(s, 16); eq(s.player.hp, 25);
});
test('満腹度が0になると5歩ごとに体力が1減り、自然回復は止まる', () => {
  const s = emptyRoom({ hunger: 1, hp: 20 });
  waitN(s, 10); eq(s.player.hunger, 0, '10歩で0になる');
  const hp0 = s.player.hp; // ここまでの自然回復ぶん（8歩目の+1）を含む
  eq(hp0, 21);
  waitN(s, 4); eq(s.player.hp, hp0, '0になってから4歩ではまだ減らない');
  waitN(s, 1); eq(s.player.hp, hp0 - 1, '5歩で1減る');
  waitN(s, 10); eq(s.player.hp, hp0 - 3, '15歩で3減る（回復はしない）');
});
test('空腹で体力が尽きると、死因は「おなかがへって」になる', () => {
  const s = emptyRoom({ hunger: 0, hp: 1 });
  const ev = waitN(s, 5);
  eq(s.over, 'dead'); eq(s.cause.how, 'starve');
  ok(find(ev, 'dead'));
  ok(Sim.causeText(s.cause).indexOf('おなか') >= 0);
});
test('歩く・叩く・待つ・アイテムを使う、どれも1歩と数える', () => {
  const s = A(['######', '#@b..#', '######'], { inv: ['herb'] });
  Sim.step(s, move(1, 0)); // 叩く（ばくだん岩は反撃しない）
  Sim.step(s, WAIT);
  Sim.step(s, { type: 'use', slot: 0 });
  eq(s.player.steps, 3);
});

console.log('■ アイテム');
test('持ち物は最大8個。9個目は拾えず床に残る', () => {
  const s = A(['#####', '#@o.#', '#####'], { inv: ['herb', 'herb', 'herb', 'herb', 'herb', 'herb', 'herb', 'herb'] });
  const ev = Sim.step(s, move(1, 0));
  eq(s.player.inv.length, 8);
  ok(find(ev, 'full')); eq(s.items.length, 1);
});
test('アイテムの上に歩くと拾う', () => {
  const s = A(['#####', '#@o.#', '#####']);
  const ev = Sim.step(s, move(1, 0));
  eq(find(ev, 'pickup').kind, 'onigiri');
  eq(s.player.inv.map((i) => i.kind), ['onigiri']); eq(s.items.length, 0);
});
test('おにぎり：食べると満腹度+50', () => {
  const s = emptyRoom({ hunger: 20, inv: ['onigiri'] });
  const ev = Sim.step(s, { type: 'use', slot: 0 });
  eq(find(ev, 'eat').gain, 50); eq(s.player.hunger, 70); eq(s.player.inv.length, 0);
});
test('おにぎり：満腹度は最大100を超えない', () => {
  const s = emptyRoom({ hunger: 80, inv: ['onigiri'] });
  Sim.step(s, { type: 'use', slot: 0 });
  eq(s.player.hunger, 100);
});
test('やくそう：飲むと体力+15（最大体力は超えない）', () => {
  const s = emptyRoom({ hp: 5, inv: ['herb', 'herb'] });
  const ev = Sim.step(s, { type: 'use', slot: 0 });
  eq(find(ev, 'drink').gain, 15); eq(s.player.hp, 20);
  Sim.step(s, { type: 'use', slot: 0 });
  eq(s.player.hp, 25);
});
test('かえんの杖：直線4マスまで炎、ダメージ6。5マス目には届かない', () => {
  const s = A(['#########', '#@...bb.#', '#########'], { inv: ['fire'] });
  const ev = Sim.step(s, { type: 'use', slot: 0, dx: 1, dy: 0 });
  eq(find(ev, 'fire').cells.length, 4);
  const near = Sim.enemyAt(s, 5, 1), far = Sim.enemyAt(s, 6, 1);
  eq(near.hp, Sim.ENEMIES.bomb.hp - 6, '4マス目の敵');
  eq(far.hp, Sim.ENEMIES.bomb.hp, '5マス目の敵');
});
test('かえんの杖：直線上の敵全員に当たる。壁で止まる', () => {
  const s = A(['########', '#@bb#b.#', '########'], { inv: ['fire'] });
  const ev = Sim.step(s, { type: 'use', slot: 0, dx: 1, dy: 0 });
  eq(find(ev, 'fire').cells.length, 2);
  eq(Sim.enemyAt(s, 2, 1).hp, 6); eq(Sim.enemyAt(s, 3, 1).hp, 6); eq(Sim.enemyAt(s, 5, 1).hp, 12);
});
test('かえんの杖：斜めにも振れる', () => {
  const s = A(['######', '#@...#', '#.b..#', '#....#', '######'], { inv: ['fire'] });
  Sim.step(s, { type: 'use', slot: 0, dx: 1, dy: 1 });
  eq(Sim.enemyAt(s, 2, 2).hp, 6);
});
test('かえんの杖：3回まで（3回振ると無くなる）', () => {
  const s = emptyRoom({ inv: ['fire'] });
  eq(s.player.inv[0].charges, 3);
  Sim.step(s, { type: 'use', slot: 0, dx: 1, dy: 0 }); eq(s.player.inv[0].charges, 2);
  Sim.step(s, { type: 'use', slot: 0, dx: 1, dy: 0 }); eq(s.player.inv[0].charges, 1);
  Sim.step(s, { type: 'use', slot: 0, dx: 1, dy: 0 }); eq(s.player.inv.length, 0);
});
test('ワープの杖：当たった敵をフロア内のどこかへ飛ばす', () => {
  const s = A([
    '###############',
    '#@.b..........#',
    '#.............#',
    '###############',
  ], { inv: ['warp'] });
  const e = s.enemies[0];
  const ev = Sim.step(s, { type: 'use', slot: 0, dx: 1, dy: 0 });
  const w = find(ev, 'warp');
  eq(w.id, e.id);
  ok(e.x !== 3 || e.y !== 1, '場所が変わった');
  ok(!Sim.isWall(s, e.x, e.y), '床の上');
  eq(s.enemies.length, 1, '倒してはいない'); eq(e.hp, Sim.ENEMIES.bomb.hp, 'ダメージは無い');
});
test('ワープの杖：3回まで。外れても1回ぶん減る', () => {
  const s = emptyRoom({ inv: ['warp'] });
  const ev = Sim.step(s, { type: 'use', slot: 0, dx: 1, dy: 0 });
  eq(find(ev, 'warp').id, null); eq(s.player.inv[0].charges, 2);
  Sim.step(s, { type: 'use', slot: 0, dx: 1, dy: 0 });
  Sim.step(s, { type: 'use', slot: 0, dx: 1, dy: 0 });
  eq(s.player.inv.length, 0);
});
test('まきもどしの巻物：今いる部屋の敵全員に8のダメージ。別の部屋の敵には当たらない', () => {
  const s = A([
    '###########',
    '#b.@.b#..b#',
    '#.....,...#',
    '###########',
  ], { inv: ['scroll'] });
  const ev = Sim.step(s, { type: 'use', slot: 0 });
  eq(find(ev, 'read').n, 2);
  eq(Sim.enemyAt(s, 1, 1).hp, 4); eq(Sim.enemyAt(s, 5, 1).hp, 4); eq(Sim.enemyAt(s, 9, 1).hp, 12);
  eq(s.player.inv.length, 0);
});
test('まきもどしの巻物：通路では読めない（無くならない・手番も進まない）', () => {
  const s = A(['#######', '#..,,.#', '#######'], { inv: ['scroll'] });
  s.player.x = 3; s.player.y = 1;
  const ev = Sim.step(s, { type: 'use', slot: 0 });
  eq(ev[0].why, 'noRoom'); eq(s.player.inv.length, 1); eq(s.turn, 0);
});
test('どのアイテムも投げられる。当たると2のダメージ', () => {
  for (const kind of Object.keys(Sim.ITEMS)) {
    const s = A(['#######', '#@..b.#', '#######'], { inv: [kind] });
    const ev = Sim.step(s, { type: 'throw', slot: 0, dx: 1, dy: 0 });
    eq(find(ev, 'ehurt').dmg, 2, kind);
    eq(s.enemies[0].hp, Sim.ENEMIES.bomb.hp - 2, kind);
    eq(s.player.inv.length, 0, kind); eq(s.items.length, 0, kind + '（当たったアイテムは無くなる）');
  }
});
test('投げて当たらなければ、壁の手前の床に落ちる（食べ物を投げても食べたことにならない）', () => {
  const s = A(['#######', '#@....#', '#######'], { hunger: 30, inv: ['onigiri'] });
  const ev = Sim.step(s, { type: 'throw', slot: 0, dx: 1, dy: 0 });
  eq(find(ev, 'throw').land, { x: 5, y: 1 });
  eq(s.items[0].kind, 'onigiri'); eq(s.player.hunger, 30);
});
test('杖を投げても、残り回数はそのまま床に落ちる', () => {
  const s = A(['#######', '#@....#', '#######'], { inv: ['fire'] });
  Sim.step(s, { type: 'use', slot: 0, dx: 0, dy: 1 }); // 壁に向けて1回振る
  Sim.step(s, { type: 'throw', slot: 0, dx: 1, dy: 0 });
  eq(s.items[0].charges, 2);
});
test('アイテムの動詞は 食べる・飲む・振る・読む（＋投げる）', () => {
  eq(Object.keys(Sim.ITEMS).map((k) => Sim.ITEMS[k].verbName), ['食べる', '飲む', '振る', '振る', '読む']);
});

console.log('■ 敵');
test('まるぼう：近づいて、隣で叩く（2）', () => {
  const s = A(['######', '#@..m#', '######']);
  Sim.step(s, WAIT); eq(s.enemies[0].x, 3);
  Sim.step(s, WAIT); eq(s.enemies[0].x, 2); eq(s.player.hp, 25, '近づく手では叩かない');
  const ev = Sim.step(s, WAIT);
  eq(find(ev, 'phurt').dmg, 2); eq(s.player.hp, 23);
});
test('とびうさぎ：離れていると1手で2歩進む', () => {
  const s = A(['########', '#@....u#', '########']);
  Sim.step(s, WAIT);
  eq(s.enemies[0].x, 4);
});
test('とびうさぎ：1歩で隣に着いたら、2回目の動きで叩く。隣にいるときは1回だけ叩く', () => {
  const s = A(['######', '#@.u.#', '######']);
  let ev = Sim.step(s, WAIT);
  eq(s.enemies[0].x, 2);
  eq(ev.filter((e) => e.t === 'phurt').length, 1);
  ev = Sim.step(s, WAIT);
  eq(ev.filter((e) => e.t === 'phurt').length, 1, '隣からは1回');
});
test('とびうさぎ：体力は低い（まるぼうより低い）', () => {
  ok(Sim.ENEMIES.usagi.hp < Sim.ENEMIES.maru.hp);
});
test('かべぬけゴースト：壁をすり抜けて近づく', () => {
  const s = A(['#######', '#@.#.g#', '#######']);
  Sim.step(s, WAIT); eq(s.enemies[0].x, 4);
  Sim.step(s, WAIT); eq(s.enemies[0].x, 3); ok(Sim.isWall(s, 3, 1), '壁の中にいる');
  Sim.step(s, WAIT); eq(s.enemies[0].x, 2);
});
test('かべぬけゴースト：壁の中にいても叩ける', () => {
  const s = A(['#####', '#@#.#', '#####']);
  s.enemies.push({ id: 99, kind: 'ghost', x: 2, y: 1, hp: 10, maxHp: 10, awake: true, fresh: false });
  Sim.step(s, move(1, 0));
  eq(s.enemies[0].hp, 6); eq(s.player.x, 1);
});
test('まるぼうは壁をすり抜けない', () => {
  const s = A(['#######', '#@.#.m#', '#######']);
  waitN(s, 5);
  eq(s.enemies[0].x, 5);
});
test('ばくだん岩：動かない・叩いてこない', () => {
  const s = A(['#####', '#@b.#', '#####']);
  waitN(s, 5);
  eq(s.enemies[0].x, 2); eq(s.player.hp, 25);
});
test('ばくだん岩：倒すと周囲1マスに爆発（自分にも敵にも5）', () => {
  const s = A([
    '#######',
    '#.....#',
    '#.@bm.#',
    '#....m#',
    '#######',
  ]);
  const rock = Sim.enemyAt(s, 3, 2), nearM = Sim.enemyAt(s, 4, 2), farM = Sim.enemyAt(s, 5, 3);
  rock.hp = 1;
  const ev = Sim.step(s, move(1, 0));
  ok(find(ev, 'explode'));
  eq(ev.filter((e) => e.t === 'phurt' && e.by.how === 'explosion')[0].dmg, 5);
  eq(nearM.hp, Sim.ENEMIES.maru.hp - 5, '隣の敵に5');
  eq(farM.hp, Sim.ENEMIES.maru.hp, '2マス離れた敵には当たらない');
});
test('ばくだん岩：離れて倒せば（投げる）自分は巻きこまれない', () => {
  const s = A(['#######', '#@..b.#', '#######'], { inv: ['herb'] });
  s.enemies[0].hp = 2;
  const ev = Sim.step(s, { type: 'throw', slot: 0, dx: 1, dy: 0 });
  ok(find(ev, 'explode')); eq(s.player.hp, 25);
});
test('ばくだん岩：爆発に巻きこまれた岩も、体力が尽きれば続けて爆発する', () => {
  const s = A(['########', '#@.bb.m#', '########'], { inv: ['herb'] });
  Sim.enemyAt(s, 3, 1).hp = 2; Sim.enemyAt(s, 4, 1).hp = 5;
  const ev = Sim.step(s, { type: 'throw', slot: 0, dx: 1, dy: 0 });
  eq(ev.filter((e) => e.t === 'explode').length, 2);
});
test('ゆみへい：直線が通ると3マス先から矢（3）', () => {
  const s = A(['######', '#@..y#', '######']);
  const ev = Sim.step(s, WAIT);
  ok(find(ev, 'arrow')); eq(find(ev, 'phurt').dmg, 3); eq(s.player.hp, 22);
});
test('ゆみへい：4マス先からは撃たない（近づいてくる）', () => {
  const s = A(['#######', '#@...y#', '#######']);
  const ev = Sim.step(s, WAIT);
  ok(!find(ev, 'arrow')); eq(s.enemies[0].x, 4);
});
test('ゆみへい：間に壁があると撃てない', () => {
  const s = A(['######', '#@.#y#', '######']);
  const ev = Sim.step(s, WAIT);
  ok(!find(ev, 'arrow')); eq(s.player.hp, 25);
});
test('ゆみへい：直線でなければ撃てない（ななめにずれた位置）', () => {
  const s = A(['######', '#@...#', '#...y#', '######']);
  const ev = Sim.step(s, WAIT);
  ok(!find(ev, 'arrow'));
});
test('ゆみへい：近づかれると逃げる（叩いてこない）', () => {
  const s = A(['#######', '#.@y..#', '#######']);
  const ev = Sim.step(s, WAIT);
  eq(s.enemies[0].x, 4); ok(!find(ev, 'phurt'));
});

console.log('■ 気づき（眠り）※仕様書に無い、自分で決めたルール');
test('眠っている敵は動かない。同じ部屋に入ると気づき、気づいた手は動かない', () => {
  const s = A([
    '##########',
    '#@,.....m#',
    '##########',
  ], { asleep: true });
  s.map.tiles[1 * 10 + 1] = Sim.PATH; s.map.room[1 * 10 + 1] = -1; // 自分は通路にいる
  Sim.step(s, WAIT); eq(s.enemies[0].awake, false); eq(s.enemies[0].x, 8);
  Sim.step(s, move(1, 0)); eq(s.enemies[0].awake, false, '通路ではまだ気づかれない');
  const ev = Sim.step(s, move(1, 0));
  ok(find(ev, 'wake')); eq(s.enemies[0].x, 8, '気づいた手は動かない');
  Sim.step(s, WAIT); eq(s.enemies[0].x, 7, '次の手から動く');
});
test('眠っている敵は、叩かれると目をさます', () => {
  const s = A(['#######', '#@...m#', '#######'], { asleep: true, inv: ['herb'] });
  s.enemies[0].awake = false;
  const ev = Sim.step(s, { type: 'throw', slot: 0, dx: 1, dy: 0 });
  ok(find(ev, 'wake')); eq(s.enemies[0].awake, true);
});

console.log('■ フロア');
test('部屋は3〜5、敵は3〜6体、アイテムは2〜3個（seed 1〜300、全5フロア）', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const s = Sim.create(seed);
    for (let f = 1; f <= 5; f++) {
      if (f > 1) { s.player.x = s.stairs.x - 0; s.player.y = s.stairs.y; s.onStairs = true; Sim.step(s, WAIT); }
      eq(s.floor, f, 'seed ' + seed);
      const tag = 'seed ' + seed + ' ' + f + 'F ';
      ok(s.map.rooms.length >= 3 && s.map.rooms.length <= 5, tag + '部屋の数 ' + s.map.rooms.length);
      ok(s.enemies.length >= 3 && s.enemies.length <= 6, tag + '敵の数 ' + s.enemies.length);
      ok(s.items.length >= 2 && s.items.length <= 3, tag + 'アイテムの数 ' + s.items.length);
    }
  }
});
test('どのフロアも、階段と全アイテムと全部の敵に歩いて行ける（seed 1〜300）', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const s = Sim.create(seed);
    for (let f = 1; f <= 5; f++) {
      if (f > 1) { s.player.x = s.stairs.x; s.player.y = s.stairs.y; s.onStairs = true; Sim.step(s, WAIT); }
      const d = Sim.distMap(s, s.player.x, s.player.y);
      const at = (o) => d[o.y * s.map.w + o.x];
      ok(at(s.stairs) > 0, 'seed ' + seed + ' ' + f + 'F 階段');
      for (const it of s.items) ok(at(it) > 0, 'seed ' + seed + ' ' + f + 'F アイテム');
      for (const e of s.enemies) ok(at(e) > 0, 'seed ' + seed + ' ' + f + 'F 敵');
    }
  }
});
test('5フロアを潜り、最下層の階段に着いたらクリア', () => {
  const s = Sim.create(7);
  for (let f = 1; f <= 5; f++) {
    eq(s.floor, f); eq(s.over, null);
    s.player.x = s.stairs.x; s.player.y = s.stairs.y; s.onStairs = true;
    const ev = Sim.step(s, WAIT);
    if (f < 5) eq(find(ev, 'descend').floor, f + 1);
    else ok(find(ev, 'clear'));
  }
  eq(s.over, 'clear');
});
test('階段のマスに歩いて入ると、次のフロアへ降りる', () => {
  const s = A(['#####', '#@>.#', '#####']);
  const ev = Sim.step(s, move(1, 0));
  eq(find(ev, 'descend').floor, 2); eq(s.floor, 2);
});
test('死んだら終わり（その後の手は何も起きない）。死因が1行で出る', () => {
  const s = A(['#####', '#@m.#', '#####'], { hp: 2 });
  const ev = Sim.step(s, WAIT);
  eq(s.over, 'dead'); ok(find(ev, 'dead'));
  eq(Sim.causeText(s.cause), '1Fで まるぼうに たたかれて 力つきた');
  eq(Sim.step(s, WAIT), []);
});
test('新しく始めると、持ち物は空（前の回の持ち物は持ち越さない）', () => {
  eq(Sim.create(3).player.inv, []);
});
test('同じseedなら、同じ手で同じ結果になる', () => {
  const run = (seed) => {
    const s = Sim.create(seed), log = [];
    for (let i = 0; i < 200 && !s.over; i++) {
      const [dx, dy] = Sim.DIRS[(i * 7 + (i >> 2)) % 8];
      log.push(JSON.stringify(Sim.step(s, move(dx, dy))));
    }
    return log.join('|');
  };
  eq(run(42), run(42));
  ok(run(42) !== run(43), 'seedが違えば展開も違う');
});

console.log('■ 教え方（1フロア目の配置）');
test('1フロア目：階段への道の上に、まるぼう→おにぎり→階段の順に並ぶ（seed 1〜300）', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const s = Sim.create(seed);
    const path = Sim.findPath(s, s.player.x, s.player.y, (x, y) => x === s.stairs.x && y === s.stairs.y);
    const ei = path.findIndex((c) => { const e = Sim.enemyAt(s, c.x, c.y); return e && e.kind === 'maru'; });
    const ii = path.findIndex((c) => { const it = Sim.itemAt(s, c.x, c.y); return it && it.kind === 'onigiri'; });
    ok(ei >= 0, 'seed ' + seed + ' 道の上にまるぼうがいない');
    ok(ii >= 0, 'seed ' + seed + ' 道の上におにぎりが無い');
    ok(ei < ii && ii < path.length - 1, 'seed ' + seed + ' 順番が 敵→アイテム→階段 でない');
    const onCorridor = (c) => s.map.tiles[c.y * s.map.w + c.x] === Sim.PATH;
    ok(path.slice(0, ii).some((c) => onCorridor(c) && Sim.enemyAt(s, c.x, c.y)), 'seed ' + seed + ' おにぎりの手前の通路に、まるぼうがいない');
    ok(s.map.tiles[path[ii].y * s.map.w + path[ii].x] === Sim.PATH, 'seed ' + seed + ' おにぎりが通路の上に無い');
    ok(s.enemies.every((e) => e.kind === 'maru'), 'seed ' + seed + ' 1フロア目の敵はまるぼうだけ');
    const startRoom = Sim.roomAt(s, s.player.x, s.player.y);
    ok(s.items.every((it) => Sim.roomAt(s, it.x, it.y) !== startRoom), 'seed ' + seed + ' スタートの部屋にアイテムがある');
    // おにぎりより手前の部屋（道の上）には、ほかのアイテムを置かない
    const before = new Set(path.slice(0, ii).map((c) => Sim.roomAt(s, c.x, c.y)).filter((r) => r >= 0));
    ok(s.items.every((it) => !before.has(Sim.roomAt(s, it.x, it.y))), 'seed ' + seed + ' おにぎりより手前の部屋にアイテムがある');
    ok(s.items.some((it) => it.kind === 'herb'), 'seed ' + seed + ' やくそうが無い');
  }
});
test('1フロア目：階段へ歩くだけで「叩く・拾う」が起き、おにぎりを食べると満腹度がちょうど増える', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const s = Sim.create(seed);
    let attacked = false, picked = false;
    for (let i = 0; i < 200 && s.floor === 1 && !s.over; i++) {
      if (!attacked) ok(s.player.inv.length === 0, 'seed ' + seed + ' 叩くより先に拾った（順番が 敵→アイテム でない）');
      const path = Sim.findPath(s, s.player.x, s.player.y, (x, y) => x === s.stairs.x && y === s.stairs.y);
      const c = path[0];
      const ev = Sim.step(s, move(c.x - s.player.x, c.y - s.player.y));
      if (find(ev, 'pattack')) attacked = true;
      if (find(ev, 'pickup')) {
        picked = true;
        const slot = s.player.inv.findIndex((it) => it.kind === 'onigiri');
        const before = s.player.hunger;
        const e2 = Sim.step(s, { type: 'use', slot });
        eq(find(e2, 'eat').gain, 50, 'seed ' + seed + ' おにぎりの効きめ（開始時 ' + OWN.HUNGER_START + '）');
        ok(s.player.hunger > before);
      }
    }
    ok(attacked, 'seed ' + seed + ' 叩くが起きなかった');
    ok(picked, 'seed ' + seed + ' 拾うが起きなかった');
  }
});

// ---- ボタン設定（キーコンフィグ）。理念「みんなが遊べるようにする」 ----------
// 画面を通した確認（変えたキーで実際に動くか）は tools/shots.py の keys_scenario にある。
console.log('■ ボタン設定（キーコンフィグ）');
const Keys = require('./keys.js');
const NEED = ['up', 'down', 'left', 'right', 'upleft', 'upright', 'downleft', 'downright', 'wait', 'attack', 'item', 'use', 'throw', 'cancel'];
const allCodes = (cfg) => [].concat(...Keys.ACTIONS.map((a) => cfg.map[a.id]));
test('変えられる操作：移動8方向・待つ・攻撃・持ち物をえらぶ・使う・投げる・やめる', () => {
  eq(Keys.ACTIONS.map((a) => a.id).sort(), NEED.slice().sort());
  const dirs = Keys.ACTIONS.filter((a) => a.dir).map((a) => a.dir.join(','));
  eq(dirs.slice().sort(), Sim.DIRS.map((d) => d.join(',')).sort(), '移動は8方向ぜんぶ');
});
test('既定値：どの操作にもキーがあり、1つのキーが2つの操作を持たない', () => {
  const cfg = Keys.defaults();
  for (const id of NEED) ok(cfg.map[id].length >= 1, id + ' にキーが無い');
  const codes = allCodes(cfg);
  eq(new Set(codes).size, codes.length, 'キーの重なり');
  for (const c of codes) ok(Keys.usable(c), c + ' は割り当てられないキー');
  ok(Keys.isDefault(cfg));
});
test('既定値：これまでのキー（やじるし／テンキー／QWE・AD・ZXC／スペース／S／Enter／T／Esc）がそのまま使える', () => {
  const cfg = Keys.defaults();
  const want = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyX: 'down', KeyA: 'left', KeyD: 'right', KeyQ: 'upleft', KeyE: 'upright', KeyZ: 'downleft', KeyC: 'downright',
    Numpad8: 'up', Numpad2: 'down', Numpad4: 'left', Numpad6: 'right', Numpad7: 'upleft', Numpad9: 'upright', Numpad1: 'downleft', Numpad3: 'downright',
    KeyS: 'wait', Numpad5: 'wait', Period: 'wait', Space: 'attack', KeyF: 'attack', Enter: 'use', KeyT: 'throw', Escape: 'cancel',
  };
  for (const code of Object.keys(want)) eq(Keys.lookup(cfg, code), want[code], code);
  eq(Keys.lookup(cfg, 'KeyP'), null, '割り当てていないキー');
});
test('割り当てを変えると、その操作は押したキー1つだけになる（前のキーは外れる）', () => {
  const cfg = Keys.defaults();
  const r = Keys.assign(cfg, 'up', 'KeyI', 'I');
  eq(r, { ok: true, why: null, from: 'item', emptied: true });
  eq(cfg.map.up, ['KeyI']);
  eq(Keys.lookup(cfg, 'KeyI'), 'up');
  for (const old of ['ArrowUp', 'KeyW', 'Numpad8']) eq(Keys.lookup(cfg, old), null, old + ' が残っている');
});
test('キーが重なったとき：上書き。前の操作からそのキーだけ外れ、ほかのキーは残る', () => {
  const cfg = Keys.defaults();
  const r = Keys.assign(cfg, 'wait', 'Space', null);
  eq(r, { ok: true, why: null, from: 'attack', emptied: false });
  eq(cfg.map.wait, ['Space']);
  eq(cfg.map.attack, ['KeyF'], '攻撃には F が残る');
  eq(Keys.lookup(cfg, 'Space'), 'wait');
  eq(Keys.lookup(cfg, 'KeyS'), null, '待つの前のキーは外れる');
});
test('キーが重なったとき：前の操作にキーが残らなければ「なし」になり、それが分かる（emptied）', () => {
  const cfg = Keys.defaults();
  const r = Keys.assign(cfg, 'attack', 'Enter', null);
  eq(r, { ok: true, why: null, from: 'use', emptied: true });
  eq(cfg.map.use, []);
  eq(Keys.lookup(cfg, 'Enter'), 'attack');
});
test('どう変えても、1つのキーが2つの操作を持つことは無い', () => {
  const cfg = Keys.defaults();
  const pool = ['KeyI', 'Space', 'Enter', 'ArrowUp', 'KeyP', 'Numpad5', 'Escape', 'KeyW', 'Digit1'];
  let n = 7;
  for (let i = 0; i < 400; i++) {
    n = (n * 1103515245 + 12345) % 2147483648;
    const action = NEED[n % NEED.length];
    const code = pool[Math.floor(n / 97) % pool.length];
    ok(Keys.assign(cfg, action, code, null).ok);
    eq(cfg.map[action], [code]);
    const codes = allCodes(cfg);
    eq(new Set(codes).size, codes.length, i + '回目でキーが重なった');
    for (const c of codes) eq(cfg.map[Keys.lookup(cfg, c)].includes(c), true);
  }
});
test('同じ操作に同じキーをもう一度割り当てても、こわれない', () => {
  const cfg = Keys.defaults();
  eq(Keys.assign(cfg, 'attack', 'Space', null), { ok: true, why: null, from: null, emptied: false });
  eq(cfg.map.attack, ['Space']);
});
test('割り当てられないキー（Tab・Shift などの修飾キー・F5 など）は断り、表は変わらない', () => {
  const cfg = Keys.defaults();
  const before = JSON.stringify(cfg);
  for (const code of ['Tab', 'ShiftLeft', 'ControlRight', 'AltLeft', 'MetaLeft', 'F5', 'F12', 'CapsLock', '', null, 5]) {
    eq(Keys.assign(cfg, 'up', code, null).ok, false, String(code));
  }
  eq(Keys.assign(cfg, 'nothing', 'KeyP', null).ok, false, '知らない操作');
  eq(JSON.stringify(cfg), before);
});
test('保存して読みもどすと同じ表になる（「なし」にした操作も、そのまま）', () => {
  const cfg = Keys.defaults();
  Keys.assign(cfg, 'up', 'KeyI', 'I');
  Keys.assign(cfg, 'attack', 'Enter', null);
  Keys.assign(cfg, 'wait', 'BracketLeft', '@');
  const back = Keys.load(JSON.parse(JSON.stringify(cfg)));
  eq(back, cfg);
  eq(back.map.item, [], '持ち物（I を上に取られた）は「なし」のまま');
  eq(back.map.use, [], '使う（Enter を攻撃に取られた）は「なし」のまま');
  ok(!Keys.isDefault(back));
});
test('既定値に戻す：defaults() はいつも同じ既定値を返し、変えた表に引きずられない', () => {
  const cfg = Keys.defaults();
  Keys.assign(cfg, 'up', 'KeyI', 'I');
  Keys.assign(cfg, 'attack', 'Enter', null);
  const fresh = Keys.defaults();
  ok(Keys.isDefault(fresh));
  eq(fresh.map, Keys.DEFAULTS);
  eq(fresh.labels, {});
  eq(Keys.lookup(fresh, 'ArrowUp'), 'up');
  eq(Keys.lookup(fresh, 'Enter'), 'use');
});
test('こわれた保存データでも、必ず使える表になる', () => {
  for (const bad of [null, undefined, 3, 'x', [], {}, { map: null }, { map: 'x' }]) ok(Keys.isDefault(Keys.load(bad)), JSON.stringify(bad));
  // 重なり・使えないキー・知らない操作・足りない操作がまざったもの
  const cfg = Keys.load({ map: { up: ['KeyI', 'Tab', 7], down: ['KeyI', 'KeyK'], attack: 'Space', zzz: ['KeyP'], wait: [] }, labels: { KeyI: 'I', KeyP: 'P', KeyK: 12 } });
  eq(cfg.map.up, ['KeyI'], '使えないキーは捨てる');
  eq(cfg.map.down, ['KeyK'], '重なったキーは先の操作が勝つ');
  eq(cfg.map.attack, ['Space', 'KeyF'], '配列でないものは既定値');
  eq(cfg.map.wait, [], '空で保存したものは空のまま');
  eq(cfg.map.left, ['ArrowLeft', 'KeyA', 'Numpad4'], '保存に無い操作は既定値');
  eq(cfg.labels, { KeyI: 'I' }, '使っていないキー・文字でない呼び名は捨てる');
  const codes = allCodes(cfg);
  eq(new Set(codes).size, codes.length);
  eq(Object.keys(cfg.map).sort(), NEED.slice().sort());
  // 保存に無い操作の既定キーを、別の操作がもう使っているとき：そのキーは取り返さない
  const c2 = Keys.load({ map: { up: ['Space'] } });
  eq(c2.map.up, ['Space']);
  eq(c2.map.attack, ['KeyF']);
});
test('キーの呼び名：やじるし・文字・数字・テンキー・スペース。押したキーに書いてある文字を優先する', () => {
  eq(['ArrowUp', 'KeyW', 'Digit3', 'Numpad8', 'Space', 'Enter', 'Escape', 'Period'].map(Keys.nameOf), ['↑', 'W', '3', 'テンキー8', 'スペース', 'Enter', 'Esc', '.']);
  eq(Keys.nameOf('SomethingNew'), 'SomethingNew', '知らないキーは code のまま');
  eq(Keys.labelFromEvent('BracketLeft', '@'), '@', '日本語キーボードの @');
  eq(Keys.labelFromEvent('KeyQ', 'a'), 'A', '配列のちがうキーボード');
  eq(Keys.labelFromEvent('Numpad8', '8'), 'テンキー8', 'テンキーは数字キーと見分ける');
  eq(Keys.labelFromEvent('Space', ' '), 'スペース');
  eq(Keys.labelFromEvent('ArrowUp', 'ArrowUp'), '↑');
  eq(Keys.labelFromEvent('Backspace', 'Backspace'), 'BackSpace');
  const cfg = Keys.defaults();
  Keys.assign(cfg, 'wait', 'BracketLeft', '@');
  eq(Keys.label(cfg, 'BracketLeft'), '@');
  eq(Keys.label(cfg, 'KeyF'), 'F');
  Keys.assign(cfg, 'wait', 'KeyP', 'P');
  eq(cfg.labels, { KeyP: 'P' }, '使われなくなったキーの呼び名は残さない');
});

// ---- 理念との突き合わせ（再発防止。REPORT.md 6章の教訓） ---------------------
// 理念の「常に守る」項目は、仕様書に再掲されていなくても対象。
// 理念に項目が増えたのに REPORT.md 9章の対応表に行が無いと、ここで落ちる。
console.log('■ 理念との突き合わせ');
test('理念「みんなが遊べるようにする（常に守る）」の項目すべてに、REPORT.md 9章の対応表の行がある', () => {
  const fs = require('fs'), path = require('path');
  const section = (file, head) => {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const i = text.indexOf(head);
    ok(i >= 0, file + ' に「' + head + '」の節が無い');
    const rest = text.slice(i + head.length);
    const j = rest.search(/\n## /);
    return (j < 0 ? rest : rest.slice(0, j)).split('\n');
  };
  const items = section('docs/理念.md', '## みんなが遊べるようにする').filter((l) => /^- /.test(l)).map((l) => l.slice(2));
  ok(items.length >= 7, '理念の項目が読めていない（' + items.length + '個）');
  const rows = section('REPORT.md', '## 9. 理念「みんなが遊べるようにする').filter((l) => /^\|/.test(l)).slice(2)
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  eq(rows.length, items.length, '理念の項目の数と、対応表の行の数');
  rows.forEach((r, i) => {
    eq(r.length, 3, (i + 1) + '行目の列の数');
    ok(r.every((c) => c.length > 0), (i + 1) + '行目に空の欄がある');
    ok(items[i].startsWith(r[0].slice(0, 6)), (i + 1) + '行目が理念の項目「' + items[i].slice(0, 12) + '…」と合っていない');
  });
});

console.log('\n' + passed + ' 件合格 / ' + failed + ' 件失敗');
if (failed) { console.log('失敗: ' + failures.join(' / ')); process.exit(1); }
