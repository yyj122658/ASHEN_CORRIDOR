'use strict';
const {fullTeam} = require('../helpers/veteran-run.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadVeteran} = require('../helpers/load-veteran.cjs');

test('七章单趟可走完，每个已完成节点都能正常带走物资', () => {
  const V = loadVeteran().Veteran, E = V.Expedition;
  let state = fullTeam(V, V.State.create(4242));
  for (const u of state.roster) V.State.equipManuscript(state,u,'inverse');
  state = E.start(state,{seed:4242}).state;
  for (let floor=1;floor<=49;floor++) {
    assert.equal(state.run.floor,floor);
    const nodes = state.run.nodes;
    const chosen = nodes.find(n => ['camp','chest','merchant'].includes(n.type)) || nodes.find(n => n.type === 'boss');
    state = E.chooseNode(state,chosen.id).state;
    if (chosen.type === 'boss') {
      state = V.Encounter.startAttempt(state).state;
      while (!state.run.battle.over) state = V.Combat.step(state).state;
      assert.ok(state.run.battle.win,'章末 '+floor);
      assert.ok(V.Combat.prepareResult(state).ok);
      state = V.Encounter.confirm(state).state;
    } else if (chosen.type === 'camp') state = E.campRest(state).state;
    const finish = E.finishNode(state,true);
    assert.ok(finish.ok,JSON.stringify(finish.error));
    state = finish.state;
    if (!state.run) {
      assert.equal(floor,49);
      assert.equal(state.settlement.mode,'clear');
      assert.equal(state.bestDepth,49);
      break;
    }
    const save = V.Storage.decode(V.Storage.encode(state));
    assert.ok(save.ok,save.errors?.join('；'));
    state = save.state;
    const returned = E.extract(state);
    assert.ok(returned.ok);
    assert.equal(returned.state.settlement.depth,floor);
    assert.equal(returned.state.settlement.mode,'extract');
    assert.equal(returned.state.gold,state.gold+state.run.goldFound);
    for (const id of state.run.bag) assert.ok(returned.state.stash.includes(id));
    assert.equal(E.finishNode(state,true).ok,false,'已处理的节点不能再次结算');
    if (state.run.stage === 'blessing') state = E.chooseBlessing(state,state.run.blessingOptions[0]).state;
  }
});
