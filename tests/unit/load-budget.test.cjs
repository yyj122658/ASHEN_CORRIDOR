'use strict';
/* 负荷预算（2026-11-15 重构）。
   背景：77 格 × 0.57 = 44 点，而装满 4 门功法加纹路只要 18~22 点——
   于是「超载转裂纹」在正常局内永远触发不了，负荷系统整条空转。
   这次把异形板面压到 20 点、删掉负荷返利、并把营火瘢痕接进减免闭环。

   这一组测试守四件事：
   ① 两套板面两套系数，别合回一个数；
   ② 负荷不再返利（manuscriptState 与 Stats.resonance 口径一致）；
   ③ 激活的永久瘢痕按处减免维持负荷，扣到 0 为止，不产生负负荷；
   ④ 超载真的落到开局压力与回裕上，且回裕有 0.1s 保底。 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;

function fresh(seed) { return V.State.create(seed == null ? 101 : seed); }

/** 异形板面不是矩形：找一个能完整放下这件纹路的落点 */
function fitOffset(plate, templateId, used) {
  const tf = V.Circuit.transformTemplate(D.TEMPLATES[templateId], 0, false);
  for (let y = 0; y < plate.size; y++) {
    for (let x = 0; x < plate.size; x++) {
      const keys = tf.cells.map((c) => (c.x + x) + ',' + (c.y + y));
      if (!keys.every((k) => plate.cells.has(k))) continue;
      if (used && keys.some((k) => used.has(k))) continue;
      return { x, y, keys };
    }
  }
  return null;
}

/** 造纹路并摆上：和 UI 走同一条 makePart 路径 */
function place(st, u, templateId, count) {
  const plate = V.Circuit.plateOf(u);
  const used = new Set();
  const out = [];
  for (let i = 0; i < (count || 1); i++) {
    const at = fitOffset(plate, templateId, used);
    if (!at) break; /* 摆不下了就停，调用方按实际件数断言 */
    at.keys.forEach((k) => used.add(k));
    const item = V.State.makePart(st, { kind: 'circuit', templateId });
    st.itemsById[item.id] = item;
    if (!st.stash.includes(item.id)) st.stash.push(item.id);
    out.push({ itemId: item.id, x: at.x, y: at.y, rotation: 0, mirrorY: false });
  }
  return out;
}

/** 某件纹路实际覆盖的绝对格 */
function cellsOf(placement) {
  const tf = V.Circuit.transformTemplate(D.TEMPLATES[placement.templateId || 'capacitor'], 0, false);
  return tf.cells.map((c) => ({ x: c.x + placement.x, y: c.y + placement.y }));
}

test('异形板面 77 格 → 55 点，经典夹具 14 格 → 8 点，两套系数不许合并', () => {
  const st = fresh(201);
  /* 挑一个非「厚铸躯壳」的单位：无相包容会把负荷上限 ×1.35，那是相性的账 */
  const u = st.roster.find((x) => D.body(x.bodyPreset).innate.id !== 'sturdy') || st.roster[0];
  assert.notEqual(D.body(u.bodyPreset).innate.id, 'sturdy');
  const cells = V.Circuit.plateOf(u).cells.size;
  assert.equal(cells, 77);
  /* 六标：蚀刻法骨架扩到 6~54 格，0.26（20 点）压不满任何一门大卷 ——
     系数抬到 0.72，77 格 = 55 点，正好对上「满配有效占格 ~55」。 */
  assert.equal(V.Circuit.loadCap(u), 55, '77 格该压到 55 点');
  assert.equal(D.DESIGN.generatedCapPerCell, 0.72);
  assert.equal(Math.round(77 * D.DESIGN.generatedCapPerCell), 55);

  const classic = V.State.create(201, { classicPlate: true });
  const cu = classic.roster.find((x) => D.body(x.bodyPreset).innate.id !== 'sturdy');
  assert.equal(V.Circuit.loadCap(cu), 8, '夹具沿用旧值，别把尺子也改了');

  /* 压系数要真的能压上限：这条同时保证 loadCap 没把系数写死 */
  const perCell = D.DESIGN.generatedCapPerCell;
  D.DESIGN.generatedCapPerCell = 0.05;
  try {
    assert.ok(V.Circuit.loadCap(u) < 20, '压过系数后上限应更低');
    assert.equal(V.Circuit.loadCap(cu), 8, '改异形系数不该影响夹具');
  } finally { D.DESIGN.generatedCapPerCell = perCell; }
});

