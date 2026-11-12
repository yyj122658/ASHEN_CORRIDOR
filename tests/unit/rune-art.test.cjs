'use strict';
/* 纹章切片的朝向必须和电路逻辑完全一致：
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

test('已在 data.js 的纹章，格数与模板一致', () => {
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
    const texture = fs.readFileSync(path.join(ROOT, 'assets/art/etch-depth', id + '.webp'));
    assert.equal(texture.toString('ascii', 8, 12), 'WEBP');
    const flat = RA.image(id, { x: 34, y: 26, cell: 60 });
    const turned = RA.image(id, { rotation: 1, mirrorY: true });
    assert.ok(flat.includes('translate(34,26) scale(60)'));
    assert.ok(turned.includes('matrix(' + RA.matrixFor(id, 1, true).join(',') + ')'));
    for (const svg of [flat, turned, RA.thumb(id)]) {
      assert.ok(svg.includes(shape.engraving) && svg.includes('etched-grain'), id);
      assert.doesNotMatch(svg, /rune-set-/);
      assert.ok(svg.includes(`assets/art/etch-depth/${id}.webp`), id);
    }
    assert.ok(turned.includes(`viewBox="${shape.cols} ${shape.rows} ${shape.cols} ${shape.rows}"`));

  }
  assert.equal(RA.thumb('nope'), '');
  assert.equal(RA.image('nope', {}), '');
});

test('每条连接的三道刻线及亮缘连续、贴齐接缝且全程位于真实占格内', () => {
  const sides = { W: [-1,0], E: [1,0], N: [0,-1], S: [0,1] };
  for (const tpl of Object.values(Data.TEMPLATES)) {
    const paths = [...RA.rune(tpl.id).engraving.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
    const cells = new Set(tpl.cells.map(c => c.join(',')));
    assert.equal(paths.length, tpl.links.length * 6);
    paths.forEach((d,index) => {
      const link = tpl.links[Math.floor(index / 3) % tpl.links.length];
      const ports = link.map(id => tpl.ports.find(p => p.id === id));
      const lane = [-.085,0,.085][index % 3];
      assert.match(d, /^M[-.\d ]+( C[-.\d ]+)+$/, tpl.id);
      const nums = d.match(/-?[\d.]+/g).map(Number);
      const xy = (p,end) => {
        const [dx,dy] = sides[p.dir], shift = end ? lane : -lane;
        return [p.cell[0]+.5+dx*.5-dy*shift, p.cell[1]+.5+dy*.5+dx*shift];
      };
      function near(a,b) { assert.ok(Math.abs(a-b)<.0011, tpl.id+' '+a+' != '+b); }
      const start = xy(ports[0],false), end = xy(ports[1],true);
      start.forEach((n,i) => near(n,nums[i]));
      end.forEach((n,i) => near(n,nums[nums.length-2+i]));
      // 起笔和收笔均垂直于接缝，旋转接续时不会形成折角。
      const firstAxis = sides[ports[0].dir][0] ? 1 : 0;
      const lastAxis = sides[ports[1].dir][0] ? 1 : 0;
      near(nums[firstAxis],nums[2+firstAxis]);
      near(nums.at(-2+lastAxis),nums.at(-4+lastAxis));
      for (let i=2;i<nums.length;i+=6) {
        for (let step=1;step<20;step++) {
          const t=step/20, u=1-t;
          const pt=[0,1].map(k=>Math.floor(u**3*nums[i-2+k]+3*u*u*t*nums[i+k]+3*u*t*t*nums[i+2+k]+t**3*nums[i+4+k]));
          assert.ok(cells.has(pt.join(',')), tpl.id+' 穿过空格 '+pt);
        }
      }
    });
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
