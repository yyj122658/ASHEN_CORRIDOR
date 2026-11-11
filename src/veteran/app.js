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
    prepSlot: null,
    replaceFor: null,
    histUnit: null,
    shopMsg: '',
    importOpen: false,
    modal: null,
    modalSaveText: '',
    toast: '',
  };

  let state = null;
  let rafId = null;
  let lastTs = 0;
  let acc = 0;
  let lastScreen = null;
  let saveTimer = null;
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
    root.innerHTML = V.UI && V.UI.modalHtml ? V.UI.modalHtml(state, ui) : '';
  }

  function render() {
    const hudEl = document.getElementById('hud');
    const navEl = document.getElementById('nav');
    const stageEl = document.getElementById('stage');
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
    if (stageEl) stageEl.innerHTML = V.UI.screen(state, ui);
    renderModal();

    /* 场景图按页面加载；加载完成后重画一次，让 <img> 真正进 DOM */
    if (V.Art && !artPreloaded.has(ui.screen)) {
      artPreloaded.add(ui.screen);
      V.Art.preloadFor(ui.screen).then((r) => {
        if (r.loaded.length && ui.screen === lastScreen) render();
      });
      if ((ui.screen === 'workshop' || ui.screen === 'camp') && V.RuneArt && V.RuneArt.preload) {
        V.RuneArt.preload();
      }
    }

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

      case 'openSettings':
        ui.modal = 'settings';
        ui.modalSaveText = V.Storage.exportText(state);
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
      case 'go':
        if (state.run) return;
        ui.screen = action.v;
        if (action.v === 'workshop') openWorkshop(state.team.filter(Boolean)[0] || state.roster[0].id);
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
      case 'wsUnit':
        openWorkshop(action.id);
        render();
        return;

      case 'wsPick': {
        const id = action.id;
        const placed = (ui.wsDraft || []).find((p) => p.itemId === id);
        ui.wsPick = id;
        ui.wsRot = placed ? placed.rotation : 0;
        ui.wsMirror = placed ? !!placed.mirrorY : false;
        ui.wsErrors = [];
        render();
        return;
      }

      case 'wsRotate': {
        if (!ui.wsPick) { toast('先选一件构件'); return; }
        const placed = ui.wsDraft.find((p) => p.itemId === ui.wsPick);
        pushHistory();
        if (placed) placed.rotation = (placed.rotation + 1) % 4;
        ui.wsRot = (ui.wsRot + 1) % 4;
        ui.wsErrors = [];
        render();
        return;
      }

      case 'wsFlip': {
        if (!ui.wsPick) { toast('先选一件构件'); return; }
        const placed = ui.wsDraft.find((p) => p.itemId === ui.wsPick);
        pushHistory();
        if (placed) placed.mirrorY = !placed.mirrorY;
        ui.wsMirror = !ui.wsMirror;
        ui.wsErrors = [];
        render();
        return;
      }

      case 'wsRemove': {
        const placed = ui.wsDraft.find((p) => p.itemId === action.id);
        if (!placed) return;
        if (ui.wsLocked.includes(action.id)) { toast('原构件不能在烙印中移除'); return; }
        pushHistory();
        ui.wsDraft = ui.wsDraft.filter((p) => p.itemId !== action.id);
        ui.wsPick = null;
        render();
        return;
      }

      case 'wsCell': {
        if (!ui.wsPick) { toast('先在右侧选一件构件'); return; }
        const [x, y] = String(action.id).split(',').map(Number);
        const existing = ui.wsDraft.find((p) => p.itemId === ui.wsPick);
        pushHistory();
        if (existing) {
          existing.x = x;
          existing.y = y;
          existing.rotation = ui.wsRot;
          existing.mirrorY = ui.wsMirror;
        } else {
          ui.wsDraft.push({ itemId: ui.wsPick, x, y, rotation: ui.wsRot, mirrorY: ui.wsMirror });
        }
        ui.wsErrors = [];
        render();
        return;
      }

      /* 拖拽落点：选中 + 放置一次完成，只重绘一次。支持拖拽中按 R/F 旋转翻转。 */
      case 'wsDrop': {
        const id = action.id;
        const cell = String(action.cell || '').split(',').map(Number);
        if (!id || cell.length !== 2 || !Number.isFinite(cell[0]) || !Number.isFinite(cell[1])) return;
        const existing = (ui.wsDraft || []).find((p) => p.itemId === id);
        const rot = action.rot != null ? Number(action.rot) : (existing ? existing.rotation : ui.wsRot);
        const mir = action.mir != null ? !!action.mir : (existing ? !!existing.mirrorY : ui.wsMirror);

        /* 按真实几何把整块构件夹在 4x4 内：拖到角落也不会半个身子出界 */
        const probe = V.Circuit.layout(state, [{ itemId: id, x: 0, y: 0, rotation: rot, mirrorY: mir }]);
        const abs = (probe.built && probe.built[0] && probe.built[0].abs) || [{ x: 0, y: 0 }];
        const xs = abs.map((c) => c.x);
        const ys = abs.map((c) => c.y);
        const nx = Math.max(-Math.min.apply(null, xs), Math.min(3 - Math.max.apply(null, xs), cell[0]));
        const ny = Math.max(-Math.min.apply(null, ys), Math.min(3 - Math.max.apply(null, ys), cell[1]));

        pushHistory();
        ui.wsPick = id;
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
        render();
        return;
      }

      /* 点一下构件（没有拖动）：等同于选中，之后可用旋转/翻转/点空格移动 */
      case 'wsGrab':
        dispatch({ type: 'wsPick', id: action.id });
        return;

      case 'wsUndo': {
        if (!ui.wsHist.length) return;
        ui.wsRedo.push(V.State.clone(ui.wsDraft));
        ui.wsDraft = ui.wsHist.pop();
        render();
        return;
      }

      case 'wsRedo': {
        if (!ui.wsRedo.length) return;
        ui.wsHist.push(V.State.clone(ui.wsDraft));
        ui.wsDraft = ui.wsRedo.pop();
        render();
        return;
      }

      case 'wsPreset': {
        const preset = D().PRESETS[action.id];
        if (!preset) return;
        pushHistory();
        const unit = state.roster.find((u) => u.id === ui.wsUnit);
        const result = buildPreset(state, unit, preset);
        if (!result.ok) {
          toast(result.reason);
          return;
        }
        ui.wsDraft = result.placements;
        ui.wsPick = null;
        render();
        return;
      }

      case 'wsSave': {
        const r = V.Roster.saveBoard(state, ui.wsUnit, ui.wsDraft);
        if (!r.ok) {
          ui.wsErrors = r.details || [r.error.message];
          render();
          toast('板面不合法');
          return;
        }
        state = r.state;
        persistSoon();
        openWorkshop(ui.wsUnit);
        render();
        toast('板面已保存');
        return;
      }

      case 'inscribeStart': {
        const unit = state.roster.find((u) => u.id === action.id);
        const bagCircuits = state.run.bag.filter((id) => state.itemsById[id] && state.itemsById[id].kind === 'circuit');
        if (!bagCircuits.length) { toast('背包里没有本局获得的回路构件'); return; }
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
          A.Art.preloadArt(['scene.corridor', 'scene.boss']);
          A.SpriteAnim.preload(['blade', 'bone']);
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
            ? `紧急撤退？\n\n保留 ${p.keepParts.length} 件新构件，丢弃 ${p.lostParts.length} 件。\n金币 +${p.gold}，遗物 +${p.shards}，压力 +${p.stress}。\n本次不算合格撤离。`
            : `确认败退？\n\n本局新收获全失，带入的主手与回路保留，压力 +${p.stress}。`;
          if (!window.confirm(msg)) return;
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
        const r = run(() => V.Expedition.finishNode(state));
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
        const r = run(() => V.Expedition.finishNode(state));
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

  function openWorkshop(unitId) {
    const unit = state.roster.find((u) => u.id === unitId) || state.roster[0];
    ui.wsMode = 'workshop';
    ui.wsUnit = unit.id;
    ui.wsDraft = V.State.clone(unit.board.placements);
    ui.wsPick = null;
    ui.wsRot = 0;
    ui.wsMirror = false;
    ui.wsHist = [];
    ui.wsRedo = [];
    ui.wsErrors = [];
    ui.wsLocked = [];
  }

  function pushHistory() {
    ui.wsHist.push(V.State.clone(ui.wsDraft));
    if (ui.wsHist.length > 40) ui.wsHist.shift();
    ui.wsRedo = [];
  }

  /** 预设需要现造构件实例（只在营地里用，会写进 state）。 */
  function buildPreset(st, unit, preset) {
    const next = V.State.clone(st);
    const u = next.roster.find((x) => x.id === unit.id);
    const created = [];

    /* 先把原板面全部退回仓库，再按预设重摆 */
    u.board.placements.forEach((p) => {
      if (!next.stash.includes(p.itemId)) next.stash.push(p.itemId);
    });

    const placements = [];
    for (const slot of preset.layout) {
      let part = next.stash.map((id) => next.itemsById[id])
        .find((it) => it && it.kind === 'circuit' && it.templateId === slot.templateId
          && !created.some((c) => c.itemId === it.id)
          && !placements.some((p) => p.itemId === it.id));
      if (!part) {
        part = V.State.makePart(next, { kind: 'circuit', templateId: slot.templateId });
        next.itemsById[part.id] = part;
        next.stash.push(part.id);
      }
      placements.push({
        itemId: part.id, x: slot.x, y: slot.y,
        rotation: slot.rotation || 0, mirrorY: !!slot.mirrorY,
      });
      created.push({ itemId: part.id });
    }

    const pv = V.Circuit.preview(next, unit.id, placements);
    if (!pv.ok) return { ok: false, reason: pv.errors.join('；') };

    state = next;
    return { ok: true, placements };
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

  function boardGrid(svg) {
    return {
      cell: Number(svg.dataset.cell) || 60,
      gx: Number(svg.dataset.gx) || 0,
      gy: Number(svg.dataset.gy) || 0,
      n: Number(svg.dataset.n) || 4,
    };
  }

  /** 屏幕坐标 → 板面格子；落在板外返回 null */
  function cellFromPoint(svg, clientX, clientY) {
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

  /** 落点夹在 4x4 内：按构件真实包围盒，拖到角落会自己贴回来 */
  function clampAnchor(shape, cell) {
    return {
      x: Math.max(-shape.minX, Math.min(3 - shape.maxX, cell.x)),
      y: Math.max(-shape.minY, Math.min(3 - shape.maxY, cell.y)),
    };
  }

  /** 实时判断悬停锚点是否合法（不改 state，只查当前角色屏蔽格与已放置构件占用）。 */
  function checkDropValid(d, anchor) {
    if (!d || !d.shape || !anchor) return { ok: false, conflicts: new Set(), reason: '' };
    const unit = state.roster.find((u) => u.id === ui.wsUnit);
    const body = unit ? D().body(unit.bodyPreset) : null;
    const blocked = new Set((body && body.blocked || []).map(([x, y]) => x + ',' + y));
    const others = (ui.wsDraft || []).filter((p) => p.itemId !== d.id);
    const L = V.Circuit.layout(state, others);
    const used = new Set(L.cells.map((c) => c.x + ',' + c.y));

    const conflicts = new Set();
    let hitBlocked = false;
    let hitOverlap = false;
    d.shape.cells.forEach((c) => {
      const ax = c.x + anchor.x;
      const ay = c.y + anchor.y;
      const k = ax + ',' + ay;
      if (ax < 0 || ay < 0 || ax >= 4 || ay >= 4) {
        conflicts.add(k);
      } else if (blocked.has(k)) {
        conflicts.add(k);
        hitBlocked = true;
      } else if (used.has(k)) {
        conflicts.add(k);
        hitOverlap = true;
      }
    });
    const reason = hitBlocked ? '踩中屏蔽格' : hitOverlap ? '与其他构件重叠' : conflicts.size ? '超出板面' : '';
    return { ok: conflicts.size === 0, conflicts, reason };
  }

  /** 吸附预览：在板面上按构件真实形状画出半透明虚影，并区分合法/冲突格。 */
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
      svg.appendChild(g);
    }
    g.style.display = '';
    const grid = boardGrid(svg);
    const conflicts = (valid && valid.conflicts) || new Set();
    const html = shape.cells.map((c) => {
      const ax = c.x + anchor.x;
      const ay = c.y + anchor.y;
      const bad = conflicts.has(ax + ',' + ay);
      const x = grid.gx + ax * grid.cell;
      const y = grid.gy + ay * grid.cell;
      return `<rect class="drop-ghost-cell ${bad ? 'bad' : 'ok'}" x="${x + 2}" y="${y + 2}"
        width="${grid.cell - 4}" height="${grid.cell - 4}" rx="2" fill="${bad ? '#D36A65' : shape.color}"/>`;
    }).join('');
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
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    if (!vb || !vb.width || !rect.width) return 0;
    return (rect.width / vb.width) * boardGrid(svg).cell;
  }

  /** 跟着指针走的构件虚影：按真实格子数、端口方向与配色拼出来 */
  function buildFloatGhost(shape, cellPx, label) {
    const el = document.createElement('div');
    el.className = 'drag-ghost';
    if (!shape || !cellPx) {
      el.classList.add('drag-ghost-text');
      el.textContent = label || '构件';
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
      i.style.background = shape.color;
      if (shape.edgeColor) i.style.borderColor = shape.edgeColor;
      el.appendChild(i);
    });
    if (shape.templateId && V.RuneArt && V.RuneArt.image) {
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'drag-ghost-rune');
      svg.setAttribute('viewBox', `0 0 ${gw} ${gh}`);
      svg.innerHTML = V.RuneArt.image(shape.templateId, {
        x: 0, y: 0, cell: cellPx, rotation: shape.rot || 0, mirrorY: !!shape.mir,
      });
      el.appendChild(svg);
    }
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
    const dvec = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
    (shape.ports || []).forEach((pt) => {
      const dot = document.createElement('b');
      dot.className = 'drag-ghost-port ' + (pt.role === 'in' ? 'in' : 'out');
      const [dx, dy] = dvec[pt.dir] || [0, 0];
      const cx = (pt.cell[0] - shape.minX + 0.5 + dx * 0.44) * cellPx;
      const cy = (pt.cell[1] - shape.minY + 0.5 + dy * 0.44) * cellPx;
      dot.style.left = cx + 'px';
      dot.style.top = cy + 'px';
      el.appendChild(dot);
    });
    const name = document.createElement('span');
    name.className = 'drag-ghost-name';
    name.textContent = shape.name || label || '构件';
    el.appendChild(name);
    document.body.appendChild(el);
    return el;
  }

  function updateDragVisuals(clientX, clientY) {
    if (!drag) return;
    const cell = cellFromPoint(drag.svg, clientX, clientY);
    const anchor = cell && drag.shape
      ? clampAnchor(drag.shape, { x: cell.x - drag.grabDx, y: cell.y - drag.grabDy })
      : null;
    drag.anchor = anchor;
    const valid = anchor ? checkDropValid(drag, anchor) : null;
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
    if (drag.moved) suppressClick = true;
    drag = null;
  }

  function bind() {
    document.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      const el = findAction(e.target);
      if (!el) return;
      const act = el.dataset.act;
      const id = el.dataset.id;
      if (el.tagName === 'SELECT') return; /* select 用 change，不阻断 rule 按钮 */
      const action = { type: act, id };
      Object.keys(el.dataset).forEach((k) => {
        if (k === 'act' || k === 'id') return;
        action[k] = el.dataset[k];
      });
      dispatch(action, el);
    });

    /* 右键快速顺时针旋转板面构件 */
    document.addEventListener('contextmenu', (e) => {
      if (ui.screen !== 'workshop' && ui.screen !== 'campNode') return;
      const group = e.target && e.target.closest && e.target.closest('[data-act="wsGrab"]');
      if (!group) return;
      e.preventDefault();
      const id = group.dataset.id;
      if (!id) return;
      ui.wsPick = id;
      dispatch({ type: 'wsRotate' });
    });

    /* ---- 拖拽装配：从构件库拖到板面，或拖动板面上已有的构件 ---- */
    document.addEventListener('pointerdown', (e) => {
      if (ui.screen !== 'workshop' && ui.screen !== 'campNode') return;
      if (e.button != null && e.button !== 0) return;
      const t = e.target;
      if (!t || !t.closest) return;
      const group = t.closest('[data-act="wsGrab"]');
      const stash = t.closest('.part-item[data-act="wsPick"]');
      if (!group && !stash) return;
      if (stash && stash.hasAttribute('disabled')) return;
      const svg = document.querySelector('svg.board');
      if (!svg) return;
      const src = group || stash;
      const id = src.dataset.id;
      if (!id) return;

      /* 抓住构件的哪一格，落下时就对回哪一格，手感不会跳 */
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
        label: nameEl ? nameEl.textContent.trim() : '构件',
      };
    });

    document.addEventListener('pointermove', (e) => {
      if (!drag) return;
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
      if (!drag) return;
      const d = drag;
      const target = d.svg ? cellFromPoint(d.svg, e.clientX, e.clientY) : null;
      const moved = d.moved;
      const anchor = d.anchor || (target && d.shape
        ? clampAnchor(d.shape, { x: target.x - d.grabDx, y: target.y - d.grabDy })
        : null);
      const dropOutside = moved && !target && d.from === 'board' && !ui.wsLocked.includes(d.id) && isWayOutsideBoard(d.svg, e.clientX, e.clientY);
      endDrag();
      if (!moved) return;
      if (dropOutside) {
        dispatch({ type: 'wsRemove', id: d.id });
        return;
      }
      if (!anchor) return;
      dispatch({ type: 'wsDrop', id: d.id, cell: anchor.x + ',' + anchor.y, rot: d.rot, mir: d.mir });
    });

    document.addEventListener('pointercancel', () => { endDrag(); });

    document.addEventListener('change', (e) => {
      const el = findAction(e.target);
      if (!el) return;
      const act = el.dataset.act;
      if (!act || !act.startsWith('rule')) return;
      dispatch({ type: act, id: el.dataset.id }, el);
    });

    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (ui.screen === 'battle' && e.code === 'Space') {
        e.preventDefault();
        dispatch({ type: 'cycleSpeed' });
        return;
      }
      if (e.code === 'Escape' && ui.modal) {
        ui.modal = null;
        renderModal();
        return;
      }
      if (e.code === 'Escape' && ui.screen === 'rules') {
        dispatch({ type: 'ruleCancel' });
        return;
      }
      if (ui.screen === 'workshop' || ui.screen === 'campNode') {
        const k = (e.key || '').toLowerCase();
        if (drag && drag.moved && (k === 'r' || k === 'f')) {
          e.preventDefault();
          if (k === 'r') drag.rot = (drag.rot + 1) % 4;
          else drag.mir = !drag.mir;
          drag.shape = V.UI && V.UI.partShape ? V.UI.partShape(state, drag.id, drag.rot, drag.mir) : drag.shape;
          if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
          drag.ghost = buildFloatGhost(drag.shape, drag.cellPx, drag.label);
          updateDragVisuals(drag.lastX, drag.lastY);
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
      if (b && !b.over && !ui.paused) {
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