test('负荷不再返利：共鸣阶乘算只吃共鸣阶与贯通', () => {
  const st = fresh(202);
  const u = st.roster[0];
  V.State.equipManuscript(st, u, 'corridor5');
  const ms = V.Circuit.manuscriptState(st, u.id);
  assert.ok(ms.ok, JSON.stringify(ms));
  assert.equal(ms.effects.loadBonus, 1, 'loadBonus 必须恒为 1——负荷是代价，不是价格');

  /* 自己按「共鸣阶 × 贯通」重算一遍：多一分就是又夹了负荷价 */
  const spec = D.manuscript('corridor5');
  const tier = spec.tiers.filter((t) => ms.pct >= t.at).pop() || null;
  const tierMult = (tier && tier.effect.mainMult) || 1;
  const expected = Math.round(Math.round(tierMult * (ms.routed ? V.Circuit.ROUTE_MULT : 1) * 100) / 100 * 100) / 100;
  assert.equal(ms.effects.mainMult, expected, `乘算里不许再夹一段负荷加成（${ms.pct}%）`);

  /* 界面口径同步：Stats.resonance 不能显示一行结算里没有的「负荷 ×1.03」 */
  const r = V.Stats.resonance({
    cov: { tier: tier || { name: '', effect: { mainMult: 1 } } },
    rt: { ok: !!ms.routed },
    spec: { load: spec.load },
  });
  assert.ok(!r.parts.some((x) => x.includes('负荷')), `界面不该再提负荷价：${r.parts.join(' / ')}`);
  assert.equal(r.total, expected);
});

test('激活的永久瘢痕按处减免维持负荷：一处 1 点，扣到 0 为止', () => {
  const st = fresh(203);
  const u = st.roster[0];
  assert.equal(D.TEMPLATES.capacitor.load, 2, 'capacitor：4 格、负荷 2');
  const draft = place(st, u, 'capacitor', 1);
  const base = V.Circuit.preview(st, u.id, draft);
  assert.ok(base.ok, base.errors.join(' '));
  /* 起始角色自带 spark（负荷 1），所以总量是 1 + 2；下面一律比差值，不写死绝对值 */
  assert.equal(base.load, V.Circuit.preview(st, u.id, []).load + 2);
  assert.equal(base.scarSaved, 0, '没有瘢痕就没有减免');

  const cells = cellsOf(draft[0]);
  /* 一处瘢痕落在纹路格上 → -1 */
  u.scars = [{ x: cells[0].x, y: cells[0].y, templateId: 'capacitor', source: '蓄纹', floor: 1, runId: 'r1' }];
  const one = V.Circuit.preview(st, u.id, draft);
  assert.equal(one.load, base.load - 1, '一处激活瘢痕减 1 点');
  assert.equal(one.scarSaved, 1);

  /* 两处 → -2，正好扣到 0 */
  u.scars.push({ x: cells[3].x, y: cells[3].y, templateId: 'capacitor', source: '蓄纹', floor: 1, runId: 'r2' });
  const two = V.Circuit.preview(st, u.id, draft);
  assert.equal(two.load, base.load - 2, '两处减 2 点，这件纹路的负荷被扣到 0');
  assert.equal(two.scarSaved, 2);

  /* 第三处 → 这件纹路已经减到 0，不再减，总负荷也不能变成负数 */
  u.scars.push({ x: cells[1].x, y: cells[1].y, templateId: 'capacitor', source: '蓄纹', floor: 1, runId: 'r3' });
  const three = V.Circuit.preview(st, u.id, draft);
  assert.equal(three.load, base.load - 2, '单件纹路最多减到 0，不会倒贴');
  assert.ok(three.load >= 0, '负荷不能是负数');
  assert.equal(three.overload, 0, '更不该因此算出超载');

  /* 瘢痕在别处（没被任何纹路压住）→ 不减免 */
  const covered = new Set(cells.map((c) => c.x + ',' + c.y));
  /* 「休眠的瘢痕」必须既不被纹路压住、也不落在蚀刻法骨架上：
     骨架扩到 6 格以上之后，随便挑一个空格很容易正好落在膜里，那样它当然是激活的。 */
  const msCellSet = new Set(V.State.manuscriptCells(V.State.manuscriptsOf(u)[0]).map((c) => c.join(',')));
  const idleKey = [...V.Circuit.plateOf(u).cells].find((k) => !covered.has(k) && !msCellSet.has(k));
  const [ix, iy] = idleKey.split(',').map(Number);
  u.scars = [{ x: ix, y: iy, templateId: 'capacitor', source: '蓄纹', floor: 1, runId: 'r4' }];
  const idle = V.Circuit.preview(st, u.id, draft);
  assert.equal(idle.load, base.load, '未被压住的瘢痕是休眠的，不减负荷');
  assert.equal(V.Circuit.scarState(st, u, draft)[0].active, false);

  /* 减免只挂在纹路上：蚀刻法不吃这份账（它本来就是蚀刻法，不是肉身之纹） */
  const withMs = fresh(204);
  const u2 = withMs.roster[0];
  V.State.equipManuscript(withMs, u2, 'spark');
  const msOnly = V.Circuit.preview(withMs, u2.id, []);
  const spec = V.State.manuscriptsOf(u2)[0];
  assert.ok(spec, 'spark 该能装上');
  const msCells = V.State.manuscriptCells(spec);
  u2.scars = [{ x: msCells[0][0], y: msCells[0][1], templateId: 'straight', source: '顺丝纹', floor: 1, runId: 'r5' }];
  const msScarred = V.Circuit.preview(withMs, u2.id, []);
  assert.equal(msScarred.load, msOnly.load, '瘢痕压在蚀刻法格上也不减它的负荷');
});

