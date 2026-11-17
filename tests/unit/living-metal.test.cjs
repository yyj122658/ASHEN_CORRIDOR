'use strict';
/* 生命金属身份：14 种形态共用一份面板预算，格数不再偷偷决定战斗力。
   这一组锁住 derive.js 的三条契约：权重守恒、面板可区分、负荷只跟格数走。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const V = loadVeteran().Veteran;
const D = V.Data;
const DER = V.Derive;
const BODY_IDS = Object.keys(D.BODIES);

test('v4.0：十四相只剩节拍差异，心核基座对所有人一样', () => {
  assert.equal(BODY_IDS.length, 14, '金属形态应该是 14 种');
  const spds = new Set();
  BODY_IDS.forEach((id) => {
    const body = D.BODIES[id];
    const w = DER.normalized(body.profile);
    const sum = w.hp + w.atk + w.def + w.spd;
    assert.ok(Math.abs(sum - 1) < 1e-9, `${body.name} 的权重和是 ${sum}，应归一`);

    const c = DER.chassis(body);
    /* 攻/防/血是心核基座，十四相完全一致；只有节拍（spd）随形态走 */
    assert.equal(c.maxHp, 25, `${body.name} 的结构完整度基座应是 25`);
    assert.equal(c.atk, 10, `${body.name} 的脉冲幅值基座应是 10`);
    assert.equal(c.def, 0, `${body.name} 的回路阻抗基座应是 0`);
    assert.equal(c.shieldCap, 0, `${body.name} 的电容缓冲基座应是 0`);
    assert.ok(c.spd >= 1 && c.spd <= 20, `${body.name} 节拍 ${c.spd} 越界`);
    spds.add(c.spd);
  });
  assert.ok(spds.size >= 6, `十四相的节拍应该拉开档次，实际只有 ${spds.size} 种`);
});

test('心核基座只认节拍：权重写歪了也只影响 spd', () => {
  const base = DER.chassis({ profile: DER.BASE });
  assert.equal(base.spd, 10, 'BASE 节拍应还原成 10');
  assert.equal(base.maxHp, 25);
  assert.equal(base.atk, 10);

  /* 整体放大两倍 → 归一化后与 BASE 完全相同 */
  const double = DER.chassis({ profile: { hp: 0.80, atk: 0.48, def: 0.36, spd: 0.36 } });
  assert.deepEqual({ ...double }, { ...base }, '整体放大不该变强');
  assert.deepEqual({ ...DER.chassis(null) }, { ...base }, '缺 profile 退回基座');
  assert.deepEqual({ ...DER.chassis({ profile: { hp: 0, atk: 0, def: 0, spd: 0 } }) }, { ...base }, '空权重退回基座');
});

test('形态只改节拍：攻防血不随形态浮动', () => {
  const heavy = DER.chassis(D.BODIES.aegis);
  const light = DER.chassis(D.BODIES.agile);
  assert.equal(heavy.maxHp, light.maxHp, '完整度不再由形态决定');
  assert.equal(heavy.atk, light.atk, '幅值不再由形态决定');
  assert.equal(heavy.def, light.def, '阻抗不再由形态决定');
  assert.ok(heavy.spd < light.spd, '覆盾该更慢');
});

test('角色面板来自拓扑编译：装上纹路才涨，不是天生就大', () => {
  const st = V.State.create(42);
  st.roster.forEach((u) => {
    const body = D.body(u.bodyPreset);
    const chassis = DER.chassis(body);
    const s = V.Roster.stats(st, u);
    /* 幅值基座恒为 10（纹路只改「打出去的倍率」，不改 atk 本身） */
    assert.equal(s.atk, chassis.atk, `${u.name} 的幅值应等于基座`);
    assert.equal(s.spd, chassis.spd, `${u.name} 的节拍应等于基座`);
    /* 完整度 = 25 + 占格×2.5 + 闭环×12，所以一定不低于基座 */
    assert.ok(s.maxHp >= chassis.maxHp, `${u.name} 的完整度不该低于基座`);
    assert.ok(Number.isFinite(s.shieldCap) && s.shieldCap >= 0, '缓冲上限必须是数');
    assert.ok(s.panel && typeof s.panel.usedCells === 'number', '面板应带上拓扑事实');
    /* 底盘上不该再挂战斗字段 */
    assert.equal(body.hp, undefined, '底盘不该再有 hp');
    assert.equal(body.atk, undefined, '底盘不该再有 atk');
    assert.equal(body.loadCap, undefined, '底盘不该再有 loadCap');
  });
});

