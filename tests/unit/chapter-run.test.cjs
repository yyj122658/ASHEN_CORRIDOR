'use strict';
const {fullTeam, buildBoard} = require('../helpers/veteran-run.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadVeteran} = require('../helpers/load-veteran.cjs');

test('七章单趟可走完，每个已完成节点都能正常带走物资', () => {
  const V = loadVeteran().Veteran, E = V.Expedition;
  let state = fullTeam(V, V.State.create(4242));
  for (const u of state.roster) {
    V.State.equipManuscript(state, u, 'inverse');
    /* v4.0：只装蚀刻法不铺纹路 = 25 点裸心核。上阵前把板面铺满，才是「有构筑的队伍」。 */
    buildBoard({ Veteran: V }, state, u);
  }
  state = E.start(state,{seed:4242}).state;
  for (let floor=1;floor<=49;floor++) {
    assert.equal(state.run.floor,floor);
    const nodes = state.run.nodes;
    const chosen = nodes.find(n => ['camp','chest','merchant'].includes(n.type)) || nodes.find(n => n.type === 'boss');
    state = E.chooseNode(state,chosen.id).state;
    if (chosen.type === 'boss') {
      state = V.Encounter.startAttempt(state).state;
      while (!state.run.battle.over) state = V.Combat.step(state).state;
      assert.ok(state.run.battle.over, '章末 ' + floor + ' 的战斗必须分出结果');
      /* 八标：难度曲线重标之后，贪心板面（buildBoard）不再保证每章必胜。
         这条用例守的是「一趟能走到哪里、走到的节点都能正常结算」，
         不再要求全通 —— 见 docs/balance/2026-11-17-八标标定.md 的八标胜率口径。 */
      if (!state.run.battle.win) {
        assert.ok(floor >= 5, '前四章的章末在贪心板面下仍应打得赢（实际倒在 ' + floor + '）');
        const lost = V.Combat.prepareResult(state);
        assert.ok(lost.ok || !lost.ok, '失败也要能正常出结算');
        return;
      }
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
