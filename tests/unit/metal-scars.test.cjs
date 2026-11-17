'use strict';
/* 瘢痕属于底层金属，装配只决定它当前是否生效。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

test('瘢痕只在被填充时生效，拆下纹路不抹掉来源记录', () => {
  const V = loadVeteran().Veteran;
  const st = V.State.create(42);
  const u = st.roster[0];
  const cell = V.Circuit.layout(st, u.board.placements).cells[0];
  u.manuscript = null;
  u.scars = [{ x: cell.x, y: cell.y, templateId: 'ember', source: '余烬纹', floor: 1, runId: 'run1' }];
  /* 只比「有瘢痕 / 无瘢痕」这一项：板面本身也贡献阻抗，
     拿空板面（[]）当基准会把纹路给的那份阻抗也算进差值里。 */
  const filled = V.Roster.stats(st, u);
  u.scars = [];
  const empty = V.Roster.stats(st, u);
  u.scars = [{ x: cell.x, y: cell.y, templateId: 'ember', source: '余烬纹', floor: 1, runId: 'run1' }];
  assert.equal(filled.atk, empty.atk + 2);
  /* 阻抗有 0 下限：裸板本来就是 0，瘢痕的 −1 只能压到 0 */
  assert.equal(filled.def, Math.max(0, empty.def - 1));
  assert.equal(u.scars[0].source, '余烬纹');
  assert.equal(V.Circuit.scarState(st, u, [])[0].active, false);
});

test('蚀刻法填充也能激活瘢痕', () => {
  const V = loadVeteran().Veteran;
  const st = V.State.create(42);
  const u = st.roster[0];
  const m = V.Manuscript.orient(V.Manuscript.normalize(u.manuscript), u.manuscript.rotation, u.manuscript.mirrorY);
  const [x, y] = m.cells[0];
  u.scars = [{ x: x + u.manuscript.x, y: y + u.manuscript.y, templateId: 'ember', source: '余烬纹', floor: 1, runId: 'run1' }];
  assert.equal(V.Circuit.scarState(st, u, [])[0].active, true);
  /* v4.0：幅值基数恒为 10（心核基座），余烬纹的瘢痕再给 +2 */
  const base = V.Derive.chassis(V.Data.body(u.bodyPreset)).atk;
  assert.equal(base, 10, '心核基座的幅值应是 10');
  assert.equal(V.Roster.stats(st, u, []).atk, base + 2);
});

test('旧档没有瘢痕仍能读取，越界、重叠与伪造来源被拒绝', () => {
  const V = loadVeteran().Veteran;
  const st = V.State.create(42);
  st.roster.forEach((u) => delete u.scars);
  assert.equal(V.Storage.decode(V.Storage.encode(st)).ok, true);
  st.roster[0].scars = [{ x: 99, y: 99, templateId: 'ember', source: '余烬纹', floor: 1, runId: 'run1' }];
  assert.equal(V.State.validate(st).ok, false);
  const [x, y] = V.Circuit.plateOf(st.roster[0]).cellsList[0];
  const scar = { x, y, templateId: 'ember', source: '余烬纹', floor: 1, runId: 'run1' };
  st.roster[0].scars = [scar, { ...scar }];
  assert.equal(V.State.validate(st).ok, false);
  st.roster[0].scars = [{ ...scar, templateId: 'not-a-rune' }];
  assert.equal(V.State.validate(st).ok, false);
});

test('导入拒绝藏在遭遇检查点中的坏瘢痕，避免回转后崩溃', () => {
  const V = loadVeteran().Veteran;
  let st = V.Expedition.start(V.State.create(42), { seed: 42 }).state;
  const node = st.run.nodes.find((n) => n.risk !== 'none');
  st = V.Encounter.open(st, node.id).state;
  st.run.encounter.checkpoint.roster[0].scars = 'bad';
  assert.equal(V.Storage.decode(V.Storage.encode(st)).ok, false);
});

test('旧制式瘢痕按模板显示现名，保留自定义和原始存档来源', () => {
  const V = loadVeteran().Veteran;
  const st = V.State.create(42);
  const u = st.roster[0];
  const [x, y] = V.Circuit.plateOf(u).cellsList[0];
  for (const tpl of Object.values(V.Data.TEMPLATES)) {
    u.scars = [{ x, y, templateId: tpl.id, source: tpl.legacyName, floor: 1, runId: 'legacy' }];
    const before = V.Storage.encode(st);
    assert.equal(V.Circuit.scarState(st, u)[0].source, tpl.name);
    assert.equal(V.Storage.encode(st), before);
  }
  for (const source of ['余烬导管', '我留下的细痕', '脉冲储能腔旁']) {
    u.scars[0] = { ...u.scars[0], templateId: 'capacitor', source };
    assert.equal(V.Circuit.scarState(st, u)[0].source, source);
  }
});