test('拓扑面板公式：占格与闭环直接换算成完整度', () => {
  const st = V.State.create(7, { classicPlate: true });
  const u = st.roster[0];
  const pv = V.Circuit.preview(st, u.id, u.board.placements);
  assert.ok(pv.ok, pv.errors.join(' '));
  const panel = V.Circuit.panelOf(st, u, u.board.placements, pv);
  const used = new Set(pv.occupied.map((c) => c[0] + ',' + c[1])).size;
  assert.equal(panel.usedCells, used);
  /* 八标：闭环只认前 3 个（+18 封顶），多余环路转去脉冲乘区，不再无限堆完整度 */
  const P = V.Circuit.PULSE;
  assert.equal(panel.maxHp, 25 + Math.round(used * P.hpPerCell) + Math.min(panel.loops, P.loopHpCap) * P.hpPerLoop);
  assert.ok(panel.def >= 0 && panel.def <= 20 + 200, '阻抗应是覆盖率与元件的合成');
});

test('负荷上限只由格数派生：经典夹具 14 格 8 点，异形 77 格 55 点', () => {
  const classic = V.State.create(42, { classicPlate: true });
  classic.roster.forEach((u) => {
    const cells = V.Circuit.plateOf(u).cells.size;
    assert.equal(cells, 14, '经典板仍是 4x4 扣掉两个屏蔽格');
    const sturdy = D.body(u.bodyPreset).innate.id === 'sturdy';
    const expect = Math.round(Math.round(cells * D.DESIGN.capPerCell) * (sturdy ? 1.35 : 1));
    assert.equal(V.Circuit.loadCap(u), expect);
    assert.equal(V.Roster.stats(classic, u).loadCap, expect, '经典板负荷 8（厚铸为 11）');
  });

  const fresh = V.State.create(42);
  fresh.roster.forEach((u) => {
    const cells = V.Circuit.plateOf(u).cells.size;
    assert.equal(cells, V.PlateGen.PLATE_TARGET, `${u.name} 应拿到 77 格`);
    /* 异形板面走自己的系数：44 点太宽，装满 4 门也触发不了超载，负荷系统会整条空转 */
    /* 无相包容（厚铸躯壳）的母板负荷 +35%，其余相走基准 */
    const sturdy = D.body(u.bodyPreset).innate.id === 'sturdy';
    const expect = Math.round(Math.round(cells * D.DESIGN.generatedCapPerCell) * (sturdy ? 1.35 : 1));
    assert.equal(V.Circuit.loadCap(u), expect, `${u.name}（${D.body(u.bodyPreset).innate.id}）负荷上限不符`);
    assert.equal(V.Roster.stats(fresh, u).loadCap, expect, '77 格 → 20 点（厚铸为 27）');
  });

  /* 两套系数必须分开存在：合回一个数，夹具和真游戏就会互相污染 */
  assert.notEqual(D.DESIGN.capPerCell, D.DESIGN.generatedCapPerCell);
  /* 六标：系数的高低关系反过来了 —— 骨架扩到 6~54 格之后，异形板必须给得起 55 点
     才压得满大卷；经典夹具 14 格 × 0.57 = 8 点，仍是「小盘子」尺度。
     真正要守的是「两套系数分开存在、各自服务于自己的盘面」，不是谁大谁小。 */
  assert.ok(77 * D.DESIGN.generatedCapPerCell > 3 * (14 * D.DESIGN.capPerCell),
    '异形板的绝对负荷应远大于经典夹具');
});

