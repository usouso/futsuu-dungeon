// sim.js — ルール側（画面を知らない）。
// step(state, action) が「1手で何が起きたか」のイベント記録（配列）を返す。
// 画面側（ui.js）はそれを再生するだけ。ボット（bots.js）とテスト（tests.js）は Node でこれを直接回す。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- 数値 -------------------------------------------------------------
  // SPEC: 仕様書（docs/試作仕様書.md 4章）に書いてある値。勝手に変えない。
  // 自分で決めた値（仕様書に無いもの）は OWN に分けてある。REPORT.md に一覧あり。
  const SPEC = {
    FLOORS: 5,
    PLAYER_HP: 25,
    PLAYER_ATK: 4,
    LEVEL_HP: 3, // レベルアップで最大体力+3
    LEVEL_ATK: 1, // レベルアップで攻撃+1
    HUNGER_MAX: 100,
    HUNGER_STEP: 10, // 10歩で満腹度が1減る
    STARVE_STEP: 5, // 満腹度0のとき、5歩ごとに体力が1減る
    REGEN_STEP: 8, // 満腹度が残っている間、8歩ごとに体力が1回復
    INV_MAX: 8,
    THROW_DMG: 2,
    ONIGIRI_FOOD: 50,
    HERB_HEAL: 15,
    FIRE_RANGE: 4,
    FIRE_DMG: 6,
    STAFF_CHARGES: 3,
    SCROLL_DMG: 8,
    MARU_ATK: 2,
    BOMB_DMG: 5,
    ARROW_RANGE: 3,
    ARROW_DMG: 3,
    ROOMS: [3, 5],
    ENEMIES: [3, 6],
    ITEMS: [2, 3],
  };
  const OWN = {
    MAP_W: 21,
    MAP_H: 14,
    HUNGER_START: 50, // 開始時の満腹度（1フロア目で「食べる」が自然に起きるように半分から）
    THROW_RANGE: 10,
    WARP_RANGE: 10,
    WAKE_RANGE: 2, // 眠っている敵は、同じ部屋に入るか、この距離まで近づくと気づく
  };

  const ENEMIES = {
    maru: { name: 'まるぼう', hp: 8, atk: SPEC.MARU_ATK, xp: 3 },
    usagi: { name: 'とびうさぎ', hp: 5, atk: 2, xp: 4 },
    ghost: { name: 'かべぬけゴースト', hp: 10, atk: 3, xp: 6 },
    bomb: { name: 'ばくだん岩', hp: 12, atk: 0, xp: 5 },
    yumi: { name: 'ゆみへい', hp: 7, atk: SPEC.ARROW_DMG, xp: 6 },
  };

  const ITEMS = {
    onigiri: { name: 'おにぎり', verb: 'eat', verbName: '食べる', aim: false },
    herb: { name: 'やくそう', verb: 'drink', verbName: '飲む', aim: false },
    fire: { name: 'かえんの杖', verb: 'wave', verbName: '振る', aim: true, charges: SPEC.STAFF_CHARGES },
    warp: { name: 'ワープの杖', verb: 'wave', verbName: '振る', aim: true, charges: SPEC.STAFF_CHARGES },
    scroll: { name: 'まきもどしの巻物', verb: 'read', verbName: '読む', aim: false },
  };

  // フロアごとの出かた（仕様書の「潜るほど敵が強く、良いアイテムが出る」を、種類と数で表す）
  const FLOOR_TABLE = {
    1: { enemies: [3, 3], pool: { maru: 1 }, ipool: { onigiri: 1, herb: 1 } },
    2: { enemies: [3, 4], pool: { maru: 4, usagi: 3, bomb: 1 }, ipool: { onigiri: 3, herb: 3, fire: 1, warp: 1, scroll: 1 } },
    3: { enemies: [4, 5], pool: { maru: 3, usagi: 3, bomb: 2, yumi: 2, ghost: 1 }, ipool: { onigiri: 2, herb: 3, fire: 2, warp: 2, scroll: 2 } },
    4: { enemies: [5, 6], pool: { maru: 2, usagi: 3, bomb: 2, yumi: 3, ghost: 2 }, ipool: { onigiri: 2, herb: 2, fire: 3, warp: 2, scroll: 3 } },
    5: { enemies: [6, 6], pool: { maru: 2, usagi: 2, bomb: 2, yumi: 3, ghost: 3 }, ipool: { onigiri: 2, herb: 2, fire: 3, warp: 2, scroll: 3 } },
  };

  const WALL = 0, ROOM = 1, PATH = 2;
  // 縦横を先に、斜めを後に（「一番近い隣の敵」の順番にも使う）
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];

  // ---- 乱数（seed固定） --------------------------------------------------
  function rnd(state) {
    let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rint(state, n) { return Math.floor(rnd(state) * n); }
  function rrange(state, a, b) { return a + rint(state, b - a + 1); }
  function pickWeighted(state, pool) {
    const keys = Object.keys(pool);
    let total = 0;
    for (const k of keys) total += pool[k];
    let r = rnd(state) * total;
    for (const k of keys) { r -= pool[k]; if (r < 0) return k; }
    return keys[keys.length - 1];
  }
  function shuffle(state, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rint(state, i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---- 盤面の基本 ---------------------------------------------------------
  function idx(state, x, y) { return y * state.map.w + x; }
  function inMap(state, x, y) { return x >= 0 && y >= 0 && x < state.map.w && y < state.map.h; }
  function isWall(state, x, y) { return !inMap(state, x, y) || state.map.tiles[idx(state, x, y)] === WALL; }
  function roomAt(state, x, y) { return inMap(state, x, y) ? state.map.room[idx(state, x, y)] : -1; }
  function enemyAt(state, x, y) {
    for (const e of state.enemies) if (e.x === x && e.y === y) return e;
    return null;
  }
  function itemAt(state, x, y) {
    for (const it of state.items) if (it.x === x && it.y === y) return it;
    return null;
  }
  function cheb(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
  function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
  function validDir(dx, dy) {
    return Number.isInteger(dx) && Number.isInteger(dy) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx !== 0 || dy !== 0);
  }

  // (sx,sy) からの歩数表。壁以外を8方向に歩く。届かないマスは -1。
  function distMap(state, sx, sy) {
    const w = state.map.w, h = state.map.h;
    const dist = new Array(w * h).fill(-1);
    const q = [sx, sy];
    dist[sy * w + sx] = 0;
    for (let qi = 0; qi < q.length; qi += 2) {
      const x = q[qi], y = q[qi + 1], d = dist[y * w + x];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (isWall(state, nx, ny)) continue;
        const k = ny * w + nx;
        if (dist[k] >= 0) continue;
        dist[k] = d + 1;
        q.push(nx, ny);
      }
    }
    return dist;
  }

  // (sx,sy) から goal(x,y) が真になる一番近いマスまでの道（出発点は含まない）。無ければ null。
  // blocked(x,y) が真のマスは通らない（ゴールにもならない）。
  function findPath(state, sx, sy, goal, blocked) {
    const w = state.map.w, h = state.map.h;
    const prev = new Array(w * h).fill(-2);
    const q = [sx, sy];
    prev[sy * w + sx] = -1;
    for (let qi = 0; qi < q.length; qi += 2) {
      const x = q[qi], y = q[qi + 1];
      if ((x !== sx || y !== sy) && goal(x, y)) {
        const path = [];
        let k = y * w + x;
        while (prev[k] !== -1) { path.push({ x: k % w, y: Math.floor(k / w) }); k = prev[k]; }
        return path.reverse();
      }
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (isWall(state, nx, ny)) continue;
        const k = ny * w + nx;
        if (prev[k] !== -2) continue;
        if (blocked && blocked(nx, ny)) continue;
        prev[k] = y * w + x;
        q.push(nx, ny);
      }
    }
    return null;
  }

  // ---- フロア生成 ---------------------------------------------------------
  // 3×2 の区画（各7×7）のうち 3〜5 個に部屋を置き、区画の並び順に通路でつなぐ（凝らない）。
  function genMap(state, floor) {
    const W = OWN.MAP_W, H = OWN.MAP_H;
    const tiles = new Array(W * H).fill(WALL);
    const room = new Array(W * H).fill(-1);
    const order = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]];
    const n = rrange(state, SPEC.ROOMS[0], SPEC.ROOMS[1]);
    const picks = shuffle(state, [0, 1, 2, 3, 4, 5]).slice(0, n).sort((a, b) => a - b);
    const rooms = [];
    picks.forEach((k, i) => {
      const cx = order[k][0], cy = order[k][1];
      const w = rrange(state, 3, 5), h = rrange(state, 3, 5);
      const x = cx * 7 + 1 + rint(state, 6 - w), y = cy * 7 + 1 + rint(state, 6 - h);
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { tiles[yy * W + xx] = ROOM; room[yy * W + xx] = i; }
      rooms.push({ id: i, x, y, w, h });
    });
    function carve(x, y) { if (tiles[y * W + x] === WALL) tiles[y * W + x] = PATH; }
    function connect(a, b) {
      const ax = a.x + (a.w >> 1), ay = a.y + (a.h >> 1), bx = b.x + (b.w >> 1), by = b.y + (b.h >> 1);
      if (rnd(state) < 0.5) {
        for (let x = ax; x !== bx; x += sign(bx - ax)) carve(x, ay);
        for (let y = ay; y !== by; y += sign(by - ay)) carve(bx, y);
      } else {
        for (let y = ay; y !== by; y += sign(by - ay)) carve(ax, y);
        for (let x = ax; x !== bx; x += sign(bx - ax)) carve(x, by);
      }
      carve(bx, by);
    }
    for (let i = 0; i + 1 < rooms.length; i++) connect(rooms[i], rooms[i + 1]);
    // 2フロア目以降は、ときどき輪になる道を足す（1フロア目は一本道のままにして、教える順番を守る）
    if (floor > 1 && rooms.length >= 4 && rnd(state) < 0.5) connect(rooms[rooms.length - 1], rooms[0]);
    return { w: W, h: H, tiles, room, rooms };
  }

  function roomCells(map, r) {
    const out = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
    return out;
  }

  function newEnemy(state, kind, x, y) {
    const d = ENEMIES[kind];
    // かべぬけゴーストは最初から気づいている。ばくだん岩は動かないので眠りの区別が無い。
    const awake = kind === 'ghost' || kind === 'bomb';
    return { id: state.nextId++, kind, x, y, hp: d.hp, maxHp: d.hp, awake, fresh: false };
  }
  function newItem(state, kind, x, y) {
    const it = { id: state.nextId++, kind, x, y };
    if (ITEMS[kind].charges) it.charges = ITEMS[kind].charges;
    return it;
  }

  function enterFloor(state, floor) {
    state.floor = floor;
    state.onStairs = false;
    // 1フロア目は「敵→アイテム→階段」の順に並ぶ形ができるまで作り直す（seedが同じなら結果も同じ）
    for (let attempt = 0; attempt < 200; attempt++) {
      state.map = genMap(state, floor);
      state.enemies = [];
      state.items = [];
      if (populate(state, floor, attempt >= 199)) return;
    }
  }

  function populate(state, floor, force) {
    const map = state.map, p = state.player, table = FLOOR_TABLE[floor];
    const rooms = map.rooms;
    const startRoom = rooms[rint(state, rooms.length)];
    const sc = roomCells(map, startRoom);
    const s = sc[rint(state, sc.length)];
    p.x = s.x; p.y = s.y;
    const dist = distMap(state, p.x, p.y);
    const others = rooms.filter((r) => r !== startRoom);
    let stairRoom;
    if (floor === 1) {
      // 1フロア目は一番遠い部屋に階段（道のりを長くして、途中に敵とアイテムを置く）
      stairRoom = others.slice().sort((a, b) => dist[idx(state, b.x, b.y)] - dist[idx(state, a.x, a.y)])[0];
    } else {
      stairRoom = others[rint(state, others.length)];
    }
    const tc = roomCells(map, stairRoom);
    const st = tc[rint(state, tc.length)];
    state.stairs = { x: st.x, y: st.y };

    const taken = (x, y) => (x === p.x && y === p.y) || (x === st.x && y === st.y) || !!enemyAt(state, x, y) || !!itemAt(state, x, y);
    const allRoomCells = [];
    for (const r of rooms) for (const c of roomCells(map, r)) allRoomCells.push({ x: c.x, y: c.y, room: r.id });
    function pickCell(filter) {
      const c = allRoomCells.filter((c) => !taken(c.x, c.y) && filter(c));
      return c.length ? c[rint(state, c.length)] : null;
    }
    const farFromPlayer = (c) => cheb(c, p) >= 4;

    let nEnemies = rrange(state, table.enemies[0], table.enemies[1]);
    let nItems = rrange(state, SPEC.ITEMS[0], SPEC.ITEMS[1]);

    if (floor === 1) {
      // 教え方：階段までの道の上に、まるぼう→おにぎりの順に置く。
      // 通路（幅1）の上に置くので、歩けば必ず「叩く」「拾う」が起きる。
      const path = findPath(state, p.x, p.y, (x, y) => x === st.x && y === st.y);
      if (!path) return false;
      const len = path.length;
      const isPathCell = (i) => map.tiles[idx(state, path[i].x, path[i].y)] === PATH;
      const nearest = (lo, hi, want) => {
        let best = -1;
        for (let i = lo; i <= hi; i++) {
          if (!isPathCell(i)) continue;
          if (best < 0 || Math.abs(i - want) < Math.abs(best - want)) best = i;
        }
        return best;
      };
      const ei = nearest(3, len - 5, Math.round(len * 0.35));
      const ii = ei < 0 ? -1 : nearest(ei + 2, len - 2, Math.round(len * 0.7));
      if ((ei < 0 || ii < 0) && !force) return false;
      const e0 = path[ei < 0 ? Math.max(0, Math.min(3, len - 2)) : ei];
      state.enemies.push(newEnemy(state, 'maru', e0.x, e0.y));
      const i0 = path[ii < 0 ? Math.max(0, len - 2) : ii];
      if (!taken(i0.x, i0.y)) state.items.push(newItem(state, 'onigiri', i0.x, i0.y));
      nEnemies -= 1;
      nItems -= 1;
      // 残りは道から外れた部屋へ（寄り道のごほうび：やくそう）
      const pathRooms = new Set();
      for (const c of path) { const r = roomAt(state, c.x, c.y); if (r >= 0) pathRooms.add(r); }
      pathRooms.add(startRoom.id);
      const offPath = (c) => !pathRooms.has(c.room);
      const awayFromPath = (c) => path.every((q) => cheb(q, c) > OWN.WAKE_RANGE) && c.room !== startRoom.id;
      for (let i = 0; i < nEnemies; i++) {
        const notOnPath = (c) => path.every((q) => q.x !== c.x || q.y !== c.y);
        const c = pickCell((c) => offPath(c) && farFromPlayer(c)) || pickCell((c) => awayFromPath(c) && farFromPlayer(c)) ||
          pickCell((c) => notOnPath(c) && c.room !== startRoom.id && farFromPlayer(c)) || pickCell((c) => notOnPath(c) && farFromPlayer(c)) || pickCell(notOnPath);
        if (c) state.enemies.push(newEnemy(state, 'maru', c.x, c.y));
      }
      // アイテムは、道から外れた部屋か、道の上のおにぎりより先にある部屋へ。
      // （スタートの部屋や、敵より手前に置くと「敵→アイテム→階段」の順番が崩れる）
      const roomFirst = {};
      path.forEach((c, i) => { const r = roomAt(state, c.x, c.y); if (r >= 0 && roomFirst[r] == null) roomFirst[r] = i; });
      const cut = ii < 0 ? len : ii;
      const offCells = (c) => path.every((q) => q.x !== c.x || q.y !== c.y);
      const later = (c) => offCells(c) && c.room !== startRoom.id && roomFirst[c.room] != null && roomFirst[c.room] > cut;
      for (let i = 0; i < nItems; i++) {
        const kind = i === 0 ? 'herb' : pickWeighted(state, table.ipool);
        const c = pickCell(offPath) || pickCell(later);
        if (!c && !force) return false;
        const c2 = c || pickCell(offCells);
        if (c2) state.items.push(newItem(state, kind, c2.x, c2.y));
      }
      return true;
    }

    for (let i = 0; i < nEnemies; i++) {
      const kind = pickWeighted(state, table.pool);
      const c = pickCell((c) => c.room !== startRoom.id && farFromPlayer(c)) || pickCell(farFromPlayer);
      if (c) state.enemies.push(newEnemy(state, kind, c.x, c.y));
    }
    for (let i = 0; i < nItems; i++) {
      const kind = pickWeighted(state, table.ipool);
      const c = pickCell(() => true);
      if (c) state.items.push(newItem(state, kind, c.x, c.y));
    }
    return true;
  }

  // ---- 開始 ---------------------------------------------------------------
  function newPlayer() {
    return {
      x: 0, y: 0, dx: 0, dy: 1,
      hp: SPEC.PLAYER_HP, maxHp: SPEC.PLAYER_HP, atk: SPEC.PLAYER_ATK,
      lv: 1, xp: 0,
      hunger: OWN.HUNGER_START, steps: 0, starve: 0,
      inv: [],
    };
  }
  function newStats() { return { kills: 0, used: {}, thrown: 0, dmgTaken: 0, hungerZero: false }; }

  function create(seed) {
    const s = (seed >>> 0) || 1;
    const state = {
      seed: s, rng: (s ^ 0x9e3779b9) | 0,
      floor: 0, turn: 0, over: null, cause: null, onStairs: false, nextId: 1,
      player: newPlayer(), map: null, enemies: [], items: [], stairs: null,
      stats: newStats(),
    };
    enterFloor(state, 1);
    return state;
  }

  // テスト用：文字の地図から盤面を作る。
  // '#'壁 '.'部屋の床 ','通路 '@'自分 '>'階段  敵: m u g b y  アイテム: o h f w s
  // 敵とアイテムは部屋の床の上に置かれる。opts.asleep=true で敵を眠らせる（既定は起きている）。
  function fromAscii(rows, opts) {
    opts = opts || {};
    const h = rows.length, w = rows[0].length;
    const state = {
      seed: 1, rng: 12345, floor: opts.floor || 1, turn: 0, over: null, cause: null, onStairs: false, nextId: 1,
      player: newPlayer(), map: { w, h, tiles: new Array(w * h).fill(WALL), room: new Array(w * h).fill(-1), rooms: [] },
      enemies: [], items: [], stairs: { x: -1, y: -1 },
      stats: newStats(),
    };
    const ek = { m: 'maru', u: 'usagi', g: 'ghost', b: 'bomb', y: 'yumi' };
    const ik = { o: 'onigiri', h: 'herb', f: 'fire', w: 'warp', s: 'scroll' };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = rows[y][x];
        if (c === '#') continue;
        state.map.tiles[y * w + x] = c === ',' ? PATH : ROOM;
        if (c === '@') { state.player.x = x; state.player.y = y; }
        else if (c === '>') state.stairs = { x, y };
        else if (ek[c]) { const e = newEnemy(state, ek[c], x, y); if (!opts.asleep) e.awake = true; state.enemies.push(e); }
        else if (ik[c]) state.items.push(newItem(state, ik[c], x, y));
      }
    }
    // 部屋番号：つながった部屋の床ごとに番号をふる
    let rid = 0;
    for (let i = 0; i < w * h; i++) {
      if (state.map.tiles[i] !== ROOM || state.map.room[i] >= 0) continue;
      const q = [i];
      state.map.room[i] = rid;
      while (q.length) {
        const k = q.pop(), x = k % w, y = Math.floor(k / w);
        for (const [dx, dy] of DIRS.slice(0, 4)) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nk = ny * w + nx;
          if (state.map.tiles[nk] === ROOM && state.map.room[nk] < 0) { state.map.room[nk] = rid; q.push(nk); }
        }
      }
      rid++;
    }
    if (opts.hunger != null) state.player.hunger = opts.hunger;
    if (opts.hp != null) state.player.hp = opts.hp;
    if (opts.inv) for (const k of opts.inv) { const it = newItem(state, k, 0, 0); delete it.x; delete it.y; state.player.inv.push(it); }
    return state;
  }

  // ---- 経験値とレベル -----------------------------------------------------
  // レベル lv から次へ上がるのに必要な累計経験値：10, 25, 45, 70, 100 …
  function xpNeed(lv) { return (5 * lv * (lv + 3)) / 2; }

  function gainXp(state, xp, ev) {
    const p = state.player;
    p.xp += xp;
    ev.push({ t: 'xp', xp, total: p.xp });
    while (p.xp >= xpNeed(p.lv)) {
      p.lv += 1;
      p.maxHp += SPEC.LEVEL_HP;
      p.atk += SPEC.LEVEL_ATK;
      ev.push({ t: 'levelup', lv: p.lv, maxHp: p.maxHp, atk: p.atk });
    }
  }

  // ---- ダメージ -----------------------------------------------------------
  function hurtPlayer(state, dmg, by, ev) {
    if (state.over) return;
    const p = state.player;
    p.hp = Math.max(0, p.hp - dmg);
    state.stats.dmgTaken += dmg;
    ev.push({ t: 'phurt', dmg, hp: p.hp, by });
    if (p.hp <= 0) {
      state.over = 'dead';
      state.cause = { how: by.how, kind: by.kind || null, floor: state.floor };
      ev.push({ t: 'dead', cause: state.cause });
    }
  }

  function damageEnemy(state, e, dmg, ev) {
    if (e.hp <= 0) return;
    e.hp = Math.max(0, e.hp - dmg);
    if (!e.awake) { e.awake = true; ev.push({ t: 'wake', id: e.id }); }
    e.fresh = false;
    ev.push({ t: 'ehurt', id: e.id, kind: e.kind, dmg, hp: e.hp });
    if (e.hp <= 0) killEnemy(state, e, ev);
  }

  function killEnemy(state, e, ev) {
    const i = state.enemies.indexOf(e);
    if (i >= 0) state.enemies.splice(i, 1);
    state.stats.kills += 1;
    ev.push({ t: 'kill', id: e.id, kind: e.kind, x: e.x, y: e.y });
    gainXp(state, ENEMIES[e.kind].xp, ev);
    if (e.kind === 'bomb') explode(state, e.x, e.y, ev);
  }

  // ばくだん岩：倒すと周囲1マスに爆発（自分にも敵にも5）。巻きこまれた岩も続けて爆発する。
  function explode(state, x, y, ev) {
    ev.push({ t: 'explode', x, y });
    const p = state.player;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (p.x === nx && p.y === ny) hurtPlayer(state, SPEC.BOMB_DMG, { how: 'explosion', kind: 'bomb' }, ev);
      const e = enemyAt(state, nx, ny);
      if (e) damageEnemy(state, e, SPEC.BOMB_DMG, ev);
    }
  }

  // ---- 自分の行動 ---------------------------------------------------------
  // 攻撃ボタンが叩く相手＝一番近い隣の敵。縦横の隣が先、次に斜め。
  // 同じ近さなら、ばくだん岩は後回し、体力の少ない敵が先。
  function attackTarget(state) {
    const p = state.player;
    let best = null, bestKey = null;
    DIRS.forEach(([dx, dy], i) => {
      const e = enemyAt(state, p.x + dx, p.y + dy);
      if (!e) return;
      const key = [i < 4 ? 0 : 1, e.kind === 'bomb' ? 1 : 0, e.hp, i];
      if (!best || cmpKey(key, bestKey) < 0) { best = e; bestKey = key; }
    });
    return best;
  }
  function cmpKey(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }

  function playerAttack(state, e, ev) {
    const p = state.player;
    p.dx = sign(e.x - p.x); p.dy = sign(e.y - p.y);
    ev.push({ t: 'pattack', id: e.id, kind: e.kind, x: e.x, y: e.y });
    damageEnemy(state, e, p.atk, ev);
  }

  function invEvent(state) {
    return { t: 'inv', inv: state.player.inv.map((it) => Object.assign({}, it)) };
  }

  function actMove(state, dx, dy, ev) {
    if (!validDir(dx, dy)) { ev.push({ t: 'refuse', why: 'noDir' }); return false; }
    const p = state.player;
    const nx = p.x + dx, ny = p.y + dy;
    p.dx = dx; p.dy = dy;
    const e = enemyAt(state, nx, ny);
    if (e) { playerAttack(state, e, ev); return true; } // 敵のいる方向へ進むと通常攻撃
    if (isWall(state, nx, ny)) { ev.push({ t: 'bump', dx, dy }); return false; } // 壁：手番は進まない
    p.x = nx; p.y = ny;
    ev.push({ t: 'pmove', x: nx, y: ny });
    const it = itemAt(state, nx, ny);
    if (it) {
      if (p.inv.length < SPEC.INV_MAX) {
        state.items.splice(state.items.indexOf(it), 1);
        const got = { id: it.id, kind: it.kind };
        if (it.charges != null) got.charges = it.charges;
        p.inv.push(got);
        ev.push({ t: 'pickup', kind: it.kind, id: it.id });
        ev.push(invEvent(state));
      } else {
        ev.push({ t: 'full', kind: it.kind });
      }
    }
    if (state.stairs && nx === state.stairs.x && ny === state.stairs.y) state.onStairs = true;
    return true;
  }

  // 炎が届くマス（直線4マスまで。壁で止まる。壁の中の敵には当たる）
  function fireCells(state, dx, dy) {
    const p = state.player, cells = [];
    let x = p.x, y = p.y;
    for (let i = 0; i < SPEC.FIRE_RANGE; i++) {
      x += dx; y += dy;
      const wall = isWall(state, x, y);
      if (wall && !enemyAt(state, x, y)) break;
      cells.push({ x, y });
      if (wall) break;
    }
    return cells;
  }

  // まっすぐ飛ぶもの（ワープの杖・投げたアイテム）：最初の敵か壁で止まる
  function lineShot(state, dx, dy, range) {
    const p = state.player, path = [];
    let x = p.x, y = p.y;
    for (let i = 0; i < range; i++) {
      x += dx; y += dy;
      const e = enemyAt(state, x, y);
      if (e) { path.push({ x, y }); return { path, hit: e }; }
      if (isWall(state, x, y)) break;
      path.push({ x, y });
    }
    return { path, hit: null };
  }

  function useUp(state, slot, ev) {
    const p = state.player;
    const it = p.inv[slot];
    state.stats.used[it.kind] = (state.stats.used[it.kind] || 0) + 1;
    if (it.charges != null) {
      it.charges -= 1;
      if (it.charges <= 0) p.inv.splice(slot, 1); // 使いきった杖は消える
    } else {
      p.inv.splice(slot, 1);
    }
  }

  function actUse(state, a, ev) {
    const p = state.player;
    const it = p.inv[a.slot];
    if (!it) { ev.push({ t: 'refuse', why: 'noItem' }); return false; }
    const def = ITEMS[it.kind];
    if (def.aim && !validDir(a.dx, a.dy)) { ev.push({ t: 'refuse', why: 'noDir' }); return false; }
    if (def.aim) { p.dx = a.dx; p.dy = a.dy; }
    switch (it.kind) {
      case 'onigiri': {
        const before = p.hunger;
        p.hunger = Math.min(SPEC.HUNGER_MAX, p.hunger + SPEC.ONIGIRI_FOOD);
        p.starve = 0;
        useUp(state, a.slot, ev);
        ev.push({ t: 'eat', kind: it.kind, gain: p.hunger - before, hunger: p.hunger });
        break;
      }
      case 'herb': {
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + SPEC.HERB_HEAL);
        useUp(state, a.slot, ev);
        ev.push({ t: 'drink', kind: it.kind, gain: p.hp - before, hp: p.hp });
        break;
      }
      case 'scroll': {
        const rid = roomAt(state, p.x, p.y);
        if (rid < 0) { ev.push({ t: 'refuse', why: 'noRoom' }); return false; } // 通路では読めない（むだにならない）
        useUp(state, a.slot, ev);
        const targets = state.enemies.filter((e) => roomAt(state, e.x, e.y) === rid);
        ev.push({ t: 'read', kind: it.kind, room: rid, n: targets.length });
        for (const e of targets) if (state.enemies.includes(e)) damageEnemy(state, e, SPEC.SCROLL_DMG, ev);
        break;
      }
      case 'fire': {
        const cells = fireCells(state, a.dx, a.dy);
        const left = it.charges - 1;
        useUp(state, a.slot, ev);
        ev.push({ t: 'fire', kind: it.kind, dx: a.dx, dy: a.dy, cells, charges: left });
        for (const c of cells) {
          const e = enemyAt(state, c.x, c.y);
          if (e) damageEnemy(state, e, SPEC.FIRE_DMG, ev);
        }
        break;
      }
      case 'warp': {
        const shot = lineShot(state, a.dx, a.dy, OWN.WARP_RANGE);
        const left = it.charges - 1;
        useUp(state, a.slot, ev);
        let to = null;
        if (shot.hit) {
          const e = shot.hit;
          to = warpCell(state, e);
          if (to) { e.x = to.x; e.y = to.y; }
        }
        ev.push({ t: 'warp', kind: it.kind, dx: a.dx, dy: a.dy, path: shot.path, id: shot.hit ? shot.hit.id : null, ekind: shot.hit ? shot.hit.kind : null, to, charges: left });
        break;
      }
    }
    ev.push(invEvent(state));
    return true;
  }

  // ワープ先：フロア内の空いている床のどこか（できれば自分から離れた所）
  function warpCell(state, e) {
    const p = state.player, w = state.map.w, h = state.map.h;
    const free = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (isWall(state, x, y) || enemyAt(state, x, y) || (p.x === x && p.y === y)) continue;
      if (state.stairs && state.stairs.x === x && state.stairs.y === y) continue;
      free.push({ x, y });
    }
    const far = free.filter((c) => cheb(c, p) >= 6);
    const pool = far.length ? far : free;
    return pool.length ? pool[rint(state, pool.length)] : null;
  }

  function actThrow(state, a, ev) {
    const p = state.player;
    const it = p.inv[a.slot];
    if (!it) { ev.push({ t: 'refuse', why: 'noItem' }); return false; }
    if (!validDir(a.dx, a.dy)) { ev.push({ t: 'refuse', why: 'noDir' }); return false; }
    p.dx = a.dx; p.dy = a.dy;
    p.inv.splice(a.slot, 1);
    state.stats.thrown += 1;
    const shot = lineShot(state, a.dx, a.dy, OWN.THROW_RANGE);
    if (shot.hit) {
      // どのアイテムも投げられる。当たると2のダメージ（投げたアイテムは無くなる）
      ev.push({ t: 'throw', kind: it.kind, path: shot.path, id: shot.hit.id, ekind: shot.hit.kind, land: null });
      ev.push(invEvent(state));
      damageEnemy(state, shot.hit, SPEC.THROW_DMG, ev);
      return true;
    }
    const last = shot.path.length ? shot.path[shot.path.length - 1] : { x: p.x, y: p.y };
    const land = landCell(state, last.x, last.y);
    if (land) {
      const dropped = { id: it.id, kind: it.kind, x: land.x, y: land.y };
      if (it.charges != null) dropped.charges = it.charges;
      state.items.push(dropped);
    }
    ev.push({ t: 'throw', kind: it.kind, path: shot.path, id: null, ekind: null, land });
    ev.push(invEvent(state));
    return true;
  }

  // 落ちる場所：そのマスが空いていなければ、一番近い空いた床
  function landCell(state, x, y) {
    const free = (cx, cy) => !itemAt(state, cx, cy) && !(state.stairs && state.stairs.x === cx && state.stairs.y === cy);
    if (free(x, y)) return { x, y };
    const path = findPath(state, x, y, free);
    return path ? path[path.length - 1] : null;
  }

  // ---- 歩数の時計（満腹度・自然回復・空腹ダメージ） ----------------------
  // 「歩」＝自分の1手（歩く・叩く・待つ・アイテムを使う、のどれでも1歩と数える）
  function tick(state, ev) {
    const p = state.player;
    p.steps += 1;
    if (p.hunger <= 0) {
      p.starve += 1;
      if (p.starve % SPEC.STARVE_STEP === 0) hurtPlayer(state, 1, { how: 'starve' }, ev);
      return;
    }
    if (p.steps % SPEC.HUNGER_STEP === 0) {
      p.hunger -= 1;
      ev.push({ t: 'hunger', hunger: p.hunger });
      if (p.hunger <= 0) { p.starve = 0; state.stats.hungerZero = true; ev.push({ t: 'hungry' }); }
    }
    if (p.hunger > 0 && p.steps % SPEC.REGEN_STEP === 0 && p.hp < p.maxHp) {
      p.hp += 1;
      ev.push({ t: 'regen', hp: p.hp });
    }
  }

  // ---- 敵の行動 -----------------------------------------------------------
  function notices(state, e) {
    const p = state.player;
    const r = roomAt(state, e.x, e.y);
    return (r >= 0 && r === roomAt(state, p.x, p.y)) || cheb(e, p) <= OWN.WAKE_RANGE;
  }

  function enemyAttack(state, e, ev) {
    ev.push({ t: 'eattack', id: e.id, kind: e.kind, x: e.x, y: e.y });
    hurtPlayer(state, ENEMIES[e.kind].atk, { how: 'melee', kind: e.kind }, ev);
  }

  function freeForEnemy(state, x, y, throughWalls) {
    const p = state.player;
    if (!inMap(state, x, y)) return false;
    if (!throughWalls && isWall(state, x, y)) return false;
    if (p.x === x && p.y === y) return false;
    return !enemyAt(state, x, y);
  }

  function moveEnemy(e, x, y, ev) {
    e.x = x; e.y = y;
    ev.push({ t: 'emove', id: e.id, x, y });
  }

  // 歩数表を見て、自分に1歩近づく。近づけるマスが無ければ動かない。
  function stepToward(state, e, dist, ev) {
    const w = state.map.w;
    const cur = dist[e.y * w + e.x];
    let best = null, bestD = cur < 0 ? Infinity : cur;
    for (const [dx, dy] of DIRS) {
      const nx = e.x + dx, ny = e.y + dy;
      if (!freeForEnemy(state, nx, ny, false)) continue;
      const d = dist[ny * w + nx];
      if (d >= 0 && d < bestD) { bestD = d; best = { x: nx, y: ny }; }
    }
    if (!best) return false;
    moveEnemy(e, best.x, best.y, ev);
    return true;
  }

  function aligned(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    return dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
  }
  // (x,y) から自分へ、矢の直線が通るか（間に壁も敵もいない、距離は2〜3）
  function canShootFrom(state, x, y, self) {
    const p = state.player, from = { x, y };
    const d = cheb(from, p);
    if (d < 2 || d > SPEC.ARROW_RANGE || !aligned(from, p)) return false;
    const sx = sign(p.x - x), sy = sign(p.y - y);
    let cx = x + sx, cy = y + sy;
    while (cx !== p.x || cy !== p.y) {
      if (isWall(state, cx, cy)) return false;
      const e = enemyAt(state, cx, cy);
      if (e && e !== self) return false;
      cx += sx; cy += sy;
    }
    return true;
  }

  const ACT = {
    // まるぼう：近づいて隣で叩く
    maru(state, e, dist, ev) {
      if (cheb(e, state.player) === 1) enemyAttack(state, e, ev);
      else stepToward(state, e, dist, ev);
    },
    // とびうさぎ：隣にいないときは2回動く（1歩進んで隣に着いたら、2回目は叩く）。隣にいるときは1回叩く。
    usagi(state, e, dist, ev) {
      const p = state.player;
      if (cheb(e, p) === 1) { enemyAttack(state, e, ev); return; }
      if (!stepToward(state, e, dist, ev)) return;
      if (cheb(e, p) === 1) enemyAttack(state, e, ev);
      else stepToward(state, e, dist, ev);
    },
    // かべぬけゴースト：壁をすり抜けて、まっすぐ近づく
    ghost(state, e, dist, ev) {
      const p = state.player;
      if (cheb(e, p) === 1) { enemyAttack(state, e, ev); return; }
      const sx = sign(p.x - e.x), sy = sign(p.y - e.y);
      const tries = [[sx, sy], [sx, 0], [0, sy]];
      for (const [dx, dy] of tries) {
        if (dx === 0 && dy === 0) continue;
        if (freeForEnemy(state, e.x + dx, e.y + dy, true)) { moveEnemy(e, e.x + dx, e.y + dy, ev); return; }
      }
    },
    // ばくだん岩：動かない
    bomb() {},
    // ゆみへい：直線が通ると3マス先から矢。近づかれると逃げる（逃げ場が無ければ何もできない）
    yumi(state, e, dist, ev) {
      const p = state.player, w = state.map.w;
      const d = cheb(e, p);
      if (d === 1) {
        let best = null, bestKey = null;
        for (const [dx, dy] of DIRS) {
          const nx = e.x + dx, ny = e.y + dy;
          if (!freeForEnemy(state, nx, ny, false)) continue;
          const c = { x: nx, y: ny };
          if (cheb(c, p) < 2) continue;
          const key = dist[ny * w + nx];
          if (!best || key > bestKey) { best = c; bestKey = key; }
        }
        if (best) moveEnemy(e, best.x, best.y, ev);
        return;
      }
      if (canShootFrom(state, e.x, e.y, e)) {
        ev.push({ t: 'arrow', id: e.id, kind: e.kind, x: e.x, y: e.y });
        hurtPlayer(state, SPEC.ARROW_DMG, { how: 'arrow', kind: 'yumi' }, ev);
        return;
      }
      // 矢が撃てる場所へ動く。無ければ近づく（ただし隣には入らない）
      const cur = dist[e.y * w + e.x];
      let best = null, bestKey = null;
      for (const [dx, dy] of DIRS) {
        const nx = e.x + dx, ny = e.y + dy;
        if (!freeForEnemy(state, nx, ny, false)) continue;
        const c = { x: nx, y: ny };
        if (cheb(c, p) < 2) continue;
        const dd = dist[ny * w + nx];
        const shoot = canShootFrom(state, nx, ny, e);
        if (!shoot && !(dd >= 0 && (cur < 0 || dd < cur))) continue;
        const key = [shoot ? 0 : 1, dd < 0 ? 999 : dd];
        if (!best || cmpKey(key, bestKey) < 0) { best = c; bestKey = key; }
      }
      if (best) moveEnemy(e, best.x, best.y, ev);
    },
  };

  function enemyPhase(state, ev) {
    const p = state.player;
    // 気づく：同じ部屋に入られたか、すぐ近くまで来られたら目をさます。気づいた手は動かない（見てから対応できる）
    for (const e of state.enemies) {
      if (!e.awake && notices(state, e)) { e.awake = true; e.fresh = true; ev.push({ t: 'wake', id: e.id }); }
    }
    const dist = distMap(state, p.x, p.y);
    const order = state.enemies.slice().sort((a, b) => cheb(a, p) - cheb(b, p) || a.id - b.id);
    for (const e of order) {
      if (state.over) break;
      if (!state.enemies.includes(e)) continue;
      if (e.fresh) { e.fresh = false; continue; }
      if (!e.awake) continue;
      ACT[e.kind](state, e, dist, ev);
    }
  }

  // ---- 1手 ---------------------------------------------------------------
  // action: {type:'move',dx,dy} | {type:'wait'} | {type:'attack'} | {type:'use',slot[,dx,dy]} | {type:'throw',slot,dx,dy}
  // 返り値: この1手で起きたことの記録（順番どおり）。手番が進まなかったときは refuse / bump だけが返る。
  function step(state, action) {
    const ev = [];
    if (state.over) return ev;
    let used = false;
    switch (action && action.type) {
      case 'move': used = actMove(state, action.dx, action.dy, ev); break;
      case 'wait': ev.push({ t: 'wait' }); used = true; break;
      case 'attack': {
        const tg = attackTarget(state);
        if (!tg) ev.push({ t: 'refuse', why: 'noTarget' });
        else { playerAttack(state, tg, ev); used = true; }
        break;
      }
      case 'use': used = actUse(state, action, ev); break;
      case 'throw': used = actThrow(state, action, ev); break;
      default: ev.push({ t: 'refuse', why: 'unknown' });
    }
    if (!used) return ev;
    state.turn += 1;
    if (!state.over) tick(state, ev);
    if (state.over) return ev;
    if (state.onStairs) {
      if (state.floor >= SPEC.FLOORS) {
        state.over = 'clear';
        ev.push({ t: 'clear' });
      } else {
        enterFloor(state, state.floor + 1);
        ev.push({ t: 'descend', floor: state.floor });
      }
      return ev;
    }
    enemyPhase(state, ev);
    return ev;
  }

  // 死因を1行で
  function causeText(cause) {
    if (!cause) return '';
    const f = cause.floor + 'Fで ';
    const name = cause.kind ? ENEMIES[cause.kind].name : '';
    switch (cause.how) {
      case 'melee': return f + name + 'に たたかれて 力つきた';
      case 'arrow': return f + name + 'の 矢に うたれて 力つきた';
      case 'explosion': return f + name + 'の 爆発に まきこまれた';
      case 'starve': return f + 'おなかが へって 力つきた';
    }
    return f + '力つきた';
  }

  function clone(state) { return JSON.parse(JSON.stringify(state)); }

  return {
    SPEC, OWN, ENEMIES, ITEMS, FLOOR_TABLE, DIRS, WALL, ROOM, PATH,
    create, step, fromAscii, clone,
    attackTarget, fireCells, lineShot, xpNeed, causeText,
    isWall, roomAt, enemyAt, itemAt, cheb, distMap, findPath, validDir,
  };
});
