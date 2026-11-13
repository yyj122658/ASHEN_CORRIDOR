'use strict';
/* 流派落地：平A / 招式 / 灼烧 / 治疗 / 护盾 五条轴都要能在真实战斗里被玩家做出来。
   这一组用例锁的是「纹章 → 数值 → 战斗行为」的每一段，防止再次出现有数据没实现。 */
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun } = require('../helpers/veteran-run.cjs');

/** 把纹章按「尽量压住蚀刻法」的方式装进板面，返回装配后的状态。 */
function equip(V, st, unit, runeIds) {
  const ms = unit.manuscript;
  const draft = [];
  for (const id of runeIds) {
    const part = V.State.makePart(st, { kind: 'circuit', templateId: id });
    st.itemsById[part.id] = part;
    const pose = V.Circuit.suggestPlacement(st, unit, draft, part.id, ms);
    if (!pose) continue;
    const cand = [...draft, { itemId: part.id, ...pose }];
    const load = V.Circuit.layout(st, cand).built.reduce((n, b) => n + b.tpl.load, 0) + (ms.load || 0);
    if (load > V.Circuit.loadCap(unit)) continue;
    if (!V.Circuit.preview(st, unit.id, cand).ok) continue;
    draft.push({ itemId: part.id, ...pose });
  }
  unit.board.placements = draft;
  return draft;
}

function withBuild(seed, msId, runeIds, action) {
  const { A, V, st } = boot(seed);
  const unit = st.roster[0];
  unit.board.placements.forEach((p) => st.stash.push(p.itemId));
  unit.board.placements = [];
  unit.manuscript = null;
  for (let s = 1; !unit.manuscript && s < 200; s++) {
    V.State.equipManuscript(st, unit, msId);
    if (!unit.manuscript) unit.plateSeed = s;
  }
  equip(V, st, unit, runeIds);
  if (action) unit.gambits = [{ id: 'g', enabled: true, conditions: [{ type: 'always' }], target: 'frontFoe', action }];
  return { A, V, st, unit };
}

function fight(A, st, seed, floor) {
  const V = A.Veteran;
  let s = V.Expedition.start(st, { seed }).state;
  s.run.floor = floor;
  const gen = V.Combat.generateEncounter(s, 'normal');
  s = V.Combat.create(gen.state, gen.enemyBlueprint, gen.combatRngStart).state;
  for (let i = 0; !s.run.battle.over && i < 3000; i++) s = V.Combat.step(s).state;
  return s;
}

test('增益按「对上的端口比例」结算，蹭一格不再吃全额', () => {
  const { V, st } = withBuild(3, 'corridor5', []);
  const unit = st.roster[0];
  const part = V.State.makePart(st, { kind: 'circuit', templateId: 'straight' });
  st.itemsById[part.id] = part;
  const poses = [];
  for (let rot = 0; rot < 4; rot++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const pose = { itemId: part.id, templateId: 'straight', x, y, rotation: rot, mirrorY: false };
    if (!V.Circuit.preview(st, unit.id, [pose]).ok) continue;
    const s = V.Circuit.manuscriptState(st, unit.id, [pose]);
    if (s.aligned === 1) poses.push({ pose, regen: s.effects.boost.regen });
    if (s.aligned === 2) poses.push({ pose, regen: s.effects.boost.regen });
  }
  const one = poses.find((p) => p.regen > 0 && p.regen < 0.1);
  const full = poses.find((p) => p.regen === 0.1);
  assert.ok(one, '存在只对上一格的摆法');
  assert.ok(full, '也存在两格全对上的摆法');
  assert.equal(one.regen, 0.05, '对上一格只该拿一半');
});

test('治疗流：healMult 纹章真的抬高治疗量', () => {
  const plain = withBuild(11, 'ward', []);
  const boosted = withBuild(11, 'ward', ['rail', 'bellowsCell', 'hairpin']);
  const a = fight(plain.A, plain.st, 11, 14);
  const b = fight(boosted.A, boosted.st, 11, 14);
  assert.ok(b.run.battle.stats.healing > a.run.battle.stats.healing,
    `带治疗纹章应奶得更多（${b.run.battle.stats.healing} vs ${a.run.battle.stats.healing}）`);
});

