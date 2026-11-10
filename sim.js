// sim.js — ルール側（画面を知らない）。作り直し版（シレン6寄せ）。
// step(state, action) が「1手で何が起きたか」のイベント記録（配列）を返す。
// 画面側（ui.js）はそれを再生するだけ。ボット（bots.js）とテスト（tests.js）は Node でこれを直接回す。
// 仕様：docs/シレン6寄せ作り直し仕様書.md。仕様に無い数値は OWN に分け、REPORT.md に根拠を書く。
(function (root, factory) {
if (typeof module === 'object' && module.exports) module.exports = factory();
else root.Sim = factory();
})(typeof self!== 'undefined'? self: this, function () {
'use strict';

// ---- 乱数（seed 固定可能） -------------------------------------------
function makeRng(seed) {
let a = (seed >>> 0) || 1;
return function () {
a |= 0; a = (a + 0x6D2B79F5) | 0;
let t = Math.imul(a ^ (a >>> 15), 1 | a);
t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
}

// ---- 数値 -------------------------------------------------------------
const SPEC = {
FLOORS: 5,
HIT_PLAYER: 0.92, // シレン6の検証値
HIT_ENEMY: 0.88,
HIT_THROW: 0.84,
HUNGER_STEP: 10, // 10ターンで満腹度-1
DOSUKOI_ON: 150, // 満腹度150以上でドスコイ
DOSUKOI_OFF: 120, // 120未満で解除
DOSUKOI_MAXLOSS: 5, // 解除時に最大満腹度-5
HUNGER_MAX_CAP: 200,
ONIGIRI: 50, ONIGIRI_BIG: 100,
EAT_FULL_BONUS: 3, EAT_FULL_BONUS_BIG: 4, // 満腹時に食べると最大満腹度+
GRASS_FOOD: 2, // 草を飲んでも満腹度+2
DEKAI_FLOOR: 3,
DEKAI_EXP: 30, // 10×レベル(3)。旨みは小さいのが実物の形
};
const OWN = {
MAP_W: 42, MAP_H: 30,
PLAYER_HP: 30,
STR_START: 8,
INV_MAX: 16, // 実物は24。5フロアの試作では16に絞る（REPORT参照）
REGEN_STEP: 5, // 満腹度>0の間、8ターンでHP+1
THROW_DMG: 3,
WAND_CHARGES: [3, 5],
SHINKI_RATE: 0.12, // 装備が神器になる割合
HOUSE_RATE: 0.5, // 4・5Fでモンスターハウスが出る割合
};

const DIRS = [
{ dx: 0, dy: -1, name: '北'}, { dx: 1, dy: -1, name: '北東'},
{ dx: 1, dy: 0, name: '東'}, { dx: 1, dy: 1, name: '南東'},
{ dx: 0, dy: 1, name: '南'}, { dx: -1, dy: 1, name: '南西'},
{ dx: -1, dy: 0, name: '西'}, { dx: -1, dy: -1, name: '北西'},
];

// ---- アイテム定義 -------------------------------------------------------
const GRASSES = {
yakusou: { name: 'やくそう', heal: 15},
chikara: { name: 'ちからの草'},
doku: { name: '毒草'},
nemuri: { name: 'ねむり草'},
inochi: { name: 'いのちの草', maxhp: 4},
};
const GRASS_LOOKS = ['あかい草', 'あおい草', 'みどりの草', 'きいろい草', 'しろい草'];
const SCROLLS = {
shikibetsu: { name: '識別の巻物'},
makimodoshi: { name: 'まきもどしの巻物', dmg: 8},
akari: { name: 'あかりの巻物'},
buki: { name: '武器強化の巻物'},
tate: { name: '盾強化の巻物'},
};
const SCROLL_LOOKS = ['イヌの巻物', 'ネコの巻物', 'トリの巻物', 'サカナの巻物', 'ムシの巻物'];
const WANDS = {
kaen: { name: 'かえんの杖', dmg: 7},
warp: { name: 'ワープの杖'},
irekae: { name: 'いれかえの杖'},
kanashibari: { name: 'かなしばりの杖', turns: 5},
};
const WAND_LOOKS = ['かしの杖', 'たけの杖', 'まつの杖', 'うめの杖'];
const WEAPONS = [
{ name: 'こんぼう', pow: 2}, { name: 'どうのつるぎ', pow: 4},
{ name: 'てつのおの', pow: 6}, { name: 'はがねのつるぎ', pow: 8},
];
const SHIELDS = [
{ name: 'かわのたて', pow: 2}, { name: 'てつのたて', pow: 4},
{ name: 'はがねのたて', pow: 7},
];
const MARKS_WEAPON = ['会心'];
const MARKS_SHIELD = ['半減'];
const MARKS_COMMON = ['回復'];

// ---- 敵の定義 -----------------------------------------------------------
// speed: 0=鈍足（2ターンに1回） 1=通常 2=倍速（1ターンに2回）
const ENEMIES = {
marubou: { name: 'まるぼう', hp: 10, atk: 4, def: 1, exp: 8, speed: 1, glyph: 'ま'},
nemurin: { name: 'ねむりん', hp: 8, atk: 3, def: 1, exp: 10, speed: 1, glyph: 'ね', sleepHit: 0.3},
yumiya: { name: 'ゆみへい', hp: 7, atk: 3, def: 1, exp: 10, speed: 1, glyph: 'ゆ', ranged: 6},
hayate: { name: 'はやて', hp: 7, atk: 3, def: 0, exp: 12, speed: 2, glyph: 'は'},
ganko: { name: 'がんこ岩', hp: 22, atk: 6, def: 6, exp: 14, speed: 0, glyph: 'が'},
dokumushi: { name: 'どくむし', hp: 8, atk: 3, def: 1, exp: 11, speed: 1, glyph: 'ど', poison: 0.35},
ghost: { name: 'かべぬけ', hp: 9, atk: 4, def: 1, exp: 12, speed: 1, glyph: 'か', wallpass: true},
bakudan: { name: 'ばくだん岩', hp: 6, atk: 3, def: 0, exp: 9, speed: 1, glyph: 'ば', explode: 10},
};
const FLOOR_ENEMIES = [
['marubou', 'marubou', 'nemurin'],
['marubou', 'nemurin', 'yumiya', 'dokumushi'],
['yumiya', 'dokumushi', 'hayate', 'ghost', 'marubou'],
['hayate', 'ghost', 'ganko', 'bakudan', 'yumiya'],
['ganko', 'bakudan', 'hayate', 'ghost', 'dokumushi'],
];

function shuffle(rng, arr) {
const a = arr.slice();
for (let i = a.length - 1; i > 0; i--) {
const j = Math.floor(rng() * (i + 1));
const t = a[i]; a[i] = a[j]; a[j] = t;
}
return a;
}

// ---- ゲーム生成 ---------------------------------------------------------
function newGame(seed) {
const rng = makeRng(seed || 1);
const ident = { grass: {}, scroll: {}, wand: {}};
const gKinds = shuffle(rng, Object.keys(GRASSES));
GRASS_LOOKS.forEach((look, i) => { ident.grass[look] = gKinds[i];});
const sKinds = shuffle(rng, Object.keys(SCROLLS));
SCROLL_LOOKS.forEach((look, i) => { ident.scroll[look] = sKinds[i];});
const wKinds = shuffle(rng, Object.keys(WANDS));
WAND_LOOKS.forEach((look, i) => { ident.wand[look] = wKinds[i % wKinds.length];});

const st = {
seed: seed || 1, turn: 0, floor: 1,
player: {
x: 0, y: 0, dir: 4, hp: OWN.PLAYER_HP, maxhp: OWN.PLAYER_HP,
level: 1, exp: 0, str: OWN.STR_START, maxstr: OWN.STR_START,
hunger: 100, maxhunger: 100, dosukoi: false,
weapon: null, shield: null, sleep: 0, paralyze: 0, lastCause: '',
},
inv: [], ident, known: {},
map: null, enemies: [], items: [], traps: [], stairs: null,
dekai: null, dekaiHole: null, dekaiCycle: 0, houseRoom: -1,
explored: {}, over: false, clear: false,
deathCause: '', seen: {}, stats: { kills: 0, usedItems: 0},
};
st.rng = rng;
genFloor(st, 1);
return st;
}

function makeItem(rng, kind, floor) {
const it = { kind, x: 0, y: 0};
if (kind === 'onigiri' || kind === 'onigiri_big') return it;
if (kind === 'grass') { it.look = GRASS_LOOKS[Math.floor(rng() * GRASS_LOOKS.length)]; return it;}
if (kind === 'scroll') { it.look = SCROLL_LOOKS[Math.floor(rng() * SCROLL_LOOKS.length)]; return it;}
if (kind === 'wand') {
it.look = WAND_LOOKS[Math.floor(rng() * WAND_LOOKS.length)];
it.charges = OWN.WAND_CHARGES[0] + Math.floor(rng() * (OWN.WAND_CHARGES[1] - OWN.WAND_CHARGES[0] + 1));
return it;
}
if (kind === 'weapon' || kind === 'shield') {
const table = kind === 'weapon'? WEAPONS: SHIELDS;
const tier = Math.min(table.length - 1, Math.floor(rng() * Math.min(table.length, 1 + Math.ceil(floor / 2))));
it.base = table[tier].name; it.pow = table[tier].pow; it.plus = 0;
it.shinki = rng() < OWN.SHINKI_RATE;
it.marks = [];
if (it.shinki) {
it.pow += 2;
const pool = (kind === 'weapon'? MARKS_WEAPON: MARKS_SHIELD).concat(MARKS_COMMON);
it.marks.push(pool[Math.floor(rng() * pool.length)]);
if (rng() < 0.4) {
const rest = pool.filter((m) =>!it.marks.includes(m));
if (rest.length) it.marks.push(rest[Math.floor(rng() * rest.length)]);
}
}
return it;
}
return it;
}

function itemTrueKind(st, it) {
if (it.kind === 'grass') return st.ident.grass[it.look];
if (it.kind === 'scroll') return st.ident.scroll[it.look];
if (it.kind === 'wand') return st.ident.wand[it.look];
return it.kind;
}
function basePow(it) {
const table = it.kind === 'weapon'? WEAPONS: SHIELDS;
const found = table.find((w) => w.name === it.base);
return found? found.pow: 0;
}
function itemName(st, it) {
if (!it) return 'なし';
if (it.kind === 'onigiri') return 'おにぎり';
if (it.kind === 'onigiri_big') return '大きいおにぎり';
if (it.kind === 'grass' || it.kind === 'scroll' || it.kind === 'wand') {
const tk = itemTrueKind(st, it);
if (st.known[tk]) {
const def = it.kind === 'grass'? GRASSES[tk]: it.kind === 'scroll'? SCROLLS[tk]: WANDS[tk];
return def.name + (it.kind === 'wand'? '［' + it.charges + '］': '');
}
return it.look + (it.kind === 'wand'? '［' + it.charges + '］': '');
}
if (it.kind === 'weapon' || it.kind === 'shield') {
const disp = it.pow - basePow(it) + it.plus;
return (it.shinki? '神器・': '') + it.base + (disp >= 0? '+': '') + disp + (it.marks.length? '（' + it.marks.join('・') + '）': '');
}
return it.kind;
}
function equipPow(it) { return it? it.pow + it.plus: 0;}

// ---- フロア生成 -----------------------------------------------------------
function genFloor(st, floor) {
const rng = st.rng, W = OWN.MAP_W, H = OWN.MAP_H;
const tiles = new Array(W * H).fill(0);
const roomOf = new Array(W * H).fill(-1);
const rooms = [];
for (let tries = 0; tries < 80 && rooms.length < 8; tries++) {
const w = 5 + Math.floor(rng() * 6), h = 4 + Math.floor(rng() * 4);
const x = 1 + Math.floor(rng() * (W - w - 2)), y = 1 + Math.floor(rng() * (H - h - 2));
if (rooms.some((r) => x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y)) continue;
const room = { x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1)};
rooms.push(room);
for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
tiles[yy * W + xx] = 1; roomOf[yy * W + xx] = rooms.length - 1;
}
}
for (let i = 1; i < rooms.length; i++) {
let x = rooms[i - 1].cx, y = rooms[i - 1].cy;
const tx = rooms[i].cx, ty = rooms[i].cy;
const horizFirst = rng() < 0.5;
const carve = (xx, yy) => { if (tiles[yy * W + xx] === 0) tiles[yy * W + xx] = 2;};
const runH = () => { while (x!== tx) { carve(x, y); x += Math.sign(tx - x);}};
const runV = () => { while (y!== ty) { carve(x, y); y += Math.sign(ty - y);}};
if (horizFirst) { runH(); runV();} else { runV(); runH();}
carve(x, y);
}
st.map = { w: W, h: H, tiles, roomOf, rooms};
st.explored = {};

const startRoom = rooms[0];
const farRoom = rooms.reduce((a, b) => (roomDist(a, startRoom) > roomDist(b, startRoom)? a: b), rooms[0]);
st.player.x = startRoom.cx; st.player.y = startRoom.cy; st.player.dir = 4;
st.stairs = { x: farRoom.cx, y: farRoom.cy};
st.enemies = []; st.items = []; st.traps = [];
st.dekai = null; st.dekaiHole = null;

const freeTile = (room) => {
for (let t = 0; t < 40; t++) {
const x = room.x + Math.floor(rng() * room.w), y = room.y + Math.floor(rng() * room.h);
if ((x === st.player.x && y === st.player.y) || (x === st.stairs.x && y === st.stairs.y)) continue;
if (st.items.some((i) => i.x === x && i.y === y) || st.enemies.some((e) => e.x === x && e.y === y)) continue;
return { x, y};
}
return null;
};

let houseRoom = -1;
if (floor >= 4 && rng() < OWN.HOUSE_RATE && rooms.length > 2) {
const cand = rooms.slice(1).sort((a, b) => b.w * b.h - a.w * a.h)[0];
houseRoom = rooms.indexOf(cand);
}

const kinds = FLOOR_ENEMIES[floor - 1];
const nEnemies = 4 + floor;
for (let i = 0; i < nEnemies; i++) {
const room = rooms[1 + Math.floor(rng() * (rooms.length - 1))];
const p = freeTile(room); if (!p) continue;
const kind = kinds[Math.floor(rng() * kinds.length)];
st.enemies.push(makeEnemy(kind, p.x, p.y, floor, roomOf[p.y * W + p.x]));
}
if (houseRoom >= 0) {
const room = rooms[houseRoom];
for (let i = 0; i < 7; i++) {
const p = freeTile(room); if (!p) continue;
const kind = kinds[Math.floor(rng() * kinds.length)];
st.enemies.push(makeEnemy(kind, p.x, p.y, floor, houseRoom));
}
}
st.houseRoom = houseRoom;

const table = ['onigiri', 'onigiri', 'grass', 'grass', 'scroll', 'wand', 'weapon', 'shield', 'grass', 'scroll'];
for (let i = 0; i < 8; i++) {
const room = rooms[Math.floor(rng() * rooms.length)];
const p = freeTile(room); if (!p) continue;
let kind = table[Math.floor(rng() * table.length)];
if (floor === 1 && i === 0) kind = 'onigiri';
if (floor === 1 && i === 1) kind = 'grass';
const it = makeItem(rng, kind, floor); it.x = p.x; it.y = p.y;
st.items.push(it);
}
if (st.houseRoom >= 0) {
const room = rooms[st.houseRoom];
for (let i = 0; i < 5; i++) {
const p = freeTile(room); if (!p) continue;
const it = makeItem(rng, table[Math.floor(rng() * table.length)], floor); it.x = p.x; it.y = p.y;
st.items.push(it);
}
}
if (floor === 1) {
const p = freeTile(startRoom);
if (p) st.enemies.push(makeEnemy('marubou', p.x, p.y, 1, 0));
}

const trapKinds = ['ana', 'ya', 'nemuri', 'kuufuku'];
const nTraps = 4 + floor;
for (let i = 0; i < nTraps; i++) {
const room = rooms[Math.floor(rng() * rooms.length)];
const p = freeTile(room); if (!p) continue;
if (st.traps.some((t) => t.x === p.x && t.y === p.y)) continue;
st.traps.push({ x: p.x, y: p.y, kind: trapKinds[Math.floor(rng() * trapKinds.length)], found: false});
}

if (floor === SPEC.DEKAI_FLOOR) {
const room = rooms[1 + Math.floor(rng() * (rooms.length - 1))] || farRoom;
st.dekaiHole = { x: room.cx, y: room.cy, room: rooms.indexOf(room)};
st.dekaiCycle = 25;
}
markExplored(st);
}

function roomDist(a, b) { return Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);}

