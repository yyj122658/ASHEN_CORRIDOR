'use strict';
/* 纹路切片的朝向必须和电路逻辑完全一致：
   否则画出来是「旋转过的图」，端口却算在别处。
   这里不重算旋转规则，直接把 V.RuneArt.matrixFor 的输出和
   V.Circuit.layout 的真实格子逐一对比（全部纹路 × 4 旋转 × 2 翻转）。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadVeteran, ROOT } = require('../helpers/load-veteran.cjs');

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
const IN_DATA = IDS.filter((id) => Data.TEMPLATES[id]);

test('蜡膜按集合合并边界，保留内孔并分开对角相触的区域', () => {
  assert.match(RA.contourPath([[0, 0], [1, 0]], 60), /^M0 0L120 0L120 60L0 60Z$/);
  assert.equal(RA.contourPath([[0, 0], [0, 0]], 60), RA.contourPath([[0, 0]], 60));
  const ring = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
  assert.equal((RA.contourPath(ring, 60).match(/Z/g) || []).length, 2);
  assert.equal((RA.contourPath([[0, 0], [1, 1]], 60).match(/Z/g) || []).length, 2);
});

test('管道双态与信标、战损图集通过美术注册表寻址', () => {
  for (const id of IDS) {
    const idle = A.Art.getArt('conduit.idle.' + id);
    const powered = A.Art.getArt('conduit.powered.' + id);
    const hot = A.Art.getArt('conduit.hot.' + id);
    assert.ok(idle?.src.endsWith('/idle/' + id + '.png'), id);
    assert.ok(powered?.src.endsWith('/powered/' + id + '.png'), id);
    assert.ok(hot?.src.endsWith('/hot/' + id + '.png'), id);
    const {cols, rows} = RA.rune(id);
    for (const {src} of [idle, powered, hot]) {
      const bytes = fs.readFileSync(path.join(ROOT, src));
      assert.equal(bytes.toString('ascii', 1, 4), 'PNG', src);
      assert.equal(bytes.readUInt32BE(16), cols * 64, src);
      assert.equal(bytes.readUInt32BE(20), rows * 64, src);
    }
    assert.ok(RA.image(id).includes(idle.src), id);
  }
  assert.match(RA.conduitTile(32, 0, 0, 64), /conduit\/blueprint\.png/);
  assert.match(RA.conduitOverlay('fuse', 32, 32, 64), /conduit\/overlays\.png/);
});

test('已在 data.js 的纹路，格数与模板一致', () => {
  assert.ok(Data.TEMPLATE_ORDER.length >= 30);
  assert.deepEqual(IN_DATA.slice().sort(), Data.TEMPLATE_ORDER.slice().sort());
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

test('板面、旋转预览和缩略图共用凹刻笔画，不请求管件切片', () => {
  for (const id of IDS) {
    const shape = RA.rune(id);
    const texture = fs.readFileSync(path.join(ROOT, 'assets/art/topology-v4/relief', id + '.webp'));
    assert.equal(texture.toString('ascii', 8, 12), 'WEBP');
    const flat = RA.image(id, { x: 34, y: 26, cell: 60 });
    const turned = RA.image(id, { rotation: 1, mirrorY: true });
    assert.ok(flat.includes('translate(34,26) scale(60)'));
    assert.ok(turned.includes('matrix(' + RA.matrixFor(id, 1, true).join(',') + ')'));
    for (const svg of [flat, turned, RA.thumb(id)]) {
      assert.ok(svg.includes(shape.engraving) && svg.includes('etched-grain'), id);
      assert.doesNotMatch(svg, /rune-set-/);
      assert.ok(svg.includes(`assets/art/topology-v4/conduit/idle/${id}.png`), id);
    }
    assert.ok(turned.includes(`width="${shape.cols}" height="${shape.rows}"`));

  }
  assert.equal(RA.thumb('nope'), '');
  assert.equal(RA.image('nope', {}), '');
});

test('纹路烘焙轨迹在所有朝向匹配结算使用的内部连通链', () => {
  const M = A.Veteran.Manuscript;
  const centerLine = chain => {
    const [dx1, dy1] = M.ORTH[chain.inDir];
    const [dx2, dy2] = M.ORTH[chain.outDir];
    const centers = chain.cells.map(c => [c.x + .5, c.y + .5]);
    const [ax, ay] = centers[0], [bx, by] = centers.at(-1);
    return [[ax + dx1/2, ay + dy1/2], ...centers, [bx + dx2/2, by + dy2/2]];
  };
  for (const tpl of Object.values(Data.TEMPLATES)) {
    for (const rot of [0, 1, 2, 3]) for (const mirror of [false, true]) {
      const t = Circuit.transformTemplate(tpl, rot, mirror);
      const matrix = RA.matrixFor(tpl.id, rot, mirror);
      const [a, b, c, d, e, f] = matrix;
      const artwork = RA.rune(tpl.id).traces.map(trace =>
        trace.map(([x, y]) => [a*x + c*y + e, b*x + d*y + f]));
      assert.deepEqual(artwork, M.internalChains(t.cells, t.ports).map(centerLine), tpl.id);
    }
  }
});

test('固定蚀刻法有实际烘焙资产，裁切变体不会借用原谱的图', () => {
  const M = A.Veteran.Manuscript;
  assert.equal(Object.keys(RA.ETCHINGS).length, 80);
  for (const base of Object.values(RA.ETCHINGS)) {
    const src = `assets/art/topology-v4/etch-relief/${base.id}.webp`;
    assert.ok(fs.existsSync(path.join(ROOT, src)));
    for (const rot of [0, 1, 2, 3]) {
      assert.ok(RA.etchImage(M.orient(base, rot, true), 60).includes(src), base.id);
    }
    assert.equal(RA.etchImage({...base, cells: base.cells.slice(1)}, 60), '');
  }
});

test('每种新纹路可以装入实际角色板面、取得同向收益、形成对应瘢痕', () => {
  const V = A.Veteran;
  for (const tpl of Object.values(Data.TEMPLATES).filter((t) => t.family)) {
    const st = V.State.create(42);
    const u = st.roster[0];
    const item = V.State.makePart(st, { kind: 'circuit', templateId: tpl.id });
    st.itemsById[item.id] = item;
    st.stash.push(item.id);
    const placement = V.Circuit.suggestPlacement(st, u, [], item.id, null);
    assert.ok(placement, tpl.name);
    const saved = V.Roster.saveBoard(st, u.id, [placement]);
    assert.ok(saved.ok, tpl.name);
    assert.ok(V.State.validate(saved.state).ok, tpl.name);
    const run = V.Expedition.start(saved.state).state;
    const scar = V.Expedition.inscriptionScar(run, u.id, item.id, [placement]);
    assert.equal(scar.templateId, tpl.id);
    const unit = V.State.unitById(run, u.id);
    unit.scars = [scar];
    const active = V.Circuit.scarState(run, unit, [placement])[0];
    assert.ok(active.active && Object.values(active.effect).some((v) => v > 0) && Object.values(active.effect).some((v) => v < 0), tpl.name);
    const part = V.Circuit.layout(run, [placement]).built[0];
    const port = part.aps[0];
    unit.manuscript = { ...Data.manuscript('spark'), x: port.cell[0], y: port.cell[1],
      cells: [[0,0]], veins: { '0,0': [port.dir] }, entry: [0,0], exits: [[0,0]], rotation: 0, mirrorY: false };
    const match = V.Circuit.manuscriptState(run, u.id, [placement]);
    assert.equal(match.pct, 100, tpl.name);
    /* 增益按对上的端口比例给：这里只有一格对上，所以只拿 1/端口数 */
    const ports = new Set(part.aps.map((p) => p.cell.join(','))).size;
    for (const [key, amount] of Object.entries(tpl.boost)) {
      assert.ok(Math.abs(match.effects.boost[key] - amount / ports) < 1e-9, `${tpl.name} 的 ${key} 应按端口比例折算`);
    }
    assert.ok(RA.image(tpl.id, { rotation: 2 }).length > 0);
    assert.ok(RA.thumb(tpl.id).length > 0);
  }
});