test('14 位传奇一人一型，金属互不重复', () => {
  assert.equal(D.SKINS.length, 14, '金属缩到 14，传奇也缩到 14');
  const metals = D.SKINS.map((skin) => skin.metal);
  assert.equal(new Set(metals).size, 14, '一型一人，不该有两个人共用一种金属');
  assert.deepEqual([...metals].sort(), Object.keys(D.BODIES).sort(), '十四型都要有人');
  D.SKINS.forEach((skin) => {
    assert.ok(D.BODIES[skin.metal], `${skin.name} 的金属 ${skin.metal} 不存在`);
  });
});

test('营地里东西两边的人都有：族属齐全、两边都不少于五人、叫法跟着族属走', () => {
  const east = D.SKINS.filter((s) => s.culture === 'east');
  const west = D.SKINS.filter((s) => s.culture === 'west');
  D.SKINS.forEach((s) => {
    /* 族属只有两种，且必须明确——没有「两边都算」的人，否则界面不知道给他哪套叫法 */
    assert.ok(s.culture === 'east' || s.culture === 'west', `${s.name} 的族属是「${s.culture}」`);
    assert.ok(s.origin && s.origin.length >= 4, `${s.name} 没有出身地，立绘就没法定服饰`);
  });
  assert.equal(east.length + west.length, 14, '每个传奇都得归到一边');
  /* 混着才有意义：一边倒就不叫混了，两边都得成规模 */
  assert.ok(east.length >= 5, `东边只有 ${east.length} 人，太少`);
  assert.ok(west.length >= 5, `西边只有 ${west.length} 人，太少`);

  /* 同一块板，两边的人叫法不同；而且每个人报出来的必须是自己那套 */
  D.SKINS.forEach((s) => {
    const c = D.cultureOf(s.id);
    assert.equal(c, s.culture, `${s.name} 的族属查表不一致`);
    const own = D.bodyStyle(s.metal, c);
    const other = c === 'east' ? D.bodyWest(s.metal).zh : D.bodyStyle(s.metal);
    assert.ok(own && own.length >= 2, `${s.name} 报不出自己那套相名`);
    assert.notEqual(own, other, `${s.name} 两套叫法撞在一起了：「${own}」`);
  });

  /* 不传族属时退回东土那套，老调用点不能因此拿到空字符串 */
  assert.equal(D.bodyStyle('sturdy'), V.PlateGen.ARCHETYPES.full.name);
  assert.equal(D.cultureOf('不存在的皮肤'), 'east');
});

test('出身落在《世界观总纲》的两块大陆、六个国家上：东=苍梧三国，西=奥伦三国', () => {
  const CANGWU = ['钧天', '琉光', '朔方'];
  const AUREN = ['格雷沙姆', '沃尔芬', '碎片地带'];
  const homes = {};
  D.SKINS.forEach((s) => {
    assert.ok(s.home, `${s.name} 没有国家——那样「出身」就只是一句形容词`);
    /* 东边的人只能来自苍梧，西边的人只能来自奥伦：两块大陆走的不是一条路 */
    const pool = s.culture === 'east' ? CANGWU : AUREN;
    assert.ok(pool.includes(s.home), `${s.name} 属${s.culture === 'east' ? '东' : '西'}，却来自「${s.home}」`);
    /* culture 由 home 推出来，不许两处各写一遍——写两遍迟早把琉光的人标成西边 */
    assert.equal(s.culture, D.HOME_SIDE[s.home], `${s.name} 的族属和国别对不上`);
    assert.equal(D.homeOf(s.id), s.home, `${s.name} 的国别查表不一致`);
    homes[s.home] = (homes[s.home] || 0) + 1;
  });
  /* 六个国家都得有人，否则「六国混在一座营地里」只是句空话 */
  [...CANGWU, ...AUREN].forEach((h) => {
    assert.ok(homes[h] >= 1, `没有一个人来自${h}`);
    const one = D.SKINS.find((s) => s.home === h);
    assert.ok(D.originOf(one.id).includes(h), `${h} 的出身串里没写出国名`);
  });
  /* 出身要具体到衙门/产线/塔，不能只写国名——立绘是照这个定服饰和光的 */
  D.SKINS.forEach((s) => {
    assert.ok(s.origin && s.origin.length >= 4, `${s.name} 的出身太笼统：「${s.origin}」`);
    assert.ok(D.originOf(s.id).startsWith(s.home + ' · '), `${s.name} 的出身串不完整：${D.originOf(s.id)}`);
  });
  assert.equal(D.SKINS.filter((s) => s.culture === 'east').length, 7, '东七');
  assert.equal(D.SKINS.filter((s) => s.culture === 'west').length, 7, '西七');
});

