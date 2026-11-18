'use strict';
/* 自动布线器（autoRouteBoard）回归：这条防线守的是「模拟器里的构筑真的接通了」。
   背景：在布线器之前，`buildBoard` 只按覆盖率贪心，蚀刻法的入口/出口没有对应开口，
   `Manuscript.route()` 恒为 false —— 直导缩间隔、直导闪避、弯折增压、闸门、余烬温控
   全部拿不到路径，模拟器测的其实只是「谁的血更厚」。 */
const test = require('node:test');
const assert = require('node:assert');

const { loadVeteran } = require('../helpers/load-veteran.cjs');
const { autoRouteBoard } = require('../helpers/veteran-run.cjs');

const A = loadVeteran();
const V = A.Veteran;

const PRESETS = [
  { style: 'straight', body: 'sturdy', ms: 'flurry', label: 'A 高频直导' },
  { style: 'elbow', body: 'sturdy', ms: 'inverse', label: 'B 九曲线圈炮' },
  { style: 'ember', body: 'waist', ms: 'ember12', label: 'C 高温余烬' },
];

/** 按流派造一个「只装了主修」的角色，交给布线器全权处理板面 */
function buildUnit(preset, seed) {
  const st = V.State.create(seed == null ? 11 : seed);
  st.roster = [];
  st.team = [];
  const u = V.State.makeUnit(st, {
    skinId: 'blade', bodyPreset: preset.body, name: preset.style.toUpperCase(),
  });
  st.roster.push(u);
  st.team.push(u.id);
  V.State.equipManuscript(st, u, preset.ms);
  assert.equal(u.manuscript?.id, preset.ms, `${preset.label} 应装下完整蚀刻法`);
  const routed = autoRouteBoard(A, st, u, {
    style: preset.style,
    overload: preset.style === 'ember' ? 0.35 : 0,
  });
  return { st, u, routed };
}

test('三套流派预设全部接通：routed === true 且 pulse.path.length >= 2', () => {
  PRESETS.forEach((preset) => {
    const { st, u, routed } = buildUnit(preset);
    assert.ok(routed.ok, `${preset.label} 布线失败：${routed.reason}`);
    assert.equal(routed.route.ok, true, `${preset.label} 的 route() 应成立`);
    assert.ok(routed.pulse.path.length >= 2,
      `${preset.label} 的通路至少两格（实际 ${routed.pulse.path.length}）`);

    /* 真实编译（战斗读的就是这一份）也要带着路径 */
    const cc = V.Circuit.compile(st, u.id, u.board.placements);
    assert.ok(cc.ok, `${preset.label} 编译应通过`);
    const mainPulse = cc.value.pulse[routed.pulse && Object.keys(cc.value.pulse)[0]];
    assert.ok(cc.value.panel.usedCells > 0, `${preset.label} 应占住格`);
    assert.ok(mainPulse && mainPulse.path.length >= 2,
      `${preset.label} 的 compile 结果里应带着通路（实际 ${mainPulse && mainPulse.path.length}）`);
  });
});

test('通路每一步都是「彼此开口」：相邻两格的端口互为反面', () => {
  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const DIR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  PRESETS.forEach((preset) => {
    const { st, u, routed } = buildUnit(preset);
    assert.ok(routed.ok, `${preset.label} 布线失败`);
    const lay = V.Circuit.layout(st, u.board.placements);
    const idx = V.Manuscript.pieceIndex(lay);
    const path = routed.route.path;
    for (let i = 1; i < path.length; i++) {
      const [x0, y0] = path[i - 1].split(',').map(Number);
      const [x1, y1] = path[i].split(',').map(Number);
      const d = Object.keys(DIR).find((k) => x0 + DIR[k][0] === x1 && y0 + DIR[k][1] === y1);
      assert.ok(d, `${preset.label} 的通路应逐格相邻：${path[i - 1]} → ${path[i]}`);
      const from = idx.dirs.get(path[i - 1]) || [];
      const to = idx.dirs.get(path[i]) || [];
      assert.ok(from.includes(d), `${preset.label} 的 ${path[i - 1]} 应朝 ${d} 开口`);
      assert.ok(to.includes(OPP[d]), `${preset.label} 的 ${path[i]} 应朝 ${OPP[d]} 开口`);
    }
  });
});

