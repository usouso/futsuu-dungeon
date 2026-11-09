#!/usr/bin/env python3
"""画面確認の道具。

- スクリーンショットを screenshots/ に保存する（PC とスマホ）。
- 文字の検査をする：小さすぎる文字／文字どうしの重なり／枠からのはみ出し／途中で切れている文字。
  「見えている範囲だけ」を数える（display:none、透明、別の画面の下に隠れている文字は数えない）。
- ?auto=1 の自動プレイが最後まで進むこと、?auto=1 / ?mute=1 で音が鳴り始めないことも見る。
- ボタン設定（キーコンフィグ）：変えたキーで実際に操作できること、重なったときの扱い、保存、既定値に戻すことも見る。

実行:  ~/workspace/.venv-pw/bin/python tools/shots.py
結果:  screenshots/*.png と screenshots/check.json。問題があれば終了コード 1。
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri()
OUT = ROOT / "screenshots"

VIEWS = {
    "pc": dict(viewport={"width": 1280, "height": 720}, device_scale_factor=1),
    "sp": dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True),
    # 小さめのスマホ（参考。縦に入りきらないときはスクロールになる）
    "sp-small": dict(viewport={"width": 360, "height": 640}, device_scale_factor=2, is_mobile=True, has_touch=True),
}

# 文字の検査（ページの中で動く）。見えている文字だけを集めて調べる。
CHECK_JS = r"""
() => {
  const MIN_FONT = 14;
  const vw = window.innerWidth, vh = window.innerHeight;
  const issues = [];
  const texts = [];
  // pointer-events:none の要素も elementFromPoint で拾えるように、検査の間だけ上書きする
  const probe = document.createElement('style');
  probe.textContent = '* { pointer-events: auto !important; }';
  document.head.appendChild(probe);

  const name = (el) => {
    const parts = [];
    for (let a = el; a && a !== document.body && parts.length < 4; a = a.parentElement) {
      parts.unshift(a.id ? '#' + a.id : a.tagName.toLowerCase() + (a.className && typeof a.className === 'string' ? '.' + a.className.trim().split(/\s+/).join('.') : ''));
      if (a.id) break;
    }
    return parts.join(' > ');
  };
  const shown = (el) => {
    if (getComputedStyle(el).visibility !== 'visible') return false;
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
    }
    return true;
  };
  const clipOf = (el) => {
    let r = { l: 0, t: 0, r: vw, b: vh };
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const b = a.getBoundingClientRect();
        r = { l: Math.max(r.l, b.left), t: Math.max(r.t, b.top), r: Math.min(r.r, b.right), b: Math.min(r.b, b.bottom) };
      }
    }
    return r;
  };
  const rnd = (r) => ({ l: Math.round(r.l), t: Math.round(r.t), r: Math.round(r.r), b: Math.round(r.b) });

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const str = node.nodeValue.replace(/\s+/g, ' ').trim();
    if (!str) continue;
    const el = node.parentElement;
    if (!el || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    if (!shown(el)) continue;                       // 見えていない → 数えない
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) continue;
    const full = { l: Math.min(...rects.map((r) => r.left)), t: Math.min(...rects.map((r) => r.top)), r: Math.max(...rects.map((r) => r.right)), b: Math.max(...rects.map((r) => r.bottom)) };
    const clip = clipOf(el);
    const vis = { l: Math.max(full.l, clip.l), t: Math.max(full.t, clip.t), r: Math.min(full.r, clip.r), b: Math.min(full.b, clip.b) };
    if (vis.r - vis.l <= 0.5 || vis.b - vis.t <= 0.5) continue; // 画面や枠の外 → 見えていない → 数えない
    const top = document.elementFromPoint((vis.l + vis.r) / 2, (vis.t + vis.b) / 2);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) continue; // 別の画面の下 → 数えない
    const cs = getComputedStyle(el);
    const t = { text: str.slice(0, 24), where: name(el), el, full, vis, font: parseFloat(cs.fontSize) };
    texts.push(t);
    if (t.font < MIN_FONT) issues.push({ type: 'small', text: t.text, where: t.where, font: t.font });
    if (full.r - vis.r > 1 || vis.l - full.l > 1 || full.b - vis.b > 1 || vis.t - full.t > 1) {
      issues.push({ type: 'clipped', text: t.text, where: t.where, full: rnd(full), vis: rnd(vis) });
    }
    const box = el.closest('button, .chip, .meter, .panel, #log, #banner, #itemrow');
    if (box) {
      const b = box.getBoundingClientRect();
      if (full.l < b.left - 1 || full.r > b.right + 1 || full.t < b.top - 1 || full.b > b.bottom + 1) {
        issues.push({ type: 'overflow', text: t.text, where: t.where, full: rnd(full), box: rnd({ l: b.left, t: b.top, r: b.right, b: b.bottom }) });
      }
    }
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.vis.r, b.vis.r) - Math.max(a.vis.l, b.vis.l);
      const h = Math.min(a.vis.b, b.vis.b) - Math.max(a.vis.t, b.vis.t);
      if (w > 1 && h > 1) issues.push({ type: 'overlap', text: a.text + ' × ' + b.text, where: a.where + ' × ' + b.where });
    }
  }
  // 押せるものが画面の横からはみ出していないか
  for (const b of document.querySelectorAll('button, input')) {
    if (!shown(b)) continue;
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.left < -1 || r.right > vw + 1) issues.push({ type: 'offscreen', text: (b.textContent || b.id || '').trim().slice(0, 12), where: name(b) });
  }
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) issues.push({ type: 'hscroll', text: 'ページが横にはみ出している', where: de.scrollWidth + ' > ' + vw });
  probe.remove();
  return { issues, count: texts.length, minFont: texts.length ? Math.min(...texts.map((t) => t.font)) : null, vscroll: de.scrollHeight - vh };
}
"""


class Run:
    def __init__(self):
        self.issues = []  # (view, 場面, 問題)
        self.checks = 0  # 検査した回数
        self.texts = 0  # 調べた文字（のべ）
        self.min_font = None
        self.errors = []  # ページのエラー
        self.shots = []
        self.notes = []
        self.vscroll = {}
        self.cycle = {}  # 「持ち物」キーの送りの確認（view ごと）

    def check(self, page, view, scene):
        res = page.evaluate(CHECK_JS)
        self.checks += 1
        self.texts += res["count"]
        if res["minFont"] is not None:
            self.min_font = res["minFont"] if self.min_font is None else min(self.min_font, res["minFont"])
        self.vscroll[view] = max(self.vscroll.get(view, 0), res["vscroll"])
        for it in res["issues"]:
            self.issues.append({"view": view, "scene": scene, **it})
        return res

    def shot(self, page, view, scene):
        page.evaluate("window.__game && window.__game.flush()")
        page.wait_for_timeout(260)  # fx- の短い動きが終わるのを待つ
        path = OUT / f"{view}-{scene}.png"
        page.screenshot(path=str(path))
        self.shots.append(path.name)
        self.check(page, view, scene)


def open_page(browser, cfg, query, run, view):
    ctx = browser.new_context(locale="ja-JP", **cfg)
    page = ctx.new_page()
    page.on("pageerror", lambda e: run.errors.append(f"[{view}] {e}"))
    page.on("console", lambda m: run.errors.append(f"[{view}] console: {m.text}") if m.type == "error" else None)
    page.goto(f"{URL}?{query}")
    page.wait_for_function("window.__game && window.__game.state")
    return ctx, page


def scenario(browser, view, cfg, run, full=True):
    """ボットに1手ずつ進めさせて、教える場面（叩く・拾う・食べる）で止めて撮る。"""
    ctx, page = open_page(browser, cfg, "seed=1&mute=1&bg=1", run, view)
    run.shot(page, view, "01-start")
    # ボットの入力は __game.botStep()（ルール側は同じ）。画面の操作は実際のクリックで確かめる。
    seen = set()
    floor_shots = set()
    did_menu = False
    for i in range(3000):
        st = page.evaluate(
            """() => {
              const g = window.__game;
              if (g.state.over) return { over: g.state.over };
              g.botStep(); g.flush();
              const inv = g.state.player.inv;
              return { over: g.state.over, floor: g.state.floor, firsts: Object.keys(g.firsts),
                       ready: !document.getElementById('btn-attack').disabled,
                       banner: document.getElementById('banner').hidden ? '' : document.getElementById('banner').textContent,
                       inv: inv.map((it) => it.kind) };
            }"""
        )
        if st.get("ready") and "ready" not in seen:
            seen.add("ready")
            run.shot(page, view, "02-attack-ready")
        for key, scene in (("attack", "03-first-attack"), ("pickup", "04-first-pickup"), ("eat", "05-first-eat")):
            if key in st.get("firsts", []) and key not in seen:
                seen.add(key)
                run.shot(page, view, scene)
                if not st.get("banner"):
                    run.notes.append(f"[{view}] {scene}: ひとこと（バナー）が出ていない")
        if not full and {"ready", "attack"} <= seen:
            break
        if full and not did_menu and st.get("inv") and not st.get("over"):
            # 持ち物をえらぶ → むきをえらぶ → やめる（実際にクリックして確かめる）
            aimable = [k for k in st["inv"] if k in ("fire", "warp")]
            if aimable or len(st["inv"]) >= 2:
                did_menu = True
                idx = st["inv"].index(aimable[0]) if aimable else 0
                page.click(f"#inv .slot >> nth={idx}")
                run.shot(page, view, "06-item-selected")
                page.click("#btn-throw")
                run.shot(page, view, "07-aim")
                page.click("#btn-cancel")
                page.click("#btn-cancel")
                page.click("#btn-settings")
                run.shot(page, view, "08-settings")
                page.click("#btn-close-settings")
        if full and view not in run.cycle and len(st.get("inv") or []) >= 2 and not st.get("over"):
            # 「持ち物」キー（既定 I）：押すたびに次の持ち物へ。最後の次は最初。「やめる」（Esc）で外れる。
            n = len(st["inv"])
            seq = []
            for _ in range(n + 1):
                page.keyboard.press("KeyI")
                seq.append(page.evaluate("window.__game.sel"))
            page.keyboard.press("Escape")
            seq.append(page.evaluate("window.__game.sel"))
            run.cycle[view] = {"items": n, "ok": seq == list(range(n)) + [0, -1]}
            if not run.cycle[view]["ok"]:
                run.notes.append(f"[{view}] 「持ち物」キーの送りがおかしい: {seq}")
        if st.get("floor") and st["floor"] >= 3 and "floor3" not in floor_shots:
            floor_shots.add("floor3")
            run.shot(page, view, "09-floor3")
        if i % 7 == 0:
            run.check(page, view, f"step{i}")
        if st.get("over"):
            break
    if full:
        page.wait_for_selector("#end:not([hidden])", timeout=5000)
        run.shot(page, view, "10-end-" + page.evaluate("window.__game.state.over"))
        for key in ("ready", "attack", "pickup", "eat"):
            if key not in seen:
                run.notes.append(f"[{view}] 場面 {key} が起きなかった")
        if not did_menu:
            run.notes.append(f"[{view}] 持ち物メニューの場面が撮れなかった")
        if view not in run.cycle:
            run.notes.append(f"[{view}] 「持ち物」キーの送り（持ち物2個以上）を確かめる場面が来なかった")
    ctx.close()


def death_scenario(browser, view, cfg, run):
    """でたらめに動くボットで力つきる所まで進め、結果画面（死因の1行）を撮る。"""
    ctx, page = open_page(browser, cfg, "seed=5&mute=1&bg=1", run, view)
    for i in range(200):
        over = page.evaluate(
            """() => {
              const g = window.__game;
              window.__mem = window.__mem || { rng: 5 };
              for (let n = 0; n < 20 && !g.state.over; n++) { g.act(Bots.random(g.state, window.__mem)); g.flush(); }
              return g.state.over;
            }"""
        )
        run.check(page, view, f"random{i}")
        if over:
            break
    page.wait_for_selector("#end:not([hidden])", timeout=5000)
    run.shot(page, view, "11-end-" + page.evaluate("window.__game.state.over"))
    # もういちど：すぐやり直せる（連打よけの 0.5 秒だけ待つ）
    page.wait_for_timeout(600)
    page.click("#btn-retry")
    again = page.evaluate("() => ({ over: window.__game.state.over, floor: window.__game.state.floor, inv: window.__game.state.player.inv.length, end: document.getElementById('end').hidden })")
    if again != {"over": None, "floor": 1, "inv": 0, "end": True}:
        run.notes.append(f"[{view}] もういちど のあとの状態がおかしい: {again}")
    # ?seed=N の決まり（README に書いてある動き）：「もういちど」で N+1、再読込で N に戻る
    seeds = {"url": 5, "after_retry": page.evaluate("window.__game.state.seed")}
    page.reload()
    page.wait_for_function("window.__game && window.__game.state")
    seeds["after_reload"] = page.evaluate("window.__game.state.seed")
    if seeds != {"url": 5, "after_retry": 6, "after_reload": 5}:
        run.notes.append(f"[{view}] seed の動きが README と違う: {seeds}")
    ctx.close()
    return seeds


def manual_scenario(browser, view, cfg, run):
    """方向ボタン・攻撃ボタン・持ち物ボタンを、実際に押して動くかを確かめる。"""
    # ここだけ ?bg=1 なし（ふつうの描画タイミング）で開く。ふつうの遊び方でも動くことを見る。
    ctx, page = open_page(browser, cfg, "seed=1&mute=1", run, view)
    res = {}
    res["attack_disabled_at_start"] = page.evaluate("document.getElementById('btn-attack').disabled")
    # 階段への道を、方向ボタンのクリックだけで歩く。隣に敵が来たら攻撃ボタンを押す。
    pressed_attack = 0
    used_item = False
    for i in range(400):
        st = page.evaluate(
            """() => {
              const g = window.__game, s = g.state, p = s.player;
              if (s.over || s.floor > 1) return { done: true };
              const ready = !document.getElementById('btn-attack').disabled;
              const path = Sim.findPath(s, p.x, p.y, (x, y) => x === s.stairs.x && y === s.stairs.y);
              return { done: false, ready, dir: (path[0].x - p.x) + ',' + (path[0].y - p.y), inv: p.inv.map((it) => it.kind), hunger: p.hunger, turn: s.turn };
            }"""
        )
        if st["done"]:
            break
        if st["ready"]:
            page.click("#btn-attack")
            pressed_attack += 1
        elif "onigiri" in st["inv"] and not used_item:
            page.click(f"#inv .slot >> nth={st['inv'].index('onigiri')}")
            label = page.inner_text("#btn-use")
            page.click("#btn-use")
            used_item = True
            res["use_label"] = label
            res["hunger_after_eat"] = page.evaluate("window.__game.state.player.hunger")
            res["hunger_before_eat"] = st["hunger"]
        else:
            page.click(f"#dpad button[data-dir='{st['dir']}']")
        page.evaluate("window.__game.flush()")
    res["pressed_attack"] = pressed_attack
    res["used_item"] = used_item
    res["floor_after"] = page.evaluate("window.__game.state.floor")
    res["kills"] = page.evaluate("window.__game.state.stats.kills")
    # キーボード（PC）：やじるしで1歩
    before = page.evaluate("() => { const p = window.__game.state.player; return [p.x, p.y, window.__game.state.turn]; }")
    for key in ("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyS"):
        page.keyboard.press(key)
    page.evaluate("window.__game.flush()")
    after = page.evaluate("() => { const p = window.__game.state.player; return [p.x, p.y, window.__game.state.turn]; }")
    res["keyboard_turns"] = after[2] - before[2]
    ctx.close()
    return res


def keys_scenario(browser, view, cfg, run):
    """ボタン設定（キーコンフィグ）：割り当てを変えたキーで実際に操作できるか、キーが重なったときの扱い、
    保存（開き直しても残るか）、既定値に戻せるか、を実際にクリックとキー入力で確かめる。"""
    ctx, page = open_page(browser, cfg, "seed=1&mute=1", run, view)
    res = {}

    def st():
        return page.evaluate(
            """() => {
              const g = window.__game, s = g.state, p = s.player;
              return { x: p.x, y: p.y, turn: s.turn, hunger: p.hunger, floor: s.floor, over: s.over, kills: s.stats.kills,
                       ehp: s.enemies.reduce((a, e) => a + e.hp, 0), inv: p.inv.map((it) => it.kind),
                       sel: g.sel, aim: !!g.aim, ready: !document.getElementById('btn-attack').disabled };
            }"""
        )

    def keymap():
        return page.evaluate("window.__game.keys.map")

    def listening():
        return page.evaluate("window.__game.keyListening")

    def press(code):
        page.keyboard.press(code)
        page.evaluate("window.__game.flush()")

    def msg():
        return page.inner_text("#key-msg")

    def cell(action):
        return f"#keycfg .key-cell[data-action='{action}']"

    def rebind(action, code):
        page.click(cell(action))
        page.keyboard.press(code)

    def cell_text(action):
        return page.inner_text(cell(action) + " .key-keys").replace("\n", " ")

    def pos(s):
        return (s["x"], s["y"], s["turn"])

    # 最初の場所から歩ける向きを1つえらぶ（その向きのキーを変えて、実際に歩けるかを見る）
    walk = page.evaluate(
        """() => {
          const s = window.__game.state, p = s.player;
          for (const a of Keys.ACTIONS) {
            if (!a.dir) continue;
            const x = p.x + a.dir[0], y = p.y + a.dir[1];
            if (!Sim.isWall(s, x, y) && !Sim.enemyAt(s, x, y) && !Sim.itemAt(s, x, y) && !(x === s.stairs.x && y === s.stairs.y)) {
              return { id: a.id, dx: a.dir[0], dy: a.dir[1], old: Keys.DEFAULTS[a.id] };
            }
          }
          return null;
        }"""
    )
    if not walk:
        run.notes.append(f"[{view}] ボタン設定：最初の場所から歩ける向きが無い")
        ctx.close()
        return res
    A = walk["id"]
    res["walk_action"] = A
    defaults = page.evaluate("Keys.defaults().map")
    res["starts_default"] = keymap() == defaults
    # 持ち物が無いときに「持ち物」キー（既定 I）を押すと、1行で知らせる（何もえらばれない）
    press("KeyI")
    res["item_key_says_empty"] = "からっぽ" in page.inner_text("#log") and st()["sel"] == -1 and st()["turn"] == 0

    # ---- せってい → ボタン設定 ----
    page.click("#btn-settings")
    page.click("#btn-keycfg")
    res["cells"] = page.locator("#keycfg .key-cell").count()
    run.shot(page, view, "12-keycfg")
    page.click(cell(A))
    res["listening"] = listening() == A
    run.shot(page, view, "13-keycfg-listen")
    # 割り当てられないキー（Shift）は断られ、まだキーを待っている。Tab は「やめる」扱い。
    page.keyboard.press("ShiftLeft")
    res["reserved_refused"] = "使えない" in msg() and listening() == A and keymap() == defaults
    page.keyboard.press("Tab")
    res["tab_cancels"] = listening() is None and keymap() == defaults
    # 同じボタンをもう一度えらぶと、やめる
    page.click(cell(A))
    page.click(cell(A))
    res["click_again_cancels"] = listening() is None and keymap() == defaults
    # ボタン設定の中は、キーボードだけでも動かせる（ボタンに移って Enter → キーを待つ。その Enter は割り当てにならない）
    page.focus(cell(A))
    page.keyboard.press("Enter")
    res["enter_on_cell_starts_listening"] = listening() == A and keymap() == defaults
    page.keyboard.press("Tab")

    # 1) 重ならないキーに変える
    rebind(A, "KeyP")
    res["assign_plain"] = keymap()[A] == ["KeyP"] and cell_text(A) == "P" and "かえた" in msg()
    # 2) 重なるキー（スペース＝こうげき）を「待つ」に：こうげきからスペースだけ外れ、F は残る
    rebind("wait", "Space")
    m = keymap()
    res["collision_moves_key"] = m["wait"] == ["Space"] and m["attack"] == ["KeyF"] and "うつした" in msg()
    rebind("attack", "KeyG")
    rebind("item", "KeyU")
    rebind("use", "KeyO")
    # 3) 重なるキー（T＝「投げる」のただ1つのキー）を「やめる」に：投げるは「なし」になる
    rebind("cancel", "KeyT")
    m = keymap()
    res["collision_empties"] = m["cancel"] == ["KeyT"] and m["throw"] == [] and cell_text("throw") == "なし" and "なくなった" in msg()
    res["none_marked"] = page.evaluate("(sel) => document.querySelector(sel).classList.contains('none')", cell("throw"))
    run.shot(page, view, "14-keycfg-changed")
    rebind("throw", "KeyY")
    custom = keymap()
    codes = [c for v in custom.values() for c in v]
    res["no_duplicate_keys"] = len(codes) == len(set(codes))
    res["saved"] = page.evaluate("JSON.parse(localStorage.getItem('futsuu-settings')).keys.map") == custom
    # 「やめる」に決めたキー（T）で、ボタン設定 → せってい → ゲーム と閉じられる
    page.keyboard.press("KeyT")
    res["cancel_key_closes_keycfg"] = page.evaluate("document.getElementById('keycfg').hidden && !document.getElementById('settings').hidden")
    page.keyboard.press("KeyT")
    res["cancel_key_closes_settings"] = page.evaluate("document.getElementById('settings').hidden")

    # ---- 変えたキーで実際に操作する ----
    b = st()
    for old in walk["old"]:
        press(old)
    res["old_move_keys_off"] = pos(st()) == pos(b)
    press("KeyP")
    a = st()
    res["new_move_key_works"] = pos(a) == (b["x"] + walk["dx"], b["y"] + walk["dy"], b["turn"] + 1)
    b = a
    for old in ("KeyS", "Numpad5", "Period"):
        press(old)
    res["old_wait_keys_off"] = st()["turn"] == b["turn"]
    press("Space")
    a = st()
    res["new_wait_key_works"] = pos(a) == (b["x"], b["y"], b["turn"] + 1) and a["kills"] == b["kills"]

    # 1フロア目を、いまの割り当てのキーだけで歩く（変えた向きは P、ほかの向きは既定のキー）。
    # 隣に敵が来たら「こうげき」に決めたキー（G）。おにぎりを拾ったら 持ち物(U)→投げる(Y)→やめる(T)→使う(O)。
    did_attack = did_item = False
    for i in range(400):
        s0 = st()
        if s0["over"] or s0["floor"] > 1:
            break
        if s0["ready"]:
            if not did_attack:
                did_attack = True
                press("KeyF")  # 前の「こうげき」キー（もう割り当てが無い）
                s1 = st()
                res["old_attack_key_off"] = (s1["turn"], s1["ehp"], s1["kills"]) == (s0["turn"], s0["ehp"], s0["kills"])
                press("KeyG")
                s1 = st()
                res["new_attack_key_works"] = s1["turn"] == s0["turn"] + 1 and (s1["ehp"] < s0["ehp"] or s1["kills"] > s0["kills"])
            else:
                press("KeyG")
            continue
        if "onigiri" in s0["inv"] and not did_item:
            did_item = True
            press("KeyI")  # 前の「持ち物」キー
            res["old_item_key_off"] = st()["sel"] == -1
            press("KeyU")
            res["new_item_key_selects"] = st()["sel"] == 0
            press("KeyY")
            res["new_throw_key_aims"] = st()["aim"] is True
            press("KeyT")
            s1 = st()
            res["new_cancel_key_works"] = s1["aim"] is False and s1["sel"] == 0 and s1["turn"] == s0["turn"]
            press("Enter")  # 前の「使う」キー
            res["old_use_key_off"] = st()["hunger"] == s0["hunger"]
            press("KeyO")
            s1 = st()
            res["new_use_key_works"] = s1["hunger"] > s0["hunger"] and "onigiri" not in s1["inv"] and s1["turn"] == s0["turn"] + 1
            continue
        key = page.evaluate(
            """() => {
              const g = window.__game, s = g.state, p = s.player;
              const path = Sim.findPath(s, p.x, p.y, (x, y) => x === s.stairs.x && y === s.stairs.y);
              const dx = path[0].x - p.x, dy = path[0].y - p.y;
              const a = Keys.ACTIONS.find((a) => a.dir && a.dir[0] === dx && a.dir[1] === dy);
              return g.keys.map[a.id][0];
            }"""
        )
        press(key)
    res["walked_floor1_by_keys"] = st()["floor"] == 2
    for key in ("old_attack_key_off", "new_attack_key_works", "old_item_key_off", "new_item_key_selects", "new_throw_key_aims", "new_cancel_key_works", "old_use_key_off", "new_use_key_works"):
        res.setdefault(key, False)  # その場面が起きなかったら、確かめられていない＝失敗として数える

    # ---- 保存：開き直しても、変えた割り当てのまま ----
    page.reload()
    page.wait_for_function("window.__game && window.__game.state")
    res["kept_after_reload"] = keymap() == custom
    b = st()
    press("KeyP")
    res["new_key_works_after_reload"] = pos(st()) == (b["x"] + walk["dx"], b["y"] + walk["dy"], b["turn"] + 1)

    # 結果の画面：「こうげき」に決めたキー（G）で「もういちど」
    for i in range(200):
        over = page.evaluate(
            """() => {
              const g = window.__game;
              window.__mem = window.__mem || { rng: 5 };
              for (let n = 0; n < 20 && !g.state.over; n++) { g.act(Bots.random(g.state, window.__mem)); g.flush(); }
              return g.state.over;
            }"""
        )
        if over:
            break
    page.wait_for_selector("#end:not([hidden])", timeout=5000)
    page.wait_for_timeout(600)
    page.keyboard.press("KeyG")
    res["attack_key_retries"] = page.evaluate("document.getElementById('end').hidden && !window.__game.state.over && window.__game.state.turn === 0")

    # ---- 既定値に戻す（2回押して決める） ----
    page.reload()  # 「もういちど」で地図が変わったので、最初の地図（seed=1）に戻してから確かめる
    page.wait_for_function("window.__game && window.__game.state")
    page.click("#btn-settings")
    page.click("#btn-keycfg")
    page.click("#btn-key-reset")
    res["reset_asks_first"] = keymap() == custom and "もういちど" in page.inner_text("#btn-key-reset")
    run.shot(page, view, "15-keycfg-reset-ask")
    page.click(cell(A))  # ほかのことをしたら、「もどす」は取り消される
    page.click(cell(A))
    res["reset_disarms"] = keymap() == custom and "もういちど" not in page.inner_text("#btn-key-reset")
    page.click("#btn-key-reset")
    page.click("#btn-key-reset")
    res["reset_restores_defaults"] = keymap() == defaults and "もどした" in msg()
    res["reset_saved"] = page.evaluate("JSON.parse(localStorage.getItem('futsuu-settings')).keys.map") == defaults
    run.shot(page, view, "16-keycfg-reset-done")
    page.click("#btn-close-keycfg")
    page.click("#btn-close-settings")
    b = st()
    press("KeyP")
    res["custom_key_off_after_reset"] = st()["turn"] == b["turn"]
    press(walk["old"][0])
    res["default_key_works_after_reset"] = pos(st()) == (b["x"] + walk["dx"], b["y"] + walk["dy"], b["turn"] + 1)
    page.reload()
    page.wait_for_function("window.__game && window.__game.state")
    res["default_after_reload"] = keymap() == defaults

    for key, val in res.items():
        if val is False:
            run.notes.append(f"[{view}] ボタン設定の確認に失敗: {key}")
    if res.get("cells") != 14:
        run.notes.append(f"[{view}] ボタン設定：操作のボタンが14個ない（{res.get('cells')}）")
    ctx.close()
    return res


def auto_run(browser, view, cfg, run):
    """?auto=1 の自動プレイを、手を出さずに最後まで見る。途中で何度も文字を検査する。"""
    ctx, page = open_page(browser, cfg, "auto=1&bg=1&seed=3", run, view)
    info = {"ended": None, "samples": 0}
    for i in range(400):
        page.wait_for_timeout(400)
        run.check(page, view, f"auto{i}")
        info["samples"] += 1
        if i == 12:
            page.screenshot(path=str(OUT / f"{view}-20-auto-mid.png"))
            run.shots.append(f"{view}-20-auto-mid.png")
        over = page.evaluate("window.__game.state.over")
        if over:
            info["ended"] = over
            break
    info["floor"] = page.evaluate("window.__game.state.floor")
    info["turns"] = page.evaluate("window.__game.state.turn")
    info["audio_started"] = page.evaluate("Sfx.started()")
    info["muted"] = page.evaluate("Sfx.isMuted()")
    ctx.close()
    return info


def sound_check(browser, cfg, run):
    """音：?mute=1 では操作しても音の仕組みが起動しない。通常は最初の操作で起動する。"""
    out = {}
    for label, query in (("mute", "seed=1&mute=1"), ("normal", "seed=1")):
        ctx, page = open_page(browser, cfg, query, run, "pc")
        page.click("#dpad button.center")
        page.keyboard.press("KeyS")
        page.wait_for_timeout(200)
        out[label] = {"started": page.evaluate("Sfx.started()"), "muted": page.evaluate("Sfx.isMuted()"), "volume": page.evaluate("Sfx.getVolume()")}
        ctx.close()
    return out


def self_test(browser, cfg, run):
    """検査そのものの確認：わざと悪い文字を置いて、見つけられるか。隠した文字は数えないか。"""
    ctx, page = open_page(browser, cfg, "seed=1&mute=1&bg=1", run, "selftest")
    base = page.evaluate(CHECK_JS)
    page.evaluate(
        """() => {
          const add = (html) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d.firstElementChild); };
          // 見つけるべきもの
          add('<div id="t-small" style="position:fixed;left:300px;top:600px;font-size:10px">ちいさい文字</div>');
          add('<div id="t-over" style="position:fixed;left:' + (document.getElementById('hp-num').getBoundingClientRect().left) + 'px;top:' + (document.getElementById('hp-num').getBoundingClientRect().top) + 'px;font-size:16px">かさなり</div>');
          add('<button id="t-flow" style="position:fixed;left:20px;top:660px;width:40px;height:24px;padding:0;white-space:nowrap;font-size:16px">はみだすボタンの文字</button>');
          add('<div id="t-clip" style="position:fixed;left:20px;top:700px;width:40px;overflow:hidden;white-space:nowrap;font-size:16px">きれている文字です</div>');
          // 数えてはいけないもの（見えていない）
          add('<div id="t-hide1" style="display:none;font-size:8px">かくれ1</div>');
          add('<div id="t-hide2" style="position:fixed;left:0;top:0;visibility:hidden;font-size:8px">かくれ2</div>');
          add('<div id="t-hide3" style="position:fixed;left:0;top:0;opacity:0;font-size:8px">かくれ3</div>');
          add('<div id="t-hide4" style="position:fixed;left:0;top:3000px;font-size:8px">がめんのそと</div>');
        }"""
    )
    res = page.evaluate(CHECK_JS)
    found = {(it["type"], it["where"].split(" ")[0]) for it in res["issues"]}
    hidden_counted = [it for it in res["issues"] if "かくれ" in it["text"] or "がめんのそと" in it["text"]]
    out = {
        "before_issues": len(base["issues"]),
        "finds_small": ("small", "#t-small") in found,
        "finds_overlap": any(it["type"] == "overlap" and "かさなり" in it["text"] for it in res["issues"]),
        "finds_overflow": ("overflow", "#t-flow") in found,
        "finds_clipped": ("clipped", "#t-clip") in found,
        "ignores_hidden": len(hidden_counted) == 0,
    }
    out["ok"] = out["before_issues"] == 0 and all(v for k, v in out.items() if k != "before_issues")
    ctx.close()
    return out


def main():
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()
    run = Run()
    result = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for view in ("pc", "sp"):
            scenario(browser, view, VIEWS[view], run, full=True)
            result.setdefault("seed", {})[view] = death_scenario(browser, view, VIEWS[view], run)
        scenario(browser, "sp-small", VIEWS["sp-small"], run, full=False)
        result["manual"] = {view: manual_scenario(browser, view, VIEWS[view], run) for view in ("pc", "sp")}
        result["keys"] = {view: keys_scenario(browser, view, VIEWS[view], run) for view in ("pc", "sp", "sp-small")}
        result["auto"] = {view: auto_run(browser, view, VIEWS[view], run) for view in ("pc", "sp")}
        result["sound"] = sound_check(browser, VIEWS["pc"], run)
        result["selftest"] = self_test(browser, VIEWS["sp"], run)
        if not result["selftest"]["ok"]:
            run.notes.append("検査の自己確認に失敗: " + json.dumps(result["selftest"], ensure_ascii=False))
        result["tile"] = {}
        for view in VIEWS:
            ctx, page = open_page(browser, VIEWS[view], "seed=1&mute=1", run, view)
            result["tile"][view] = page.evaluate("window.__game.tile")
            ctx.close()
        browser.close()

    # 同じ問題が何度も出るので、まとめて数える
    grouped = {}
    for it in run.issues:
        key = (it["view"], it["type"], it["where"], it["text"])
        g = grouped.setdefault(key, {"view": it["view"], "type": it["type"], "where": it["where"], "text": it["text"], "times": 0, "first_scene": it["scene"]})
        g["times"] += 1
    result.update(
        {
            "checks": run.checks,
            "texts": run.texts,
            "min_font_px": run.min_font,
            "issues": list(grouped.values()),
            "page_errors": sorted(set(run.errors)),
            "notes": run.notes,
            "shots": run.shots,
            "vscroll_px": run.vscroll,
            "item_cycle": run.cycle,
        }
    )
    (OUT / "check.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"スクリーンショット {len(run.shots)} 枚 → {OUT}")
    print(f"文字の検査 {run.checks} 回（調べた文字 のべ {run.texts} 個、いちばん小さい文字 {run.min_font}px）")
    print(f"問題 {len(grouped)} 種類（のべ {len(run.issues)} 件）")
    for g in grouped.values():
        print(f"  [{g['view']}] {g['type']}: {g['text']} @ {g['where']} ×{g['times']}（最初: {g['first_scene']}）")
    print(f"ページのエラー {len(result['page_errors'])} 件")
    for e in result["page_errors"]:
        print("  " + e)
    for n in run.notes:
        print("  注: " + n)
    print("縦のはみ出し(px):", json.dumps(run.vscroll, ensure_ascii=False))
    print("1マスの大きさ(px):", json.dumps(result["tile"], ensure_ascii=False))
    print("実際に押して確かめた結果:", json.dumps(result["manual"], ensure_ascii=False))
    # ボタン設定は項目が多いので、数だけ出す（1つずつの結果は check.json の keys にある）
    for view, res in result["keys"].items():
        flags = {k: v for k, v in res.items() if isinstance(v, bool)}
        ng = [k for k, v in flags.items() if not v]
        print(f"ボタン設定（キーコンフィグ）を実際に押して確かめた結果 [{view}]: {len(flags) - len(ng)}/{len(flags)} 項目合格" + (f"　失敗: {ng}" if ng else ""))
    print("「持ち物」キーの送り（次へ→最後の次は最初→やめる）:", json.dumps(run.cycle, ensure_ascii=False))
    print("seed（?seed=5 → もういちど → 再読込）:", json.dumps(result["seed"], ensure_ascii=False))
    print("自動プレイ:", json.dumps(result["auto"], ensure_ascii=False))
    print("音:", json.dumps(result["sound"], ensure_ascii=False))
    print("検査の自己確認（わざと置いた悪い文字を見つけられるか）:", json.dumps(result["selftest"], ensure_ascii=False))
    bad = bool(grouped) or bool(result["page_errors"]) or bool(run.notes)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