test('十四相各有其名：正名有出处、长短参差、十四相不重名', () => {
  const ids = Object.keys(D.BODIES);
  const names = ids.map((id) => D.bodyStyle(id));
  names.forEach((n, i) => {
    /* 正名是从旧书里摘的现成词，原文多长就是多长，摘词的人不削平，所以只约束 2~5 字 */
    assert.ok(n && n.length >= 2 && n.length <= 5, `${ids[i]} 的相名应是 2~5 个字，实际「${n}」`);
  });
  assert.equal(new Set(names).size, 14, `十四相不该重名：${names.join('/')}`);
  /* 名字长短必须参差：若十四相全落在同一个字数上，读起来就是同一句话复读十四遍 */
  const lens = [...new Set(names.map((n) => n.length))];
  assert.ok(lens.length >= 3, `十四相的字数该有至少三种，实际只有 ${lens.join('/')}`);
  ids.forEach((id) => {
    const arch = D.BODIES[id].archetype;
    /* 相名必须和 plate-gen 里的正名对得上，否则界面上会显示一个不存在的相 */
    assert.equal(D.bodyStyle(id), V.PlateGen.ARCHETYPES[arch].name, `${id} → ${arch} 相名不一致`);
    /* 每个正名都得报得出出处——摘词是这套命名的全部理由，没出处的名字就是自己编的 */
    const src = V.PlateGen.ARCHETYPES[arch].source;
    assert.ok(src && src.length >= 6, `${id}（${arch}）的正名没有出处`);
  });
});

test('圣髑院另有十四相西名：每相都有西名、中文、形制，且互不重复', () => {
  const ids = Object.keys(D.BODIES);
  const west = ids.map((id) => D.bodyWest(id));
  west.forEach((w, i) => {
    assert.ok(w.name && w.name.length >= 3, `${ids[i]} 没有西名（原文）`);
    assert.ok(w.zh && w.zh.length >= 2, `${ids[i]} 的西名没有中文写法`);
    assert.ok(w.form && w.form.length >= 3, `${ids[i]} 的西名没有归入形制`);
  });
  assert.equal(new Set(west.map((w) => w.name)).size, 14, '十四相西名不该重复');
  assert.equal(new Set(west.map((w) => w.zh)).size, 14, '十四相西名的中文写法不该重复');
  /* 以西名为主名时不能跟东名撞车，否则界面上分不清说的是哪一套 */
  const zh = west.map((w) => w.zh);
  const east = ids.map((id) => D.bodyStyle(id));
  assert.equal(zh.filter((n) => east.includes(n)).length, 0, '西名的中文写法不该和东名重字');
});

test('招募卡预览的板面与招入后完全一致，且不制造退役武器', () => {
  let st = V.Roster.refreshShop(V.State.create(42), false).state;
  st.gold = 1000;
  const offer = st.shop[0];
  assert.ok(D.BODIES[offer.bodyPreset], '招募位要写明金属形态');
  assert.equal(offer.plateSeed, V.State.plateSeedFor(offer.skinId), '预览 seed 必须与实物同源');

  const before = JSON.stringify(V.Circuit.plateOf(offer).cellsList);
  const weapons = Object.values(st.itemsById).filter((item) => item.kind === 'weapon').length;
  const r = V.Roster.recruit(st, offer.id);
  assert.equal(r.ok, true);
  const unit = r.state.roster.at(-1);
  assert.equal(unit.bodyPreset, offer.bodyPreset, '招入后金属不能换');
  assert.equal(unit.plateSeed, offer.plateSeed, '招入后 seed 不能换');
  assert.equal(JSON.stringify(V.Circuit.plateOf(unit).cellsList), before, '板面必须一模一样');
  assert.equal(Object.values(r.state.itemsById).filter((item) => item.kind === 'weapon').length, weapons);
  assert.equal(V.State.validate(r.state).ok, true);
});
