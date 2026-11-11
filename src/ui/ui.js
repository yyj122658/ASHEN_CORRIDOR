'use strict';
/* UI 组件与页面。只读 state，通过 data-act 上报意图，不直接改状态。 */
(function (A) {
  'use strict';

  const D = () => A.Data;
  const S = () => A.State;
  const E = () => A.Equipment;
  const esc = (s) => A.Art.safeText(s);

  /* ---------- SVG 图标 ---------- */
  const ICONS = {
    sword: '<path d="M4 20 L16 8 M14 4 L20 4 L20 10 L10 20 Z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    shield: '<path d="M12 3 L20 6 V12 C20 17 16 20 12 21 C8 20 4 17 4 12 V6 Z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    star: '<path d="M12 3 L14.5 9 L21 9.7 L16 14 L17.5 20.5 L12 17.2 L6.5 20.5 L8 14 L3 9.7 L9.5 9 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    chest: '<path d="M3 10 H21 V20 H3 Z M3 10 C3 6 6 4 12 4 C18 4 21 6 21 10 M12 10 V20" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    question: '<path d="M8 8 C8 5 10 4 12 4 C15 4 16 6 16 8 C16 11 12 11 12 14 M12 18 V19" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    campfire: '<path d="M12 20 C8 20 6 17 6 14 C6 11 9 10 9 7 C9 5 11 3 12 3 C13 3 15 5 15 7 C15 10 18 11 18 14 C18 17 16 20 12 20 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    scales: '<path d="M12 3 V21 M5 7 H19 M5 7 L2 14 H8 Z M19 7 L16 14 H22 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    skull: '<path d="M6 10 C6 6 9 4 12 4 C15 4 18 6 18 10 C18 13 17 14 16 15 V19 H8 V15 C7 14 6 13 6 10 Z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="9.5" cy="10" r="1.3" fill="currentColor"/><circle cx="14.5" cy="10" r="1.3" fill="currentColor"/>',
    coin: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7 V17 M9 9.5 H15 M9 14.5 H15" stroke="currentColor" stroke-width="1.4" fill="none"/>',
    shard: '<path d="M12 3 L18 10 L12 21 L6 10 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    lock: '<rect x="5" y="10" width="14" height="10" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 10 V7 A4 4 0 0 1 16 7 V10" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    arrowL: '<path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" stroke-width="2"/>',
    arrowR: '<path d="M9 5 L16 12 L9 19" fill="none" stroke="currentColor" stroke-width="2"/>',
    up: '<path d="M12 19 V5 M5 12 L12 5 L19 12" fill="none" stroke="currentColor" stroke-width="2"/>',
    down: '<path d="M12 5 V19 M5 12 L12 19 L19 12" fill="none" stroke="currentColor" stroke-width="2"/>',
    swap: '<path d="M4 8 H16 L13 5 M20 16 H8 L11 19" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  };

  function icon(name, size) {
    const body = ICONS[name];
    if (!body) return '';
    const s = size || 16;
    return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  }

  /* ---------- 基础组件 ---------- */

  function bar(cur, max, cls) {
    const p = max > 0 ? Math.max(0, Math.min(100, Math.round(cur / max * 100))) : 0;
    return `<div class="bar ${cls || ''}" role="progressbar" aria-valuenow="${cur}" aria-valuemax="${max}"><i style="width:${p}%"></i></div>`;
  }

  function btn(label, act, opts) {
    opts = opts || {};
    const cls = ['btn', opts.cls || ''].join(' ');
    const dis = opts.disabled ? 'disabled' : '';
    const aria = opts.aria ? `aria-label="${esc(opts.aria)}"` : '';
    const title = opts.title ? `title="${esc(opts.title)}"` : '';
    return `<button class="${cls}"${opts.elemId ? ` id="${opts.elemId}"` : ''} data-act="${act}"${opts.id ? ` data-id="${opts.id}"` : ''}${opts.k != null ? ` data-k="${opts.k}"` : ''}${opts.i != null ? ` data-i="${opts.i}"` : ''}${opts.v ? ` data-v="${opts.v}"` : ''} ${dis} ${aria} ${title}>${label}</button>`;
  }

  function chip(label, cls) {
    return `<span class="chip ${cls || ''}">${label}</span>`;
  }

  function qcls(q) { return 'q' + (q == null ? 1 : q); }

  /* ---------- 角色 ---------- */

  function portrait(unit, size, opts) {
    opts = opts || {};
    const cls = D().CLASSES[unit.cls];
    const artId = 'portrait.' + unit.cls;
    const img = A.Art.imgTag(artId, 'portrait-img', cls.name);
    const style = `--cls-color:${cls.color};--cls-accent:${cls.accent}`;
    return `<div class="portrait ${opts.cls || ''}" style="${style}">
      ${img || `<span class="portrait-mark">${esc(cls.name.slice(0, 1))}</span>`}
      <span class="portrait-el">${esc(D().ELEMENTS[cls.element].name)}</span>
    </div>`;
  }

  function unitCard(state, unit, opts) {
    opts = opts || {};
    const cls = D().CLASSES[unit.cls];
    const partyIds = state.team.filter(Boolean);
    const st = A.Roster.calcStats(state, unit.id, partyIds);
    const inTeam = state.team.includes(unit.id);
    const slot = state.team.indexOf(unit.id);
    const stressPct = unit.stress;

    return `<article class="card unit-card ${opts.cls || ''}" data-uid="${unit.id}">
      <div class="card-top">
        ${portrait(unit, 'sm')}
        <div class="card-id">
          <div class="card-name">${esc(unit.name)}</div>
          <div class="card-sub">${esc(cls.name)} · ${esc(cls.role)}${inTeam ? ` · 槽位 ${slot + 1}` : ''}</div>
          <div class="pips">${[1, 2, 3].map((i) => `<i class="${i <= unit.star ? 'on' : ''}"></i>`).join('')}</div>
        </div>
      </div>
      <div class="stat-grid">
        <div><span>生命</span><b>${st.maxHp}</b></div>
        <div><span>攻击</span><b>${st.atk}</b></div>
        <div><span>防御</span><b>${st.def}</b></div>
        <div><span>速度</span><b>${st.spd}</b></div>
        <div><span>暴击</span><b>${Math.round(st.crit * 100)}%</b></div>
        <div><span>闪避</span><b>${Math.round(st.eva * 100)}%</b></div>
      </div>
      <div class="stress-row">
        <span class="tiny">压力 ${stressPct}</span>
        ${bar(stressPct, 100, 'stress')}
      </div>
      ${unit.affliction ? `<div class="tiny bad">${esc((D().AFFLICTIONS.find((a) => a.k === unit.affliction) || {}).name || '')}</div>` : ''}
      ${unit.virtue ? `<div class="tiny good">${esc((D().VIRTUES.find((v) => v.k === unit.virtue) || {}).name || '')}</div>` : ''}
      ${opts.actions !== false ? `<div class="card-actions">
        ${inTeam
          ? btn('下场', 'teamRemove', { id: unit.id, cls: 'ghost sm' })
          : btn('上场', 'teamAdd', { id: unit.id, cls: 'gold sm', disabled: state.team.every(Boolean) })}
        ${btn('装备', 'gotoEquip', { id: unit.id, cls: 'ghost sm' })}
      </div>` : ''}
    </article>`;
  }

  /* ---------- 物品 ---------- */

  function itemLine(state, item, opts) {
    opts = opts || {};
    const name = E().itemDisplayName(item);
    const statStr = Object.entries(item.stats).map(([k, v]) => E().statLabel(k) + E().statText(k, v)).join('  ');
    const trait = item.traitId ? A.Data.TRAITS[item.traitId] : null;
    return `<div class="item ${opts.cls || ''}" data-act="selectItem" data-id="${item.id}" role="button" tabindex="0">
      <span class="item-q ${qcls(item.q)}">${esc(D().QUALITY[item.q].name)}</span>
      <span class="item-name ${qcls(item.q)}">${esc(name)}</span>
      <span class="item-meta">${esc(D().SLOT_NAME[item.slot])}</span>
      <span class="item-stats">${esc(statStr)}</span>
      ${trait ? `<span class="item-trait" style="color:${trait.color}" title="${esc(trait.desc)}">${esc(trait.name)}</span>` : ''}
      ${item.locked ? `<span class="item-lock">${icon('lock', 12)}</span>` : ''}
      ${opts.tail || ''}
    </div>`;
  }

  /* ---------- 页面：标题 ---------- */

  function titleScreen(state, ui) {
    const hasSave = !!ui.hadSave;
    return `<section class="screen title-screen">
      <div class="title-bg">${A.Art.imgTag('scene.camp', 'title-art', '灰烬回廊')}</div>
      <div class="title-veil"></div>
      <div class="title-inner">
        <div class="title-crest">${icon('shard', 22)}</div>
        <h1 class="title-main">灰烬回廊</h1>
        <p class="title-sub">A S H E N &nbsp; C O R R I D O R</p>
        <p class="title-quote">“它每天夜里都会重新长出墙。”</p>
        <div class="title-actions">
          ${btn(hasSave ? '继续远征' : '开始远征', 'titleStart', { cls: 'btn-lg gold' })}
          ${hasSave ? btn('新的远征（抹去存档）', 'reset', { cls: 'ghost sm' }) : ''}
        </div>
        <div class="title-meta">
          ${hasSave
            ? `最深 ${state.bestDepth} 层 · ${state.gold} 金币 · ${state.roster.length} 名拾荒者`
            : '像素 · 横版自动战斗 · 搜打撤 · 刷装 · 自走棋羁绊'}
        </div>
        <div class="title-tools">
          ${btn('设置', 'openSettings', { cls: 'ghost xs' })}
          ${btn('导入存档', 'importSave', { cls: 'ghost xs' })}
        </div>
      </div>
    </section>`;
  }

  /* ---------- 页面：营地 ---------- */

  function campScreen(state, ui) {
    const party = state.team.map((id) => state.roster.find((u) => u.id === id)).filter(Boolean);
    const syn = A.Roster.synergies(state, state.team.filter(Boolean));

    const banner = `<div class="camp-banner">
      ${A.Art.imgTag('scene.camp', 'camp-art', '余烬前哨')}
      <div class="camp-veil"></div>
      <div class="camp-banner-text">
        <h2>灰烬前哨</h2>
        <p>它每天夜里都会重新长出墙。进去的人搜刮、厮杀，然后做一个决定。</p>
        ${btn('进入回廊', 'startRun', { cls: 'btn-lg gold', disabled: party.length === 0 })}
      </div>
    </div>`;

    const cards = [0, 1, 2, 3].map((i) => {
      const u = party[i];
      if (!u) return `<div class="card slot-empty"><span>槽位 ${i + 1} 空</span><span class="tiny">${i < 2 ? '前排' : '后排'}</span></div>`;
      const st = A.Roster.calcStats(state, u.id, state.team.filter(Boolean));
      return `<article class="card slot-card" data-slot="${i}">
        <div class="slot-tag">${i < 2 ? '前排' : '后排'} · ${i + 1}</div>
        ${portrait(u, 'md')}
        <div class="card-name">${esc(u.name)}</div>
        <div class="card-sub">${esc(D().CLASSES[u.cls].name)} · ${u.star} 星</div>
        <div class="pips">${[1, 2, 3].map((k) => `<i class="${k <= u.star ? 'on' : ''}"></i>`).join('')}</div>
        <div class="mini-hp">
          <div class="tiny">${u.hp == null ? st.maxHp : u.hp} / ${st.maxHp}</div>
          ${bar(u.hp == null ? st.maxHp : u.hp, st.maxHp, 'hp')}
        </div>
        <div class="stress-row"><span class="tiny">压力 ${u.stress}</span>${bar(u.stress, 100, 'stress')}</div>
      </article>`;
    }).join('');

    return `<section class="screen camp-screen">
      ${banner}
      <div class="grid-4">${cards}</div>

      <div class="panel">
        <h3>羁绊</h3>
        <div class="syn-list">
          ${syn.length ? syn.map((s) => `<span class="syn ${s.active ? 'on' : ''}" title="${esc(s.desc)}">
            ${esc(s.name)} <b>${s.count}</b>${s.nextNeed ? `/${s.nextNeed}` : ''}
          </span>`).join('') : '<span class="tiny">队伍是空的。</span>'}
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <h3>出发准备</h3>
          <div class="diff-row">
            ${Object.values(D().DIFFICULTIES).map((d) => {
              const unlocked = state.unlockedDifficulties.includes(d.id);
              return `<button class="diff ${state.difficulty === d.id ? 'on' : ''}" data-act="setDifficulty" data-id="${d.id}"
                ${unlocked ? '' : 'disabled'} title="${esc(d.desc)}">
                <span>${esc(d.name)}</span>
                <span class="tiny">${unlocked ? 'HP×' + d.hpMult + ' 攻×' + d.atkMult : '未解锁'}</span>
              </button>`;
            }).join('')}
          </div>
          <p class="warn tiny">全灭会失去本次全部战利品，且每名参战角色随机丢一件已穿装备。</p>
        </div>

        <div class="panel">
          <h3>长期目标</h3>
          <ul class="goal-list">
            ${D().ACHIEVEMENTS.map((a) => `<li class="${state.achievements.includes(a.id) ? 'done' : ''}">
              <span>${state.achievements.includes(a.id) ? '✓' : '○'} ${esc(a.name)}</span>
              <span class="tiny">${esc(a.desc)}</span>
            </li>`).join('')}
          </ul>
          <div class="stat-row tiny">
            <span>远征 ${state.runs}</span><span>撤离 ${state.extracts}</span>
            <span>最深 ${state.bestDepth}</span><span>金币 ${state.gold}</span>
          </div>
        </div>
      </div>
    </section>`;
  }

  /* ---------- 页面：队伍 ---------- */

  function teamScreen(state, ui) {
    const slots = [0, 1, 2, 3].map((i) => {
      const id = state.team[i];
      const u = id ? state.roster.find((x) => x.id === id) : null;
      const rowLabel = i < 2 ? '前排' : '后排';
      if (!u) {
        return `<div class="card slot-empty tall">
          <div class="slot-tag">${rowLabel} · ${i + 1}</div>
          <span>空槽</span>
          <span class="tiny">从候补选择上场</span>
        </div>`;
      }
      const st = A.Roster.calcStats(state, u.id, state.team.filter(Boolean));
      return `<article class="card slot-card tall" data-uid="${u.id}">
        <div class="slot-tag">${rowLabel} · ${i + 1}</div>
        ${portrait(u, 'md')}
        <div class="card-name">${esc(u.name)}</div>
        <div class="card-sub">${esc(D().CLASSES[u.cls].name)} · ${u.star} 星</div>
        <div class="stat-grid compact">
          <div><span>生命</span><b>${st.maxHp}</b></div>
          <div><span>攻击</span><b>${st.atk}</b></div>
          <div><span>防御</span><b>${st.def}</b></div>
          <div><span>速度</span><b>${st.spd}</b></div>
        </div>
        <div class="move-row">
          ${i > 0 ? btn(icon('arrowL', 14), 'moveSlot', { id: u.id, k: i - 1, cls: 'ghost xs', aria: '前移' }) : ''}
          ${i < 3 ? btn(icon('arrowR', 14), 'moveSlot', { id: u.id, k: i + 1, cls: 'ghost xs', aria: '后移' }) : ''}
          ${btn(icon('swap', 14), 'swapRow', { id: u.id, cls: 'ghost xs', aria: '换排' })}
          ${btn('下场', 'teamRemove', { id: u.id, cls: 'ghost xs' })}
          ${btn('装备', 'gotoEquip', { id: u.id, cls: 'ghost xs' })}
        </div>
      </article>`;
    }).join('');

    const bench = state.roster.filter((u) => !state.team.includes(u.id));
    const syn = A.Roster.synergies(state, state.team.filter(Boolean));

    return `<section class="screen">
      <div class="panel">
        <h3>编队 <span class="tiny">0/1 前排，2/3 后排；空槽保留，后不前移</span></h3>
        <div class="grid-4">${slots}</div>
        <div class="syn-list" style="margin-top:12px">
          ${syn.map((s) => `<span class="syn ${s.active ? 'on' : ''}" title="${esc(s.desc)}">${esc(s.name)} <b>${s.count}</b>${s.nextNeed ? `/${s.nextNeed}` : ''}</span>`).join('')}
        </div>
      </div>

      <div class="panel">
        <h3>候补 <span class="tiny">${bench.length} 人</span></h3>
        <div class="grid-4">
          ${bench.length ? bench.map((u) => unitCard(state, u)).join('') : '<p class="tiny">候补席是空的。</p>'}
        </div>
      </div>
    </section>`;
  }

  /* ---------- 页面：招募 ---------- */

  function recruitScreen(state) {
    const cards = state.shop.map((offer, i) => {
      if (offer.sold) return `<div class="card slot-empty"><span>已招募</span></div>`;
      const u = offer.unit;
      const cls = D().CLASSES[u.cls];
      const st = A.Roster.calcStats(state, u.id, [u.id]);
      const cost = A.Roster.recruitCost(u);
      return `<article class="card recruit-card">
        ${portrait(u, 'md')}
        <div class="card-name">${esc(cls.name)}</div>
        <div class="card-sub">${esc(cls.role)} · ${esc(D().ELEMENTS[cls.element].name)}</div>
        <div class="pips">${[1, 2, 3].map((k) => `<i class="${k <= u.star ? 'on' : ''}"></i>`).join('')}</div>
        <div class="stat-grid compact">
          <div><span>生命</span><b>${st.maxHp}</b></div>
          <div><span>攻击</span><b>${st.atk}</b></div>
        </div>
        <div class="card-foot">${btn(`招募 · ${cost}`, 'recruit', { i, cls: 'gold', disabled: state.gold < cost })}</div>
      </article>`;
    }).join('');

    return `<section class="screen">
      <div class="panel">
        <h3>招募台 <span class="tiny">同名同星可合成升星</span></h3>
        <div class="row">
          <span class="tiny">金币 ${state.gold}</span>
          <div class="spacer"></div>
          ${btn('刷新 · 12 金', 'refreshShop', { cls: 'ghost sm', disabled: state.gold < 12 })}
        </div>
        <div class="grid-3" style="margin-top:12px">${cards}</div>
      </div>
    </section>`;
  }

  /* ---------- 页面：仓库 ---------- */

  function stashScreen(state, ui) {
    const f = ui.filter || {};
    const items = E().filter(state, f);
    const selected = ui.selectedItem ? state.itemsById[ui.selectedItem] : null;
    const cmpUnit = ui.compareUnit ? state.roster.find((u) => u.id === ui.compareUnit) : null;
    const cmp = selected && cmpUnit ? E().compare(state, cmpUnit.id, selected.id) : null;

    const rows = items.length ? items.map((it) => {
      const isSel = ui.selectedItem === it.id;
      return itemLine(state, it, {
        cls: isSel ? 'sel' : '',
        tail: `<div class="item-actions">
          ${cmpUnit ? btn('装备', 'equipItem', { id: it.id, cls: 'gold xs' }) : ''}
          ${btn(it.locked ? '解锁' : '锁定', 'toggleLock', { id: it.id, cls: 'ghost xs' })}
          ${btn('卖 ' + E().sellValue(it), 'sellOne', { id: it.id, cls: 'ghost xs', disabled: it.locked })}
        </div>`,
      });
    }).join('') : '<p class="tiny">没有符合条件的装备。</p>';

    return `<section class="screen">
      <div class="panel">
        <h3>仓库 <span class="tiny">${state.stash.length} 件 · ${state.gold} 金币</span></h3>
        <div class="filter-bar">
          <select data-act="filterSlot" aria-label="按部位筛选">
            ${['all', 'weapon', 'armor', 'trinket'].map((v) => `<option value="${v}" ${f.slot === v ? 'selected' : ''}>${v === 'all' ? '全部部位' : D().SLOT_NAME[v]}</option>`).join('')}
          </select>
          <select data-act="filterQuality" aria-label="按最低品质筛选">
            ${[0, 1, 2, 3, 4, 5].map((v) => `<option value="${v}" ${f.minQuality === v ? 'selected' : ''}>${v === 0 ? '全部品质' : D().QUALITY[v].name + '及以上'}</option>`).join('')}
          </select>
          <select data-act="filterLocked" aria-label="按锁定筛选">
            <option value="all" ${f.locked === 'all' ? 'selected' : ''}>全部</option>
            <option value="unlocked" ${f.locked === 'unlocked' ? 'selected' : ''}>未锁</option>
            <option value="locked" ${f.locked === 'locked' ? 'selected' : ''}>已锁</option>
          </select>
          <select data-act="filterSort" aria-label="排序">
            <option value="quality" ${f.sort === 'quality' ? 'selected' : ''}>按品质</option>
            <option value="power" ${f.sort === 'power' ? 'selected' : ''}>按战力</option>
            <option value="newest" ${f.sort === 'newest' ? 'selected' : ''}>按最新</option>
          </select>
          <div class="spacer"></div>
          ${btn('卖出当前筛选（未锁）', 'sellFiltered', { cls: 'ghost sm' })}
        </div>
        <div class="item-list">${rows}</div>
      </div>

      <div class="panel">
        <h3>对比 ${cmpUnit ? `<span class="tiny">对 ${esc(cmpUnit.name)}</span>` : '<span class="tiny">选一个角色做换装对比</span>'}</h3>
        <div class="row">
          <select data-act="compareUnit" aria-label="选择对比角色">
            <option value="">— 选择角色 —</option>
            ${state.roster.map((u) => `<option value="${u.id}" ${ui.compareUnit === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
          </select>
        </div>
        ${cmp ? `<div class="cmp">
          <div class="cmp-row"><span>攻击</span><b class="${cmp.delta.atk > 0 ? 'good' : cmp.delta.atk < 0 ? 'bad' : ''}">${cmp.delta.atk > 0 ? '+' : ''}${cmp.delta.atk}</b></div>
          <div class="cmp-row"><span>生命</span><b class="${cmp.delta.maxHp > 0 ? 'good' : cmp.delta.maxHp < 0 ? 'bad' : ''}">${cmp.delta.maxHp > 0 ? '+' : ''}${cmp.delta.maxHp}</b></div>
          <div class="cmp-row"><span>防御</span><b class="${cmp.delta.def > 0 ? 'good' : cmp.delta.def < 0 ? 'bad' : ''}">${cmp.delta.def > 0 ? '+' : ''}${cmp.delta.def}</b></div>
          <div class="cmp-row"><span>速度</span><b class="${cmp.delta.spd > 0 ? 'good' : cmp.delta.spd < 0 ? 'bad' : ''}">${cmp.delta.spd > 0 ? '+' : ''}${cmp.delta.spd}</b></div>
          <div class="cmp-row"><span>暴击</span><b>${(cmp.delta.crit * 100).toFixed(1)}%</b></div>
          ${cmp.traitChanges.after.length ? `<div class="tiny">换装后特色：${cmp.traitChanges.after.map((t) => esc(D().TRAITS[t].name)).join('、')}</div>` : ''}
        </div>` : '<p class="tiny">选中一件装备后显示差值。</p>'}
      </div>
    </section>`;
  }

  /* ---------- 页面：祭坛 ---------- */

  function altarScreen(state) {
    return `<section class="screen">
      <div class="panel">
        <h3>遗物祭坛 <span class="tiny">遗物 ${state.shards}</span></h3>
        <div class="grid-4">
          ${D().ALTAR_UPGRADES.map((up) => {
            const lv = state.upgrades[up.k] || 0;
            const maxed = lv >= up.max;
            const cost = A.Roster.upgradeCost(state, up);
            return `<article class="card up-card">
              <div class="card-name">${esc(up.name)}</div>
              <div class="card-sub">${esc(up.desc)}</div>
              <div class="pips">${Array.from({ length: up.max }).map((_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div>
              <div class="tiny">Lv ${lv}/${up.max}</div>
              <div class="card-foot">${btn(maxed ? '已满' : `升级 · ${cost}`, 'upgrade', { k: up.k, cls: 'gold sm', disabled: maxed || state.shards < cost })}</div>
            </article>`;
          }).join('')}
        </div>
      </div>
    </section>`;
  }

  /* ---------- 页面：地图 ---------- */

  function mapScreen(state) {
    const r = state.run;
    if (!r) return '<p class="tiny">没有进行中的远征。</p>';
    const diff = D().DIFFICULTIES[r.difficulty];
    const partyIds = r.party.map((p) => p.uid);

    const track = Array.from({ length: r.maxFloor }).map((_, i) => {
      const f = i + 1;
      const cls = f < r.floor ? 'done' : f === r.floor ? 'now' : '';
      return `<span class="trk ${cls}">${f}</span>`;
    }).join('');

    const cards = r.nodes.map((n) => {
      const meta = D().NODE_TYPES[n.type] || {};
      const riskLabel = { low: '低危', medium: '中危', high: '高危' }[n.risk] || '';
      const rewards = {
        battle: '战利品 · 金币', elite: '战利品 · 金币 · 遗物', chest: '战利品 · 金币（可能带陷阱）',
        event: '未知', camp: '恢复 · 减压', merchant: '交易', boss: '通关 · 大量遗物',
      }[n.type] || '';
      return `<button class="node-card ${n.risk === 'high' ? 'danger' : ''} ${n.type === 'camp' ? 'safe' : ''}"
        data-act="enterNode" data-id="${n.id}" ${n.consumed ? 'disabled' : ''}>
        <div class="node-art">${A.Art.imgTag(meta.artId || 'scene.corridor', 'node-img', meta.name || '')}
          <span class="node-ic">${icon(meta.icon || 'question', 22)}</span>
        </div>
        <div class="node-body">
          <div class="node-name">${esc(n.name || meta.name)}</div>
          <div class="node-risk ${n.risk}">${riskLabel}</div>
          <div class="tiny">${esc(rewards)}</div>
        </div>
      </button>`;
    }).join('');

    const partyHtml = r.party.map((p) => {
      const u = state.roster.find((x) => x.id === p.uid);
      if (!u) return '';
      const st = A.Roster.calcStats(state, u.id, partyIds);
      const pct = Math.round(p.hp / st.maxHp * 100);
      return `<div class="mini-unit">
        <div class="row"><span class="tiny">${esc(u.name)}</span><span class="tiny">${p.hp}/${st.maxHp}</span></div>
        ${bar(p.hp, st.maxHp, 'hp')}
        <div class="tiny">压 ${p.stress}</div>
      </div>`;
    }).join('');

    const bless = r.blessings.map((b) => chip(esc(D().BLESSINGS[b].name), 'bless')).join('');

    return `<section class="screen">
      <div class="panel">
        <div class="map-head">
          <div><h3 style="margin:0">第 ${r.floor} 层 <span class="tiny">${esc(diff.name)}</span></h3></div>
          <div class="spacer"></div>
          <div class="track">${track}</div>
        </div>
        ${bless ? `<div class="syn-list" style="margin:8px 0">${bless}</div>` : ''}
        <div class="grid-3 node-grid">${cards}</div>
      </div>

      <div class="panel">
        <h3>小队 <span class="tiny">生命与压力会一路带走</span></h3>
        <div class="grid-4 mini-units">${partyHtml}</div>
        <div class="row" style="margin-top:12px">
          <span class="tiny">背包 ${r.bag.length}/${state.bagCap}</span>
          <span class="tiny">收获 ${r.goldFound} 金 · ${r.shards} 遗物</span>
          <div class="spacer"></div>
          ${btn('带着东西撤离', 'extract', { cls: 'gold' })}
        </div>
      </div>
    </section>`;
  }

  /* ---------- 页面：战斗（HUD 部分，Canvas 由 battle-view 负责） ---------- */

  function battleScreen(state, ui) {
    const b = state.run && state.run.battle;
    if (!b) return '<p class="tiny">没有战斗。</p>';
    const bossUnit = b.enemies.find((e) => e.isBoss);
    const bossArt = bossUnit && bossUnit.mechanic
      ? (bossUnit.mechanic.id === 'gatekeeper' ? 'enemy.gatekeeper' : 'enemy.memoryEater')
      : null;

    const intentText = bossUnit && bossUnit.intent
      ? (D().SKILLS[bossUnit.intent] || {}).name || '大招'
      : null;

    return `<section class="screen battle-screen">
      <div class="battle-top">
        <span class="tiny">第 ${state.run.floor} 层 · ${b.kind === 'boss' ? '首领' : b.kind === 'elite' ? '精英' : '遭遇'}</span>
        <span class="tiny">回合 ${b.round}</span>
        <div class="spacer"></div>
        <button class="btn ghost xs" id="btlTactic" data-act="setTactic">战术：${({ balance: '均衡', focus: '集火', safe: '保守' })[b.tactic]}</button>
        <button class="btn ghost xs" id="btlSpeed" data-act="cycleSpeed">速度 ×${ui.speed}</button>
        ${btn(ui.paused ? '继续' : '暂停', 'togglePause', { cls: 'ghost xs' })}
        ${b.over ? '' : btn('脱离战斗', 'flee', { cls: 'danger xs' })}
      </div>

      ${bossUnit ? `<div class="boss-card">
        <div class="boss-art">${A.Art.imgTag(bossArt, 'boss-img', bossUnit.name)}</div>
        <div class="boss-info">
          <div class="card-name">${esc(bossUnit.name)} <span class="tiny">阶段 ${bossUnit.bossPhase || 1}</span></div>
          ${bar(bossUnit.hp, bossUnit.maxHp, 'hp')}
          <div class="tiny boss-intent">${bossUnit.intent ? `<span class="intent">预告：${esc(intentText)}</span>` : '正在观察你们'}</div>
        </div>
      </div>` : ''}

      <div class="enemy-bars" id="enemyBars"></div>
      <canvas id="cv" width="960" height="300" aria-label="战场"></canvas>
      <div class="ally-bars" id="allyBars"></div>
      <div class="btl-log" id="btlLog" aria-live="polite"></div>
      <div class="battle-foot">
        <div class="spacer"></div>
        <button class="btn gold" id="btlNext" data-act="continueBattle" style="${b.over ? '' : 'display:none'}">${b.over ? (b.win ? '处理战利品 / 继续' : '结束这场远征') : '继续'}</button>
      </div>
    </section>`;
  }

  /* ---------- 页面：掉落取舍 ---------- */

  function lootScreen(state) {
    const r = state.run;
    if (!r) return '';
    const full = r.bag.length >= state.bagCap;
    const items = r.pendingLoot.map((id) => state.itemsById[id]).filter(Boolean);
    const bagItems = r.bag.map((id) => state.itemsById[id]).filter(Boolean);

    return `<section class="screen">
      <div class="panel">
        <h3>战利品 <span class="tiny">背包 ${r.bag.length}/${state.bagCap}${full ? ' · 已满' : ''}</span></h3>
        <p class="tiny">逐件处理。全部取舍完成后才会继续推进。</p>
        <div class="item-list">
          ${items.map((it) => `<div class="item">
            <span class="item-q ${qcls(it.q)}">${esc(D().QUALITY[it.q].name)}</span>
            <span class="item-name ${qcls(it.q)}">${esc(E().itemDisplayName(it))}</span>
            <span class="item-meta">${esc(D().SLOT_NAME[it.slot])}</span>
            <span class="item-stats">${esc(Object.entries(it.stats).map(([k, v]) => E().statLabel(k) + E().statText(k, v)).join('  '))}</span>
            <div class="item-actions">
              ${full
                ? btn('替换…', 'lootReplacePick', { id: it.id, cls: 'gold xs' })
                : btn('收下', 'lootAccept', { id: it.id, cls: 'gold xs' })}
              ${btn('丢弃', 'lootDiscard', { id: it.id, cls: 'ghost xs' })}
            </div>
          </div>`).join('')}
        </div>
      </div>

      ${full ? `<div class="panel">
        <h3>背包已满：选择要替换掉的装备</h3>
        <div class="item-list">
          ${bagItems.map((it) => `<div class="item">
            <span class="item-name ${qcls(it.q)}">${esc(E().itemDisplayName(it))}</span>
            <span class="item-stats">${esc(Object.entries(it.stats).map(([k, v]) => E().statLabel(k) + E().statText(k, v)).join('  '))}</span>
            <div class="item-actions">${btn('替换它', 'lootSwapTarget', { id: it.id, cls: 'danger xs' })}</div>
          </div>`).join('')}
        </div>
      </div>` : ''}
    </section>`;
  }

  /* ---------- 页面：祝福 ---------- */

  function blessingScreen(state) {
    const r = state.run;
    if (!r || r.stage !== 'blessing') return '';
    return `<section class="screen">
      <div class="panel">
        <h3>本局祝福 <span class="tiny">第 ${r.floor} 层 · 三选一，仅本局有效</span></h3>
        <div class="grid-3">
          ${r.blessingOffers.map((id) => {
            const b = D().BLESSINGS[id];
            return `<button class="bless-card" data-act="chooseBlessing" data-id="${id}" style="--bless:${b.color}">
              <span class="bless-name">${esc(b.name)}</span>
              <span class="tiny">${esc(b.desc)}</span>
            </button>`;
          }).join('')}
        </div>
      </div>
    </section>`;
  }

  /* ---------- 页面：事件 / 营地 / 商人 ---------- */

  function eventScreen(state) {
    const r = state.run;
    const ev = r && r.event;
    if (!ev) return '<p class="tiny">没有事件。</p>';

    if (ev.kind === 'merchant') {
      const goodsHtml = ev.goods.map((g) => {
        const it = state.itemsById[g.itemId];
        if (!it) return '';
        const full = r.bag.length >= state.bagCap;
        return `<div class="item">
          <span class="item-q ${qcls(it.q)}">${esc(D().QUALITY[it.q].name)}</span>
          <span class="item-name ${qcls(it.q)}">${esc(E().itemDisplayName(it))}</span>
          <span class="item-stats">${esc(Object.entries(it.stats).map(([k, v]) => E().statLabel(k) + E().statText(k, v)).join('  '))}</span>
          <div class="item-actions">
            ${g.sold
              ? '<span class="tiny">已售</span>'
              : btn(g.price + ' 金' + (full ? '（需替换）' : ''), 'buy', { id: g.itemId, cls: 'gold xs', disabled: state.gold < g.price })}
          </div>
        </div>`;
      }).join('');

      return `<section class="screen">
        <div class="panel">
          <h3>游商 <span class="tiny">营地钱包 ${state.gold} 金</span></h3>
          <p class="story">它披着一整张缝起来的皮，笑起来有太多牙。“买吗？”</p>
          <div class="item-list">${goodsHtml}</div>
          ${r.bag.length >= state.bagCap ? '<p class="warn tiny">背包已满。购买时会让你先选一件替换。</p>' : ''}
          <div class="row" style="margin-top:12px">
            ${btn(`治疗全队 · ${ev.healPrice} 金`, 'merchantHeal', { cls: 'ghost', disabled: state.gold < ev.healPrice })}
            <div class="spacer"></div>
            ${btn('离开', 'finishNode', { cls: 'gold' })}
          </div>
        </div>
      </section>`;
    }

    const def = D().EVENTS[ev.eventId];

    if (ev.resolved) {
      return `<section class="screen">
        <div class="panel">
          <h3>${esc(def ? def.title : ev.eventId === 'chest' ? '箱子' : '营火')}</h3>
          <p class="story">${ev.resultText || ''}</p>
          <div class="row"><div class="spacer"></div>${btn('继续', 'finishNode', { cls: 'gold' })}</div>
        </div>
      </section>`;
    }

    if (!def) {
      return `<section class="screen"><div class="panel"><p>事件数据缺失。</p>${btn('继续', 'finishNode', {})}</div></section>`;
    }

    return `<section class="screen">
      <div class="panel">
        <h3>${esc(def.title)} <span class="tiny">第 ${r.floor} 层</span></h3>
        <p class="story">${def.text}</p>
        <div class="choice-list">
          ${def.choices.map((c) => `<button class="choice" data-act="chooseEvent" data-id="${c.id}">
            <span>${esc(c.label)}</span>
            ${c.hint ? `<span class="tiny">${esc(c.hint)}</span>` : ''}
          </button>`).join('')}
        </div>
      </div>
    </section>`;
  }

  /* ---------- 页面：结算 ---------- */

  function resultScreen(state) {
    const s = state.settlement;
    if (!s) return '<p class="tiny">没有结算数据。</p>';
    const titles = { extract: '成功撤离', flee: '仓皇撤离', clear: '回廊尽头', wipe: '无人归还' };
    const lostHtml = (s.lostItems || []).length
      ? `<div class="panel"><h3>失去</h3><div class="item-list">${s.lostItems.map((it) => `<div class="item"><span class="item-name q0">${esc(it.name)}</span></div>`).join('')}</div></div>`
      : '';
    const gearHtml = (s.lostGear || []).length
      ? `<div class="panel"><h3>装备被扯走</h3><div class="item-list">${s.lostGear.map((it) => `<div class="item"><span class="item-name q0">${esc(it.name)}</span></div>`).join('')}</div></div>`
      : '';
    const itemsHtml = (s.items || []).length
      ? `<div class="item-list">${s.items.map((id) => {
          const it = state.itemsById[id];
          return it ? itemLine(state, it) : '';
        }).join('')}</div>`
      : '<p class="tiny">什么都没带回来。</p>';

    const adviceMap = {
      frontCollapse: '前排过早倒下，试试把盾卫放在 1 号位。',
      lowHealing: '治疗量跟不上承受伤害，考虑带牧师或提高减伤。',
      tooSlow: '战斗拖得太久，需要更高输出或集火战术。',
    };
    const advice = (s.adviceKeys || []).map((k) => adviceMap[k]).filter(Boolean);

    return `<section class="screen">
      <div class="panel result-head">
        <h2>${esc(titles[s.type] || '结算')}</h2>
        <p class="tiny">${s.type === 'wipe' ? '回廊把你们吃了，又吐出了几件衣服。' : s.type === 'flee' ? '你们转身就跑。一半的收获丢在了路上。' : '身后的门关上了。'}</p>
        <div class="chip-row">
          ${chip(`完成 ${s.completedFloors} 层`)}
          ${chip(`金币 +${s.gold}`, 'gold')}
          ${chip(`遗物 +${s.shards}`, 'shard')}
          ${chip(`带回 ${(s.items || []).length} 件`)}
        </div>
        ${advice.length ? `<div class="advice">${advice.map((a) => `<div class="tiny">· ${esc(a)}</div>`).join('')}</div>` : ''}
      </div>
      ${s.type === 'wipe' ? lostHtml + gearHtml : `<div class="panel"><h3>带回的装备</h3>${itemsHtml}</div>`}
      <div class="row"><div class="spacer"></div>${btn('返回营地', 'closeResult', { cls: 'gold btn-lg' })}</div>
    </section>`;
  }

  /* ---------- 弹层 ---------- */

  function settingsModal(state, ui) {
    if (ui.modal !== 'settings') return '';
    const st = state.settings;
    return `<div class="modal-back" data-act="closeModal">
      <div class="modal" role="dialog" aria-modal="true" aria-label="设置">
        <h3>设置</h3>
        <label class="row"><input type="checkbox" data-act="toggleSound" ${st.sound ? 'checked' : ''}> 音效</label>
        <label class="row"><input type="range" min="0" max="100" value="${Math.round(st.volume * 100)}" data-act="setVolume"> 音量</label>
        <label class="row"><input type="checkbox" data-act="toggleMotion" ${st.reducedMotion ? 'checked' : ''}> 减少动画</label>
        <hr>
        <div class="row">
          ${btn('导出存档', 'exportSave', { cls: 'ghost sm' })}
          ${btn('导入存档', 'importSave', { cls: 'ghost sm' })}
        </div>
        <p class="tiny">存档自动保存在本地浏览器。导入前会备份最近一次有效存档。</p>
        <div class="row"><div class="spacer"></div>${btn('关闭', 'closeModal', { cls: 'gold' })}</div>
      </div>
    </div>`;
  }

  function inspectModal(state, ui) {
    if (ui.modal !== 'inspect') return '';
    const u = state.roster.find((x) => x.id === ui.modalUnit);
    if (!u) return '';
    const slots = ['weapon', 'armor', 'trinket'].map((slot) => {
      const id = u.equip[slot];
      const it = id ? state.itemsById[id] : null;
      return `<div class="item">
        <span class="item-meta">${esc(D().SLOT_NAME[slot])}</span>
        ${it ? `<span class="item-name ${qcls(it.q)}">${esc(E().itemDisplayName(it))}</span>
          <div class="item-actions">${btn('卸下', 'unequip', { id: u.id, k: slot, cls: 'ghost xs' })}</div>`
        : '<span class="tiny">— 空 —</span>'}
      </div>`;
    }).join('');

    const pool = E().filter(state, {}).filter((it) => !u.equip[it.slot] || u.equip[it.slot] !== it.id);
    return `<div class="modal-back" data-act="closeModal">
      <div class="modal wide" role="dialog" aria-modal="true" aria-label="装备">
        <h3>${esc(u.name)} <span class="tiny">${esc(D().CLASSES[u.cls].name)}</span></h3>
        <div class="item-list">${slots}</div>
        <h4>仓库装备</h4>
        <div class="item-list">${pool.length ? pool.map((it) => `<div class="item">
          <span class="item-name ${qcls(it.q)}">${esc(E().itemDisplayName(it))}</span>
          <span class="item-stats">${esc(Object.entries(it.stats).map(([k, v]) => E().statLabel(k) + E().statText(k, v)).join('  '))}</span>
          <div class="item-actions">${btn('装备', 'equipItem', { id: it.id, cls: 'gold xs' })}</div>
        </div>`).join('') : '<p class="tiny">仓库里没有可用装备。</p>'}</div>
        <div class="row"><div class="spacer"></div>${btn('关闭', 'closeModal', { cls: 'gold' })}</div>
      </div>
    </div>`;
  }

  function swapModal(state, ui) {
    if (ui.modal !== 'swapTarget') return '';
    const lootId = ui.swapLootId;
    const r = state.run;
    if (!r || !lootId) return '';
    const it = state.itemsById[lootId];
    const bag = r.bag.map((id) => state.itemsById[id]).filter(Boolean);
    return `<div class="modal-back" data-act="closeModal">
      <div class="modal" role="dialog" aria-modal="true" aria-label="替换">
        <h3>替换哪一件？</h3>
        <p class="tiny">要收下：${esc(it ? E().itemDisplayName(it) : '')}</p>
        <div class="item-list">${bag.map((b) => `<div class="item">
          <span class="item-name ${qcls(b.q)}">${esc(E().itemDisplayName(b))}</span>
          <div class="item-actions">${btn('替换', 'lootSwapConfirm', { id: b.id, cls: 'danger xs' })}</div>
        </div>`).join('')}</div>
        <div class="row"><div class="spacer"></div>${btn('取消', 'closeModal', { cls: 'ghost' })}</div>
      </div>
    </div>`;
  }

  /* ---------- 渲染入口 ---------- */

  const SCREENS = {
    title: titleScreen,
    camp: campScreen,
    team: teamScreen,
    recruit: recruitScreen,
    stash: stashScreen,
    altar: altarScreen,
    map: mapScreen,
    battle: battleScreen,
    loot: lootScreen,
    blessing: blessingScreen,
    event: eventScreen,
    result: resultScreen,
  };

  function render(state, ui) {
    const fn = SCREENS[ui.screen] || campScreen;
    return fn(state, ui) + settingsModal(state, ui) + inspectModal(state, ui) + swapModal(state, ui);
  }

  function hud(state, ui) {
    const inRun = !!state.run;
    return `<div class="hud-brand">灰烬回廊<span>ASHEN CORRIDOR</span></div>
      <div class="hud-res">
        <span class="hud-item">${icon('coin', 14)} ${state.gold}</span>
        <span class="hud-item">${icon('shard', 14)} ${state.shards}</span>
        <span class="hud-item">最深 ${state.bestDepth} 层</span>
        ${inRun ? `<span class="hud-item">第 ${state.run.floor} 层</span>` : ''}
        ${btn('设置', 'openSettings', { cls: 'ghost xs' })}
      </div>`;
  }

  function nav(state, ui) {
    const items = [['camp', '营地'], ['team', '队伍'], ['recruit', '招募'], ['stash', '仓库'], ['altar', '祭坛']];
    return `<nav class="nav">${items.map(([k, n]) =>
      `<button class="nav-btn ${ui.screen === k ? 'on' : ''}" data-act="go" data-v="${k}">${n}</button>`
    ).join('')}</nav>`;
  }

  A.UI = { render, hud, nav, icon, bar, btn, chip, portrait, itemLine, unitCard, SCREENS };
})(globalThis.Ashen ||= {});