function makeEnemy(kind, x, y, floor, room) {
const d = ENEMIES[kind];
const bonus = Math.floor((floor - 1) * 1.5);
return {
kind, name: d.name, x, y, room, hp: d.hp + bonus * 2, maxhp: d.hp + bonus * 2,
atk: d.atk + bonus, def: d.def, exp: d.exp + bonus * 2, speed: d.speed,
glyph: d.glyph, awake: room < 0, paralyze: 0, dir: 4,
};
}

// ---- 視界・探索 ------------------------------------------------------------
function roomAt(st, x, y) {
if (x < 0 || y < 0 || x >= st.map.w || y >= st.map.h) return -1;
return st.map.roomOf[y * st.map.w + x];
}
function tileAt(st, x, y) {
if (x < 0 || y < 0 || x >= st.map.w || y >= st.map.h) return 0;
return st.map.tiles[y * st.map.w + x];
}
function visibleSet(st) {
const vis = new Set();
const p = st.player, W = st.map.w;
const pr = roomAt(st, p.x, p.y);
const add = (x, y) => { if (x >= 0 && y >= 0 && x < st.map.w && y < st.map.h) vis.add(y * W + x);};
if (pr >= 0) {
const r = st.map.rooms[pr];
for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) add(x, y);
} else {
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(p.x + dx, p.y + dy);
}
return vis;
}
function markExplored(st) {
visibleSet(st).forEach((i) => { st.explored[i] = true;});
}