test('流派偏好真的落到了路径上：直导堆格、弯折堆转角、余烬挂标签', () => {
  const straight = buildUnit(PRESETS[0]);
  assert.ok(straight.routed.pulse.straight >= 4,
    `直导流应堆出足够直导格（实际 ${straight.routed.pulse.straight}）`);
  assert.equal(straight.routed.pulse.dodgeBonus,
    Math.min(V.Circuit.PULSE.straightDodgeCap, straight.routed.pulse.straight * V.Circuit.PULSE.straightDodge),
    '直导闪避 = 每格 1.5%，上限 12%');

  const elbow = buildUnit(PRESETS[1]);
  assert.ok(elbow.routed.pulse.turns >= 3,
    `弯折流应堆出转角（实际 ${elbow.routed.pulse.turns}）`);
  assert.ok(elbow.routed.panel.caps > 0, '弯折流应带上储能格（缓冲上限 > 0）');
  assert.ok(elbow.routed.panel.shieldCap > 0, '弯折流应有电容缓冲上限');

  const ember = buildUnit(PRESETS[2]);
  assert.equal(ember.routed.pulse.ember, true, '余烬流的主路径应挂 ember 标签');
  assert.equal(ember.routed.pulse.gate, true, '余烬流的主路径应有闸系件');
});

test('负载：A/B 压在 cap 内，C 故意超载换高温', () => {
  PRESETS.forEach((preset) => {
    const { routed } = buildUnit(preset);
    assert.ok(routed.ok, `${preset.label} 布线失败`);
    if (preset.style === 'ember') {
      /* C 想「压满压穿」：负荷要吃到上限的七成以上才算把板面用足了。
         不能强求真的越线 —— 板面就那么点格，填不满 1.35 倍预算时它是压不穿的。 */
      assert.ok(routed.load >= Math.round(routed.cap * 0.7),
        `C 应把板面压满（${routed.load}/${routed.cap}）`);
    } else {
      assert.ok(routed.load <= routed.cap,
        `${preset.label} 不该超载（${routed.load}/${routed.cap}）`);
    }
  });
});

test('接通之后，战斗里的单位真的带着路径与派生参数', () => {
  const st = V.State.create(20261116);
  st.roster = [];
  st.team = [];
  PRESETS.forEach((preset, i) => {
    const u = V.State.makeUnit(st, {
      skinId: V.Data.SKINS[i].id, bodyPreset: preset.body, name: preset.style.toUpperCase(),
    });
    st.roster.push(u);
    st.team.push(u.id);
    V.State.equipManuscript(st, u, preset.ms);
    assert.equal(u.manuscript?.id, preset.ms, `${preset.label} 应装下完整蚀刻法`);
    assert.ok(autoRouteBoard(A, st, u, {
      style: preset.style, overload: preset.style === 'ember' ? 0.35 : 0,
    }).ok, `${preset.label} 布线失败`);
  });

  let s = V.Expedition.start(st, { seed: 20261116 }).state;
  s.run.nodes = [{ id: 'n1', type: 'battle', consumed: false }];
  s = V.Encounter.open(s, 'n1').state;
  s = V.Encounter.startAttempt(s).state;
  const b = s.run.battle;
  assert.equal(b.allies.length, 3);
  b.allies.forEach((a) => {
    assert.ok(a.pulse && a.pulse.path && a.pulse.path.length >= 2,
      `${a.name} 上场时应带着通路（实际 ${a.pulse && a.pulse.path && a.pulse.path.length}）`);
    assert.ok(a.pulseAmp > 0, `${a.name} 的幅值应来自路径编译`);
  });
  /* 三家的开路方式不同，幅值/闪避不该完全一致 */
  const doIds = new Set(b.allies.map((a) => a.dodge.toFixed(3)));
  assert.ok(doIds.size >= 2, '直导流与余烬流的闪避不该一样');
});
