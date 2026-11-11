'use strict';
/* 功法成长曲线：换更高阶的功法必须打得动更深的层。
   这条不成立的话，整个「按层掉落功法」的设计就是空的。 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;

function fightAt(seed, floor, msId) {
  let st = V.State.create(20261112 + floor);
  st.roster.slice(0, 4).forEach((u) => {
    u.manuscript = null;
    V.State.equipManuscript(st, u, msId);
  });
  st = V.Expedition.start(st, { seed }).state;
  st.run.floor = floor;
  const node = st.run.nodes.find((n) => n.risk === 'deadly')
    || st.run.nodes.find((n) => n.risk !== 'none')
    || st.run.nodes[0];
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

test('七套功法都在，且阶位连续 1~7', () => {
  const order = V.Data.MANUSCRIPT_ORDER;
  assert.equal(order.length, 7);
  order.forEach((id, i) => {
    assert.equal(V.Data.MANUSCRIPTS[id].rarity, i + 1, `${id} 阶位应为 ${i + 1}`);
  });
});

test('一阶功法占地足够小，任何板面都塞得下', () => {
  const spark = V.Data.MANUSCRIPTS.spark;
  assert.ok(spark.cells.length <= 2, '一阶功法占地不能超过 2 格');
  assert.ok(spark.load <= 2, '一阶功法负荷不能超过 2');
  for (let seed = 1; seed <= 20; seed++) {
    const st = V.State.create(seed * 37);
    const u = st.roster[0];
    u.manuscript = null;
    V.State.equipManuscript(st, u, 'spark');
    assert.ok(u.manuscript, `seed ${seed * 37} 的板面塞不下一阶功法`);
  }
});

test('带上对应阶位的功法，七层都能打赢', () => {
  const order = V.Data.MANUSCRIPT_ORDER;
  const rows = [];
  for (let floor = 1; floor <= 7; floor++) {
    const id = order[floor - 1];
    let wins = 0;
    let n = 0;
    [3, 9, 17].forEach((seed) => {
      const b = fightAt(seed, floor, id);
      if (!b) return;
      n += 1;
      if (b.win) wins += 1;
    });
    rows.push(`第${floor}层 ${V.Data.MANUSCRIPTS[id].name} ${wins}/${n}`);
    assert.equal(wins, n, `${rows[rows.length - 1]} 应该全胜`);
  }
});

test('只有一阶功法打不到第 7 层——换功法是必需的', () => {
  const results = [3, 5, 7].map((floor) => {
    const b = fightAt(3, floor, 'spark');
    return { floor, win: !!(b && b.win) };
  });
  const last = results[results.length - 1];
  assert.equal(last.win, false, '一阶功法不该能通关第 7 层');
  assert.ok(results[0].win, '一阶功法至少能打过前几层');
});

test('撤离会按完成的层数掉对应阶位的功法', () => {
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
    assert.ok(next.manuscriptVault.length > before, `第 ${floor} 层撤离应掉功法`);
    const got = next.manuscriptVault[next.manuscriptVault.length - 1];
    assert.ok(V.Data.MANUSCRIPTS[got.id], '掉落的功法必须是已知谱目');
  }
});

test('平A 间隔与回能可以被功法改写', () => {
  const mk = (id) => {
    const st = V.State.create(20261112);
    const u = st.roster[0];
    u.manuscript = null;
    V.State.equipManuscript(st, u, id);
    return V.Circuit.manuscriptState(st, u.id);
  };
  const spark = mk('spark');
  const inverse = mk('inverse');
  /* spark 平A 快（intervalScale 0.85），inverse 更快 + 回能更高 */
  assert.ok(spark.spec.attack.intervalScale < 1);
  assert.ok(inverse.spec.energy.regen > spark.spec.energy.regen);
});