// ---- 戦闘 ------------------------------------------------------------------
function dmgRoll(st, atk, def) {
const steps = [0.875, 0.9375, 1.0, 1.0625, 1.125];
const r = steps[Math.floor(st.rng() * steps.length)];
return Math.max(1, Math.round((atk - def + 1) * r));
}
function playerAtk(st) {
const p = st.player;
let atk = p.str + equipPow(p.weapon) + (p.level - 1);
if (p.dosukoi) atk += 4;
return atk;
}
function playerDef(st) { return equipPow(st.player.shield);}

function enemyAt(st, x, y, except) {
return st.enemies.find((e) => e!== except && e.hp > 0 && e.x === x && e.y === y) || null;
}
function dekaiTileAt(st, x, y) {
const d = st.dekai;
if (!d ||!d.active) return null;
if (Math.abs(x - d.x) <= 1 && Math.abs(y - d.y) <= 1) return d;
return null;
}
function blocked(st, x, y, self) {
if (tileAt(st, x, y) === 0) return true;
if (st.player.x === x && st.player.y === y && self!== st.player) return true;
if (enemyAt(st, x, y, self)) return true;
if (dekaiTileAt(st, x, y) && self!== st.dekai) return true;
return false;
}

function hurtPlayer(st, ev, dmg, cause) {
const p = st.player;
if (p.shield && p.shield.marks.includes('半減') && st.rng() < 0.2) {
dmg = Math.max(1, Math.floor(dmg / 2));
ev.push({ t: 'msg', s: '盾の印が光った！ダメージが半分になった。'});
}
p.hp -= dmg;
p.lastCause = cause;
ev.push({ t: 'pdmg', dmg, cause});
if (p.hp <= 0) { p.hp = 0; st.over = true; st.deathCause = cause; ev.push({ t: 'dead', cause});}
}

