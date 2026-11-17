'use strict';
/* 满压临界：压力顶到 100 不是「更高一档」，是一道悬崖。
   大概率裂（纹理方向律反转：满压的红利翻成负担，受伤加深，抛光打折，带着裂进下一场），
   小概率砺（压力自己卸回 50，抛光更顺，不留记录）。
   这一组测试守的是「顶满压力不再是纯增益」这件事本身，以及三条数值落点有没有接错。 */
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun, setNodes, fight } = require('../helpers/veteran-run.cjs');

function battleAt(seed) {
  const { A, V, st } = boot(seed);
  const s = fight(A, setNodes(A, startRun(A, st, seed), ['battle']), 'normal').st;
  return { A, V, st: s, b: s.run.battle };
}

/** 找一个能让第一次掷骰落在指定结果上的 rngState（掷骰只取第一个数） */
function rngFor(A, wantWhet) {
  for (let i = 1; i < 20000; i++) {
    const r = A.Random.next(i >>> 0);
    if ((r.value < 0.25) === wantWhet) return i >>> 0;
  }
  throw new Error('找不到合适的 rngState');
}

test('满压的伤害加成只在没裂的人身上是红利', () => {
  const { V } = battleAt(901);
  const cfg = V.Combat.resolveConfig();
  /* 80 档就是 80 档，和以前一样 */
  assert.equal(V.Combat.pressureDamageMultiplier(80), 1.25);
  assert.equal(V.Combat.pressureDamageMultiplier(100), 1.25, '没裂的人顶到 100 还是 1.25');
  /* 裂了之后方向律反转：同一个档位算出来是减益，不是增益 */
  assert.equal(V.Combat.pressureDamageMultiplier(100, { cracked: true }), cfg.crack.damageMult);
  assert.ok(cfg.crack.damageMult < 1, '裂的伤害乘算必须小于 1，否则「反转」是假的');
});

test('裂与砺都能掷出来，且掷一次就锁死', () => {
  const { A, V } = battleAt(902);
  const I = V.Combat._internal;
  const seen = { crack: 0, whet: 0 };

  for (const wantWhet of [false, true]) {
    const { b } = battleAt(902 + (wantWhet ? 1 : 0));
    const u = b.allies[0];
    b.rngState = rngFor(A, wantWhet);
    u.stress = 99;
    I.addStress(b, u, 10);

    assert.equal(u.stress <= 100, true, '压力不得超过 100');
    assert.equal(u.resolveUsed, true, '掷过之后必须锁住');
    const ev = b.logs.filter((l) => l.type === 'resolve').pop();
    assert.ok(ev, '临界判定要进战报，否则玩家只看到数字悄悄变差');
    seen[ev.kind] += 1;

    if (wantWhet) {
      assert.equal(ev.kind, 'whet');
      assert.equal(u.stress, 50, '砺把压力卸回 50');
      assert.equal(u.polishMult, 1.2);
      assert.equal(u.cracked, false);
      assert.equal(u.affliction, null, '砺不留记录');
    } else {
      assert.equal(ev.kind, 'crack');
      assert.equal(u.cracked, true, '裂必须留下标记，界面要显示');
      assert.equal(u.affliction, 'crack', '裂要能带到营地');
      assert.ok(u.polishMult < 1, '裂了抛光要打折');
    }

    /* 再压一次不该再掷——一人一场只此一次 */
    const logsBefore = b.logs.filter((l) => l.type === 'resolve').length;
    u.stress = 100;
    I.addStress(b, u, 10);
    assert.equal(b.logs.filter((l) => l.type === 'resolve').length, logsBefore, '一人一场只掷一次');
  }
  assert.equal(seen.crack, 1);
  assert.equal(seen.whet, 1);
});

test('裂的权重是大头：多掷一轮，裂明显多于砺', () => {
  const { V, b } = battleAt(903);
  const cfg = V.Combat.resolveConfig();
  const I = V.Combat._internal;
  const u = b.allies[0];
  const N = 160;
  let crack = 0;
  let whet = 0;
  for (let i = 0; i < N; i++) {
    /* 复用一个战场，每轮把人还原成「没裂过、顶着满压」的状态再掷 */
    u.cracked = false;
    u.affliction = null;
    u.resolveUsed = false;
    u.polishMult = 1;
    u.stress = 100;
    b.rngState = (i * 2654435761) >>> 0;
    I.addStress(b, u, 1);
    if (u.cracked) crack += 1; else whet += 1;
  }
  const rate = crack / N;
  assert.ok(Math.abs(rate - (1 - cfg.whetChance)) < 0.12,
    `裂的比例应接近 ${(1 - cfg.whetChance) * 100}%，实测 ${Math.round(rate * 100)}%`);
  assert.ok(crack > whet, '满压不该是有利可图的选择');
  assert.ok(whet > 0, '砺要真出得来，否则不如直接写死成惩罚');
});