test('超载落到开局压力与回裕上：每点 +8 压力 / −0.04 回裕', () => {
  const perCell = D.DESIGN.generatedCapPerCell;
  /* buildAlly 要读 st.run（临时板面与生命上限修正都挂在那儿），这里给一个最小的 run 壳 */
  const withRun = (st) => {
    if (!st.run) st.run = { fieldLayouts: {}, party: [], maxHpModifiers: {} };
    return st;
  };

  /* ① 正常上限下摆够东西也不超载 */
  const st = withRun(fresh(205));
  const u = st.roster[0];
  const draft = place(st, u, 'cross', 2);
  assert.equal(draft.length, 2, '两件 cross 该放得下');
  u.board.placements = draft;
  const empty = V.Circuit.preview(st, u.id, []).load;
  const normal = V.Circuit.preview(st, u.id, draft);
  assert.ok(normal.ok, normal.errors.join(' '));
  assert.equal(normal.load, empty + 6, '两件 cross 共 6 点');
  assert.equal(normal.overload, 0);

  const entry = { uid: u.id, slot: 0, hp: null, stress: 0 };
  const before = V.Combat._internal.buildAlly(st, entry, u);
  assert.equal(before.stress, 0, '没超载就没有开局压力');
  assert.equal(before.overloadPenalty, 0, '没超载就没有回裕罚项');

  D.DESIGN.generatedCapPerCell = 0.01; /* 上限压到 1，必然超载 */
  try {
    /* ② 每超 1 点：开局压力 +8、回裕 −0.04/s */
    const pv = V.Circuit.preview(st, u.id, draft);
    assert.ok(pv.overload > 0, `应能算出超载（load ${pv.load} / cap ${pv.cap}）`);
    const over = V.Combat._internal.buildAlly(st, entry, u);
    assert.equal(over.stress, Math.min(100, pv.overload * 8), '超载要变成开局压力');
    assert.equal(over.overloadPenalty, Math.round(pv.overload * 0.04 * 1000) / 1000,
      '每超载 1 点，回裕罚项 0.04');
    const drop = Math.round((before.regen - over.regen) * 1000) / 1000;
    assert.equal(drop, Math.round(pv.overload * 0.04 * 1000) / 1000, '账面回裕要扣掉罚项');

    /* ③ 塞到极限：回裕不能被扣成 0 或负数，那是「不能玩」不是「过用则裂」。
       这里把罚项系数临时加大，才踩得到保底线（正常 0.04 下 24 点超载只扣 0.96）。 */
    const heavy = withRun(fresh(206));
    const hu = heavy.roster[0];
    const heavyDraft = place(heavy, hu, 'cross', 8);
    assert.ok(heavyDraft.length >= 6, `要能摆下足够多的纹路才压得到保底线，实际 ${heavyDraft.length}`);
    hu.board.placements = heavyDraft;
    const hpv = V.Circuit.preview(heavy, hu.id, heavyDraft);
    const cfg = D.DESIGN.overload;
    D.DESIGN.overload = { ...cfg, regenPerPoint: 0.4 };
    try {
      const hally = V.Combat._internal.buildAlly(heavy, { uid: hu.id, slot: 0, hp: null, stress: 0 }, hu);
      assert.ok(hpv.overload > 0, `要真的超载（overload ${hpv.overload}）`);
      assert.equal(hally.regen, 0.1, '回裕保底 0.1/s');
      assert.equal(hally.stress, 100, '压力封顶 100，不会溢出');
    } finally { D.DESIGN.overload = cfg; }
  } finally { D.DESIGN.generatedCapPerCell = perCell; }
});

