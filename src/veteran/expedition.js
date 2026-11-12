'use strict';
/* 七章远征：节点生成、营火现场烙印、背包按格数、临时/永久归属、
   撤离与撤退的幂等结算事务。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const D = () => V.Data;
  const ST = () => V.State;

  function rngInt(st, min, max) {
    const r = A.Random.int(st.rngState >>> 0, min, max);
    st.rngState = r.state >>> 0;
    return r.value;
  }
  function rngShuffle(st, arr) {
    const r = A.Random.shuffle(st.rngState >>> 0, arr);
    st.rngState = r.state >>> 0;
    return r.value;
  }
  function rngChance(st, p) {
    const r = A.Random.chance(st.rngState >>> 0, p);
    st.rngState = r.state >>> 0;
    return r.value;
  }

  function bagUsed(st) {
    return packSlots(st).filter(Boolean).length;
  }
  const PACK_UPGRADES = [
    { name: '编织侧袋', capacity: 30, needs: { lampKelp: 3, houndShank: 2 } },
    { name: '加固背架', capacity: 36, needs: { shellLichen: 4, houndShank: 3, mistJelly: 2 } },
    { name: '折叠囊袋', capacity: 42, needs: { echoSac: 2, mistJelly: 4, lampKelp: 6 } },
  ];

  function bagCapacity(st) {
    return PACK_UPGRADES[(st.packLevel || 0) - 1]?.capacity || D().DESIGN.bagCapacity;
  }

  function upgradePack(st, target = 'pack') {
    if (st.run) return ST().fail(st, 'in_run', '请回营地改装背包');
    const storage = target === 'rack' || target === 'bins';
    const levelKey = target === 'rack' ? 'rackLevel' : target === 'bins' ? 'binLevel' : 'packLevel';
    const upgrade = (storage ? STORE_UPGRADES[target] : PACK_UPGRADES)[st[levelKey] || 0];
    if (!upgrade) return ST().fail(st, 'pack_max', '已完成全部改装');
    const costs = Object.entries(upgrade.needs);
    if (costs.some(([id, count]) => (st.pantry?.[id] || 0) < count)) {
      return ST().fail(st, 'missing_materials', '仓库材料不足');
    }
    const next = ST().clone(st);
    for (const [id, count] of costs) {
      next.pantry[id] -= count;
      if (!next.pantry[id]) delete next.pantry[id];
    }
    next[levelKey] = (st[levelKey] || 0) + 1;
    if (!storage && next.packOrder) next.packOrder = packSlots(next);
    return ST().ok(next);
  }

  function bagFree(st) { return bagCapacity(st) - bagUsed(st); }

  const PACK_STAGES = ['map', 'loot', 'camp', 'merchant'];

  const PACK_WIDTH = 6;
  const FOOD_SHAPES = {
    grain: { cells: [[0,0]], limit: 6 },
    small: { cells: [[0,0]], limit: 4 },
    leaves: { cells: [[0,0],[1,0]], limit: 4 },
    stalk: { cells: [[0,0],[0,1]], limit: 3 },
    joint: { cells: [[0,0],[1,0],[0,1]], limit: 2 },
    comb: { cells: [[0,0],[1,0],[0,1],[1,1]], limit: 3 },
  };
  const FOOD_PROFILE = {
    siltGrain: 'grain', caveMillet: 'grain', blackBean: 'grain', jointPea: 'grain', combPollen: 'grain',
    lampKelp: 'leaves', sulfurLeaf: 'leaves', shellLichen: 'leaves', mistFilm: 'leaves', echoFin: 'leaves',
    reedPith: 'stalk', springCress: 'stalk', ashRoot: 'stalk', ribSprout: 'stalk', houndMarrow: 'stalk',
    houndShank: 'joint', houndFlank: 'joint', axleCrab: 'joint', gateComb: 'comb', echoSac: 'comb',
  };

  function foodPack(id) {
    const item = Object.hasOwn(V.Kitchen.INGREDIENTS, id) && V.Kitchen.INGREDIENTS[id];
    return item ? FOOD_SHAPES[FOOD_PROFILE[item.family || id] || 'small'] : null;
  }
  const MEAL_PACK = { cells: [[0,0]], limit: 3 };
  function mealPack(id) {
    return Object.hasOwn(V.Kitchen.RECIPES, id) ? MEAL_PACK : null;
  }
  function stackSpec(token) {
    if (typeof token !== 'string') return null;
    const m = /^(food|meal):([A-Za-z][A-Za-z0-9]*)(?:#[1-9][0-9]{0,5})?$/.exec(token);
    if (!m) return null;
    const profile = m[1] === 'food' ? foodPack(m[2]) : mealPack(m[2]);
    return profile && { kind: m[1], id: m[2], base: m[1] + ':' + m[2], profile };
  }
  function itemTurn(st, token, ground = false) {
    const owner = st.run || st;
    return (owner[ground ? 'groundTurns' : 'packTurns']?.[token] || 0) & 3;
  }

  function packShape(st, token, turn = itemTurn(st,token)) {
    let cells = baseShape(st,token);
    for (let i=0;i<(turn & 3);i++) {
      const bottom = Math.max(...cells.map(c=>c[1]));
      cells = cells.map(([x,y])=>[bottom-y,x]);
    }
    return cells;
  }

  function baseShape(st, token) {
    const entry = stackSpec(token);
    if (entry) return entry.profile.cells;
    const partId = typeof token === 'string' && token.startsWith('part:') && token.slice(5);
    const item = partId && Object.hasOwn(st.itemsById || {}, partId) && st.itemsById[partId];
    if (!item) return [];
    if (item.kind === 'weapon') return [[0,0],[1,0],[0,1],[1,1]];
    const cells = D().template(item.templateId).cells;
    const minX = Math.min(...cells.map(p => p[0])), minY = Math.min(...cells.map(p => p[1]));
    return cells.map(([x, y]) => [x - minX, y - minY]);
  }

  // 原料、成菜的份数来自各自库存，堆号保留每一堆的数量与位置。
  function packStacks(st) {
    const stacks = {};
    const owner = st.run || st;
    const stored = Object.entries(owner.packStacks || {});
    const materials = Object.entries(st.run?.ingredients || {}).map(([id, count]) => ['food:' + id, count]);
    const meals = Object.entries(st.run ? st.run.meals || {} : st.packedMeals || {}).map(([id, count]) => ['meal:' + id, count]);
    for (const [base, count] of [...materials, ...meals]) {
      const profile = stackSpec(base)?.profile;
      if (!profile || !Number.isSafeInteger(count) || count <= 0 || count > bagCapacity(st) * (profile.limit + 1)) continue;
      let left = count;
      const own = stored.filter(([token, n]) => stackSpec(token)?.base === base && Number.isSafeInteger(n) && n > 0);
      for (const [token, n] of own) {
        if (!left) break;
        stacks[token] = Math.min(n, left, profile.limit);
        left -= stacks[token];
      }
      for (const [token] of own) {
        if (!left) break;
        if (owner.packReserve?.[token]) continue;
        const extra = Math.min(profile.limit - stacks[token], left);
        stacks[token] += extra;
        left -= extra;
      }
      for (let i = 0; left; i++) {
        const token = i ? base + '#' + i : base;
        if (Object.hasOwn(stacks, token)) continue;
        stacks[token] = Math.min(left, profile.limit);
        left -= stacks[token];
      }
    }
    return stacks;
  }

  function stackCount(st, token) {
    if (stackSpec(token)) return packStacks(st)[token] || 0;
    return typeof token === 'string' && token.startsWith('part:') && st.run?.bag.includes(token.slice(5)) ? 1 : 0;
  }

  function footprint(shape, x, y, slots) {
    if (!shape.length) return null;
    const indices = [];
    for (const [dx, dy] of shape) {
      const col = x + dx, row = y + dy;
      if (col < 0 || col >= PACK_WIDTH || row < 0 || row * PACK_WIDTH + col >= slots.length) return null;
      indices.push(row * PACK_WIDTH + col);
    }
    return indices;
  }

  function firstFit(shape, slots) {
    for (let i = 0; i < slots.length; i++) {
      const at = footprint(shape, i % PACK_WIDTH, Math.floor(i / PACK_WIDTH), slots);
      if (at && at.every(j => slots[j] === null)) return at;
    }
    return null;
  }

  const STORE_UPGRADES = {
    rack: [
      {name:'铆接层架', needs:{lampKelp:3,houndShank:2}},
      {name:'承重横梁', needs:{shellLichen:4,mistJelly:2}},
      {name:'高位货架', needs:{echoSac:2,houndShank:4}},
    ],
    bins: [{name:'密封分装匣', needs:{shellLichen:3,mistJelly:2}}],
  };

  function storeLayout(st, shelf, tidy = false) {
    const slots = Array(24 + 12 * (st.rackLevel || 0)).fill(null);
    const entries = new Map(), saved = st.storePlaces?.[shelf] || {};
    function add(token, count = 1) {
      const turn = saved[token]?.turn & 3;
      const cells = shelf === 'etch' ? [[0,0]] : packShape(st, token, turn);
      entries.set(token, {count, turn, cells});
    }
    if (shelf === 'part') st.stash.forEach(id => add('part:' + id));
    if (shelf === 'etch') for (const m of st.manuscriptVault || []) {
      const key = 'etch:' + m.id;
      add(key, (entries.get(key)?.count || 0) + 1);
    }
    if (shelf === 'food' || shelf === 'meal') {
      for (const [id, n] of Object.entries((shelf === 'food' ? st.pantry : st.mealStore) || {})) {
        const base = shelf + ':' + id, limit = stackSpec(base).profile.limit + 2 * (st.binLevel || 0);
        // 超大旧库存只展开能上架的堆数，余量合并为一个待上架条目。
        for (let left = n, i = 0; left > 0; i++) {
          const amount = i === slots.length ? left : Math.min(left, limit);
          add(i ? base + '#' + i : base, amount);
          left -= amount;
        }
      }
    }
    const places = {}, overflow = [];
    function place(token, indices) {
      for (const i of indices) slots[i] = token;
      places[token] = {at:Math.min(...indices.map(i=>i%6)) + 6*Math.floor(Math.min(...indices)/6), turn:entries.get(token).turn};
    }
    if (!tidy) for (const [token, entry] of entries) {
      const at = saved[token]?.at;
      if (!Number.isInteger(at) || at < 0 || at >= slots.length) continue;
      const indices = footprint(entry.cells, at%6, Math.floor(at/6), slots);
      if (indices && indices.every(i => !slots[i])) place(token, indices);
    }
    const pending = [...entries].filter(([key]) => !places[key]).sort((a,b)=>b[1].cells.length-a[1].cells.length);
    for (const [token, entry] of pending) {
      const indices = firstFit(entry.cells, slots);
      if (indices) place(token, indices);
      else overflow.push(token);
    }
    return {slots, entries, places, overflow};
  }

  function arrangeStore(st, shelf, token, to, rotate = false) {
    if (st.run || !['food','meal','part','etch'].includes(shelf)) return ST().fail(st,'stage','请回前哨整理');
    const {slots, entries, places} = storeLayout(st, shelf, !token);
    if (token) {
      if (!entries.has(token)) return ST().fail(st,'missing','物品已移出');
      const turn = (entries.get(token).turn + Number(rotate)) & 3;
      const at = rotate ? places[token]?.at : to;
      const cells = shelf === 'etch' ? [[0,0]] : packShape(st,token,turn);
      const indices = Number.isInteger(at) && at >= 0 && at < slots.length && footprint(cells, at%6, Math.floor(at/6), slots);
      if (!indices || indices.some(i=>slots[i] && slots[i] !== token)) return ST().fail(st,'space','这里放不下整件');
      places[token] = {at,turn};
    }
    const next = ST().clone(st);
    (next.storePlaces ||= {})[shelf] = places;
    return ST().ok(next);
  }

  function packLayout(st, tidy = false) {
    const slots = Array(bagCapacity(st)).fill(null), overflow = [];
    const tokens = [...(st.run?.bag || []).map(id => 'part:' + id), ...Object.keys(packStacks(st))];
    const shapes = new Map(tokens.map(token => [token, packShape(st, token)]));
    const placed = new Set();
    const hints = (st.run || st).packOrder || [];
    if (!tidy) {
      for (const token of tokens) {
        const indices = hints.flatMap((v, i) => v === token ? [i] : []);
        if (indices.length !== shapes.get(token).length || !indices.length) continue;
        const x = Math.min(...indices.map(i => i % PACK_WIDTH));
        const y = Math.floor(indices[0] / PACK_WIDTH);
        const at = footprint(shapes.get(token), x, y, slots);
        if (!at || !at.every(i => hints[i] === token)) continue;
        for (const i of at) slots[i] = token;
        placed.add(token);
      }
    }
    if (!tidy && st.run?.packReserve) tokens.sort((a,b) => Number(!!st.run.packReserve[a]) - Number(!!st.run.packReserve[b]));
    if (tidy) tokens.sort((a,b) => shapes.get(b).length - shapes.get(a).length || a.localeCompare(b));
    for (const token of tokens) {
      if (placed.has(token)) continue;
      const at = firstFit(shapes.get(token), slots);
      if (at) for (const i of at) slots[i] = token;
      else overflow.push(token);
    }
    return { slots, overflow };
  }

  function packSlots(st) { return packLayout(st).slots; }
  function packOverflow(st) { return packLayout(st).overflow; }
  // 旧档待整理物仍属原持有者。保留其原堆号与数量，避免新增物品挤进待整理区。
  function reserveSnapshot(st) {
    const entries = {};
    for (const token of packOverflow(st)) entries[token] = stackCount(st, token);
    return entries;
  }
  function syncReserve(st) {
    if (!st.run) return;
    const saved = reserveSnapshot(st);
    if (Object.keys(saved).length) st.run.packReserve = saved;
    else delete st.run.packReserve;
  }

  function autoDrop(st, token, turn = itemTurn(st, token, true)) {
    const slots = packSlots(st), entry = stackSpec(token);
    if (entry) {
      if (!st.run && entry.kind !== 'meal') return null;
      const stacks = packStacks(st);
      const index = slots.findIndex(key => key && stackSpec(key)?.base === entry.base && stacks[key] < entry.profile.limit);
      if (index >= 0) return { to: index };
    } else if (!st.run || typeof token !== 'string' || !token.startsWith('part:') || st.run.bag.includes(token.slice(5))) return null;
    const shape = packShape(st, token, turn);
    const indices = firstFit(shape, slots);
    if (!indices) return null;
    return { to: indices[0] - shape[0][1] * PACK_WIDTH - shape[0][0] };
  }
  function canPack(st, token) { return !!autoDrop(st, token); }

  function groundStock(run, entry) { return entry.kind === 'food' ? run.ingredientLoot : run.mealLoot; }

  /** 纹路整件放置，食材和成菜按地面剩余、目标堆余量及可选的拾取上限扣量。 */
  function previewLootDrop(st, token, to, maxCount = Infinity, turn = itemTurn(st,token,true)) {
    const fail = (reason, indices = []) => ({ ok: false, reason, indices });
    if (st.run?.stage !== 'loot' || typeof token !== 'string') return fail('当前不能拾取');
    const entry = stackSpec(token);
    const part = token.startsWith('part:') && st.run.pendingLoot.includes(token.slice(5));
    const available = entry && token === entry.base ? groundStock(st.run, entry)?.[entry.id] || 0 : 0;
    if (!part && !available) return fail('地面没有这件物品');
    if (maxCount !== Infinity && (!Number.isSafeInteger(maxCount) || maxCount < 1)) return fail('拾取数量无效');
    const slots = packSlots(st);
    if (!Number.isInteger(to) || to < 0 || to >= slots.length) return fail('请拖入背包格');
    const target = slots[to], stacks = packStacks(st);
    if (target && entry && stackSpec(target)?.base === entry.base) {
      const count = Math.min(available, entry.profile.limit - stacks[target], maxCount);
      if (count <= 0) return fail('这一堆已满', [to]);
      return { ok: true, token: target, count, indices: slots.flatMap((t, i) => t === target ? [i] : []), stack: true };
    }
    const indices = footprint(packShape(st, token, turn), to % PACK_WIDTH, Math.floor(to / PACK_WIDTH), slots);
    if (!indices || indices.some(i => slots[i])) return fail('没有能容纳整件的空位', indices || [to]);
    let placed = token;
    if (entry) for (let i = 0; Object.hasOwn(stacks, placed); i++) placed = entry.base + '#' + (i + 1);
    return { ok: true, token: placed, indices, stack: false, count: entry ? Math.min(available, entry.profile.limit, maxCount) : 1 };
  }

  function takeLootAt(st, token, to, maxCount, turn = itemTurn(st,token,true)) {
    const drop = previewLootDrop(st, token, to, maxCount, turn);
    if (!drop.ok) return ST().fail(st, 'pack_fit', drop.reason);
    const next = ST().clone(st), run = next.run, entry = stackSpec(token);
    const slots = packSlots(st);
    run.packReserve = reserveSnapshot(st);
    if (entry) {
      const ground = groundStock(run, entry);
      ground[entry.id] -= drop.count;
      if (!ground[entry.id]) delete ground[entry.id];
      const held = entry.kind === 'food' ? (run.ingredients ||= {}) : (run.meals ||= {});
      held[entry.id] = (held[entry.id] || 0) + drop.count;
      const stacks = packStacks(st);
      stacks[drop.token] = (stacks[drop.token] || 0) + drop.count;
      run.packStacks = stacks;
    } else {
      const id = token.slice(5);
      run.pendingLoot = run.pendingLoot.filter(k => k !== id);
      run.bag.push(id);
    }
    if (!drop.stack) (run.packTurns ||= {})[drop.token] = turn & 3;
    for (const index of drop.indices) slots[index] = drop.token;
    run.packOrder = slots;
    syncReserve(next);
    const type = !entry ? 'lootTake' : entry.kind === 'food' ? 'ingredientTaken' : 'mealTaken';
    const meta = entry ? { id: entry.id, count: drop.count } : { itemId: token.slice(5) };
    return ST().ok(next, [{ type, meta }], { token: drop.token, count: drop.count });
  }

  function putOnGround(st, token, turn = itemTurn(st,token)) {
    if (st.run?.stage !== 'loot') return ST().fail(st, 'bad_stage', '只有搜刮现场能放回地面');
    const entry = stackSpec(token), count = stackCount(st, token);
    if (!count) return ST().fail(st, 'no_bag_item', '行囊中没有这件物品');
    const next = ST().clone(st), run = next.run;
    run.packOrder = packSlots(st);
    run.packReserve = reserveSnapshot(st);
    if (entry) {
      const held = entry.kind === 'food' ? run.ingredients : run.meals;
      const ground = entry.kind === 'food' ? (run.ingredientLoot ||= {}) : (run.mealLoot ||= {});
      if (!Number.isSafeInteger((ground[entry.id] || 0) + count)) return ST().fail(st, 'invalid_count', '地面数量过大');
      ground[entry.id] = (ground[entry.id] || 0) + count;
      held[entry.id] -= count;
      if (!held[entry.id]) delete held[entry.id];
      run.packStacks = packStacks(st);
      delete run.packStacks[token];
    } else {
      const id = token.slice(5);
      run.bag = run.bag.filter(k => k !== id);
      run.pendingLoot.push(id);
    }
    (run.groundTurns ||= {})[entry?.base || token] = turn & 3;
    if (run.packTurns) delete run.packTurns[token];
    run.packOrder = packSlots(next);
    syncReserve(next);
    return ST().ok(next, [{ type: 'groundPlaced', meta: { token: entry?.base || token, count } }], { token: entry?.base || token, count });
  }

  /** 拖到空位会平移整件；拖到另一件上会尝试交换，边界、相交或第三件占位都拒绝。 */
  function turnedPackDrop(st, token, to, turn) {
    const slots = packSlots(st);
    const indices = footprint(packShape(st,token,turn),to % PACK_WIDTH,Math.floor(to / PACK_WIDTH),slots) || [];
    const ok = Number.isInteger(to) && to >= 0 && indices.length > 0 && indices.every(i=>!slots[i] || slots[i] === token);
    return {ok,indices,reason:ok ? '' : '旋转后放不下，试试别的空位'};
  }

  function turnPack(st, token, to, turn) {
    if (st.run && !PACK_STAGES.includes(st.run.stage)) return ST().fail(st,'bad_stage','当前只能查看行囊');
    const drop = turnedPackDrop(st,token,to,turn);
    if (!stackCount(st,token) || !drop.ok) return ST().fail(st,'pack_fit',drop.reason || '背包中没有这件物品');
    const next = ST().clone(st), owner = next.run || next;
    owner.packOrder = packSlots(st).map(key=>key === token ? null : key);
    for (const i of drop.indices) owner.packOrder[i] = token;
    (owner.packTurns ||= {})[token] = turn & 3;
    syncReserve(next);
    return ST().ok(next);
  }

  function movePack(st, from, to) {
    if (st.run && !PACK_STAGES.includes(st.run.stage)) return ST().fail(st, 'bad_stage', '当前只能查看行囊');
    const slots = packSlots(st);
    if (![from,to].every(i => Number.isInteger(i) && i >= 0 && i < slots.length) || !slots[from]) {
      return ST().fail(st, 'invalid_slot', '请选择有物品的起始格和有效目的格');
    }
    if (from === to) return ST().ok(st);
    const source = slots[from], target = slots[to] !== source ? slots[to] : null;
    const shifted = slots.map(t => t === source || t === target ? null : t);
    const dx = to % PACK_WIDTH - from % PACK_WIDTH;
    const dy = Math.floor(to / PACK_WIDTH) - Math.floor(from / PACK_WIDTH);
    for (const [token, sign] of [[source,1],[target,-1]]) {
      if (!token) continue;
      for (let i = 0; i < slots.length; i++) {
        if (slots[i] !== token) continue;
        const x = i % PACK_WIDTH + sign * dx, y = Math.floor(i / PACK_WIDTH) + sign * dy;
        const j = y * PACK_WIDTH + x;
        if (x < 0 || x >= PACK_WIDTH || j < 0 || j >= slots.length || shifted[j] !== null) {
          return ST().fail(st, 'pack_fit', '整件无法放入，请腾出对应空格');
        }
        shifted[j] = token;
      }
    }
    const next = ST().clone(st);
    (next.run || next).packOrder = shifted;
    syncReserve(next);
    return ST().ok(next, [{ type: 'packMoved', meta: { from, to } }]);
  }

  function sortPack(st) {
    if (st.run && !PACK_STAGES.includes(st.run.stage)) return ST().fail(st, 'bad_stage', '当前只能查看行囊');
    const next = ST().clone(st);
    const original = packLayout(st);
    const owner = next.run || next;
    delete owner.packStacks;
    const sorted = packLayout(next, true);
    if (sorted.overflow.some(token => !original.overflow.includes(token)
      || stackCount(next, token) > stackCount(st, token))) return ST().ok(st);
    owner.packOrder = sorted.slots;
    owner.packStacks = packStacks(next);
    syncReserve(next);
    return ST().ok(next, [{ type: 'packSorted' }]);
  }

  function discardPack(st, token, slotIndex) {
    if (st.run && !PACK_STAGES.includes(st.run.stage)) return ST().fail(st, 'bad_stage', '当前只能查看行囊');
    if (slotIndex !== undefined && (!Number.isInteger(slotIndex) || packSlots(st)[slotIndex] !== token)) {
      return ST().fail(st, 'invalid_slot', '选中的格子与要丢弃的物品不符');
    }
    const entry = stackSpec(token);
    if (entry) return removeServing(st, entry.base, token);
    if (typeof token !== 'string' || !token.startsWith('part:') || !st.run?.bag.includes(token.slice(5))) {
      return ST().fail(st, 'no_bag_item', '行囊中没有这件物品');
    }
    const next = ST().clone(st);
    next.run.bag = next.run.bag.filter(key => key !== token.slice(5));
    delete next.itemsById[token.slice(5)];
    recordPackChange(st, next);
    return ST().ok(next, [{ type: 'packDiscarded', meta: { itemId: token.slice(5) } }]);
  }

  function recordPackChange(before, after) {
    const owner = after.run || after;
    if (after.run) after.run.packReserve = reserveSnapshot(before);
    owner.packOrder = packSlots(before);
    owner.packStacks = packStacks(before);
    owner.packStacks = packStacks(after);
    owner.packOrder = packSlots(after);
    syncReserve(after);
  }

  /* ------------------------------ 节点生成 ------------------------------ */

  function genNodes(st) {
    const floor = st.run.floor;
    let types;

    const chapter = D().chapterAt(floor);
    if (chapter.step === 7) {
      types = ['boss'];
    } else {
      const fights = floor >= 3 ? ['battle', 'elite'] : ['battle'];
      const supplies = ['chest'];
      if (floor >= 2) supplies.push('camp');
      if (floor >= 3) supplies.push('merchant');
      const fight = fights[rngInt(st, 0, fights.length - 1)];
      const supply = supplies[rngInt(st, 0, supplies.length - 1)];
      const remaining = ['event', ...fights, ...supplies].filter((type) => type !== fight && type !== supply);
      types = rngShuffle(st, [fight, supply, [2,5].includes(chapter.step) ? 'event' : remaining[rngInt(st, 0, remaining.length - 1)]]);
    }

    st.run.nodes = types.map((t, i) => ({
      id: 'n' + floor + '_' + i,
      type: t,
      consumed: false,
      name: D().nodeType(t).name,
      desc: D().nodeType(t).desc,
      risk: D().nodeType(t).risk,
      artId: D().nodeType(t).artId,
      icon: D().nodeType(t).icon,
    }));
  }

  /* ------------------------------ 开局 ------------------------------ */

  function start(st, opts) {
    const o = opts || {};
    if (st.run) return ST().fail(st, 'run_exists', '已经有一次远征在进行');
    const formation = (st.team || []).filter(Boolean);
    if (!formation.length) return ST().fail(st, 'empty_team', '没有编队');

    const next = ST().clone(st);
    if (o.seed != null) next.rngState = (o.seed >>> 0);

    const run = {
      id: 'r' + next.nextId,
      difficulty: o.difficulty || next.difficulty || 'normal',
      floor: 1,
      completedFloors: 0,
      completedNodeIds: [],
      stage: 'map',
      rngState: next.rngState >>> 0,
      party: formation.map((uid, slot) => ({ uid, slot, hp: null, stress: 0 })),
      nodes: [],
      lockedNodeId: null,
      startLoadouts: {},
      bag: [],
      packOrder: packSlots(st),
      packStacks: packStacks(st),
      meals: next.packedMeals || {},
      pendingLoot: [],
      ingredients: {},
      ingredientLoot: {},
      mealLoot: {},
      provisionalBindings: [],
      fieldLayouts: {},
      goldFound: 0,
      shards: 0,
      blessings: [],
      blessingFloorsTaken: [],
      fieldInscribedUnitIds: [],
      maxHpModifiers: {},
      event: null,
      shop: null,
      encounter: null,
      battle: null,
      finishedFloors: [],
      pendingAdvance: null,
    };
    next.nextId += 1;

    /* 入场快照：主手、板面、指令 */
    run.party.forEach((p) => {
      const u = next.roster.find((x) => x.id === p.uid);
      if (!u) return;
      p.stress = u.stress || 0;
      run.startLoadouts[u.id] = {
        manuscriptIds: ST().manuscriptsOf(u).map(ms => ms.id),
        board: ST().clone(u.board),
        gambits: ST().clone(u.gambits),
        hp: p.hp,
        stress: p.stress,
      };
    });

    next.packedMeals = {};
    delete next.packOrder;
    delete next.packStacks;
    next.run = run;
    next.stats.runs = (next.stats.runs || 0) + 1;
    genNodes(next);
    ST().addLog(next, { kind: 'sys', text: `第 1 层。${next.run.nodes.map((n) => n.name).join('、')}。` });

    return ST().ok(next, [{ type: 'runStart', meta: { runId: run.id } }]);
  }

  /* ------------------------------ 选择节点 ------------------------------ */

  function chooseNode(st, nodeId) {
    const run = st.run;
    if (!run) return ST().fail(st, 'no_run', '没有远征');
    if (run.stage !== 'map') return ST().fail(st, 'bad_stage', '现在不能选节点');
    const node = (run.nodes || []).find((n) => n.id === nodeId);
    if (!node) return ST().fail(st, 'no_node', '找不到节点');
    if (node.consumed) return ST().fail(st, 'consumed', '这个节点已经走过了');

    /* 战斗节点也要记 activeNodeId：finishNode 靠它把节点标成已完成并记层数。
       之前这里直接 return，导致战斗节点永远不会被标记完成、完成层数恒为 0。 */
    const staged = ST().clone(st);
    staged.run.activeNodeId = nodeId;

    if (node.type === 'battle' || node.type === 'elite' || node.type === 'boss') {
      return V.Encounter.open(staged, nodeId);
    }

    const next = staged;

    if (node.type === 'chest') {
      const itemIds = rngShuffle(next, D().TEMPLATE_ORDER).slice(0, 2).map((templateId) => {
        const part = ST().makePart(next, { kind: 'circuit', templateId });
        next.itemsById[part.id] = part;
        return part.id;
      });
      next.run.stage = 'loot';
      stockChest(next, itemIds);
      return ST().ok(next, [{ type: 'chest', meta: { itemIds } }]);
    }

    if (node.type === 'event') {
      const pool = D().eventPool(next.run.floor);
      const fresh = pool.filter(id => !(next.run.chapterEvents || []).includes(id));
      if (!fresh.length) next.run.chapterEvents = [];
      const evId = rngShuffle(next, fresh.length ? fresh : pool)[0];
      (next.run.chapterEvents ||= []).push(evId);
      const ev = D().event(evId);
      next.run.event = { eventId: evId, resolved: false, resultText: '', pendingCombat: null, depth: 0, branch: null };
      next.run.stage = 'event';
      return ST().ok(next, [{ type: 'eventOpen', meta: { eventId: evId, title: ev.title } }]);
    }

    if (node.type === 'camp') {
      next.run.campRested = false;
      next.run.stage = 'camp';
      return ST().ok(next, [{ type: 'campOpen' }]);
    }

    if (node.type === 'merchant') {
      const offers = [];
      const stock = rngShuffle(next, D().TEMPLATE_ORDER).slice(0, 3);
      for (const [i, tpl] of stock.entries()) {
        const part = ST().makePart(next, {
          kind: 'circuit', templateId: tpl,
        });
        next.itemsById[part.id] = part;
        const base = 45 + D().template(tpl).load * 5;
        offers.push({
          id: 'o' + i + '_' + part.id,
          itemId: part.id,
          price: base + rngInt(next, 0, 25),
          sold: false,
        });
      }
      next.run.shop = offers;
      next.run.stage = 'merchant';
      return ST().ok(next, [{ type: 'merchantOpen' }]);
    }

    return ST().fail(st, 'bad_node', '未知节点类型');
  }

  /* ------------------------------ 事件 ------------------------------ */

  function runFoodTotal(run) {
    return Object.values(run.ingredients || {}).reduce((sum, n) => sum + n, 0);
  }

  /** 选项门槛：四种玩家一眼能懂的条件，不满足时按钮禁用并给出同一句原因。 */
  function eventGate(st, need) {
    if (!need) return { ok: true };
    const run = st.run;
    if (need.gold != null && st.gold < need.gold) return { ok: false, reason: `需要 ${need.gold} 金币` };
    if (need.ingredient != null && runFoodTotal(run) < need.ingredient) return { ok: false, reason: `需要 ${need.ingredient} 份随身食材` };
    if (need.meal != null && Object.values(run.meals || {}).reduce((a, n) => a + n, 0) < need.meal) return { ok: false, reason: `需要 ${need.meal} 份成菜` };
    if (need.part != null && (run.bag || []).length + (run.pendingLoot || []).length < need.part) return { ok: false, reason: `需要 ${need.part} 件纹路` };
    if (need.noFieldManuscript && run.fieldManuscript) return { ok: false, reason: '拓本匣里已经有一份拓本' };
    if (need.hpAbove != null) {
      const low = (run.party || []).some((p) => {
        const u = st.roster.find((x) => x.id === p.uid);
        if (!u) return false;
        const max = V.Roster.stats(st, u).maxHp;
        return (p.hp == null ? max : p.hp) / max < need.hpAbove;
      });
      if (low) return { ok: false, reason: `需要全队生命都在 ${Math.round(need.hpAbove * 100)}% 以上` };
    }
    return { ok: true };
  }

  /** 兼容旧字段：loot / damagePct / stress 写在选项顶层也算效果。 */
  function choiceEffects(choice) {
    const eff = { ...(choice.effects || {}) };
    if (choice.loot && eff.loot == null) eff.loot = choice.loot;
    if (choice.damagePct && eff.damagePct == null) eff.damagePct = choice.damagePct;
    if (choice.stress && eff.stress == null) eff.stress = choice.stress;
    return eff;
  }

  function consumeFood(st, count) {
    const stock = { ...(st.run.ingredients || {}) };
    let left = count;
    for (const id of Object.keys(stock).sort()) {
      if (!left) break;
      const take = Math.min(left, stock[id]);
      stock[id] -= take;
      left -= take;
      if (!stock[id]) delete stock[id];
    }
    st.run.ingredients = stock;
    return count - left;
  }

  function grantFood(st, spec) {
    const run = st.run;
    const ids = spec.id ? [spec.id] : V.Kitchen.forageOptions(D().chapterAt(run.floor).region);
    if (!ids.length) return {};
    const got = {};
    for (let i = 0; i < (spec.n || 1); i += 1) {
      const id = ids[rngInt(st, 0, ids.length - 1)];
      got[id] = (got[id] || 0) + 1;
    }
    for (const [id, n] of Object.entries(got)) run.ingredients[id] = (run.ingredients[id] || 0) + n;
    return got;
  }

  function grantMeal(st, count) {
    const run = st.run;
    const ids = Object.keys(V.Kitchen.RECIPES);
    const got = {};
    for (let i = 0; i < count; i += 1) {
      const id = ids[rngInt(st, 0, ids.length - 1)];
      got[id] = (got[id] || 0) + 1;
    }
    for (const [id, n] of Object.entries(got)) run.meals[id] = (run.meals[id] || 0) + n;
    return got;
  }

  function grantBlessing(st) {
    const run = st.run;
    const pool = D().BLESSING_ORDER.filter((id) => !run.blessings.includes(id));
    if (!pool.length) return null;
    const id = rngShuffle(st, pool)[0];
    run.blessings.push(id);
    return id;
  }

  /**
   * 统一结算事件效果。只改传进来的 next（调用方已 clone），
   * 返回 {results, packTouched}，让调用方决定是否重排行囊。
   */
  function applyEventEffects(next, eff, results) {
    const run = next.run;
    let packTouched = false;
    if (!eff) return { packTouched };
    const push = (entry) => results.push(entry);

    if (eff.gold) {
      const before = next.gold;
      next.gold = Math.max(0, next.gold + eff.gold);
      push({ kind: 'gold', amount: next.gold - before });
    }
    if (eff.shards) {
      const before = next.shards;
      next.shards = Math.max(0, next.shards + eff.shards);
      push({ kind: 'shards', amount: next.shards - before });
    }

    if (eff.consumeIngredient) {
      const used = consumeFood(next, eff.consumeIngredient);
      if (used) { packTouched = true; push({ kind: 'foodSpent', amount: used }); }
    }
    if (eff.ingredient) {
      const got = grantFood(next, eff.ingredient);
      if (Object.keys(got).length) { packTouched = true; push({ kind: 'foodGain', food: got }); }
    }
    if (eff.meal) {
      const got = grantMeal(next, eff.meal);
      if (Object.keys(got).length) { packTouched = true; push({ kind: 'mealGain', meals: got }); }
    }

    if (eff.loot) {
      for (let i = 0; i < eff.loot; i += 1) {
        const tpl = rngShuffle(next, D().TEMPLATE_ORDER)[0];
        const part = ST().makePart(next, {
          kind: 'circuit', templateId: tpl,
          acquiredRunId: run.id,
          acquiredSeq: run.bag.length + run.pendingLoot.length + i + 1,
        });
        next.itemsById[part.id] = part;
        packTouched = true;
        if (canPack(next, 'part:' + part.id)) {
          run.bag.push(part.id);
          push({ kind: 'loot', itemId: part.id });
        } else {
          run.pendingLoot.push(part.id);
          push({ kind: 'loot', itemId: part.id, overflow: true });
        }
      }
    }

    if (eff.manuscript) {
      V.Expedition.findFieldManuscript(next, eff.manuscript === 'event' ? 'event' : eff.manuscript);
      if (run.fieldManuscript) push({ kind: 'manuscript', id: run.fieldManuscript });
    }
    if (eff.blessing) {
      const id = grantBlessing(next);
      if (id) push({ kind: 'blessing', id });
    }

    if (eff.healPct) {
      const healed = [];
      (run.party || []).forEach((p) => {
        const u = next.roster.find((x) => x.id === p.uid);
        if (!u) return;
        const max = V.Roster.stats(next, u).maxHp;
        const cur = p.hp == null ? max : p.hp;
        const gained = Math.max(0, Math.min(max, cur + Math.round(max * eff.healPct)) - cur);
        if (gained) { p.hp = cur + gained; healed.push({ uid: p.uid, amount: gained }); }
      });
      if (healed.length) push({ kind: 'heal', targets: healed });
    }

    if (eff.damagePct) {
      const target = run.party[Math.floor(run.party.length * 0.5)] || run.party[0];
      if (target) {
        const u = next.roster.find((x) => x.id === target.uid);
        const max = V.Roster.stats(next, u).maxHp;
        const dmg = Math.round(max * eff.damagePct);
        target.hp = Math.max(1, (target.hp == null ? max : target.hp) - dmg);
        push({ kind: 'damage', uid: target.uid, amount: dmg });
      }
    }
    if (eff.hurtPct) {
      const hits = [];
      (run.party || []).forEach((p) => {
        const u = next.roster.find((x) => x.id === p.uid);
        if (!u) return;
        const max = V.Roster.stats(next, u).maxHp;
        const dmg = Math.round(max * eff.hurtPct);
        p.hp = Math.max(1, (p.hp == null ? max : p.hp) - dmg);
        hits.push({ uid: p.uid, amount: dmg });
      });
      if (hits.length) push({ kind: 'hurt', targets: hits });
    }

    if (eff.maxHpPct) {
      (run.party || []).forEach((p) => {
        /* 本趟上限最低压到六成，避免反复交易把角色压成纸片 */
        const mod = (run.maxHpModifiers[p.uid] || 1) * (1 + eff.maxHpPct);
        run.maxHpModifiers[p.uid] = Math.max(0.6, mod);
        const unit = next.roster.find((x) => x.id === p.uid);
        if (!unit) return;
        const max = V.Roster.stats(next, unit).maxHp;
        if (p.hp != null) p.hp = Math.max(1, Math.min(p.hp, max));
      });
      push({ kind: 'maxHp', pct: eff.maxHpPct });
    }

    if (eff.stress) {
      (run.party || []).forEach((p) => {
        p.stress = Math.max(0, Math.min(100, (p.stress || 0) + eff.stress));
        const u = next.roster.find((x) => x.id === p.uid);
        if (u) u.stress = p.stress;
      });
      push({ kind: 'stress', amount: eff.stress });
    }

    return { packTouched };
  }

  /** 给界面用：每个选项是否可选、为什么不可选、收益摘要。 */
  function eventChoices(st) {
    const run = st.run;
    if (!run || !run.event) return [];
    const ev = D().event(run.event.eventId);
    return (ev.choices || []).map((c) => {
      const gate = eventGate(st, c.need);
      return { id: c.id, label: c.label, hint: c.hint || '', text: c.text || '', ok: gate.ok, reason: gate.reason || '', effects: choiceEffects(c), gamble: !!c.gamble, combat: !!c.combat, then: c.then || null };
    });
  }

  function chooseEvent(st, choiceId) {
    const run = st.run;
    if (!run || run.stage !== 'event' || !run.event) return ST().fail(st, 'bad_stage', '现在不在事件中');
    if (run.event.resolved) return ST().fail(st, 'resolved', '事件已经处理过');
    const ev = D().event(run.event.eventId);
    const choice = (ev.choices || []).find((c) => c.id === choiceId);
    if (!choice) return ST().fail(st, 'no_choice', '没有这个选项');
    const gate = eventGate(st, choice.need);
    if (!gate.ok) return ST().fail(st, 'need_not_met', gate.reason);

    let next = ST().clone(st);
    let r = next.run;
    r.event.resolved = true;
    r.event.depth = (r.event.depth || 0) + 1;
    r.event.branch = null;

    if (choice.combat) {
      r.event.pendingCombat = choice.combat.kind || 'normal';
      r.event.resultText = choice.text || '';
      /* 事件战斗也走检查点：先锁节点再生成 */
      const nodeId = r.activeNodeId;
      /* openForEvent 是本模块的函数，内部别绕 V.Encounter 去取 */
      const open = openForEvent(next, nodeId, choice.combat.kind || 'normal');
      if (!open.ok) return open;
      next = open.state;
      r = next.run;
      next.run.event = r.event;
      next.run.stage = 'battle';
      const cr = V.Combat.create(next, next.run.encounter.enemyBlueprint, next.run.encounter.combatRngStart);
      if (!cr.ok) return cr;
      const b = cr.state.run.battle;
      if (choice.text) {
        b.logSeq += 1;
        b.logs.push({ seq: b.logSeq, type: 'note', text: choice.text });
      }
      return ST().ok(cr.state, [{ type: 'eventCombat', meta: { kind: choice.combat.kind } }]);
    }

    /* 赌局：先掷一次，再按分支结算；文本用分支的，没写就退回选项的 */
    let branch = null;
    let text = choice.text || '';
    if (choice.gamble) {
      const win = rngChance(next, choice.gamble.chance);
      branch = win ? choice.gamble.win : choice.gamble.lose;
      r.event.branch = win ? 'win' : 'lose';
      if (branch && branch.text) text = branch.text;
    }

    const results = [];
    const base = applyEventEffects(next, choiceEffects(choice), results);
    let packTouched = base.packTouched;
    if (branch) {
      const extra = applyEventEffects(next, choiceEffects(branch), results);
      packTouched = packTouched || extra.packTouched;
    }

    if (packTouched) recordPackChange(st, next);

    /* 多段事件：把事件换成下一段，停在同一个阶段继续选 */
    if (choice.then && D().EVENTS[choice.then]) {
      next.run.event = { eventId: choice.then, resolved: false, resultText: '', pendingCombat: null, depth: r.event.depth, branch: null };
      next.run.stage = 'event';
      return ST().ok(next, [{ type: 'eventResolve', meta: { choiceId, results, chain: choice.then } }]);
    }

    next.run.event.resultText = text;
    next.run.stage = next.run.pendingLoot.length ? 'loot' : 'event';
    return ST().ok(next, [{ type: 'eventResolve', meta: { choiceId, results, branch: r.event.branch } }]);
  }

  /* ------------------------------ 祝福 ------------------------------ */

  function chooseBlessing(st, blessingId) {
    const run = st.run;
    if (!run || run.stage !== 'blessing') return ST().fail(st, 'bad_stage', '现在不能选祝福');
    if (!D().BLESSINGS[blessingId] || !run.blessingOptions?.includes(blessingId)) return ST().fail(st, 'no_blessing', '没有这个祝福');
    const next = ST().clone(st);
    next.run.blessings.push(blessingId);
    next.run.pendingAdvance = null;
    advance(next);
    return ST().ok(next, [{ type: 'blessing', meta: { blessingId } }]);
  }

  /* ------------------------------ 商人 ------------------------------ */

  function buy(st, offerId) {
    const run = st.run;
    if (!run || run.stage !== 'merchant' || !run.shop) return ST().fail(st, 'bad_stage', '现在不在商人处');
    const offer = run.shop.find((o) => o.id === offerId);
    if (!offer) return ST().fail(st, 'no_offer', '没有这个商品');
    if (offer.sold) return ST().fail(st, 'sold', '已经卖掉了');
    if (st.gold < offer.price) return ST().fail(st, 'no_gold', '金币不够');

    const next = ST().clone(st);
    const o = next.run.shop.find((x) => x.id === offerId);
    const part = next.itemsById[o.itemId];
    if (!canPack(next, 'part:' + part.id)) {
      return ST().fail(st, 'bag_full', '背包放不下，先处理待取舍的纹路');
    }
    next.gold -= o.price;
    o.sold = true;
    part.acquiredRunId = next.run.id;
    part.acquiredSeq = next.run.bag.length + 1;
    next.run.bag.push(part.id);
    /* 所有权从 merchant 转到 bag */
    recordPackChange(st, next);
    return ST().ok(next, [{ type: 'buy', meta: { offerId, price: o.price, itemId: part.id } }]);
  }

  /* ------------------------------ 掉落取舍 ------------------------------ */

  /** 战利谱占独立位置；只有活着正常撤离才能进藏品。事件里的拓本是必得的。 */
  function findFieldManuscript(st, source) {
    const run = st.run;
    if (run.fieldManuscript || (source === 'chest' && !rngChance(st, 1 / 3))) return;
    const pool = Object.values(D().MANUSCRIPTS).filter((m) => m.fieldSource
      && (source === 'event' || m.fieldSource === source) && m.fieldDepth <= run.floor);
    if (!pool.length) return;
    const owned = new Set([...(st.manuscriptVault || []), ...st.roster.flatMap(ST().manuscriptsOf)].map((m) => m.id));
    const missing = pool.filter((m) => !owned.has(m.id));
    const candidates = missing.length ? missing : pool;
    const spec = candidates[rngInt(st, 0, candidates.length - 1)];
    run.fieldManuscript = spec.id;
    ST().addLog(st, { kind: 'loot', text: `发现战利谱「${spec.name}」，正常撤离可带回。` });
  }

  /** 开箱时一次登记全部物资，两件纹路各自归待拾区所有。 */
  function stockChest(st, itemIds) {
    const run = st.run;
    for (const id of itemIds) {
      const part = st.itemsById[id];
      part.acquiredRunId = run.id;
      part.acquiredSeq = run.bag.length + run.pendingLoot.length + 1;
      run.pendingLoot.push(id);
    }
    ST().addLog(st, { kind: 'loot', text: '翻开箱盖，里面留着两件纹路和一些食材。' });
    const forageSeed = A.Random.seedFrom(`${run.rngState}:${run.floor}:${run.activeNodeId}`);
    V.Kitchen.addYield(run.ingredientLoot ||= {}, V.Kitchen.forageOptions(D().chapterAt(run.floor).region), forageSeed);
    findFieldManuscript(st, 'chest');
  }

  /** 只在读取已校验的旧档时调用。旧版是在选取纹路之后才生成食材并抽取拓本。 */
  function migrateChest(st) {
    const ids = st.run?.chestChoices;
    if (!ids) return;
    delete st.run.chestChoices;
    const last = st.logs.at(-1);
    if (last?.kind === 'loot' && last.text === '箱中有两件纹路，可以带走一件。') st.logs.pop();
    stockChest(st, ids);
  }

  function takeGroundServing(st, base) {
    const entry = stackSpec(base);
    if (st.run?.stage !== 'loot' || !entry || !(groundStock(st.run, entry)?.[entry.id] > 0)) {
      return ST().fail(st, 'no_ingredient', '地面上没有这一份物资');
    }
    const drop = autoDrop(st, base);
    if (!drop) return ST().fail(st, 'bag_full', '没有能装下这堆物资的空位');
    return takeLootAt(st, base, drop.to, 1);
  }
  function takeIngredient(st, id) { return takeGroundServing(st, 'food:' + id); }
  function takeMeal(st, id) { return takeGroundServing(st, 'meal:' + id); }

  function removeServing(st, base, token) {
    if (st.run && !PACK_STAGES.includes(st.run.stage)) return ST().fail(st, 'bad_stage', '当前只能查看行囊');
    const entry = stackSpec(base);
    const stacks = packStacks(st);
    const selected = token ?? Object.keys(stacks).filter(key => stackSpec(key)?.base === base).pop();
    if (!entry || !stacks[selected] || stackSpec(selected)?.base !== base) {
      return ST().fail(st, 'invalid_slot', '没有这一份物资');
    }
    const next = ST().clone(st);
    const owner = next.run || next;
    const stock = entry.kind === 'food' ? owner.ingredients : next.run ? owner.meals : owner.packedMeals;
    owner.packOrder = packSlots(st);
    if (--stacks[selected] === 0) delete stacks[selected];
    if (--stock[entry.id] === 0) delete stock[entry.id];
    owner.packStacks = stacks;
    owner.packOrder = packSlots(next);
    syncReserve(next);
    return ST().ok(next, [{ type: entry.kind === 'meal' ? 'mealRemoved' : 'ingredientDropped', meta: { id: entry.id } }]);
  }

  function dropIngredient(st, id) {
    if (!PACK_STAGES.includes(st.run?.stage) || typeof id !== 'string' || !Object.hasOwn(V.Kitchen.INGREDIENTS, id) || !(st.run.ingredients?.[id] > 0)) {
      return ST().fail(st, 'no_ingredient', '当前无法丢弃这份食材');
    }
    return removeServing(st, 'food:' + id);
  }

  function storeIngredients(st, quantities) {
    const pantry = (st.pantry ||= {});
    for (const [id, count] of Object.entries(quantities)) pantry[id] = (pantry[id] || 0) + count;
  }

  function clearUnclaimed(st) {
    const run = st.run;
    for (const id of run.pendingLoot) delete st.itemsById[id];
    for (const offer of run.shop || []) if (!offer.sold) delete st.itemsById[offer.itemId];
    run.pendingLoot = [];
    run.ingredientLoot = {};
    run.mealLoot = {};
    delete run.groundTurns;
    delete run.groundPositions;
    delete run.groundKnown;
    run.shop = null;
  }

  function resolveLoot(st, itemId, decision) {
    const run = st.run;
    if (!run || !run.pendingLoot.includes(itemId)) return ST().fail(st, 'no_pending', '没有这件待处理纹路');
    const next = ST().clone(st);
    const r = next.run;
    const part = next.itemsById[itemId];

    if (decision === 'discard') {
      r.pendingLoot = r.pendingLoot.filter((id) => id !== itemId);
      delete next.itemsById[itemId];
      return ST().ok(next, [{ type: 'lootDiscard', meta: { itemId } }]);
    }

    if (decision === 'take') {
      if (!canPack(next, 'part:' + part.id)) {
        return ST().fail(st, 'bag_full', '背包放不下，先选一件替换或丢弃');
      }
      r.pendingLoot = r.pendingLoot.filter((id) => id !== itemId);
      r.bag.push(itemId);
      (r.packTurns ||= {})['part:' + itemId] = itemTurn(st,'part:' + itemId,true);
      recordPackChange(st, next);
      return ST().ok(next, [{ type: 'lootTake', meta: { itemId } }]);
    }

    if (typeof decision === 'string' && decision.startsWith('replace:')) {
      const dropId = decision.slice('replace:'.length);
      if (!r.bag.includes(dropId)) return ST().fail(st, 'no_bag_item', '背包里没有这件纹路');
      r.packOrder = packSlots(st);
      r.bag = r.bag.filter((id) => id !== dropId);
      if (!canPack(next, 'part:' + itemId)) return ST().fail(st, 'bag_full', '换掉这件也放不下');
      delete next.itemsById[dropId];
      r.pendingLoot = r.pendingLoot.filter((id) => id !== itemId);
      r.bag.push(itemId);
      (r.packTurns ||= {})['part:' + itemId] = itemTurn(st,'part:' + itemId,true);
      recordPackChange(st, next);
      return ST().ok(next, [{ type: 'lootReplace', meta: { itemId, droppedId: dropId } }]);
    }

    return ST().fail(st, 'bad_decision', '未知取舍方式');
  }

  /* ------------------------------ 营火烙印 ------------------------------ */

  function inscribable(st, unitId) {
    const run = st.run;
    if (!run) return { ok: false, reason: '没有远征' };
    if (run.fieldInscribedUnitIds.includes(unitId)) return { ok: false, reason: '这名角色本局已经烙印过' };
    const hasNew = run.bag.some((id) => {
      const p = st.itemsById[id];
      return p && p.kind === 'circuit' && p.acquiredRunId === run.id;
    });
    if (!hasNew) return { ok: false, reason: '背包里没有本局获得的纹路' };
    return { ok: true };
  }

  /**
   * inscribe(st, unitId, itemId, proposedPlacements)
   * 原子提交：几何/负荷/输出全部合法 + 原件集合不减 + 新件确为本局所得。
   */
  /** 预览本次烙印留下的底层瘢痕，不改状态。@param {object} st @param {string} unitId @param {string} itemId @param {object[]} placements @returns {object|null} */
  function inscriptionScar(st, unitId, itemId, placements) {
    const unit = ST().unitById(st, unitId);
    const item = st.itemsById[itemId];
    if (!st.run || !unit || !item || !D().SCAR_EFFECTS[item.templateId]) return null;
    const old = new Set((unit.scars || []).map((s) => s.x + ',' + s.y));
    const cell = V.Circuit.layout(st, (placements || []).filter((p) => p.itemId === itemId)).cells
      .sort((a, b) => a.y - b.y || a.x - b.x).find((c) => !old.has(c.x + ',' + c.y));
    if (!cell || !V.Circuit.plateOf(unit).cells.has(cell.x + ',' + cell.y)) return null;
    return { x: cell.x, y: cell.y, templateId: item.templateId, source: D().template(item.templateId).name,
      runId: st.run.id, floor: st.run.floor };
  }

  function inscribe(st, unitId, itemId, proposedPlacements) {
    const run = st.run;
    if (!run) return ST().fail(st, 'no_run', '没有远征');
    if (run.stage !== 'camp') return ST().fail(st, 'bad_stage', '只有在营火才能现场烙印');
    const unit = st.roster.find((u) => u.id === unitId);
    if (!unit) return ST().fail(st, 'no_unit', '找不到角色');

    const gate = inscribable(st, unitId);
    if (!gate.ok) return ST().fail(st, 'cannot_inscribe', gate.reason);

    const newPart = st.itemsById[itemId];
    if (!newPart) return ST().fail(st, 'no_item', '找不到纹路');
    if (newPart.kind !== 'circuit') return ST().fail(st, 'bad_item', '只能烙印回路纹路');
    if (newPart.acquiredRunId !== run.id || !run.bag.includes(itemId)) {
      return ST().fail(st, 'not_this_run', '只能使用本局获得、且还在背包里的纹路');
    }

    const base = (run.fieldLayouts[unitId]) ? run.fieldLayouts[unitId] : unit.board.placements;
    const baseItemIds = base.map((p) => p.itemId);
    const proposedIds = (proposedPlacements || []).map((p) => p.itemId);

    /* 原件集合不能减少，新件恰好一次 */
    for (const id of baseItemIds) {
      if (!proposedIds.includes(id)) return ST().fail(st, 'missing_original', '原纹路不能在烙印中丢掉');
    }
    const newCount = proposedIds.filter((id) => id === itemId).length;
    if (newCount !== 1) return ST().fail(st, 'new_item_count', '新纹路必须恰好放置一次');
    const extra = proposedIds.filter((id) => id !== itemId && !baseItemIds.includes(id));
    if (extra.length) return ST().fail(st, 'extra_items', '只能添加一件本局新纹路');

    /* 只校验几何与负荷：和 saveLoadout 一致，半成品板面也能烙印。
       连通与否是玩法结果（覆盖率面板会提示），不是交易条件。 */
    const pv = V.Circuit.preview(st, unitId, proposedPlacements);
    if (!pv.ok) return ST().fail(st, 'bad_geometry', pv.errors.join('；'), { details: pv.errors });

    const next = ST().clone(st);
    const r = next.run;
    const u2 = next.roster.find((x) => x.id === unitId);

    /* 代价：本局最大生命 ×0.8，当前 HP 等比，压力 +40。
       先取“烙印前”的数值，否则会把自己算进去再乘一次。 */
    const mult = D().DESIGN.fieldInscribe.maxHpMult;
    const p = r.party.find((x) => x.uid === unitId);
    const maxHpBefore = V.Roster.stats(next, u2).maxHp;
    r.maxHpModifiers[unitId] = (r.maxHpModifiers[unitId] || 1) * mult;
    if (p) {
      const cur = p.hp == null ? maxHpBefore : p.hp;
      p.hp = Math.max(1, Math.round(cur * mult));
      p.stress = Math.min(100, (p.stress || 0) + D().DESIGN.fieldInscribe.stress);
      u2.stress = p.stress;
    }

    /* 归属：新件从 bag 移出，变成 provisional；临时板面只在本局有效 */
    r.bag = r.bag.filter((id) => id !== itemId);
    r.provisionalBindings.push({ unitId, itemId, placement: null });
    r.fieldLayouts[unitId] = (proposedPlacements || []).map((x) => ({
      itemId: x.itemId, x: x.x, y: x.y, rotation: x.rotation || 0, mirrorY: !!x.mirrorY,
    }));
    const binding = r.provisionalBindings.find((b) => b.itemId === itemId);
    if (binding) {
      const pl = r.fieldLayouts[unitId].find((x) => x.itemId === itemId);
      binding.placement = pl ? { ...pl } : null;
    }
    if (!r.fieldInscribedUnitIds.includes(unitId)) r.fieldInscribedUnitIds.push(unitId);
    const scar = inscriptionScar(st, unitId, itemId, proposedPlacements);
    if (scar) (u2.scars ||= []).push(scar);
    if (p) {
      const after = V.Roster.stats(next, u2).maxHp;
      const beforeHp = st.run.party.find((x) => x.uid === unitId).hp ?? maxHpBefore;
      p.hp = Math.max(1, Math.min(after, Math.round(beforeHp * after / maxHpBefore)));
    }

    ST().addLog(next, { kind: 'sys', text: `${u2.name} 烙入「${D().template(next.itemsById[itemId].templateId).name}」${scar ? `，在第 ${scar.y + 1} 行第 ${scar.x + 1} 格留下瘢痕` : ''}。` });
    recordPackChange(st, next);
    return ST().ok(next, [{ type: 'fieldInscribe', meta: { unitId, itemId, scar } }]);
  }

  /** 营火休息：恢复生命，压力下降。 */
  function campRest(st) {
    const run = st.run;
    if (!run || run.stage !== 'camp') return ST().fail(st, 'bad_stage', '现在不在营火');
    if (run.campRested) return ST().fail(st, 'already_rested', '这处营火已经休息过了');
    const next = ST().clone(st);
    next.run.campRested = true;
    next.run.party.forEach((p) => {
      const u = next.roster.find((x) => x.id === p.uid);
      const s = V.Roster.stats(next, u);
      const cur = p.hp == null ? s.maxHp : p.hp;
      p.hp = Math.min(s.maxHp, cur + Math.round(s.maxHp * 0.45));
      p.stress = Math.max(0, (p.stress || 0) - 30);
      u.stress = p.stress;
    });
    return ST().ok(next, [{ type: 'campRest' }]);
  }

  /* ------------------------------ 完成节点 ------------------------------ */

  function finishNode(st, leaveLoot = false) {
    const run = st.run;
    if (!run) return ST().fail(st, 'no_run', '没有远征');
    if (!['loot','event','camp','merchant'].includes(run.stage)) {
      return ST().fail(st, 'bad_stage', '这个阶段还没处理完');
    }
    if (run.stage === 'event' && run.event && !run.event.resolved) {
      return ST().fail(st, 'bad_stage', '事件还没选');
    }
    if (run.pendingLoot.length && !(leaveLoot && run.stage === 'loot')) return ST().fail(st, 'pending_loot', '还有待取舍的纹路没处理');

    const next = ST().clone(st);
    const r = next.run;

    let finishedType = null;
    const activeId = r.activeNodeId || r.lockedNodeId;
    if (activeId) {
      const node = r.nodes.find((n) => n.id === activeId);
      if (node && !node.consumed) {
        node.consumed = true;
        finishedType = node.type;
        r.completedNodeIds.push(node.id);
        /* 章末只有打倒首领才算完成节点 */
        if (D().chapterAt(r.floor).step !== 7 || finishedType === 'boss') {
          r.completedFloors = Math.max(r.completedFloors, r.floor);
          if (!r.finishedFloors.includes(r.floor)) r.finishedFloors.push(r.floor);
        }
      }
    }
    r.activeNodeId = null;
    delete r.campRested;
    r.event = null;
    clearUnclaimed(next);
    r.encounter = null;
    r.lockedNodeId = null;

    /* 旧档可以先搜刮章末的支路，守关者仍在原处 */
    if (D().chapterAt(r.floor).step === 7) {
      if (finishedType !== 'boss') {
        r.stage = 'map';
        const left = r.nodes.filter((n) => !n.consumed);
        if (left.length && left.some((n) => n.type === 'boss')) {
          return ST().ok(next, [{ type: 'nodeFinished', meta: { floor: r.floor, needBoss: true } }]);
        }
      }
      if (r.floor === D().DESIGN.maxFloor) return extract(next, true);
    }

    r.pendingAdvance = { from: r.floor };

    /* 每层祝福：2/4/6 层，每层一次 */
    const availableBlessings = D().BLESSING_ORDER.filter(id => !r.blessings.includes(id));
    if (availableBlessings.length && D().DESIGN.blessingFloors.includes(r.floor) && !r.blessingFloorsTaken.includes(r.floor)) {
      r.blessingFloorsTaken.push(r.floor);
      r.stage = 'blessing';
      r.blessingOptions = rngShuffle(next, availableBlessings).slice(0, 3);
      return ST().ok(next, [{ type: 'blessingOffer', meta: { options: r.blessingOptions } }]);
    }

    advance(next);
    return ST().ok(next, [{ type: 'nodeFinished', meta: { floor: r.floor } }]);
  }

  /** 推进到下一层：层间喘息、重置阶段、生成新节点。 */
  function advance(st) {
    const r = st.run;
    if (!r) return st;
    const finished = r.floor;
    if (finished >= D().DESIGN.maxFloor) return st;

    r.party.forEach((p) => {
      const u = st.roster.find((x) => x.id === p.uid);
      if (!u) return;
      const s2 = V.Roster.stats(st, u);
      const cur = p.hp == null ? s2.maxHp : p.hp;
      /* 层间基础回复；「缝补」祝福只在这一步额外叠加一次 */
      const mend = (r.blessings || []).includes('mend') ? (D().BLESSINGS.mend.effect.floorHeal || 0) : 0;
      p.hp = Math.min(s2.maxHp, cur + Math.round(s2.maxHp * (D().DESIGN.floorRecovery + mend)));
    });

    if (finished % 7 === 0) delete r.chapterEvents;
    r.floor = finished + 1;
    r.stage = 'map';
    r.pendingAdvance = null;
    r.blessingOptions = null;
    genNodes(st);
    ST().addLog(st, { kind: 'sys', text: `${D().chapterLabel(r.floor)}。${r.nodes.map((n) => n.name).join('、')}。` });
    return st;
  }

  /* ------------------------------ 结算事务 ------------------------------ */

  function returnMeals(st, meals) {
    st.packedMeals = { ...meals };
    const order = (st.run.packOrder || []).map(token => stackSpec(token)?.kind === 'meal' ? token : null);
    const stacks = Object.fromEntries(Object.entries(st.run.packStacks || {}).filter(([token]) => stackSpec(token)?.kind === 'meal'));
    st.run = null;
    st.packOrder = order;
    st.packStacks = stacks;
    st.packOrder = packSlots(st);
    st.packStacks = packStacks(st);
  }

  /** 固化临时板面与新件归属，写战史，清 run。 */
  function commitSettlement(st, kind, extra) {
    const next = ST().clone(st);
    const r = next.run;
    const gained = { items: [], gold: r.goldFound, shards: r.shards };

    /* ① 临时板面固化 + provisional 转永久 */
    Object.keys(r.fieldLayouts || {}).forEach((unitId) => {
      const u = next.roster.find((x) => x.id === unitId);
      if (!u) return;
      u.board.placements = r.fieldLayouts[unitId].map((x) => ({
        itemId: x.itemId, x: x.x, y: x.y, rotation: x.rotation || 0, mirrorY: !!x.mirrorY,
      }));
    });

    /* ② bag 入仓 */
    r.bag.forEach((id) => {
      const p = next.itemsById[id];
      if (!p) return;
      if (!next.stash.includes(id)) next.stash.push(id);
      gained.items.push(id);
    });

    /* ③ 货币 */
    next.gold += Math.round(r.goldFound);
    next.shards += r.shards;

    /* ④ 清本局 maxHp 修正、回营满血；保留已确认压力 */
    next.roster.forEach((u) => {
      if (r.maxHpModifiers && r.maxHpModifiers[u.id]) {
        /* 修正只在本局有效，回营后移除 */
        delete r.maxHpModifiers[u.id];
      }
      u.hp = null;
    });

    /* ⑤ 战史 / 合格撤离 / 调谐 */
    const record = V.Roster.recordExtraction(next, {
      runId: r.id,
      kind,
      depth: r.completedFloors,
      floors: r.finishedFloors.slice(),
      party: r.party.map((p) => p.uid),
      usedManuscripts: r.party.map((p) => {
        const u = next.roster.find((x) => x.id === p.uid);
        return { uid: p.uid, manuscriptIds: ST().manuscriptsOf(u).map(ms => ms.id) };
      }),
    });

    next.bestDepth = Math.max(next.bestDepth, r.completedFloors);
    if (record.eligible) next.stats.extracts = (next.stats.extracts || 0) + 1;
    if (kind === 'clear') next.stats.wins = (next.stats.wins || 0) + 1;

    /* 战利谱随正常撤离带回；阶位谱另按合格撤离深度结算。 */
    const carried = D().manuscript(r.fieldManuscript);
    if (carried) (next.manuscriptVault ||= []).push(ST().clone(carried));
    let droppedMs = null;
    const grantable = record.eligible || kind === 'clear';
    if (grantable) {
      const tier = D().rewardTier(r.completedFloors);
      const spec = D().manuscriptReward(next, tier);
      if (spec && spec.id !== carried?.id) {
        droppedMs = JSON.parse(JSON.stringify(spec));
        next.manuscriptVault = next.manuscriptVault || [];
        next.manuscriptVault.push(droppedMs);
      }
    }

    const ingredients = Object.fromEntries(Object.entries(r.ingredients || {}).filter(([, count]) => count > 0));
    storeIngredients(next, ingredients);
    const meals = { ...r.meals };
    next.settlement = {
      mode: kind,
      meals, ingredients,
      ...(carried ? { fieldManuscript: carried.id } : {}),
      manuscript: droppedMs ? { id: droppedMs.id, name: droppedMs.name, rarity: droppedMs.rarity } : null,
      title: kind === 'clear' ? '回廊尽头' : '成功撤离',
      depth: r.completedFloors,
      gold: gained.gold,
      shards: gained.shards,
      items: gained.items,
      eligible: record.eligible,
      reason: record.reason,
      records: record.records || [],
    };

    clearUnclaimed(next);
    returnMeals(next, meals);
    return next;
  }

  /** 正常撤离（第七章通关也走这里，同一条幂等事务）。 */
  function extract(st, clear) {
    const r = st.run;
    if (!r) return ST().fail(st, 'no_run', '没有远征');
    if (!clear && !['map','blessing'].includes(r.stage)) return ST().fail(st, 'bad_stage', '只能在选择节点时撤离');
    if (!clear && r.pendingLoot.length) return ST().fail(st, 'pending_loot', '还有待取舍的纹路');
    const next = commitSettlement(st, clear ? 'clear' : 'extract');
    return ST().ok(next, [{ type: 'settlement', meta: next.settlement }]);
  }

  /** 撤退代价预览（不写 state）。 */
  function previewRetreat(st, mode) {
    const r = st.run;
    if (!r) return { ok: false, reason: '没有远征' };
    const keepRatio = mode === 'emergency' ? D().DESIGN.emergency.keepRatio : 0;
    const newParts = collectNewParts(st).sort((a, b) => a.seq - b.seq);
    const keepCount = Math.ceil(newParts.length * keepRatio);
    function keepServings(stock) {
      const kept = {};
      let remaining = Math.ceil(Object.values(stock).reduce((sum, n) => sum + n, 0) * keepRatio);
      for (const id of Object.keys(stock).sort()) {
        const count = Math.min(remaining, stock[id]);
        if (count) kept[id] = count;
        remaining -= count;
        if (!remaining) break;
      }
      return kept;
    }
    const ingredients = keepServings(r.ingredients || {});
    const meals = keepServings(r.meals || {});
    const kept = newParts.slice(0, keepCount);
    const lost = newParts.slice(keepCount);

    const cp = r.encounter && r.encounter.checkpoint;
    const entranceStress = {};
    if (cp && cp.run) cp.run.party.forEach((p) => { entranceStress[p.uid] = p.stress || 0; });

    return {
      ok: true,
      mode,
      ingredients, meals,
      keepParts: kept.map((x) => x.id),
      lostParts: lost.map((x) => x.id),
      gold: Math.floor(r.goldFound * (mode === 'emergency' ? 0.5 : 0)),
      shards: mode === 'emergency' ? Math.floor(r.shards * 0.5) + r.completedFloors : 0,
      stress: mode === 'emergency' ? D().DESIGN.emergency.stress : D().DESIGN.defeat.stress,
      entranceStress,
      completedFloors: r.completedFloors,
    };
  }

  function collectNewParts(st) {
    const r = st.run;
    const out = [];
    const push = (id) => {
      const p = st.itemsById[id];
      if (p && p.acquiredRunId === r.id) out.push({ id, seq: p.acquiredSeq || 0 });
    };
    r.bag.forEach(push);
    r.provisionalBindings.forEach((b) => push(b.itemId));
    return out;
  }

  /**
   * 撤退：紧急保留一半新件，确认败退全失；两者都恢复入场装配、回营满血。
   */
  function retreat(st, mode) {
    const r = st.run;
    if (!r) return ST().fail(st, 'no_run', '没有远征');
    const preview = previewRetreat(st, mode);
    const next = ST().clone(st);
    const run = next.run;

    /* ① 恢复入场装配：永久板面、主手、指令 */
    Object.entries(run.startLoadouts || {}).forEach(([uid, load]) => {
      const u = next.roster.find((x) => x.id === uid);
      if (!u) return;
      /* 武器槽已移除 */
      u.board = ST().clone(load.board);
      u.gambits = ST().clone(load.gambits);
    });
    /* 临时板面与绑定全部丢弃 */
    run.fieldLayouts = {};
    run.provisionalBindings = [];

    /* ② 丢弃未保留的新件（含临时绑定与背包） */
    preview.lostParts.forEach((id) => { delete next.itemsById[id]; });
    /* 保留的新件进仓库 */
    preview.keepParts.forEach((id) => {
      if (!next.itemsById[id]) return;
      if (!next.stash.includes(id)) next.stash.push(id);
    });
    run.bag = [];

    /* ③ 货币 */
    next.gold += preview.gold;
    next.shards += preview.shards;

    /* ④ 压力与生命 */
    const cp = run.encounter && run.encounter.checkpoint;
    const entrance = {};
    if (cp && cp.run) cp.run.party.forEach((p) => { entrance[p.uid] = p.stress || 0; });
    run.party.forEach((p) => {
      const u = next.roster.find((x) => x.id === p.uid);
      const base = entrance[p.uid] != null ? entrance[p.uid] : (p.stress || 0);
      const stress = Math.min(100, base + preview.stress);
      if (u) {
        u.stress = stress;
        u.hp = null;
      }
    });
    next.roster.forEach((u) => { u.hp = null; });

    /* ⑤ 不记合格撤离 */
    V.Roster.recordExtraction(next, {
      runId: run.id,
      kind: mode === 'emergency' ? 'emergency' : 'defeat',
      depth: run.completedFloors,
      floors: [],
      party: run.party.map((p) => p.uid),
      usedWeapons: [],
      ineligible: true,
    });

    next.bestDepth = Math.max(next.bestDepth, run.completedFloors);
    storeIngredients(next, preview.ingredients);
    next.settlement = {
      mode,
      ingredients: preview.ingredients, meals: preview.meals,
      title: mode === 'emergency' ? '紧急撤退' : '确认败退',
      depth: run.completedFloors,
      gold: preview.gold,
      shards: preview.shards,
      items: preview.keepParts,
      lostItems: preview.lostParts,
      eligible: false,
      reason: mode === 'emergency' ? '紧急撤退不算合格撤离' : '败退不算合格撤离',
      stress: preview.stress,
    };

    clearUnclaimed(next);
    returnMeals(next, preview.meals);
    return ST().ok(next, [{ type: 'retreat', meta: next.settlement }]);
  }

  /* 事件触发的战斗：也必须有检查点（用同一套 open 逻辑，但节点类型由事件决定） */
  function openForEvent(st, nodeId, kind) {
    const next = ST().clone(st);
    const node = (next.run.nodes || []).find((n) => n.id === nodeId) || {
      id: nodeId, type: 'event',
    };
    const savedType = node.type;
    node.type = kind === 'boss' ? 'boss' : kind === 'elite' ? 'elite' : 'battle';
    const r = V.Encounter.open(next, nodeId);
    node.type = savedType;
    return r;
  }

  V.Expedition = {
    start, chooseNode, chooseEvent, eventChoices, eventGate, chooseBlessing, buy, resolveLoot,
    migrateChest, takeIngredient, takeMeal, putOnGround, dropIngredient, findFieldManuscript, inscribe, inscriptionScar, inscribable, campRest, finishNode, extract, retreat, previewRetreat,
    openForEvent, advance, commitSettlement, collectNewParts,
    STORE_UPGRADES, storeLayout, arrangeStore, PACK_UPGRADES, upgradePack, bagCapacity, bagUsed, bagFree, packSlots, packOverflow, foodPack, mealPack, stackSpec, removeServing, recordPackChange, itemTurn, turnedPackDrop, turnPack, packShape, stackCount, canPack, previewLootDrop, takeLootAt, movePack, sortPack, discardPack, genNodes, rngInt, rngShuffle, rngChance,
  };
})(globalThis.Ashen ||= {});