function hurtEnemy(st, ev, e, dmg) {
e.hp -= dmg;
ev.push({ t: 'edmg', e, dmg});
wakeEnemy(e);
if (e.hp <= 0) {
ev.push({ t: 'edie', e});
st.stats.kills++;
gainExp(st, ev, e.exp);
const boom = ENEMIES[e.kind].explode;
st.enemies.splice(st.enemies.indexOf(e), 1);
if (boom) explode(st, ev, e, boom);
}
}

function explode(st, ev, src, dmg) {
ev.push({ t: 'msg', s: src.name + 'が爆発した！'});
const targets = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
const e = enemyAt(st, src.x + dx, src.y + dy, src);
if (e) targets.push(e);
}
if (Math.abs(st.player.x - src.x) <= 1 && Math.abs(st.player.y - src.y) <= 1) {
hurtPlayer(st, ev, dmg, 'ばくだん岩の爆発');
}
for (const e of targets) {
e.hp -= dmg;
if (e.hp <= 0) { ev.push({ t: 'edie', e}); st.enemies.splice(st.enemies.indexOf(e), 1);}
}
}

function gainExp(st, ev, exp) {
const p = st.player;
p.exp += exp;
while (p.exp >= p.level * 15) {
p.exp -= p.level * 20; p.level++; p.maxhp += 5;
ev.push({ t: 'msg', s: 'レベルが' + p.level + 'に上がった！最大HPが増えた。'});
}
}

function wakeEnemy(e) { e.awake = true;}
function wakeChecks(st) {
const p = st.player, pr = roomAt(st, p.x, p.y);
for (const e of st.enemies) {
if (e.awake) continue;
const er = roomAt(st, e.x, e.y);
if ((pr >= 0 && er === pr) || Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) <= 1) wakeEnemy(e);
}
if (st.houseRoom >= 0 && pr === st.houseRoom) {
for (const e of st.enemies) if (roomAt(st, e.x, e.y) === st.houseRoom) wakeEnemy(e);
}
}

// ---- 1手 ---------------------------------------------------------------------
function step(st, action) {
const ev = [];
if (st.over || st.clear) return ev;
const p = st.player;
if (p.sleep > 0) {
p.sleep--;
ev.push({ t: 'msg', s: '眠っている…'});
endTurn(st, ev);
markExplored(st);
return ev;
}
if (p.paralyze > 0) { p.paralyze--; endTurn(st, ev); markExplored(st); return ev;}

let consumed = true;
switch (action.type) {
case 'move': consumed = doMove(st, ev, action.dir) !== false; break;
case 'face': p.dir = action.dir; ev.push({ t: 'face'}); consumed = false; break;
case 'attack': doAttack(st, ev); break;
case 'wait': ev.push({ t: 'msg', s: '足踏みした。'}); break;
case 'use': doUse(st, ev, action.index, action.target); break;
case 'throw': doThrow(st, ev, action.index); break;
case 'equip': doEquip(st, ev, action.index); break;
case 'descend': doDescend(st, ev); break;
default: break;
}
if (consumed &&!st.over &&!st.clear) endTurn(st, ev);
markExplored(st);
return ev;
}

function doMove(st, ev, dir) {
const p = st.player;
p.dir = dir;
const d = DIRS[dir];
const nx = p.x + d.dx, ny = p.y + d.dy;
if (d.dx!== 0 && d.dy!== 0) {
if (tileAt(st, p.x + d.dx, p.y) === 0 && tileAt(st, p.x, p.y + d.dy) === 0) {
ev.push({ t: 'msg', s: '角の両側が壁で、すり抜けられない。'});
return false; // 向きだけ変えた（ターンは進まない）
}
}
if (enemyAt(st, nx, ny) || dekaiTileAt(st, nx, ny)) { doAttack(st, ev); return true;}
if (tileAt(st, nx, ny) === 0) { ev.push({ t: 'face'}); return false;} // 壁に向いただけ（ターンは進まない）
p.x = nx; p.y = ny;
ev.push({ t: 'move'});
const idx = st.items.findIndex((i) => i.x === nx && i.y === ny);
if (idx >= 0) {
const it = st.items[idx];
if (st.inv.length >= OWN.INV_MAX) {
ev.push({ t: 'msg', s: itemName(st, it) + 'があるが、持ち物がいっぱいだ。'});
} else {
st.items.splice(idx, 1); st.inv.push(it);
ev.push({ t: 'msg', s: itemName(st, it) + 'を拾った。'});
teachIdent(st, ev, it.kind);
}
}
const trap = st.traps.find((t) => t.x === nx && t.y === ny);
if (trap) triggerTrap(st, ev, trap);
wakeChecks(st);
}

