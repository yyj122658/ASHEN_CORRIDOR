'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadVeteran} = require('../helpers/load-veteran.cjs');

// 每种蚀刻法的可复现摆法：[纹路、横格、纵格、顺时针转数、上下翻面]。
const layouts = {
  spark: [["straight",0,0,0,0]],
  corridor5: [["elbow",2,0,0,0],["straight",0,0,0,0]],
  ember12: [["kneejoint",3,1,1,1],["reed",1,0,0,1],["rivet",0,0,0,0],["dogleg",0,1,0,0],["rivet",2,1,0,0],["rivet",0,2,0,0]],
  wide14: [["kneejoint",4,1,1,1],["reed",2,0,0,1],["straight",0,0,0,0],["dogleg",0,1,0,0],["elbow",2,1,0,0]],
  flurry: [["elbow",1,0,0,0],["rivet",0,0,0,0],["straight",0,1,0,0]],
  twinflow: [["reed",1,0,0,1],["rivet",0,0,0,0],["reed",1,1,0,0],["rivet",0,1,0,0]],
  suture: [["elbow",0,0,0,0]],
  bellows: [["straight",0,0,0,0],["straight",0,1,0,0]],
  chalkLine: [["long",0,0,0,0],["rivet",3,0,0,0]],
  sump: [["long",0,0,0,0],["rivet",3,0,0,0],["straight",2,1,0,0]],
  oarlock: [["reed",1,1,2,1],["kneejoint",0,0,0,0]],
  capstan: [["long",1,0,0,0],["rivet",0,0,0,0],["straight",0,1,0,0]],
  millStone: [["elbow",2,1,0,0],["elbow",0,0,0,0]],
  soundingLine: [["reed",1,2,2,1],["kneejoint",0,1,0,0],["rivet",1,0,0,0]],
  copperWick: [["reed",1,0,2,0],["kneejoint",0,1,0,1],["rivet",1,2,0,0]],
  lodestone: [["dogleg",0,0,0,0],["jack",3,1,0,0],["jack",3,0,2,0],["rivet",3,2,0,0]],
};
test('每门蚀刻法都能在真实板面及负荷限制内接通（布线器口径）', () => {
  /* 六标之后不能再用「手写摆法 + 100% 覆盖」来守这条了：
     骨架从 2~14 格扩到 6~54 格，80 门的手写摆法表必然失真。
     现在守的是同一件事的现代版本 —— 在真实板面、真实负荷上限下，
     每门都能被接通（routed），且占格合法。 */
  const A = loadVeteran();
  const V = A.Veteran;
  const { autoRouteBoard } = require('../helpers/veteran-run.cjs');
  const bad = [];
  Object.values(V.Data.MANUSCRIPTS).forEach((spec) => {
    const st = V.State.create(42);
    const unit = V.State.makeUnit(st, { skinId: 'blade', bodyPreset: 'sturdy', name: '试' });
    unit.manuscript = null;
    delete unit.extraManuscripts;
    st.roster.push(unit);
    st.team[0] = unit.id;
    V.State.equipManuscript(st, unit, spec.id);
    const r = autoRouteBoard(A, st, unit, { style: 'elbow' });
    if (!r.ok) { bad.push(spec.id + ':' + (r.reason || '未接通')); return; }
    if (!(r.route.path.length >= 2)) bad.push(spec.id + ':通路太短');
    if (!(r.cap > 0) || r.load > r.cap) bad.push(spec.id + ':超载');
  });
  assert.deepEqual(bad, []);
});

test('单件同心纹压不满一整块骨架：部分覆盖不给共鸣阶，也接不通', () => {
  /* 六标之前这条测的是「一件同心纹正好压住 2 格扣钉 → 满覆盖得阶」。
     骨架扩到 6 格以上之后，「一件压满」这件事本身就不存在了 ——
     于是这条守的语义也换成它真正想守的东西：**覆盖不满就没有共鸣阶，也接不通**。
     这正是「蚀刻法与纹路分层」的意思：纹路是填充，不是凭一件就点亮的开关。 */
  const V = loadVeteran().Veteran;
  const st = V.State.create(42);
  const item = V.State.makePart(st, { templateId: 'capacitor' });
  st.itemsById[item.id] = item;
  const idx = V.Manuscript.pieceIndex(V.Circuit.layout(st, [{ itemId: item.id, x: 0, y: 0 }]));
  Object.values(V.Data.MANUSCRIPTS).forEach((raw) => {
    const ms = V.Manuscript.normalize(raw);
    if (!ms || ms.cells.length <= 4) return;
    const cov = V.Manuscript.coverage(ms, 0, 0, idx);
    assert.ok(cov.pct < 100, raw.name + ' 单件不该满覆盖（实际 ' + cov.pct + '%）');
    assert.equal(V.Manuscript.route(ms, 0, 0, idx).ok, false, raw.name + ' 单件不该接通');
  });
});
