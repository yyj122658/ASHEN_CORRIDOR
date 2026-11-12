'use strict';
/* 老兵回路版界面：全部页面 + 异形生命金属/蚀刻法膜/回路板面 SVG。只读 state，动作交给 app.dispatch。 */
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

  const terms = {
    '压力': '传奇在远征中积累的紧张程度，范围 0–100。敌方招式、现场烙印或撤退可能增加压力，休整、进食和安抚可以降低。压力达到 50 时，自然回裕减慢 20%；达到 80 时减慢 40%。',
    '余裕': '释放蚀刻法招式所用的战斗资源。每位传奇单独积攒，随时间恢复；该传奇装配的各门招式共用这份余裕，释放时扣除。',
    '主手 / 副手': '旧术语里的「主手」指主要攻击或板面的攻击输出端。当前版本没有独立的副手装备槽。板面另一类输出端叫「保护」，辅助招式看实际装配的蚀刻法。',
    '主修 / 合修': '装配顺序中的第一门是主修，决定普攻和基础余裕恢复。后续各门是合修，可提供招式或被动，使用同一份余裕。',
    '覆盖 / 贯通': '纹路占了几格，就算几格覆盖。达到覆盖台阶即可共鸣；从入口沿纹路接到出口，额外获得贯通加成。',
    '营火烙印': '把本趟找到的一件纹路装进传奇的生命金属，立刻用于后续战斗。每人每趟一次，本趟生命上限降低20%，压力增加40。若落点上有未留痕的格子，其中一格会留下瘢痕。',
    '瘢痕': '烙印留在格底的记录。填上纹路或蚀刻法时触发这一格的正负属性，腾空后属性休眠。指向板上的裂纹标记可查看来源和效果。',
    '负荷': '装上一件纹路或一门蚀刻法占用的承载量。物品的形状决定占哪些格，负荷决定这块生命金属还承受得了多少。',
  };

  function panel(title, body, extra) {
    return `<section class="panel ${extra || ''}"><h2 class="panel-h">${title}</h2>${body}</section>`;
  }

  function tag(text, cls) { return `<span class="tag ${cls || ''}">${esc(text)}</span>`; }

  function itemLabel(kind, item) {
    return `<span class="item-label">${V.CatalogueArt?.icon(kind, item.id) || ''}<span>${esc(item.name)}</span></span>`;
  }

  /* ------------------------------ 板面 SVG ------------------------------ */

  const CELL = 60;
  let svgUid = 0;

  /** 人物外观与装配几何分开呈现。@param {object} unit @param {string} cls @returns {string} */
  function legendPortrait(unit, cls = '') {
    return '<div class="legend-portrait ' + esc(cls) + '" role="img" aria-label="' + esc(unit.name) + '">' + V.Art.portraitTag(unit.skinId, '') + '</div>';
  }

  /** 瘢痕正负属性保持同时可见。@param {object} scar @returns {string} */
  function scarBonusText(scar) {
    const labels = { atk: '攻击', def: '防御', maxHp: '生命' };
    return Object.entries(D().SCAR_EFFECTS[scar.templateId] || {}).map(([key, value]) => `<span class="${value > 0 ? 'success' : 'danger'}">${labels[key]} ${value > 0 ? '+' : ''}${value}</span>`).join(' ');
  }

  /** 蚀刻法移动尚未保存时，属性与瘢痕也按屏幕上的草稿位置预览。@param {object} unit @param {object} ms @returns {object} */
  function workshopUnit(unit, ui) {
    if (!unit || !Object.keys(ui.wsMsPoses || {}).length) return unit;
    const draft = V.State.clone(unit);
    V.State.manuscriptsOf(draft).forEach((m) => Object.assign(m, ui.wsMsPoses[m.id]));
    return draft;
  }

  function attunementText(history) {
    const list = history.attunements || (history.attunement.manuscriptId ? [history.attunement] : []);
    return list.map((a) => `${esc(a.manuscriptName)} ${a.runs}/${a.need}${a.traitId ? ' · ' + esc(a.traitName) : ''}`).join('、') || '未修蚀刻法';
  }

  function manuscriptNames(unit) {
    return V.State.manuscriptsOf(unit).map((m) => m.name).join('、') || '未修蚀刻法';
  }

  /** 将有限招式条件译为玩家能判断的时机。@param {object} cond @returns {string} */
  function skillCondition(cond = {}) {
    return [cond.routed ? '纹路贯通' : '', cond.alliesHurt ? '同伴生命低于60%' : '',
      cond.foeHpBelow ? `敌方生命低于${Math.round(cond.foeHpBelow * 100)}%` : '',
      cond.attackCount ? `平攻${cond.attackCount}次后` : '', cond.energyAbove ? `余裕高于${cond.energyAbove}` : '']
      .filter(Boolean).join(' · ') || '余裕足够时';
  }

  /** 蚀刻法文本直接取自战斗配置，避免只显示名字却猜不到打法。@param {object} spec @returns {string} */
  function manuscriptDetails(spec) {
    const canonical = D().manuscript(spec.id) || spec;
    const movement = D().MODS[canonical.modId];
    const skills = spec.skills || [];
    const interval = (D().DESIGN.autoAttack.interval * ((spec.attack && spec.attack.intervalScale) || 1)).toFixed(2);
    return `<div class="technique-details"><p>${esc(canonical.desc)}</p>${movement ? `<p><b>${esc(movement.name)}</b> · ${esc(movement.desc)}</p>` : ''}<div class="technique-facts"><span>主修平攻 <b>${interval}s</b></span><span>主修余裕 <b>+${(spec.energy && spec.energy.regen) || 1}/s</b></span></div>
      ${skills.map((sk) => { const e = sk.effect || {}; return `<div class="technique-skill"><div class="row"><b>${esc(sk.name)}</b><span class="spacer"></span><span class="tiny muted">${sk.cost}余裕 · 冷却${sk.cooldown}s</span></div><span class="tiny muted">${esc(skillCondition(sk.cond))}</span><div class="tiny">${e.heal ? `治疗最虚弱同伴 ${Math.round(e.heal * 100)}%攻击` : `${Math.round((e.mult || 1.4) * 100)}%攻击${e.pierce ? ` · 贯穿前${e.pierce}位` : ''}${e.hits ? ` · ${e.hits}段` : ''}`}${e.shield ? ` · 护盾${Math.round(e.shield * 100)}%生命` : ''}${e.buffAttack ? ` · 平攻强化${e.buffAttack.seconds}s` : ''}${e.dot ? ' · 附灼烧' : ''}</div></div>`; }).join('') || ''}</div>`;
  }

  /** 展示实际战斗贡献和可核对的构筑结果。@param {object} report @returns {string} */
  function contributionGrid(report) {
    const allies = report.allies || [];
    const maxDamage = Math.max(1, ...allies.map((u) => (u.stats && u.stats.damage) || 0));
    return `<div class="contribution-grid">${allies.map((u) => `<article class="contribution-card"><div class="row"><b>${esc(u.name)}</b><span class="spacer"></span><span class="tiny ${u.alive ? 'success' : 'danger'}">${u.alive ? '站到了最后' : '失去战力'}</span></div><div class="contribution-damage"><b>${Math.round((u.stats && u.stats.damage) || 0)}</b><span class="tiny muted">造成伤害</span></div>${bar((u.stats && u.stats.damage) || 0, maxDamage, 'energy')}<div class="contribution-other"><span>治疗 ${Math.round((u.stats && u.stats.healing) || 0)}</span><span>承伤 ${Math.round((u.stats && u.stats.taken) || 0)}</span><span>招式 ${(u.stats && u.stats.skills) || 0}次</span></div><div class="tiny muted">${(u.resonances || (u.resonance ? [u.resonance] : [])).map((r) => `${esc(r.name)} · 纹路覆盖 ${r.pct}%${r.routed ? ' · 已贯通' : ''}`).join('<br>') || '基础平攻'}</div></article>`).join('')}</div>`;
  }

  /** 页面层次保持统一，主操作只出现一次。@param {string} kicker @param {string} title @param {string} sub @param {string} actions @returns {string} */
  function pageHeading(title, sub, actions = '') {
    return `<div class="page-heading"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
  }

  const DIR_VEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

  const DIR_ANGLE = { E: 0, S: 90, W: 180, N: 270 };

  /** 刀口朝向格边；入端一凿，出端留一枚短副刻。 */
  function portCut(x, y, dir, role, state = '') {
    const path = role === 'in' ? 'M-4 -3L1 0L-3 .7Z' : 'M-4 2L1 0L-3 -1Z M-5 -1L-2 -3L-3 -.8Z';
    return `<path class="port-cut port-${role} ${state}" data-dir="${dir}" data-role="${role}" transform="translate(${x} ${y}) rotate(${DIR_ANGLE[dir]})" d="${path}"/>`;
  }

  /** 以 60 单位一格描出真实膜谱，板面、图鉴、悬浮与吸附共用同一份刀痕。 */
  function membraneEngraving(oriented, size, aligned = new Set(), ox = 0, oy = 0) {
    const nodes = new Map(oriented.cells.map(([x, y], index) => [x + ',' + y, {
      x, y, index, joins: new Set(), ports: new Set(), needs: oriented.veins[x + ',' + y] || [],
    }]));
    const opposite = { N: 'S', S: 'N', E: 'W', W: 'E' };
    for (const port of Object.values(oriented.io || {})) nodes.get(port.cell.join(','))?.ports.add(port.dir);

    // 共用格边只刻一次。按原谱格序选支路，使旋转和翻面时仍沿相同的格连接。
    const visited = new Set();
    for (const root of nodes.values()) {
      if (visited.has(root)) continue;
      const queue = [root];
      visited.add(root);
      for (const node of queue) {
        const adjacent = Object.entries(DIR_VEC).map(([dir, [dx,dy]]) => ({
          dir, next: nodes.get((node.x + dx) + ',' + (node.y + dy)),
        })).filter(p => p.next).sort((a,b) => a.next.index - b.next.index);
        for (const {dir, next} of adjacent) {
          if (visited.has(next)) continue;
          visited.add(next);
          queue.push(next);
          node.joins.add(dir);
          next.joins.add(opposite[dir]);
        }
      }
    }

    const marks = [];
    for (const [key, node] of nodes) {
      const { x, y, needs, joins, ports } = node;
      const directions = [...new Set([...joins, ...needs, ...ports])];
      const center = [0, 0];
      // 拐角向内让刀，边上按垂线收笔，使相邻半笔在同一点、同一切向相接。
      for (const dir of directions) {
        center[0] += 3 * DIR_VEC[dir][0];
        center[1] += 3 * DIR_VEC[dir][1];
      }
      const strokes = directions.map(dir => {
        const [dx, dy] = DIR_VEC[dir];
        const across = directions.includes(opposite[dir]) ? opposite[dir] : directions.find(d => d !== dir);
        const [ax, ay] = across ? DIR_VEC[across] : [0, 0];
        const end = joins.has(dir) || ports.has(dir) ? 30 : 23;
        const cut = `M${center[0]} ${center[1]} C${center[0] + 9*(dx-ax)} ${center[1] + 9*(dy-ay)} ${dx*(end-8)} ${dy*(end-8)} ${dx*end} ${dy*end}`;
        const nick = needs.includes(dir) ? `<path class="etch-burr" data-vein="${dir}" transform="rotate(${DIR_ANGLE[dir]})" d="M15 0Q19 -1.8 21 -4.5"/>` : '';
        return `<path class="etch-lip" transform="translate(.35 .9)" d="${cut}"/><path class="etch-cut" ${joins.has(dir) ? `data-join="${dir}"` : ''} d="${cut}"/><path class="etch-fleck" transform="translate(.35 .9)" d="${cut}"/>${nick}`;
      }).join('');
      const on = aligned.has((x + ox) + ',' + (y + oy));
      marks.push(`<g class="ms-incision ${on ? 'aligned' : ''}" data-etch-cell="${key}" transform="translate(${60*x+30} ${60*y+30})"><rect class="ms-field" x="-30" y="-30" width="60" height="60"/>${strokes || '<path class="etch-lip" d="M-5 2q4 -1 9 -5"/>'}</g>`);
    }
    for (const [id, port] of Object.entries(oriented.io || {})) {
      const [dx, dy] = DIR_VEC[port.dir];
      marks.push(portCut(60*port.cell[0] + 30 + dx*28, 60*port.cell[1] + 30 + dy*28, port.dir, D().TERMINALS[id]?.role || 'out', 'membrane-port'));
    }
    return `<g class="engraved-membrane" transform="scale(${size/60})" pointer-events="none">${marks.join('')}</g>`;
  }

  /* 工坊可预览的蚀刻法膜谱图（全部通过 V.Manuscript 判定，不改领域逻辑） */
  const WORKSHOP_MANUSCRIPTS = [
    {
      id: 'ash12',
      name: '余烬十二脉',
      desc: '4×3 古老回流拓片。共 12 格，覆盖 40%/75%/100% 依次共鸣。',
      cells: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2]],
      veins: {
        '0,0': ['W'], '1,0': ['E'], '2,0': ['W'], '3,0': ['E'],
        '0,1': ['W'], '1,1': ['E'], '2,1': ['N'], '3,1': ['N'],
        '0,2': ['W'], '1,2': ['E'], '2,2': ['S'], '3,2': ['S'],
      },
      entry: [0, 0],
      exits: [[3, 2]],
      tiers: [{ at: 40, id: 't1', name: '一阶 · 初鸣' }, { at: 75, id: 't2', name: '二阶 · 共振' }, { at: 100, id: 't3', name: '三阶 · 圆满' }],
    },
    {
      id: 'corridor5',
      name: '直贯五脉',
      desc: '窄型 5 格拓片，适配狭窄骨架与基础直弯配组。',
      cells: [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]],
      veins: { '0,0': ['W'], '1,0': ['E'], '2,0': ['W'], '3,1': ['E'] },
      entry: [0, 0],
      exits: [[3, 1]],
      tiers: [{ at: 40, id: 't1', name: '一阶 · 初鸣' }, { at: 80, id: 't2', name: '二阶 · 共振' }, { at: 100, id: 't3', name: '三阶 · 圆满' }],
    },
    {
      id: 'wide14',
      name: '重铸阔卷',
      desc: '5×3 重型拓片，仅厚实宽幅板面可完整容纳。',
      cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [4, 2]],
      veins: {
        '0,0': ['W'], '1,0': ['E'], '2,0': ['W'], '3,0': ['E'], '4,0': ['S'],
        '0,1': ['N'], '1,1': ['W'], '2,1': ['E'], '3,1': ['W'], '4,1': ['N', 'S'],
        '1,2': ['W'], '2,2': ['E'], '3,2': ['W'], '4,2': ['N'],
      },
      entry: [0, 0],
      exits: [[4, 2]],
      tiers: [{ at: 35, id: 't1', name: '一阶 · 余温' }, { at: 70, id: 't2', name: '二阶 · 灼脉' }, { at: 100, id: 't3', name: '三阶 · 圆满' }],
    },
  ];

  function plateCellsList(plate) {
    if (plate.cellsList && plate.cellsList.length) return plate.cellsList;
    return [...plate.cells].map((k) => k.split(',').map(Number));
  }

  /** 通过 V.Manuscript 计算当前工坊角色的蚀刻法膜适配、覆盖率与贯通状态。 */
  function resolveManuscript(unit, plate, ui, layout) {
    if (!V.Manuscript || !plate) return null;
    const uui = ui || {};
    if (uui.wsMsId === 'none' && !(unit && unit.manuscript)) return { disabled: true, id: 'none' };
    const raw = (D().MANUSCRIPTS || {})[uui.wsMsId]
      || (unit && unit.manuscript)
      || (D().MANUSCRIPTS || {})[(D().MANUSCRIPT_ORDER || [])[0]];
    if (!raw) return null;
    const base = V.Manuscript.normalize(raw);
    if (!base) return null;

    const cellsList = unit ? V.State.freeManuscriptCells(unit, raw.id) : plateCellsList(plate);
    const rot = (((uui.wsMsRot || 0) % 4) + 4) % 4;
    const mir = !!uui.wsMsMir;
    const oriented = V.Manuscript.orient(base, rot, mir);
    const validSpots = V.Manuscript.placements(oriented, cellsList);

    const manual = uui.wsMsOx != null && uui.wsMsOy != null;
    const idx = V.Manuscript.pieceIndex(layout || { built: [] });
    let spotIdx = validSpots.length ? (((uui.wsMsSpotIdx || 0) % validSpots.length) + validSpots.length) % validSpots.length : 0;
    if (!manual && uui.wsMsSpotIdx == null && layout?.built?.length && validSpots.length > 1) {
      let best = -1;
      validSpots.forEach(([x, y], i) => {
        const aligned = V.Manuscript.coverage(oriented, x, y, idx).aligned;
        if (aligned > best) { best = aligned; spotIdx = i; }
      });
    }
    const ox = manual ? Number(uui.wsMsOx) : (validSpots.length ? validSpots[spotIdx][0] : 0);
    const oy = manual ? Number(uui.wsMsOy) : (validSpots.length ? validSpots[spotIdx][1] : 0);
    if (manual) spotIdx = Math.max(0, validSpots.findIndex(([x, y]) => x === ox && y === oy));
    const fits = V.Manuscript.fits(oriented, cellsList, ox, oy);

    let anyFits = validSpots.length > 0;
    if (!anyFits) {
      for (let m = 0; m < 2 && !anyFits; m++) {
        for (let r = 0; r < 4 && !anyFits; r++) {
          if (V.Manuscript.placements(V.Manuscript.orient(base, r, !!m), cellsList).length) anyFits = true;
        }
      }
    }

    let reason = '';
    if (!fits) {
      if (!anyFits) {
        reason = `摆不下：当前板面形状或孔洞缺少足够连续空位容纳「${base.name}」`;
      } else if (!validSpots.length) {
        reason = `当前朝向（旋${rot * 90}°${mir ? '·翻' : ''}）在此板面上无处落脚，请旋转、翻转或重置位置`;
      } else {
        reason = `当前落点 (${ox},${oy}) 需要空闲金属格，请避开其他蚀刻法和板面孔洞`;
      }
    }

    const cov = V.Manuscript.coverage(oriented, ox, oy, idx);
    const rt = V.Manuscript.route(oriented, ox, oy, idx);
    return {
      disabled: false,
      id: raw.id,
      spec: raw,
      oriented,
      ox,
      oy,
      fits,
      anyFits,
      validSpots,
      spotIdx,
      rot,
      mir,
      cov,
      rt,
      reason,
    };
  }

  /** 计算视觉连通集合：区分完整通电（到输出极）与仅输入已到达。 */
  function traceVisualFlow(L) {
    const adjFwd = new Map();
    const adjRev = new Map();
    (L.edges || []).forEach((e) => {
      if (!adjFwd.has(e.from)) adjFwd.set(e.from, []);
      adjFwd.get(e.from).push(e.to);
      if (!adjRev.has(e.to)) adjRev.set(e.to, []);
      adjRev.get(e.to).push(e.from);
    });
    const bfs = (starts, adj) => {
      const vis = new Set(starts);
      const q = starts.slice();
      while (q.length) {
        const cur = q.shift();
        (adj.get(cur) || []).forEach((nxt) => {
          if (!vis.has(nxt)) { vis.add(nxt); q.push(nxt); }
        });
      }
      return vis;
    };
    const fwd = bfs([...adjFwd.keys()].filter((id) => id.startsWith('T:')), adjFwd);
    const rev = bfs([...adjRev.keys()].filter((id) => id.startsWith('T:')), adjRev);
    return { fwd, rev };
  }

  /** 沿网格边界生成不规则锯齿金属轮廓：只向格子外空隙生长，厚度 >=0.35 格，绝不侵犯可用格。 */
  function traceJaggedLoops(cellSet, cellsList, seedVal) {
    const has = (x, y) => cellSet.has(x + ',' + y);
    const noise = (a, b, c) => {
      let h = ((seedVal >>> 0) ^ Math.imul(a + 37, 374761393) ^ Math.imul(b + 53, 668265263) ^ Math.imul(c + 19, 1442695041)) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };

    const rawEdges = [];
    cellsList.forEach(([x, y]) => {
      if (!has(x, y - 1)) rawEdges.push({ x0: x, y0: y, x1: x + 1, y1: y, dir: 0, nx: 0, ny: -1, ex: x, ey: y - 1 });
      if (!has(x + 1, y)) rawEdges.push({ x0: x + 1, y0: y, x1: x + 1, y1: y + 1, dir: 1, nx: 1, ny: 0, ex: x + 1, ey: y });
      if (!has(x, y + 1)) rawEdges.push({ x0: x + 1, y0: y + 1, x1: x, y1: y + 1, dir: 2, nx: 0, ny: 1, ex: x, ey: y + 1 });
      if (!has(x - 1, y)) rawEdges.push({ x0: x, y0: y + 1, x1: x, y1: y, dir: 3, nx: -1, ny: 0, ex: x - 1, ey: y });
    });

    const byStart = new Map();
    rawEdges.forEach((e, idx) => {
      e.id = idx;
      e.used = false;
      const k = e.x0 + ',' + e.y0;
      if (!byStart.has(k)) byStart.set(k, []);
      byStart.get(k).push(e);
    });

    const loops = [];
    for (let i = 0; i < rawEdges.length; i++) {
      if (rawEdges[i].used) continue;
      const loop = [];
      let cur = rawEdges[i];
      while (cur && !cur.used) {
        cur.used = true;
        loop.push(cur);
        const list = (byStart.get(cur.x1 + ',' + cur.y1) || []).filter((n) => !n.used);
        if (!list.length) break;
        if (list.length === 1) { cur = list[0]; continue; }
        /* 多岔口（对角相接）优先右转绕实心块，防止自交 */
        const pref = [(cur.dir + 1) % 4, cur.dir, (cur.dir + 3) % 4];
        let picked = list[0];
        for (let p = 0; p < pref.length; p++) {
          const hit = list.find((n) => n.dir === pref[p]);
          if (hit) { picked = hit; break; }
        }
        cur = picked;
      }
      if (loop.length >= 4) loops.push(loop);
    }

    const polyLoops = [];
    loops.forEach((edges) => {
      const m = edges.length;
      const props = edges.map((e, idx) => {
        const tx = e.x1 - e.x0;
        const ty = e.y1 - e.y0;
        const tight = has(e.ex + e.nx, e.ey + e.ny)
          || has(e.ex + e.nx + tx, e.ey + e.ny + ty)
          || has(e.ex + e.nx - tx, e.ey + e.ny - ty)
          || has(e.ex + tx, e.ey + ty)
          || has(e.ex - tx, e.ey - ty);
        const minD = tight ? 0.37 : 0.39;
        const maxD = tight ? 0.43 : 0.55;
        return {
          tight, minD, maxD,
          dA: minD + noise(e.x0, e.y0, idx + 1) * (maxD - minD),
          dB: minD + noise(e.x1, e.y1, idx + 7) * (maxD - minD),
        };
      });

      const pts = [];
      for (let i = 0; i < m; i++) {
        const prev = edges[(i - 1 + m) % m];
        const curr = edges[i];
        const pp = props[(i - 1 + m) % m];
        const cp = props[i];
        const turn = (curr.dir - prev.dir + 4) % 4;
        const vx = curr.x0;
        const vy = curr.y0;

        if (turn === 0) {
          const d = Math.min(Math.max(0.37, (pp.dB + cp.dA) / 2), pp.tight || cp.tight ? 0.43 : 0.53);
          pts.push([vx + d * curr.nx, vy + d * curr.ny]);
        } else if (turn === 1) {
          /* 外凸 90 度：先查外斜角格是否被其它实心分支占住，占住则贴墙角绕过 */
          const diagX = curr.ex + prev.nx;
          const diagY = curr.ey + prev.ny;
          if (has(diagX, diagY)) {
            pts.push([vx + 0.37 * prev.nx, vy + 0.37 * prev.ny]);
            pts.push([vx + 0.37 * curr.nx, vy + 0.37 * curr.ny]);
          } else {
            const dP = Math.max(0.39, pp.dB);
            const dC = Math.max(0.39, cp.dA);
            const cInset = Math.max(0.365, dC * 0.94);
            const pInset = Math.max(0.365, dP * 0.94);
            pts.push([vx + dP * prev.nx + cInset * curr.nx, vy + dP * prev.ny + cInset * curr.ny]);
            pts.push([vx + pInset * prev.nx + dC * curr.nx, vy + pInset * prev.ny + dC * curr.ny]);
          }
        } else if (turn === 3) {
          /* 内凹 90 度或孔洞拐角：安全缩进空角格内，永不越界 */
          const dc = 0.37 + noise(vx, vy, i + 23) * 0.04;
          pts.push([vx + dc * (prev.nx + curr.nx), vy + dc * (prev.ny + curr.ny)]);
        } else {
          pts.push([vx + Math.max(0.37, cp.dA) * curr.nx, vy + Math.max(0.37, cp.dA) * curr.ny]);
        }

        /* 每格边内插锯齿顶点：首尾遇内凹角时自动让出内壁厚 ≥0.37 格 */
        const nextEdge = edges[(i + 1) % m];
        const nextTurn = (nextEdge.dir - curr.dir + 4) % 4;
        const tStart = turn === 3 ? 0.44 : 0.30;
        const tEnd = nextTurn === 3 ? 0.56 : 0.70;
        const tSamples = tEnd - tStart >= 0.22 ? [tStart, tEnd] : [(tStart + tEnd) * 0.5];
        const dx = curr.x1 - curr.x0;
        const dy = curr.y1 - curr.y0;
        tSamples.forEach((t, ti) => {
          const d = cp.minD + noise(curr.x0 + ti * 3, curr.y0 + ti * 5, i + 31) * (cp.maxD - cp.minD);
          pts.push([curr.x0 + dx * t + d * curr.nx, curr.y0 + dy * t + d * curr.ny]);
        });
      }
      if (pts.length >= 3) polyLoops.push(pts.map(([px, py]) => [px * CELL, py * CELL]));
    });
    return polyLoops;
  }

  /** 按当前板面（异形 / 经典）算出精确像素包围盒与底材多边形。 */
  function computeBoardGeo(plate, seedVal) {
    const cellsList = plateCellsList(plate);
    const termOut = plate.generated ? 34 : 14;
    const rawTermLoc = (t) => {
      const [dx, dy] = DIR_VEC[t.dir];
      const cx = t.cell[0] * CELL + CELL / 2;
      const cy = t.cell[1] * CELL + CELL / 2;
      return [cx + dx * (CELL / 2 + termOut), cy + dy * (CELL / 2 + termOut)];
    };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };

    let metalLoops = null;
    if (plate.generated) {
      metalLoops = traceJaggedLoops(plate.cells, cellsList, seedVal);
      metalLoops.forEach((loop) => loop.forEach(([x, y]) => grow(x, y)));
    } else {
      const size = plate.size || 4;
      grow(-6, -6);
      grow(size * CELL + 6, size * CELL + 6);
    }

    Object.values(plate.terminals || {}).forEach((t) => {
      const [tx, ty] = rawTermLoc(t);
      if (t.dir === 'W') { grow(tx - 40, ty - 14); grow(tx + 6, ty + 14); }
      else if (t.dir === 'E') { grow(tx - 6, ty - 14); grow(tx + 40, ty + 14); }
      else if (t.dir === 'N') { grow(tx - 24, ty - 24); grow(tx + 24, ty + 6); }
      else { grow(tx - 24, ty - 6); grow(tx + 24, ty + 24); }
    });

    const pad = 12;
    const gx = Math.ceil(pad - minX);
    const gy = Math.ceil(pad - minY);
    const cw = Math.ceil(maxX + gx + pad);
    const ch = Math.ceil(maxY + gy + pad);
    const slabPath = metalLoops ? metalLoops.map((loop) => 'M' + loop.map(([x, y]) => `${(x + gx).toFixed(1)} ${(y + gy).toFixed(1)}`).join(' L') + ' Z').join(' ') : '';
    return { gx, gy, cw, ch, termOut, slabPath, cellsList };
  }

  /** 勾出占格的外缘，内部相邻边保持连成一块。 */
  function footprint(cells, gx, gy) {
    const shape = new Set(cells.map(c => c.join(',')));
    const edges = [];
    for (const [x,y] of cells) {
      const px = gx + x*CELL, py = gy + y*CELL;
      if (!shape.has(x + ',' + (y-1))) edges.push(`M${px} ${py}h${CELL}`);
      if (!shape.has(x + ',' + (y+1))) edges.push(`M${px} ${py+CELL}h${CELL}`);
      if (!shape.has((x-1) + ',' + y)) edges.push(`M${px} ${py}v${CELL}`);
      if (!shape.has((x+1) + ',' + y)) edges.push(`M${px+CELL} ${py}v${CELL}`);
    }
    return edges.join(' ');
  }

  /**
   * boardSvg(state, unitId, placements, opts)
   * 四层顺序为金属底材、蚀刻法底纹、已装纹路和端口反馈。
   * opts: {interactive, pickId, locked, ms}
   */
  function boardSvg(state, unitId, placements, opts) {
    const o = opts || {};
    const unit = state.roster.find((u) => u.id === unitId);
    const body = D().body(unit ? unit.bodyPreset : 'sturdy');
    const plate = V.Circuit.plateOf(unit || { bodyPreset: 'sturdy', plateSeed: 1 });
    const terminals = plate.terminals || D().TERMINALS;
    const geo = computeBoardGeo(plate, unit && unit.plateSeed != null ? unit.plateSeed : 1);
    const gx = geo.gx;
    const gy = geo.gy;
    const cellsList = geo.cellsList;
    const blocked = new Set(!plate.generated && body && body.blocked ? body.blocked.map(([x, y]) => x + ',' + y) : []);

    const cellXY = (x, y) => [gx + x * CELL, gy + y * CELL];
    const portPoint = (pt) => {
      const [cx, cy] = cellXY(pt.cell[0], pt.cell[1]);
      const [dx, dy] = DIR_VEC[pt.dir];
      return [cx + CELL / 2 + dx * (CELL / 2 - 2), cy + CELL / 2 + dy * (CELL / 2 - 2)];
    };
    const terminalPoint = (t, outward) => {
      const [cx, cy] = cellXY(t.cell[0], t.cell[1]);
      const [dx, dy] = DIR_VEC[t.dir];
      const d = outward ? CELL / 2 + geo.termOut : CELL / 2 - 2;
      return [cx + CELL / 2 + dx * d, cy + CELL / 2 + dy * d];
    };

    const L = V.Circuit.layout(state, placements, terminals);
    const cellsUsed = new Set(L.cells.map((c) => c.x + ',' + c.y));
    const flow = traceVisualFlow(L);
    const locked = o.locked instanceof Set ? o.locked : new Set(o.locked || []);
    const fid = 'b_' + (++svgUid);

    /* 识别碰撞/不在板面上，标红到格上 */
    const cellOwners = new Map();
    const errorCells = new Set();
    const errorItems = new Set();
    L.built.forEach((b) => {
      b.abs.forEach((c) => {
        const k = c.x + ',' + c.y;
        if (!plate.cells.has(k)) {
          errorCells.add(k);
          errorItems.add(b.item.id);
        }
        if (cellOwners.has(k)) {
          errorCells.add(k);
          errorItems.add(b.item.id);
          errorItems.add(cellOwners.get(k));
        } else {
          cellOwners.set(k, b.item.id);
        }
      });
    });

    const parts = [];
    parts.push(`<svg class="board${o.pickId ? ' has-pick' : ''}" viewBox="0 0 ${geo.cw} ${geo.ch}"
      data-cell="${CELL}" data-gx="${gx}" data-gy="${gy}" data-n="${plate.size}"
      data-ms-ox="${o.ms && !o.ms.disabled ? (o.ms.ox || 0) : ''}"
      data-ms-oy="${o.ms && !o.ms.disabled ? (o.ms.oy || 0) : ''}"
      data-ms-cells="${o.ms && !o.ms.disabled && o.ms.oriented ? o.ms.oriented.cells.map((c) => c.join(',')).join(';') : ''}"
      xmlns="http://www.w3.org/2000/svg" role="img" aria-label="生命金属回路板面">`);
    parts.push(`<defs>
      <pattern id="${fid}_metal" width="256" height="256" patternUnits="userSpaceOnUse">
        <rect width="256" height="256" fill="#211A2D"/>
        <image class="metal-surface-texture" href="assets/art/rune-set-v2/living-metal.png" x="0" y="0" width="256" height="256" preserveAspectRatio="none"/>
      </pattern>
      <pattern id="${fid}_blk" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(180,95,88,0.22)" stroke-width="2"/>
      </pattern>
      <pattern id="${fid}_err" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(211,106,101,0.45)" stroke-width="2"/>
      </pattern>
    </defs>`);

    /* === 第 1 层：底材（异形锯齿金属 / 经典 4x4 退化路径） === */
    parts.push('<g class="layer-base" pointer-events="none">');
    parts.push(`<rect class="board-bg" x="0" y="0" width="${geo.cw}" height="${geo.ch}" rx="4"/>`);
    if (plate.generated) {
      parts.push(`<path class="plate-metal-slab" d="${geo.slabPath}" fill="url(#${fid}_metal)" fill-rule="nonzero"/>`);
      parts.push(`<path class="plate-metal-bevel" d="${geo.slabPath}"/>`);
      const rimEdges = [];
      cellsList.forEach(([x, y]) => {
        const [px, py] = cellXY(x, y);
        parts.push(`<rect class="plate-cell-bed" x="${px + 0.5}" y="${py + 0.5}" width="${CELL - 1}" height="${CELL - 1}"/>`);
        if (!plate.cells.has(x + ',' + (y - 1))) rimEdges.push(`M${px} ${py} h${CELL}`);
        if (!plate.cells.has(x + ',' + (y + 1))) rimEdges.push(`M${px} ${py + CELL} h${CELL}`);
        if (!plate.cells.has((x - 1) + ',' + y)) rimEdges.push(`M${px} ${py} v${CELL}`);
        if (!plate.cells.has((x + 1) + ',' + y)) rimEdges.push(`M${px + CELL} ${py} v${CELL}`);
      });
      parts.push(`<path class="plate-edge-rim" d="${rimEdges.join(' ')}"/>`);
    } else {
      const n = plate.size;
      parts.push(`<rect class="board-frame" x="${gx - 2}" y="${gy - 2}" width="${CELL * n + 4}" height="${CELL * n + 4}" rx="2"/>`);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (!blocked.has(x + ',' + y)) continue;
          const [px, py] = cellXY(x, y);
          parts.push(`<rect class="cell-blocked" x="${px + 1}" y="${py + 1}" width="${CELL - 2}" height="${CELL - 2}"/>
            <rect x="${px + 1}" y="${py + 1}" width="${CELL - 2}" height="${CELL - 2}" fill="url(#${fid}_blk)"/>
            <circle cx="${px + CELL / 2}" cy="${py + CELL / 2}" r="7" fill="rgba(16,12,18,0.85)" stroke="rgba(180,95,88,0.45)" stroke-width="1.2"/>
            <path d="M${px + CELL / 2 - 3} ${py + CELL / 2 - 3} l6 6 M${px + CELL / 2 + 3} ${py + CELL / 2 - 3} l-6 6" stroke="rgba(211,106,101,0.6)" stroke-width="1.4"/>`);
        }
      }
      for (let i = 0; i <= n; i++) {
        parts.push(`<line class="grid" x1="${gx + i * CELL}" y1="${gy}" x2="${gx + i * CELL}" y2="${gy + n * CELL}"/>`);
        parts.push(`<line class="grid" x1="${gx}" y1="${gy + i * CELL}" x2="${gx + n * CELL}" y2="${gy + i * CELL}"/>`);
      }
    }
    parts.push('</g>');

    /* 第 2 层：实际刻向与命中区。 */
    parts.push('<g class="layer-manuscript" pointer-events="none">');
    const membranes = V.State.manuscriptsOf(unit).filter((m) => m.id !== o.ms?.id).map((m) =>
      resolveManuscript(unit, plate, { wsMsId: m.id, wsMsOx: m.x, wsMsOy: m.y, wsMsRot: m.rotation, wsMsMir: m.mirrorY }, L));
    if (o.ms) membranes.push(o.ms);
    const msCells = new Set();
    for (const ms of membranes) {
      if (!ms || ms.disabled || !ms.oriented || !ms.fits) continue;
      parts.push(`<g data-ms-shape="${ms.id}" opacity="${o.ms && o.ms.id !== ms.id ? '0.66' : '1'}">`);
      const aligned = new Set(ms.cov.alignedCells || []);
      const [mx, my] = cellXY(ms.ox, ms.oy);
      parts.push(`<g transform="translate(${mx} ${my})">${membraneEngraving(ms.oriented, CELL, aligned, ms.ox, ms.oy)}</g>`);
      for (const [lx, ly] of ms.oriented.cells) msCells.add((lx + ms.ox) + ',' + (ly + ms.oy));
      /* 可拖命中区：蚀刻法膜和纹路一样能被抓起换位置 */
      if (o.interactive && !o.readOnlyMs) {
        parts.push(`<g class="layer-ms-hit" data-ms-ox="${ms.ox}" data-ms-oy="${ms.oy}" data-rot="${ms.rot}" data-mir="${ms.mir ? 1 : 0}" data-ms-cells="${ms.oriented.cells.map((c) => c.join(',')).join(';')}">`);
        ms.oriented.cells.forEach(([lx, ly]) => {
          const [px, py] = cellXY(lx + ms.ox, ly + ms.oy);
          parts.push(`<rect class="ms-hit" x="${px + 1}" y="${py + 1}" width="${CELL - 2}" height="${CELL - 2}"
            fill="transparent" pointer-events="all" data-act="wsMsGrab" data-ms-id="${ms.id}" data-id="${lx + ms.ox},${ly + ms.oy}" role="button"
            tabindex="0"><title>${esc(ms.spec.name)} · 拖动换位置</title></rect>`);
        });
        parts.push('</g>');
      }
      parts.push('</g>');
    }
    parts.push('</g>');

    /* 第 3 层：纹路本体按相同的朝向刻入金属表面。 */
    const placementById = new Map((placements || []).map((p) => [p.itemId, p]));
    const builtData = [];
    parts.push('<g class="layer-runes">');
    L.built.forEach((b) => {
      const pl = placementById.get(b.item.id) || { x: 0, y: 0 };
      const isSelected = o.pickId === b.item.id;
      const isErr = errorItems.has(b.item.id);
      const isLocked = locked.has(b.item.id);

      const partLive = b.aps.some((p) => flow.fwd.has(b.item.id + ':' + p.id) && flow.rev.has(b.item.id + ':' + p.id));
      const partCharged = b.aps.some((p) => flow.fwd.has(b.item.id + ':' + p.id));

      parts.push(`<g class="part-group ${isSelected ? 'selected' : ''} ${partLive ? 'live' : partCharged ? 'charged' : 'dormant'} ${isLocked ? 'locked' : ''}"
        data-act="wsGrab" data-id="${b.item.id}" data-px="${pl.x}" data-py="${pl.y}">
        <title>${esc(b.tpl.name)} · 点击选中 · 拖拽移动 · 右键/滚轮旋转${isLocked ? '' : ' · 双击卸下'}</title>`);
      const bx0 = gx + Math.min.apply(null, b.abs.map((c) => c.x)) * CELL;
      const by0 = gy + Math.min.apply(null, b.abs.map((c) => c.y)) * CELL;
      const runeTag = V.RuneArt && V.RuneArt.image
        ? V.RuneArt.image(b.tpl.id, {
          x: bx0, y: by0, cell: CELL,
          rotation: pl.rotation || 0, mirrorY: !!pl.mirrorY,
          cls: partLive ? 'rune-live' : partCharged ? 'rune-charged' : 'rune-dormant',
        })
        : '';
      if (runeTag) parts.push(runeTag);

      const labelCell = b.abs.slice().sort((a, c) => c.y - a.y || a.x - c.x)[0];
      const [lx, ly] = cellXY(labelCell.x, labelCell.y);
      parts.push(`<text class="part-label" x="${lx + CELL / 2}" y="${ly + CELL - 8}" text-anchor="middle">${esc(b.tpl.name)}</text>`);
      if (isLocked) {
        parts.push(`<text class="part-lock" x="${lx + CELL - 9}" y="${ly + 14}" text-anchor="end">锁</text>`);
      }
      b.abs.forEach((c) => {
        const [hx, hy] = cellXY(c.x, c.y);
        parts.push(`<rect class="part-hit" x="${hx}" y="${hy}" width="${CELL}" height="${CELL}" fill="transparent"/>`);
      });
      parts.push('</g>');

      builtData.push({ b, isSelected, isErr });
    });
    parts.push('</g>');

    /* === 第 4 层：高亮 / 通电动画 / 端子 / 错误标红 / 交互命中 === */
    parts.push('<g class="layer-highlights">');
    parts.push('<g class="layer-fx" pointer-events="none">');
    for (const film of membranes.filter(m => m?.fits && m.oriented)) {
      const selected = film.id === o.ms?.id;
      parts.push(`<path class="ms-contour ${selected ? 'focused' : ''}" ${selected ? 'data-ms-outline="' + esc(film.id) + '"' : ''} d="${footprint(film.oriented.cells,gx + film.ox*CELL,gy + film.oy*CELL)}"/>`);
    }

    const seenEdge = new Set();
    const portPoints = new Map();
    L.ports.forEach((p) => portPoints.set(p.itemId + ':' + p.id, portPoint(p)));
    Object.values(terminals).forEach((t) => portPoints.set('T:' + t.id, portPoint(t)));
    L.edges.forEach((e) => {
      if (e.internal) return;
      const k = e.from + '>' + e.to;
      if (seenEdge.has(k)) return;
      seenEdge.add(k);
      const a = portPoints.get(e.from);
      const b = portPoints.get(e.to);
      if (!a || !b) return;
      const isLive = flow.fwd.has(e.from) && flow.fwd.has(e.to) && flow.rev.has(e.from) && flow.rev.has(e.to);
      const isCharged = flow.fwd.has(e.from) && flow.fwd.has(e.to);
      const cls = isLive ? 'link-flow live' : isCharged ? 'link-flow charged' : 'link-flow';
      parts.push(`<line class="link ${cls}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`);
    });

    builtData.forEach(({ b, isSelected, isErr }) => {
      if (isSelected || isErr) parts.push(`<path class="part-unified-frame ${isErr ? 'bad' : ''}" d="${footprint(b.abs.map(c => [c.x,c.y]), gx, gy)}"/>`);
      b.aps.forEach((p) => {
        const [px, py] = portPoint(p);
        const pk = b.item.id + ':' + p.id;
        const lit = flow.fwd.has(pk) && flow.rev.has(pk) ? 'lit' : flow.fwd.has(pk) ? 'charged' : '';
        parts.push(portCut(px, py, p.dir, p.role, lit));
      });
    });

    /* 终端（画在 plate.terminals 所指板面边界外沿） */
    Object.values(terminals).forEach((t) => {
      const [x1, y1] = portPoint(t);
      const [x2, y2] = terminalPoint(t, true);
      const isIn = t.role === 'in';
      const active = isIn ? flow.fwd.has('T:' + t.id) : (flow.fwd.has('T:' + t.id) && flow.rev.has('T:' + t.id));
      parts.push(`<line class="link ${isIn ? 'link-in' : 'link-out'} ${active ? 'term-wire-lit' : ''}" x1="${x2}" y1="${y2}" x2="${x1}" y2="${y1}"/>`);
      parts.push(`<svg class="term-cut" data-term="${t.id}" x="${x2 - 4}" y="${y2 - 4}" width="8" height="8" viewBox="-4 -4 8 8" overflow="visible">${portCut(0, 0, t.dir, t.role, active ? 'lit' : '')}</svg>`);
      if (o.ms && t.manuscriptId && t.manuscriptId !== o.ms.id) return;
      let lx = x2;
      let ly = y2 - 4;
      let anchor = 'middle';
      if (t.dir === 'W') { lx = x2 - 8; anchor = 'end'; }
      else if (t.dir === 'E') { lx = x2 + 8; anchor = 'start'; }
      else if (t.dir === 'N') { ly = y2 - 9; }
      else { ly = y2 + 15; }
      parts.push(`<text class="terminal-label ${active ? 'lit' : ''}" x="${lx}" y="${ly}" text-anchor="${anchor}">${esc(t.id === 'main' ? '攻击' : t.name)}</text>`);
    });

    /* 冲突/不在板面红框 */
    errorCells.forEach((k) => {
      const [ex, ey] = k.split(',').map(Number);
      if (ex < 0 || ey < 0 || ex >= plate.size || ey >= plate.size) return;
      const [px, py] = cellXY(ex, ey);
      parts.push(`<rect class="cell-err" x="${px + 2}" y="${py + 2}" width="${CELL - 4}" height="${CELL - 4}" fill="url(#${fid}_err)"/>`);
    });
    parts.push('</g>');

    /* 瘢痕指示位于纹路之上，视觉不拦截原有装配操作。 */
    if (unit) V.Circuit.scarState(state, unit, placements).forEach((s) => {
      const [px, py] = cellXY(s.x, s.y);
      const detail = `瘢痕 · ${s.active ? '生效' : '空置'}\n${scarBonusText(s).replace(/<[^>]*>/g, '')}\n被${s.source}蚀刻 · 第 ${s.floor} 层`;
      parts.push(`<g class="scar-cell ${s.active ? 'active' : ''}" data-scar="${s.x},${s.y}" data-scar-tooltip="${esc(detail)}" tabindex="0" role="img" aria-label="${esc(detail)}"><rect x="${px}" y="${py}" width="${CELL}" height="${CELL}" fill="none" pointer-events="none"/><g transform="translate(${px+CELL-22} ${py+3})" pointer-events="none"><path class="scar-enamel" d="M2 0H17L20 3V16L12 20H2L0 17V3Z"/><path class="scar-mark ${s.active ? 'active' : ''}" d="M13 2L8 8L13 10L6 18M9 7L4 5M11 13L16 15"/></g></g>`);
    });

    if (o.interactive) {
      /* 蚀刻法膜占的格不算空格：它们有自己的拖拽命中层，不能被「点空格放置」抢走 */
      if (plate.generated) {
        cellsList.forEach(([x, y]) => {
          if (cellsUsed.has(x + ',' + y) || !o.readOnlyMs && msCells.has(x + ',' + y)) return;
          const [px, py] = cellXY(x, y);
          parts.push(`<rect class="hit" x="${px}" y="${py}" width="${CELL}" height="${CELL}" data-act="wsCell" data-id="${x},${y}" role="button" tabindex="0"><title>格 (${x},${y}) 点击放置选中纹路</title></rect>`);
        });
      } else {
        for (let y = 0; y < plate.size; y++) {
          for (let x = 0; x < plate.size; x++) {
            if (cellsUsed.has(x + ',' + y) || !o.readOnlyMs && msCells.has(x + ',' + y)) continue;
            const [px, py] = cellXY(x, y);
            parts.push(`<rect class="hit" x="${px}" y="${py}" width="${CELL}" height="${CELL}" data-act="wsCell" data-id="${x},${y}" role="button" tabindex="0"><title>格 (${x},${y})${blocked.has(x + ',' + y) ? ' 屏蔽格（不可放置）' : ' 点击放置选中纹路'}</title></rect>`);
          }
        }
      }
    }
    parts.push('<g class="drop-ghost" pointer-events="none" style="display:none"></g>');
    parts.push('</g>');

    parts.push('</svg>');
    return parts.join('');
  }

  /** 微型占格轮廓 SVG：供纹路库、仓库、掉落界面一眼区分形状与端口。 */
  function miniShapeSvg(templateId, rotation, mirrorY) {
    const tpl = D().template(templateId);
    if (!tpl) return '';
    const tf = V.Circuit.transformTemplate(tpl, rotation || 0, !!mirrorY);
    const maxX = Math.max(0, ...tf.cells.map((c) => c.x));
    const maxY = Math.max(0, ...tf.cells.map((c) => c.y));
    const span = Math.max(maxX + 1, maxY + 1, 2);
    const step = 11;
    const pad = 4;
    const size = span * step + pad * 2;
    const ox = pad + ((span - (maxX + 1)) * step) / 2;
    const oy = pad + ((span - (maxY + 1)) * step) / 2;
    const cells = tf.cells.map((c) => `<rect x="${ox + c.x * step}" y="${oy + c.y * step}" width="${step}" height="${step}" fill="#414343"/>`).join('');
    const runeImg = V.RuneArt && V.RuneArt.image
      ? V.RuneArt.image(templateId, { x: ox, y: oy, cell: step, rotation: rotation || 0, mirrorY: !!mirrorY })
      : '';
    const ports = tf.ports.map((pt) => {
      const [dx, dy] = DIR_VEC[pt.dir];
      const px = ox + pt.cell[0] * step + step / 2 + dx * (step / 2 - 0.5);
      const py = oy + pt.cell[1] * step + step / 2 + dy * (step / 2 - 0.5);
      return `<path class="rune-port-cut" data-dir="${pt.dir}" data-role="${pt.role}" d="M${px - dy * 1.6} ${py + dx * 1.6}l${dy * 3.2} ${-dx * 3.2}" stroke="${pt.role === 'in' ? '#9ac6c1' : '#e4c389'}" stroke-width="1.3"/>`;
    }).join('');
    return `<svg class="mini-shape" viewBox="0 0 ${size} ${size}" aria-hidden="true">${cells}${runeImg}${ports}</svg>`;
  }

  /* ------------------------------ 通用片段 ------------------------------ */

  function partName(state, id) {
    const it = state.itemsById[id];
    if (!it) return '（已失效）';
    return D().template(it.templateId).name;
  }

  function partMeta(state, id) {
    const it = state.itemsById[id];
    if (!it) return '';
    const t = D().template(it.templateId);
    return `回路 · ${t.cells.length} 格 · 负荷 ${t.load}`;
  }

  function partIcon(state, id) {
    const it = state.itemsById[id];
    if (!it) return '';
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
      ? `最深 ${state.bestDepth} 层 · ${state.gold} 金币 · ${state.roster.length} 位传奇`
      : '';
    return `<div class="v-title gate-title">
      <div class="v-title-bg">${V.Art.v1Tag('scene.camp', 'title-bg-img')}</div>
      <div class="v-title-frame">
        <div class="gate-inscription" aria-hidden="true"><i></i> ASHEN CORRIDOR</div>
        <h1 class="v-title-main">灰烬回廊</h1>
        <p class="v-quote">在活金属上刻下招式，带领远征队穿过七章回廊。</p>
        ${btn((hasSave ? '继续旅程' : '进入营地') + ' <span aria-hidden="true">→</span>', 'titleStart', { cls: 'v-cta' })}
        ${meta ? `<div class="v-title-meta">${esc(meta)}</div>` : ''}
        <div class="v-title-tools">
          ${btn('⚙ 设置与存档', 'openSettings', { cls: 'ghost xs' })}
        </div>
        ${ui.importOpen ? `<div class="v-import">
          <textarea id="importBox" rows="4" placeholder="把导出的存档文本粘到这里"></textarea>
          ${btn('确认导入', 'importConfirm', { cls: 'gold xs' })}
        </div>` : ''}
      </div>
    </div>`;
  }

  /* ------------------------------ 营地 ------------------------------ */

  function campScreen(state, ui) {
    const party = state.team.filter(Boolean);
    const upgrade = V.Expedition.PACK_UPGRADES[state.packLevel || 0];
    const costs = Object.entries(upgrade?.needs || {});
    const bag = V.Expedition.bagCapacity(state);
    const goalFloor = Math.max(3, Math.min(D().DESIGN.maxFloor, state.bestDepth + 1));
    const nextManuscript = D().manuscriptReward(state, D().rewardTier(goalFloor));
    return `<section class="outpost-hero camp-gate">
      <div class="outpost-art">${V.Art.v1Tag('scene.camp', 'outpost-img')}</div>
      <div class="outpost-copy">
        <h1>灰烬前哨</h1>
        <p>本趟目标 · 完成 <strong>${D().chapterLabel(goalFloor)}</strong> 后撤离</p>
        <div class="camp-prize">可带回蚀刻法「${esc(nextManuscript.name)}」</div>
        <div class="hero-actions">${btn('开始下潜 <span aria-hidden="true">↗</span>', 'startRun', { cls: 'gold primary-cta', disabled: party.length === 0 })}
          ${btn('前哨仓库','go',{cls:'ghost', data:{v:'stash'}})}
          ${btn('营地厨房', 'go', { cls: 'ghost', data: { v: 'kitchen' } })}
          <span class="tiny muted">${party.length ? `${party.length} 人就绪` : '请先编队'}</span></div>
      </div>
      <div class="departure-strip"><span>最深记录 <b>${state.bestDepth}</b> / 49 节点</span><div class="depth-track" aria-hidden="true">${Array.from({ length: 7 }, (_, i) => `<i class="${(i+1)*7 <= state.bestDepth ? 'explored' : i + 1 === D().chapterAt(goalFloor).number ? 'goal' : ''}"></i>`).join('')}</div></div>
    </section>
    <details class="camp-pack panel"><summary><strong>背包改装</strong> · ${bag} 格</summary>
      ${upgrade ? `<div class="row wrap mt2"><strong>${upgrade.name} · ${bag} → ${upgrade.capacity} 格</strong></div>
        <div class="row wrap mt2">${costs.map(([id,n]) => `<span class="small" title="${esc(V.Kitchen.INGREDIENTS[id].source)}">${itemLabel('ingredient', V.Kitchen.INGREDIENTS[id])} ${state.pantry?.[id] || 0}/${n}</span>`).join('')}
        ${btn('消耗材料扩容', 'upgradePack', { cls: 'gold sm', disabled: costs.some(([id,n]) => (state.pantry?.[id] || 0) < n) })}</div>` : '<p>全部改装完成</p>'}
    </details>
    ${pageHeading('远征队伍', '', btn('调整编队 →', 'go', { cls: 'ghost', data: { v: 'team' } }))}
    <div class="metal-party camp-party">${state.team.map((uid, slot) => {
      const u = uid ? ST().unitById(state, uid) : null;
      return `<article class="metal-card ${u ? '' : 'empty'}"><div class="metal-card-top"><span class="slot-index">0${slot + 1}</span><span class="tiny muted">${slot === 0 ? '前锋' : slot === 3 ? '后阵' : '中阵'}</span>${u ? `<span class="spacer"></span><span class="tiny muted">${(u.scars || []).length} 道瘢痕</span>` : ''}</div>
      ${u ? `<div class="metal-display">${legendPortrait(u)}</div>
        <div class="metal-card-name"><h2>${esc(u.name)}</h2><span class="tiny muted" title="${esc(terms.压力)}">压力 ${u.stress}</span></div>
        <div class="metal-card-manuscript"><span class="tiny muted">所修蚀刻法</span><b>${esc(manuscriptNames(u))}</b></div>
        <div class="metal-card-actions">${btn('人物详情', 'inspectUnit', { cls: 'ghost', data: { id: u.id } })}${btn('进入工坊', 'go', { cls: 'ghost', data: { v: 'workshop', id: u.id } })}</div>`
        : `<div class="empty-note">空缺身位</div>${btn('选择传奇', 'go', { cls: 'ghost', data: { v: 'team' } })}`}</article>`;
    }).join('')}</div>`;

  }

  /* ------------------------------ 队伍 ------------------------------ */

  function teamScreen(state, ui) {
    const selected = state.roster.find((u) => u.id === ui.teamUnit) || state.roster[0];
    return `${pageHeading('传奇编队', '')}
    <div class="formation-layout">
      ${panel('上场顺序', `
        <div class="vet-grid mt3">${state.team.map((uid, slot) => {
    const u = uid ? state.roster.find((x) => x.id === uid) : null;
    return `<div class="vet-slot ${u ? '' : 'empty'}">
      <div class="vet-slot-no">${slot + 1}号位</div>
      ${u ? legendPortrait(u, 'vet-slot-metal') + `<div class="vet-name">${esc(u.name)}</div><div class="vet-weapon">${esc(manuscriptNames(u))}</div>`
    : '<div class="vet-empty">空位</div>'}
      <div class="row tight mt2 slot-ops">
        ${slot > 0 ? btn('前移', 'teamMove', { cls: 'ghost xs', data: { from: String(slot), to: String(slot - 1) } }) : ''}
        ${btn('换上', 'teamPick', { cls: 'ghost xs', data: { id: String(slot) } })}
        ${u ? btn('换下', 'teamClear', { cls: 'ghost xs', data: { id: String(slot) } }) : ''}
        ${slot < 3 ? btn('后移', 'teamMove', { cls: 'ghost xs', data: { from: String(slot), to: String(slot + 1) } }) : ''}
      </div>
    </div>`;
  }).join('')}</div>
        ${ui.teamPickSlot != null ? `<div class="picker mt3"><div class="muted small mb2">选择角色放到 ${ui.teamPickSlot + 1} 号位</div>
        <div class="row wrap">${state.roster.map((u) => btn(u.name, 'teamSet', { cls: 'ghost xs', data: { slot: String(ui.teamPickSlot), id: u.id } })).join('')}</div></div>` : ''}
      `)}

      ${panel('人物档案', `<div class="row wrap">${state.roster.map((u) => btn(
    esc(u.name), 'inspectUnit',
    { cls: u.id === selected.id ? 'gold xs' : 'ghost xs', data: { id: u.id } },
  )).join('')}</div>
      ${selected ? unitDetail(state, selected) : ''}`)}
    </div>`;
  }

  function unitDetail(state, u) {
    const s = V.Roster.stats(state, u);
    const h = V.Roster.history(state, u.id);
    return `<div class="u-detail mt3">
      ${legendPortrait(u, 'unit-portrait')}
      <div class="u-detail-head"><b>${esc(u.name)}</b>
        <span class="muted small">${esc(D().body(u.bodyPreset).name)} · 压力 ${u.stress} · 逻辑槽 ${u.logicSlots}</span></div>
      <div class="stat-row">
        <span>生命 ${s.maxHp}</span><span>攻击 ${s.atk}</span><span>防御 ${s.def}</span>
        <span>负荷 ${s.loadCap}</span>
      </div>
      <div class="inscribed-list">${V.State.manuscriptsOf(u).map(m => `<p><b>${itemLabel('etching', m)}</b><span>${esc(D().manuscript(m.id)?.desc || m.desc)}</span></p>`).join('') || '<p>尚未装配蚀刻法</p>'}</div>
      <div class="small muted mt1">撤离调谐 · ${attunementText(h)}</div>

      <div class="mt2 row wrap">${btn('进入工坊', 'go', { cls: 'gold xs', data: { v: 'workshop', id: u.id } })}
        ${btn('编辑行为指令', 'editRules', { cls: 'ghost xs', data: { id: u.id } })}
        ${btn(state.gold >= 30 ? '安抚降压（30 金）' : '安抚（缺金币）', 'comfort', { cls: 'ghost xs', data: { id: u.id }, disabled: state.gold < 30 || u.stress === 0 })}</div>
    </div>`;
  }

  /* ------------------------------ 规则编辑 ------------------------------ */

  function rulesScreen(state, ui) {
    const u = state.roster.find((x) => x.id === ui.ruleUnit);
    if (!u) return panel('行为指令', '<p class="muted">先选一个角色。</p>');
    const rules = ui.ruleDraft || u.gambits;
    const inRun = !!(state.run && state.run.encounter);
    const pool = inRun
      ? state.run.encounter.preparation.formation.filter(Boolean).map((id) => state.roster.find((x) => x.id === id)).filter(Boolean)
      : state.roster;

    return panel(`${esc(u.name)} 的行为指令`, `
      <div class="row wrap mb2">${pool.map((x) => btn(x.name, 'editRules', {
    cls: x.id === u.id ? 'gold xs' : 'ghost xs', data: { id: x.id },
  })).join('')}
        <div class="spacer"></div>
      </div>
      ${u.manuscript ? `<div class="tiny muted mb2">蚀刻法 · <b class="gold">${esc(manuscriptNames(u))}</b></div>` : ''}
      <p class="muted small">从上到下，优先执行第一条可用指令。</p>
      <div class="rules mt2">${rules.map((r, i) => `<div class="rule-row ${r.enabled === false ? 'disabled' : ''}">
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
        <div class="rule-ops row tight">
          ${i > 0 ? btn('↑', 'ruleMoveUp', { cls: 'ghost xs', data: { id: String(i) } }) : ''}
          ${i < rules.length - 1 ? btn('↓', 'ruleMoveDown', { cls: 'ghost xs', data: { id: String(i) } }) : ''}
          ${btn(r.enabled === false ? '启用' : '停用', 'ruleToggle', { cls: r.enabled === false ? 'ghost xs' : 'on xs', data: { id: String(i) } })}
          ${btn('删', 'ruleDel', { cls: 'ghost xs danger', data: { id: String(i) } })}
        </div>
      </div>`).join('')}</div>
      <div class="row wrap mt3">${rules.length < u.logicSlots ? btn('+ 添加一条', 'ruleAdd', { cls: 'ghost' }) : `<span class="muted small">已用满 ${u.logicSlots} 个槽位</span>`}
        <div class="spacer"></div>
        ${btn('保存', 'ruleSave', { cls: 'gold' })}
        ${btn(inRun ? '返回战前整备' : '取消', 'ruleCancel', { cls: 'ghost' })}</div>
      ${ui.ruleErrors && ui.ruleErrors.length ? `<div class="err-box mt2">${ui.ruleErrors.map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
    `);
  }

  /* ------------------------------ 工坊 ------------------------------ */

  function draftSignature(list) {
    return (list || []).map((p) => `${p.itemId}:${p.x},${p.y},${p.rotation || 0},${p.mirrorY ? 1 : 0}`).sort().join('|');
  }

  /** 渲染蚀刻法膜覆盖率与贯通状态面板（分母永远是膜格数，摆不下时灰掉并给出明确原因）。 */
  function manuscriptPanelBody(ms, unit, state, readOnly) {
    const catalog = Object.keys(D().MANUSCRIPTS || {}).map((id) => D().MANUSCRIPTS[id]);
    const vault = (state && state.manuscriptVault) || [];
    const inVault = (id) => vault.some((m) => m.id === id);
    const equipped = V.State.manuscriptsOf(unit);
    const installed = (id) => equipped.some((m) => m.id === id);
    const chip = (m, location) => `<button class="ms-chip${ms?.id === m.id ? ' is-active' : ''}" data-act="wsMsPick" data-ms-drag="${readOnly ? '0' : '1'}" data-source="${location}" data-id="${m.id}" aria-pressed="${ms?.id === m.id}" title="${location === 'board' && unit.manuscript?.id === m.id ? '主修决定普攻与余裕' : esc(m.name)}">
      <span class="ms-chip-name">${itemLabel('etching', m)}</span><span class="ms-chip-meta">${location === 'board' ? (unit.manuscript?.id === m.id ? '主修' : '合修') : '库存 ×' + vault.filter((v) => v.id === m.id).length} · ${m.cells.length} 格</span></button>`;
    const picker = `<p class="small muted mb2">主修决定平攻和余裕恢复。合修追加招式或被动，招式共用余裕。</p><div class="row wrap tight mb2 ms-chips">${equipped.map((m) => chip(m, 'board')).join('')}
      ${catalog.filter((m) => inVault(m.id)).map((m) => installed(m.id) ? `<span class="tiny muted">${esc(m.name)} · 库存 ×${vault.filter((v) => v.id === m.id).length}</span>` : chip(m, 'vault')).join('')}</div>
      <div class="row wrap tight mb2">${readOnly ? '' : ms && installed(ms.id)
        ? (unit.manuscript?.id !== ms.id ? btn('设为主修', 'wsMsPromote', { cls: 'gold xs' }) : '') + btn('卸下蚀刻法', 'wsMsUnequip', { cls: 'ghost xs' })
        : ms && inVault(ms.id) ? btn('装入蚀刻法', 'wsMsEquip', { cls: 'gold xs' })
          : ms?.spec ? `<span class="tiny muted">${ms.spec.fieldSource ? `第 ${ms.spec.fieldDepth} 层起 · ${ms.spec.fieldSource === 'chest' ? '搜宝箱' : '击败精英'}后撤离` : `第 ${D().rewardNodes[ms.spec.unlockDepth-1]} 节点起撤离可发现`}</span>` : ''}</div>`;

    if (!ms || ms.disabled) {
      return picker;
    }

    const unfit = !ms.fits;
    const tierName = ms.cov.tier ? ms.cov.tier.name : '未达台阶';
    const pctText = `${ms.cov.aligned}/${ms.cov.total} · ${ms.cov.pct}%`;
    return `<div class="ms-panel ${unfit ? 'ms-unfit' : ''}" data-ms-fits="${ms.fits ? '1' : '0'}">
      ${picker}
      <div class="row wrap tight">
        <span class="small"><b class="${unfit ? 'danger' : 'gold'}">${itemLabel('etching', ms.spec)}</b> <span class="tiny muted">${installed(ms.id) ? (unit.manuscript?.id === ms.id ? '主修' : '合修') : '预览'} · ${ms.cov.total} 格 · 负荷 ${ms.spec.load || 0}</span></span>
        <div class="spacer"></div>
        <span class="tag ${unfit ? '' : ms.cov.tier ? 'tag-weapon' : ''}" data-ms-tier>${esc(unfit ? '无法覆盖' : tierName)}</span>
      </div>
      <div class="mt2">
        <div class="row tiny muted">
          <span>纹路覆盖</span>
          <div class="spacer"></div>
          <span class="${unfit ? 'muted' : 'gold'}" data-ms-cov>${esc(pctText)}</span>
        </div>
        ${bar(ms.cov.aligned, ms.cov.total, ms.cov.pct >= 100 ? 'energy' : 'hp')}
      </div>
      <div class="ms-live-benefit"><span>共鸣增幅</span><b>+${Math.round((((ms.cov.tier && ms.cov.tier.effect && ms.cov.tier.effect.mainMult) || 1) * (ms.rt.ok ? 1.1 : 1) - 1) * 100)}%</b><span data-ms-route>${ms.rt.ok ? '已贯通' : '未贯通'}</span></div>
      <div class="row wrap tight mt2">
        ${btn('旋转 ⟳', 'wsMsRotate', { cls: 'ghost xs', disabled: readOnly })}
        ${btn('翻转 ⇅', 'wsMsFlip', { cls: 'ghost xs', disabled: readOnly })}
        ${btn(`换落点 (${ms.validSpots.length ? `${ms.spotIdx + 1}/${ms.validSpots.length}` : '0'})`, 'wsMsShift', { cls: 'ghost xs', disabled: readOnly || ms.validSpots.length <= 1 })}
      </div>
      <details class="move-reference"><summary>招式与阵形动作</summary>${manuscriptDetails(ms.spec)}</details>
      <details class="manuscript-index"><summary>蚀刻法图鉴 · ${catalog.length}</summary>${[['chest','宝箱拓本'],['elite','精英拓本'],[undefined,'营地与撤离']].map(([source,label]) => `<details><summary>${label}</summary>${catalog.filter(m => m.fieldSource === source).map(m => `<button class="codex-line" data-act="wsMsPick" data-id="${m.id}" title="${esc(m.desc)}">${itemLabel('etching', m)}<span class="muted tiny">${source ? `第${m.fieldDepth}层起` : `${m.rarity}阶`} · ${m.cells.length}格</span></button>`).join('')}</details>`).join('')}</details>
      ${unfit ? `<div class="ms-reason" data-ms-reason><div>${esc(ms.reason)}</div></div>` : ''}
    </div>`;
  }

  function workshopScreen(state, ui) {
    const original = state.roster.find((u) => u.id === ui.wsUnit) || state.roster[0];
    const unit = workshopUnit(original, ui);
    if (unit !== original) state = { ...state, roster: state.roster.map((u) => u === original ? unit : u) };
    const draft = ui.wsDraft || (unit ? unit.board.placements : []);
    const pv = unit ? V.Circuit.preview(state, unit.id, draft) : { ok: false, errors: ['没有角色'], occupied: [], load: 0, reachableOutputs: [] };
    const plate = V.Circuit.plateOf(unit || { bodyPreset: 'sturdy', plateSeed: 1 });
    const cellsList = plateCellsList(plate);
    const layout = V.Circuit.layout(state, draft, plate.terminals);
    const ms = resolveManuscript(unit, plate, ui, layout);

    const locked = new Set(ui.wsLocked || []);
    const draftIds = new Set(draft.map((p) => p.itemId));
    const originIds = unit ? unit.board.placements.map((p) => p.itemId) : [];
    const savedMs = V.State.manuscriptsOf(original);
    const isDirty = unit && ui.wsMode !== 'inscribe' && (draftSignature(draft) !== draftSignature(unit.board.placements)
      || V.State.manuscriptsOf(unit).some((m, i) => { const old = savedMs[i]; return m.x !== old.x || m.y !== old.y || m.rotation !== old.rotation || m.mirrorY !== old.mirrorY; }));

    /* 纹路库：仓库里的闲置回路 + （工坊模式下）本角色原板卸下来暂未放置的纹路 */
    const source = ui.wsMode === 'inscribe' ? state.run.bag.filter(id => state.itemsById[id]?.acquiredRunId === state.run.id) : state.stash;
    const stashCircuits = source.filter((id) => state.itemsById[id]?.kind === 'circuit');
    const detachedOrigins = ui.wsMode === 'inscribe' ? [] : originIds.filter((id) => !stashCircuits.includes(id));
    const poolIds = [...stashCircuits, ...detachedOrigins].filter((id) => !draftIds.has(id));

    const pickedItem = ui.wsPick ? state.itemsById[ui.wsPick] : null;
    const pickedPlaced = ui.wsPick ? draft.find((p) => p.itemId === ui.wsPick) : null;
    const pickedTpl = pickedItem && pickedItem.kind === 'circuit' ? D().template(pickedItem.templateId) : null;
    const loadCap = unit ? V.Circuit.loadCap(unit) : 1;
    const loadOver = pv.load > loadCap;
    const draftStats = unit ? V.Roster.stats(state, unit, draft) : null;
    const pendingScar = ui.wsMode === 'inscribe' ? V.Expedition.inscriptionScar(state, unit.id, ui.inscribeItem, draft) : null;

    const surface = !plate.generated ? V.Art.imgTag('veteran.surface.board', 'board-surface-img') : '';
    return `
    <header class="atelier-head"><div><h1>${ui.wsMode === 'inscribe' ? '营火烙印 · 装入纹路' : '纹路工坊'}</h1>
      ${ui.wsMode === 'inscribe' ? `<span>${esc(unit.name)}</span>` : `<div class="ws-unit-picker">${state.roster.map(u => btn(esc(u.name), 'wsUnit', { cls: u.id === unit.id ? 'gold xs' : 'ghost xs', data: { id: u.id } })).join('')}</div>`}</div>
      ${ui.wsMode === 'inscribe' ? '' : btn(isDirty ? '保存改动' : '保存装配', 'wsSave', { cls: 'gold sm' })}
    </header>
    ${ui.wsMode === 'inscribe' ? '' : `<div class="palette-switch" role="group" aria-label="工坊工具">
      ${[['etchings','蚀刻法'],['runes','纹路']].map(([id,name]) => `<button type="button" data-act="wsPalette" data-id="${id}" aria-pressed="${(ui.wsPalette || 'etchings') === id}">${name}</button>`).join('')}</div>`}
    <div class="ws-layout" data-palette="${ui.wsMode === 'inscribe' ? 'field' : ui.wsPalette || 'etchings'}">
      <aside class="ws-left">
        ${panel('蚀刻法', manuscriptPanelBody(ms, unit, state, ui.wsMode === 'inscribe'))}
        ${(!pv.ok && pv.errors.length) || (ui.wsErrors && ui.wsErrors.length) ? `<div class="err-box">${(ui.wsErrors && ui.wsErrors.length ? ui.wsErrors : pv.errors).slice(0, 3).map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
      </aside>

      <div class="ws-board">
        <div class="board-heading"><div class="plate-owner">${legendPortrait(unit, 'plate-face')}<div><strong>${esc(unit.name)}</strong><span>${cellsList.length} 格金属 · 已装 ${V.State.manuscriptsOf(unit).length} 门</span></div></div>
          <div class="plate-load"><span>负荷 <b>${pv.load}</b> / ${loadCap}</span>${bar(pv.load, loadCap, loadOver ? 'hp' : 'energy')}</div></div>
        <div class="plate-key"><button type="button" class="film-switch" data-act="wsFilmView" aria-pressed="${!!ui.wsFilmView}"><i aria-hidden="true"></i>${ui.wsFilmView ? '返回装配视图' : '查看覆膜'}</button>
          <span class="scar-key" title="${esc(terms.瘢痕)}">⌁ 瘢痕 ${(unit.scars || []).length}</span></div>
        <div class="board-stack ${ui.wsFilmView ? 'film-view' : ''}">
          ${surface ? `<div class="board-surface">${surface}</div>` : ''}
          ${boardSvg(state, unit.id, draft, { interactive: true, pickId: ui.wsPick, locked, ms, readOnlyMs: ui.wsMode === 'inscribe' })}
        </div>
        <div class="plate-readout">${draftStats ? `<span>生命 <b>${draftStats.maxHp}</b></span><span>攻击 <b>${draftStats.atk}</b></span><span>防御 <b>${draftStats.def}</b></span>` : ''}</div>
        ${pickedTpl ? `<div class="ws-focus mt2">
          <div class="row wrap tight">
            <span class="gold small">${itemLabel('rune', pickedTpl)}</span>
            <span class="tag">${pickedTpl.cells.length} 格</span>
            <span class="tag">负荷 ${pickedTpl.load}</span>
            ${pickedPlaced ? '' : btn('对纹试铺', 'wsQuickPlace', { cls: 'gold xs', data: { id: pickedItem.id } })}
          </div>
          <div class="tiny muted mt1">${esc(pickedTpl.desc)}</div>
        </div>` : ''}
        <div class="row wrap tight atelier-tools">
          ${ui.wsPick ? btn('旋转 R', 'wsRotate', { cls: 'ghost sm' }) + btn('翻转 F', 'wsFlip', { cls: 'ghost sm' }) + btn('放下', 'wsCancelPick', { cls: 'ghost sm' }) : ''}
          ${btn('撤销', 'wsUndo', { cls: 'ghost sm', disabled: !(ui.wsHist && ui.wsHist.length) })}
          ${btn('重做', 'wsRedo', { cls: 'ghost sm', disabled: !(ui.wsRedo && ui.wsRedo.length) })}
        </div>
        ${ui.wsMode === 'inscribe' ? '' : `<details class="layout-tools"><summary>布局工具</summary><div class="row wrap tight">
          ${btn('自动接通', 'wsAutoConnect', { cls: 'ghost xs' })}
          ${btn(esc(D().PRESETS.basic.name), 'wsPreset', { cls: 'ghost xs', data: { id: 'basic' } })}
          ${btn(esc(D().PRESETS.charge.name), 'wsPreset', { cls: 'ghost xs', data: { id: 'charge' } })}
          ${isDirty ? btn('还原已存', 'wsRevert', { cls: 'ghost xs' }) : ''}
          ${btn('清空纹路', 'wsClear', { cls: 'ghost xs', disabled: !draft.some(p => !locked.has(p.itemId)) })}
        </div></details>`}
      </div>

      <aside class="ws-right">
        ${panel(`${ui.wsMode === 'inscribe' ? '随行纹路' : '纹路库'}（${poolIds.length}）`, `

          <div class="part-list">${poolIds.length ? poolIds.map((id) => {
    const it = state.itemsById[id];
    const t = D().template(it.templateId);
    const isPicked = ui.wsPick === id;
    const rot = isPicked ? ui.wsRot : 0;
    const mir = isPicked ? ui.wsMirror : false;
    return `<button class="part-item ${isPicked ? 'on' : ''}" data-act="wsPick" data-id="${id}" data-stash="1"
      ${locked.has(id) ? 'disabled' : ''}>
      <span class="part-shape-box">${miniShapeSvg(t.id, rot, mir)}</span>
      <span class="part-text">
        <span class="part-name">${itemLabel('rune', t)} <span class="tiny muted">· ${t.cells.length}格 · 负荷${t.load}</span></span>
        <span class="part-meta">${esc(t.desc.replace(/^\d+ 负荷。纹路覆盖时，/, ''))}</span>
      </span>
    </button>`;
  }).join('') : '<div class="muted small">没有闲置纹路了</div>'}</div>
        `)}
        ${panel(`板面上的纹路（${draft.length}）`, `<div class="part-list">${draft.length ? draft.map((p) => {
    const it = state.itemsById[p.itemId];
    if (!it) return '';
    const t = D().template(it.templateId);
    const isLocked = locked.has(p.itemId) || ui.wsMode === 'inscribe';
    return `<div class="part-item ${ui.wsPick === p.itemId ? 'on' : ''}" data-act="wsPick" data-id="${p.itemId}">
      <span class="part-shape-box">${miniShapeSvg(t.id, p.rotation, p.mirrorY)}</span>
      <span class="part-text">
        <span class="part-name">${itemLabel('rune', t)}</span>
        <span class="part-meta">${t.cells.length} 格 · 负荷 ${t.load}</span>
      </span>
      <span class="row tight">
        ${isLocked ? '' : btn('卸下', 'wsRemove', { cls: 'ghost xs', data: { id: p.itemId } })}
      </span>
    </div>`;
  }).join('') : '<div class="muted small">板面空着</div>'}</div>`)}
        ${ui.wsMode === 'inscribe' ? `<div class="col mt2">
          <div class="panel scar-preview"><b class="small">瘢痕预览</b>${pendingScar ? `<div class="scar-effect">${scarBonusText(pendingScar)}</div><div class="tiny muted">格 (${pendingScar.x + 1}, ${pendingScar.y + 1}) · 被${esc(pendingScar.source)}蚀刻</div>` : '<p class="tiny muted">当前落点无新瘢痕</p>'}</div>
          ${btn('按推荐布局摆放', 'wsAutoLayout', { cls: 'ghost sm' })}
          ${btn('烙印 · 生命上限 −20%，压力 +40', 'wsInscribe', { cls: 'gold sm', disabled: !pv.ok || !draftIds.has(ui.inscribeItem) })}
          ${btn('取消', 'cancelInscribe', { cls: 'ghost sm' })}
        </div>` : ''}
      </aside>
    </div>`;
  }

  /* ------------------------------ 招募 / 仓库 / 战史 ------------------------------ */

  function recruitScreen(state, ui) {
    const offers = state.shop || [];
    return `<section class="hearth-arrivals">${pageHeading('火塘来客', `已结识 ${D().SKINS.filter((s) => state.roster.some((u) => u.skinId === s.id)).length} / 21 位`, btn('打听来客 · 12 金', 'refreshShop', { cls: 'ghost', disabled: state.gold < 12 || D().SKINS.every((s) => state.roster.some((u) => u.skinId === s.id)) }))}
      <div class="recruit-grid">${offers.map((o) => {
        const preview = ST().makeUnit({ ...state }, { ...o, plateSeed: o.plateSeed == null ? A.Random.seedFrom(o.id) : o.plateSeed });
        const plate = V.Circuit.plateOf(preview);
        return `<article class="recruit-card metal-card ${o.sold ? 'sold' : ''}"><div class="metal-display">${legendPortrait(preview)}</div><h2>${esc(o.name)}</h2><p class="arrival-body">${esc(D().body(preview.bodyPreset).name)} · ${plate.cellsList.length} 格板面</p><div class="recruit-price"><span><b>${o.price}</b> <span class="muted tiny">金币</span></span>${o.sold ? '<span class="quiet-status">已加入营地</span>' : btn('邀请加入 →', 'recruitOffer', { cls: 'gold', data: { id: o.id }, disabled: state.gold < o.price || state.roster.some((u) => u.skinId === o.skinId) })}</div></article>`;
      }).join('') || '<div class="empty-note">火塘旁暂时没有来客</div>'}</div>${ui.shopMsg ? `<div class="err-box mt3">${esc(ui.shopMsg)}</div>` : ''}</section>`;
  }

  function catalogueControls(placeholder, options) {
    return `<div class="catalogue-tools"><input type="search" data-catalogue-query aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}"><select data-catalogue-filter aria-label="筛选">${options.map(([key, name]) => `<option value="${key}">${name}</option>`).join('')}</select></div>`;
  }

  function catalogueFooter() {
    return '<footer class="catalogue-footer"><small data-catalogue-count role="status"></small><button type="button" class="btn ghost sm" data-catalogue-more>显示更多</button></footer>';
  }

  function etchingMark(m) {
    const shape = V.Manuscript.normalize(m);
    const width = (1 + Math.max(...shape.cells.map(c => c[0]))) * 60;
    const height = (1 + Math.max(...shape.cells.map(c => c[1]))) * 60;
    return `<svg class="etch-mark" viewBox="-2 -2 ${width+4} ${height+4}" aria-hidden="true">${membraneEngraving(shape, 60)}</svg>`;
  }

  function archiveCatalogue() {
    const entries = (items, kind) => items.map(m => {
      const source = kind === 'rune' ? '战获 · 宝箱 · 游商' : m.fieldSource
        ? `第 ${m.fieldDepth} 层起 · ${m.fieldSource === 'chest' ? '宝箱拓本' : '精英战获'}`
        : `完成 ${D().rewardNodes[m.unlockDepth-1]} 个节点起 · 撤离奖励`;
      return `<article class="catalogue-entry" data-catalogue-item="${esc([m.name, m.desc, source].join(' '))}" data-filter="${kind}">
        <div class="catalogue-shape">${kind === 'rune' ? miniShapeSvg(m.id, 0, false) : etchingMark(m)}</div><small>${kind === 'rune' ? '纹路' : '蚀刻法'} · ${m.cells.length} 格 · 负荷 ${m.load}</small><h4>${itemLabel(kind, m)}</h4><p>${esc(m.desc)}</p><small>${esc(source)}</small></article>`;
    }).join('');
    return `<details class="archive-catalogue" data-catalogue="archive"><summary>回廊藏品索引</summary>
      ${catalogueControls('查名称、效果或出处', [['','全部藏品'],['etching','蚀刻法'],['rune','纹路']])}
      <div class="k-recipes">${entries(Object.values(D().MANUSCRIPTS), 'etching')}${entries(Object.values(D().TEMPLATES), 'rune')}</div>${catalogueFooter()}</details>`;
  }

  function footprintArt(tag,token,indices,selected,turn,art,prefix) {
      const cols = indices.map(i => i % 6);
      const left = Math.min(...cols), right = Math.max(...cols);
      const top = Math.floor(indices[0] / 6), bottom = Math.floor(indices.at(-1) / 6);
      const width = right-left+1, height = bottom-top+1;
      const cells = indices.map(i => [i%6-left, Math.floor(i/6)-top]);
      const occupied = new Set(cells.map(([x,y]) => x+','+y));
      const fill = cells.map(([x,y]) => `M${x} ${y}h1v1h-1z`).join('');
      const outline = cells.map(([x,y]) => [
        occupied.has(x+','+(y-1)) ? '' : `M${x} ${y}h1`,
        occupied.has((x+1)+','+y) ? '' : `M${x+1} ${y}v1`,
        occupied.has(x+','+(y+1)) ? '' : `M${x+1} ${y+1}h-1`,
        occupied.has((x-1)+','+y) ? '' : `M${x} ${y+1}v-1`,
      ].join('')).join('');
      const backing = `<svg class="pack-shell" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><path class="pack-surface" d="${fill}"/><path class="pack-rim" d="${outline}" vector-effect="non-scaling-stroke"/></svg>`;
      const clipId = prefix + '-outline-' + indices[0];
      const mask = tag.food && width*height > indices.length
        ? `<svg style="position:absolute" width="0" height="0"><defs><clipPath id="${clipId}" clipPathUnits="objectBoundingBox">${cells.map(([x,y]) => `<rect x="${x/width}" y="${y/height}" width="${1/width}" height="${1/height}"/>`).join('')}</clipPath></defs></svg>` : '';
      const nameplate = tag.kind === 'rune' && indices.length > 1 ? `<small class="pack-nameplate" style="left:calc(${100*cells[0][0]/width}% + 4px);top:calc(${100*cells[0][1]/height}% + 4px)">${esc(tag.spec.name)}</small>` : '';
      return `${mask}<span class="pack-footprint ${selected ? 'is-selected' : ''}" aria-hidden="true" data-pack-kind="${tag.kind}" data-pack-art="${esc(token)}" style="--item-turn:${turn*90}deg;grid-column:${left+1}/${right+2};grid-row:${top+1}/${bottom+2};${mask ? 'clip-path:url(#'+clipId+')' : ''}">${backing}${art}${nameplate}</span>`;
  }

  function stashScreen(state, ui) {
    const E = V.Expedition, active = ui.stashShelf || 'food';
    const {slots,entries,places,overflow} = E.storeLayout(state,active);
    const shelves = [['food','食材'],['meal','料理'],['part','纹路'],['etch','蚀刻法']];
    const total = stock => Object.values(stock || {}).reduce((sum,n)=>sum+n,0);
    const counts = [total(state.pantry),total(state.mealStore),state.stash.length,(state.manuscriptVault || []).length];
    const picked = entries.has(ui.storePick) ? ui.storePick : null;
    function describe(token) {
      const id = token.split(':')[1].split('#')[0];
      if (active === 'food') return {id,spec:V.Kitchen.INGREDIENTS[id],kind:'ingredient',food:true};
      if (active === 'meal') return {id,spec:V.Kitchen.RECIPES[id],kind:'recipe'};
      if (active === 'etch') return {id,spec:D().manuscript(id),kind:'etching'};
      const part = state.itemsById[id];
      return part.kind === 'weapon' ? {id,spec:D().weapon(part.weaponId || part.templateId),kind:'weapon'} : {id,spec:D().template(part.templateId),kind:'rune'};
    }
    const cells = slots.map((token,i)=>{
      const first = token && slots.indexOf(token) === i;
      const name = token ? describe(token).spec.name : '空格';
      return `<button type="button" class="pack-slot" data-act="storeSlot" data-id="${i}" data-token="${esc(token || '')}" draggable="${!!token}" title="${esc(name)}" aria-label="第 ${i+1} 格 · ${esc(name)}" aria-pressed="${!!token && token===picked}" style="grid-column:${i%6+1};grid-row:${Math.floor(i/6)+1}">${first && entries.get(token).count>1 ? '<small>×'+entries.get(token).count+'</small>' : ''}</button>`;
    }).join('');
    const art = Object.keys(places).map(token=>{
      const tag = describe(token), turn = entries.get(token).turn;
      const drawing = tag.kind === 'rune' ? V.RuneArt.thumb(tag.spec.id,null,turn) : tag.kind === 'weapon' ? esc(tag.spec.name) : V.CatalogueArt?.icon(tag.kind,tag.spec.id) || '';
      return footprintArt(tag,token,slots.flatMap((v,i)=>v===token?[i]:[]),token===picked,turn,drawing,'store');
    }).join('');
    const tag = picked && describe(picked);
    const detail = tag ? `<h3>${esc(tag.spec.name)}</h3><p>${entries.get(picked).cells.length} 格 · ×${entries.get(picked).count}</p>
      ${entries.get(picked).cells.length>1 && places[picked] ? btn('旋转 ↻','storeRotate',{cls:'ghost sm'}) : ''}
      ${tag.kind === 'etching' ? btn('试装','go',{cls:'ghost sm',data:{v:'workshop',ms:tag.id}}) : ''}` : '<p>选中物品查看，点空格换位。</p>';
    const upgrades = Object.entries(E.STORE_UPGRADES).map(([key,levels])=>{
      const level = state[key==='rack'?'rackLevel':'binLevel'] || 0, upgrade = levels[level];
      const effect = key==='rack'?'每架 +12 格':'食材、料理每堆 +2 份';
      if (!upgrade) return `<p>${key==='rack'?'货架已全部扩建':'密封分装匣已安装'}</p>`;
      const costs = Object.entries(upgrade.needs);
      return `<div class="store-upgrade"><b>${esc(upgrade.name)}</b><small>${effect}</small><p>${costs.map(([id,n])=>esc(V.Kitchen.INGREDIENTS[id].name)+' '+(state.pantry?.[id]||0)+'/'+n).join(' · ')}</p>${btn(key==='rack'?'扩建货架':'安装分装匣','storeUpgrade',{cls:'gold sm',data:{id:key},disabled:costs.some(([id,n])=>(state.pantry?.[id]||0)<n)})}</div>`;
    }).join('');
    const mealIds = active==='meal' ? [...new Set([...Object.keys(state.packedMeals||{}),...Object.keys(state.mealStore||{})])] : [];
    const meals = mealIds.map(id=>`<div class="store-transfer">${itemLabel('recipe',V.Kitchen.RECIPES[id])}<small>随身 ${state.packedMeals?.[id]||0} · 库中 ${state.mealStore?.[id]||0}</small>
      ${btn('装入背包','transferMeal',{cls:'ghost xs',data:{id,v:'pack'},disabled:!state.mealStore?.[id] || !E.canPack(state,'meal:'+id)})}
      ${btn('存入仓库','transferMeal',{cls:'ghost xs',data:{id,v:'store'},disabled:!state.packedMeals?.[id]})}</div>`).join('');
    return `<header class="archive-head"><h1>前哨仓库</h1><div class="row wrap">${btn('营地厨房','go',{cls:'ghost sm',data:{v:'kitchen'}})}${btn('去工坊','go',{cls:'ghost sm',data:{v:'workshop'}})}</div></header>
      <section class="store-shelves"><div class="store-tabs" aria-label="仓库存放类别">${shelves.map(([id,name],i)=>`<button type="button" data-act="stashShelf" data-id="${id}" aria-pressed="${active===id}">${name}<b>${counts[i]}</b></button>`).join('')}</div>
      <div class="store-body"><div><div class="pack-tools"><b>${shelves.find(v=>v[0]===active)[1]}架</b><span>${slots.filter(Boolean).length} / ${slots.length} 格</span>${btn('一键整理','storeSort',{cls:'ghost sm'})}</div>
      <div class="pack-grid store-grid" role="group" aria-label="仓库格位">${cells}${art}</div>
      ${overflow.length?`<section class="pack-reserve"><h3>待上架</h3>${overflow.map(t=>btn(describe(t).spec.name+' ×'+entries.get(t).count,'storePick',{cls:'ghost sm',data:{id:t}})).join('')}</section>`:''}</div>
      <aside><section class="pack-detail">${detail}</section>${meals}<h3>仓库改装</h3>${upgrades}</aside></div></section>${archiveCatalogue()}`;
  }

  function ingredientSummary(stock) {
    return Object.entries(stock || {}).filter(([, n]) => n > 0)
      .map(([id, n]) => `<span class="ingredient-quantity">${itemLabel('ingredient', V.Kitchen.INGREDIENTS[id])} ×${n}</span>`).join('、') || '暂无食材';
  }

  function ingredientRows(stock, collecting, full = false) {
    return Object.entries(stock || {}).filter(([, n]) => n > 0).map(([id, n]) => {
      const it = V.Kitchen.INGREDIENTS[id];
      return `<div class="k-stock-row"><div><b>${itemLabel('ingredient', it)} ×${n}</b><small>${esc(it.desc)}</small></div>
        ${btn(collecting ? full ? '背包已满' : '拾取一份' : '丢弃一份', collecting ? 'takeIngredient' : 'dropIngredient',
          { cls: collecting ? 'gold sm' : 'ghost sm', data: { id }, disabled: collecting && full })}</div>`;
    }).join('');
  }

  function biomeNotes(state) {
    const r = state.run;
    const region = V.Kitchen.biome(D().chapterAt(r.floor).region);
    const species = new Set();
    for (const n of r.nodes) {
      if (!['battle', 'elite', 'boss'].includes(n.type)) continue;
      const tpl = D().chapterEncounter(n.type === 'battle' ? 'normal' : n.type, state.stats.runs, r.floor);
      for (const id of [tpl.bossId, ...tpl.minionIds]) if (id) species.add(id);
    }
    return `<section class="k-biome"><header><h3>${esc(region.name)}</h3><span>采集 · ${esc(V.Kitchen.INGREDIENTS[region.forage].name)}</span></header>
      <p>${esc(region.desc)}</p><details><summary>本层物种与食物链</summary>
      <p>可采集 · ${V.Kitchen.forageOptions(D().chapterAt(r.floor).region).map(id => itemLabel('ingredient', V.Kitchen.INGREDIENTS[id])).join('、')}</p>
      <dl>${Array.from(species, (id) => {
        const species = D().enemy(id);
        const e = V.Kitchen.ECOSYSTEM[id];
        if (!e) return `<dt>${esc(species.name)}</dt><dd>${esc(species.desc)}</dd>`;
        return `<dt>${esc(species.name)} · ${esc(e.role)}</dt><dd>${esc(e.food)} · ${esc(e.habitat)}<br>可取材 · ${V.Kitchen.harvestOptions(id).map(key => itemLabel('ingredient', V.Kitchen.INGREDIENTS[key])).join('、')}</dd>`;
      }).join('')}</dl></details></section>`;
  }

  function kitchenScreen(state, ui) {
    const field = !!state.run;
    const stock = (field ? state.run.ingredients : state.pantry) || {};
    const kitchen = V.Kitchen;
    const packed = (field ? state.run.meals : state.packedMeals) || {};
    const busy = ui.cooking;
    const cooking = busy ? `<div class="k-cooking" role="status" style="--cook-delay:-${Math.max(0, performance.now() - busy.started)}ms"><div class="k-pot" aria-hidden="true"><i></i><i></i><i></i><b>♨</b></div>${V.CatalogueArt.icon('recipe', busy.id)}<span>正在制作${esc(kitchen.RECIPES[busy.id].name)}…</span></div>` : '';
    const recipes = Object.values(kitchen.RECIPES).map((r) => {
      const plan = kitchen.planIngredients(stock, r);
      return { r, ready: !!plan && kitchen.canCook(state, r.id), plan };
    }).sort((a, b) => Number(b.ready) - Number(a.ready) || Number(!!b.plan) - Number(!!a.plan));
    if (field) {
      const available = recipes.filter(({ ready }) => ready);
      return `<section class="k-kitchen field-kitchen" aria-label="营火炊事" aria-busy="${!!busy}"><div class="field-workbench">
        <div class="field-pack">${packDialog(state, ui, true)}</div>
        <section class="field-cookbook"><header class="pack-heading"><h2>营火炊事</h2><small>可做 ${available.length} 道</small></header>
          ${cooking}<div class="field-recipes">${available.map(({ r }) => `<article class="k-recipe field-recipe"><button type="button" data-act="cookRecipe" data-id="${r.id}" aria-label="制作${esc(r.name)}" title="${esc(r.method)}" ${busy ? 'disabled' : ''}>${V.CatalogueArt.icon('recipe', r.id)}<b>${esc(r.name)}</b><small>${r.heal ? `生命 +${Math.round(r.heal * 100)}% · ` : ''}压力 −${r.calm}</small></button></article>`).join('')}</div>
          ${available.length ? '' : '<p class="field-cook-empty">暂无可制作的料理。整理行囊或带回更多原料后再来。</p>'}
        </section></div></section>`;
    }
    const candidates = new Map();
    const accepted = (id) => {
      if (!candidates.has(id)) candidates.set(id, Object.values(kitchen.INGREDIENTS).filter(it => kitchen.acceptsIngredient(id, it.id)));
      return candidates.get(id);
    };
    const card = ({ r, ready, plan }) => {
      const count = state.cookedRecipes?.[r.id] || 0;
      const needs = Object.entries(r.needs);
      const names = needs.flatMap(([id]) => accepted(id).map(it => it.name));
      const swaps = needs.filter(([id]) => accepted(id).some(it => it.id !== id));
      const substituted = plan && needs.some(([id, qty]) => plan[id] !== qty);
      return `<article class="k-recipe ${ready ? 'ready' : ''}" data-catalogue-item="${esc([r.name, ...names].join(' '))}" data-filter="${plan ? 'stocked ' : ''}${count ? 'cooked' : 'new'}"><div class="k-recipe-head"><h4>${itemLabel('recipe', r)}</h4>
        ${count ? `<small>已做 ${count} 次</small>` : ''}</div><p>${esc(r.method)}</p>
        <ul class="k-needs" aria-label="配方用料">${needs.map(([id, qty]) => `<li>${itemLabel('ingredient', kitchen.INGREDIENTS[id])} <b>×${qty}</b></li>`).join('')}</ul>
        ${substituted ? `<div class="recipe-use">本次用料 · ${ingredientSummary(plan)}</div>` : ''}
        ${swaps.length ? `<details class="recipe-swaps"><summary>可替换食材</summary>${swaps.map(([id]) => `<p>${esc(kitchen.INGREDIENTS[id].name)}可换用${accepted(id).filter(it => it.id !== id).map(it => esc(it.name)).join('、')}。</p>`).join('')}</details>` : ''}
        <div class="k-recipe-foot"><span>${field && r.heal ? '生命 +' + Math.round(r.heal * 100) + '% · ' : ''}压力 −${r.calm}</span>
          ${btn(busy?.id === r.id ? '制作中…' : ready ? '烹饪一份' : plan ? '背包放不下' : '缺食材', 'cookRecipe', { cls: ready ? 'gold' : 'ghost', data: { id: r.id }, disabled: !ready || !!busy })}</div></article>`;
    };
    return `<section class="k-kitchen"><header class="k-stove">
      ${V.Art.v1Tag('node.camp', 'k-stove-art')}<div><h2>${field ? '营火炊事' : '营地厨房'}</h2>
      <p>做好后收进背包，选一名队员用餐。</p></div>
      <div class="k-stove-actions">${btn('打开背包 · ' + Object.values(packed).reduce((n,q) => n+q,0) + ' 份菜品','kitchenPack',{cls:'gold sm'})}
      ${field ? '' : btn('查看仓库', 'go', { cls: 'ghost sm', data: { v: 'stash' } })}</div></header>
      ${cooking}<div class="k-workbench"><aside class="k-pantry"><h3>${field ? '随行食材' : '食材架'}</h3>
        <p>${ingredientSummary(stock)}</p>
        ${Object.keys(packed).length ? `<h3 class="k-table-heading">已装盒</h3>${Object.entries(packed).filter(([,q])=>q>0).map(([id,q])=>`<div class="k-diner">${itemLabel('recipe',kitchen.RECIPES[id])}<b>×${q}</b></div>`).join('')}` : ''}</aside>
      <section class="k-cookbook" data-catalogue="recipes"><h3>料理手册</h3>
      ${catalogueControls('查菜名或食材', [['','全部食谱'],['stocked','材料齐全'],['new','尚未做过'],['cooked','做过的菜']])}
      <div class="k-recipes">${recipes.map(card).join('')}</div>${catalogueFooter()}
      </section></div></section>`;
  }

  function historyScreen(state, ui) {
    const u = state.roster.find((x) => x.id === ui.histUnit) || state.roster[0];
    const h = u ? V.Roster.history(state, u.id) : null;
    return `<header class="archive-head chronicle-head"><h1>远征战史</h1><span>最深抵达 ${state.bestDepth} 层</span></header>
    <div class="grid-2">
      ${panel('传奇', `<div class="row wrap">${state.roster.map((x) => btn(x.name, 'inspectHistory', {
    cls: x.id === (u && u.id) ? 'gold xs' : 'ghost xs', data: { id: x.id },
  })).join('')}</div>
        ${h ? `<div class="mt3">
          <div class="small">合格撤离 <b class="gold">${h.eligibleRuns}</b> 次</div>
          <div class="small mt1">指令位 ${h.logicSlots} / 3${h.logicSlots < 3 ? ` · 再撤离 ${h.nextSlotIn} 次解锁` : ''}</div>
          <div class="small mt1">撤离调谐 · ${attunementText(h)}</div>
        </div>` : ''}`)}
      ${panel('最近记录', h && h.records.length ? h.records.map((r) => `<div class="hist-row">
        <span class="hist-name">${esc({ extract: '撤离', clear: '通关', emergency: '紧急撤退', defeat: '败退' }[r.kind] || r.kind)}</span>
        <span class="muted tiny">${r.depth} 层</span>
        <span class="${r.eligible ? 'success' : 'muted'} tiny">${esc(r.reason)}</span>
      </div>`).join('') : '<div class="muted small">还没有记录。</div>')}
    </div>`;
  }

  /* ------------------------------ 地图 ------------------------------ */

  function expeditionHeader(state, art, title, detail) {
    return `<header class="ex-header">${V.Art.anyImgTag(art, 'ex-backdrop')}
      <div class="ex-header-text"><span>远征 / ${D().chapterLabel(state.run?.floor ?? state.settlement.depth)}</span>
      <h1>${esc(title)}</h1>${detail ? `<p>${esc(detail)}</p>` : ''}</div></header>`;
  }

  function mapScreen(state, ui) {
    const r = state.run;
    const max = D().DESIGN.maxFloor;
    const chapter = D().chapterAt(r.floor);
    const upcoming = D().manuscriptReward(state, D().rewardTier(Math.max(3, r.floor)));
    const milestone = D().DESIGN.blessingFloors.includes(r.floor) && D().BLESSING_ORDER.some(id => !r.blessings.includes(id)) ? '完成本层可选一项远征祝福' :
      chapter.step === 7 && r.floor < max ? '击败守关者，可撤离或进入下一章' : r.floor === max ? `击败首领，带回「${upcoming.name}」` :
      `${r.floor < 3 ? '完成三层' : '完成本层'}后撤离，可带回「${upcoming.name}」`;
    const rewards = { battle: '金币 · 纹路 · 战后取材', elite: '更多金币 · 两件纹路 · 取材', boss: r.floor === max ? '通关 · 三件纹路' : '突破本章 · 三件纹路', chest: '两件纹路 · 采集食材', camp: '休整 · 营火做菜 · 烙印', merchant: '购买纹路', event: '调查现场 · 自选结果' };
    if (!r.fieldManuscript) {
      rewards.chest += ' · 可能藏有拓本';
      rewards.elite += ' · 战获拓本';
    }
    return `<div class="ex-page">
      ${expeditionHeader(state, chapter.step === 7 ? 'scene.boss' : 'scene.corridor', chapter.step === 7 ? D().enemy(chapter.boss).name : chapter.name, milestone)}
      <ol class="ex-depth" aria-label="远征进度">${Array.from({ length: 7 }, (_, i) => {
        const floor = (chapter.number-1)*7+i+1;
        return `<li class="${floor === r.floor ? 'here' : floor < r.floor ? 'passed' : ''}" ${floor === r.floor ? 'aria-current="step"' : ''}>
          <b>${String(i+1).padStart(2, '0')}</b><span>${i === 6 ? '首领' : D().DESIGN.blessingFloors.includes(floor) ? '祝福' : '下潜'}</span></li>`;
      }).join('')}</ol>
      <details class="chapter-itinerary"><summary>七章路线</summary><ol>${D().CHAPTERS.map((c,i) =>
        `<li ${i+1 === chapter.number ? 'aria-current="step"' : ''}><b>${esc(c.name)}</b><small>${esc(D().enemy(c.boss).name)}</small></li>`).join('')}</ol></details>
      <div class="ex-map-layout"><section class="ex-fork"><h2>选择去路</h2><div class="ex-paths">${r.nodes.map((n) => {
        const risk = ['chest', 'merchant'].includes(n.type) ? '补给'
          : { low: '低危', medium: '中危', high: '高危', deadly: '致命', none: '安全' }[n.risk] || n.risk;
        return `<button class="ex-road" data-act="chooseNode" data-id="${esc(n.id)}" ${n.consumed ? 'disabled' : ''}>
          <span class="ex-road-image">${A.Art?.imgTag(n.artId, '', '') || ''}</span>
          <span class="ex-road-info"><small class="ex-risk risk-${esc(n.risk)}">${esc(risk)}</small>
          <strong>${esc(n.name)}</strong><span>${esc(rewards[n.type] || n.desc)}</span></span></button>`;
      }).join('')}</div>${biomeNotes(state)}</section>
      <aside class="ex-manifest"><h2>随行小队</h2><div class="ex-crew">${r.party.map((p) => {
        const u = state.roster.find((x) => x.id === p.uid);
        const maxHp = V.Roster.stats(state, u).maxHp;
        const hp = p.hp ?? maxHp;
        return `<div class="ex-crew-member">${legendPortrait(u)}<div><strong>${esc(u.name)}</strong>
          <small>${p.slot + 1}号位 · 压力 ${p.stress}</small>${bar(hp, maxHp, 'hp')}</div><span>${hp}<small>/${maxHp}</small></span></div>`;
      }).join('')}</div><div class="ex-pack">
        <h2>撤离可带回</h2><p>金币 <b>${r.goldFound}</b>　遗物 <b>${r.shards}</b>　纹路 <b>${r.bag.length}</b></p>
        <p>拓本匣 · <b>${r.fieldManuscript ? itemLabel('etching', D().manuscript(r.fieldManuscript)) : '空 0/1'}</b></p>
        <details class="k-carry"><summary>随行食材 · ${ingredientSummary(r.ingredients)}</summary>${ingredientRows(r.ingredients, false)}</details>
        ${bar(V.Expedition.bagUsed(state), V.Expedition.bagCapacity(state), 'energy')}
        <small>背包 ${V.Expedition.bagUsed(state)} / ${V.Expedition.bagCapacity(state)} 格 · 已完成 ${r.completedFloors} 层</small>
        ${r.completedFloors >= 3 ? `<small>蚀刻法 · ${esc(D().manuscriptReward(state, D().rewardTier(r.completedFloors)).name)}</small>` : ''}
        ${btn(r.completedFloors ? '带着收获撤离' : '返回前哨', 'extractNow', { cls: 'ghost' })}</div></aside></div></div>`;
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
    <div class="ex-page">${expeditionHeader(state, 'node.' + (bp.kind === 'normal' ? 'battle' : bp.kind), '遭遇整备', bp.units.map((u) => u.name).join(' · '))}
    <div class="ex-prep">
      ${panel('敌方情报', `<div class="enemy-list">${bp.units.map((u) => `<div class="enemy-row">
        ${u.isBoss ? V.Art.bossTag(u.enemyType, 'enemy-boss-img') : ''}
        <span class="enemy-name ${u.isBoss ? 'boss' : ''}">${esc(u.name)}</span>
        <span class="muted tiny">${u.hp} 生命 · ${u.atk} 攻击 · ${u.def} 防御 · ${u.spd} 速度</span>
        <span class="k-harvest-note">可取材 · ${itemLabel('ingredient', V.Kitchen.INGREDIENTS[V.Kitchen.ECOSYSTEM[u.enemyType].ingredient])} ×1</span>
        ${u.isBoss ? tag('首领', 'tag-boss') : ''}
      </div>`).join('')}</div>
      `)}

      ${panel('出战阵形', `

        <div class="vet-grid mt2">${prep.formation.map((uid, slot) => {
    const u = uid ? state.roster.find((x) => x.id === uid) : null;
    const partyEntry = u ? r.party.find((p) => p.uid === u.id) : null;
    const stStats = u ? V.Roster.stats(state, u) : null;
    const curHp = u && partyEntry ? (partyEntry.hp == null ? stStats.maxHp : partyEntry.hp) : 0;
    return `<div class="vet-slot ${u ? '' : 'empty'}">
      <div class="vet-slot-no">${slot + 1}号位</div>
      ${u ? legendPortrait(u, 'vet-slot-metal')
        + `<div class="vet-name">${esc(u.name)}</div>
           <div class="vet-weapon">${esc(manuscriptNames(u))}</div>
           <div class="tiny muted">${curHp}/${stStats.maxHp} · 压${partyEntry ? partyEntry.stress : 0}</div>
           ` : '<div class="vet-empty">空位</div>'}
      <div class="row tight mt2 slot-ops">
        ${slot > 0 ? btn('←', 'prepMove', { cls: 'ghost xs', data: { from: String(slot), to: String(slot - 1) } }) : ''}
        ${btn('换位', 'prepPick', { cls: 'ghost xs', data: { id: String(slot) } })}
        ${slot < 3 ? btn('→', 'prepMove', { cls: 'ghost xs', data: { from: String(slot), to: String(slot + 1) } }) : ''}
      </div>
    </div>`;
  }).join('')}</div>
        ${ui.prepSlot != null ? `<div class="picker mt2"><div class="muted small mb2">把 ${ui.prepSlot + 1} 号位换成</div>
          <div class="row wrap">${prep.formation.map((uid) => {
    if (!uid) return '';
    const u = state.roster.find((x) => x.id === uid);
    return btn(u.name, 'prepSwap', { cls: 'ghost xs', data: { a: String(ui.prepSlot), uid } });
  }).join('')}</div></div>` : ''}
        <details class="ex-rules"><summary>查看作战指令</summary>
        ${state.roster.filter((u) => prep.formation.includes(u.id)).map((u) => {
    const rules = (prep.rules[u.id] || u.gambits).filter((x) => x.enabled !== false);
    return `<div class="rule-line"><span class="muted tiny">${esc(u.name)}</span>
      <span class="tiny">${rules.length ? rules.map((x) => esc(ruleText(x))).join(' / ') : '（仅基础攻击）'}</span></div>`;
  }).join('')}</details>
        <div class="row wrap mt3">
          ${btn(attempt > 0 ? '开始（第 ' + (attempt + 1) + ' 次尝试）' : '开始战斗', 'startAttempt', { cls: 'gold' })}
          ${btn('编辑指令', 'editRules', { cls: 'ghost', data: { id: prep.formation.filter(Boolean)[0] } })}
        </div>
        <div class="row mt2">
          ${btn('紧急撤退', 'retreatEmergency', { cls: 'ghost danger sm' })}
        </div>
        ${attempt > 0 ? `<div class="muted tiny mt2">已经试过 ${attempt} 次。重试不消耗任何资源。</div>` : ''}
      `)}
    </div>
    ${retreatPreviewPanel(state, ui)}</div>`;
  }

  function retreatPreviewPanel(state, ui) {
    const p = V.Expedition.previewRetreat(state, 'emergency');
    if (!p.ok) return '';
    return `<details class="ex-retreat"><summary>紧急撤退预估</summary><p>带回 ${p.keepParts.length} 件纹路、${p.gold} 金币和 ${p.shards} 遗物。损失 ${p.lostParts.length} 件纹路，参战压力 +${p.stress}。</p>
      ${Object.keys(state.run.ingredients || {}).length ? `<p>保留食材 · ${ingredientSummary(p.ingredients)}</p>` : ''}</details>`;
  }

  /* ------------------------------ 战斗 ------------------------------ */

  function battleScreen(state, ui) {
    const b = state.run && state.run.battle;
    if (!b) return panel('战斗', '<p class="muted">没有战斗。</p>');
    return `
    <div class="ex-page ex-combat"><div class="battle-top ex-combat-top">
      <h1>${esc({ normal: '回廊交锋', elite: '精英遭遇', boss: '首领交锋' }[b.kind] || '回廊交锋')}</h1>
      <span class="bt-round">回合 ${b.round}</span>
      <span class="bt-tick muted tiny">${(b.tick * D().DESIGN.stepSeconds).toFixed(1)}s</span>
      <div class="spacer"></div>
      <button class="btn ghost xs" id="btlTactic" data-act="setTactic" title="均衡：按战前指令；集火：优先虚弱者；压制：优先蓄力敌人">战术：${({ balance: '均衡', focus: '集火', safe: '压制' })[b.tactic] || '均衡'}</button>
      <button class="btn ghost xs" id="btlSpeed" data-act="cycleSpeed">速度 ×${ui.speed || 1}</button>
      <button class="btn ghost xs" data-act="togglePause">${ui.paused ? '继续' : '暂停'}</button>
    </div>
    <div class="ex-battle-layout"><div class="ex-field"><div class="battle-stage"><canvas id="cv" width="960" height="300" aria-label="战场与双方行动"></canvas></div>
    <div class="battle-actions">
      ${b.over ? btn(b.win ? '结算战果' : '查看结果', 'reviewNow', { cls: 'gold', id: 'btlNext' })
    : '<span class="muted tiny" id="btlWait">交战中</span>'}
      ${btn('重新整备', 'rewind', { cls: 'ghost sm' })}
      ${btn('紧急撤退', 'retreatEmergency', { cls: 'ghost sm danger' })}
    </div></div>
    <aside class="ex-feed"><h2>战场记录</h2><div class="battle-log" id="battleLog">${(b.logs || []).slice(-14).map((l) => `<div class="lg ${logClass(l)}">${esc(l.text || '')}</div>`).join('')}</div></aside></div>
    <div class="battle-bars"><section><h2>我方阵线</h2><div class="side allies">${b.allies.slice().sort((a, c) => c.slot - a.slot).map(battleBar).join('')}</div></section>
      <section><h2>敌方阵线</h2><div class="side enemies">${b.enemies.map(battleBar).join('')}</div></section></div></div>`;
  }

  function logClass(l) {
    if (l.type === 'miss' || l.type === 'blocked') return 'dim';
    if (l.type === 'crit' || l.type === 'death' || l.type === 'defeat') return 'bad';
    if (l.type === 'heal' || l.type === 'shield' || l.type === 'victory') return 'good';
    if (['cast', 'surge', 'telegraph', 'phase'].includes(l.type)) return 'warn';
    return '';
  }

  function battleBar(u) {
    const isAlly = u.side === 'ally';
    const pressurePenalty = Math.round((1 - V.Combat.pressureRegenMultiplier(u.stress)) * 100);
    /* 时间轴：能量按秒回，出手靠 atkTimer，不再有「行动条」 */
    const energy = [Math.floor(u.energy || 0), Math.round(u.energyMax || 20)];
    const gPct = Math.max(0, Math.min(100, ((u.atkTimer || 0) / (u.attackInterval || 0.5)) * 100));
    const hasBurn = (u.buffs || []).some((x) => x.k === 'burn' || x.k === 'bleed');
    const hasGuard = (u.buffs || []).some((x) => x.k === 'guard' || x.k === 'dmgReduce');
    return `<div class="unit-bar ${u.alive === false ? 'dead' : ''} ${u.isBoss ? 'boss' : ''}">
      <div class="ub-top"><span class="ub-name">${esc(u.name)}</span>
        <span class="ub-slot">${u.slot + 1}号</span></div>
      ${bar(u.hp, u.maxHp, 'hp')}
      <div class="bar gauge"><i style="width:${gPct.toFixed(0)}%"></i></div>
      <div class="ub-meta">
        <span>${u.hp}/${u.maxHp}</span>
        ${u.shield > 0 ? `<span class="shield">盾${u.shield}</span>` : ''}
        ${isAlly ? `<span class="energy" title="${esc(terms.余裕)}">余裕 ${energy[0]}/${energy[1]}</span>` : ''}
        ${isAlly ? `<span class="${pressurePenalty ? 'tag tag-warn' : ''}" title="${esc(terms.压力)} · 每秒自然恢复${V.Combat.energyRegen(u).toFixed(2)}余裕">压力 ${u.stress || 0}${pressurePenalty ? ' · 回裕 −' + pressurePenalty + '%' : ''}</span>` : ''}
        ${u.skipActions > 0 ? tag('被压住', 'tag-warn') : ''}
        ${u.charging ? tag('蓄力 · ' + u.charging.name, 'tag-boss') : ''}
        ${hasBurn ? tag('灼烧', 'tag-warn') : ''}
        ${hasGuard ? tag('减伤', 'tag-circuit') : ''}
        ${u.refract > 0 ? tag('残影', 'tag-circuit') : ''}
      </div>
      ${isAlly ? `<div class="live-technique"><b>${esc(u.casting && u.pendingSkill ? u.pendingSkill.name : ([u.ms, ...(u.extraMs || [])].filter((m) => m?.spec).map((m) => m.spec.name).join('、') || '基础平攻'))}</b><span>${u.casting ? '引导 ' + Math.max(0, u.castTimer).toFixed(1) + 's' : (u.skillList || []).length ? '蓄势 ' + Math.floor(u.energy || 0) : '持续平攻'}</span></div>` : ''}

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
    <div class="ex-page">${expeditionHeader(state, rep.kind === 'boss' ? 'scene.boss' : 'scene.corridor', win ? '战斗胜利' : p.outcome === 'timeout' ? '回廊闭合' : '小队败退', rep.allies?.filter(u => u.alive).length + ' 人仍可作战')}
    ${panel(win ? '可领取战利品' : '战后决定', `
      <div class="row wrap mb3">
        <span class="chip">${((rep.tick || 0) * D().DESIGN.stepSeconds).toFixed(1)}s</span><span class="chip">回合 ${rep.round || 0}</span>
        <span class="chip">造成 ${Math.round((rep.stats && rep.stats.damage) || 0)}</span>
        <span class="chip">承受 ${Math.round((rep.stats && rep.stats.taken) || 0)}</span>
        <span class="chip">治疗 ${Math.round((rep.stats && rep.stats.healing) || 0)}</span>
      </div>

      ${win ? `<div class="ex-reward-line">金币 <b>+${p.rewardSpec.gold}</b>　遗物 <b>+${p.rewardSpec.shards}</b>　纹路 <b>×${p.rewardSpec.drops.length}</b></div>`
    : `<div class="mt3 small danger">败退会失去本局所有新收获；带入的蚀刻法与回路保留，压力 +${D().DESIGN.defeat.stress}。</div>`}
      <div class="row mt3">
        ${win ? btn('确认结果', 'confirmResult', { cls: 'gold' }) : ''}
        ${btn('重新整备', 'rewind', { cls: 'ghost' })}
        ${win ? btn('紧急撤退', 'retreatEmergency', { cls: 'ghost danger sm' }) : btn('确认败退', 'retreatDefeat', { cls: 'gold danger' })}
      </div>
    `)}
    <h2>小队战绩</h2>${contributionGrid(rep)}
    <details class="combat-journal"><summary>战斗记录</summary><div class="battle-log">${(rep.logs || []).map((l) => `<div class="lg ${logClass(l)}">${esc(l.text || '')}</div>`).join('')}</div></details></div>`;
  }

  /* ------------------------------ 掉落 ------------------------------ */

  function expeditionPart(state, id, action) {
    const it = state.itemsById[id];
    if (!it) return '';
    const t = D().template(it.templateId);
    return `<article class="ex-part"><div class="ex-specimen">${miniShapeSvg(t.id, 0, false)}</div><div class="ex-part-info">
      <small>占用 ${t.cells.length} 格 · 负荷 ${t.load}</small><h3>${itemLabel('rune', t)}</h3>
      <p>${esc(t.desc.replace(/^\d+ 负荷。/, ''))}</p>${action}</div></article>`;
  }

  const groundColumns = 6;

  function groundFootprint(cells, at) {
    if (!Number.isSafeInteger(at) || at < 0 || cells.some(([x]) => at % groundColumns + x >= groundColumns)) return [];
    return cells.map(([x,y]) => at + x + y * groundColumns);
  }

  function groundItems(state, ui) {
    const r = state.run;
    const node = JSON.stringify([r.id, r.floor, r.activeNodeId || r.lockedNodeId]);
    if (ui.groundSurvey?.node !== node) {
      ui.groundSurvey = { node, finds: new Map() };
    }
    const survey = ui.groundSurvey;
    const parts = r.pendingLoot.map(id => ({
      token: 'part:' + id, id, kind: 'rune', spec: D().template(state.itemsById[id].templateId),
      action: 'lootTake', count: 1,
    }));
    const foods = Object.entries(r.ingredientLoot || {}).filter(([, n]) => n > 0).map(([id, count]) => ({
      token: 'food:' + id, id, kind: 'ingredient', spec: V.Kitchen.INGREDIENTS[id], action: 'takeIngredient', count,
    }));
    const meals = Object.entries(r.mealLoot || {}).filter(([, n]) => n > 0).map(([id, count]) => ({
      token: 'meal:' + id, id, kind: 'recipe', spec: V.Kitchen.RECIPES[id], action: 'takeMeal', count,
    }));
    const items = parts.concat(foods, meals);
    const active = new Set(items.map(it => it.token));
    for (const key of survey.finds.keys()) if (!active.has(key)) survey.finds.delete(key);
    const occupied = survey.occupied = new Map();
    const now = performance.now();
    let scanAt = Math.max(now, ...items.map(it => survey.finds.get(it.token)?.end || 0));
    function place(it, at) {
      const indices = groundFootprint(it.cells, at);
      if (!indices.length || indices.some(i => occupied.has(i))) return false;
      indices.forEach(i => occupied.set(i, it.token));
      Object.assign(it.found, {at, x:at % groundColumns, y:Math.floor(at / groundColumns)});
      return true;
    }
    for (const it of items) {
      let found = survey.finds.get(it.token);
      if (!found) {
        found = r.groundKnown?.[it.token] ? {start:0,end:0} : {start:scanAt,end:scanAt + 340};
        scanAt = Math.max(scanAt, found.end);
        survey.finds.set(it.token, found);
      }
      const turn = V.Expedition.itemTurn(state,it.token,true);
      Object.assign(it, { turn, cells:V.Expedition.packShape(state, it.token,turn), found, fits:V.Expedition.canPack(state, it.token) });
      const saved = r.groundPositions?.[it.token];
      it.placed = Number.isSafeInteger(saved) && saved < 12000 && place(it, saved);
    }
    for (const it of items.filter(it => !it.placed)) it.placed = place(it, it.found.at);
    for (const it of items.filter(it => !it.placed)) {
      let at = 0;
      while (!place(it, at)) at++;
    }
    survey.rows = Math.max(8, Math.floor(Math.max(-1,...occupied.keys()) / groundColumns) + 1 + 5);
    return items;
  }

  function previewGroundDrop(state, ui, token, to, fromGround = false, turn = V.Expedition.itemTurn(state,token,fromGround)) {
    const base = token.split('#')[0], survey = ui.groundSurvey;
    const indices = groundFootprint(V.Expedition.packShape(state, base,turn), to);
    const ok = !!indices.length && indices.every(i => i < survey.rows * groundColumns &&
      (!survey.occupied.has(i) || survey.occupied.get(i) === base));
    return {ok, indices, at:to, reason:ok ? '' : '这里放不下整件物品'};
  }

  function firstGroundSpace(state, ui, token) {
    const existing = ui.groundSurvey.finds.get(token.split('#')[0]);
    if (existing && previewGroundDrop(state,ui,token,existing.at).ok) return existing.at;
    for (let at = 0; at < ui.groundSurvey.rows * groundColumns; at++) {
      if (previewGroundDrop(state, ui, token, at).ok) return at;
    }
    return -1;
  }

  function saveGroundPlacement(state, ui, token, at) {
    const base = token.split('#')[0], r = state.run;
    r.groundPositions = Object.fromEntries(Array.from(ui.groundSurvey.finds, ([key, f]) => [key,f.at]));
    r.groundPositions[base] = at;
    (r.groundKnown ||= {})[base] = true;
    ui.groundSurvey.finds.set(base, {at, start:0, end:0});
  }

  function groundPiece(it) {
    const { cells, found, token, id, kind, spec } = it;
    const occupied = new Set(cells.map(c => c.join(',')));
    const [ax, ay] = cells[0];
    const name = spec.name + (it.count > 1 ? ' ×' + it.count : '');
    const width = 1 + Math.max(...cells.map(c => c[0])), height = 1 + Math.max(...cells.map(c => c[1]));
    const clipId = 'ground-cut-' + kind + '-' + id;
    const mask = kind === 'ingredient' && width*height > cells.length
      ? `<svg width="0" height="0" aria-hidden="true"><defs><clipPath id="${clipId}" clipPathUnits="objectBoundingBox">${cells.map(([x,y]) => `<rect x="${x/width}" y="${y/height}" width="${1/width}" height="${1/height}"/>`).join('')}</clipPath></defs></svg>` : '';
    const art = kind === 'rune' ? V.RuneArt.thumb(spec.id,null,it.turn) : V.CatalogueArt.icon(kind,spec.id);
    const pieces = cells.map(([x,y]) => {
      const edge = [[x,y-1],[x+1,y],[x,y+1],[x-1,y]].map(c => occupied.has(c.join(',')) ? '0' : '1px').join(' ');
      return `<span class="ground-cell" aria-hidden="true" style="left:${100*(x-ax)}%;top:${100*(y-ay)}%;border-width:${edge}"></span>`;
    }).join('');
    return `<button type="button" class="ground-item" data-ground-item data-scan="waiting" data-token="${esc(token)}" data-act="${it.action}" data-id="${esc(id)}"
      data-turn="${it.turn}" data-ground-x="${found.x}" data-ground-y="${found.y}" data-fits="${it.fits}" data-label="${esc(name)}" style="--item-turn:${it.turn*90}deg;grid-column:${found.x+ax+1};grid-row:${found.y+ay+1}" aria-label="未辨认轮廓" disabled>
      ${pieces}${mask}<span class="ground-face" style="left:${-ax*100}%;top:${-ay*100}%;width:${width*100}%;height:${height*100}%;${mask ? `clip-path:url(#${clipId})` : ''}">${art}</span>
      ${it.count > 1 ? `<small class="ground-quantity">×${it.count}</small>` : ''}</button>`;
  }

  function groundNote(it) {
    const name = it.spec.name + (it.count > 1 ? ' ×' + it.count : '');
    const pick = it.kind === 'rune' ? '拾取' : '拾取一份';
    return `<div class="ground-note ${it.kind === 'ingredient' ? 'k-stock-row' : ''}" data-ground-note="${esc(it.token)}" data-scan="waiting">
      <span class="ground-unseen">未辨认轮廓</span><div class="ground-known" aria-hidden="true">
        <button type="button" class="ground-name" data-act="groundPick" data-token="${esc(it.token)}" data-fits="${it.fits}" disabled>
          ${V.CatalogueArt?.icon(it.kind,it.spec.id) || ''}<span>${esc(name)}<small>${it.cells.length} 格 · ${it.fits ? pick : '背包放不下'}</small></span></button>
        ${it.cells.length > 1 ? btn('旋转 ↻','groundRotate',{cls:'ghost xs',data:{token:it.token},disabled:true}) : ''}
        ${it.action === 'lootTake' ? btn('放弃','lootDiscard',{cls:'ghost xs',data:{id:it.id},disabled:true}) : ''}
        </div></div>`;
  }

  function lootScreen(state, ui) {
    const r = state.run;
    const chest = r.nodes.some(n => n.id === r.activeNodeId && n.type === 'chest');
    const items = groundItems(state, ui);
    const rows = ui.groundSurvey.rows;
    const slots = Array.from({length:rows * groundColumns}, (_,i) => `<span class="ground-slot" data-ground-slot="${i}" aria-hidden="true" style="grid-column:${i%groundColumns+1};grid-row:${Math.floor(i/groundColumns)+1}"></span>`).join('');
    return `<div class="ex-page loot-page"><div class="loot-columns">
      ${packDialog(state, ui, true)}
      <section class="loot-ground" aria-labelledby="loot-heading"><header class="pack-heading"><h2 id="loot-heading">${chest ? '封存宝箱' : '战利品'}</h2><small>${D().chapterLabel(r.floor)}</small></header>
      <div class="ground-grid" role="group" aria-label="地面战利品，六列" data-ground-columns="${groundColumns}" style="--ground-rows:${rows}">${slots}${items.map(groundPiece).join('')}</div>
      <div class="ground-register">${items.map(groundNote).join('')}</div>
      ${!items.length ? '<p class="muted ground-empty">此处已搜空</p>' : ''}
      <footer class="loot-exit"><small>随身金币 ${r.goldFound} · 遗物 ${r.shards}</small>${btn('紧急撤退','retreatEmergency',{cls:'ghost danger sm'})}
      ${btn(items.length ? '留下余物并离开' : '继续前进','finishNode',{cls:'gold'})}</footer></section></div></div>`;
  }

  /* ------------------------------ 事件 / 营火 / 商人 / 祝福 ------------------------------ */

  /** 事件选项的收益标签：只写玩家会算的那几项，赌局单独标。 */
  function effectTags(eff) {
    const tags = [];
    if (!eff) return tags;
    if (eff.gold) tags.push(`${eff.gold > 0 ? '+' : ''}${eff.gold} 金币`);
    if (eff.shards) tags.push(`${eff.shards > 0 ? '+' : ''}${eff.shards} 遗物`);
    if (eff.loot) tags.push(`纹路 ×${eff.loot}`);
    if (eff.ingredient) tags.push(`食材 ×${eff.ingredient.n || 1}`);
    if (eff.consumeIngredient) tags.push(`耗食材 ${eff.consumeIngredient}`);
    if (eff.meal) tags.push(`成菜 ×${eff.meal}`);
    if (eff.manuscript) tags.push('战利谱');
    if (eff.blessing) tags.push('祝福');
    if (eff.healPct) tags.push(`回血 ${Math.round(eff.healPct * 100)}%`);
    if (eff.damagePct) tags.push(`有人受伤 ${Math.round(eff.damagePct * 100)}%`);
    if (eff.hurtPct) tags.push(`全队受伤 ${Math.round(eff.hurtPct * 100)}%`);
    if (eff.maxHpPct) tags.push(`生命上限 ${Math.round(eff.maxHpPct * 100)}%`);
    if (eff.stress) tags.push(`压力 ${eff.stress > 0 ? '+' : ''}${eff.stress}`);
    return tags;
  }

  function eventScreen(state, ui) {
    const ev = D().event(state.run.event.eventId);
    const resolved = state.run.event.resolved;
    const branch = state.run.event.branch;
    if (resolved) {
      return `<div class="ex-page ex-event">${expeditionHeader(state, 'node.event', ev.title, ev.text)}
        <div class="story mt2 success">${esc(state.run.event.resultText)}</div>
        ${branch ? `<div class="muted tiny mt2">${branch === 'win' ? '这一次赌赢了。' : '这一次没赌赢。'}</div>` : ''}
        <div class="row mt3">${btn('继续', 'eventDone', { cls: 'gold' })}</div>
      </div>`;
    }
    const choices = V.Expedition.eventChoices(state);
    return `<div class="ex-page ex-event">${expeditionHeader(state, 'node.event', ev.title, ev.text)}
      <div class="mt3">${choices.map((c) => {
    const tags = effectTags(c.effects);
    const tagLine = `${c.combat ? '战斗' : ''}${c.gamble ? '赌局' : ''}${tags.join(' · ')}`;
    return `<button class="choice" data-act="chooseEvent" data-id="${c.id}" ${c.ok ? '' : 'disabled aria-disabled="true"'}>
          ${esc(c.label)}<span class="hint">${esc(c.hint || '')}</span>
          ${tagLine ? `<span class="hint">${esc(tagLine)}</span>` : ''}
          ${c.ok ? '' : `<span class="hint">${esc(c.reason)}</span>`}
        </button>`;
  }).join('')}</div>
    </div>`;
  }

  function campNodeScreen(state, ui) {
    const r = state.run;
    return `<div class="ex-page">${expeditionHeader(state, 'veteran.scene.field', '废弃营火', '火还有余温。铁在这里会变软一点。')}
    ${panel('火边休整', `
      <div class="row wrap mt3">
        ${btn(r.campRested ? '已休整' : '休息（恢复 45% 生命，压力 -30）', 'campRest', { cls: 'gold', disabled: !!r.campRested })}
        ${btn('继续前进', 'finishNode', { cls: 'ghost' })}
      </div>
    `)}${kitchenScreen(state, ui)}<details class="field-inscription"><summary>营火烙印</summary>
      <div class="mt4">
        <p class="muted small">把本趟拾取的纹路装上生命金属，接下来的战斗即可使用。每人每趟一次，生命上限本趟降低 20%，压力 +40。未留痕的落点会留下一道瘢痕。</p>
        <div class="row wrap">${r.party.map((p) => {
    const u = state.roster.find((x) => x.id === p.uid);
    const gate = V.Expedition.inscribable(state, u.id);
    return `<div class="inscribe-card">
      <div class="vet-name">${esc(u.name)}</div>
      <div class="muted tiny">${gate.ok ? '可以烙印' : esc(gate.reason)}</div>
      ${btn('选纹路并烙印', 'inscribeStart', { cls: 'ghost xs', data: { id: u.id }, disabled: !gate.ok })}
    </div>`;
  }).join('')}</div>
      </div>
    </details></div>`;
  }

  function merchantScreen(state) {
    const r = state.run;
    const free = V.Expedition.bagCapacity(state) - V.Expedition.bagUsed(state);
    return `<div class="ex-page">${expeditionHeader(state, 'node.merchant', '回廊游商', '可用金币 ' + state.gold + ' · 背包空余 ' + free + ' 格')}
      <div class="ex-offers">${(r.shop || []).map((o) => {
        const it = state.itemsById[o.itemId];
        if (!it) return '';
        const tooLarge = !o.sold && !V.Expedition.canPack(state, 'part:' + o.itemId);
        const label = o.sold ? '已售' : tooLarge ? '空间不足' : '购买 · ' + o.price + ' 金币';
        return expeditionPart(state, o.itemId, btn(label, 'buyOffer', { cls: 'gold', data: { id: o.id },
          disabled: o.sold || tooLarge || state.gold < o.price }));
      }).join('')}</div>${btn('离开摊位', 'finishNode', { cls: 'ghost' })}</div>`;
  }

  function blessingScreen(state) {
    const r = state.run;
    const opts = r.blessingOptions || D().BLESSING_ORDER.slice(0, 3);
    return `<div class="ex-page">${expeditionHeader(state, 'node.camp', '回廊祝福', '选择一种力量，持续至本次远征结束。')}
      <div class="grid-3 mt3">${opts.map((id) => {
    const b = D().blessing(id);
    return `<button class="blessing-card" data-act="chooseBlessing" data-id="${id}">
      <div class="bl-name">${esc(b.name)}</div>
      <div class="muted tiny">${esc(b.desc)}</div>
    </button>`;
  }).join('')}</div>
      ${btn('带着收获撤离','extractNow',{cls:'ghost'})}
    </div>`;
  }

  function settlementScreen(state) {
    const s = state.settlement;
    if (!s) return panel('结算', '<p class="muted">没有结算。</p>');
    return `<div class="ex-page">${expeditionHeader(state, 'scene.camp', s.title, s.reason)}
    ${panel('回营清点', `
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
        <span class="chip">纹路 +${s.items.length}</span>
      </div>
      ${s.fieldManuscript ? `<div class="manuscript-found"><h2>拓本入库 · ${itemLabel('etching', D().manuscript(s.fieldManuscript))}</h2>${manuscriptDetails(D().manuscript(s.fieldManuscript))}</div>` : ''}
      <div class="k-pantry-door"><div><h3>入库食材</h3><p>${ingredientSummary(s.ingredients)}</p></div></div>
      ${s.manuscript ? `<div class="manuscript-found"><h2>撤离奖励 · ${itemLabel('etching', s.manuscript)}</h2>${manuscriptDetails(D().manuscript(s.manuscript.id))}</div>` : ''}
      ${s.items.length ? `<div class="part-list mt2">${s.items.map((id) => `<div class="part-item static">
        <span class="part-name">${itemLabel('rune', D().template(state.itemsById[id].templateId))}</span><span class="part-meta">${esc(partMeta(state, id))}</span></div>`).join('')}</div>` : ''}
      <div class="row mt3">${btn('回营地', 'settleClose', { cls: 'gold' })}</div>
    `)}</div>`;
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
      case 'stash': return stashScreen(state, ui);
      case 'kitchen': return kitchenScreen(state, ui);
      case 'history': return historyScreen(state, ui);
      case 'map': return mapScreen(state, ui);
      case 'prebattle': return prebattleScreen(state, ui);
      case 'battle': return battleScreen(state, ui);
      case 'review': return reviewScreen(state, ui);
      case 'loot': return lootScreen(state, ui);
      case 'event': return eventScreen(state, ui);
      case 'campNode': return campNodeScreen(state, ui);
      case 'merchant': return merchantScreen(state);
      case 'blessing': return blessingScreen(state);
      case 'settlement': return settlementScreen(state);
      default: return panel('未知界面', '<p class="muted">回到营地。</p>');
    }
  }

  function packEditable(state, ui) {
    return !state.run || ['map', 'loot', 'camp', 'merchant'].includes(state.run.stage)
      && !['rules', 'workshop'].includes(ui.screen);
  }

  function packItem(state, token) {
    const id = token.slice(token.indexOf(':') + 1).split('#')[0];
    const food = token.startsWith('food:');
    const meal = token.startsWith('meal:');
    const spec = meal ? V.Kitchen.RECIPES[id] : food ? V.Kitchen.INGREDIENTS[id] : D().template(state.itemsById[id].templateId);
    return { id, food, meal, spec, kind: meal ? 'recipe' : food ? 'ingredient' : 'rune' };
  }

  function packDiners(state, meal) {
    const field = !!state.run;
    const team = field ? state.run.party : state.roster.map(u => ({uid:u.id}));
    return `<section class="pack-diners" aria-label="用餐队员"><h3>分餐</h3><p>${meal ? '点选一人用餐' : '把菜品拖给队员，或先点菜再点人。'}</p><div>${team.map(p => {
      const u = ST().unitById(state, p.uid);
      const max = V.Roster.stats(state, u).maxHp;
      const hp = field ? p.hp : u.hp;
      const ready = !!meal && V.Kitchen.canEat(state, meal.id, p.uid);
      return `<button type="button" data-act="packEat" data-id="${esc(u.id)}" aria-disabled="${!ready}" class="pack-diner ${ready ? 'ready' : ''}">
        ${legendPortrait(u,'pack-diner-face')}<span><b>${esc(u.name)}</b><small>${field || hp != null ? `生命 ${hp ?? max}/${max} · ` : ''}压力 ${field ? p.stress : u.stress}</small></span></button>`;
    }).join('')}</div></section>`;
  }

  function packDialog(state, ui, inline = false) {
    const r = state.run;
    const slots = V.Expedition.packSlots(state);
    const free = slots.filter(t => !t).length;
    const editable = packEditable(state, ui);
    const picked = slots[ui.packSelection];
    const item = picked && packItem(state, picked);
    const drawing = (kind, id) => V.CatalogueArt?.icon(kind, id) || '';
    const footprints = new Map();
    slots.forEach((token, index) => {
      if (!token) return;
      if (!footprints.has(token)) footprints.set(token, []);
      footprints.get(token).push(index);
    });
    const boxes = slots.map((token, i) => {
      const tag = token && packItem(state, token);
      const label = tag ? tag.spec.name : '空格';
      const position = `grid-column:${i % 6 + 1};grid-row:${Math.floor(i / 6) + 1}`;
      const selected = !!token && token === picked;
      const count = (tag?.food || tag?.meal) && i === footprints.get(token).at(-1) ? V.Expedition.stackCount(state, token) : 0;
      return `<button type="button" style="${position}" class="pack-slot ${selected ? 'related' : ''} ${selected && i === ui.packSelection ? 'selected' : ''}"
        data-act="packSlot" data-id="${i}" data-pack-slot="${i}" data-token="${esc(token || '')}" data-kind="${tag?.kind || ''}"
        draggable="${!!(editable && token)}" aria-label="${esc('第 ' + (i + 1) + ' 格 · ' + label)}" title="${esc(label)}" aria-pressed="${selected}" ${!editable && !token ? 'disabled' : ''}>
        ${count ? `<small>×${count}</small>` : ''}</button>`;
    }).join('');
    const artwork = Array.from(footprints, ([token, indices]) => {
      const tag = packItem(state, token);
      const turn = V.Expedition.itemTurn(state,token);
      const art = tag.food || tag.meal ? drawing(tag.kind,tag.id) : V.RuneArt.thumb(tag.spec.id,null,turn);
      return footprintArt(tag,token,indices,token === picked,turn,art,'pack');
    }).join('');
    const details = item ? `<div class="pack-inspect-art">${item.food || item.meal ? drawing(item.kind,item.spec.id) : miniShapeSvg(item.spec.id, 0, false)}</div>
      <small>${item.meal ? `菜品 · 每盒最多 ${V.Expedition.mealPack(item.id).limit} 份` : item.food ? `食材 · 占 ${V.Expedition.foodPack(item.id).cells.length} 格 · 每堆最多 ${V.Expedition.foodPack(item.id).limit} 份` : `纹路 · 占 ${item.spec.cells.length} 格 · 负荷 ${item.spec.load}`}</small>
      <h3>${esc(item.spec.name)}</h3><p>${item.meal ? `${r && item.spec.heal ? '生命 +' + Math.round(item.spec.heal*100) + '% · ' : ''}压力 −${item.spec.calm}` : esc(item.spec.desc)}</p>
      ${item.food || item.meal ? `<span class="pack-quantity">此堆 ${V.Expedition.stackCount(state,picked)} 份 · 共 ${item.meal ? (r ? r.meals : state.packedMeals)[item.id] : r?.ingredients?.[item.id] || 0} 份</span>` : ''}
      ${editable && V.Expedition.packShape(state,picked).length > 1 ? btn('旋转 ↻','packRotate',{cls:'ghost sm',data:{token:picked}}) : ''}
      ${editable && ui.screen === 'loot' ? btn('放到地上','packToGround',{cls:'ghost sm',data:{token:picked,id:picked}}) :
        editable ? btn(item.meal || item.food ? '丢弃一份' : '丢弃整件', 'packDiscard', {cls:'ghost danger sm'}) : ''}`
      : `<p>${editable && ui.screen === 'loot' ? '拖动物品，按 R 旋转。' : editable ? '点选物品查看，再点目标格换位。' : '点选物品查看详情。'}</p>`;
    const overflow = V.Expedition.packOverflow(state);
    const overflowPanel = overflow.length ? `<section class="pack-reserve"><h3>待整理物品</h3>${overflow.map(token => {
      const entry = packItem(state,token);
      const onGround = editable && ui.screen === 'loot';
      return `<div ${onGround ? `data-pack-overflow data-token="${esc(token)}" draggable="true"` : ''}>${itemLabel(entry.kind,entry.spec)}${entry.food || entry.meal ? ' ×' + V.Expedition.stackCount(state,token) : ''} ${onGround ? btn('放到地上','packToGround',{cls:'ghost sm',data:{token,id:token}}) :
        editable ? btn(entry.meal || entry.food ? '丢弃一份' : '丢弃整件','packDiscardOverflow',{cls:'ghost sm',data:{id:token}}) : ''}</div>`;
    }).join('')}</section>` : '';
    const inventory = `<header class="pack-heading"><div><h2 id="pack-title">${r ? '远征背包' : '前哨背包'}</h2><small>${editable ? '可整理' : '当前仅可查看'}</small></div>
        <b class="pack-count">${slots.length - free}<span> / ${slots.length} 格</span></b>${inline ? '' : btn('关闭','closeModal',{cls:'ghost sm'})}</header>
      <div class="pack-layout"><div><div class="pack-grid" role="group" aria-label="背包格位">${boxes}${artwork}</div>
        <div class="pack-tools"><span>空余 ${free} 格</span>${editable ? btn('一键整理','packSort',{cls:'ghost sm',disabled:free === slots.length}) : ''}</div></div>
        <aside class="pack-detail" aria-live="polite">${details}${ui.packMessage ? `<p class="pack-message">${esc(ui.packMessage)}</p>` : ''}</aside></div>
      ${editable && slots.some(t=>t?.startsWith('meal:')) ? packDiners(state, item?.meal ? item : null) : ''}
      ${overflowPanel}${r ? `<div class="pack-folio"><strong>拓本匣</strong>${r.fieldManuscript ? itemLabel('etching', D().manuscript(r.fieldManuscript)) : '<span>空</span>'}<small>独立收纳</small></div>` : ''}`;
    if (inline) return `<section class="loot-pack" aria-labelledby="pack-title">${inventory}</section>`;
    return `<div class="modal-backdrop"><div class="modal-dim" data-act="closeModal"></div>
      <section class="modal-card pack-dialog" role="dialog" aria-modal="true" aria-labelledby="pack-title" data-editable="${editable}">
      ${inventory}
      </section></div>`;
  }

  function modalHtml(state, ui) {
    if (!ui.modal) return '';
    if (ui.modal === 'pack') return packDialog(state, ui);
    const s = state.settings || { sound: true, speed: 1, reducedMotion: false };
    if (ui.modal === 'settings') {
      return `<div class="modal-backdrop">
        <div class="modal-dim" data-act="closeModal"></div>
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="设置与存档">
          <div class="row mb2">
            <h2 class="panel-h" style="margin:0;border:none;padding:0">设置与存档</h2>
            <div class="spacer"></div>
            ${btn('✕', 'closeModal', { cls: 'ghost xs' })}
          </div>
          <details class="term-guide"><summary>玩法词条</summary><dl>${Object.entries(terms).map(([name,text]) => `<dt>${name}</dt><dd>${text}</dd>`).join('')}</dl></details>
          <div class="setting-list">
            <div class="setting-row">
              <div>游戏音效</div>
              ${btn(s.sound !== false ? '已开启' : '已静音', 'toggleSound', { cls: s.sound !== false ? 'gold xs' : 'ghost xs' })}
            </div>
            <div class="setting-row">
              <div>战斗速度</div>
              <div class="row tight">${[1, 2, 3].map((sp) => btn(`×${sp}`, 'setDefaultSpeed', { cls: (s.speed || 1) === sp ? 'gold xs' : 'ghost xs', data: { id: String(sp) } })).join('')}</div>
            </div>
            <div class="setting-row">
              <div>减弱动效</div>
              ${btn(s.reducedMotion ? '已开启' : '关闭', 'toggleMotion', { cls: s.reducedMotion ? 'gold xs' : 'ghost xs' })}
            </div>
          </div>
          <details class="save-tools mt3 pt2 border-top"><summary>存档管理</summary>
            <div class="row wrap tight mt2">
              ${btn('生成导出文本', 'modalExport', { cls: 'ghost sm' })}
              ${btn('复制导出文本', 'copySaveText', { cls: 'ghost sm' })}
              ${ui.hadSave ? btn('抹去存档…', 'resetSave', { cls: 'ghost sm danger' }) : ''}
            </div>
            <textarea id="modalSaveBox" class="mt2" rows="3" aria-label="存档文本" placeholder="粘贴存档文本">${esc(ui.modalSaveText || '')}</textarea>
            <div class="row mt2">
              ${btn('导入此存档', 'modalImportConfirm', { cls: 'gold sm' })}
            </div>
          </details>
        </div>
      </div>`;
    }
    if (ui.modal === 'confirmReset') {
      return `<div class="modal-backdrop">
        <div class="modal-dim" data-act="closeModal"></div>
        <div class="modal-card modal-sm" role="dialog" aria-modal="true" aria-label="抹去存档确认">
          <h2 class="panel-h danger">抹去全部进度？</h2>
          <p class="small muted">此操作会清空当前浏览器的全部远征、传奇与仓库记录，且无法撤回。</p>
          <div class="row mt3">
            <div class="spacer"></div>
            ${btn('取消', 'closeModal', { cls: 'ghost sm' })}
            ${btn('确认抹去', 'confirmResetSave', { cls: 'gold danger sm' })}
          </div>
        </div>
      </div>`;
    }
    return '';
  }

  function hud(state, ui) {
    if (ui.screen === 'title') return '';
    return `<button type="button" class="hud-brand" data-act="toTitle" aria-label="灰烬回廊，返回标题">灰烬回廊</button>
      <div class="hud-wallet"><span class="hud-item">金币 <b>${state.gold}</b></span>${state.shards ? `<span class="hud-item">遗物 <b>${state.shards}</b></span>` : ''}</div>
      ${!['settlement','loot'].includes(ui.screen) ? '<button class="btn ghost xs hud-pack" data-act="openPack" type="button" title="打开背包（B）" aria-keyshortcuts="B">背包 <kbd>B</kbd></button>' : ''}
      ${btn('设置', 'openSettings', { cls: 'ghost xs hud-settings' })}`;
  }

  const NAV = [
    ['camp', '前哨'], ['team', '编队'], ['workshop', '工坊'],
    ['recruit', '火塘'], ['stash', '仓库'], ['history', '战史'],
  ];

  function nav(state, ui) {
    if (['title'].includes(ui.screen) || state.run) return '';
    const showNav = ['camp', 'team', 'workshop', 'recruit', 'stash', 'history', 'rules', 'kitchen'].includes(ui.screen);
    if (!showNav) return '';
    return NAV.map(([v, n]) => `<button class="nav-btn ${ui.screen === v ? 'on' : ''}"
      data-act="go" data-v="${v}" ${ui.screen === v ? 'aria-current="page"' : ''} ${state.run ? 'disabled' : ''}>${n}</button>`).join('');
  }

  /** 拖拽幽灵用：某件纹路在给定旋转/翻转下的相对格、端口与配色（真实几何，不另写一套） */
  function partShape(state, itemId, rotation, mirrorY) {
    const L = V.Circuit.layout(state, [{ itemId, x: 0, y: 0, rotation: rotation || 0, mirrorY: !!mirrorY }]);
    const b = L.built && L.built[0];
    if (!b) return null;
    const xs = b.abs.map((c) => c.x);
    const ys = b.abs.map((c) => c.y);
    return {
      name: b.tpl.name,
      templateId: b.tpl.id,
      rot: rotation || 0,
      mir: !!mirrorY,
      cells: b.abs.map((c) => ({ x: c.x, y: c.y })),
      ports: b.aps.map((p) => ({ cell: p.cell.slice(), dir: p.dir, role: p.role })),
      minX: Math.min.apply(null, xs),
      minY: Math.min.apply(null, ys),
      maxX: Math.max.apply(null, xs),
      maxY: Math.max.apply(null, ys),
    };
  }

  V.UI = {
    screen, hud, nav, modalHtml, packEditable, previewGroundDrop, firstGroundSpace, saveGroundPlacement, boardSvg, miniShapeSvg, esc, btn, bar, legendPortrait,
    partName, partMeta, logClass, battleBar, ruleText, partShape, membraneEngraving, portCut,
    MANUSCRIPTS: WORKSHOP_MANUSCRIPTS, workshopUnit, resolveManuscript, plateCellsList,
  };
})(globalThis.Ashen ||= {});