function teachIdent(st, ev, kind) {
if ((kind === 'grass' || kind === 'scroll' || kind === 'wand') &&!st.seen['ident']) {
st.seen['ident'] = true;
ev.push({ t: 'msg', s: '草・巻物・杖は正体が分からないまま落ちている。使うと分かる（危ない物もある）。'});
}
}

function triggerTrap(st, ev, trap) {
const p = st.player;
trap.found = true;
if (p.dosukoi) {
ev.push({ t: 'msg', s: 'ドスコイ状態で罠を踏みつぶした！'});
st.traps.splice(st.traps.indexOf(trap), 1);
return;
}
if (!st.seen['trap']) {
st.seen['trap'] = true;
ev.push({ t: 'msg', s: '罠は見えない。進む方向のマスを攻撃ボタンで素振りすると、踏まずに見つけられる。'});
}
st.traps.splice(st.traps.indexOf(trap), 1);
if (trap.kind === 'ana') {
ev.push({ t: 'msg', s: '落とし穴だ！下のフロアに落ちた。'});
if (st.floor >= SPEC.FLOORS) { st.clear = true; ev.push({ t: 'clear'});}
else nextFloor(st, ev);
} else if (trap.kind === 'ya') {
ev.push({ t: 'msg', s: '矢の罠だ！'});
hurtPlayer(st, ev, 5, '矢の罠');
} else if (trap.kind === 'nemuri') {
ev.push({ t: 'msg', s: '眠りの罠だ！眠ってしまった。'});
p.sleep = 3;
} else if (trap.kind === 'kuufuku') {
ev.push({ t: 'msg', s: '空腹の罠だ！お腹が減った。'});
p.hunger = Math.max(0, p.hunger - 10);
}
}

function doAttack(st, ev) {
const p = st.player;
const d = DIRS[p.dir];
const tx = p.x + d.dx, ty = p.y + d.dy;
const trap = st.traps.find((t) => t.x === tx && t.y === ty &&!t.found);
if (trap) {
trap.found = true;
ev.push({ t: 'msg', s: '素振りしたら、進む先に罠を見つけた！'});
}
const dk = dekaiTileAt(st, tx, ty);
if (dk) { attackDekai(st, ev, tx, ty, false); return;}
const e = enemyAt(st, tx, ty);
if (!e) { ev.push({ t: 'msg', s: '素振りした。'}); return;}
if (st.rng() > SPEC.HIT_PLAYER) { ev.push({ t: 'msg', s: '攻撃は外れた。'}); return;}
let dmg = dmgRoll(st, playerAtk(st), e.def);
if (p.weapon && p.weapon.marks.includes('会心') && st.rng() < 0.1) {
dmg = Math.floor(dmg * 1.5);
ev.push({ t: 'msg', s: '会心の一撃！'});
}
ev.push({ t: 'msg', s: e.name + 'に' + dmg + 'のダメージ。'});
hurtEnemy(st, ev, e, dmg);
}

function dekaiVulnerable(st, x, y) {
const d = st.dekai;
if (!d ||!d.active) return false;
if (x === d.x && y === d.y) return true;
const back = DIRS[(d.dir + 4) % 8];
for (let i = -1; i <= 1; i++) {
const bx = d.x + back.dx + (back.dy!== 0? i: 0);
const by = d.y + back.dy + (back.dx!== 0? i: 0);
if (x === bx && y === by) return true;
}
return false;
}

function attackDekai(st, ev, x, y, isThrow) {
const d = st.dekai;
if (!dekaiVulnerable(st, x, y)) {
ev.push({ t: 'msg', s: 'デッ怪バリアに防がれた！前と左右からは攻撃が通らない。'});
if (!st.seen['dekai']) {
st.seen['dekai'] = true;
ev.push({ t: 'msg', s: 'デッ怪は中心と背中側が弱点。基本は逃げる相手だ。'});
}
return;
}
let dmg = dmgRoll(st, playerAtk(st), 2) * 5;
if (isThrow) dmg = Math.max(1, Math.round(dmg / 2));
d.hp -= dmg;
ev.push({ t: 'msg', s: '弱点に当たった！デッ怪に' + dmg + 'のダメージ。'});
if (d.hp <= 0) {
ev.push({ t: 'msg', s: 'デッ怪を倒した！（もらえる経験値は少ない）'});
d.active = false; d.hp = 0;
st.dekaiCycle = 40;
gainExp(st, ev, SPEC.DEKAI_EXP);
}
}

function doEquip(st, ev, index) {
const it = st.inv[index];
if (!it || (it.kind!== 'weapon' && it.kind!== 'shield')) return;
const p = st.player;
if (it.kind === 'weapon') { const old = p.weapon; p.weapon = it; if (old) st.inv[index] = old; else st.inv.splice(index, 1);}
else { const old = p.shield; p.shield = it; if (old) st.inv[index] = old; else st.inv.splice(index, 1);}
ev.push({ t: 'msg', s: itemName(st, it) + 'を装備した。'});
}

function doDescend(st, ev) {
if (st.player.x === st.stairs.x && st.player.y === st.stairs.y) {
if (st.floor >= SPEC.FLOORS) { st.clear = true; ev.push({ t: 'clear'}); return;}
nextFloor(st, ev);
} else {
ev.push({ t: 'msg', s: '階段の上にいない。'});
}
}
function nextFloor(st, ev) {
st.floor++;
genFloor(st, st.floor);
ev.push({ t: 'floor', floor: st.floor});
ev.push({ t: 'msg', s: st.floor + 'フロア目に進んだ。'});
}

// ---- アイテムを使う -----------------------------------------------------------
function revealIdent(st, ev, it) {
const tk = itemTrueKind(st, it);
if (!st.known[tk]) {
st.known[tk] = true;
const def = it.kind === 'grass'? GRASSES[tk]: it.kind === 'scroll'? SCROLLS[tk]: WANDS[tk];
ev.push({ t: 'msg', s: '正体が分かった：' + def.name + 'だった。'});
}
}

