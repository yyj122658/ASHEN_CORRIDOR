'use strict';
/* 老兵回路版应用层：唯一 dispatch、唯一循环、唯一存档。
   所有点击都走领域命令；UI 不先扣资源。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const D = () => V.Data;

  const ui = {
    screen: 'title',
    hadSave: false,
    paused: false,
    speed: 1,
    teamUnit: null,
    teamPickSlot: null,
    ruleUnit: null,
    ruleDraft: null,
    ruleErrors: [],
    wsUnit: null,
    wsDraft: null,
    wsPick: null,
    wsRot: 0,
    wsMirror: false,
    wsHist: [],
    wsRedo: [],
    wsErrors: [],
    wsMode: 'workshop',
    wsLocked: [],
    inscribeItem: null,
    wsMsId: 'ember12',
    wsMsRot: 0,
    wsMsMir: false,
    wsMsSpotIdx: 0,
    wsMsOx: null,
    wsMsOy: null,
    prepSlot: null,
    replaceFor: null,
    histUnit: null,
    shopMsg: '',
    importOpen: false,
    modal: null,
    packSelection: null,
    packMessage: '',
    cooking: null,
    modalSaveText: '',
    toast: '',
  };

  let state = null;
  let rafId = null;
  let lastTs = 0;
  let acc = 0;
  let lastScreen = null;
  let saveTimer = null;
  let cookTimer = null;
  const artPreloaded = new Set();

  const STEP_MS = 240;

  /* ------------------------------ 存档 ------------------------------ */

  function persist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    state.savedAt = Date.now();
    V.Storage.save(state, state.savedAt);
  }

  function persistSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; persist(); }, 260);
  }

  /* ------------------------------ 屏幕同步 ------------------------------ */

  function syncScreen() {
    const r = state.run;
    if (!r) {
      if (state.settlement) ui.screen = 'settlement';
      else if (ui.screen === 'title' || ui.screen === 'settlement') ui.screen = state.run ? 'map' : 'camp';
      return;
    }
    const map = {
      map: 'map', prebattle: 'prebattle', battle: 'battle',
      battleReview: 'review', loot: 'loot', event: 'event',
      camp: 'campNode', merchant: 'merchant', blessing: 'blessing',
    };
    ui.screen = map[r.stage] || 'map';
  }

  /* ------------------------------ 渲染 ------------------------------ */

  function renderModal() {
    let root = document.getElementById('modalRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'modalRoot';
      const appEl = document.getElementById('app') || document.body;
      appEl.appendChild(root);
    }
    const wasOpen = !!root.firstElementChild;
    const oldPack = root.querySelector('.pack-dialog');
    const packScroll = oldPack?.scrollTop || 0;
    const expanded = root.querySelector('.save-tools')?.open;
    const previous = root.contains(document.activeElement) ? document.activeElement.dataset : null;
    root.innerHTML = V.UI.modalHtml(state, ui);
    document.querySelector('.masthead').inert = !!ui.modal;
    document.getElementById('stage').inert = !!ui.modal;
    if (ui.modal) {
      const tools = root.querySelector('.save-tools');
      if (tools && expanded) tools.open = true;
      const newPack = root.querySelector('.pack-dialog');
      if (newPack && oldPack) newPack.scrollTop = packScroll;
      const buttons = [...root.querySelectorAll('.modal-card button:not(:disabled)')];
      const focus = previous?.act && buttons.find(b => b.dataset.act === previous.act && b.dataset.id === previous.id);
      (focus || buttons[0])?.focus({ preventScroll: true });
    } else if (wasOpen) {
      document.querySelector(oldPack ? '[data-act="openPack"]' : '[data-act="openSettings"]')?.focus({ preventScroll: true });
    }
  }

  function filterCatalogue(book, limit = 8) {
    const query = book.querySelector('[data-catalogue-query]').value.trim().toLowerCase();
    const filter = book.querySelector('[data-catalogue-filter]').value;
    let matches = 0;
    for (const item of book.querySelectorAll('[data-catalogue-item]')) {
      const match = item.dataset.catalogueItem.toLowerCase().includes(query)
        && (!filter || item.dataset.filter.split(' ').includes(filter));
      if (match) matches++;
      item.hidden = !match || matches > limit;
    }
    book.dataset.limit = limit;
    book.querySelector('[data-catalogue-count]').textContent = matches ? `显示 ${Math.min(matches, limit)} / ${matches}` : '没有匹配项';
    book.querySelector('[data-catalogue-more]').hidden = matches <= limit;
  }

  let groundScanTimer = null;

  /** 扫描时间按节点及物件保存；更新控件本身，避免重复播放或抢走键盘焦点。 */
  function updateGroundScan() {
    clearTimeout(groundScanTimer);
    const ground = document.querySelector('.loot-ground');
    if (!ground || !ui.groundSurvey) return;
    const reduce = state.settings?.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const now = performance.now();
    let next = Infinity;
    const notes = new Map([...ground.querySelectorAll('[data-ground-note]')].map(el => [el.dataset.groundNote, el]));
    for (const item of ground.querySelectorAll('[data-ground-item]')) {
      const found = ui.groundSurvey.finds.get(item.dataset.token);
      if (reduce) found.end = 0;
      const status = now >= found.end ? 'revealed' : now < found.start ? 'waiting' : 'scanning';
      const ready = status === 'revealed';
      if (!ready) next = Math.min(next, status === 'waiting' ? found.start : found.end);
      const note = notes.get(item.dataset.token);
      if (status === 'scanning' && item.dataset.scan !== status) item.style.setProperty('--scan-lag', (found.start - now) + 'ms');
      item.dataset.scan = note.dataset.scan = status;
      const label = ready ? item.dataset.label + (item.dataset.fits === 'true' ? '' : ' · 背包放不下') : status === 'scanning' ? '辨认中' : '未辨认轮廓';
      item.setAttribute('aria-label', label);
      item.title = label;
      item.disabled = !ready;
      note.querySelector('.ground-known').setAttribute('aria-hidden', String(!ready));
      note.querySelector('.ground-unseen').textContent = ready ? '' : label;
      for (const action of note.querySelectorAll('button')) action.disabled = !ready;
    }
    if (Number.isFinite(next)) groundScanTimer = setTimeout(updateGroundScan, Math.max(1, next - now + 1));
  }

  function render() {
    if (ui.cooking && (!['kitchen', 'campNode'].includes(ui.screen) || ui.cooking.scope !== cookingScope())) {
      clearTimeout(cookTimer);
      ui.cooking = null;
    }
    clearScarHint();
    clearTimeout(groundScanTimer);
    if (ui.screen !== 'loot') ui.groundSurvey = null;
    const hudEl = document.getElementById('hud');
    const navEl = document.getElementById('nav');
    const stageEl = document.getElementById('stage');
    document.body.dataset.screen = ui.screen;
    document.body.classList.toggle('reduced-motion', !!(state && state.settings && state.settings.reducedMotion));

    if (ui.screen === 'title') {
      if (hudEl) hudEl.innerHTML = '';
      if (navEl) navEl.innerHTML = '';
      if (stageEl) stageEl.innerHTML = V.UI.screen(state, ui);
      renderModal();
      lastScreen = 'title';
      return;
    }

    if (hudEl) hudEl.innerHTML = V.UI.hud(state, ui);
    if (navEl) navEl.innerHTML = V.UI.nav(state, ui);
    if (stageEl) {
      const old = ui.screen === lastScreen && stageEl.querySelector('[data-catalogue]');
      const inscriptionOpen = ui.screen === lastScreen && stageEl.querySelector('.field-inscription')?.open;
      stageEl.innerHTML = V.UI.screen(state, ui);
      if (inscriptionOpen && stageEl.querySelector('.field-inscription')) stageEl.querySelector('.field-inscription').open = true;
      if (ui.screen === 'loot') updateGroundScan();
      const book = stageEl.querySelector('[data-catalogue]');
      if (book) {
        if (old && old.dataset.catalogue === book.dataset.catalogue) {
          book.querySelector('[data-catalogue-query]').value = old.querySelector('[data-catalogue-query]').value;
          book.querySelector('[data-catalogue-filter]').value = old.querySelector('[data-catalogue-filter]').value;
          if (book.tagName === 'DETAILS') book.open = old.open;
        }
        filterCatalogue(book, Number(old?.dataset?.limit) || 8);
      }
    }
    renderModal();

    /* 场景图按页面加载；加载完成后重画一次，让 <img> 真正进 DOM */
    if (V.Art && !artPreloaded.has(ui.screen)) {
      artPreloaded.add(ui.screen);
      V.Art.preloadFor(ui.screen).then((r) => {
        if (r.loaded.length && ui.screen === lastScreen) render();
      });
    }

    if (ui.screen === 'prebattle' && lastScreen !== 'prebattle') V.View.preloadPreparation(state);
    if (ui.screen === 'battle') {
      const entering = lastScreen !== 'battle';
      if (entering) V.View.reset();
      /* 重建 DOM 后 canvas 是新的，必须重新绑定；位置插值不清空 */
      V.View.mount(state, { sync: entering });
      V.View.updateHud(state);
      V.View.renderFrame(state, performance.now());
    }
    lastScreen = ui.screen;
  }

  /* ------------------------------ 命令分发 ------------------------------ */

  /** 制作只属于当前前哨厨房或这一处营火，离开后不在后台扣料。 */
  function cookingScope() {
    return state.run ? JSON.stringify([state.run.id, state.run.floor, state.run.activeNodeId]) : 'home';
  }

  function run(fn) {
    const r = fn();
    if (r && r.ok) {
      state = r.state;
      persistSoon();
      syncScreen();
      return r;
    }
    if (r && r.state && r.state !== state && !r.ok) {
      /* 失败不替换状态 */
    }
    if (r && r.error) toast(r.error.message || '操作失败');
    return r;
  }

  function toast(msg) {
    ui.toast = msg;
    const el = document.getElementById('toast');
    if (el) {
      el.textContent = msg;
      el.classList.add('on');
      setTimeout(() => el.classList.remove('on'), 2600);
    }
  }

  function refreshOops(r) {
    if (r && r.error) {
      toast(r.error.message || '操作失败');
      if (r.details && r.details.length) ui.wsErrors = r.details.slice();
    }
  }

  let audioCtx = null;
  let lastSfxAt = 0;

  /** 轻量 WebAudio 合成短音：遵循 settings.sound，绝不抛错阻断主流程。 */
  function playSfx(kind) {
    if (!state || !state.settings || state.settings.sound === false) return;
    if (typeof window === 'undefined') return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const nowMs = Date.now();
    if (kind === 'hit' && nowMs - lastSfxAt < 45) return;
    lastSfxAt = nowMs;
    try {
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      const t = audioCtx.currentTime;
      const tone = (freq, endFreq, dur, type, vol) => {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = type || 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
        g.gain.setValueAtTime(vol || 0.05, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.01);
      };
      if (kind === 'click') tone(440, 260, 0.035, 'triangle', 0.035);
      else if (kind === 'snap') tone(320, 480, 0.055, 'sine', 0.045);
      else if (kind === 'hit') tone(165, 65, 0.075, 'sawtooth', 0.045);
      else if (kind === 'crit') { tone(560, 220, 0.12, 'square', 0.045); tone(180, 70, 0.14, 'sawtooth', 0.05); }
      else if (kind === 'heal' || kind === 'shield') tone(520, 680, 0.11, 'sine', 0.04);
      else if (kind === 'victory') { tone(440, 554, 0.14, 'triangle', 0.05); setTimeout(() => tone(659, 659, 0.2, 'triangle', 0.05), 110); }
      else if (kind === 'defeat') { tone(240, 150, 0.18, 'sawtooth', 0.045); setTimeout(() => tone(165, 110, 0.25, 'sawtooth', 0.045), 140); }
    } catch (e) { /* 忽略浏览器自动播放限制 */ }
  }

  function dispatch(action, el) {
    if (!action || !action.type) return;
    const t = action.type;
    if (t === 'wsDrop' || t === 'wsSave' || t === 'wsInscribe') playSfx('snap');
    else if (t !== 'closeModal') playSfx('click');

    switch (t) {
      /* ---------- 标题 ---------- */
      case 'titleStart':
        ui.hadSave = true;
        ui.screen = 'camp';
        syncScreen();
        persist();
        render();
        return;

      case 'toTitle':
        ui.screen = 'title';
        render();
        return;

      case 'resetSave':
        ui.modal = 'confirmReset';
        renderModal();
        return;

      case 'confirmResetSave':
        V.Storage.clear();
        state = V.State.create();
        ui.hadSave = false;
        ui.modal = null;
        ui.screen = 'title';
        render();
        toast('存档已清空');
        return;

      case 'upgradePack': {
        const result = run(() => V.Expedition.upgradePack(state));
        if (result.ok) {
          render();
          const panel = document.querySelector('.camp-pack');
          if (panel) panel.open = true;
          toast('背包已扩至 ' + V.Expedition.bagCapacity(state) + ' 格');
        }
        return;
      }

      case 'kitchenPack':
      case 'openPack':
        if (['title','settlement'].includes(ui.screen) || ui.modal) return;
        if (ui.screen === 'loot') { document.querySelector('.loot-pack .pack-slot')?.focus(); return; }
        ui.modal = 'pack';
        ui.packSelection = null;
        ui.packMessage = '';
        renderModal();
        return;

      case 'packSlot': {
        if (!(ui.modal === 'pack' || !ui.modal && ['loot', 'campNode'].includes(ui.screen))) return;
        const slot = Number(action.id);
        const slots = V.Expedition.packSlots(state);
        if (!Number.isInteger(slot) || slot < 0 || slot >= slots.length) return;
        if (ui.packSelection !== null && ui.packSelection !== slot && V.UI.packEditable(state, ui)) {
          dispatch({ type: 'packMove', from: ui.packSelection, to: slot });
          return;
        }
        ui.packSelection = slots[slot] && ui.packSelection !== slot ? slot : null;
        ui.packMessage = '';
        if (ui.modal) renderModal(); else render();
        return;
      }

      case 'packEat': {
        if (!(ui.modal === 'pack' || !ui.modal && ['loot', 'campNode'].includes(ui.screen)) || !V.UI.packEditable(state,ui)) return;
        const slots = V.Expedition.packSlots(state);
        const token = action.token || slots[ui.packSelection];
        if (!token?.startsWith('meal:') || !slots.includes(token)) return;
        const id = token.slice(5).split('#')[0];
        const result = run(() => V.Kitchen.eat(state,id,action.id,token));
        if (!result.ok) {
          ui.packMessage = result.error.message;
          if (ui.modal) renderModal(); else render();
          return;
        }
        ui.packSelection = V.Expedition.packSlots(state).indexOf(token);
        if (ui.packSelection < 0) ui.packSelection = null;
        ui.packMessage = V.State.unitById(state,action.id).name + '吃了' + V.Kitchen.RECIPES[id].name;
        render();
        return;
      }

      case 'packMove':
      case 'packSort':
      case 'packDiscardOverflow':
      case 'packDiscard':
      case 'packTakeFood':
      case 'packTakePart': {
        if (!(ui.modal === 'pack' || !ui.modal && ['loot', 'campNode'].includes(ui.screen)) || !V.UI.packEditable(state, ui)) return;
        const api = V.Expedition;
        let result;
        if (t === 'packMove') {
          result = run(() => api.movePack(state, Number(action.from), Number(action.to)));
        } else if (t === 'packSort') {
          result = run(() => api.sortPack(state));
        } else if (t === 'packDiscardOverflow') {
          if (!api.packOverflow(state).includes(action.id)) return;
          result = run(() => api.discardPack(state, action.id));
        } else if (t === 'packDiscard') {
          const token = api.packSlots(state)[ui.packSelection];
          if (!token) return;
          result = run(() => api.discardPack(state, token, ui.packSelection));
        } else {
          if (state.run.stage !== 'loot') return;
          result = run(() => t === 'packTakeFood'
            ? api.takeIngredient(state, action.id) : api.resolveLoot(state, action.id, 'take'));
        }
        if (!result.ok) {
          ui.packMessage = result.error.message;
          if (ui.modal) renderModal(); else render();
          return;
        }
        ui.packSelection = t === 'packMove' ? Number(action.to) : null;
        ui.packMessage = '';
        render();
        return;
      }

      case 'openSettings':
        ui.modal = 'settings';
        ui.modalSaveText = '';
        renderModal();
        return;

      case 'closeModal':
        ui.modal = null;
        renderModal();
        return;

      case 'toggleSound': {
        const next = V.State.clone(state);
        next.settings = next.settings || { sound: true, speed: 1, reducedMotion: false };
        next.settings.sound = next.settings.sound === false;
        state = next;
        persistSoon();
        renderModal();
        return;
      }

      case 'setDefaultSpeed': {
        const sp = Number(action.id) || 1;
        const next = V.State.clone(state);
        next.settings = next.settings || { sound: true, speed: 1, reducedMotion: false };
        next.settings.speed = sp;
        state = next;
        ui.speed = sp;
        persistSoon();
        renderModal();
        if (ui.screen === 'battle') V.View.updateHud(state);
        return;
      }

      case 'toggleMotion': {
        const next = V.State.clone(state);
        next.settings = next.settings || { sound: true, speed: 1, reducedMotion: false };
        next.settings.reducedMotion = !next.settings.reducedMotion;
        state = next;
        persistSoon();
        document.body.classList.toggle('reduced-motion', !!next.settings.reducedMotion);
        if (ui.screen === 'loot') updateGroundScan();
        renderModal();
        return;
      }

      case 'modalExport': {
        ui.modalSaveText = V.Storage.exportText(state);
        renderModal();
        toast('已生成最新存档文本');
        return;
      }

      case 'copySaveText': {
        const box = document.getElementById('modalSaveBox');
        const txt = (box && box.value) || V.Storage.exportText(state);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(() => toast('已复制到剪贴板')).catch(() => toast('请手动全选复制文本框'));
        } else if (box) {
          box.select();
          toast('请按 Ctrl+C 复制选中文本');
        }
        return;
      }

      case 'modalImportConfirm': {
        const box = document.getElementById('modalSaveBox');
        const raw = box ? box.value : '';
        const r = V.Storage.importText(raw);
        if (!r.ok) {
          toast('导入失败：' + (r.errors[0] || '存档不合法'));
          return;
        }
        state = r.state;
        ui.hadSave = true;
        ui.modal = null;
        ui.importOpen = false;
        syncScreen();
        if (ui.screen === 'title') ui.screen = 'camp';
        persist();
        render();
        toast('导入成功');
        return;
      }

      case 'exportSave': {
        const raw = V.Storage.exportText(state);
        ui.importOpen = true;
        ui.exportText = raw;
        render();
        const box = document.getElementById('importBox');
        if (box) box.value = raw;
        toast('存档已填入下方文本框，可复制保存');
        return;
      }

      case 'importSave':
        ui.importOpen = !ui.importOpen;
        render();
        return;

      case 'importConfirm': {
        const box = document.getElementById('importBox');
        const raw = box ? box.value : '';
        const r = V.Storage.importText(raw);
        if (!r.ok) {
          toast('导入失败：' + (r.errors[0] || '存档不合法'));
          return;
        }
        state = r.state;
        ui.hadSave = true;
        ui.importOpen = false;
        ui.screen = 'camp';
        persist();
        render();
        toast('导入成功');
        return;
      }

      /* ---------- 导航 ---------- */
      case 'storePick':
      case 'storeSlot':
      case 'storeMove':
      case 'storeRotate':
      case 'storeSort':
      case 'storeUpgrade': {
        if (ui.screen !== 'stash' || state.run || ui.modal) return;
        const shelf = ui.stashShelf || 'food', E = V.Expedition;
        if (action.type === 'storeUpgrade') {
          if (!Object.hasOwn(E.STORE_UPGRADES,action.id)) return;
          if (run(() => E.upgradePack(state,action.id)).ok) render();
          return;
        }
        const layout = E.storeLayout(state,shelf);
        if (action.type === 'storePick' || (action.type === 'storeSlot' && layout.slots[action.id])) {
          ui.storePick = action.type === 'storePick' ? action.id : layout.slots[action.id];
          render();
          return;
        }
        const token = action.type === 'storeMove' ? action.token : ui.storePick;
        if (!token && action.type !== 'storeSort') return;
        if (run(() => E.arrangeStore(state,shelf,action.type === 'storeSort' ? null : token,Number(action.id),action.type === 'storeRotate')).ok) {
          ui.storePick = action.type === 'storeSort' ? null : token;
          render();
        }
        return;
      }
      case 'stashShelf':
        if (ui.screen !== 'stash' || !['food','meal','part','etch'].includes(action.id)) return;
        ui.stashShelf = action.id;
        ui.storePick = null;
        render();
        document.querySelector('.store-tabs [aria-pressed="true"]')?.focus({preventScroll:true});
        return;
      case 'transferMeal': {
        if (ui.screen !== 'stash' || state.run) return;
        const result = run(() => V.Kitchen.transferMeal(state,action.id,action.v));
        if (result.ok) render();
        return;
      }
      case 'go':
        if (state.run) return;
        ui.screen = action.v;
        if (action.v === 'workshop') openWorkshop(action.id || state.team.filter(Boolean)[0] || state.roster[0].id, action.ms);
        if (action.v === 'recruit' && !state.shop?.length) {
          const firstVisit = V.Roster.refreshShop(state, false);
          if (firstVisit.ok) { state = firstVisit.state; persistSoon(); }
        }
        if (action.v === 'history') ui.histUnit = ui.histUnit || state.roster[0].id;
        if (action.v === 'team') ui.teamUnit = ui.teamUnit || state.roster[0].id;
        render();
        return;

      case 'setDifficulty': {
        const next = V.State.clone(state);
        next.difficulty = action.id;
        state = next;
        persistSoon();
        render();
        return;
      }

      /* ---------- 队伍 ---------- */
      case 'teamPick':
        ui.teamPickSlot = Number(action.id);
        render();
        return;

      case 'teamSet': {
        const r = run(() => V.Roster.setTeamSlot(state, Number(action.slot), action.id));
        if (r && r.ok) { ui.teamPickSlot = null; render(); }
        return;
      }

      case 'teamClear': {
        const r = run(() => V.Roster.setTeamSlot(state, Number(action.id), null));
        if (r && r.ok) render();
        return;
      }

      case 'teamMove': {
        const from = Number(action.from);
        const to = Number(action.to);
        if (from < 0 || from > 3 || to < 0 || to > 3 || from === to) return;
        const next = V.State.clone(state);
        const tmp = next.team[from];
        next.team[from] = next.team[to];
        next.team[to] = tmp;
        state = next;
        ui.teamPickSlot = null;
        persistSoon();
        render();
        return;
      }

      case 'inspectUnit':
        ui.teamUnit = action.id;
        if (ui.screen !== 'team') ui.screen = 'team';
        render();
        return;

      case 'equipWeapon': {
        const r = run(() => V.Roster.equipWeapon(state, action.uid, action.id));
        if (r && r.ok) render();
        else refreshOops(r);
        return;
      }

      case 'comfort': {
        const r = run(() => V.Roster.comfort(state, action.id));
        if (r && r.ok) render();
        else refreshOops(r);
        return;
      }

      /* ---------- 指令 ---------- */
      case 'editRules': {
        const id = action.id || ui.ruleUnit;
        if (!id) return;
        ui.screen = 'rules';
        ui.ruleUnit = id;
        const prepRules = state.run && state.run.encounter && state.run.encounter.preparation && state.run.encounter.preparation.rules;
        const src = (prepRules && prepRules[id]) || (state.roster.find((u) => u.id === id) || {}).gambits || [];
        ui.ruleDraft = V.State.clone(src);
        ui.ruleErrors = [];
        render();
        return;
      }

      case 'ruleMoveUp': {
        const i = Number(action.id);
        if (i <= 0 || i >= ui.ruleDraft.length) return;
        const tmp = ui.ruleDraft[i - 1];
        ui.ruleDraft[i - 1] = ui.ruleDraft[i];
        ui.ruleDraft[i] = tmp;
        render();
        return;
      }

      case 'ruleMoveDown': {
        const i = Number(action.id);
        if (i < 0 || i >= ui.ruleDraft.length - 1) return;
        const tmp = ui.ruleDraft[i + 1];
        ui.ruleDraft[i + 1] = ui.ruleDraft[i];
        ui.ruleDraft[i] = tmp;
        render();
        return;
      }

      case 'ruleToggle': {
        const i = Number(action.id);
        if (!ui.ruleDraft[i]) return;
        ui.ruleDraft[i].enabled = ui.ruleDraft[i].enabled === false;
        render();
        return;
      }

      case 'ruleCancel':
        ui.ruleErrors = [];
        if (state.run) syncScreen();
        else ui.screen = 'team';
        render();
        return;

      case 'ruleAdd': {
        const u = state.roster.find((x) => x.id === ui.ruleUnit);
        if (!ui.ruleDraft || ui.ruleDraft.length >= u.logicSlots) return;
        ui.ruleDraft.push({
          id: 'g' + (ui.ruleDraft.length + 1) + '_' + Date.now(),
          enabled: true, conditions: [{ type: 'always' }], target: 'frontFoe', action: 'main',
        });
        render();
        return;
      }

      case 'ruleDel': {
        ui.ruleDraft.splice(Number(action.id), 1);
        render();
        return;
      }

      case 'ruleAddCond': {
        const i = Number(action.id);
        if (ui.ruleDraft[i].conditions.length >= 2) return;
        ui.ruleDraft[i].conditions.push({ type: 'selfHpBelow', value: 50 });
        render();
        return;
      }

      case 'ruleCond': {
        const [i, ci] = String(action.id).split(':').map(Number);
        const c = ui.ruleDraft[i].conditions[ci];
        c.type = el.value;
        if (c.type === 'always') delete c.value;
        else if (c.type === 'atSlot') c.value = 1;
        else c.value = 50;
        render();
        return;
      }

      case 'ruleCondVal': {
        const [i, ci] = String(action.id).split(':').map(Number);
        ui.ruleDraft[i].conditions[ci].value = Number(el.value);
        render();
        return;
      }

      case 'ruleTarget': {
        ui.ruleDraft[Number(action.id)].target = el.value;
        render();
        return;
      }

      case 'ruleAction': {
        ui.ruleDraft[Number(action.id)].action = el.value;
        render();
        return;
      }

      case 'ruleSave': {
        if (state.run && state.run.encounter) {
          const r = V.Encounter.editPreparation(state, { rules: { [ui.ruleUnit]: ui.ruleDraft } });
          if (!r.ok) {
            ui.ruleErrors = r.details || [r.error.message];
            render();
            toast('指令不合法');
            return;
          }
          state = r.state;
          persistSoon();
          ui.ruleErrors = [];
          syncScreen();
          render();
          toast('整备指令已保存');
          return;
        }
        const r = V.Roster.setGambits(state, ui.ruleUnit, ui.ruleDraft);
        if (!r.ok) {
          ui.ruleErrors = r.details || [r.error.message];
          render();
          toast('指令不合法');
          return;
        }
        state = r.state;
        persistSoon();
        ui.ruleErrors = [];
        ui.screen = 'team';
        render();
        toast('指令已保存');
        return;
      }

      /* ---------- 工坊 ---------- */
      case 'wsFilmView':
        ui.wsFilmView = !ui.wsFilmView;
        render();
        document.querySelector('.film-switch')?.focus({preventScroll:true});
        return;
      case 'wsPalette':
        ui.wsPalette = action.id === 'runes' ? 'runes' : 'etchings';
        render();
        return;
      case 'wsUnit':
        if (ui.wsMode === 'inscribe') return;
        openWorkshop(action.id);
        render();
        return;

      case 'wsPick': {
        const id = action.id;
        selectFieldRune(id);
        /* 再点一次同一件就取消选中——不管它是仓库里的还是已经在板面上 */
        if (ui.wsPick === id) {
          ui.wsPick = null;
          ui.wsErrors = [];
          render();
          return;
        }
        const placed = (ui.wsDraft || []).find((p) => p.itemId === id);
        ui.wsPick = id;
        ui.wsRot = placed ? placed.rotation : 0;
        ui.wsMirror = placed ? !!placed.mirrorY : false;
        ui.wsErrors = [];
        render();
        return;
      }

      case 'wsCancelPick':
        ui.wsPick = null;
        ui.wsErrors = [];
        render();
        return;

      case 'wsRotate': {
        if (!ui.wsPick) { toast('先选一件纹路'); return; }
        const step = Number(action.step) === 3 ? 3 : 1;
        const placed = ui.wsDraft.find((p) => p.itemId === ui.wsPick);
        const nextRot = ((placed ? placed.rotation : ui.wsRot) + step) % 4;
        const nextMir = placed ? !!placed.mirrorY : !!ui.wsMirror;
        pushHistory();
        if (placed) {
          const shape = V.UI && V.UI.partShape ? V.UI.partShape(state, ui.wsPick, nextRot, nextMir) : null;
          const nudge = shape ? findNudgeFit(ui.wsPick, shape, placed.x, placed.y) : null;
          if (nudge) { placed.x = nudge.x; placed.y = nudge.y; }
          else toast('旋转后与板边或纹路冲突，可拖移或再转一次');
          placed.rotation = nextRot;
        }
        ui.wsRot = nextRot;
        ui.wsErrors = [];
        render();
        return;
      }

      case 'wsFlip': {
        if (!ui.wsPick) { toast('先选一件纹路'); return; }
        const placed = ui.wsDraft.find((p) => p.itemId === ui.wsPick);
        const nextRot = placed ? placed.rotation : ui.wsRot;
        const nextMir = !(placed ? placed.mirrorY : ui.wsMirror);
        pushHistory();
        if (placed) {
          const shape = V.UI && V.UI.partShape ? V.UI.partShape(state, ui.wsPick, nextRot, nextMir) : null;
          const nudge = shape ? findNudgeFit(ui.wsPick, shape, placed.x, placed.y) : null;
          if (nudge) { placed.x = nudge.x; placed.y = nudge.y; }
          else toast('翻转后与板边或纹路冲突，可拖移调整');
          placed.mirrorY = nextMir;
        }
        ui.wsMirror = nextMir;
        ui.wsErrors = [];
        render();
        return;
      }

      case 'wsClear': {
        const locked = new Set(ui.wsLocked || []);
        const next = (ui.wsDraft || []).filter((p) => locked.has(p.itemId));
        if (next.length === (ui.wsDraft || []).length) { toast('没有可清空的纹路'); return; }
        pushHistory();
        ui.wsDraft = next;
        ui.wsPick = null;
        ui.wsErrors = [];
        render();
        toast('已清空板面（可 Ctrl+Z 撤销）');
        return;
      }

      case 'wsRevert': {
        const unit = state.roster.find((u) => u.id === ui.wsUnit);
        if (!unit) return;
        pushHistory();
        ui.wsDraft = V.State.clone(unit.board.placements);
        ui.wsMsPoses = {};
        selectWorkshopManuscript(ui.wsMsId, V.State.manuscriptsOf(unit).find((m) => m.id === ui.wsMsId));
        ui.wsPick = null;
        ui.wsErrors = [];
        render();
        toast('已还原为上次保存的板面');
        return;
      }

      case 'wsQuickPlace': {
        const id = action.id;
        const unit = state.roster.find(u => u.id === ui.wsUnit);
        const available = ui.wsMode === 'inscribe' ? id === ui.inscribeItem
          : state.stash.includes(id) || unit?.board.placements.some(p => p.itemId === id);
        if (!available || !id || (ui.wsDraft || []).some((p) => p.itemId === id)) return;
        const spot = findQuickPlaceSpot(id, ui.wsPick === id ? ui.wsRot : 0, ui.wsPick === id ? !!ui.wsMirror : false);
        if (!spot) { toast('没有符合形状和负荷的空位'); return; }
        pushHistory();
        ui.wsDraft.push({ itemId: id, x: spot.x, y: spot.y, rotation: spot.rotation, mirrorY: spot.mirrorY });
        ui.wsPick = id;
        ui.wsRot = spot.rotation;
        ui.wsMirror = spot.mirrorY;
        ui.wsErrors = [];
        render();
        return;
      }

      case 'wsAutoConnect': {
        const unit = V.UI.workshopUnit(state.roster.find((u) => u.id === ui.wsUnit), ui);
        if (!unit) return;
        const plate = V.Circuit.plateOf(unit);
        const cap = V.Circuit.loadCap(unit) - V.State.manuscriptsOf(unit).reduce((sum, m) => sum + (m.load || 0), 0);
        const stashCircuits = state.stash.filter((id) => state.itemsById[id] && state.itemsById[id].kind === 'circuit');
        const allIds = [...new Set([...(ui.wsDraft || []).map((p) => p.itemId), ...stashCircuits])];
        const found = findSmartConnectLayout({ ...state, roster: [unit] }, unit, plate, allIds, cap);
        if (!found) {
          toast('现有可用纹路在当前负荷/板面下暂无法直接连通输出');
          return;
        }
        pushHistory();
        ui.wsDraft = found;
        ui.wsPick = null;
        ui.wsErrors = [];
        render();
        toast('已用现有纹路自动接通输出');
        return;
      }

      case 'wsRemove': {
        const placed = ui.wsDraft.find((p) => p.itemId === action.id);
        if (!placed) return;
        if (ui.wsLocked.includes(action.id)) { toast('原纹路不能在烙印中移除'); return; }
        pushHistory();
        ui.wsDraft = ui.wsDraft.filter((p) => p.itemId !== action.id);
        ui.wsPick = null;
        render();
        return;
      }

      case 'wsCell': {
        /* 没选中就点空格：什么都不做（不再弹提示，否则放置后再点板面会被念一句） */
        if (!ui.wsPick) return;
        const [x, y] = String(action.id).split(',').map(Number);
        const existing = ui.wsDraft.find((p) => p.itemId === ui.wsPick);
        /* 选中一件「已经在板面上」的纹路时，点空白格只当作「放下它」= 取消选中。
           要换位置请直接拖——否则误点一下板面就把纹路搬走，是最容易踩的坑。 */
        if (existing) {
          ui.wsPick = null;
          ui.wsErrors = [];
          render();
          return;
        }
        pushHistory();
        ui.wsDraft.push({ itemId: ui.wsPick, x, y, rotation: ui.wsRot, mirrorY: ui.wsMirror });
        ui.wsErrors = [];
        /* 放完即结束：解除手持，避免之后点板面又把它搬走 */
        ui.wsPick = null;
        render();
        return;
      }

      /* 拖拽落点：放置一次完成，只重绘一次。支持拖拽中按 R/F 旋转翻转。 */
      case 'wsDrop': {
        const id = action.id;
        const cell = String(action.cell || '').split(',').map(Number);
        if (!id || cell.length !== 2 || !Number.isFinite(cell[0]) || !Number.isFinite(cell[1])) return;
        selectFieldRune(id);
        const existing = (ui.wsDraft || []).find((p) => p.itemId === id);
        const rot = action.rot != null ? Number(action.rot) : (existing ? existing.rotation : ui.wsRot);
        const mir = action.mir != null ? !!action.mir : (existing ? !!existing.mirrorY : ui.wsMirror);

        /* 按板面真实包围盒夹取，不写死 4x4 的 3 */
        const shape = V.UI && V.UI.partShape ? V.UI.partShape(state, id, rot, mir) : null;
        const anchored = shape ? clampAnchor(shape, { x: cell[0], y: cell[1] }, activePlate()) : { x: cell[0], y: cell[1] };
        const nx = anchored.x;
        const ny = anchored.y;

        pushHistory();
        if (existing) {
          existing.x = nx;
          existing.y = ny;
          existing.rotation = rot;
          existing.mirrorY = mir;
        } else {
          ui.wsDraft.push({ itemId: id, x: nx, y: ny, rotation: rot, mirrorY: mir });
        }
        ui.wsRot = rot;
        ui.wsMirror = mir;
        ui.wsErrors = [];
        /* 松手即结束：不再保持手持，否则点板面别处会把刚放下的纹路搬过去 */
        ui.wsPick = null;
        render();
        return;
      }

      case 'wsMsEquip':
      case 'wsMsEquipAt':
      case 'wsMsPromote':
      case 'wsMsUnequip': {
        if (ui.wsMode === 'inscribe') return;
        const id = action.id || ui.wsMsId;
        const next = V.State.clone(state);
        const unit = next.roster.find((u) => u.id === ui.wsUnit);
        Object.assign(unit, V.UI.workshopUnit(unit, ui));
        const plate = V.Circuit.plateOf(unit);
        const ms = V.UI.resolveManuscript(unit, plate, ui, V.Circuit.layout(next, ui.wsDraft, plate.terminals));
        const pose = action.type === 'wsMsEquipAt'
          ? { x: action.ox, y: action.oy, rotation: action.rotation || 0, mirrorY: !!action.mirrorY }
          : ms && ms.fits ? { x: ms.ox, y: ms.oy, rotation: ms.rot, mirrorY: ms.mir } : undefined;
        const result = action.type === 'wsMsUnequip'
          ? V.State.removeManuscript(next, unit, id)
          : action.type === 'wsMsPromote' ? V.State.promoteManuscript(unit, id)
          : V.State.placeManuscript(next, unit, id, pose, ui.wsDraft);
        if (!result.ok) { ui.wsErrors = [result.reason]; render(); toast(result.reason); return; }
        saveWorkshop(next, action.type === 'wsMsUnequip' ? unit.manuscript?.id : id,
          action.type === 'wsMsUnequip' ? '蚀刻法已卸下，装配已保存' : action.type === 'wsMsPromote' ? '主修已保存' : '蚀刻法已装上，装配已保存');
        return;
      }

      case 'wsMsMove':
      case 'wsMsRotate':
      case 'wsMsFlip':
      case 'wsMsShift': {
        if (ui.wsMode === 'inscribe') return;
        const unit = V.UI.workshopUnit(state.roster.find((u) => u.id === ui.wsUnit), ui);
        const id = action.id || ui.wsMsId;
        const ms = V.State.manuscriptsOf(unit).find((m) => m.id === id);
        const plate = V.Circuit.plateOf(unit);
        const layout = V.Circuit.layout(state, ui.wsDraft, plate.terminals);
        const candidate = { ...ui, wsMsId: id };
        if (action.type === 'wsMsMove') {
          Object.assign(candidate, { wsMsOx: action.ox, wsMsOy: action.oy, wsMsRot: action.rotation ?? ui.wsMsRot, wsMsMir: action.mirrorY ?? ui.wsMsMir });
        } else {
          if (action.type === 'wsMsRotate') candidate.wsMsRot = (ui.wsMsRot + 1) % 4;
          if (action.type === 'wsMsFlip') candidate.wsMsMir = !ui.wsMsMir;
          candidate.wsMsSpotIdx = action.type === 'wsMsShift'
            ? V.UI.resolveManuscript(unit, plate, ui, layout).spotIdx + 1 : null;
          candidate.wsMsOx = null;
          candidate.wsMsOy = null;
        }
        const view = V.UI.resolveManuscript(unit, plate, candidate, layout);
        if (!view || view.disabled) return;
        if (!view.fits && (ms || action.type === 'wsMsMove')) { toast(view.reason); return; }
        const pose = { x: view.ox, y: view.oy, rotation: view.rot, mirrorY: view.mir };
        if (ms) ui.wsMsPoses[id] = pose;
        selectWorkshopManuscript(id, pose);
        ui.wsMsSpotIdx = view.spotIdx;
        render();
        return;
      }

      case 'wsMsPick': {
        const unit = V.UI.workshopUnit(state.roster.find((u) => u.id === ui.wsUnit), ui);
        selectWorkshopManuscript(action.id, V.State.manuscriptsOf(unit).find((m) => m.id === action.id));
        render();
        return;
      }

      /* 点一下纹路（没有拖动）：等同于选中，之后可用旋转/翻转/点空格移动 */
      case 'wsGrab':
        dispatch({ type: 'wsPick', id: action.id });
        return;

      case 'wsUndo': {
        if (!ui.wsHist.length) return;
        ui.wsRedo.push(V.State.clone(ui.wsDraft));
        ui.wsDraft = ui.wsHist.pop();
        if (ui.wsPick && !ui.wsDraft.some((p) => p.itemId === ui.wsPick)) ui.wsPick = null;
        render();
        return;
      }

      case 'wsRedo': {
        if (!ui.wsRedo.length) return;
        ui.wsHist.push(V.State.clone(ui.wsDraft));
        ui.wsDraft = ui.wsRedo.pop();
        if (ui.wsPick && !ui.wsDraft.some((p) => p.itemId === ui.wsPick)) ui.wsPick = null;
        render();
        return;
      }

      case 'wsPreset': {
        const preset = D().PRESETS[action.id];
        if (!preset || ui.wsMode === 'inscribe') return;
        const unit = V.UI.workshopUnit(state.roster.find((u) => u.id === ui.wsUnit), ui);
        const result = buildPreset(state, unit, preset);
        if (!result.ok) {
          toast(result.reason);
          return;
        }
        pushHistory();
        ui.wsDraft = result.placements;
        ui.wsPick = null;
        render();
        return;
      }

      case 'wsSave': {
        if (ui.wsMode === 'inscribe') return;
        const next = V.State.clone(state);
        const unit = next.roster.find((u) => u.id === ui.wsUnit);
        Object.assign(unit, V.UI.workshopUnit(unit, ui));
        saveWorkshop(next, ui.wsMsId, '板面已保存');
        return;
      }

      case 'inscribeStart': {
        const unit = state.roster.find((u) => u.id === action.id);
        if (!unit || !V.Expedition.inscribable(state, unit.id).ok) return;
        const bagCircuits = state.run.bag.filter(id => state.itemsById[id]?.kind === 'circuit' && state.itemsById[id].acquiredRunId === state.run.id);
        if (!bagCircuits.length) { toast('背包里没有本局获得的回路纹路'); return; }
        openWorkshop(unit.id);
        ui.wsMode = 'inscribe';
        ui.wsUnit = unit.id;
        ui.inscribeItem = bagCircuits[0];
        ui.wsDraft = V.State.clone(unit.board.placements);
        ui.wsLocked = unit.board.placements.map((p) => p.itemId);
        ui.wsPick = bagCircuits[0];
        ui.wsRot = 0;
        ui.wsMirror = false;
        ui.wsHist = [];
        ui.wsRedo = [];
        ui.wsErrors = [];
        ui.screen = 'workshop';
        render();
        return;
      }

      case 'wsAutoLayout': {
        const unit = state.roster.find((u) => u.id === ui.wsUnit);
        if (!unit || !ui.inscribeItem) return;
        const plate = V.Circuit.plateOf(unit);
        if (!plate.generated) {
          const draft = V.State.clone(ui.wsDraft);
          const park = D().STRAIGHT_PARK[unit.bodyPreset] || { x: 0, y: 0 };
          const occupant = draft.find((p) => p.x === 0 && p.y === 1 && p.itemId !== ui.inscribeItem);
          if (occupant) {
            occupant.x = park.x;
            occupant.y = park.y;
            occupant.rotation = 0;
            occupant.mirrorY = false;
          }
          const existing = draft.find((p) => p.itemId === ui.inscribeItem);
          if (existing) {
            existing.x = 0;
            existing.y = 1;
            existing.rotation = 0;
            existing.mirrorY = false;
          } else {
            draft.push({ itemId: ui.inscribeItem, x: 0, y: 1, rotation: 0, mirrorY: false });
          }
          pushHistory();
          ui.wsDraft = draft;
          ui.wsErrors = [];
          render();
          return;
        }
        const needIds = [...new Set([...(ui.wsDraft || []).map((p) => p.itemId), ui.inscribeItem])];
        const found = findAutoInscribeLayout(state, unit, plate, needIds);
        if (!found) {
          toast('当前板面与既有纹路无法直接连通输出，请手调或换角色烙印');
          return;
        }
        pushHistory();
        ui.wsDraft = found;
        ui.wsErrors = [];
        render();
        return;
      }

      case 'wsInscribe': {
        const r = V.Expedition.inscribe(state, ui.wsUnit, ui.inscribeItem, ui.wsDraft);
        if (!r.ok) {
          ui.wsErrors = r.details || [r.error.message];
          render();
          toast(r.error.message || '烙印失败');
          return;
        }
        state = r.state;
        persistSoon();
        ui.wsMode = 'workshop';
        ui.wsLocked = [];
        syncScreen();
        render();
        toast('现场烙印完成');
        return;
      }

      case 'cancelInscribe':
        ui.wsMode = 'workshop';
        ui.wsLocked = [];
        syncScreen();
        render();
        return;

      /* ---------- 招募 ---------- */
      case 'refreshShop': {
        const r = run(() => V.Roster.refreshShop(state, true));
        if (r && r.ok) { ui.shopMsg = ''; render(); }
        else { ui.shopMsg = r && r.error ? r.error.message : ''; render(); }
        return;
      }

      case 'recruitOffer': {
        const r = run(() => V.Roster.recruit(state, action.id));
        if (r && r.ok) { ui.shopMsg = ''; render(); }
        else { ui.shopMsg = r && r.error ? r.error.message : ''; render(); }
        return;
      }

      /* ---------- 战史 ---------- */
      case 'inspectHistory':
        ui.histUnit = action.id;
        ui.screen = 'history';
        render();
        return;

      /* ---------- 远征 ---------- */
      case 'startRun': {
        const r = run(() => V.Expedition.start(state, {}));
        if (r && r.ok) {
          ui.screen = 'map';
          render();
        } else refreshOops(r);
        return;
      }

      case 'chooseNode': {
        const r = run(() => V.Expedition.chooseNode(state, action.id));
        if (r && r.ok) render();
        else refreshOops(r);
        return;
      }

      case 'extractNow': {
        const r = run(() => V.Expedition.extract(state, false));
        if (r && r.ok) { ui.screen = 'settlement'; render(); }
        else refreshOops(r);
        return;
      }

      /* ---------- 战前 ---------- */
      case 'prepPick':
        ui.prepSlot = Number(action.id);
        render();
        return;

      case 'prepSwap': {
        const a = Number(action.a);
        const uid = action.uid;
        const formation = state.run.encounter.preparation.formation.slice();
        const b = formation.indexOf(uid);
        if (b < 0) return;
        const tmp = formation[a];
        formation[a] = formation[b];
        formation[b] = tmp;
        const r = V.Encounter.editPreparation(state, { formation });
        if (!r.ok) { toast(r.error.message); return; }
        state = r.state;
        persistSoon();
        ui.prepSlot = null;
        render();
        return;
      }

      case 'prepMove': {
        const from = Number(action.from);
        const to = Number(action.to);
        const formation = state.run.encounter.preparation.formation.slice();
        if (from < 0 || from > 3 || to < 0 || to > 3 || from === to) return;
        const tmp = formation[from];
        formation[from] = formation[to];
        formation[to] = tmp;
        const r = V.Encounter.editPreparation(state, { formation });
        if (!r.ok) { toast(r.error.message); return; }
        state = r.state;
        persistSoon();
        ui.prepSlot = null;
        render();
        return;
      }

      case 'startAttempt': {
        const r = run(() => V.Encounter.startAttempt(state));
        if (r && r.ok) {
          ui.paused = false;
          acc = 0;
          lastTs = 0;
          ui.screen = 'battle';
          render();
        } else refreshOops(r);
        return;
      }

      case 'rewind': {
        const r = run(() => V.Encounter.rewind(state));
        if (r && r.ok) {
          V.View.reset();
          ui.paused = false;
          ui.screen = 'prebattle';
          render();
        } else refreshOops(r);
        return;
      }

      case 'retreatEmergency':
      case 'retreatDefeat': {
        const mode = t === 'retreatDefeat' ? 'defeat' : 'emergency';
        const p = V.Expedition.previewRetreat(state, mode);
        if (p.ok) {
          const msg = mode === 'emergency'
            ? `紧急撤退？\n\n保留 ${p.keepParts.length} 件新纹路，丢弃 ${p.lostParts.length} 件。\n金币 +${p.gold}，遗物 +${p.shards}，压力 +${p.stress}。\n本次不算合格撤离。`
            : `确认败退？\n\n本局新收获全失，原有装备与板面纹路保留，压力 +${p.stress}。`;
          const field = D().manuscript(state.run.fieldManuscript);
          if (!window.confirm(msg + (field ? `\n将遗失随行拓本「${field.name}」。` : ''))) return;
        }
        const r = run(() => V.Expedition.retreat(state, mode));
        if (r && r.ok) { ui.screen = 'settlement'; render(); }
        else refreshOops(r);
        return;
      }

      /* ---------- 战斗 ---------- */
      case 'setTactic': {
        const order = { balance: 'focus', focus: 'safe', safe: 'balance' };
        const r = run(() => V.Combat.setTactic(state, order[state.run.battle.tactic] || 'focus'));
        if (r && r.ok) render();
        return;
      }

      case 'cycleSpeed':
        ui.speed = ui.speed === 1 ? 2 : ui.speed === 2 ? 3 : 1;
        V.View.updateHud(state);
        return;

      case 'togglePause':
        ui.paused = !ui.paused;
        render();
        return;

      case 'reviewNow': {
        const r = V.Combat.prepareResult(state);
        if (!r.ok) { toast(r.error.message || '还不能结算'); return; }
        state.run.stage = 'battleReview';
        ui.screen = 'review';
        persistSoon();
        render();
        return;
      }

      case 'confirmResult': {
        const r = run(() => V.Encounter.confirm(state));
        if (r && r.ok) { ui.screen = 'loot'; render(); toast('结果已确认，奖励只发一次'); }
        else refreshOops(r);
        return;
      }

      /* ---------- 掉落 ---------- */
      case 'groundPick': {
        const item = [...document.querySelectorAll('[data-ground-item]')].find(node => node.dataset.token === action.token);
        if (item && !item.disabled) item.click();
        return;
      }

      case 'takeIngredient':
      case 'takeMeal':
      case 'dropIngredient': {
        const r = run(() => V.Expedition[t](state, action.id));
        if (r.ok) {
          render();
          const spec = (t === 'takeMeal' ? V.Kitchen.RECIPES : V.Kitchen.INGREDIENTS)[action.id];
          toast((t === 'dropIngredient' ? '已丢弃' : '已拾取') + spec.name + ' ×1');
        }
        return;
      }

      case 'cookRecipe': {
        if (ui.cooking || ui.modal || !['kitchen', 'campNode'].includes(ui.screen) || !V.Kitchen.canCook(state, action.id)) return;
        const reduce = state.settings?.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
        const cooking = { id: action.id, scope: cookingScope(), started: performance.now() };
        ui.cooking = cooking;
        render();
        cookTimer = setTimeout(() => {
          if (ui.cooking !== cooking || cooking.scope !== cookingScope()) return;
          ui.cooking = null;
          const result = run(() => V.Kitchen.cook(state, cooking.id));
          render();
          if (result.ok) toast(`${V.Kitchen.RECIPES[cooking.id].name}已装进背包 ×1`);
        }, reduce ? 120 : 700);
        return;
      }

      case 'packRotate': {
        if (!V.UI.packEditable(state,ui)) return;
        const E = V.Expedition, token = action.token, slots = E.packSlots(state);
        const cells = slots.flatMap((key,i)=>key === token ? [i] : []);
        if (!cells.length) return;
        const origin = Math.floor(cells[0]/6)*6 + Math.min(...cells.map(i=>i%6));
        const turn = action.turn ?? (E.itemTurn(state,token)+1)%4;
        const result = run(()=>E.turnPack(state,token,action.to ?? origin,turn));
        if (result.ok) ui.packSelection = E.packSlots(state).indexOf(token);
        ui.packMessage = result.ok ? '' : result.error.message;
        if (ui.modal) renderModal(); else render();
        return;
      }
      case 'groundRotate': {
        const found = ui.groundSurvey?.finds.get(action.token);
        if (ui.modal || ui.screen !== 'loot' || !found || performance.now() < found.end) return;
        dispatch({type:'groundPlace',token:action.token,to:found.at,fromGround:true,turn:(V.Expedition.itemTurn(state,action.token,true)+1)%4});
        return;
      }
      case 'groundDrop': {
        if (ui.modal || ui.screen !== 'loot') return;
        const result = run(() => V.Expedition.takeLootAt(state, action.token, Number(action.to),undefined,action.turn));
        ui.packMessage = result.ok ? '' : result.error.message;
        ui.packSelection = null;
        render();
        return;
      }

      case 'packToGround':
      case 'groundPlace': {
        if (ui.modal || ui.screen !== 'loot') return;
        const token = action.token || action.id;
        const fromGround = t === 'groundPlace' && !!action.fromGround;
        const to = t === 'packToGround' ? V.UI.firstGroundSpace(state, ui, token) : Number(action.to);
        const placement = V.UI.previewGroundDrop(state, ui, token, to, fromGround,action.turn);
        if (!placement.ok) { ui.packMessage = placement.reason; toast(placement.reason); render(); return; }
        const result = run(() => {
          const moved = fromGround ? V.State.ok(V.State.clone(state), [], { token }) : V.Expedition.putOnGround(state, token,action.turn);
          if (moved.ok) {
            if (action.turn != null) (moved.state.run.groundTurns ||= {})[moved.token || token] = action.turn;
            V.UI.saveGroundPlacement(moved.state, ui, moved.token || token, placement.at);
          }
          return moved;
        });
        ui.packMessage = result.ok ? '' : result.error.message;
        ui.packSelection = null;
        render();
        return;
      }

      case 'lootTake': {
        const r = run(() => V.Expedition.resolveLoot(state, action.id, 'take'));
        if (r && r.ok) render();
        else refreshOops(r);
        return;
      }

      case 'lootDiscard': {
        const r = run(() => V.Expedition.resolveLoot(state, action.id, 'discard'));
        if (r && r.ok) { ui.replaceFor = null; render(); }
        else refreshOops(r);
        return;
      }

      case 'lootReplacePick':
        ui.replaceFor = ui.replaceFor === action.id ? null : action.id;
        render();
        return;

      case 'lootReplace': {
        const r = run(() => V.Expedition.resolveLoot(state, action.id, 'replace:' + action.drop));
        if (r && r.ok) { ui.replaceFor = null; render(); }
        else refreshOops(r);
        return;
      }

      case 'finishNode': {
        ui.packSelection = null;
        ui.packMessage = '';
        const r = run(() => V.Expedition.finishNode(state, ui.screen === 'loot'));
        if (r && r.ok) render();
        else refreshOops(r);
        return;
      }

      /* ---------- 事件 / 营火 / 商人 / 祝福 ---------- */
      case 'chooseEvent': {
        const r = run(() => V.Expedition.chooseEvent(state, action.id));
        if (r && r.ok) render();
        else refreshOops(r);
        return;
      }

      case 'eventDone': {
        if (state.run.pendingLoot.length) { ui.screen = 'loot'; render(); return; }
        const r = run(() => V.Expedition.finishNode(state, ui.screen === 'loot'));
        if (r && r.ok) render();
        else refreshOops(r);
        return;
      }

      case 'campRest': {
        const r = run(() => V.Expedition.campRest(state));
        if (r && r.ok) { render(); toast('休息过了'); }
        return;
      }

      case 'buyOffer': {
        const r = run(() => V.Expedition.buy(state, action.id));
        if (r && r.ok) render();
        else refreshOops(r);
        return;
      }

      case 'chooseBlessing': {
        const r = run(() => V.Expedition.chooseBlessing(state, action.id));
        if (r && r.ok) render();
        else refreshOops(r);
        return;
      }

      case 'settleClose': {
        const next = V.State.clone(state);
        next.settlement = null;
        state = next;
        persistSoon();
        ui.screen = 'camp';
        render();
        return;
      }

      default:
        return;
    }
  }

  /* ------------------------------ 工坊辅助 ------------------------------ */

  function selectFieldRune(id) {
    if (ui.wsMode !== 'inscribe' || !state.run?.bag.includes(id) || ui.inscribeItem === id) return;
    ui.wsDraft = ui.wsDraft.filter(p => p.itemId !== ui.inscribeItem);
    ui.inscribeItem = id;
    ui.wsHist = [];
    ui.wsRedo = [];
  }

  function openWorkshop(unitId, selectedId) {
    const unit = state.roster.find((u) => u.id === unitId) || state.roster[0];
    ui.wsMode = 'workshop';
    ui.wsPalette = 'etchings';
    ui.wsUnit = unit.id;
    ui.wsDraft = V.State.clone(unit.board.placements);
    ui.wsPick = null;
    ui.wsRot = 0;
    ui.wsMirror = false;
    ui.wsHist = [];
    ui.wsRedo = [];
    ui.wsErrors = [];
    ui.wsLocked = [];
    ui.wsMsPoses = {};
    const id = selectedId || unit.manuscript?.id || state.manuscriptVault[0]?.id || D().MANUSCRIPT_ORDER[0];
    selectWorkshopManuscript(id, V.State.manuscriptsOf(unit).find((m) => m.id === id));
  }

  function selectWorkshopManuscript(id, pose) {
    ui.wsMsId = id;
    ui.wsMsRot = pose?.rotation || 0;
    ui.wsMsMir = !!pose?.mirrorY;
    ui.wsMsOx = pose?.x ?? null;
    ui.wsMsOy = pose?.y ?? null;
    ui.wsMsSpotIdx = null;
    ui.wsErrors = [];
  }

  function saveWorkshop(next, selectedId, message) {
    const r = V.Roster.saveBoard(next, ui.wsUnit, ui.wsDraft);
    const check = r.ok ? V.State.validate(r.state) : r;
    if (!check.ok) {
      ui.wsErrors = check.details || check.errors || [check.error.message];
      render();
      toast(ui.wsErrors[0]);
      return;
    }
    state = r.state;
    persistSoon();
    openWorkshop(ui.wsUnit, selectedId);
    render();
    toast(message);
  }

  function pushHistory() {
    ui.wsHist.push(V.State.clone(ui.wsDraft));
    if (ui.wsHist.length > 40) ui.wsHist.shift();
    ui.wsRedo = [];
  }

  const DIR_DELTA = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  const DIR_OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };

  /** 快速在异形板面上找一组保留既有件或可选子集且连通输出的摆法，全走 Circuit.preview 校验。 */
  function findAutoInscribeLayout(st, unit, plate, itemIds, opts) {
    const o = opts || {};
    const packAll = o.packAll !== false;
    const maxLoad = o.maxLoad != null ? o.maxLoad : Infinity;
    const terms = Object.values(plate.terminals || {});
    const inTerms = terms.filter((t) => t.role === 'in');
    const outTerms = terms.filter((t) => t.role === 'out');
    const candsByItem = itemIds.map((id) => {
      const it = st.itemsById[id];
      const tpl = D().template(it.templateId);
      const list = [];
      for (let m = 0; m < 2; m++) {
        for (let r = 0; r < 4; r++) {
          const tf = V.Circuit.transformTemplate(tpl, r, !!m);
          for (let y = 0; y < plate.size; y++) {
            for (let x = 0; x < plate.size; x++) {
              if (!tf.cells.every((c) => plate.cells.has((c.x + x) + ',' + (c.y + y)))) continue;
              const cellKeys = tf.cells.map((c) => (c.x + x) + ',' + (c.y + y));
              const ports = tf.ports.map((p) => ({
                role: p.role, dir: p.dir,
                x: p.cell[0] + x, y: p.cell[1] + y,
              }));
              const isStart = ports.some((p) => p.role === 'in' && inTerms.some((t) => t.cell[0] === p.x && t.cell[1] === p.y && t.dir === p.dir));
              const isEnd = ports.some((p) => p.role === 'out' && outTerms.some((t) => t.cell[0] === p.x && t.cell[1] === p.y && t.dir === p.dir));
              list.push({ pl: { itemId: id, x, y, rotation: r, mirrorY: !!m }, cellKeys, ports, isStart, isEnd, load: tpl.load || 0 });
            }
          }
        }
      }
      return list;
    });

    const disjoint = (used, cellKeys) => cellKeys.every((k) => !used.has(k));
    const packRest = (chosenIdx, chosenList, used) => {
      const restIds = itemIds.map((_, i) => i).filter((i) => !chosenIdx.includes(i));
      const fill = (ri) => {
        if (ri >= restIds.length) {
          const draft = chosenList.map((c) => c.pl);
          const pv = V.Circuit.preview(st, unit.id, draft);
          return pv.ok ? draft : null;
        }
        const cands = candsByItem[restIds[ri]];
        for (let i = 0; i < cands.length; i++) {
          const cand = cands[i];
          if (!disjoint(used, cand.cellKeys)) continue;
          cand.cellKeys.forEach((k) => used.add(k));
          chosenList.push(cand);
          const hit = fill(ri + 1);
          if (hit) return hit;
          chosenList.pop();
          cand.cellKeys.forEach((k) => used.delete(k));
        }
        return null;
      };
      return fill(0);
    };

    const canFollow = (a, b) => a.ports.some((op) => {
      if (op.role !== 'out') return false;
      const [dx, dy] = DIR_DELTA[op.dir];
      const nx = op.x + dx;
      const ny = op.y + dy;
      return b.ports.some((ip) => ip.role === 'in' && ip.x === nx && ip.y === ny && ip.dir === DIR_OPP[op.dir]);
    });

    const searchChain = (idxList, chosen, used, loadSum) => {
      if (loadSum > maxLoad) return null;
      const last = chosen[chosen.length - 1];
      if (last.isEnd) {
        if (!packAll) {
          const draft = chosen.map((c) => c.pl);
          const pv = V.Circuit.preview(st, unit.id, draft);
          if (pv.ok) return draft;
        } else {
          const res = packRest(idxList, chosen.slice(), new Set(used));
          if (res) return res;
        }
      }
      if (chosen.length >= itemIds.length) return null;
      for (let ni = 0; ni < itemIds.length; ni++) {
        if (idxList.includes(ni)) continue;
        const cands = candsByItem[ni];
        for (let ci = 0; ci < cands.length; ci++) {
          const c = cands[ci];
          if (loadSum + c.load > maxLoad) continue;
          if (!disjoint(used, c.cellKeys) || !canFollow(last, c)) continue;
          idxList.push(ni);
          chosen.push(c);
          c.cellKeys.forEach((k) => used.add(k));
          const hit = searchChain(idxList, chosen, used, loadSum + c.load);
          if (hit) return hit;
          c.cellKeys.forEach((k) => used.delete(k));
          chosen.pop();
          idxList.pop();
        }
      }
      return null;
    };

    for (let si = 0; si < itemIds.length; si++) {
      const starts = candsByItem[si].filter((c) => c.isStart);
      for (let i = 0; i < starts.length; i++) {
        const used = new Set(starts[i].cellKeys);
        const hit = searchChain([si], [starts[i]], used, starts[i].load);
        if (hit) return hit;
      }
    }

    /* 退化路径：没有蚀刻法（或蚀刻法只给两个能量点）时凑不出一条从入口到出口的链，
       但仍然应该给玩家一个「几何合法」的推荐布局，而不是直接拒绝。 */
    const fallback = (() => {
      const chosen = [];
      const used = new Set();
      for (let i = 0; i < itemIds.length; i++) {
        const cands = candsByItem[i];
        const pickIdx = cands.findIndex((c) => disjoint(used, c.cellKeys));
        if (pickIdx < 0) return null;
        const c = cands[pickIdx];
        c.cellKeys.forEach((k) => used.add(k));
        chosen.push(c.pl);
      }
      const pv = V.Circuit.preview(st, unit.id, chosen);
      return pv.ok ? chosen : null;
    })();
    return fallback;
  }

  /** 工坊智能接通：在当前板面+仓库可用纹路中寻一条最省件的连通方案（受负荷上限约束）。 */
  function findSmartConnectLayout(st, unit, plate, itemIds, loadCap) {
    return findAutoInscribeLayout(st, unit, plate, itemIds, { packAll: false, maxLoad: loadCap });
  }

  /** 原地旋转/翻转若踩出板边或与纹路碰撞，附近 ±2 格内寻找最近的合法落点让位。 */
  function findNudgeFit(itemId, shape, x0, y0) {
    const offsets = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];
    for (let i = 0; i < offsets.length; i++) {
      const ax = x0 + offsets[i][0];
      const ay = y0 + offsets[i][1];
      if (checkDropValid({ id: itemId, shape }, { x: ax, y: ay }).ok) return { x: ax, y: ay };
    }
    return null;
  }

  /** 工坊手动试铺与双击共用当前预览的拓片和草稿。 */
  function findQuickPlaceSpot(itemId, prefRot, prefMir) {
    const unit = V.UI.workshopUnit(state.roster.find(u => u.id === ui.wsUnit), ui);
    if (!unit) return null;
    const plate = V.Circuit.plateOf(unit);
    const ms = V.UI.resolveManuscript(unit, plate, ui, V.Circuit.layout(state, ui.wsDraft));
    return V.Circuit.suggestPlacement(state, unit, ui.wsDraft, itemId, ms, prefRot, prefMir);
  }

  /** 预设只使用已拥有的纹路，选中后的改动留在草稿。 */
  function buildPreset(st, unit, preset) {
    const previewState = { ...st, roster: [unit] };
    const pool = [...st.stash, ...unit.board.placements.map((p) => p.itemId)];

    const basePlacements = [];
    for (const slot of preset.layout) {
      const part = pool.map((id) => st.itemsById[id])
        .find((it) => it && it.kind === 'circuit' && it.templateId === slot.templateId
          && !basePlacements.some((p) => p.itemId === it.id));
      if (!part) return { ok: false, reason: `缺少${D().template(slot.templateId).name}` };
      basePlacements.push({
        itemId: part.id, x: slot.x, y: slot.y,
        rotation: slot.rotation || 0, mirrorY: !!slot.mirrorY,
      });
    }

    const plate = V.Circuit.plateOf(unit);
    let chosen = basePlacements;
    let pv = V.Circuit.preview(previewState, unit.id, chosen);
    if (!pv.ok && plate.generated) {
      let found = null;
      for (let d = 1; d <= 8 && !found; d++) {
        for (let dy = -d; dy <= d && !found; dy++) {
          for (let dx = -d; dx <= d && !found; dx++) {
            if (Math.abs(dx) + Math.abs(dy) !== d) continue;
            const shifted = basePlacements.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
            const testPv = V.Circuit.preview(previewState, unit.id, shifted);
            if (testPv.ok) found = { shifted, testPv };
          }
        }
      }
      if (found) {
        chosen = found.shifted;
        pv = found.testPv;
      }
    }
    if (!pv.ok) return { ok: false, reason: pv.errors.join('；') };

    return { ok: true, placements: chosen };
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function findAction(node) {
    let el = node;
    while (el && el !== document) {
      if (el.dataset && el.dataset.act) return el;
      el = el.parentNode;
    }
    return null;
  }

  /* ------------------------------ 板面拖拽 ------------------------------ */
  /* 只在这里改 UI，落点时才 dispatch 一次：拖动过程不重绘，不碰 state。 */
  let drag = null;
  let suppressClick = false;

  function activePlate() {
    const unit = state && (state.roster.find((u) => u.id === ui.wsUnit) || state.roster[0]);
    return unit ? V.Circuit.plateOf(unit) : null;
  }

  function plateBounds(plate) {
    if (!plate) return { minX: 0, maxX: 3, minY: 0, maxY: 3 };
    if (!plate.generated) {
      const n = (plate.size || 4) - 1;
      return { minX: 0, maxX: n, minY: 0, maxY: n };
    }
    const cells = plate.cellsList || [...plate.cells].map((k) => k.split(',').map(Number));
    if (!cells.length) return { minX: 0, maxX: 6, minY: 0, maxY: 6 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    cells.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    return { minX, maxX, minY, maxY };
  }

  function boardGrid(svg) {
    return {
      cell: Number(svg.dataset.cell) || 60,
      gx: Number(svg.dataset.gx) || 0,
      gy: Number(svg.dataset.gy) || 0,
      n: Number(svg.dataset.n) || 7,
    };
  }

  /** 屏幕坐标 → 原始网格坐标（0..n-1），不筛空格，供悬停与多格边界拖拽使用 */
  function cellFromPointRaw(svg, clientX, clientY) {
    if (!svg || !svg.getScreenCTM || !svg.createSVGPoint) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    const g = boardGrid(svg);
    const x = Math.floor((p.x - g.gx) / g.cell);
    const y = Math.floor((p.y - g.gy) / g.cell);
    if (x < 0 || y < 0 || x >= g.n || y >= g.n) return null;
    return { x, y };
  }

  /** 屏幕坐标 → 板面格子；异形板面只认 plate.cells，经典模式认 0..n-1 */
  function cellFromPoint(svg, clientX, clientY) {
    const raw = cellFromPointRaw(svg, clientX, clientY);
    if (!raw) return null;
    const plate = activePlate();
    if (plate && plate.generated && !plate.cells.has(raw.x + ',' + raw.y)) return null;
    return raw;
  }

  /** 拖拽落点智能吸附：先试理想锚点，若边角贴空或撞邻件，则在半径 1 格内找最近合法贴位 */
  function bestDragAnchor(itemId, shape, rawCell, grabDx, grabDy, kind) {
    if (!shape || !rawCell) return null;
    const plate = activePlate();
    const raw = { x: rawCell.x - grabDx, y: rawCell.y - grabDy };
    if (kind === 'ms' || kind === 'msNew') return { anchor: raw, valid: checkDropValid({ id: itemId, shape, kind }, raw) };
    const clamped = clampAnchor(shape, raw, plate);
    const direct = checkDropValid({ id: itemId, shape, kind }, clamped);
    if (direct.ok) return { anchor: clamped, valid: direct };

    /* 某些异形空角（如分流器左上角为空）未夹取反而能合法落子，亦纳入候选 */
    const rawValid = (raw.x !== clamped.x || raw.y !== clamped.y)
      ? checkDropValid({ id: itemId, shape, kind }, raw)
      : null;
    if (rawValid && rawValid.ok) return { anchor: raw, valid: rawValid };

    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (let i = 0; i < dirs.length; i++) {
      const cand = { x: raw.x + dirs[i][0], y: raw.y + dirs[i][1] };
      const v = checkDropValid({ id: itemId, shape, kind }, cand);
      if (v.ok) return { anchor: cand, valid: v };
    }
    return { anchor: clamped, valid: direct };
  }

  /** 按当前板面实际包围盒夹取锚点，不再写死 4x4 的 3 */
  function clampAnchor(shape, cell, plateIn) {
    const b = plateBounds(plateIn || activePlate());
    return {
      x: Math.max(b.minX - shape.minX, Math.min(b.maxX - shape.maxX, cell.x)),
      y: Math.max(b.minY - shape.minY, Math.min(b.maxY - shape.maxY, cell.y)),
    };
  }

  /** 实时判断悬停锚点是否合法（不改 state，异形板面只查 plate.cells 与已占格）。 */
  function checkDropValid(d, anchor) {
    if (!d || !d.shape || !anchor) return { ok: false, conflicts: new Set(), reason: '' };
    const unit = state.roster.find((u) => u.id === ui.wsUnit);
    const plate = unit ? V.Circuit.plateOf(unit) : null;
    const body = unit ? D().body(unit.bodyPreset) : null;
    const blocked = new Set(plate && !plate.generated && body && body.blocked ? body.blocked.map(([x, y]) => x + ',' + y) : []);
    const replacingFieldRune = ui.wsMode === 'inscribe' && state.run?.bag.includes(d.id);
    const others = (ui.wsDraft || []).filter(p => p.itemId !== d.id && !(replacingFieldRune && p.itemId === ui.inscribeItem));
    const L = V.Circuit.layout(state, others, plate && plate.terminals);
    const used = new Set(L.cells.map((c) => c.x + ',' + c.y));
    const isMs = d.kind === 'ms' || d.kind === 'msNew';
    if (isMs) {
      const free = new Set(V.State.freeManuscriptCells(V.UI.workshopUnit(unit, ui), d.id.slice(3)).map(([x, y]) => x + ',' + y));
      used.clear();
      plate.cells.forEach((key) => { if (!free.has(key)) used.add(key); });
    }

    const conflicts = new Set();
    let hitBlocked = false;
    let hitOverlap = false;
    let hitOutside = false;
    d.shape.cells.forEach((c) => {
      const ax = c.x + anchor.x;
      const ay = c.y + anchor.y;
      const k = ax + ',' + ay;
      if (plate && !plate.cells.has(k)) {
        conflicts.add(k);
        if (!plate.generated && blocked.has(k)) hitBlocked = true;
        else hitOutside = true;
      } else if (!plate && (ax < 0 || ay < 0 || ax >= 4 || ay >= 4)) {
        conflicts.add(k);
        hitOutside = true;
      } else if (used.has(k)) {
        conflicts.add(k);
        hitOverlap = true;
      }
    });
    const reason = hitBlocked
      ? '踩中屏蔽格'
      : hitOverlap
        ? (isMs ? '与其他蚀刻法重叠' : '与其他纹路重叠')
        : hitOutside
          ? (plate && plate.generated ? '不在板面上' : '超出板面')
          : conflicts.size ? '不在板面上' : '';
    return { ok: conflicts.size === 0, conflicts, reason };
  }

  /** 吸附预览：在板面上按纹路真实形状与端口朝向画出半透明虚影，并区分合法/冲突格。 */
  function showDropGhost(svg, shape, anchor, valid) {
    if (!svg) return;
    let g = svg.querySelector('.drop-ghost');
    if (!shape || !anchor) {
      if (g) g.style.display = 'none';
      return;
    }
    if (!g) {
      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'drop-ghost');
      g.setAttribute('pointer-events', 'none');
      svg.appendChild(g);
    }
    g.style.display = '';
    const grid = boardGrid(svg);
    const conflicts = (valid && valid.conflicts) || new Set();
    const cellsHtml = shape.cells.map((c) => {
      const ax = c.x + anchor.x;
      const ay = c.y + anchor.y;
      const bad = conflicts.has(ax + ',' + ay);
      const x = grid.gx + ax * grid.cell;
      const y = grid.gy + ay * grid.cell;
      return `<rect class="drop-ghost-cell ${bad ? 'bad' : 'ok'}" x="${x + 2}" y="${y + 2}"
        width="${grid.cell - 4}" height="${grid.cell - 4}" rx="1"/>`;
    }).join('');
    const html = cellsHtml + `<g transform="translate(${grid.gx + (anchor.x+shape.minX)*grid.cell} ${grid.gy + (anchor.y+shape.minY)*grid.cell})">${previewEngraving(shape, grid.cell)}</g>`;
    if (g.dataset.key !== html) {
      g.innerHTML = html;
      g.dataset.key = html;
    }
  }

  /** 板面格坐标 → 屏幕坐标（幽灵吸附用） */
  function boardPointToScreen(svg, cx, cy) {
    const grid = boardGrid(svg);
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = grid.gx + cx * grid.cell;
    pt.y = grid.gy + cy * grid.cell;
    const p = pt.matrixTransform(ctm);
    return { x: p.x, y: p.y };
  }

  /** 板面一格在屏幕上占多少像素：幽灵要跟板面同尺寸才对得上 */
  function cellPixelSize(svg) {
    const ctm = svg && svg.getScreenCTM();
    return ctm ? Math.hypot(ctm.a, ctm.b) * boardGrid(svg).cell : 0;
  }

  /** 浮动和落点两种预览始终使用当前朝向的同一道刻痕。 */
  function previewEngraving(shape, cell) {
    if (shape.membrane) return V.UI.membraneEngraving(shape.membrane, cell);
    const art = V.RuneArt.image(shape.templateId, { cell, rotation: shape.rot, mirrorY: shape.mir });
    const ports = shape.ports.map(pt => {
      const [dx,dy] = { N: [0,-1], E: [1,0], S: [0,1], W: [-1,0] }[pt.dir];
      return V.UI.portCut((pt.cell[0]-shape.minX+.5)*60 + dx*28, (pt.cell[1]-shape.minY+.5)*60 + dy*28, pt.dir, pt.role, 'lit drop-ghost-port-svg');
    }).join('');
    return art + `<g transform="scale(${cell/60})">${ports}</g>`;
  }

  function buildFloatGhost(shape, cellPx, label) {
    const el = document.createElement('div');
    el.className = 'drag-ghost';
    if (!shape || !cellPx) {
      el.classList.add('drag-ghost-text');
      el.textContent = label || '纹路';
      document.body.appendChild(el);
      return el;
    }
    const gw = (shape.maxX - shape.minX + 1) * cellPx;
    const gh = (shape.maxY - shape.minY + 1) * cellPx;
    el.style.width = gw + 'px';
    el.style.height = gh + 'px';
    shape.cells.forEach((c) => {
      const i = document.createElement('i');
      i.dataset.cx = c.x;
      i.dataset.cy = c.y;
      i.style.left = (c.x - shape.minX) * cellPx + 'px';
      i.style.top = (c.y - shape.minY) * cellPx + 'px';
      i.style.width = cellPx + 'px';
      i.style.height = cellPx + 'px';
      el.appendChild(i);
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'drag-ghost-rune');
    svg.setAttribute('viewBox', `0 0 ${gw} ${gh}`);
    svg.innerHTML = previewEngraving(shape, cellPx);
    el.appendChild(svg);
    shape.cells.forEach((c) => {
      const ov = document.createElement('b');
      ov.className = 'drag-ghost-cell-ov';
      ov.dataset.cx = c.x;
      ov.dataset.cy = c.y;
      ov.style.left = (c.x - shape.minX) * cellPx + 'px';
      ov.style.top = (c.y - shape.minY) * cellPx + 'px';
      ov.style.width = cellPx + 'px';
      ov.style.height = cellPx + 'px';
      el.appendChild(ov);
    });
    const name = document.createElement('span');
    name.className = 'drag-ghost-name';
    name.textContent = shape.name || label || '纹路';
    el.appendChild(name);
    document.body.appendChild(el);
    return el;
  }

  function updateDragVisuals(clientX, clientY) {
    if (!drag) return;
    const rawCell = cellFromPointRaw(drag.svg, clientX, clientY);
    const hitCell = cellFromPoint(drag.svg, clientX, clientY);
    const best = rawCell && drag.shape
      ? bestDragAnchor(drag.id, drag.shape, rawCell, drag.grabDx, drag.grabDy, drag.kind)
      : null;
    /* 光标完全落在空洞上且周围也没有可吸贴位时，若从板内拖出则显示松手卸下 */
    const anchor = best && (best.valid.ok || hitCell) ? best.anchor : null;
    const valid = anchor ? best.valid : (best ? best.valid : null);
    drag.anchor = anchor;
    drag.valid = valid;

    if (drag.ghost) {
      const nameEl = drag.ghost.querySelector('.drag-ghost-name');
      drag.ghost.classList.toggle('bad', !!(valid && !valid.ok));
      drag.ghost.querySelectorAll('.drag-ghost-cell-ov').forEach((ov) => {
        if (!anchor || !valid) { ov.classList.remove('bad'); return; }
        const k = (Number(ov.dataset.cx) + anchor.x) + ',' + (Number(ov.dataset.cy) + anchor.y);
        ov.classList.toggle('bad', valid.conflicts.has(k));
      });
      if (anchor && drag.shape && drag.cellPx) {
        const p = boardPointToScreen(drag.svg, anchor.x + drag.shape.minX, anchor.y + drag.shape.minY);
        if (p) drag.ghost.style.transform = `translate(${p.x}px, ${p.y}px)`;
        drag.ghost.classList.add('snapped');
        if (nameEl) nameEl.textContent = valid && !valid.ok ? `${drag.shape.name} · ${valid.reason}` : drag.shape.name;
      } else if (drag.shape && drag.cellPx) {
        const ox = (drag.grabDx - drag.shape.minX + 0.5) * drag.cellPx;
        const oy = (drag.grabDy - drag.shape.minY + 0.5) * drag.cellPx;
        drag.ghost.style.transform = `translate(${clientX - ox}px, ${clientY - oy}px)`;
        drag.ghost.classList.remove('snapped');
        const outside = drag.from === 'board' && !ui.wsLocked.includes(drag.id) && isWayOutsideBoard(drag.svg, clientX, clientY);
        if (nameEl) nameEl.textContent = outside ? `${drag.shape.name} · 松手卸下` : drag.shape.name;
      } else {
        drag.ghost.style.transform = `translate(${clientX + 12}px, ${clientY + 12}px)`;
      }
    }
    showDropGhost(drag.svg, drag.shape, anchor, valid);
  }

  function isWayOutsideBoard(svg, clientX, clientY) {
    if (!svg) return false;
    const r = svg.getBoundingClientRect();
    return clientX < r.left - 18 || clientX > r.right + 18 || clientY < r.top - 18 || clientY > r.bottom + 18;
  }

  function endDrag() {
    if (!drag) return;
    if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    if (drag.group) drag.group.classList.remove('dragging');
    showDropGhost(drag.svg, null, null, null);
    document.body.classList.remove('is-dragging');
    if (drag.moved) {
      suppressClick = true;
      /* 浏览器跨元素拖拽不一定触发 click；同帧后必须复位，避免吞掉用户下一次真实点击 */
      setTimeout(() => { suppressClick = false; }, 0);
    }
    drag = null;
  }

  function rotateInDrag(step) {
    if (!drag || !drag.moved) return;
    drag.rot = (drag.rot + (step === 3 ? 3 : 1)) % 4;
    refreshDragShape();
    if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    drag.ghost = buildFloatGhost(drag.shape, drag.cellPx, drag.label);
    updateDragVisuals(drag.lastX, drag.lastY);
  }

  function manuscriptDragShape(id, rot, mir) {
    const membrane = V.Manuscript.orient(V.Manuscript.normalize(D().manuscript(id)), rot, mir);
    return {
      name: membrane.name, membrane, minX: 0, minY: 0,
      maxX: Math.max(...membrane.cells.map(c => c[0])), maxY: Math.max(...membrane.cells.map(c => c[1])),
      cells: membrane.cells.map(([x, y]) => ({ x, y })),
    };
  }

  function refreshDragShape() {
    drag.shape = drag.kind === 'ms' || drag.kind === 'msNew'
      ? manuscriptDragShape(drag.msId, drag.rot, drag.mir)
      : V.UI.partShape(state, drag.id, drag.rot, drag.mir);
  }

  function updateHoverGhost(clientX, clientY) {
    const svg = document.querySelector('svg.board');
    if (!svg) return;
    if (!ui.wsPick) { showDropGhost(svg, null, null, null); return; }
    const cell = cellFromPoint(svg, clientX, clientY);
    if (!cell) { showDropGhost(svg, null, null, null); return; }
    const placed = (ui.wsDraft || []).find((p) => p.itemId === ui.wsPick);
    const rot = placed ? placed.rotation : ui.wsRot;
    const mir = placed ? !!placed.mirrorY : !!ui.wsMirror;
    const shape = V.UI && V.UI.partShape ? V.UI.partShape(state, ui.wsPick, rot, mir) : null;
    if (!shape) { showDropGhost(svg, null, null, null); return; }
    /* 鼠标悬停在本件已占据的格子上时不重绘叠影 */
    if (placed && shape.cells.some((c) => c.x + placed.x === cell.x && c.y + placed.y === cell.y)) {
      showDropGhost(svg, null, null, null);
      return;
    }
    showDropGhost(svg, shape, cell, checkDropValid({ id: ui.wsPick, shape }, cell));
  }

  let lastClick = { key: '', ts: 0 };
  let scarHint = null;
  let scarHintTimer = null;

  /** 提示不占格子命中层，保持拖放与点击装配可用。@returns {void} */
  function clearScarHint() {
    clearTimeout(scarHintTimer);
    if (scarHint) scarHint.removeAttribute('aria-describedby');
    scarHint = null;
    document.getElementById('scar-tooltip')?.remove();
  }

  /** 鼠标停留后展示；键盘焦点与触屏点击直接展示。@param {Element|null} node @param {number} x @param {number} y @param {boolean} immediate @returns {void} */
  function queueScarHint(node, x, y, immediate = false) {
    if (node === scarHint) return;
    clearScarHint();
    if (!node || drag || (ui.wsPick && !immediate)) return;
    scarHint = node;
    const show = () => {
      if (!node.isConnected || node !== scarHint) return;
      const tip = document.createElement('div');
      tip.id = 'scar-tooltip';
      tip.className = 'scar-tooltip';
      tip.setAttribute('role', 'tooltip');
      tip.textContent = node.dataset.scarTooltip;
      document.body.appendChild(tip);
      node.setAttribute('aria-describedby', tip.id);
      tip.style.left = Math.max(10, Math.min(innerWidth - tip.offsetWidth - 10, x + 14)) + 'px';
      tip.style.top = Math.max(10, Math.min(innerHeight - tip.offsetHeight - 10, y + 16)) + 'px';
    };
    if (immediate) show();
    else scarHintTimer = setTimeout(show, 550);
  }

  /** 触屏点格查看时不同时选中下面的纹路。@param {PointerEvent} e @returns {void} */
  function touchScarHint(e) {
    if (e.pointerType !== 'touch') return;
    const svg = e.target.closest && e.target.closest('svg.board');
    const cell = svg && cellFromPointRaw(svg, e.clientX, e.clientY);
    const node = cell && svg.querySelector(`[data-scar="${cell.x},${cell.y}"]`);
    if (!node) return;
    queueScarHint(node, e.clientX, e.clientY, true);
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }

  function bind() {
    let lootDrag = null;
    let skipLootClick = false;
    function clearLootTargets() {
      document.querySelectorAll('.loot-page .drop-target').forEach(el => el.classList.remove('drop-target', 'bad-fit'));
    }
    function clearLootDrag() {
      if (!lootDrag) return;
      skipLootClick = lootDrag.moved;
      lootDrag.ghost?.remove();
      lootDrag.source.classList.remove('loot-lifting');
      clearLootTargets();
      lootDrag = null;
    }
    /** 两边都以实际格距计算，地面的图案缺口不改变抓取锚点。 */
    function lootGrid(grid) {
      const ground = grid.matches('.ground-grid'), columns = ground ? Number(grid.dataset.groundColumns) : 6;
      const attribute = ground ? 'data-ground-slot' : 'data-pack-slot';
      const cells = grid.querySelectorAll('[' + attribute + ']');
      const first = cells[0].getBoundingClientRect(), second = cells[1]?.getBoundingClientRect(), below = cells[columns]?.getBoundingClientRect();
      const style = getComputedStyle(grid);
      return { grid, ground, columns, attribute, cells, left: first.left, top: first.top,
        cellW: first.width, cellH: first.height,
        pitchX: second ? second.left - first.left : first.width + (parseFloat(style.columnGap) || 0),
        pitchY: below ? below.top - first.top : first.height + (parseFloat(style.rowGap) || 0) };
    }
    function sizeLootGhost(d, metric) {
      const width = Math.max(...d.cells.map(c => c[0])) * metric.pitchX + metric.cellW;
      const height = Math.max(...d.cells.map(c => c[1])) * metric.pitchY + metric.cellH;
      d.ghost.style.width = width + 'px';
      d.ghost.style.height = height + 'px';
      d.ghost.querySelectorAll(':scope > i').forEach((cell, i) => {
        const [cx, cy] = d.cells[i];
        Object.assign(cell.style, { left: cx * metric.pitchX + 'px', top: cy * metric.pitchY + 'px', width: metric.cellW + 'px', height: metric.cellH + 'px' });
      });
    }
    function moveLootDrag(x, y) {
      const d = lootDrag;
      if (!d) return;
      if (!d.moved && Math.hypot(x - d.x, y - d.y) < 5) return;
      if (!d.moved) {
        d.moved = true;
        const ghost = document.createElement('div');
        ghost.className = 'loot-drop-ghost';
        ghost.style.setProperty('--item-turn',d.turn*90+'deg');
        ghost.setAttribute('aria-hidden', 'true');
        for (const cell of d.cells) ghost.appendChild(document.createElement('i'));
        if (d.art) {
          const face = document.createElement('span');
          face.className = 'ground-face';
          Object.assign(face.style, { left: '0', top: '0', width: '100%', height: '100%' });
          face.appendChild(d.art.cloneNode(true));
          ghost.appendChild(face);
        }
        document.body.appendChild(ghost);
        d.ghost = ghost;
        d.source.classList.add('loot-lifting');
      }
      d.lastX = x; d.lastY = y;
      clearLootTargets();
      d.destination = null;
      d.preview = null;
      const hit = document.elementFromPoint(x, y), grid = hit?.closest('.loot-page .ground-grid, .loot-page .pack-grid');
      let metric = lootGrid(grid || document.querySelector('.loot-pack .pack-grid'));
      let anchor = null;
      const diner = hit?.closest('.loot-page .pack-diner');
      if (!d.fromGround && !d.overflow && d.token.startsWith('meal:') && diner) {
        d.preview = { ok: V.Kitchen.canEat(state, V.Expedition.stackSpec(d.token).id, diner.dataset.id), reason: '这位队员暂时不需要用餐' };
        d.destination = { kind: 'diner', id: diner.dataset.id };
        diner.classList.add('drop-target');
        diner.classList.toggle('bad-fit', !d.preview.ok);
      } else if (grid) {
        const col = Math.floor((x - metric.left) / metric.pitchX), row = Math.floor((y - metric.top) / metric.pitchY);
        const hovered = row * metric.columns + col;
        if (col >= 0 && col < metric.columns && row >= 0 && hovered < metric.cells.length) {
          const E = V.Expedition, slots = E.packSlots(state), entry = E.stackSpec(d.token);
          const merge = !metric.ground && d.fromGround && entry && E.stackSpec(slots[hovered])?.base === entry.base;
          const ax = col - d.grabX, ay = row - d.grabY;
          const to = merge ? hovered : ax < 0 || ax >= metric.columns || ay < 0 ? -1 : ay * metric.columns + ax;
          if (metric.ground) {
            d.preview = V.UI.previewGroundDrop(state, ui, d.token, to, d.fromGround,d.turn);
            d.destination = { kind: 'ground', to };
            anchor = d.preview.at;
          } else if (d.fromGround) {
            d.preview = E.previewLootDrop(state, d.token, to,undefined,d.turn);
            d.destination = { kind: 'pack', to };
            anchor = merge ? Math.min(...d.preview.indices) : to;
          } else if (d.turn !== E.itemTurn(state,d.token) && !d.overflow) {
            d.preview = E.turnedPackDrop(state,d.token,to,d.turn);
            d.destination = {kind:'rotate',to};
            anchor = to;
          } else if (d.overflow) {
            d.preview = { ok: false, indices: [hovered], reason: '请先放到地面，再拖入背包空位' };
          } else {
            const result = E.movePack(state, d.from, hovered);
            const dx = col - d.from % 6, dy = row - Math.floor(d.from / 6);
            const indices = slots.flatMap((token, i) => token === d.token ? [i + dx + dy * 6] : []);
            d.preview = { ok: result.ok, indices, reason: result.error?.message };
            d.destination = { kind: 'move', to: hovered };
            anchor = to;
          }
          for (const i of d.preview.indices?.length ? d.preview.indices : [hovered]) {
            const mark = metric.grid.querySelector('[' + metric.attribute + '="' + i + '"]');
            mark?.classList.add('drop-target');
            mark?.classList.toggle('bad-fit', !d.preview.ok);
          }
        }
      }
      sizeLootGhost(d, metric);
      d.ghost.classList.toggle('bad-fit', !!d.preview && !d.preview.ok);
      const at = d.preview?.ok && Number.isInteger(anchor) && anchor >= 0
        ? metric.grid.querySelector('[' + metric.attribute + '="' + anchor + '"]')?.getBoundingClientRect() : null;
      d.ghost.style.transform = `translate(${at ? at.left : x - (d.grabX + .5) * metric.pitchX}px, ${at ? at.top : y - (d.grabY + .5) * metric.pitchY}px)`;
    }
    document.addEventListener('click', e => {
      if (skipLootClick && e.target.closest?.('.loot-page')) {
        skipLootClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
    let shelfDrag = null;
    document.addEventListener('dragstart', e => {
      const cell = e.target.closest?.('[data-act="storeSlot"]');
      if (!cell?.dataset.token) return;
      const layout = V.Expedition.storeLayout(state,ui.stashShelf || 'food');
      const token = cell.dataset.token, origin = layout.places[token].at, index = Number(cell.dataset.id);
      shelfDrag = {token, dx:index%6-origin%6, dy:Math.floor(index/6)-Math.floor(origin/6)};
      e.dataTransfer.setData('text/plain',token);
      const image = cell.closest('.store-grid').querySelector('[data-pack-art="'+CSS.escape(token)+'"]');
      const rect = image.getBoundingClientRect();
      e.dataTransfer.setDragImage(image,e.clientX-rect.left,e.clientY-rect.top);
    });
    document.addEventListener('dragover', e => {
      if (shelfDrag && e.target.closest?.('[data-act="storeSlot"]')) e.preventDefault();
    });
    document.addEventListener('drop', e => {
      const cell = e.target.closest?.('[data-act="storeSlot"]');
      if (!shelfDrag || !cell) return;
      e.preventDefault();
      const index = Number(cell.dataset.id), x = index%6-shelfDrag.dx, y = Math.floor(index/6)-shelfDrag.dy;
      dispatch({type:'storeMove',token:shelfDrag.token,id:x<0 || y<0 ? -1 : y*6+x});
      shelfDrag = null;
    });
    document.addEventListener('dragend', () => { shelfDrag = null; });
    document.addEventListener('keydown', e => {
      if (ui.screen === 'stash' && !ui.modal && ui.storePick && !e.repeat && e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.target.closest?.('input,textarea,select')) {
        e.preventDefault();
        dispatch({type:'storeRotate'});
      }
    });
    document.addEventListener('dragstart', e => {
      if (ui.screen === 'loot' && !ui.modal && e.target.closest?.('[data-ground-item], .loot-pack [data-pack-slot], [data-pack-overflow]')) e.preventDefault();
    });
    document.addEventListener('pointerdown', e => {
      skipLootClick = false;
      if (ui.screen !== 'loot' || ui.modal || e.button !== 0 || e.target.closest?.('[data-act="packToGround"]')) return;
      const source = e.target.closest?.('[data-ground-item], .loot-pack [data-pack-slot], [data-pack-overflow]');
      const token = source?.dataset.token;
      if (!token || source.matches('[data-ground-item]') && source.dataset.scan !== 'revealed') return;
      clearLootDrag();
      const E = V.Expedition, fromGround = source.hasAttribute('data-ground-item');
      const turn = E.itemTurn(state,token,fromGround), cells = E.packShape(state,token,turn);
      if (!cells.length) return;
      const overflow = source.hasAttribute('data-pack-overflow'), slots = E.packSlots(state);
      const indices = slots.flatMap((t, i) => t === token ? [i] : []);
      const from = source.hasAttribute('data-pack-slot') ? Number(source.dataset.packSlot) : null;
      let grabX = 0, grabY = 0;
      if (fromGround) {
        const metric = lootGrid(source.closest('.ground-grid'));
        grabX = Math.floor((e.clientX - metric.left) / metric.pitchX) - Number(source.dataset.groundX);
        grabY = Math.floor((e.clientY - metric.top) / metric.pitchY) - Number(source.dataset.groundY);
      } else if (!overflow) {
        grabX = from % 6 - Math.min(...indices.map(i => i % 6));
        grabY = Math.floor(from / 6) - Math.floor(indices[0] / 6);
      }
      const artRoot = fromGround ? source.querySelector('.ground-face') : overflow ? source : source.closest('.pack-grid').querySelector('[data-pack-art="' + CSS.escape(token) + '"]');
      lootDrag = { source, token, turn, cells, fromGround, overflow, from, grabX, grabY, x: e.clientX, y: e.clientY,
        pointer: e.pointerId, moved: false, art: artRoot?.querySelector('.rune-thumb, .catalogue-icon') };
    });
    document.addEventListener('pointermove', e => {
      if (!lootDrag || lootDrag.pointer !== e.pointerId) return;
      moveLootDrag(e.clientX, e.clientY);
      if (lootDrag.moved) e.preventDefault();
    }, { passive: false });
    document.addEventListener('pointerup', e => {
      if (!lootDrag || lootDrag.pointer !== e.pointerId) return;
      const d = lootDrag;
      if (d.moved) moveLootDrag(e.clientX, e.clientY);
      clearLootDrag();
      if (!d.moved || !d.preview) return;
      if (!d.preview.ok) { ui.packMessage = d.preview.reason; toast(d.preview.reason); render(); return; }
      const target = d.destination;
      if (target.kind === 'ground') dispatch({ type: 'groundPlace', token: d.token, to: target.to, turn:d.turn, fromGround: d.fromGround });
      else if (target.kind === 'pack') dispatch({ type: 'groundDrop', token: d.token, turn:d.turn, to: target.to });
      else if (target.kind === 'diner') dispatch({ type: 'packEat', token: d.token, id: target.id });
      else if (target.kind === 'rotate') dispatch({type:'packRotate',token:d.token,turn:d.turn,to:target.to});
      else if (target.kind === 'move') dispatch({ type: 'packMove', from: d.from, to: target.to });
    });
    document.addEventListener('pointercancel', clearLootDrag);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { clearLootDrag(); return; }
      if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.altKey || e.metaKey || e.repeat ||
        e.target.closest?.('input,textarea,[contenteditable=true]')) return;
      const d = lootDrag, E = V.Expedition;
      if (d?.moved && d.cells.length > 1) {
        e.preventDefault();
        const bottom = Math.max(...d.cells.map(c=>c[1]));
        [d.grabX,d.grabY] = [bottom-d.grabY,d.grabX];
        d.turn = (d.turn+1)%4;
        d.cells = E.packShape(state,d.token,d.turn);
        const face = d.ghost.querySelector('.ground-face');
        if (face && d.token.startsWith('part:')) face.innerHTML = V.RuneArt.thumb(state.itemsById[d.token.slice(5)].templateId,null,d.turn);
        d.ghost.style.setProperty('--item-turn',d.turn*90+'deg');
        moveLootDrag(d.lastX,d.lastY);
      } else if (!d && (ui.screen === 'loot' || ui.modal === 'pack')) {
        const token = E.packSlots(state)[ui.packSelection];
        if (token && E.packShape(state,token).length > 1) { e.preventDefault(); dispatch({type:'packRotate',token}); }
      }
    });
    window.addEventListener('blur', clearLootDrag);
    document.addEventListener('input', e => {
      if (e.target.id === 'modalSaveBox') ui.modalSaveText = e.target.value;
      if (e.target.matches('[data-catalogue-query], [data-catalogue-filter]')) filterCatalogue(e.target.closest('[data-catalogue]'));
    });
    let packDrag = null;
    const slotAt = e => e.target.closest?.('[data-pack-slot]');
    function packArt(slot) {
      return slot?.dataset.token && slot.closest('.pack-grid').querySelector('[data-pack-art="' + CSS.escape(slot.dataset.token) + '"]');
    }
    for (const [event, active] of [['pointerover',true],['pointerout',false],['focusin',true],['focusout',false]]) {
      document.addEventListener(event, e => {
        const art = packArt(slotAt(e));
        if (art) art.classList.toggle('is-pointed', active);
      });
    }
    function clearPackTarget() {
      document.querySelectorAll('.pack-slot.drop-target').forEach(slot => slot.classList.remove('drop-target','bad-fit'));
      document.querySelector('.pack-diner.drop-target')?.classList.remove('drop-target','bad-fit');
      if (packDrag) packDrag.to = null;
    }
    document.addEventListener('dragstart', e => {
      if (ui.screen === 'loot' && !ui.modal) return;
      const slot = slotAt(e);
      if (!slot?.draggable) return;
      const from = Number(slot.dataset.packSlot);
      const slots = V.Expedition.packSlots(state);
      packDrag = {from, token:slots[from], to:null, valid:false, indices:slots.flatMap((token,i) => token === slots[from] ? [i] : [])};
      const art = packArt(slot);
      const bounds = art.getBoundingClientRect();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', slot.getAttribute('aria-label'));
      e.dataTransfer.setDragImage(art, e.clientX-bounds.left, e.clientY-bounds.top);
    });
    document.addEventListener('dragover', e => {
      if (!packDrag) return;
      const diner = e.target.closest?.('.pack-diner');
      if (diner && packDrag.token.startsWith('meal:')) {
        e.preventDefault();
        if (diner.dataset.id !== packDrag.to) {
          clearPackTarget();
          packDrag.to = diner.dataset.id;
          packDrag.valid = V.Kitchen.canEat(state, packDrag.token.slice(5).split('#')[0], diner.dataset.id);
          diner.classList.add('drop-target');
          diner.classList.toggle('bad-fit', !packDrag.valid);
        }
        e.dataTransfer.dropEffect = packDrag.valid ? 'move' : 'none';
        return;
      }
      const slot = slotAt(e);
      if (!slot) { if (packDrag.to !== null) clearPackTarget(); return; }
      e.preventDefault();
      const to = Number(slot.dataset.packSlot);
      if (to !== packDrag.to) {
        clearPackTarget();
        const {from, indices} = packDrag;
        packDrag.to = to;
        packDrag.valid = V.Expedition.movePack(state,from,to).ok;
        const cells = slot.closest('.pack-grid').querySelectorAll('[data-pack-slot]');
        for (const i of indices) {
          const x = i%6 + to%6 - from%6;
          const dest = i + to - from;
          if (x < 0 || x >= 6 || !cells[dest]) continue;
          cells[dest].classList.add('drop-target');
          cells[dest].classList.toggle('bad-fit', !packDrag.valid);
        }
      }
      e.dataTransfer.dropEffect = packDrag.valid ? 'move' : 'none';
    });
    document.addEventListener('drop', e => {
      const diner = e.target.closest?.('.pack-diner');
      if (packDrag?.token.startsWith('meal:') && diner) {
        e.preventDefault();
        const token = packDrag.token;
        clearPackTarget();
        packDrag = null;
        dispatch({ type:'packEat', id:diner.dataset.id, token });
        return;
      }
      const slot = slotAt(e);
      if (!packDrag || !slot) return;
      e.preventDefault();
      const from = packDrag.from;
      clearPackTarget();
      packDrag = null;
      dispatch({ type:'packMove', from, to:Number(slot.dataset.packSlot) });
    });
    document.addEventListener('dragend', () => {
      clearPackTarget();
      packDrag = null;
    });

    document.addEventListener('click', e => {
      const more = e.target.closest('[data-catalogue-more]');
      if (!more) return;
      const book = more.closest('[data-catalogue]');
      filterCatalogue(book, Number(book.dataset.limit) + 8);
    });
    document.addEventListener('pointermove', (e) => {
      const svg = e.target.closest && e.target.closest('svg.board');
      const cell = svg && cellFromPointRaw(svg, e.clientX, e.clientY);
      const node = cell && svg.querySelector(`[data-scar="${cell.x},${cell.y}"]`);
      queueScarHint(node || null, e.clientX, e.clientY);
    });
    document.addEventListener('focusin', (e) => {
      const node = e.target.closest && e.target.closest('[data-scar]');
      if (!node) return;
      const r = node.getBoundingClientRect();
      queueScarHint(node, r.right, r.top, true);
    });
    document.addEventListener('focusout', clearScarHint);
    document.addEventListener('pointerdown', clearScarHint);
    window.addEventListener('scroll', clearScarHint, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearScarHint(); });
    document.addEventListener('click', (e) => {
      /* 只吞掉拖拽落在板面上产生的那一次合成点击；
         否则拖完再点「取消选中」之类的按钮会被白白吃掉一次 */
      if (suppressClick) {
        suppressClick = false;
        const onBoard = e.target && e.target.closest && e.target.closest('svg.board');
        if (onBoard) return;
      }
      const el = findAction(e.target);
      if (!el) {
        /* 点在板面的空白处（底材、毛边、格线）也算「放下」：解除手持。
           单靠每格的命中层并不可靠——有的格会被纹路图形盖住，点了没反应。 */
        const onBoard = e.target && e.target.closest && e.target.closest('svg.board');
        if (onBoard && ui.wsPick) {
          dispatch({ type: 'wsCancelPick' });
        }
        return;
      }
      const act = el.dataset.act;
      const id = el.dataset.id;
      if (el.tagName === 'SELECT') return; /* select 用 change，不阻断 rule 按钮 */

      /* 整页 innerHTML 重绘会打断原生 dblclick；用短时双击识别实现可靠的快速装/卸 */
      if ((ui.screen === 'workshop' || ui.screen === 'campNode') && id && (act === 'wsPick' || act === 'wsGrab')) {
        const now = Date.now();
        const key = (el.dataset.stash ? 'stash:' : 'board:') + id;
        if (lastClick.key === key && now - lastClick.ts < 380) {
          lastClick = { key: '', ts: 0 };
          if (el.dataset.stash && !el.hasAttribute('disabled')) {
            dispatch({ type: 'wsQuickPlace', id });
            return;
          }
          if (!el.dataset.stash && !ui.wsLocked.includes(id)) {
            dispatch({ type: 'wsRemove', id });
            return;
          }
        }
        lastClick = { key, ts: now };
      } else {
        lastClick = { key: '', ts: 0 };
      }

      /* 手持纹路时点膜格放置，否则单击选中这套蚀刻法。 */
      if (act === 'wsMsGrab') {
        if (ui.wsPick) dispatch({ type: 'wsCell', id });
        else dispatch({ type: 'wsMsPick', id: el.dataset.msId });
        return;
      }

      const action = { type: act, id };
      Object.keys(el.dataset).forEach((k) => {
        if (k === 'act' || k === 'id') return;
        action[k] = el.dataset[k];
      });
      dispatch(action, el);
    });

    /* 右键：拖曳中旋手中纹路 / 板上纹路快转 / 已选纹路在板面上就地旋转 */
    document.addEventListener('contextmenu', (e) => {
      if (ui.screen !== 'workshop' && ui.screen !== 'campNode') return;
      if (drag && drag.moved) {
        e.preventDefault();
        rotateInDrag(1);
        return;
      }
      const group = e.target && e.target.closest && e.target.closest('[data-act="wsGrab"]');
      if (group) {
        e.preventDefault();
        const id = group.dataset.id;
        if (!id) return;
        ui.wsPick = id;
        dispatch({ type: 'wsRotate' });
        return;
      }
      if (ui.wsPick && e.target && e.target.closest && e.target.closest('svg.board')) {
        e.preventDefault();
        dispatch({ type: 'wsRotate' });
        updateHoverGhost(e.clientX, e.clientY);
      }
    });

    /* 滚轮：指针在板面上且已选或正拖拽纹路时直接旋转 */
    document.addEventListener('wheel', (e) => {
      if (ui.screen !== 'workshop' && ui.screen !== 'campNode') return;
      if (drag && drag.moved) {
        e.preventDefault();
        rotateInDrag(e.deltaY > 0 ? 1 : 3);
        return;
      }
      if (!ui.wsPick || !e.target || !e.target.closest || !e.target.closest('svg.board')) return;
      e.preventDefault();
      dispatch({ type: 'wsRotate', step: e.deltaY > 0 ? '1' : '3' });
      updateHoverGhost(e.clientX, e.clientY);
    }, { passive: false });

    /* ---- 拖拽装配：从纹路库拖到板面，或拖动板面上已有的纹路 ---- */
    document.addEventListener('pointerdown', (e) => {
      if (ui.screen !== 'workshop' && ui.screen !== 'campNode') return;
      if (e.button != null && e.button !== 0) return;
      const t = e.target;
      if (!t || !t.closest || t.closest('[data-act="wsRemove"]')) return;
      const msGrab = t.closest('[data-act="wsMsGrab"]');
      const msChip = t.closest('[data-ms-drag="1"]');
      const group = t.closest('[data-act="wsGrab"]');
      const stash = t.closest('.part-item[data-stash="1"]');
      if (ui.wsMode === 'inscribe' && (msGrab || msChip)) return;
      if (!msGrab && !msChip && !group && !stash) return;
      if (stash && stash.hasAttribute('disabled')) return;
      const svg = document.querySelector('svg.board');
      if (!svg) return;

      /* 谱表里的蚀刻法：抓起来像纹路一样拖到板面上放 */
      if (msChip) {
        const spec = V.State && V.Data.manuscript ? V.Data.manuscript(msChip.dataset.id) : null;
        if (!spec || !V.Manuscript) return;
        const unit = V.UI.workshopUnit(state.roster.find((u) => u.id === ui.wsUnit), ui);
        const installed = V.State.manuscriptsOf(unit).find((m) => m.id === spec.id);
        const rot = installed?.rotation ?? (ui.wsMsId === spec.id ? ui.wsMsRot : 0);
        const mir = installed?.mirrorY ?? (ui.wsMsId === spec.id && ui.wsMsMir);
        const shape = manuscriptDragShape(spec.id, rot, mir);
        drag = {
          kind: installed ? 'ms' : 'msNew',
          id: 'ms:' + spec.id,
          msId: spec.id,
          rot, mir,
          svg,
          /* 膜跟着指针居中：这两个不填，clampAnchor 会算出 NaN */
          grabDx: Math.floor(shape.maxX / 2),
          grabDy: Math.floor(shape.maxY / 2),
          x0: e.clientX,
          y0: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
          ghost: null,
          cellPx: cellPixelSize(svg),
          label: spec.name,
          shape,
        };
        return;
      }

      /* 蚀刻法膜：和纹路同一条拖拽通道，只是落点写回 wsMsOx/Oy */
      if (msGrab) {
        const data = msGrab.closest('[data-ms-cells]').dataset;
        const ox = Number(data.msOx);
        const oy = Number(data.msOy);
        const cell = cellFromPoint(svg, e.clientX, e.clientY);
        drag = {
          kind: 'ms',
          id: 'ms:' + msGrab.dataset.msId,
          msId: msGrab.dataset.msId,
          rot: Number(data.rot), mir: data.mir === '1',
          svg,
          grabDx: cell ? cell.x - (Number.isFinite(ox) ? ox : 0) : 0,
          grabDy: cell ? cell.y - (Number.isFinite(oy) ? oy : 0) : 0,
          x0: e.clientX,
          y0: e.clientY,
          moved: false,
          ghost: null,
          cellPx: cellPixelSize(svg),
          shape: manuscriptDragShape(msGrab.dataset.msId, Number(data.rot), data.mir === '1'),
          label: D().manuscript(msGrab.dataset.msId).name,
        };
        return;
      }

      const src = group || stash;
      const id = src.dataset.id;
      if (!id) return;

      /* 抓住纹路的哪一格，落下时就对回哪一格，手感不会跳 */
      let grabDx = 0;
      let grabDy = 0;
      if (group) {
        const cell = cellFromPoint(svg, e.clientX, e.clientY);
        if (cell) {
          grabDx = cell.x - (Number(group.dataset.px) || 0);
          grabDy = cell.y - (Number(group.dataset.py) || 0);
        }
      }
      const nameEl = group ? group.querySelector('.part-label') : stash.querySelector('.part-name');
      const placed = (ui.wsDraft || []).find((p) => p.itemId === id);
      const rot = placed ? placed.rotation : (ui.wsPick === id ? ui.wsRot : 0);
      const mir = placed ? !!placed.mirrorY : (ui.wsPick === id ? !!ui.wsMirror : false);
      const shape = V.UI && V.UI.partShape ? V.UI.partShape(state, id, rot, mir) : null;
      drag = {
        id,
        from: group ? 'board' : 'stash',
        svg,
        group,
        rot,
        mir,
        grabDx,
        grabDy,
        x0: e.clientX,
        y0: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
        ghost: null,
        shape,
        cellPx: cellPixelSize(svg),
        label: nameEl ? nameEl.textContent.trim() : '纹路',
      };
    });

    document.addEventListener('pointermove', (e) => {
      if (!drag) {
        if ((ui.screen === 'workshop' || ui.screen === 'campNode') && ui.wsPick) {
          updateHoverGhost(e.clientX, e.clientY);
        }
        return;
      }
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
        drag.moved = true;
        document.body.classList.add('is-dragging');
        if (drag.group) drag.group.classList.add('dragging');
        drag.ghost = buildFloatGhost(drag.shape, drag.cellPx, drag.label);
      }
      e.preventDefault();
      updateDragVisuals(e.clientX, e.clientY);
    }, { passive: false });

    document.addEventListener('pointerup', (e) => {
      if (!drag) { touchScarHint(e); return; }
      const d = drag;
      const rawTarget = d.svg ? cellFromPointRaw(d.svg, e.clientX, e.clientY) : null;
      const best = rawTarget && d.shape
        ? bestDragAnchor(d.id, d.shape, rawTarget, d.grabDx, d.grabDy, d.kind)
        : null;
      const moved = d.moved;
      const anchor = d.anchor || (best && best.anchor) || null;
      const valid = d.valid || (best && best.valid) || null;
      const dropOutside = moved && d.from === 'board' && !ui.wsLocked.includes(d.id)
        && (!valid || !valid.ok) && isWayOutsideBoard(d.svg, e.clientX, e.clientY);
      endDrag();
      if (!moved) { touchScarHint(e); return; }

      if ((d.kind === 'ms' || d.kind === 'msNew') && isWayOutsideBoard(d.svg, e.clientX, e.clientY)) return;
      /* 从谱表拖进来的蚀刻法：落点即装配位置，摆不下就回弹并说明原因 */
      if (d.kind === 'msNew') {
        const raw = rawTarget || (d.svg ? cellFromPoint(d.svg, e.clientX, e.clientY) : null);
        if (!raw) return;
        const snapped = anchor || clampAnchor(d.shape, { x: raw.x - d.grabDx, y: raw.y - d.grabDy });
        if (valid && !valid.ok) {
          toast('放不下：' + (valid.reason || '不在板面上'));
          return;
        }
        dispatch({ type: 'wsMsEquipAt', id: d.msId, ox: snapped.x, oy: snapped.y, rotation: d.rot, mirrorY: d.mir });
        return;
      }

      /* 蚀刻法膜：吸附到格子后写回 UI 状态，保存时再落盘 */
      if (d.kind === 'ms') {
        const raw = rawTarget || (d.svg ? cellFromPoint(d.svg, e.clientX, e.clientY) : null);
        if (!raw) return;
        const snapped = anchor || clampAnchor(d.shape, { x: raw.x - d.grabDx, y: raw.y - d.grabDy });
        if (valid && !valid.ok) { toast('放不下：' + valid.reason); return; }
        dispatch({ type: 'wsMsMove', id: d.msId, ox: snapped.x, oy: snapped.y, rotation: d.rot, mirrorY: d.mir });
        return;
      }

      if (dropOutside) {
        dispatch({ type: 'wsRemove', id: d.id });
        return;
      }
      if (!anchor) return;
      if (!valid || !valid.ok) {
        toast('无法放置：' + (valid && valid.reason ? valid.reason : '不在板面上'));
        ui.wsPick = null;
        render();
        return;
      }
      dispatch({ type: 'wsDrop', id: d.id, cell: anchor.x + ',' + anchor.y, rot: d.rot, mir: d.mir });
    });

    document.addEventListener('pointercancel', () => { endDrag(); });

    document.addEventListener('change', (e) => {
      const el = findAction(e.target);
      if (!el) {
        /* 点在板面的空白处（底材、毛边、格线）也算「放下」：解除手持。
           单靠每格的命中层并不可靠——有的格会被纹路图形盖住，点了没反应。 */
        const onBoard = e.target && e.target.closest && e.target.closest('svg.board');
        if (onBoard && ui.wsPick) {
          dispatch({ type: 'wsCancelPick' });
        }
        return;
      }
      const act = el.dataset.act;
      if (!act || !act.startsWith('rule')) return;
      dispatch({ type: act, id: el.dataset.id }, el);
    });

    document.addEventListener('keydown', (e) => {
      const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
      if ((e.key || '').toLowerCase() === 'b' && !typing && !e.altKey && !e.ctrlKey && !e.metaKey
          && !['title','settlement'].includes(ui.screen) && (!ui.modal || ui.modal === 'pack') && !drag) {
        e.preventDefault();
        if (!e.repeat) dispatch({ type: ui.modal ? 'closeModal' : 'openPack' });
        return;
      }
      if (ui.modal) {
        if (e.key === 'Escape') { e.preventDefault(); dispatch({ type: 'closeModal' }); }
        if (e.key === 'Tab') {
          const controls = [...document.querySelectorAll('.modal-card button:not(:disabled), .modal-card textarea, .modal-card summary')]
            .filter(el => el.getClientRects().length);
          const first = controls[0], last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
        return;
      }
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (ui.screen === 'battle' && e.code === 'Space') {
        e.preventDefault();
        dispatch({ type: 'cycleSpeed' });
        return;
      }
      if (e.code === 'Escape' && ui.screen === 'rules') {
        dispatch({ type: 'ruleCancel' });
        return;
      }
      if (ui.screen === 'workshop' || ui.screen === 'campNode') {
        const k = (e.key || '').toLowerCase();
        if (e.code === 'Escape') {
          if (drag) { endDrag(); return; }
          if (ui.wsPick) { dispatch({ type: 'wsCancelPick' }); return; }
        }
        if (drag && drag.moved && (k === 'r' || k === 'f')) {
          e.preventDefault();
          if (k === 'r') rotateInDrag(1);
          else {
            drag.mir = !drag.mir;
            refreshDragShape();
            if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
            drag.ghost = buildFloatGhost(drag.shape, drag.cellPx, drag.label);
            updateDragVisuals(drag.lastX, drag.lastY);
          }
          return;
        }
        if ((e.ctrlKey || e.metaKey) && k === 'z') {
          e.preventDefault();
          dispatch({ type: e.shiftKey ? 'wsRedo' : 'wsUndo' });
          return;
        }
        if ((e.ctrlKey || e.metaKey) && k === 'y') {
          e.preventDefault();
          dispatch({ type: 'wsRedo' });
          return;
        }
        if ((e.ctrlKey || e.metaKey) && k === 's' && ui.wsMode !== 'inscribe') {
          e.preventDefault();
          dispatch({ type: 'wsSave' });
          return;
        }
        if (k === 'r' && ui.wsPick) {
          e.preventDefault();
          dispatch({ type: 'wsRotate' });
          return;
        }
        if (k === 'f' && ui.wsPick) {
          e.preventDefault();
          dispatch({ type: 'wsFlip' });
          return;
        }
        if ((e.code === 'Delete' || e.code === 'Backspace') && ui.wsPick && (ui.wsDraft || []).some((p) => p.itemId === ui.wsPick)) {
          e.preventDefault();
          dispatch({ type: 'wsRemove', id: ui.wsPick });
        }
      }
    });
  }

  /* ------------------------------ 循环 ------------------------------ */

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    const dt = lastTs ? Math.min(160, ts - lastTs) : 16;
    lastTs = ts;

    if (ui.screen === 'battle') {
      const b = state.run && state.run.battle;
      if (b && !b.over && !ui.paused && !ui.modal) {
        acc += dt * ui.speed;
        let guard = 0;
        while (acc >= STEP_MS && guard++ < 6) {
          acc -= STEP_MS;
          const cur = state.run && state.run.battle;
          if (!cur || cur.over) break;
          const r = V.Combat.step(state);
          if (!r.ok) break;
          state = r.state;
        }
        V.View.updateHud(state);
      }
      V.View.renderFrame(state, ts);

      const bb = state.run && state.run.battle;
      if (bb && bb.over && ui.screen === 'battle' && !ui.reviewShown) {
        ui.reviewShown = true;
        render();
        persistSoon();
      }
      if (bb && !bb.over) ui.reviewShown = false;
    } else {
      acc = 0;
    }
  }

  /* ------------------------------ 启动 ------------------------------ */

  function boot() {
    const loaded = V.Storage.load();
    if (loaded.ok) {
      state = loaded.state;
      ui.hadSave = true;
    } else {
      state = V.State.create();
      ui.hadSave = false;
    }
    if (!state.settings) state.settings = { sound: true, speed: 1, reducedMotion: false };
    ui.speed = state.settings.speed || 1;

    /* 恢复存档停在标题页，不后台推进战斗 */
    ui.screen = 'title';
    render();
    bind();
    window.addEventListener('pagehide', () => {
      if (ui.screen === 'battle' && state.run?.battle) persist();
    });
    rafId = requestAnimationFrame(loop);

    A.Art.preloadArt(['scene.camp']).then(() => {
      if (ui.screen === 'title' || ui.screen === 'camp') render();
    });
  }

  V.App = {
    get state() { return state; },
    get ui() { return ui; },
    dispatch,
    playSfx,
    render,
    boot,
    /** 测试与调试用：直接替换状态并重画。 */
    setState(next) {
      state = next;
      persist();
      syncScreen();
      render();
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(globalThis.Ashen ||= {});
