'use strict';
/* 蚀刻法效果的落地：覆盖率共鸣阶给乘算、贯通给额外乘算，
   以及「一根顺丝纹横跨两格必须导通」这条内部连接规则。 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;

/* 两格小蚀刻法：veins 与「顺丝纹」的 W/E 开口完全对得上 */
function msSpec(over) {
  return Object.assign({
    id: 'testms', name: '测试蚀刻法', load: 2,
    cells: [[0, 0], [1, 0]],
    veins: { '0,0': ['W'], '1,0': ['E'] },
    io: {
      clock: { cell: [0, 0], dir: 'W' },
      damage: { cell: [0, 0], dir: 'N' },
      main: { cell: [1, 0], dir: 'E' },
      support: { cell: [1, 0], dir: 'S' },
    },
    entry: [0, 0], exits: [[1, 0]],
    tiers: [
      { at: 40, id: 't1', name: '一阶', effect: { mainMult: 1.10 } },
      { at: 75, id: 't2', name: '二阶', effect: { mainMult: 1.20 } },
      { at: 100, id: 't3', name: '三阶', effect: { mainMult: 1.30, startEnergy: 1 } },
    ],
    x: 0, y: 0, rotation: 0, mirrorY: false,
  }, over || {});
}

function setup(opts) {
  const o = opts || {};
  const st = V.State.create(4242, { classicPlate: true });
  const u = st.roster[0];
  u.board.placements = [];
  const part = V.State.makePart(st, { kind: 'circuit', templateId: 'straight' });
  st.itemsById[part.id] = part;
  st.stash.push(part.id);
  if (o.place !== false) {
    u.board.placements.push({ itemId: part.id, x: o.x || 0, y: o.y || 0, rotation: 0, mirrorY: false });
  }
  if (o.noMs === true) u.manuscript = null;
  else u.manuscript = msSpec(o.ms);
  return { st, u, part };
}

test('一根顺丝纹横跨两格：内部导通，贯通成立', () => {
  const { st, u } = setup();
  const s = V.Circuit.manuscriptState(st, u.id);
  assert.equal(s.ok, true);
  assert.equal(s.pct, 100, '两格都对上，覆盖率应为 100');
  assert.equal(s.routed, true, '同一纹路的两格必须算内部导通');
  assert.equal(s.tierId, 't3');
});

test('覆盖率共鸣阶给乘算，贯通再叠 15%', () => {
  const { st, u } = setup();
  const s = V.Circuit.manuscriptState(st, u.id);
  /* 三阶 1.30 × 贯通 1.15 = 1.50，再乘负荷价（负荷 2 → ×1.03）= 1.55 */
  assert.equal(s.effects.mainMult, 1.55);
  assert.equal(s.effects.startEnergy, 1);
});

test('没装纹路 → 覆盖率 0、没有共鸣阶，效果全是默认值', () => {
  const { st, u } = setup({ place: false });
  const s = V.Circuit.manuscriptState(st, u.id);
  assert.equal(s.pct, 0);
  assert.equal(s.tierId, null);
  assert.equal(s.effects.mainMult, 1);
  assert.equal(s.effects.startEnergy, 0);
});

test('没装蚀刻法 → 没有任何加成（异形板面下也没有能量点）', () => {
  const { st, u } = setup({ noMs: true });
  const s = V.Circuit.manuscriptState(st, u.id);
  assert.equal(s.ok, false);
  assert.equal(s.reason, '没有蚀刻法');
  assert.equal(s.effects.mainMult, 1);
  assert.equal(s.effects.startEnergy, 0);

  /* 接线模型已删：无论经典还是异形板面，都不再派生端子 */
  const fresh = V.State.create(2468);
  const bare = Object.assign({}, fresh.roster[0], { manuscript: null });
  assert.equal(V.Circuit.plateOf(bare).terminals, undefined);
});

test('共鸣阶按阈值切换：只覆盖一半走一阶', () => {
  const { st, u } = setup({
    ms: msSpec({
      cells: [[0, 0], [1, 0], [2, 0]],
      veins: { '0,0': ['W'], '1,0': ['E'], '2,0': ['E'] },
      entry: [0, 0], exits: [[2, 0]],
    }),
  });
  const s = V.Circuit.manuscriptState(st, u.id);
  /* 顺丝纹只盖住前两格 → 2/3 ≈ 67%，落在 40~75 之间 → 一阶 */
  assert.equal(s.total, 3);
  assert.equal(s.aligned, 2);
  assert.equal(s.pct, 67);
  assert.equal(s.tierId, 't1');
});

test('蚀刻法吃负荷：超载不再拒绝装配，改为折算成开局压力与回裕惩罚', () => {
  const { st, u, part } = setup();
  const tpl = V.Data.template('straight');
  const withMs = V.Circuit.preview(st, u.id, u.board.placements);
  assert.equal(withMs.load, tpl.load + 2, '纹路负荷 + 蚀刻法负荷');
  assert.equal(withMs.overload, 0);

  u.manuscript.load = 99;
  const over = V.Circuit.preview(st, u.id, u.board.placements);
  const cap = V.Circuit.loadCap(u);
  assert.equal(over.ok, true, '超载不再拦装配');
  assert.equal(over.overload, over.load - cap);
  assert.ok(over.overload > 0, '超出的部分要能算出来');
});

test('纹路不能压在蚀刻法上', () => {
  const { st, u } = setup();
  const s = V.Circuit.manuscriptState(st, u.id);
  assert.equal(s.ok, true);
  /* 经典板面不走蚀刻法占格校验（老存档兼容），异形板面才查 */
  assert.equal(V.Circuit.plateOf(u).generated, false);
});