function doUse(st, ev, index, target) {
const it = st.inv[index];
if (!it) return;
const p = st.player;
st.stats.usedItems++;

if (it.kind === 'onigiri' || it.kind === 'onigiri_big') {
const val = it.kind === 'onigiri'? SPEC.ONIGIRI: SPEC.ONIGIRI_BIG;
if (p.hunger >= p.maxhunger) {
const bonus = it.kind === 'onigiri'? SPEC.EAT_FULL_BONUS: SPEC.EAT_FULL_BONUS_BIG;
p.maxhunger = Math.min(SPEC.HUNGER_MAX_CAP, p.maxhunger + bonus);
ev.push({ t: 'msg', s: '満腹で食べたら、最大満腹度が' + bonus + '増えた！'});
}
p.hunger = Math.min(p.maxhunger + 50, p.hunger + val); // ドスコイ用に上限+50まで貯められる
if (p.hunger > p.maxhunger + 50) p.hunger = p.maxhunger + 50;
st.inv.splice(index, 1);
ev.push({ t: 'msg', s: itemName(st, it) + 'を食べた。お腹がふくれた。'});
return;
}

if (it.kind === 'grass') {
const tk = itemTrueKind(st, it);
revealIdent(st, ev, it);
st.inv.splice(index, 1);
p.hunger = Math.min(p.maxhunger + 50, p.hunger + SPEC.GRASS_FOOD);
if (tk === 'yakusou') { p.hp = Math.min(p.maxhp, p.hp + GRASSES.yakusou.heal); ev.push({ t: 'msg', s: 'HPが回復した。'});}
else if (tk === 'chikara') {
if (p.str >= p.maxstr) { p.maxstr++; p.str++; ev.push({ t: 'msg', s: 'ちからの最大値が上がった！'});}
else { p.str++; ev.push({ t: 'msg', s: 'ちからが回復した。'});}
} else if (tk === 'doku') {
p.maxstr = Math.max(1, p.maxstr - 1); p.str = Math.min(p.str, p.maxstr);
ev.push({ t: 'msg', s: '毒だった！ちからの最大値が下がった。'});
} else if (tk === 'nemuri') { p.sleep = 3; ev.push({ t: 'msg', s: '眠くなってきた…'});}
else if (tk === 'inochi') { p.maxhp += GRASSES.inochi.maxhp; ev.push({ t: 'msg', s: '最大HPが増えた！'});}
return;
}

if (it.kind === 'scroll') {
const tk = itemTrueKind(st, it);
revealIdent(st, ev, it);
st.inv.splice(index, 1);
if (tk === 'shikibetsu') {
const cand = (typeof target === 'number' && st.inv[target])? st.inv[target]: st.inv.find((i) => (i.kind === 'grass' || i.kind === 'scroll' || i.kind === 'wand') &&!st.known[itemTrueKind(st, i)]);
if (cand) revealIdent(st, ev, cand);
else ev.push({ t: 'msg', s: '識別する物がなかった。'});
} else if (tk === 'makimodoshi') {
const pr = roomAt(st, p.x, p.y);
const targets = st.enemies.filter((e) => roomAt(st, e.x, e.y) === pr && pr >= 0);
ev.push({ t: 'msg', s: 'まきもどしの巻物を呼んだ！部屋の敵にダメージ。'});
for (const e of targets.slice()) hurtEnemy(st, ev, e, SCROLLS.makimodoshi.dmg);
} else if (tk === 'akari') {
for (let i = 0; i < st.map.tiles.length; i++) st.explored[i] = true;
ev.push({ t: 'msg', s: 'フロア全体が見えるようになった！'});
} else if (tk === 'buki') {
if (p.weapon) { p.weapon.plus++; ev.push({ t: 'msg', s: '武器が強くなった！'});}
else ev.push({ t: 'msg', s: '武器を装備していなかった。'});
} else if (tk === 'tate') {
if (p.shield) { p.shield.plus++; ev.push({ t: 'msg', s: '盾が強くなった！'});}
else ev.push({ t: 'msg', s: '盾を装備していなかった。'});
}
return;
}

if (it.kind === 'wand') {
const tk = itemTrueKind(st, it);
revealIdent(st, ev, it);
if (it.charges <= 0) { ev.push({ t: 'msg', s: '杖の回数が尽きている。'}); return;}
it.charges--;
fireWand(st, ev, tk);
if (it.charges <= 0) ev.push({ t: 'msg', s: '杖の回数が尽きた。'});
return;
}

if (it.kind === 'weapon' || it.kind === 'shield') { doEquip(st, ev, index); return;}
}

function fireWand(st, ev, tk) {
const p = st.player;
const d = DIRS[p.dir];
if (tk === 'warp') {
warpPlayer(st, ev);
return;
}
// 直線に飛ぶ（壁か対象で止まる）
let x = p.x, y = p.y;
for (let i = 0; i < 10; i++) {
x += d.dx; y += d.dy;
if (tileAt(st, x, y) === 0) break;
const dk = dekaiTileAt(st, x, y);
if (dk) {
if (tk === 'kaen') attackDekai(st, ev, x, y, true);
else ev.push({ t: 'msg', s: 'デッ怪には効かなかった。'});
return;
}
const e = enemyAt(st, x, y);
if (e) {
if (tk === 'kaen') {
ev.push({ t: 'msg', s: e.name + 'に炎が当たった！'});
hurtEnemy(st, ev, e, WANDS.kaen.dmg);
} else if (tk === 'irekae') {
const ex = e.x, ey = e.y; e.x = p.x; e.y = p.y; p.x = ex; p.y = ey;
wakeEnemy(e);
ev.push({ t: 'msg', s: e.name + 'と場所が入れ替わった！'});
} else if (tk === 'kanashibari') {
e.paralyze = WANDS.kanashibari.turns;
wakeEnemy(e);
ev.push({ t: 'msg', s: e.name + 'が動けなくなった！'});
}
return;
}
}
ev.push({ t: 'msg', s: '杖を振ったが、何にも当たらなかった。'});
}

function warpPlayer(st, ev) {
const p = st.player;
for (let t = 0; t < 60; t++) {
const x = Math.floor(st.rng() * st.map.w), y = Math.floor(st.rng() * st.map.h);
if (tileAt(st, x, y) === 0 || enemyAt(st, x, y) || dekaiTileAt(st, x, y)) continue;
p.x = x; p.y = y;
ev.push({ t: 'msg', s: 'ワープした！'});
wakeChecks(st);
return;
}
}

