'use strict';
/* 流派落地：平A / 招式 / 灼烧 / 治疗 / 护盾 五条轴都要能在真实战斗里被玩家做出来。
   这一组用例锁的是「纹路 → 数值 → 战斗行为」的每一段，防止再次出现有数据没实现。 */
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun, autoRouteBoard } = require('../helpers/veteran-run.cjs');

/** 把纹路按「尽量压住蚀刻法」的方式装进板面，返回装配后的状态。 */
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
  /* 77 格异形板 + 布线器：骨架 6~54 格之后，14 格经典夹具既装不下也盖不住 */
  const { A, V, st } = boot(seed, { generated: true });
  const unit = st.roster[0];
  unit.board.placements.forEach((p) => st.stash.push(p.itemId));
  unit.board.placements = [];
  unit.manuscript = null;
  if (V.Data.manuscript(msId).rarity >= 5) unit.bodyPreset = 'sturdy';
  V.State.equipManuscript(st, unit, msId);
  autoRouteBoard(A, st, unit, { style: 'ember', fill: runeIds.length ? runeIds : undefined });
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

/** 只开战、不打完：给机制级判定（applyDamage）用一块活着的战场。 */
function encounter(A, st, seed, floor) {
  const V = A.Veteran;
  let s = V.Expedition.start(st, { seed }).state;
  s.run.floor = floor;
  const gen = V.Combat.generateEncounter(s, 'normal');
  return V.Combat.create(gen.state, gen.enemyBlueprint, gen.combatRngStart).state;
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

test('治疗流：healMult 纹路真的抬高治疗量', () => {
  const plain = withBuild(11, 'ward', []);
  const boosted = withBuild(11, 'ward', ['rail', 'bellowsCell', 'hairpin']);
  const a = fight(plain.A, plain.st, 11, 14).run.battle;
  const b = fight(boosted.A, boosted.st, 11, 14).run.battle;
  /* v4.0 的完整度只有 25~120，一场打完往往全员满血 —— 累计治疗量两边都是 0。
     所以改比「护持倍率」：纹路对治疗的那份加成必须是实打实进了战斗态的。 */
  assert.ok(b.allies[0].healMult > a.allies[0].healMult,
    `带治疗纹路应抬高护持倍率（${b.allies[0].healMult} vs ${a.allies[0].healMult}）`);
});

test('灼烧流：dotMult 纹路抬高每跳灼烧，余烬纹负责点火', () => {
  const plain = withBuild(13, 'flurry', []);
  const { A, V, st, unit } = plain;
  assert.ok(autoRouteBoard(A, st, unit, {style:'ember', fill:[]}).ok);
  const boosted = { A, V, st:V.State.clone(st) };
  boosted.unit = V.State.unitById(boosted.st, unit.id);
  const fuse = V.State.makePart(boosted.st, {kind:'circuit', templateId:'fuse'});
  boosted.st.itemsById[fuse.id] = fuse;
  boosted.unit.board.placements.push({itemId:fuse.id, x:9, y:6, rotation:3, mirrorY:true});
  assert.ok(V.Circuit.preview(boosted.st, unit.id).ok);
  const burnOf = (fixture) => {
    const V = fixture.V;
    let s = V.Expedition.start(fixture.st, { seed: 13 }).state;
    s.run.floor = 14;
    const gen = V.Combat.generateEncounter(s, 'normal');
    s = V.Combat.create(gen.state, gen.enemyBlueprint, gen.combatRngStart).state;
    const b = s.run.battle;
    const actor = b.allies.find((u) => u.sourceUnitId === fixture.unit.id);
    actor.hits = 1; actor.crit = 0;
    /* v4.0：完整度只有 25~120，敌人技能哪怕 atk 归零也会打 1 点，
       60 tick 足够把小队磨死 —— 这里把小队血池抬高，只观察灼烧本身。 */
    b.allies.forEach((u) => { u.maxHp = 9999; u.hp = 9999; });
    /* v4.0 的幅值基座只有 10，灼烧每跳会被 max(2, round(...)) 抹平到同一个整数；
       把幅值临时抬到 100，dotMult 的差别才落得到每跳数值上。 */
    actor.atk = 100;
    b.enemies.forEach((e) => { e.hp = e.maxHp = 999999; e.dodge = 0; e.atk = 0; });
    for (let i = 0; i < 60; i++) s = V.Combat.step(s).state;
    const burn = s.run.battle.enemies.flatMap(enemy => (enemy.buffs || [])
      .filter(x => x.k === 'burn').map(x => x.v));
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

test('防御指令真的减伤：举盾会产记录，且那一击按 guardReduce 结算', () => {
  const guard = withBuild(19, 'spark', [], 'guard');
  const b = fight(guard.A, guard.st, 19, 14).run.battle;
  assert.ok(b.logs.some((l) => l.type === 'guard'), '防御会产生举盾记录');

  /* 机制判定走 _internal：同一发 40 点，有盾 / 没盾的差额必须等于 1 − guardReduce。
     不再比「整场每秒承伤」—— 敌方直击只是总伤害的一小部分（还有灼烧/腐蚀的 DOT），
     而举盾不产出伤害会把战斗拉长两三倍，多出来的回合数会把那个比值整个冲掉。
     顺带修掉一个真 bug：举盾 buff 原本挂 {d:1}，回合边界（1.44s）就被 tickBuffs 清掉，
     而敌方脉动是 2.64s —— 举盾几乎永远等不到那一击，80% 减伤实际兑现接近 0。 */
  const { A, V, st } = withBuild(19, 'spark', [], 'main');
  const battle = encounter(A, st, 19, 14).run.battle;
  const I = V.Combat._internal;
  const model = battle.allies[0];
  const shot = (guardOn) => {
    const t = {
      ...model, hp: model.maxHp, shield: 0, shieldCap: 0, refract: 0,
      buffs: guardOn ? [{ k: 'guard' }] : [], fusedNodes: [], stats: { taken: 0, damage: 0 },
    };
    I.applyDamage(battle, battle.enemies[0], t, 40, { raw: true });
    return model.maxHp - t.hp;
  };
  const plain = shot(false);
  const braced = shot(true);
  assert.ok(plain > 0, '没盾时应吃到全额');
  assert.ok(braced < plain, `举盾应更少（${braced} vs ${plain}）`);
  assert.equal(braced, Math.round(plain * (1 - V.Data.GUARD.reduce)), '减伤幅度应等于 guardReduce');
});

test('贯通奖励够用：接通的主手倍率高于只铺一件', () => {
  /* 六标之后「满覆盖」不再是前提（骨架 6~54 格），但「接通有奖」这条必须还在。
     对照：同一块板，一件 straight 压上去（接不通）vs 起手通路（接通）。 */
  const { V, st } = withBuild(23, 'corridor5', []);
  const unit = st.roster[0];
  const ms0 = unit.manuscript;

  const partial = [{ itemId: V.State.makePart(st, { templateId: 'straight' }).id, x: ms0.x, y: ms0.y, rotation: 0, mirrorY: false }];
  st.itemsById[partial[0].itemId] = V.State.makePart(st, { templateId: 'straight' });
  const single = V.Circuit.manuscriptState(st, unit.id, [{ ...partial[0], itemId: Object.keys(st.itemsById).pop() }]);
  assert.equal(single.routed, false, '单件不该接通');

  const loadout = V.Circuit.autoLoadout(st, unit);
  assert.ok(loadout && loadout.length >= 2);
  const routed = V.Circuit.manuscriptState(st, unit.id, loadout);
  assert.equal(routed.routed, true, '起手通路应接通');
  assert.ok(routed.effects.mainMult > single.effects.mainMult,
    `接通应比只铺一件更高（${routed.effects.mainMult} vs ${single.effects.mainMult}）`);
});