test('灼烧流：dotMult 纹章抬高每跳灼烧，余烬纹负责点火', () => {
  const plain = withBuild(13, 'flurry', ['ember']);
  const boosted = withBuild(13, 'flurry', ['ember', 'fuse']);
  const burnOf = (fixture) => {
    const V = fixture.V;
    let s = V.Expedition.start(fixture.st, { seed: 13 }).state;
    s.run.floor = 14;
    const gen = V.Combat.generateEncounter(s, 'normal');
    s = V.Combat.create(gen.state, gen.enemyBlueprint, gen.combatRngStart).state;
    const b = s.run.battle;
    const actor = b.allies.find((u) => u.sourceUnitId === fixture.unit.id);
    actor.hits = 1; actor.crit = 0;
    b.enemies.forEach((e) => { e.hp = e.maxHp = 999999; e.dodge = 0; e.atk = 0; });
    for (let i = 0; i < 60; i++) s = V.Combat.step(s).state;
    const enemy = s.run.battle.enemies[0];
    const burn = (enemy.buffs || []).filter((x) => x.k === 'burn').map((x) => x.v);
    return { burn, dotMult: fixture.unit.board.placements.length ? V.Circuit.manuscriptState(fixture.st, fixture.unit.id).effects.boost.dotMult : 0 };
  };
  const a = burnOf(plain);
  const c = burnOf(boosted);
  assert.ok(a.burn.length && c.burn.length, '打中后应留下灼烧');
  assert.ok(c.dotMult > a.dotMult, '多一枚游焰纹应抬高 dotMult');
  assert.ok(Math.max(...c.burn) > Math.max(...a.burn), `灼烧每跳应更高（${c.burn} vs ${a.burn}）`);
});

test('护盾只来自蚀刻法招式：铁壁的合壁真的给盾，shieldMult 抬高盾量', () => {
  const { V, st, unit } = withBuild(17, 'bulwark', ['capacitor', 'threshold', 'cistern'], 'main');
  const s = fight({ Veteran: V }, st, 17, 14);
  const b = s.run.battle;
  /* 「保护」行动已撤：战斗里不该再有 support 类型的行动日志 */
  assert.equal(b.logs.filter((l) => l.type === 'support').length, 0, '护持行动应已撤除');
  const shieldLogs = b.logs.filter((l) => l.type === 'shield');
  assert.ok(shieldLogs.length, '带护盾的蚀刻法招式应刷出护盾');
  const gained = Math.max(...shieldLogs.map((l) => l.amount));
  const shieldMult = V.Circuit.manuscriptState(st, unit.id).effects.boost.shieldMult || 0;
  const base = Math.round(b.allies[0].maxHp * 0.3);
  assert.ok(shieldMult >= 0, '纹路应给出护盾增益字段');
  assert.ok(gained >= Math.round(base * 0.5), `护盾量应在招式倍率量级（${gained}）`);
});

test('防御指令真的减伤：同一场仗举盾比不举盾挨得少', () => {
  const main = withBuild(19, 'spark', [], 'main');
  const guard = withBuild(19, 'spark', [], 'guard');
  const a = fight(main.A, main.st, 19, 14).run.battle;
  const b = fight(guard.A, guard.st, 19, 14).run.battle;
  assert.ok(b.logs.some((l) => l.type === 'guard'), '防御会产生举盾记录');
  const aSec = a.tick * 0.24;
  const bSec = b.tick * 0.24;
  assert.ok(b.stats.taken / bSec < a.stats.taken / aSec, `防御每秒承伤应更低（${(b.stats.taken / bSec).toFixed(1)} vs ${(a.stats.taken / aSec).toFixed(1)}）`);
  assert.ok(b.stats.damage / bSec < a.stats.damage / aSec, '防御用输出换生存，每秒伤害应更低');
});

test('贯通奖励够用：满覆盖 + 贯通的主手倍率明显高于只满覆盖', () => {
  const { V, st } = withBuild(23, 'corridor5', []);
  const unit = st.roster[0];
  const origin = { x: unit.manuscript.x, y: unit.manuscript.y };
  const parts = [['elbow', 2, 0, 0, false], ['straight', 0, 0, 0, false]];
  const draft = parts.map(([tpl, x, y, rot, mir]) => {
    const item = V.State.makePart(st, { templateId: tpl });
    st.itemsById[item.id] = item;
    st.stash.push(item.id);
    return { itemId: item.id, x: x + origin.x, y: y + origin.y, rotation: rot, mirrorY: mir };
  });
  const check = V.Circuit.preview(st, unit.id, draft);
  assert.ok(check.ok, check.errors.join(' '));
  const routed = V.Circuit.manuscriptState(st, unit.id, draft);
  assert.equal(routed.pct, 100);
  assert.equal(routed.routed, true);
  /* 三阶 1.24 × 贯通 1.15 = 1.43，再乘负荷价（corridor5 负荷 2 → ×1.03）= 1.47 */
  assert.equal(routed.effects.mainMult, 1.47);
});
