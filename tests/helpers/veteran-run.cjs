'use strict';
/* 老兵回路测试公用夹具：只调用真实命令，不实现领域逻辑。 */
const { loadVeteran } = require('./load-veteran.cjs');

function boot(seed) {
  const A = loadVeteran();
  const V = A.Veteran;
  return { A, V, st: V.State.create(seed == null ? 4242 : seed, { classicPlate: true }) };
}

function startRun(A, st, seed) {
  const r = A.Veteran.Expedition.start(st, { seed: seed == null ? 4242 : seed });
  if (!r.ok) throw new Error('start 失败：' + JSON.stringify(r.error));
  return r.state;
}

/** 把当前层的三个节点替换成指定类型。 */
function setNodes(A, st, types) {
  const D = A.Veteran.Data;
  st.run.nodes = types.map((t, i) => ({
    id: 'n' + st.run.floor + '_' + i,
    type: t,
    consumed: false,
    name: D.nodeType(t).name,
    desc: D.nodeType(t).desc,
    risk: D.nodeType(t).risk,
    artId: D.nodeType(t).artId,
    icon: D.nodeType(t).icon,
  }));
  return st;
}

/** 打开遭遇并开打，返回 {st, battle}。 */
function fight(A, st, kind) {
  const V = A.Veteran;
  const nodeId = st.run.nodes[0].id;
  let r = V.Encounter.open(st, nodeId);
  if (!r.ok) throw new Error('open 失败：' + JSON.stringify(r.error));
  st = r.state;
  if (kind && kind !== st.run.encounter.kind) {
    /* 测试需要指定遭遇类型时，直接换蓝图（不走 UI 路径） */
    const gen = V.Combat.generateEncounter(st, kind);
    st = gen.state;
    st.run.encounter.enemyBlueprint = gen.enemyBlueprint;
    st.run.encounter.combatRngStart = gen.combatRngStart;
    st.run.encounter.kind = kind;
  }
  r = V.Encounter.startAttempt(st);
  if (!r.ok) throw new Error('startAttempt 失败：' + JSON.stringify(r.error));
  return { st: r.state, battle: r.state.run.battle };
}

function stepUntilOver(A, st, limit) {
  const V = A.Veteran;
  let ticks = 0;
  const cap = limit || 4000;
  while (st.run && st.run.battle && !st.run.battle.over && ticks < cap) {
    const r = V.Combat.step(st);
    if (!r.ok) throw new Error('step 失败：' + JSON.stringify(r.error));
    st = r.state;
    ticks += 1;
  }
  return { st, ticks };
}

/** 造一件指定模板的构件并放进仓库。 */
function makePart(A, st, spec) {
  const V = A.Veteran;
  const part = V.State.makePart(st, spec || { kind: 'circuit', templateId: 'straight' });
  st.itemsById[part.id] = part;
  st.stash.push(part.id);
  return part;
}

module.exports = { boot, startRun, setNodes, fight, stepUntilOver, makePart };