test('裂的人受伤更重、回裕更慢；抛光倍率真的接进了 energyRegen', () => {
  const { V, b } = battleAt(904);
  const I = V.Combat._internal;
  const src = b.enemies[0];
  const cfg = V.Combat.resolveConfig();

  const hit = (cracked) => {
    const tgt = { ...b.allies[0], cracked, hp: 5000, maxHp: 5000, shield: 0, buffs: [], stats: { taken: 0 } };
    /* 穿刺：绕开 v4.0 的外围节点熔断，这里只测「裂」的受伤倍率 */
    I.applyDamage(b, src, tgt, 100, { pierce: true });
    return 5000 - tgt.hp;
  };
  const plain = hit(false);
  const broken = hit(true);
  assert.equal(broken, Math.max(1, Math.round(plain * cfg.crack.takenMult)),
    `裂的人受的伤应乘 ${cfg.crack.takenMult}，实测 ${plain} → ${broken}`);

  /* 回裕 = 基础 × 压力档 × 抛光倍率 */
  const ok = { side: 'ally', stress: 100, regen: 1, hp: 100, maxHp: 100, polishMult: 1 };
  const broken2 = { ...ok, cracked: true, polishMult: cfg.crack.polishMult };
  assert.ok(V.Combat.energyRegen(broken2) < V.Combat.energyRegen(ok),
    '裂了回裕必须更慢，否则这道悬崖只是换了文案');
  const whetted = { ...ok, stress: 50, polishMult: cfg.whet.polishMult };
  assert.ok(V.Combat.energyRegen(whetted) > V.Combat.energyRegen({ ...ok, stress: 50 }),
    '砺要真的更顺，不能只是个好听的日志');
});

test('带着裂下场，开场就是裂的；结算把裂带回角色', () => {
  const { A, V, st } = boot(905);
  st.roster[0].affliction = 'crack';
  const s = fight(A, setNodes(A, startRun(A, st, 905), ['battle']), 'normal').st;
  const b = s.run.battle;
  const u = b.allies.find((x) => x.sourceUnitId === st.roster[0].id) || b.allies[0];
  assert.equal(u.cracked, true, '上一场没安抚的人，这一场开场就背着裂');
  assert.equal(u.resolveUsed, true, '已经裂过的人本场不再掷');
  assert.ok(u.polishMult < 1);

  /* 结算必须把 affliction 带回去，否则营地永远看不到这道裂 */
  b.over = true;
  b.win = true;
  b.outcome = 'win';
  const pending = V.Combat.prepareResult(s);
  assert.ok(pending.ok, JSON.stringify(pending));
  const delta = pending.pendingResult.runDelta.party.find((d) => d.uid === st.roster[0].id);
  assert.ok(delta, '结算里必须有这个人');
  assert.equal(delta.affliction, 'crack', '裂要带出场，只能靠安抚清');

  /* 安抚是清的出口：不清就没意义 */
  const comforted = V.Roster.comfort({ ...s, gold: 999 }, st.roster[0].id);
  assert.ok(comforted.ok, JSON.stringify(comforted));
  assert.equal(comforted.state.roster.find((x) => x.id === st.roster[0].id).affliction, null);
});

test('临界的数值表齐全，缺字段会当场炸而不是悄悄退化成无效果', () => {
  const { V } = battleAt(906);
  const cfg = V.Combat.resolveConfig();
  for (const k of ['damageMult', 'takenMult', 'polishMult']) {
    assert.equal(typeof cfg.crack[k], 'number', `裂缺少 ${k}`);
  }
  assert.equal(typeof cfg.whet.stress, 'number');
  assert.equal(typeof cfg.whet.polishMult, 'number');
  assert.ok(cfg.whetChance > 0 && cfg.whetChance < 1, '砺的概率要真的在两头之间');
  /* 界面上的词条必须存在，否则悬停会拿到空字符串 */
  assert.ok(V.Terms.text('resolve').length > 20, '裂 / 砺 要有词条');
  assert.ok(V.Terms.text('stress').includes('100'), '压力词条要交代满压会触发判定');
});
