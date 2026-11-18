'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadVeteran} = require('../helpers/load-veteran.cjs');

test('每门蚀刻法都能在真实板面及负荷限制内接通（布线器口径）', () => {
  /* 浑沌未凿能装下全部完整轮廓，按实板负荷检验布线器。 */
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
    assert.deepEqual(unit.manuscript?.cells, spec.cells, `${spec.id} 应完整装配`);
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