test('宝箱、商人和胜利掉落的实际物品池都能产出全部纹路', () => {
  const V = A.Veteran;
  const state = V.Expedition.start(V.State.create(42, { classicPlate: true })).state;
  state.run.nodes = ['chest', 'merchant', 'battle'].map(type => ({ id: type, type, consumed: false }));
  const battle = V.Encounter.startAttempt(V.Expedition.chooseNode(state, 'battle').state).state;
  battle.run.battle.over = true;
  battle.run.battle.outcome = 'win';
  const seen = { chest: new Set(), merchant: new Set(), battle: new Set() };
  for (let i = 1; i <= 512 && Object.values(seen).some((ids) => ids.size < Data.TEMPLATE_ORDER.length); i++) {
    state.rngState = (i * 2654435761) >>> 0;
    const chest = V.Expedition.chooseNode(state, 'chest').state;
    chest.run.pendingLoot.forEach((id) => seen.chest.add(chest.itemsById[id].templateId));
    const shop = V.Expedition.chooseNode(state, 'merchant').state;
    shop.run.shop.forEach(({ itemId }) => seen.merchant.add(shop.itemsById[itemId].templateId));
    battle.run.battle.rngState = state.rngState;
    V.Combat.prepareResult(battle);
    const win = V.Encounter.confirm(battle).state;
    win.run.pendingLoot.forEach((id) => seen.battle.add(win.itemsById[id].templateId));
  }
  for (const [source, ids] of Object.entries(seen)) assert.deepEqual([...ids].sort(), [...Data.TEMPLATE_ORDER].sort(), source);
});
