'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadVeteran} = require('../helpers/load-veteran.cjs');

// 每种拓片的可复现摆法：[纹路、横格、纵格、顺时针转数、上下翻面]。
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
test('每门蚀刻法都能在真实板面及负荷限制内满覆盖、贯通', () => {
  const V = loadVeteran().Veteran;
  const shape = s => JSON.stringify([s.cells.map(String).sort(),s.entry,s.exits]);
  const examples = new Map(Object.entries(layouts).map(([id,parts])=>[shape(V.Data.manuscript(id)),parts]));
  for (const spec of Object.values(V.Data.MANUSCRIPTS)) {
    const st = V.State.create(42), unit = st.roster[0];
    unit.bodyPreset = 'sturdy';
    const parts = examples.get(shape(spec));
    assert.ok(parts, spec.name + ' 缺少实装例');
    let origin;
    for (let seed=1;seed<=200 && !origin;seed++) {
      unit.plateSeed = seed;
      [origin] = V.Manuscript.placements(spec,V.Circuit.plateOf(unit).cellsList);
    }
    assert.ok(origin,spec.name);
    unit.manuscript = {...spec,x:origin[0],y:origin[1]};
    const placements = parts.map(([templateId,x,y,rotation,mirrorY])=>{
      const item = V.State.makePart(st,{templateId});
      st.itemsById[item.id] = item;
      st.stash.push(item.id);
      return {itemId:item.id,x:x+origin[0],y:y+origin[1],rotation,mirrorY:!!mirrorY};
    });
    const check = V.Circuit.preview(st,unit.id,placements);
    assert.ok(check.ok,spec.name + ' ' + check.errors.join(' '));
    const ms = V.Circuit.manuscriptState(st,unit.id,placements);
    assert.equal(ms.pct,100,spec.name);
    assert.ok(ms.routed,spec.name);
  }
});

test('同心纹下排压住扣钉：满覆盖有共鸣阶增益，朝外的两个端口仍未接到输出极', () => {
  const V = loadVeteran().Veteran, st = V.State.create(42);
  const item = V.State.makePart(st,{templateId:'capacitor'});
  st.itemsById[item.id] = item;
  const idx = V.Manuscript.pieceIndex(V.Circuit.layout(st,[{itemId:item.id,x:0,y:0}]));
  const ms = Object.values(V.Data.MANUSCRIPTS).find(s=>s.name==='扣钉');
  const cov = V.Manuscript.coverage(ms,0,1,idx);
  assert.equal(cov.aligned,2);
  assert.equal(cov.pct,100);
  assert.ok(cov.tier.effect.mainMult > 1);
  assert.equal(V.Manuscript.route(ms,0,1,idx).ok,false);
});
