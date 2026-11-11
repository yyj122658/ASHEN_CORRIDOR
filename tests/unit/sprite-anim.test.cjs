'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGame } = require('../helpers/load-game.cjs');

const A = loadGame();
const SA = A.SpriteAnim;

// 资源就绪（FakeImage 同步 onload）
test('预加载：两角色四动作共 8 张图集', async () => {
  const r = await SA.preload(['blade', 'bone']);
  assert.equal(r.loaded, 8, '应加载 8 张图集');
  assert.equal(r.failed, 0);
  assert.equal(SA.isReady(), true);
});

function fakeUnit(over) {
  return Object.assign({
    id: 'u_test', side: 'ally', cls: 'blade', enemyType: null,
    hp: 100, maxHp: 100, alive: true, slot: 0,
  }, over || {});
}

test('角色识别：剑士按职业，骸骨兵只认 enemyType', () => {
  assert.equal(SA.charIdFor(fakeUnit({ side: 'ally', cls: 'blade' })), 'blade');
  assert.equal(SA.charIdFor(fakeUnit({ side: 'enemy', cls: null, enemyType: 'bone' })), 'bone');
  // 不按名字、ID、shape 猜
  assert.equal(SA.charIdFor(fakeUnit({ side: 'enemy', cls: null, enemyType: 'hound', name: '骸骨兵' })), null);
  assert.equal(SA.charIdFor(fakeUnit({ side: 'enemy', cls: null, enemyType: null, shape: 'human' })), null);
  // 其他职业保持程序绘制
  assert.equal(SA.charIdFor(fakeUnit({ side: 'ally', cls: 'cleric' })), null);
  assert.equal(SA.charIdFor(fakeUnit({ side: 'ally', cls: 'warden' })), null);
  // 我方不能误用骸骨兵
  assert.equal(SA.charIdFor(fakeUnit({ side: 'ally', cls: 'blade', enemyType: 'bone' })), 'blade');
});

test('support：四个动作齐备才算支持', () => {
  assert.equal(SA.supports(fakeUnit({ side: 'ally', cls: 'blade' })), true);
  assert.equal(SA.supports(fakeUnit({ side: 'enemy', cls: null, enemyType: 'bone' })), true);
  assert.equal(SA.supports(fakeUnit({ side: 'enemy', cls: null, enemyType: 'hound' })), false);
  assert.equal(SA.supports(fakeUnit({ side: 'ally', cls: 'cleric' })), false);
});

test('play：同一动画未播完不重启（多段伤害不重复抽刀）', () => {
  const u = fakeUnit({ id: 'p1' });
  SA.reset();
  assert.equal(SA.play(u, 'attack'), true);
  SA.update([u], 100);
  const before = SA.stateOf('p1').frame;
  assert.ok(before > 0);
  assert.equal(SA.play(u, 'attack'), false, '同动画重播应被忽略');
  assert.equal(SA.stateOf('p1').frame, before, '帧不应回退');
});

test('play：hurt 可打断 attack，attack 不能打断 hurt', () => {
  const u = fakeUnit({ id: 'p2' });
  SA.reset();
  SA.play(u, 'attack');
  assert.equal(SA.play(u, 'hurt'), true, 'hurt 优先级更高');
  assert.equal(SA.play(u, 'attack'), false, 'attack 不能抢回');
});

test('play：death 一旦进入不可被覆盖', () => {
  const u = fakeUnit({ id: 'p3' });
  SA.reset();
  SA.play(u, 'death', { force: true });
  assert.equal(SA.play(u, 'hurt'), false, 'death 后不能回 hurt');
  assert.equal(SA.play(u, 'idle'), false);
  assert.equal(SA.play(u, 'attack'), false);
  assert.equal(SA.stateOf('p3').anim, 'death');
});

test('update：idle 循环、attack 结束回 idle、death 停在末帧', () => {
  const u = fakeUnit({ id: 'p4' });
  SA.reset();

  // idle 循环
  SA.update([u], 150 * 6 + 10);
  assert.equal(SA.stateOf('p4').anim, 'idle');
  assert.ok(SA.stateOf('p4').frame <= 5);

  // attack 播完回 idle（总时长 610ms）
  SA.play(u, 'attack', { force: true });
  SA.update([u], 700);
  assert.equal(SA.stateOf('p4').anim, 'idle');

  // death 停在末帧
  SA.play(u, 'death', { force: true });
  SA.update([u], 3000);
  const st = SA.stateOf('p4');
  assert.equal(st.anim, 'death');
  assert.equal(st.frame, 5);
  assert.equal(st.done, true);
});

test('update：dt=0 时冻结（暂停）', () => {
  const u = fakeUnit({ id: 'p5' });
  SA.reset();
  SA.play(u, 'attack', { force: true });
  SA.update([u], 100);
  const f = SA.stateOf('p5').frame;
  SA.update([u], 0);
  SA.update([u], 0);
  assert.equal(SA.stateOf('p5').frame, f, '暂停不应推进帧');
});

function battleWith(units, logs) {
  return {
    allies: units.filter((u) => u.side === 'ally'),
    enemies: units.filter((u) => u.side === 'enemy'),
    logs: logs || [],
    logSeq: logs && logs.length ? logs[logs.length - 1].seq : 0,
  };
}

