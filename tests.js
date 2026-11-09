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

console.log('\n' + passed + ' 件合格 / ' + failed + ' 件失敗');
if (failed) { console.log('失敗: ' + failures.join(' / ')); process.exit(1); }
