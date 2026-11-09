// keys.js — ボタン設定（キーコンフィグ）の決まり。画面を知らない。
// 「どのキーが、どの操作か」の表を持ち、変える・保存用に直す・読みもどす、だけをする。
// 画面側（ui.js）はこの表を引いて操作を出す。テスト（tests.js）は Node でこれを直接回す。
//
// 決めごと（REPORT.md にも書いてある）：
//   ・キーを割り当てると、その操作のキーは「いま押したキー1つだけ」になる。
//   ・そのキーを別の操作が使っていたら、そちらから外す（上書き）。入れ替えはしない。
//     外された操作にほかのキーが残っていなければ、その操作は「なし」（未割り当て）になる。
//   ・1つのキーが2つの操作を持つことは無い。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Keys = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 変えられる操作（この順で画面に並ぶ）。dir があるものは移動。
  const ACTIONS = [
    { id: 'upleft', name: '左上', dir: [-1, -1] },
    { id: 'up', name: '上', dir: [0, -1] },
    { id: 'upright', name: '右上', dir: [1, -1] },
    { id: 'left', name: '左', dir: [-1, 0] },
    { id: 'wait', name: '待つ' },
    { id: 'right', name: '右', dir: [1, 0] },
    { id: 'downleft', name: '左下', dir: [-1, 1] },
    { id: 'down', name: '下', dir: [0, 1] },
    { id: 'downright', name: '右下', dir: [1, 1] },
    { id: 'attack', name: 'こうげき' },
    { id: 'item', name: '持ち物' }, // 持ち物をえらぶ（押すたびに次の持ち物へ）
    { id: 'use', name: '使う' },
    { id: 'throw', name: '投げる' },
    { id: 'cancel', name: 'やめる' },
  ];
  const BY_ID = {};
  for (const a of ACTIONS) BY_ID[a.id] = a;

  // 既定値。キーは KeyboardEvent.code（キーの場所）で持つ。
  const DEFAULTS = {
    upleft: ['KeyQ', 'Numpad7'],
    up: ['ArrowUp', 'KeyW', 'Numpad8'],
    upright: ['KeyE', 'Numpad9'],
    left: ['ArrowLeft', 'KeyA', 'Numpad4'],
    wait: ['KeyS', 'Numpad5', 'Period'],
    right: ['ArrowRight', 'KeyD', 'Numpad6'],
    downleft: ['KeyZ', 'Numpad1'],
    down: ['ArrowDown', 'KeyX', 'Numpad2'],
    downright: ['KeyC', 'Numpad3'],
    attack: ['Space', 'KeyF'],
    item: ['KeyI'],
    use: ['Enter'],
    throw: ['KeyT'],
    cancel: ['Escape'],
  };

  // 割り当てられないキー：ブラウザや入力の道具が使うもの（Tab は画面の中の移動に残す）
  const RESERVED = /^(Tab|CapsLock|NumLock|ScrollLock|ContextMenu|PrintScreen|Pause|F\d{1,2}|(Shift|Control|Alt|Meta|OS)(Left|Right)?|Lang\d|Convert|NonConvert|KanaMode|Unidentified)$/;
  function usable(code) {
    return typeof code === 'string' && code.length > 0 && code.length <= 32 && !RESERVED.test(code);
  }

  function defaults() {
    const map = {};
    for (const a of ACTIONS) map[a.id] = DEFAULTS[a.id].slice();
    return { map, labels: {} };
  }

  // そのキーの操作（無ければ null）
  function lookup(cfg, code) {
    for (const a of ACTIONS) if (cfg.map[a.id].indexOf(code) >= 0) return a.id;
    return null;
  }

  // キーを割り当てる（cfg を書きかえる）。
  // 返り値: { ok, why, from, emptied }
  //   from    … そのキーを持っていた別の操作（無ければ null）
  //   emptied … from の操作にキーが1つも残らなかったら true
  function assign(cfg, action, code, label) {
    if (!BY_ID[action]) return { ok: false, why: 'action', from: null, emptied: false };
    if (!usable(code)) return { ok: false, why: 'reserved', from: null, emptied: false };
    let from = lookup(cfg, code);
    if (from === action) from = null;
    if (from) cfg.map[from] = cfg.map[from].filter((c) => c !== code);
    cfg.map[action] = [code];
    if (typeof label === 'string' && label) cfg.labels[code] = label; else delete cfg.labels[code];
    // 使われなくなったキーの呼び名は捨てる
    for (const c of Object.keys(cfg.labels)) if (!lookup(cfg, c)) delete cfg.labels[c];
    return { ok: true, why: null, from, emptied: !!from && cfg.map[from].length === 0 };
  }

  // 保存してあったものを読みもどす。こわれていても、必ず使える表を返す。
  //   ・知らない操作、使えないキー、重なったキー（先に出てきた操作が勝つ）は捨てる。
  //   ・保存に無い操作は既定値（ほかの操作が使っていないキーだけ）。
  //   ・空の配列で保存された操作は「なし」のまま（自分で外したものを勝手に戻さない）。
  function load(saved) {
    const src = saved && typeof saved === 'object' && saved.map && typeof saved.map === 'object' ? saved.map : null;
    if (!src) return defaults();
    const cfg = { map: {}, labels: {} };
    const used = {};
    const missing = [];
    for (const a of ACTIONS) {
      const list = src[a.id];
      if (!Array.isArray(list)) { cfg.map[a.id] = []; missing.push(a.id); continue; }
      cfg.map[a.id] = [];
      for (const code of list) {
        if (!usable(code) || used[code]) continue;
        used[code] = true;
        cfg.map[a.id].push(code);
      }
    }
    for (const id of missing) {
      for (const code of DEFAULTS[id]) {
        if (used[code]) continue;
        used[code] = true;
        cfg.map[id].push(code);
      }
    }
    const labels = saved.labels && typeof saved.labels === 'object' ? saved.labels : {};
    for (const code of Object.keys(labels)) {
      const v = labels[code];
      if (used[code] && typeof v === 'string' && v.length > 0 && v.length <= 12) cfg.labels[code] = v;
    }
    return cfg;
  }

  function isDefault(cfg) {
    return ACTIONS.every((a) => JSON.stringify(cfg.map[a.id]) === JSON.stringify(DEFAULTS[a.id]));
  }

  // ---- キーの呼び名（画面に出す文字） -------------------------------------
  const NAMES = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Space: 'スペース', Enter: 'Enter', Escape: 'Esc', Backspace: 'BackSpace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    Period: '.', Comma: ',', Minus: '-', Equal: '=', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`', IntlRo: 'ろ', IntlYen: '¥',
    NumpadEnter: 'テンキーEnter', NumpadAdd: 'テンキー+', NumpadSubtract: 'テンキー-', NumpadMultiply: 'テンキー*',
    NumpadDivide: 'テンキー/', NumpadDecimal: 'テンキー.',
  };
  function nameOf(code) {
    if (NAMES[code]) return NAMES[code];
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit(\d)$/.exec(code))) return m[1];
    if ((m = /^Numpad(\d)$/.exec(code))) return 'テンキー' + m[1];
    return code;
  }
  // 押されたときに分かる呼び名。キーに書いてある文字（e.key）が1文字ならそれを使う
  // （キーボードの種類で、同じ場所のキーに書いてある記号が違うため）。
  // テンキーと、呼び名の決まっているキー（やじるし・スペースなど）は、決まった呼び名のまま。
  function labelFromEvent(code, key) {
    if (/^Numpad/.test(code) || /^(Arrow|Space|Enter|Escape)/.test(code)) return nameOf(code);
    if (typeof key === 'string' && key.length === 1 && key.trim()) return key.toUpperCase();
    return nameOf(code);
  }
  function label(cfg, code) { return cfg.labels[code] || nameOf(code); }

  return { ACTIONS, BY_ID, DEFAULTS, defaults, usable, lookup, assign, load, isDefault, nameOf, labelFromEvent, label };
});