test('consume：act（伤害技能）触发攻击，治疗/增益不触发', () => {
  const blade = fakeUnit({ id: 'a1', side: 'ally', cls: 'blade' });
  SA.reset();
  SA.syncFromBattle(battleWith([blade], []));

  const b1 = battleWith([blade], [
    { seq: 1, type: 'act', actorId: 'a1', meta: { skillId: 'heavySlash' } },
  ]);
  SA.consume(b1);
  assert.equal(SA.stateOf('a1').anim, 'attack');

  SA.reset();
  SA.syncFromBattle(battleWith([blade], []));
  const b2 = battleWith([blade], [
    { seq: 1, type: 'act', actorId: 'a1', meta: { skillId: 'mend' } },
  ]);
  SA.consume(b2);
  assert.equal(SA.stateOf('a1').anim, 'idle', '治疗不该播攻击动画');
});

test('consume：hit 触发 hurt，致死 hit 直接 death，miss 不触发受击', () => {
  const atk = fakeUnit({ id: 'a2', side: 'ally', cls: 'blade' });
  const foe = fakeUnit({ id: 'e1', side: 'enemy', cls: null, enemyType: 'bone', hp: 50 });

  SA.reset();
  SA.syncFromBattle(battleWith([atk, foe], []));
  SA.consume(battleWith([atk, foe], [
    { seq: 1, type: 'act', actorId: 'a2', meta: { skillId: 'heavySlash' } },
    { seq: 2, type: 'hit', actorId: 'a2', targetId: 'e1', amount: 10 },
  ]));
  assert.equal(SA.stateOf('e1').anim, 'hurt');

  // 致死：hp 归零后 hit 直接进入 death
  SA.reset();
  const dead = fakeUnit({ id: 'e2', side: 'enemy', cls: null, enemyType: 'bone', hp: 0, alive: false });
  SA.syncFromBattle(battleWith([atk, dead], []));
  SA.consume(battleWith([atk, dead], [
    { seq: 1, type: 'hit', actorId: 'a2', targetId: 'e2', amount: 99 },
    { seq: 2, type: 'death', actorId: 'a2', targetId: 'e2' },
  ]));
  assert.equal(SA.stateOf('e2').anim, 'death');

  // miss：目标不受击
  SA.reset();
  const foe2 = fakeUnit({ id: 'e3', side: 'enemy', cls: null, enemyType: 'bone' });
  SA.syncFromBattle(battleWith([atk, foe2], []));
  SA.consume(battleWith([atk, foe2], [
    { seq: 1, type: 'miss', actorId: 'a2', targetId: 'e3' },
  ]));
  assert.equal(SA.stateOf('e3').anim, 'idle', 'miss 不该播受击');
});

test('consume：同一批日志里的多次 hit 不会重启攻击', () => {
  const atk = fakeUnit({ id: 'a3', side: 'ally', cls: 'blade' });
  const foe = fakeUnit({ id: 'e4', side: 'enemy', cls: null, enemyType: 'bone', hp: 999 });
  SA.reset();
  SA.syncFromBattle(battleWith([atk, foe], []));

  SA.consume(battleWith([atk, foe], [
    { seq: 1, type: 'act', actorId: 'a3', meta: { skillId: 'cleave' } },
  ]));
  SA.update([atk], 220); // 推进到中段
  const mid = SA.stateOf('a3').frame;
  assert.ok(mid > 0);

  SA.consume(battleWith([atk, foe], [
    { seq: 1, type: 'act', actorId: 'a3', meta: { skillId: 'cleave' } },
    { seq: 2, type: 'hit', actorId: 'a3', targetId: 'e4', amount: 5 },
    { seq: 3, type: 'hit', actorId: 'a3', targetId: 'e4', amount: 5 },
  ]));
  assert.equal(SA.stateOf('a3').frame >= mid, true, '多段伤害不能把攻击动画打回第 0 帧');
});

test('syncFromBattle：存活初始化 idle，已阵亡直接末帧，且不重放历史事件', () => {
  const alive = fakeUnit({ id: 's1', side: 'ally', cls: 'blade' });
  const dead = fakeUnit({ id: 's2', side: 'enemy', cls: null, enemyType: 'bone', alive: false, hp: 0 });

  SA.reset();
  const b = battleWith([alive, dead], [
    { seq: 1, type: 'act', actorId: 's1', meta: { skillId: 'heavySlash' } },
    { seq: 2, type: 'death', actorId: 's1', targetId: 's2' },
  ]);
  SA.syncFromBattle(b);

  assert.equal(SA.stateOf('s1').anim, 'idle', '存活单位恢复为待机');
  assert.equal(SA.stateOf('s2').anim, 'death', '已阵亡单位直接末帧');
  assert.equal(SA.stateOf('s2').frame, 5);

  // 再次 consume 不应重放旧事件
  SA.consume(b);
  assert.equal(SA.stateOf('s1').anim, 'idle', '旧日志不能被重放成攻击');
});

test('isImpactFrame：只识别攻击动画的出手帧', () => {
  const u = fakeUnit({ id: 'i1' });
  SA.reset();
  SA.play(u, 'attack', { force: true });
  let fired = 0;
  for (let i = 0; i < 60; i++) {
    SA.update([u], 16, { onAttackImpact: () => { fired += 1; } });
  }
  assert.equal(fired, 1, '一次攻击只应触发一次出手回调，实际 ' + fired);
});