test('高热：压力 ≥50 时免掉超载罚项，但压力的档位乘算与裂的抛光惩罚照旧', () => {
  const perCell = D.DESIGN.generatedCapPerCell;
  const st = fresh(207);
  if (!st.run) st.run = { fieldLayouts: {}, party: [], maxHpModifiers: {} };
  const u = st.roster[0];
  /* 塞到超载 8~10 点：既听得出罚项，又不至于把压力顶到 100 而先触发裂 */
  const draft = place(st, u, 'cross', 3);
  u.board.placements = draft;
  D.DESIGN.generatedCapPerCell = 0.05; /* 77×0.05 ≈ 4 点上限 */
  try {
    const pv = V.Circuit.preview(st, u.id, draft);
    assert.ok(pv.overload >= 4, `要真超载（overload ${pv.overload}）`);
    const ally = V.Combat._internal.buildAlly(st, { uid: u.id, slot: 0, hp: null, stress: 0 }, u);
    const penalty = ally.overloadPenalty;
    assert.ok(penalty > 0.1, `罚项要够大才看得出差别（${penalty}）`);
    const raw = ally.regenBase;

    /* 冷：压力 <50，罚项照扣 */
    const cold = { ...ally, stress: 30 };
    assert.equal(V.Combat.heatConducting(cold), false, '压力 30 不算导通');
    assert.equal(round3(V.Combat.energyRegen(cold)), round3(Math.max(0.1, raw - penalty)));

    /* 热：压力 ≥50，罚项免掉——但仍要乘 0.85 的高压档 */
    const warm = { ...ally, stress: 60 };
    assert.equal(V.Combat.heatConducting(warm), true, '压力 60 算导通');
    assert.equal(round3(V.Combat.energyRegen(warm)), round3(raw * 0.85),
      '导通只退超载那一笔，0.85 的档位乘算不许一起免');

    /* 更热：80 起是 0.65，依旧照乘 */
    const hot = { ...ally, stress: 85 };
    assert.equal(round3(V.Combat.energyRegen(hot)), round3(raw * 0.65), '0.65 的档位乘算照旧');

    /* 裂：抛光惩罚也照旧叠上去——导通不是赦免，只是把超载那笔还回来 */
    const cracked = { ...ally, stress: 85, cracked: true, polishMult: 0.7 };
    assert.equal(round3(V.Combat.energyRegen(cracked)), round3(raw * 0.65 * 0.7));

    /* 门槛边界：49 不导通、50 导通 */
    assert.equal(V.Combat.heatConducting({ ...ally, stress: 49 }), false);
    assert.equal(V.Combat.heatConducting({ ...ally, stress: 50 }), true);

    /* 敌人不吃这套：超载是我方装配的事 */
    assert.equal(V.Combat.heatConducting({ ...ally, side: 'enemy', stress: 90 }), false);
  } finally { D.DESIGN.generatedCapPerCell = perCell; }
});

function round3(x) { return Math.round(x * 1000) / 1000; }