function doThrow(st, ev, index) {
const it = st.inv[index];
if (!it) return;
const p = st.player;
st.inv.splice(index, 1);
st.stats.usedItems++;
const d = DIRS[p.dir];
let x = p.x, y = p.y, hitSomething = false;
for (let i = 0; i < 10; i++) {
x += d.dx; y += d.dy;
if (tileAt(st, x, y) === 0) { x -= d.dx; y -= d.dy; break;}
const dk = dekaiTileAt(st, x, y);
if (dk) {
if (x === dk.x && y === dk.y) attackDekai(st, ev, x, y, true);
else ev.push({ t: 'msg', s: '投げた物はデッ怪バリアに弾かれた。'});
hitSomething = true;
break;
}
const e = enemyAt(st, x, y);
if (e) {
hitSomething = true;
const tk = itemTrueKind(st, it);
if (it.kind === 'grass' && tk === 'nemuri') {
e.paralyze = 4; wakeEnemy(e);
revealIdent(st, ev, it);
ev.push({ t: 'msg', s: e.name + 'にねむり草が当たって、眠らせた！'});
} else if (it.kind === 'grass' && tk === 'doku') {
revealIdent(st, ev, it);
hurtEnemy(st, ev, e, 2);
ev.push({ t: 'msg', s: '毒草を投げつけた。'});
} else if (st.rng() <= SPEC.HIT_THROW) {
let dmg = OWN.THROW_DMG;
if (it.kind === 'weapon' || it.kind === 'shield') dmg += equipPow(it);
ev.push({ t: 'msg', s: itemName(st, it) + 'を投げて、' + e.name + 'に' + dmg + 'のダメージ。'});
hurtEnemy(st, ev, e, dmg);
} else {
ev.push({ t: 'msg', s: '投げた物は外れた。'});
}
if (it.kind!== 'grass') { it.x = e.x; it.y = e.y; st.items.push(it);}
break;
}
}
if (!hitSomething) {
if (tileAt(st, x, y)!== 0 &&!st.items.some((i) => i.x === x && i.y === y)) {
it.x = x; it.y = y; st.items.push(it);
ev.push({ t: 'msg', s: itemName(st, it) + 'を投げた。'});
} else {
it.x = p.x; it.y = p.y; st.items.push(it);
ev.push({ t: 'msg', s: itemName(st, it) + 'を投げたが、足元に落ちた。'});
}
}
}

// ---- 敵の行動 -------------------------------------------------------------------
function enemyAct(st, ev, e) {
if (st.over || st.clear) return;
const p = st.player;
const def = ENEMIES[e.kind];
if (e.paralyze > 0) { e.paralyze--; return;}
const dxp = p.x - e.x, dyp = p.y - e.y;
const cheb = Math.max(Math.abs(dxp), Math.abs(dyp));

// 遠距離：一直線に並んだら撃つ
if (def.ranged && cheb <= def.ranged && (dxp === 0 || dyp === 0 || Math.abs(dxp) === Math.abs(dyp))) {
let clearLine = true;
const sx = Math.sign(dxp), sy = Math.sign(dyp);
for (let i = 1; i < cheb; i++) {
if (tileAt(st, e.x + sx * i, e.y + sy * i) === 0) { clearLine = false; break; }
if (enemyAt(st, e.x + sx * i, e.y + sy * i, e)) { clearLine = false; break; }
if (dekaiTileAt(st, e.x + sx * i, e.y + sy * i)) { clearLine = false; break; }
}
if (clearLine) {
if (st.rng() <= SPEC.HIT_ENEMY) {
const dmg = dmgRoll(st, e.atk, playerDef(st));
ev.push({ t: 'msg', s: e.name + 'の矢が当たった！' + dmg + 'のダメージ。'});
hurtPlayer(st, ev, dmg, e.name + 'の矢');
} else ev.push({ t: 'msg', s: e.name + 'の矢は外れた。'});
return;
}
}
// 隣接：攻撃
if (cheb <= 1) {
if (st.rng() > SPEC.HIT_ENEMY) { ev.push({ t: 'msg', s: e.name + 'の攻撃は外れた。'}); return;}
const dmg = dmgRoll(st, e.atk, playerDef(st));
ev.push({ t: 'msg', s: e.name + 'の攻撃！' + dmg + 'のダメージ。'});
hurtPlayer(st, ev, dmg, e.name + 'の攻撃');
if (!st.over && def.sleepHit && st.rng() < def.sleepHit) {
p.sleep = 2;
ev.push({ t: 'msg', s: '眠くなってきた…'});
}
if (!st.over && def.poison && st.rng() < def.poison) {
p.maxstr = Math.max(1, p.maxstr - 1); p.str = Math.min(p.str, p.maxstr);
ev.push({ t: 'msg', s: '毒でちからの最大値が下がった！'});
}
return;
}
// 移動：プレイヤーへ近づく（貪欲）。姿が見えない/遠いときはその場か彷徨う
const seesPlayer = cheb <= 7 || roomAt(st, e.x, e.y) === roomAt(st, p.x, p.y);
let mx = 0, my = 0;
if (seesPlayer) { mx = Math.sign(dxp); my = Math.sign(dyp);}
else if (st.rng() < 0.4) { const d = DIRS[Math.floor(st.rng() * 8)]; mx = d.dx; my = d.dy;}
else return;
const tries = [[mx, my], [mx, 0], [0, my], [-mx, my], [mx, -my]];
for (const [tx, ty] of tries) {
if (tx === 0 && ty === 0) continue;
const nx = e.x + tx, ny = e.y + ty;
if (def.wallpass) {
if (nx < 1 || ny < 1 || nx >= st.map.w - 1 || ny >= st.map.h - 1) continue;
if (enemyAt(st, nx, ny, e) || dekaiTileAt(st, nx, ny)) continue;
if (st.player.x === nx && st.player.y === ny) continue;
e.x = nx; e.y = ny; e.dir = dirIndex(tx, ty);
return;
}
if (tx!== 0 && ty!== 0 && tileAt(st, e.x + tx, e.y) === 0 && tileAt(st, e.x, e.y + ty) === 0) continue;
if (blocked(st, nx, ny, e)) continue;
e.x = nx; e.y = ny; e.dir = dirIndex(tx, ty);
return;
}
}
function dirIndex(dx, dy) {
for (let i = 0; i < 8; i++) if (DIRS[i].dx === dx && DIRS[i].dy === dy) return i;
return 4;
}

