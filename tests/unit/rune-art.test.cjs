'use strict';
/* 纹章切片的朝向必须和电路逻辑完全一致：
   否则画出来是「旋转过的图」，端口却算在别处。
   这里不重算旋转规则，直接把 V.RuneArt.matrixFor 的输出和
   V.Circuit.layout 的真实格子逐一对比（6 模板 × 4 旋转 × 2 翻转）。 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const RA = A.Veteran.RuneArt;
const Circuit = A.Veteran.Circuit;
const Data = A.Veteran.Data;

function fakeState() {
  const itemsById = {};
  Object.keys(RA.RUNES).forEach((tid) => {
    itemsById['it_' + tid] = { id: 'it_' + tid, kind: 'circuit', templateId: tid };
  });
  return { itemsById };
}

const STATE = fakeState();
const IDS = Object.keys(RA.RUNES);
/* 已进 data.js 的模板；第二批（rivet/long/tee/cross）只有美术，TEMPLATES 待补 */
const IN_DATA = IDS.filter((id) => Data.TEMPLATES[id]);

test('已在 data.js 的纹章，格数与模板一致', () => {
  assert.equal(IN_DATA.length, 6);
  IN_DATA.forEach((tid) => {
    const tpl = Data.TEMPLATES[tid];
    assert.ok(tpl, `${tid} 不在 TEMPLATES 里`);
    const rune = RA.rune(tid);
    const cells = tpl.cells;
    const cols = Math.max.apply(null, cells.map((c) => c[0])) + 1;
    const rows = Math.max.apply(null, cells.map((c) => c[1])) + 1;
    assert.equal(rune.cols, cols, `${tid} 列数`);
    assert.equal(rune.rows, rows, `${tid} 行数`);
  });
});

test('matrixFor 与 layout 的格子逐一吻合（含旋转与翻转）', () => {
  IN_DATA.forEach((tid) => {
    const tpl = Data.TEMPLATES[tid];
    const baseCells = tpl.cells.map((c) => ({ x: c[0], y: c[1] }));
    for (let rot = 0; rot < 4; rot++) {
      [false, true].forEach((mir) => {
        const L = Circuit.layout(STATE, [{
          itemId: 'it_' + tid, x: 0, y: 0, rotation: rot, mirrorY: mir,
        }]);
        const got = new Set(L.built[0].abs.map((c) => c.x + ',' + c.y));

        const m = RA.matrixFor(tid, rot, mir);
        /* 用格心而不是格角：翻转会把格角映射到另一角，格心才有唯一的落格 */
        const want = new Set(baseCells.map((c) => {
          const px = c.x + 0.5;
          const py = c.y + 0.5;
          const x = m[0] * px + m[2] * py + m[4];
          const y = m[1] * px + m[3] * py + m[5];
          return Math.floor(x + 1e-6) + ',' + Math.floor(y + 1e-6);
        }));

        assert.deepEqual([...want].sort(), [...got].sort(),
          `${tid} rot=${rot} mirror=${mir}`);
      });
    }
  });
});

test('sizeFor 与实际占用包围盒一致', () => {
  IN_DATA.forEach((tid) => {
    for (let rot = 0; rot < 4; rot++) {
      const L = Circuit.layout(STATE, [{
        itemId: 'it_' + tid, x: 0, y: 0, rotation: rot, mirrorY: false,
      }]);
      const xs = L.built[0].abs.map((c) => c.x);
      const ys = L.built[0].abs.map((c) => c.y);
      const size = RA.sizeFor(tid, rot);
      assert.equal(size.cols, Math.max.apply(null, xs) + 1, `${tid} rot=${rot} 列`);
      assert.equal(size.rows, Math.max.apply(null, ys) + 1, `${tid} rot=${rot} 行`);
    }
  });
});

test('第二批纹章（单格/长条/三通/四通）已登记且格数正确', () => {
  const expect = { rivet: [1, 1], long: [3, 1], tee: [3, 2], cross: [3, 3] };
  Object.keys(expect).forEach((id) => {
    const r = RA.rune(id);
    assert.ok(r, `${id} 应该已登记`);
    assert.deepEqual([r.cols, r.rows], expect[id], `${id} 格数`);
    assert.ok(r.dir.indexOf('rune-set-v2') >= 0, `${id} 应指向第二批目录`);
  });
});

test('image() 输出带 matrix、尺寸按格距与朝向变化', () => {
  const flat = RA.image('straight', { x: 34, y: 26, cell: 60, rotation: 0 });
  assert.ok(flat.includes('assets/art/rune-set-v1/grid/straight.png'));
  /* 几何在「格」单位里算，格距靠外层 scale 放大 */
  assert.ok(flat.includes('translate(34,26) scale(60)'));
  assert.ok(flat.includes('width="2"') && flat.includes('height="1"'), '直导管 2x1 格');

  const turned = RA.image('straight', { x: 0, y: 0, cell: 60, rotation: 1 });
  assert.ok(turned.includes('width="2"'), '原画尺寸不随旋转改变');
  const m0 = RA.matrixFor('straight', 0, false);
  const m1 = RA.matrixFor('straight', 1, false);
  assert.notDeepEqual(m0, m1);
  const p = RA.image('splitter', { x: 0, y: 0, cell: 60, rotation: 0 });
  assert.ok(p.includes('height="3"'), '棱镜分流 2x3 格');
  assert.equal(RA.image('nope', {}), '');
});

test('thumb() 指向同一切片，未知模板返回空串', () => {
  assert.ok(RA.thumb('elbow').includes('grid/elbow.png'));
  assert.equal(RA.thumb('nope'), '');
});
