'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
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

test('所有传奇与敌人按真实身份选图，换位不换外观', async () => {
  const heroes = A.Veteran.Data.SKINS.map(({id}) => fakeUnit({id,skinId:id}));
  const enemies = Object.keys(A.Veteran.Data.ENEMIES).map(id => fakeUnit({id,side:'enemy',enemyType:id}));
  const units = [...heroes, ...enemies];
  assert.equal(heroes.length,21);
  const first = SA.preload(units.map(SA.charIdFor));
  const second = SA.preload(units.map(SA.charIdFor));
  for (const result of await Promise.all([first, second])) assert.equal(result.failed,0);
  const paths = new Set();
  for (const u of units) {
    /* 亚种复用同族立绘：外观键是 sprite（没有 sprite 才是自己的 id） */
    const look = u.side === 'enemy'
      ? (A.Veteran.Data.ENEMIES[u.enemyType].sprite || u.enemyType)
      : u.id;
    assert.equal(SA.charIdFor({...u,slot:3}),look);
    assert.equal(SA.supports(u),true);
    const anim = SA.atlas.characters[look].animations;
    paths.add(anim.attack.sheet);
    assert.ok(new Set(anim.attack.frames.map(f => f.rect.x + ',' + f.rect.y)).size >= 3);
    SA.syncFromBattle({allies:[{...u,alive:false}]});
    assert.equal(SA.stateOf(u.id).frame,anim.death.frames.length-1);
  }
  const bodies = new Set(Object.values(A.Veteran.Data.ENEMIES).map(e => e.sprite || e.id));
  assert.equal(paths.size, heroes.length + bodies.size);
  assert.equal(SA.charIdFor(fakeUnit({side:'enemy',enemyType:null,name:'骸骨兵'})),null);
  assert.equal(SA.charIdFor(fakeUnit({skinId:'unknown'})),null);
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

  // 再次同步不应把旧日志重放成攻击
  SA.syncFromBattle(b);
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
