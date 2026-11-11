'use strict';
/* 老兵回路版界面：全部页面 + 4x4 板面 SVG。只读 state，动作交给 app.dispatch。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const D = () => V.Data;
  const ST = () => V.State;

  /* ------------------------------ 基础 ------------------------------ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function btn(label, act, opts) {
    const o = opts || {};
    const cls = ['btn', o.cls || ''].join(' ').trim();
    const idAttr = o.id ? ` id="${o.id}"` : '';
    const data = o.data ? Object.entries(o.data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('') : '';
    const dis = o.disabled ? ' disabled' : '';
    const style = o.style ? ` style="${o.style}"` : '';
    return `<button class="${cls}"${idAttr} data-act="${act}"${data}${dis}${style}>${label}</button>`;
  }

  function bar(v, max, cls) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
    return `<div class="bar ${cls || ''}"><i style="width:${pct.toFixed(1)}%"></i></div>`;
  }

  function panel(title, body, extra) {
    return `<section class="panel ${extra || ''}"><h2 class="panel-h">${title}</h2>${body}</section>`;
  }

  function tag(text, cls) { return `<span class="tag ${cls || ''}">${esc(text)}</span>`; }

  /* ------------------------------ 板面 SVG ------------------------------ */

  const CELL = 60;
  const GX = 34;
  const GY = 26;
  const CW = GX * 2 + CELL * 4;

  const TEMPLATE_COLOR = {
    straight: '#3E5A6E', elbow: '#4A5C7A', splitter: '#6A4E86',
    capacitor: '#7A5A34', threshold: '#6E3E3E', ember: '#7A4A34',
  };

  const DIR_VEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

  function cellXY(x, y) { return [GX + x * CELL, GY + y * CELL]; }

  function portPoint(pt) {
    const [cx, cy] = cellXY(pt.cell[0], pt.cell[1]);
    const [dx, dy] = DIR_VEC[pt.dir];
    return [cx + CELL / 2 + dx * (CELL / 2 - 3), cy + CELL / 2 + dy * (CELL / 2 - 3)];
  }

  function terminalPoint(t, outward) {
    const [cx, cy] = cellXY(t.cell[0], t.cell[1]);
    const [dx, dy] = DIR_VEC[t.dir];
    const d = outward ? CELL / 2 + 13 : CELL / 2 - 3;
    return [cx + CELL / 2 + dx * d, cy + CELL / 2 + dy * d];
  }

  /**
   * boardSvg(state, unitId, placements, opts)
   * opts: {interactive, blocked, errors}
   */
  function boardSvg(state, unitId, placements, opts) {
    const o = opts || {};
    const unit = state.roster.find((u) => u.id === unitId);
    const body = D().body(unit ? unit.bodyPreset : 'sturdy');
    const blocked = new Set((body.blocked || []).map(([x, y]) => x + ',' + y));
    const L = V.Circuit.layout(state, placements);
    const cellsUsed = new Set(L.cells.map((c) => c.x + ',' + c.y));

    const parts = [];
    parts.push(`<svg class="board" viewBox="0 0 ${CW} ${GY * 2 + CELL * 4}"
      xmlns="http://www.w3.org/2000/svg" role="img" aria-label="生命金属回路板面">`);
    parts.push(`<rect class="board-bg" x="0" y="0" width="${CW}" height="${GY * 2 + CELL * 4}" rx="4"/>`);

    /* 屏蔽格 */
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const [px, py] = cellXY(x, y);
        if (blocked.has(x + ',' + y)) {
          parts.push(`<rect class="cell-blocked" x="${px}" y="${py}" width="${CELL}" height="${CELL}"/>
            <path class="hatch" d="M${px} ${py} l${CELL} ${CELL} M${px + CELL} ${py} l${-CELL} ${CELL}"/>`);
        }
      }
    }

    /* 网格 */
    for (let i = 0; i <= 4; i++) {
      parts.push(`<line class="grid" x1="${GX + i * CELL}" y1="${GY}" x2="${GX + i * CELL}" y2="${GY + 4 * CELL}"/>`);
      parts.push(`<line class="grid" x1="${GX}" y1="${GY + i * CELL}" x2="${GX + 4 * CELL}" y2="${GY + i * CELL}"/>`);
    }

    /* 端子 */
    Object.values(D().TERMINALS).forEach((t) => {
      const [x1, y1] = portPointPortLike(t);
      const [x2, y2] = terminalPoint(t, true);
      const isIn = t.role === 'in';
      parts.push(`<line class="link ${isIn ? 'link-in' : 'link-out'}" x1="${x2}" y1="${y2}" x2="${x1}" y2="${y1}"/>`);
      parts.push(`<rect class="terminal ${isIn ? 'terminal-in' : 'terminal-out'}"
        x="${x2 - 3}" y="${y2 - 3}" width="6" height="6"/>`);
      const lx = x2 + (t.dir === 'W' ? -4 : 4);
      const ly = y2 + (t.cell[1] === 0 ? -6 : 12);
      parts.push(`<text class="terminal-label" x="${lx}" y="${ly}" text-anchor="${t.dir === 'W' ? 'end' : 'start'}">${esc(t.name)}</text>`);
    });

    /* 连接线（去重） */
    const seen = new Set();
    const points = new Map();
    L.ports.forEach((p) => points.set(p.itemId + ':' + p.id, portPoint(p)));
    Object.values(D().TERMINALS).forEach((t) => points.set('T:' + t.id, portPointPortLike(t)));
    L.edges.forEach((e) => {
      const k = e.from + '>' + e.to;
      if (seen.has(k)) return;
      seen.add(k);
      const a = points.get(e.from);
      const b = points.get(e.to);
      if (!a || !b) return;
      parts.push(`<line class="link link-flow" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`);
    });

    /* 构件格 */
    L.built.forEach((b) => {
      const color = TEMPLATE_COLOR[b.tpl.id] || '#4A4A5A';
      b.abs.forEach((c) => {
        const [px, py] = cellXY(c.x, c.y);
        parts.push(`<rect class="part-cell" x="${px + 3}" y="${py + 3}" width="${CELL - 6}" height="${CELL - 6}"
          fill="${color}" stroke="rgba(229,219,202,.22)"/>`);
      });
      b.aps.forEach((p) => {
        const [px, py] = portPoint(p);
        const cls = p.role === 'in' ? 'port-in' : 'port-out';
        parts.push(`<circle class="${cls}" cx="${px}" cy="${py}" r="3.2"/>`);
      });
      const [lx, ly] = cellXY(b.abs[0].x, b.abs[0].y);
      parts.push(`<text class="part-label" x="${lx + CELL / 2}" y="${ly + CELL - 9}" text-anchor="middle">${esc(b.tpl.name)}</text>`);
    });

    /* 点选放置 */
    if (o.interactive) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const [px, py] = cellXY(x, y);
          const covered = cellsUsed.has(x + ',' + y);
          const cls = covered ? 'hit covered' : 'hit';
          parts.push(`<rect class="${cls}" x="${px}" y="${py}" width="${CELL}" height="${CELL}"
            data-act="wsCell" data-id="${x},${y}" role="button" tabindex="0">
            <title>格 (${x},${y})${blocked.has(x + ',' + y) ? ' 屏蔽' : ''}</title></rect>`);
        }
      }
    }

    parts.push('</svg>');
    return parts.join('');
  }

  function portPointPortLike(t) {
    /* 端子在网格外侧，端口在格内边缘：用同一套坐标算 */
    return portPoint({ cell: t.cell, dir: t.dir });
  }

  /* ------------------------------ 通用片段 ------------------------------ */

  function partName(state, id) {
    const it = state.itemsById[id];
    if (!it) return '（已失效）';
    if (it.kind === 'weapon') return D().weapon(it.templateId).name;
    return D().template(it.templateId).name;
  }

  function partMeta(state, id) {
    const it = state.itemsById[id];
    if (!it) return '';
    if (it.kind === 'weapon') {
      const w = D().weapon(it.templateId);
      return `主手 · 占 ${w.cells} 格 · ${w.main.energy} 能量`;
    }
    const t = D().template(it.templateId);
    return `回路 · ${t.cells.length} 格 · load ${t.load}`;
  }

  function partIcon(state, id) {
    const it = state.itemsById[id];
    if (!it) return '';
    if (it.kind === 'weapon') return tag('主手', 'tag-weapon');
    return tag('回路', 'tag-circuit');
  }

  /** Gambit 的人类可读描述，避免在界面上暴露内部 id。 */
  function ruleText(r) {
    if (!r) return '';
    const conds = (r.conditions || []).map((c) => {
      const meta = D().CONDITIONS.find((x) => x.id === c.type);
      if (!meta) return String(c.type);
      if (c.type === 'always') return meta.name;
      if (c.type === 'atSlot') return `${meta.name}${c.value}号位`;
      return `${meta.name}${c.value}%`;
    }).join(' 且 ') || '总是';
    const tgt = (D().TARGETS.find((x) => x.id === r.target) || {}).name || r.target;
    const act = (D().ACTIONS.find((x) => x.id === r.action) || {}).name || r.action;
    return `${conds} → ${act}（${tgt}）`;
  }

  function hpLine(u, st) {
    const s = V.Roster.stats(st, u);
    const hp = u.hp == null ? s.maxHp : Math.min(u.hp, s.maxHp);
    return `<div class="mini">
      <span class="mini-name">${esc(u.name)}</span>
      <span class="mini-val">${hp}/${s.maxHp}</span>
      ${bar(hp, s.maxHp, 'hp')}
    </div>`;
  }

  /* ------------------------------ 标题 ------------------------------ */

  function titleScreen(state, ui) {
    const hasSave = !!ui.hadSave;
    const meta = hasSave
      ? `最深 ${state.bestDepth} 层 · ${state.gold} 金币 · ${state.roster.length} 位老兵`
      : '培养并保护你的老兵 · 可逆装配 · 遭遇可无限重试';
    return `<div class="v-title">
      <div class="v-title-glow"></div>
      <div class="v-title-frame">
        <div class="v-crest">✦</div>
        <h1 class="v-title-main">老兵回路</h1>
        <div class="v-title-sub">V E T E R A N &nbsp; C I R C U I T</div>
        <div class="v-rule"></div>
        <p class="v-quote">“人比铁脆。所以要把铁穿在身上。”</p>
        ${btn(hasSave ? '继 续 远 征' : '开 始 一 次 远 征', 'titleStart', { cls: 'v-cta' })}
        <div class="v-title-meta">${esc(meta)}</div>
        <div class="v-title-tools">
          ${btn('导出存档', 'exportSave', { cls: 'ghost xs' })}
          ${btn('导入存档', 'importSave', { cls: 'ghost xs' })}
          ${hasSave ? btn('抹去存档', 'resetSave', { cls: 'ghost xs danger' }) : ''}
        </div>
        ${ui.importOpen ? `<div class="v-import">
          <textarea id="importBox" rows="4" placeholder="把导出的存档文本粘到这里"></textarea>
          ${btn('确认导入', 'importConfirm', { cls: 'gold xs' })}
        </div>` : ''}
      </div>
      <div class="v-title-hint">旧版《灰烬回廊》入口仍在 index.html，两者存档互不影响</div>
    </div>`;
  }

  /* ------------------------------ 营地 ------------------------------ */

  function campScreen(state, ui) {
    const party = state.team.filter(Boolean);
    return `
    ${V.Art.sceneBanner('veteran.scene.workshop', 'scene-camp', '灰烬前哨',
    `${state.roster.length} 位老兵 · 金币 ${state.gold} · 遗物 ${state.shards}`)}
    <div class="camp-cols">
      <div class="camp-col">
      ${panel('四位老兵', `<div class="vet-grid">${state.team.map((uid, slot) => {
        const u = uid ? state.roster.find((x) => x.id === uid) : null;
        return `<div class="vet-slot ${u ? '' : 'empty'}">
          <div class="vet-slot-no">${slot + 1}</div>
          ${u ? `
            <div class="vet-name">${esc(u.name)}</div>
            <div class="vet-body">${esc(D().body(u.bodyPreset).name)}</div>
            <div class="vet-weapon">${esc(partName(state, u.weaponId))}</div>
            ${hpLine(u, state)}
            <div class="vet-stress">压力 ${u.stress}</div>
            ${btn('查看', 'inspectUnit', { cls: 'ghost xs', data: { id: u.id } })}
          ` : '<div class="vet-empty">空位</div>'}
        </div>`;
      }).join('')}</div>`)}
      ${panel('战史', state.roster.map((u) => {
    const h = V.Roster.history(state, u.id);
    return `<div class="hist-row">
      <span class="hist-name">${esc(u.name)}</span>
      <span class="muted tiny">合格撤离 ${h.eligibleRuns} 次 · 逻辑槽 ${h.logicSlots}</span>
      <span class="muted tiny">${h.attunement.traitId ? `调谐：${esc(h.attunement.traitName)}` : `调谐 ${h.attunement.runs}/${h.attunement.need}`}</span>
    </div>`;
  }).join(''))}
      </div>

      <div class="camp-col">
      ${panel('出发准备', `
        <p class="muted small">远征 7 层。<b class="gold">活着回来，东西才入仓。</b>
        战斗可以无限次「重新整备」，敌人和初始种子不会变。</p>
        <div class="row wrap mt3">
          ${btn('⚔ 下潜', 'startRun', { cls: 'gold', disabled: party.length === 0 })}
          ${btn('队伍编成', 'go', { cls: 'ghost', data: { v: 'team' } })}
          ${btn('工坊', 'go', { cls: 'ghost', data: { v: 'workshop' } })}
          ${btn('招募台', 'go', { cls: 'ghost', data: { v: 'recruit' } })}
          ${btn('仓库', 'go', { cls: 'ghost', data: { v: 'stash' } })}
          ${btn('战史', 'go', { cls: 'ghost', data: { v: 'history' } })}
        </div>
        <div class="row wrap mt3">
          <span class="muted small">难度</span>
          ${['normal', 'deep', 'nightmare'].map((d) => btn(
    { normal: '常规', deep: '深入', nightmare: '梦魇' }[d], 'setDifficulty',
    { cls: state.difficulty === d ? 'gold xs' : 'ghost xs', data: { id: d } },
  )).join('')}
        </div>
        <div class="mt3 muted small">已解锁难度：${state.unlockedDifficulties.map((d) => esc({ normal: '常规', deep: '深入', nightmare: '梦魇' }[d])).join('、')}</div>
      `)}
      ${panel('怎么玩', `<ol class="howto">
        <li><b>编队</b>：四人各站一个身位，1 号位最靠前。短刃只能在前排出力；长矛站 2 号位能贯穿两个人。</li>
        <li><b>回路</b>：出手要用能量。clock 每次行动前送 2 单位，受击再送 2 单位。<span class="gold">能量不会自己变多</span>，只会被分流或蓄住。</li>
        <li><b>整备</b>：打不过就「重新整备」。敌人和初始种子不变，改身位和指令再来一次，不要钱。</li>
        <li><b>撤离</b>：活着回来东西才入仓。烙印很香，但烙进去的东西仍算本局风险池。</li>
      </ol>`)}
      </div>
    </div>`;
  }

  /* ------------------------------ 队伍 ------------------------------ */

  function teamScreen(state, ui) {
    const selected = state.roster.find((u) => u.id === ui.teamUnit) || state.roster[0];
    return `
    <div class="grid-2">
      ${panel('上场顺序', `<p class="muted small">1 号位最靠近敌人。短刃必须站 1 号位；长矛 2 号位能贯穿。</p>
        <div class="vet-grid mt3">${state.team.map((uid, slot) => {
    const u = uid ? state.roster.find((x) => x.id === uid) : null;
    return `<div class="vet-slot ${u ? '' : 'empty'}">
      <div class="vet-slot-no">${slot + 1}</div>
      ${u ? `<div class="vet-name">${esc(u.name)}</div><div class="vet-weapon">${esc(partName(state, u.weaponId))}</div>`
    : '<div class="vet-empty">空位</div>'}
      <div class="row tight">${btn('换上', 'teamPick', { cls: 'ghost xs', data: { id: String(slot) } })}
      ${u ? btn('换下', 'teamClear', { cls: 'ghost xs', data: { id: String(slot) } }) : ''}</div>
    </div>`;
  }).join('')}</div>
        ${ui.teamPickSlot != null ? `<div class="picker mt3"><div class="muted small mb2">选择角色放到 ${ui.teamPickSlot + 1} 号位</div>
        <div class="row wrap">${state.roster.map((u) => btn(u.name, 'teamSet', { cls: 'ghost xs', data: { slot: String(ui.teamPickSlot), id: u.id } })).join('')}</div></div>` : ''}
      `)}

      ${panel('老兵', `<div class="row wrap">${state.roster.map((u) => btn(
    `${u.name}${state.team.includes(u.id) ? ' ●' : ''}`, 'inspectUnit',
    { cls: u.id === selected.id ? 'gold xs' : 'ghost xs', data: { id: u.id } },
  )).join('')}</div>
      ${selected ? unitDetail(state, selected) : ''}`)}
    </div>`;
  }

  function unitDetail(state, u) {
    const s = V.Roster.stats(state, u);
    const w = state.itemsById[u.weaponId];
    const h = V.Roster.history(state, u.id);
    const weapons = state.stash.filter((id) => state.itemsById[id].kind === 'weapon');
    return `<div class="u-detail mt3">
      <div class="u-detail-head"><b>${esc(u.name)}</b>
        <span class="muted small">${esc(D().body(u.bodyPreset).name)} · 压力 ${u.stress} · 逻辑槽 ${u.logicSlots}</span></div>
      <div class="stat-row">
        <span>生命 ${s.maxHp}</span><span>攻击 ${s.atk}</span><span>防御 ${s.def}</span><span>速度 ${s.spd}</span>
        <span>负荷 ${s.loadCap}</span>
      </div>
      <div class="mt2 small">主手：<b class="gold">${esc(partName(state, u.weaponId))}</b>
        <span class="muted">${esc(w ? D().weapon(w.templateId).main.desc : '')}</span></div>
      ${h.attunement.traitId
    ? `<div class="small success mt1">调谐已解锁：${esc(h.attunement.traitName)} — ${esc(h.attunement.traitDesc)}</div>`
    : `<div class="small muted mt1">调谐进度 ${h.attunement.runs}/${h.attunement.need}（同一主手三次合格撤离）</div>`}
      <div class="mt2 small">${weapons.length ? `换主手：${weapons.map((id) => btn(partName(state, id), 'equipWeapon', { cls: 'ghost xs', data: { uid: u.id, id } })).join(' ')}` : '<span class="muted">仓库里没有别的主手</span>'}</div>
      <div class="mt2">${btn('编辑行为指令', 'editRules', { cls: 'ghost xs', data: { id: u.id } })}
        ${btn(state.gold >= 30 ? '安抚（30 金）' : '安抚（缺金币）', 'comfort', { cls: 'ghost xs', data: { id: u.id }, disabled: state.gold < 30 })}</div>
    </div>`;
  }

  /* ------------------------------ 规则编辑 ------------------------------ */

  function rulesScreen(state, ui) {
    const u = state.roster.find((x) => x.id === ui.ruleUnit);
    if (!u) return panel('行为指令', '<p class="muted">先选一个角色。</p>');
    const rules = ui.ruleDraft || u.gambits;
    return panel(`${esc(u.name)} 的行为指令`, `
      <p class="muted small">按顺序检查，第一条目标、能量、身位都合法的指令生效；都不可用时退回基础攻击。</p>
      <div class="rules">${rules.map((r, i) => `<div class="rule-row">
        <div class="rule-no">${i + 1}</div>
        <div class="rule-body">
          <div class="row wrap tight">
            <span class="muted tiny">条件</span>
            ${r.conditions.map((c, ci) => `<select data-act="ruleCond" data-id="${i}:${ci}">
              ${D().CONDITIONS.map((x) => `<option value="${x.id}" ${x.id === c.type ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            </select>${c.type !== 'always' ? `<select data-act="ruleCondVal" data-id="${i}:${ci}">
              ${(c.type === 'atSlot' ? [1, 2, 3, 4] : D().THRESHOLDS).map((v) => `<option value="${v}" ${v === c.value ? 'selected' : ''}>${v}${c.type === 'atSlot' ? '号位' : '%'}</option>`).join('')}
            </select>` : ''}`).join('')}
            ${r.conditions.length < 2 ? btn('+条件', 'ruleAddCond', { cls: 'ghost xs', data: { id: String(i) } }) : ''}
          </div>
          <div class="row wrap tight mt1">
            <span class="muted tiny">目标</span>
            <select data-act="ruleTarget" data-id="${i}">
              ${D().TARGETS.map((x) => `<option value="${x.id}" ${x.id === r.target ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            </select>
            <span class="muted tiny">动作</span>
            <select data-act="ruleAction" data-id="${i}">
              ${D().ACTIONS.map((x) => `<option value="${x.id}" ${x.id === r.action ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="rule-ops">${btn('删', 'ruleDel', { cls: 'ghost xs danger', data: { id: String(i) } })}</div>
      </div>`).join('')}</div>
      <div class="row mt3">${rules.length < u.logicSlots ? btn('+ 添加一条', 'ruleAdd', { cls: 'ghost' }) : `<span class="muted small">已用满 ${u.logicSlots} 个槽位</span>`}
        ${btn('保存', 'ruleSave', { cls: 'gold' })} ${btn('取消', 'go', { cls: 'ghost', data: { v: 'team' } })}</div>
      ${ui.ruleErrors && ui.ruleErrors.length ? `<div class="err-box mt2">${ui.ruleErrors.map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
    `);
  }

  /* ------------------------------ 工坊 ------------------------------ */

  function workshopScreen(state, ui) {
    const unit = state.roster.find((u) => u.id === ui.wsUnit) || state.roster[0];
    const draft = ui.wsDraft || (unit ? unit.board.placements : []);
    const pv = unit ? V.Circuit.preview(state, unit.id, draft) : { ok: false, errors: ['没有角色'], occupied: [], load: 0, reachableOutputs: [] };
    const body = unit ? D().body(unit.bodyPreset) : null;
    const stashParts = state.stash.filter((id) => state.itemsById[id].kind === 'circuit');
    const locked = new Set(ui.wsLocked || []);

    const surface = V.Art.imgTag('veteran.surface.board', 'board-surface-img');
    return `
    ${V.Art.sceneBanner('veteran.scene.workshop', 'scene-workshop', '工坊', '可逆装配 · 停摆的构件不伪造连通')}
    <div class="ws-layout">
      <aside class="ws-left">
        ${panel('老兵', `<div class="row wrap">${state.roster.map((u) => btn(u.name, 'wsUnit', {
    cls: u.id === unit.id ? 'gold xs' : 'ghost xs', data: { id: u.id },
  })).join('')}</div>
        ${unit ? `<div class="mt2 small muted">${esc(body.name)} · 负荷上限 ${body.loadCap}<br>屏蔽格：${body.blocked.map((b) => `(${b[0]},${b[1]})`).join(' ')}</div>` : ''}`)}
        ${panel('校验', `<div class="${pv.ok ? 'success' : 'danger'} small">${pv.ok ? '板面合法' : '板面有问题'}</div>
          <div class="small mt1">占格 ${pv.occupied.length} · 负荷 ${pv.load}/${body ? body.loadCap : '?'}</div>
          <div class="small mt1">已接通：${pv.reachableOutputs.length ? pv.reachableOutputs.map((x) => (x === 'main' ? '主手' : '保护')).join('、') : '无'}</div>
          ${(!pv.ok && pv.errors.length) || (ui.wsErrors && ui.wsErrors.length)
    ? `<div class="err-box mt2">${(ui.wsErrors && ui.wsErrors.length ? ui.wsErrors : pv.errors).slice(0, 4).map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
          ${pv.ok && !pv.reachableOutputs.length ? '<div class="err-box mt2">没有任何输出连通，保存会被拒绝。</div>' : ''}`)}
      </aside>

      <div class="ws-board">
        <div class="board-stack">
          ${surface ? `<div class="board-surface">${surface}</div>` : ''}
          ${boardSvg(state, unit.id, draft, { interactive: true })}
        </div>
        <div class="row wrap mt2">
          ${btn('旋转 ⟳', 'wsRotate', { cls: 'ghost sm' })}
          ${btn('翻转 ⇅', 'wsFlip', { cls: 'ghost sm' })}
          ${btn('撤销', 'wsUndo', { cls: 'ghost sm' })}
          ${btn('重做', 'wsRedo', { cls: 'ghost sm' })}
          ${ui.wsMode === 'inscribe' ? '' : btn('保存板面', 'wsSave', { cls: 'gold sm' })}
        </div>
        ${ui.wsMode === 'inscribe' ? '' : `<div class="row wrap mt1">
          ${btn('基础直供预设', 'wsPreset', { cls: 'ghost xs', data: { id: 'basic' } })}
          ${btn('蓄能预设', 'wsPreset', { cls: 'ghost xs', data: { id: 'charge' } })}
        </div>`}
      </div>

      <aside class="ws-right">
        ${panel('构件库', `
          <div class="muted tiny mb2">点选一件，再点格子放置。${ui.wsMode === 'inscribe' ? '原构件不能删除。' : ''}</div>
          <div class="part-list">${stashParts.length ? stashParts.map((id) => {
    const it = state.itemsById[id];
    const t = D().template(it.templateId);
    return `<button class="part-item ${ui.wsPick === id ? 'on' : ''}" data-act="wsPick" data-id="${id}"
      ${locked.has(id) ? 'disabled' : ''}>
      ${V.Art.relicThumb(t.id)}
      <span class="part-text">
        <span class="part-name">${esc(t.name)}</span>
        <span class="part-meta">${t.cells.length} 格 · load ${t.load}</span>
      </span>
    </button>`;
  }).join('') : '<div class="muted small">仓库里没有多余构件</div>'}</div>
        `)}
        ${panel('板面上的构件', `<div class="part-list">${draft.map((p) => {
    const it = state.itemsById[p.itemId];
    if (!it) return '';
    const t = D().template(it.templateId);
    const isMine = unit.board.placements.some((x) => x.itemId === p.itemId);
    return `<div class="part-item static ${ui.wsPick === p.itemId ? 'on' : ''}">
      ${V.Art.relicThumb(t.id)}
      <span class="part-text">
        <span class="part-name">${esc(t.name)}</span>
        <span class="part-meta">(${p.x},${p.y}) 旋${p.rotation}${p.mirrorY ? ' 翻' : ''}</span>
      </span>
      <span class="row tight">
        ${btn('选', 'wsPick', { cls: 'ghost xs', data: { id: p.itemId } })}
        ${isMine || ui.wsMode === 'inscribe' ? '' : btn('移', 'wsRemove', { cls: 'ghost xs danger', data: { id: p.itemId } })}
      </span>
    </div>`;
  }).join('')}</div>`)}
        ${ui.wsMode === 'inscribe' ? `<div class="col mt2">
          ${btn('按推荐布局摆放', 'wsAutoLayout', { cls: 'ghost sm' })}
          ${btn('确认烙印（生命上限 ×0.8，压力 +40）', 'wsInscribe', { cls: 'gold sm', disabled: !(pv.ok && pv.reachableOutputs.length) })}
          ${btn('取消', 'cancelInscribe', { cls: 'ghost sm' })}
          <div class="muted tiny">原构件必须保留；新增构件只能有一件。可以点「选」再点空格移动原构件。</div>
        </div>` : ''}
      </aside>
    </div>`;
  }

  /* ------------------------------ 招募 / 仓库 / 战史 ------------------------------ */

  function recruitScreen(state, ui) {
    const offers = state.shop || [];
    return panel('招募台', `
      <div class="row mb3"><span class="muted small">金币 ${state.gold}</span>
        <div class="spacer"></div>${btn('刷新（12 金）', 'refreshShop', { cls: 'ghost sm', disabled: state.gold < 12 })}</div>
      <div class="grid-3">${offers.length ? offers.map((o) => `<div class="recruit-card ${o.sold ? 'sold' : ''}">
        <div class="recruit-name">${esc(o.name)}</div>
        <div class="muted small">${esc(D().body(o.bodyPreset).name)} · ${esc(D().weapon(o.weaponId).name)}</div>
        <div class="muted tiny mt1">${esc(D().body(o.bodyPreset).desc)}</div>
        <div class="row mt2"><span class="gold">${o.price} 金</span>
          <div class="spacer"></div>
          ${o.sold ? '<span class="muted small">已招募</span>'
    : btn('招募', 'recruitOffer', { cls: 'gold xs', data: { id: o.id }, disabled: state.gold < o.price })}
        </div>
      </div>`).join('') : '<div class="muted">点刷新看看有谁。</div>'}</div>
      ${ui.shopMsg ? `<div class="err-box mt2">${esc(ui.shopMsg)}</div>` : ''}
    `);
  }

  function stashScreen(state) {
    const list = state.stash;
    return panel(`仓库（${list.length} 件）`, `
      <p class="muted small">远征里捡到的构件，活着回来后在这里。${btn('去工坊装配', 'go', { cls: 'ghost xs', data: { v: 'workshop' } })}</p>
      <div class="part-list mt2">${list.length ? list.map((id) => {
    const it = state.itemsById[id];
    const tpl = it && it.kind === 'circuit' ? D().template(it.templateId) : null;
    return `<div class="part-item static">
        ${tpl ? V.Art.relicThumb(tpl.id) : '<span class="relic-thumb"></span>'}
        <span class="part-text">
          <span class="part-name">${esc(partName(state, id))}</span>
          <span class="part-meta">${esc(partMeta(state, id))}</span>
        </span>
        ${partIcon(state, id)}
      </div>`;
  }).join('') : '<div class="muted">空的。</div>'}</div>
    `);
  }

  function historyScreen(state, ui) {
    const u = state.roster.find((x) => x.id === ui.histUnit) || state.roster[0];
    const h = u ? V.Roster.history(state, u.id) : null;
    return `${V.Art.sceneBanner('veteran.scene.recovery', 'scene-recovery', '战史', '谁活下来了，谁没有')}
    <div class="grid-2">
      ${panel('老兵', `<div class="row wrap">${state.roster.map((x) => btn(x.name, 'inspectHistory', {
    cls: x.id === (u && u.id) ? 'gold xs' : 'ghost xs', data: { id: x.id },
  })).join('')}</div>
        ${h ? `<div class="mt3">
          <div class="small">合格撤离 <b class="gold">${h.eligibleRuns}</b> 次</div>
          <div class="small mt1">逻辑槽 ${h.logicSlots} 个${h.logicSlots < 3 ? `，再 ${h.nextSlotIn} 次合格撤离解锁第 3 个` : ''}</div>
          <div class="small mt1">调谐：${h.attunement.traitId
    ? `<b class="gold">${esc(h.attunement.traitName)}</b> — ${esc(h.attunement.traitDesc)}`
    : `${h.attunement.runs}/${h.attunement.need}（${esc(h.attunement.weaponName || '无主手')}）`}</div>
        </div>` : ''}`)}
      ${panel('最近记录', h && h.records.length ? h.records.map((r) => `<div class="hist-row">
        <span class="hist-name">${esc({ extract: '撤离', clear: '通关', emergency: '紧急撤退', defeat: '败退' }[r.kind] || r.kind)}</span>
        <span class="muted tiny">${r.depth} 层</span>
        <span class="${r.eligible ? 'success' : 'muted'} tiny">${esc(r.reason)}</span>
      </div>`).join('') : '<div class="muted small">还没有记录。</div>')}
    </div>`;
  }

  /* ------------------------------ 地图 ------------------------------ */

  function mapScreen(state, ui) {
    const r = state.run;
    const pct = ((r.floor - 1) / D().DESIGN.maxFloor) * 100;
    return `
    <div class="map-head">
      <div class="map-floor">第 ${r.floor} / ${D().DESIGN.maxFloor} 层</div>
      <div class="map-bar"><i style="width:${pct}%"></i></div>
      <div class="muted small">已完成 ${r.completedFloors} 层 · 背包 ${V.Expedition.bagUsed(state)}/${D().DESIGN.bagCapacity} 格</div>
    </div>
    <div class="party-strip">${r.party.map((p) => {
    const u = state.roster.find((x) => x.id === p.uid);
    const s = V.Roster.stats(state, u);
    const hp = p.hp == null ? s.maxHp : p.hp;
    return `<div class="party-chip">
      <span class="pc-name">${esc(u.name)}</span>
      <span class="pc-slot">${p.slot + 1}号位</span>
      ${bar(hp, s.maxHp, 'hp')}
      <span class="pc-hp">${hp}/${s.maxHp}</span>
      <span class="pc-stress ${p.stress >= 70 ? 'danger' : ''}">压力 ${p.stress}</span>
    </div>`;
  }).join('')}</div>
    <div class="nodes">${r.nodes.map((n) => {
    const disabled = n.consumed;
    return `<button class="node-card risk-${n.risk} ${disabled ? 'done' : ''}" data-act="chooseNode" data-id="${n.id}" ${disabled ? 'disabled' : ''}>
      <div class="node-art">${A.Art && A.Art.getArt(n.artId) ? A.Art.imgTag(n.artId, 'node-img', n.name) : ''}</div>
      <div class="node-name">${esc(n.name)}</div>
      <div class="node-desc muted tiny">${esc(n.desc)}</div>
      <div class="node-risk">${esc({ low: '低危', medium: '中危', high: '高危', deadly: '致命', none: '安全' }[n.risk] || n.risk)}</div>
    </button>`;
  }).join('')}</div>
    <div class="row mt3">
      ${btn('带着现有收获撤离', 'extractNow', { cls: 'gold' })}
      <span class="muted small">撤离才把背包和金币带回营地。现在背包 ${r.bag.length} 件。</span>
    </div>`;
  }

  /* ------------------------------ 战前 ------------------------------ */

  function prebattleScreen(state, ui) {
    const r = state.run;
    const enc = r.encounter;
    if (!enc) return panel('战前', '<p class="muted">没有锁定遭遇。</p>');
    const bp = enc.enemyBlueprint;
    const prep = enc.preparation;
    const attempt = enc.attemptNumber;

    return `
    <div class="grid-2">
      ${panel('敌方', `<div class="enemy-list">${bp.units.map((u) => `<div class="enemy-row">
        <span class="enemy-name ${u.isBoss ? 'boss' : ''}">${esc(u.name)}</span>
        <span class="muted tiny">${u.hp} 生命 · ${u.atk} 攻击 · ${u.def} 防御 · ${u.spd} 速度</span>
        ${u.isBoss ? tag('首领', 'tag-boss') : ''}
      </div>`).join('')}</div>
      <div class="muted small mt2">敌人与初始种子已固定。重试不会换敌人。</div>`)}

      ${panel('整备', `
        <div class="muted small">调整四个人的身位与行为指令。不能换队员，也不能拆回路。</div>
        <div class="vet-grid mt2">${prep.formation.map((uid, slot) => {
    const u = uid ? state.roster.find((x) => x.id === uid) : null;
    return `<div class="vet-slot ${u ? '' : 'empty'}">
      <div class="vet-slot-no">${slot + 1}</div>
      ${u ? `<div class="vet-name">${esc(u.name)}</div><div class="vet-weapon">${esc(partName(state, u.weaponId))}</div>` : '<div class="vet-empty">空位</div>'}
      <div class="row tight">${btn('换位', 'prepPick', { cls: 'ghost xs', data: { id: String(slot) } })}</div>
    </div>`;
  }).join('')}</div>
        ${ui.prepSlot != null ? `<div class="picker mt2"><div class="muted small mb2">把 ${ui.prepSlot + 1} 号位换成</div>
          <div class="row wrap">${prep.formation.map((uid) => {
    if (!uid) return '';
    const u = state.roster.find((x) => x.id === uid);
    return btn(u.name, 'prepSwap', { cls: 'ghost xs', data: { a: String(ui.prepSlot), uid } });
  }).join('')}</div></div>` : ''}
        <div class="mt3 small">指令预览：</div>
        ${state.roster.filter((u) => prep.formation.includes(u.id)).map((u) => {
    const rules = prep.rules[u.id] || u.gambits;
    return `<div class="rule-line"><span class="muted tiny">${esc(u.name)}</span>
      <span class="tiny">${rules.map((x) => esc(ruleText(x))).join(' / ')}</span></div>`;
  }).join('')}
        <div class="row mt3">
          ${btn(attempt > 0 ? '开始（第 ' + (attempt + 1) + ' 次尝试）' : '开始战斗', 'startAttempt', { cls: 'gold' })}
          ${btn('编辑指令', 'editRules', { cls: 'ghost', data: { id: prep.formation.filter(Boolean)[0] } })}
        </div>
        <div class="row mt2">
          ${btn('紧急撤退（保留一半本局收获）', 'retreatEmergency', { cls: 'ghost danger sm' })}
        </div>
        ${attempt > 0 ? `<div class="muted tiny mt2">已经试过 ${attempt} 次。重试不消耗任何资源。</div>` : ''}
      `)}
    </div>
    ${retreatPreviewPanel(state, ui)}`;
  }

  function retreatPreviewPanel(state, ui) {
    const p = V.Expedition.previewRetreat(state, 'emergency');
    if (!p.ok) return '';
    return panel('紧急撤退会付出什么', `
      <div class="small">保留新构件 <b class="gold">${p.keepParts.length}</b> 件（共 ${p.keepParts.length + p.lostParts.length} 件），其余丢弃。</div>
      <div class="small mt1">金币 +${p.gold} · 遗物 +${p.shards} · 参战压力 +${p.stress}</div>
      <div class="small muted mt1">带入的主手与回路全部保留。本次不算合格撤离。</div>
    `, 'panel-danger');
  }

  /* ------------------------------ 战斗 ------------------------------ */

  function battleScreen(state, ui) {
    const b = state.run && state.run.battle;
    if (!b) return panel('战斗', '<p class="muted">没有战斗。</p>');
    return `
    <div class="battle-top">
      <span class="bt-round">回合 ${b.round}</span>
      <span class="bt-tick muted tiny">tick ${b.tick}</span>
      <div class="spacer"></div>
      <button class="btn ghost xs" id="btlTactic" data-act="setTactic">战术：${({ balance: '均衡', focus: '集火', safe: '保守' })[b.tactic] || '均衡'}</button>
      <button class="btn ghost xs" id="btlSpeed" data-act="cycleSpeed">速度 ×${ui.speed || 1}</button>
      <button class="btn ghost xs" data-act="togglePause">${ui.paused ? '继续' : '暂停'}</button>
    </div>
    <div class="battle-stage"><canvas id="cv" width="960" height="300"></canvas></div>
    <div class="battle-bars">
      <div class="side allies">${b.allies.map((u) => battleBar(u)).join('')}</div>
      <div class="side enemies">${b.enemies.map((u) => battleBar(u)).join('')}</div>
    </div>
    <div class="battle-actions">
      ${b.over ? btn(b.win ? '查看结果' : '查看结果', 'reviewNow', { cls: 'gold', id: 'btlNext' })
    : '<span class="muted tiny" id="btlWait">战斗进行中…</span>'}
      ${btn('重新整备', 'rewind', { cls: 'ghost sm' })}
      ${btn('紧急撤退', 'retreatEmergency', { cls: 'ghost sm danger' })}
    </div>
    <div class="battle-log" id="battleLog">${(b.logs || []).slice(-14).map((l) => `<div class="lg ${logClass(l)}">${esc(l.text || '')}</div>`).join('')}</div>`;
  }

  function logClass(l) {
    if (l.type === 'miss' || l.type === 'blocked') return 'dim';
    if (l.type === 'crit' || l.type === 'death' || l.type === 'defeat') return 'bad';
    if (l.type === 'heal' || l.type === 'shield' || l.type === 'victory') return 'good';
    if (l.type === 'surge' || l.type === 'telegraph' || l.type === 'phase') return 'warn';
    return '';
  }

  function battleBar(u) {
    const isAlly = u.side === 'ally';
    const energy = u.runtime ? [V.Circuit.outputTokens(u.runtime, 'main').length, V.Circuit.outputTokens(u.runtime, 'support').length] : null;
    return `<div class="unit-bar ${u.alive === false ? 'dead' : ''} ${u.isBoss ? 'boss' : ''}">
      <div class="ub-top"><span class="ub-name">${esc(u.name)}</span>
        <span class="ub-slot">${u.slot + 1}</span></div>
      ${bar(u.hp, u.maxHp, 'hp')}
      <div class="ub-meta">
        <span>${u.hp}/${u.maxHp}</span>
        ${u.shield > 0 ? `<span class="shield">盾${u.shield}</span>` : ''}
        ${energy ? `<span class="energy" title="主手/保护能量">⚡${energy[0]}/${energy[1]}</span>` : ''}
        ${u.skipActions > 0 ? tag('被压住', 'tag-warn') : ''}
        ${u.charging ? tag('蓄力', 'tag-warn') : ''}
      </div>
      ${u.lastBlockReason && isAlly ? `<div class="ub-reason" title="${esc(u.lastBlockReason)}">${esc(u.lastBlockReason.slice(0, 28))}</div>` : ''}
    </div>`;
  }

  /* ------------------------------ 复盘 ------------------------------ */

  function reviewScreen(state, ui) {
    const enc = state.run && state.run.encounter;
    const p = enc && enc.pendingResult;
    if (!p) return panel('结果', '<p class="muted">还没有待确认结果。</p>');
    const rep = p.report || {};
    const win = p.outcome === 'win';
    return `
    ${panel(win ? '战斗胜利（待确认）' : p.outcome === 'timeout' ? '拖到极限（待确认）' : '小队失去战斗能力', `
      <div class="row wrap mb3">
        <span class="chip">回合 ${rep.round || 0}</span>
        <span class="chip">造成 ${Math.round((rep.stats && rep.stats.damage) || 0)}</span>
        <span class="chip">承受 ${Math.round((rep.stats && rep.stats.taken) || 0)}</span>
        <span class="chip">治疗 ${Math.round((rep.stats && rep.stats.healing) || 0)}</span>
      </div>
      <div class="small muted">确认之前，奖励、战史与伤痕都不会落账。可以无限次重新整备。</div>
      ${win ? `<div class="mt3 small">确认后获得：金币 +${p.rewardSpec.gold} · 遗物 +${p.rewardSpec.shards} ·
        ${p.rewardSpec.drops.length} 件构件（确认时才分配物品）</div>`
    : `<div class="mt3 small danger">败退会失去本局所有新收获；带入的主手与回路保留，压力 +${D().DESIGN.defeat.stress}。</div>`}
      <div class="row mt3">
        ${win ? btn('确认结果', 'confirmResult', { cls: 'gold' }) : ''}
        ${btn('重新整备', 'rewind', { cls: 'ghost' })}
        ${win ? btn('紧急撤退', 'retreatEmergency', { cls: 'ghost danger sm' }) : btn('确认败退', 'retreatDefeat', { cls: 'gold danger' })}
      </div>
    `)}
    <div class="battle-log">${(rep.logs || []).slice(-20).map((l) => `<div class="lg ${logClass(l)}">${esc(l.text || '')}</div>`).join('')}</div>`;
  }

  /* ------------------------------ 掉落 ------------------------------ */

  function lootScreen(state, ui) {
    const r = state.run;
    const pending = r.pendingLoot;
    const used = V.Expedition.bagUsed(state);
    const free = D().DESIGN.bagCapacity - used;
    return `
    ${panel(`战利品（背包 ${used}/${D().DESIGN.bagCapacity} 格）`, `
      ${pending.length ? `<div class="muted small mb2">背包放不下这些。选择带走、替换，或丢掉。</div>` : '<div class="success small">都处理完了。</div>'}
      <div class="part-list">${pending.map((id) => {
    const it = state.itemsById[id];
    if (!it) return '';
    const t = D().template(it.templateId);
    const cells = t.cells.length;
    return `<div class="part-item static">
      <span class="part-name">${esc(t.name)}</span>
      <span class="part-meta">${cells} 格 · load ${t.load} · ${esc(t.desc)}</span>
      <span class="row tight">
        ${btn('带走', 'lootTake', { cls: 'gold xs', data: { id }, disabled: cells > free })}
        ${btn('丢掉', 'lootDiscard', { cls: 'ghost xs danger', data: { id } })}
        ${r.bag.length ? btn('替换…', 'lootReplacePick', { cls: 'ghost xs', data: { id } }) : ''}
      </span>
      ${ui.replaceFor === id ? `<div class="row wrap mt1">${r.bag.map((bid) => btn(`换掉 ${esc(partName(state, bid))}`, 'lootReplace', {
    cls: 'ghost xs', data: { id, drop: bid },
  })).join('')}</div>` : ''}
    </div>`;
  }).join('')}</div>
      ${r.bag.length ? `<div class="mt3"><div class="muted small mb2">背包里（撤离才入仓）</div>
        <div class="part-list">${r.bag.map((id) => `<div class="part-item static">
          <span class="part-name">${esc(partName(state, id))}</span>
          <span class="part-meta">${esc(partMeta(state, id))}</span></div>`).join('')}</div></div>` : ''}
      <div class="row mt3">
        ${btn('继续', 'finishNode', { cls: 'gold', disabled: pending.length > 0 })}
        ${btn('紧急撤退', 'retreatEmergency', { cls: 'ghost danger sm' })}
      </div>
      <div class="muted tiny mt2">已入账：金币 +${r.goldFound} · 遗物 +${r.shards} —— 但只有活着回营才真的算数。</div>
    `)}`;
  }

  /* ------------------------------ 事件 / 营火 / 商人 / 祝福 ------------------------------ */

  function eventScreen(state, ui) {
    const ev = D().event(state.run.event.eventId);
    const resolved = state.run.event.resolved;
    return panel(ev.title, `
      <div class="story">${esc(ev.text)}</div>
      ${resolved
    ? `<div class="story mt2 success">${esc(state.run.event.resultText)}</div>
         <div class="row mt3">${btn('继续', 'eventDone', { cls: 'gold' })}</div>`
    : `<div class="mt3">${ev.choices.map((c) => `<button class="choice" data-act="chooseEvent" data-id="${c.id}">
          ${esc(c.label)}<span class="hint">${esc(c.hint || '')}</span></button>`).join('')}</div>`}
    `);
  }

  function campNodeScreen(state) {
    const r = state.run;
    return `${V.Art.sceneBanner('veteran.scene.field', 'scene-field', '',
    `第 ${r.floor} 层 · 每名角色本局可现场烙印一次`)}
    ${panel('废弃营火', `
      <div class="story">火还有余温。铁在这里会变软一点。</div>
      <div class="row wrap mt3">
        ${btn('休息（恢复 45% 生命，压力 -30）', 'campRest', { cls: 'gold' })}
        ${btn('继续前进', 'finishNode', { cls: 'ghost' })}
      </div>
      <div class="mt4">
        <h3 class="sub-h">现场烙印</h3>
        <p class="muted small">把刚捡到的构件直接烙进板面。代价是本局生命上限 ×0.8、压力 +40。
        每名角色每局只能一次。烙进去的构件仍算本局风险池：撤退时可能丢。</p>
        <div class="row wrap">${r.party.map((p) => {
    const u = state.roster.find((x) => x.id === p.uid);
    const gate = V.Expedition.inscribable(state, u.id);
    return `<div class="inscribe-card">
      <div class="vet-name">${esc(u.name)}</div>
      <div class="muted tiny">${gate.ok ? '可以烙印' : esc(gate.reason)}</div>
      ${btn('烙印…', 'inscribeStart', { cls: 'ghost xs', data: { id: u.id }, disabled: !gate.ok })}
    </div>`;
  }).join('')}</div>
      </div>
    `)}`;
  }

  function merchantScreen(state) {
    const r = state.run;
    return panel('游商', `
      <div class="story">它不该在这里。但它确实在卖东西。</div>
      <div class="row mb2"><span class="muted small">金币 ${state.gold}</span></div>
      <div class="part-list">${(r.shop || []).map((o) => {
    const it = state.itemsById[o.itemId];
    return `<div class="part-item static">
      <span class="part-name">${esc(partName(state, o.itemId))}</span>
      <span class="part-meta">${esc(partMeta(state, o.itemId))}</span>
      <span class="row tight"><span class="gold">${o.price}</span>
        ${o.sold ? '<span class="muted tiny">已售</span>'
    : btn('买', 'buyOffer', { cls: 'gold xs', data: { id: o.id }, disabled: state.gold < o.price || !it })}
      </span>
    </div>`;
  }).join('')}</div>
      <div class="row mt3">${btn('离开', 'finishNode', { cls: 'ghost' })}</div>
    `);
  }

  function blessingScreen(state) {
    const r = state.run;
    const opts = r.blessingOptions || D().BLESSING_ORDER.slice(0, 3);
    return panel('本局祝福', `
      <div class="story">火里能听见一点别的东西。</div>
      <div class="grid-3 mt3">${opts.map((id) => {
    const b = D().blessing(id);
    return `<button class="blessing-card" data-act="chooseBlessing" data-id="${id}">
      <div class="bl-name">${esc(b.name)}</div>
      <div class="muted tiny">${esc(b.desc)}</div>
    </button>`;
  }).join('')}</div>
    `);
  }

  function settlementScreen(state) {
    const s = state.settlement;
    if (!s) return panel('结算', '<p class="muted">没有结算。</p>');
    return panel(s.title, `
      <div class="story">${esc({
    extract: '身后的门关上了。你们活了下来，东西还在。',
    clear: '那扇门后面的东西终于不动了。',
    emergency: '你们转身就跑。一半的收获丢在了路上。',
    defeat: '被抬回来的。东西没能带回来。',
  }[s.mode] || '')}</div>
      <div class="row wrap mt3">
        <span class="chip">完成 ${s.depth} 层</span>
        <span class="chip">金币 +${s.gold}</span>
        <span class="chip">遗物 +${s.shards}</span>
        <span class="chip">构件 +${s.items.length}</span>
      </div>
      <div class="${s.eligible ? 'success' : 'muted'} small mt2">${esc(s.reason)}</div>
      ${s.items.length ? `<div class="part-list mt2">${s.items.map((id) => `<div class="part-item static">
        <span class="part-name">${esc(partName(state, id))}</span><span class="part-meta">${esc(partMeta(state, id))}</span></div>`).join('')}</div>` : ''}
      <div class="row mt3">${btn('回营地', 'settleClose', { cls: 'gold' })}</div>
    `);
  }

  /* ------------------------------ 汇总 ------------------------------ */

  const NEEDS_RUN = ['map', 'prebattle', 'battle', 'review', 'loot', 'event', 'campNode', 'merchant', 'blessing'];

  function screen(state, ui) {
    /* 没有远征却停在远征界面（读档/调试）：退回营地，不抛错 */
    if (NEEDS_RUN.includes(ui.screen) && !state.run) ui.screen = 'camp';
    switch (ui.screen) {
      case 'title': return titleScreen(state, ui);
      case 'camp': return campScreen(state, ui);
      case 'team': return teamScreen(state, ui);
      case 'rules': return rulesScreen(state, ui);
      case 'workshop': return workshopScreen(state, ui);
      case 'recruit': return recruitScreen(state, ui);
      case 'stash': return stashScreen(state);
      case 'history': return historyScreen(state, ui);
      case 'map': return mapScreen(state, ui);
      case 'prebattle': return prebattleScreen(state, ui);
      case 'battle': return battleScreen(state, ui);
      case 'review': return reviewScreen(state, ui);
      case 'loot': return lootScreen(state, ui);
      case 'event': return eventScreen(state, ui);
      case 'campNode': return campNodeScreen(state);
      case 'merchant': return merchantScreen(state);
      case 'blessing': return blessingScreen(state);
      case 'settlement': return settlementScreen(state);
      default: return panel('未知界面', '<p class="muted">回到营地。</p>');
    }
  }

  function hud(state, ui) {
    if (ui.screen === 'title') return '';
    return `<span class="hud-brand">老兵回路</span>
      <span class="hud-sep"></span>
      <span class="hud-item">金币 <b class="gold">${state.gold}</b></span>
      <span class="hud-item">遗物 <b>${state.shards}</b></span>
      <span class="hud-item">最深 <b>${state.bestDepth}</b> 层</span>
      <div class="spacer"></div>
      <span class="hud-muted tiny">存档 ashen_corridor_veteran_v1</span>
      ${btn('标题', 'toTitle', { cls: 'ghost xs' })}`;
  }

  const NAV = [
    ['camp', '营地'], ['team', '队伍'], ['workshop', '工坊'],
    ['recruit', '招募'], ['stash', '仓库'], ['history', '战史'],
  ];

  function nav(state, ui) {
    if (['title'].includes(ui.screen)) return '';
    const showNav = ['camp', 'team', 'workshop', 'recruit', 'stash', 'history', 'rules'].includes(ui.screen);
    if (!showNav) return '';
    return NAV.map(([v, n]) => `<button class="nav-btn ${ui.screen === v ? 'on' : ''}"
      data-act="go" data-v="${v}" ${state.run ? 'disabled' : ''}>${n}</button>`).join('');
  }

  V.UI = { screen, hud, nav, boardSvg, esc, btn, bar, partName, partMeta, logClass, battleBar, ruleText };
})(globalThis.Ashen ||= {});
