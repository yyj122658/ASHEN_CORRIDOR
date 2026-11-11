'use strict';
/* 应用外壳：状态、唯一操作入口、渲染、战斗循环、存档与音效。 */
(function (A) {
  'use strict';

  const KEY = A.Storage.KEY_V2;
  const DELAY = { 1: 320, 2: 170, 3: 90 };

  const App = {
    state: null,
    ui: {
      screen: 'title',
      hadSave: false,
      filter: { slot: 'all', minQuality: 0, locked: 'all', sort: 'quality' },
      selectedItem: null,
      compareUnit: null,
      modal: null,
      modalUnit: null,
      swapLootId: null,
      speed: 1,
      paused: false,
      lastScreen: null,
    },
    _timer: null,
    _saveAt: 0,
    _raf: null,
  };

  /* ---------- 音效 ---------- */
  const Sfx = {
    ctx: null,
    init() {
      if (this.ctx) return;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) this.ctx = new Ctx();
      } catch (e) { this.ctx = null; }
    },
    play(kind) {
      if (!A.App.state || !A.App.state.settings.sound) return;
      this.init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const vol = (A.App.state.settings.volume || 0.3) * 0.25;
      o.connect(g); g.connect(this.ctx.destination);
      const table = {
        click: [440, 0.04, 'square'],
        hit: [220, 0.06, 'square'],
        crit: [660, 0.09, 'sawtooth'],
        loot: [880, 0.10, 'triangle'],
        win: [523, 0.16, 'triangle'],
        lose: [110, 0.24, 'sine'],
      };
      const [freq, dur, type] = table[kind] || table.click;
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (kind === 'win') o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
      if (kind === 'lose') o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    },
  };

  /* ---------- 初始化 ---------- */
  function boot() {
    const storage = safeStorage();
    const r = A.Storage.load(storage);

    if (r.status === 'corrupt') {
      App.state = starterGear(A.State.create());
      App.ui.hadSave = false;
      toast('存档损坏，已保留原档并开始新游戏。可在设置里导入备份。');
    } else if (r.status === 'new') {
      App.state = starterGear(A.State.create());
      App.ui.hadSave = false;
    } else {
      App.state = r.state;
      App.ui.hadSave = true;
    }

    // 商店缺失时补一次（不扣钱）
    if (!App.state.shop || !App.state.shop.length) {
      const sr = A.Roster.refreshShop(App.state, false);
      if (sr.ok) App.state = sr.state;
    }

    if (App.state.run && App.state.run.stage === 'battle' && App.state.run.battle && !App.state.run.battle.over) {
      App.ui.hadSave = true;
    }
    App.ui.screen = 'title';
    render();
    bindGlobal();
    loop();

    // 首屏只预加载必要资源：营地场景 + 当前队伍肖像（战斗背景进入远征时再加载）
    const ids = ['scene.camp'];
    App.state.roster.slice(0, 4).forEach((u) => ids.push('portrait.' + u.cls));
    A.Art.preloadArt([...new Set(ids)]).then((r) => {
      if (r.loaded.length) {
        App.ui.lastScreen = null; // 强制重建，让图片进入 DOM
        render();
      }
    });
  }

  function starterGear(state) {
    let s = state;
    for (let i = 0; i < 3; i++) {
      const r = A.Equipment.makeItem(s, { ilvl: 1, bias: 0 });
      s = r.state;
      s.itemsById[r.item.id] = r.item;
      s.stash.push(r.item.id);
    }
    return s;
  }

  function safeStorage() {
    try {
      const probe = '__ashen_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (e) {
      // localStorage 不可用：退化为内存存储
      const mem = {};
      return {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; },
        __memory: true,
      };
    }
  }

  /* ---------- 持久化 ---------- */
  function persist(force) {
    const now = Date.now();
    if (!force && now - App._saveAt < 800) return;
    App._saveAt = now;
    const r = A.Storage.save(safeStorage(), App.state);
    if (!r.ok) toast('保存失败：' + r.error);
  }

  /* ---------- 渲染 ---------- */
  const stage = () => document.getElementById('stage');
  const hudEl = () => document.getElementById('hud');
  const navEl = () => document.getElementById('nav');
  const logEl = () => document.getElementById('logs');

  function render() {
    const state = App.state, ui = App.ui;
    const isTitle = ui.screen === 'title';
    const inRunScreens = ['map', 'loot', 'blessing', 'event', 'battle', 'result'];

    if (hudEl()) hudEl().style.display = isTitle ? 'none' : '';
    if (logEl()) logEl().style.display = isTitle ? 'none' : '';
    if (hudEl() && !isTitle) hudEl().innerHTML = A.UI.hud(state, ui);

    if (navEl()) {
      const showNav = ['camp', 'team', 'recruit', 'stash', 'altar'].includes(ui.screen);
      navEl().style.display = showNav ? '' : 'none';
      if (showNav) navEl().innerHTML = A.UI.nav(state, ui);
    }

    if (!stage()) return;

    const rebuild = ui.lastScreen !== ui.screen || ui.screen !== 'battle';
    if (rebuild) {
      stage().innerHTML = A.UI.render(state, ui);
      ui.lastScreen = ui.screen;
      if (ui.screen === 'battle') {
        A.BattleView.mount(state);
        A.BattleView.renderFrame(state, performance.now());
        A.BattleView.updateHud(state);
        ensureBattleArt(state);
      }
    } else {
      A.BattleView.updateHud(state);
    }

    renderLogs();
  }

  /** 战场背景兜底：没加载就补一次，任何进入路径都成立。 */
  function ensureBattleArt(state) {
    const b = state.run && state.run.battle;
    if (!b) return;
    const id = b.kind === 'boss' ? 'scene.boss' : 'scene.corridor';
    if (!A.Art.isReady(id)) {
      A.Art.preloadArt([id]).then(() => {
        if (App.ui.screen === 'battle') A.BattleView.renderFrame(App.state, performance.now());
      });
    }
    if (b.kind === 'boss') A.Art.preloadArt(['enemy.gatekeeper', 'enemy.memoryEater']);
  }

  function renderLogs() {
    if (!logEl()) return;
    const logs = App.state.logs.slice(0, 6);
    logEl().innerHTML = logs.map((l) => `<div class="ln ${l.kind || ''}">${A.Art.safeText(l.msg)}</div>`).join('');
  }

  function toast(msg) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  /* ---------- 屏幕同步 ---------- */
  function syncScreen() {
    const s = App.state, ui = App.ui;
    if (s.settlement && !s.run) { ui.screen = 'result'; return; }
    if (!s.run) {
      if (['map', 'loot', 'blessing', 'event', 'battle', 'result'].includes(ui.screen)) ui.screen = 'camp';
      return;
    }
    const map = { map: 'map', event: 'event', loot: 'loot', blessing: 'blessing', battle: 'battle' };
    if (map[s.run.stage]) ui.screen = map[s.run.stage];
  }

  /* ---------- 操作 ---------- */
  function dispatch(action) {
    Sfx.init();
    const ui = App.ui;
    let res = null;

    switch (action.type) {
      case 'titleStart':
        ui.hadSave = true;
        ui.screen = 'camp';
        persist(true);
        render();
        Sfx.play('click');
        return;

      case 'go':
        ui.screen = action.v;
        ui.modal = null;
        render();
        return;

      case 'openSettings': ui.modal = 'settings'; render(); return;
      case 'closeModal': ui.modal = null; ui.modalUnit = null; ui.swapLootId = null; render(); return;

      case 'toggleSound':
        res = setSetting('sound', !App.state.settings.sound);
        break;
      case 'toggleMotion':
        res = setSetting('reducedMotion', !App.state.settings.reducedMotion);
        break;
      case 'setVolume':
        res = setSetting('volume', Math.max(0, Math.min(1, Number(action.value) / 100)));
        break;

      case 'cycleSpeed':
        ui.speed = ui.speed === 1 ? 2 : ui.speed === 2 ? 3 : 1;
        render();
        return;

      case 'togglePause':
        ui.paused = !ui.paused;
        render();
        if (!ui.paused) startLoop();
        return;

      case 'setTactic': {
        const b = App.state.run && App.state.run.battle;
        if (!b) return;
        const next = b.tactic === 'balance' ? 'focus' : b.tactic === 'focus' ? 'safe' : 'balance';
        res = A.Combat.setTactic(App.state, next);
        break;
      }

      case 'startRun':
        res = A.Expedition.start(App.state, { difficulty: App.state.difficulty });
        if (res.ok) {
          ui.paused = false;
          // 远征开始后才加载两张战场图（约 5MB），避免拖慢首屏
          A.Art.preloadArt(['scene.corridor', 'scene.boss']).then(() => {
            if (App.ui.screen === 'battle') A.BattleView.renderFrame(App.state, performance.now());
          });
          // 逐帧动画：剑士必用，骸骨兵按需（图集共约 15MB，本地加载）
          A.SpriteAnim.preload(['blade', 'bone']).then(() => {
            if (App.ui.screen === 'battle') A.BattleView.renderFrame(App.state, performance.now());
          });
        }
        break;

      case 'enterNode': {
        res = A.Expedition.enterNode(App.state, action.id);
        const nodeType = res.ok ? (res.state.run.nodes.find((n) => n.id === action.id) || {}).type : null;
        if (nodeType === 'boss') A.Art.preloadArt(['enemy.gatekeeper', 'enemy.memoryEater']);
        if (res.ok && res.state.run.stage === 'battle' && !res.state.run.battle) {
          const kind = (res.state.run.nodes.find((n) => n.id === action.id) || {}).type || 'battle';
          const cr = A.Combat.create(res.state, kind);
          if (cr.ok) res = cr;
        }
        break;
      }

      case 'combatStep':
        res = A.Combat.step(App.state);
        if (res.ok) {
          App.state = res.state;
          const b = App.state.run.battle;
          A.BattleView.updateHud(App.state);
          persist(false);
          if (b.over) {
            Sfx.play(b.win ? 'win' : 'lose');
            render();
            return;
          }
          return;
        }
        return;

      case 'continueBattle': {
        res = A.Combat.continue(App.state);
        if (res.ok && res.events.some((e) => e.type === 'needWipe')) {
          res = A.Expedition.wipe(App.state);
        }
        if (res.ok) Sfx.play('loot');
        break;
      }

      case 'flee':
        if (App.state.run && App.state.run.battle && !App.state.run.battle.over) {
          const p = A.Expedition.previewSettlement(App.state, 'flee');
          if (!confirm(`现在脱离战斗？\n\n保留 ${p.itemCount} 件物品、${p.gold} 金币、${p.shards} 遗物。\n损失 ${p.lostCount} 件物品。`)) return;
        }
        res = A.Expedition.extract(App.state, 'flee');
        break;

      case 'extract': {
        const p = A.Expedition.previewSettlement(App.state, 'extract');
        if (!confirm(`带着东西撤离？\n\n带回 ${p.itemCount} 件物品、${p.gold} 金币、${p.shards} 遗物。\n完成 ${p.completedFloors} 层。`)) return;
        res = A.Expedition.extract(App.state, 'extract');
        break;
      }

      case 'chooseEvent': {
        res = A.Expedition.chooseEvent(App.state, action.id);
        // 事件里触发的战斗：立即创建战场，并把开场文本写进战斗日志
        if (res.ok && res.state.run.stage === 'battle' && !res.state.run.battle) {
          const kind = (res.state.run.event && res.state.run.event.pendingCombat) || 'normal';
          const cr = A.Combat.create(res.state, kind);
          if (cr.ok) {
            res = cr;
            const b = res.state.run.battle;
            const ev = res.state.run.event;
            if (ev && ev.resultText) {
              b.logSeq = (b.logSeq || 0) + 1;
              b.logs.push({ seq: b.logSeq, type: 'note', meta: { text: ev.resultText } });
            }
            ui.paused = false;
          }
        }
        break;
      }

      case 'finishNode':
        res = A.Expedition.finishNode(App.state);
        break;

      case 'chooseBlessing':
        res = A.Expedition.chooseBlessing(App.state, action.id);
        break;

      case 'buy': {
        const r = App.state.run;
        const full = r && r.bag.length >= App.state.bagCap;
        res = A.Expedition.buy(App.state, action.id, {});
        if (!res.ok && res.error.code === 'BAG_FULL') {
          ui.swapLootId = action.id;
          ui.modal = 'swapTarget';
          render();
          return;
        }
        break;
      }

      case 'merchantHeal':
        res = A.Expedition.merchantHeal(App.state);
        break;

      case 'lootAccept':
        res = A.Expedition.resolveLoot(App.state, action.id, { action: 'accept' });
        if (!res.ok && res.error.code === 'BAG_FULL') {
          ui.swapLootId = action.id;
          ui.modal = 'swapTarget';
          render();
          return;
        }
        break;

      case 'lootDiscard':
        res = A.Expedition.resolveLoot(App.state, action.id, { action: 'discard' });
        break;

      case 'lootSwapTarget':
        ui.swapLootId = App.state.run.pendingLoot[0];
        ui.modal = 'swapTarget';
        render();
        return;

      case 'lootSwapConfirm': {
        const lootId = ui.swapLootId;
        ui.modal = null;
        if (!lootId) return;
        const isMerchant = App.state.run.event && App.state.run.event.kind === 'merchant';
        res = isMerchant
          ? A.Expedition.buy(App.state, lootId, { replaceId: action.id })
          : A.Expedition.resolveLoot(App.state, lootId, { action: 'replace', replaceId: action.id });
        break;
      }

      case 'teamAdd': {
        const idx = App.state.team.findIndex((x) => x == null);
        if (idx < 0) { toast('队伍已满'); return; }
        res = A.Roster.setTeamSlot(App.state, action.id, idx);
        break;
      }
      case 'teamRemove':
        res = A.Roster.removeFromTeam(App.state, action.id);
        break;
      case 'moveSlot':
        res = A.Roster.move(App.state, action.id, Number(action.k));
        break;
      case 'swapRow': {
        const cur = App.state.team.indexOf(action.id);
        if (cur < 0) return;
        const target = cur < 2 ? cur + 2 : cur - 2;
        res = A.Roster.move(App.state, action.id, target);
        break;
      }
      case 'gotoEquip':
        ui.modal = 'inspect';
        ui.modalUnit = action.id;
        render();
        return;

      case 'recruit':
        res = A.Roster.recruit(App.state, App.state.shop[action.i] && App.state.shop[action.i].offerId);
        break;
      case 'refreshShop':
        res = A.Roster.refreshShop(App.state, true);
        break;
      case 'comfort':
        res = A.Roster.comfort(App.state, action.id);
        break;
      case 'upgrade':
        res = A.Roster.upgrade(App.state, action.k);
        break;

      case 'equipItem':
        res = A.Equipment.equip(App.state, ui.modalUnit || ui.compareUnit, action.id);
        break;
      case 'unequip':
        res = A.Equipment.unequip(App.state, ui.modalUnit, action.k);
        break;
      case 'toggleLock':
        res = A.Equipment.toggleLock(App.state, action.id);
        break;
      case 'sellOne':
        res = A.Equipment.sell(App.state, [action.id]);
        break;
      case 'sellFiltered': {
        const items = A.Equipment.filter(App.state, ui.filter).filter((it) => !it.locked);
        if (!items.length) { toast('筛选结果里没有可出售的装备'); return; }
        const total = items.reduce((a, it) => a + A.Equipment.sellValue(it), 0);
        if (!confirm(`卖出 ${items.length} 件装备，共 ${total} 金币？`)) return;
        res = A.Equipment.sell(App.state, items.map((it) => it.id));
        break;
      }
      case 'selectItem':
        ui.selectedItem = action.id;
        render();
        return;

      case 'setDifficulty': {
        const next = A.State.clone(App.state);
        next.difficulty = action.id;
        res = { ok: true, state: next, events: [] };
        break;
      }

      case 'closeResult':
        App.state.settlement = null;
        App.ui.screen = 'camp';
        persist(true);
        render();
        return;

      case 'starUp':
        res = A.Roster.starUp(App.state, action.id, action.k);
        break;
      case 'dismiss':
        if (!confirm('遣散这名角色？装备会退回仓库。')) return;
        res = A.Roster.dismiss(App.state, action.id);
        break;

      case 'exportSave':
        exportSave();
        return;

      case 'importSave':
        importSave();
        return;

      case 'reset': {
        if (!confirm('确定抹去所有存档？\n\n所有角色、装备、金币与进度都会消失，无法恢复。')) return;
        A.Storage.clearAll(safeStorage());
        App.state = starterGear(A.State.create());
        App.ui.hadSave = false;
        App.ui.screen = 'title';
        render();
        return;
      }

      case 'toggleSoundFx':
        return;

      default:
        return;
    }

    if (!res) return;
    if (!res.ok) {
      toast((res.error && res.error.message) || '操作失败');
      return;
    }

    App.state = res.state;
    syncScreen();
    persist();
    render();
    Sfx.play(action.type === 'sellOne' || action.type === 'sellFiltered' ? 'loot' : 'click');

    if (App.ui.screen === 'battle' && !App.ui.paused) startLoop();
  }

  function setSetting(key, value) {
    const st = A.State.clone(App.state);
    st.settings[key] = value;
    return { ok: true, state: st, events: [] };
  }

  /* ---------- 战斗循环 ---------- */
  function startLoop() {
    stopLoop();
    const b = App.state.run && App.state.run.battle;
    if (!b || b.over || App.ui.paused || App.ui.screen !== 'battle') return;

    App._timer = setTimeout(() => {
      const res = A.Combat.step(App.state);
      if (res.ok) {
        App.state = res.state;
        const nb = App.state.run.battle;
        A.BattleView.updateHud(App.state);
        if (nb && nb.over) {
          persist(true);
          render();
          Sfx.play(nb.win ? 'win' : 'lose');
          return;
        }
        persist(false);
      }
      startLoop();
    }, DELAY[App.ui.speed] || 320);
  }

  function stopLoop() {
    if (App._timer) { clearTimeout(App._timer); App._timer = null; }
  }

  function loop() {
    const tick = (now) => {
      if (App.ui.screen === 'battle') {
        A.BattleView.renderFrame(App.state, now);
      }
      App._raf = requestAnimationFrame(tick);
    };
    App._raf = requestAnimationFrame(tick);
  }

  /* ---------- 输入 ---------- */

  function bindGlobal() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act;

      if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return;

      // 弹层遮罩点击关闭
      if (el.classList.contains('modal-back') && e.target !== el) return;

      dispatch({
        type: act,
        id: el.dataset.id,
        k: el.dataset.k,
        i: el.dataset.i != null ? Number(el.dataset.i) : null,
        v: el.dataset.v,
      });
    });

    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act;
      const ui = App.ui;

      if (act === 'filterSlot') { ui.filter.slot = el.value; render(); }
      else if (act === 'filterQuality') { ui.filter.minQuality = Number(el.value); render(); }
      else if (act === 'filterLocked') { ui.filter.locked = el.value; render(); }
      else if (act === 'filterSort') { ui.filter.sort = el.value; render(); }
      else if (act === 'compareUnit') { ui.compareUnit = el.value || null; render(); }
      else if (act === 'toggleSound') { dispatch({ type: 'toggleSound' }); }
      else if (act === 'toggleMotion') { dispatch({ type: 'toggleMotion' }); }
      else if (act === 'setVolume') { dispatch({ type: 'setVolume', value: el.value }); }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (App.ui.modal) dispatch({ type: 'closeModal' });
        return;
      }
      if (App.ui.screen === 'battle') {
        if (e.code === 'Space') { e.preventDefault(); dispatch({ type: 'togglePause' }); }
        if (e.key === '1' || e.key === '2' || e.key === '3') {
          const wanted = ['balance', 'focus', 'safe'][Number(e.key) - 1];
          const b = App.state.run && App.state.run.battle;
          if (b && b.tactic !== wanted) {
            const cur = b.tactic;
            App.state.run.battle.tactic = wanted;
            persist();
            render();
          }
        }
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persist(true);
    });
    window.addEventListener('pagehide', () => persist(true));
  }

  function exportSave() {
    const text = A.Storage.exportText(App.state);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ashen-corridor-save-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function importSave() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || '');
        const dec = A.Storage.decode(raw);
        if (!dec.ok) {
          toast('导入失败：' + dec.errors.slice(0, 2).join('；'));
          return;
        }
        if (!confirm('导入会替换当前进度，确定继续？')) return;
        const r = A.Storage.importSave(safeStorage(), raw);
        if (!r.ok) { toast('导入失败：' + r.errors.slice(0, 2).join('；')); return; }
        App.state = r.state;
        App.ui.hadSave = true;
        App.ui.screen = 'title';
        render();
        toast('导入成功');
      };
      reader.readAsText(file);
    };
    input.click();
  }

  A.App = App;
  A.Sfx = Sfx;
  A.App.dispatch = dispatch;
  A.App.render = render;
  A.App.boot = boot;
  A.App.toast = toast;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(globalThis.Ashen ||= {});
