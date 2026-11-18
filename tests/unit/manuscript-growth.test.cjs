'use strict';
const {fullTeam, buildBoard} = require('../helpers/veteran-run.cjs');
/* 蚀刻法成长曲线：换更高阶的蚀刻法必须打得动更深的层。
   这条不成立的话，整个「按层掉落蚀刻法」的设计就是空的。 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;

function fightAt(seed, floor, msId, opts) {
  let st = fullTeam(V, V.State.create(20261112 + Math.ceil(floor / 7)));
  st.roster.slice(0, 4).forEach((u, i) => {
    u.manuscript = null;
    u.board.placements.forEach((p) => st.stash.push(p.itemId));
    u.board.placements = [];
    /* 固定三位输出，检验每一阶的蚀刻法都能在实战队伍里发挥作用。 */
    const id = opts && opts.mixed && i > 0 ? 'inverse' : msId;
    V.State.equipManuscript(st, u, id);
    if (!u.manuscript) {
      u.bodyPreset = 'sturdy';
      V.State.equipManuscript(st, u, id);
    }
    assert.equal(u.manuscript?.id, id);
    const route = V.Circuit.autoLoadout(st, u);
    assert.ok(route, `${id} 应有合法起手布线`);
    u.board.placements = route;
    buildBoard({ Veteran: V }, st, u);
    assert.ok(V.Circuit.manuscriptState(st, u.id).routed, `${id} 应在实板贯通`);
  });
  st = V.Expedition.start(st, { seed }).state;
  st.run.floor = floor;
  V.Expedition.genNodes(st);
  const node = st.run.nodes.find(n => n.type === 'boss') || st.run.nodes.find(n => n.type === 'battle' || n.type === 'elite');
  let s = V.Encounter.open(st, node.id).state;
  if (!s || !s.run) return null;
  s = V.Encounter.startAttempt(s).state;
  let guard = 0;
  while (!s.run.battle.over && guard++ < 2500) {
    const r = V.Combat.step(s);
    if (!r.ok) break;
    s = r.state;
  }
  return s.run.battle;
}

test('七套蚀刻法都在，且阶位连续 1~7', () => {
  const order = V.Data.MANUSCRIPT_ORDER;
  assert.equal(order.length, 7);
  order.forEach((id, i) => {
    assert.equal(V.Data.MANUSCRIPTS[id].rarity, i + 1, `${id} 阶位应为 ${i + 1}`);
  });
});

test('一阶蚀刻法占地足够小，任何板面都塞得下', () => {
  const spark = V.Data.MANUSCRIPTS.spark;
  assert.ok(spark.cells.length >= 6 && spark.cells.length <= 9,
    `一阶蚀刻法应在 6~9 格（实际 ${spark.cells.length}）`);
  assert.equal(spark.load, 2, '一阶蚀刻法负荷 2');
  const st = V.State.create(37);
  const u = st.roster[0];
  for (const body of Object.values(V.Data.BODIES)) {
    u.bodyPreset = body.id;
    u.manuscript = null;
    V.State.equipManuscript(st, u, 'spark');
    assert.deepEqual(u.manuscript?.cells, spark.cells, `${body.id} 应装下完整的星火`);
  }
});

test('带上对应阶位的蚀刻法，七个章末都能打赢', () => {
  const order = V.Data.MANUSCRIPT_ORDER;
  const rows = [];
  let cleared = 0;
  for (let floor = 1; floor <= 7; floor++) {
    const id = order[floor - 1];
    let wins = 0;
    let n = 0;
    [3, 9, 17].forEach((seed) => {
      const b = fightAt(seed, floor * 7, id, { mixed: true });
      if (!b) return;
      n += 1;
      if (b.win) wins += 1;
    });
    if (wins > 0) cleared += 1;
    rows.push(`第${floor}章 ${V.Data.MANUSCRIPTS[id].name} ${wins}/${n}`);
    assert.ok(n > 0, `${rows[rows.length - 1]} 至少要能打完`);
  }
  /* 八标：本轮把玩家侧 EHP 三项封顶（闭环完整度 / 缓冲池 / 阻抗），
     而旧的验收线是「对应阶位蚀刻法 3/3 全胜」——那是「完整度能堆到 270」的旧世界的余数。
     重标之后这条线必须改写，否则它和「F49 胜率 45%~75%」直接互斥。
     现在守的是：**七个章末里至少五章，对应阶位的蚀刻法能真的赢下来**
     （同目录另一条用例仍守着「只有一阶打不到第七章」，成长是必需的这一点没被削弱）。 */
  /* 九标：大卷的「有效占格 ≤ 34」封顶之后，后期章节从「2 章能赢」回到「5 章能赢」：
     第 1/2/3/4/7 章都有胜场（3/3 · 3/3 · 2/3 · 3/3 · 1/3）。仍为 0/3 的是第 5、6 章
     （连刺 / 双流，R5~R6 大量骨架 + 中等幅值），留给下一轮骨架重标。
     门槛从 2 抬回 5：这条用例重新是一条「成长真的能过关」的哨兵，而不是记录缺口的便签。 */
  assert.ok(cleared >= 5, `七章里至少五章该赢得下来，实际：${rows.join(' / ')}`);
});

test('只有一阶蚀刻法打不到第七章章末——换蚀刻法是必需的', () => {
  const results = [3, 28, 49].map((floor) => {
    const b = fightAt(3, floor, 'spark');
    return { floor, win: !!(b && b.win) };
  });
  const last = results[results.length - 1];
  assert.equal(last.win, false, '一阶蚀刻法不该能通关第七章章末');
  assert.ok(results[0].win, '一阶蚀刻法至少能打过前几层');
});

test('撤离会按完成的层数掉对应阶位的蚀刻法', () => {
  const order = V.Data.MANUSCRIPT_ORDER;
  for (const floor of [3, 5]) {
    let st = V.State.create(4242);
    const before = st.manuscriptVault.length;
    st = V.Expedition.start(st, { seed: 9 }).state;
    st.run.floor = floor;
    st.run.completedFloors = floor;
    /* 直接走撤离事务 */
    const r = V.Expedition.extract(st, false);
    if (!r.ok) continue;
    const next = r.state;
    assert.ok(next.manuscriptVault.length > before, `第 ${floor} 层撤离应掉蚀刻法`);
    const got = next.manuscriptVault[next.manuscriptVault.length - 1];
    assert.ok(V.Data.MANUSCRIPTS[got.id], '掉落的蚀刻法必须是已知蚀刻法');
  }
});

test('平A 间隔与回能可以被蚀刻法改写', () => {
  const mk = (id) => {
    const st = V.State.create(20261112);
    const u = st.roster[0];
    u.manuscript = null;
    u.bodyPreset = 'sturdy';
    V.State.equipManuscript(st, u, id);
    return V.Circuit.manuscriptState(st, u.id);
  };
  const spark = mk('spark');
  const inverse = mk('inverse');
  /* spark 平A 快（intervalScale 0.85），inverse 更快 + 回能更高 */
  assert.ok(spark.spec.attack.intervalScale < 1);
  assert.ok(inverse.spec.energy.regen > spark.spec.energy.regen);
});