// ---- デッ怪 -----------------------------------------------------------------------
function updateDekai(st, ev) {
if (st.floor!== SPEC.DEKAI_FLOOR ||!st.dekaiHole) return;
if (st.dekaiCycle > 0) {
st.dekaiCycle--;
if (st.dekaiCycle === 0) {
const h = st.dekaiHole;
st.dekai = { x: h.x, y: h.y, hp: 120, maxhp: 120, dir: 4, active: true, life: 70};
ev.push({ t: 'msg', s: 'デッ怪ホールから、巨大なデッ怪が現れた！！'});
if (!st.seen['dekai2']) {
st.seen['dekai2'] = true;
ev.push({ t: 'msg', s: 'デッ怪は攻撃力がとても高く、近づくと危ない。ホールの場所はマップに出ている。'});
}
}
return;
}
const d = st.dekai;
if (!d ||!d.active) return;
d.life--;
if (d.life <= 0) {
d.active = false;
st.dekaiCycle = 40;
ev.push({ t: 'msg', s: 'デッ怪は消えていった。'});
return;
}
// 鈍足：2ターンに1回
if (st.turn % 2 === 0) {
const p = st.player;
const mx = Math.sign(p.x - d.x), my = Math.sign(p.y - d.y);
const tries = [[mx, my], [mx, 0], [0, my]];
for (const [tx, ty] of tries) {
if (tx === 0 && ty === 0) continue;
const nx = d.x + tx, ny = d.y + ty;
let ok = true;
for (let yy = -1; yy <= 1 && ok; yy++) for (let xx = -1; xx <= 1; xx++) {
if (tileAt(st, nx + xx, ny + yy) === 0) { ok = false; break;}
if (enemyAt(st, nx + xx, ny + yy)) { ok = false; break;}
}
if (!ok) continue;
d.x = nx; d.y = ny; d.dir = dirIndex(tx, ty);
break;
}
}
// 隣接攻撃（プレイヤーが9マスの隣にいる）
const p = st.player;
if (Math.abs(p.x - d.x) <= 2 && Math.abs(p.y - d.y) <= 2 &&!(Math.abs(p.x - d.x) <= 1 && Math.abs(p.y - d.y) <= 1)) {
// 隣り合う辺にプレイヤーがいる場合のみ（9マスの外周）
}
const adjacent = Math.abs(p.x - d.x) <= 2 && Math.abs(p.y - d.y) <= 2 && Math.max(Math.abs(p.x - d.x), Math.abs(p.y - d.y)) === 2;
const touching = Math.max(Math.abs(p.x - d.x), Math.abs(p.y - d.y)) <= 1;
if (adjacent || touching) {
if (st.rng() <= SPEC.HIT_ENEMY) {
const dmg = dmgRoll(st, 55, playerDef(st));
ev.push({ t: 'msg', s: 'デッ怪の攻撃！！' + dmg + 'のダメージ。'});
hurtPlayer(st, ev, dmg, 'デッ怪の攻撃');
} else ev.push({ t: 'msg', s: 'デッ怪の攻撃は外れた！'});
}
}

// ---- ターン終了処理 ---------------------------------------------------------------
function endTurn(st, ev) {
st.turn++;
const p = st.player;
// 敵の行動（速度つき）
for (const e of st.enemies.slice()) {
if (st.over || st.clear) break;
if (!st.enemies.includes(e)) continue;
if (!e.awake) continue;
if (e.speed === 0 && st.turn % 2 === 1) continue; // 鈍足
enemyAct(st, ev, e);
if (e.speed === 2 && st.enemies.includes(e) &&!st.over) enemyAct(st, ev, e); // 倍速
}
updateDekai(st, ev);
if (st.over) return;

// 満腹度
const stepH = p.dosukoi? SPEC.HUNGER_STEP / 2: SPEC.HUNGER_STEP;
if (st.turn % stepH === 0 && p.hunger > 0) p.hunger--;
if (p.hunger <= 0) {
p.hunger = 0;
hurtPlayer(st, ev, 1, '空腹');
ev.push({ t: 'msg', s: 'お腹が減って、力が出ない…'});
if (st.over) return;
}
// ドスコイ判定
if (!p.dosukoi && p.hunger >= SPEC.DOSUKOI_ON) {
p.dosukoi = true;
p.maxhp += 10; p.hp += 10;
ev.push({ t: 'msg', s: 'ドスコイ状態になった！力がみなぎる。罠も効かない。'});
if (!st.seen['dosukoi']) {
st.seen['dosukoi'] = true;
ev.push({ t: 'msg', s: 'ドスコイ中はお腹の減りが2倍。満腹度が120を切ると解けて、最大満腹度が少し減る。'});
}
} else if (p.dosukoi && p.hunger < SPEC.DOSUKOI_OFF) {
p.dosukoi = false;
p.maxhp -= 10; if (p.hp > p.maxhp) p.hp = p.maxhp;
p.maxhunger = Math.max(50, p.maxhunger - SPEC.DOSUKOI_MAXLOSS);
if (p.hunger > p.maxhunger + 50) p.hunger = p.maxhunger + 50;
ev.push({ t: 'msg', s: 'ドスコイ状態が解けた。最大満腹度が少し減った。'});
}
// 回復（満腹度がある間）
const hasKaifuku = (p.weapon && p.weapon.marks.includes('回復')) || (p.shield && p.shield.marks.includes('回復'));
const regenStep = hasKaifuku? 4: OWN.REGEN_STEP;
if (p.hunger > 0 && st.turn % regenStep === 0 && p.hp < p.maxhp) p.hp++;
}

return {
SPEC, OWN, DIRS, GRASSES, SCROLLS, WANDS, ENEMIES,
newGame, step, visibleSet, itemName, itemTrueKind, equipPow, playerAtk, playerDef,
dekaiVulnerable, tileAt, roomAt, enemyAt, dekaiTileAt,
};
});
