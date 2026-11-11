'use strict';
/* 用 Node VM 执行真实的经典脚本，测试不重新实现任何领域逻辑。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

// 依赖顺序；文件不存在则跳过（渐进开发期间允许）
const ORDER = [
  'src/data/catalog.js',
  'src/core/random.js',
  'src/core/state.js',
  'src/systems/roster.js',
  'src/systems/equipment.js',
  'src/systems/expedition.js',
  'src/systems/combat.js',
  'src/core/storage.js',
  'assets/art/battle-v1/atlas-data.js',
  'src/ui/sprite-anim.js',
];

function loadGame(overrides) {
  const sandbox = {
    console,
    structuredClone: typeof structuredClone === 'function' ? structuredClone : undefined,
    Math,
    Date,
  };
  vm.createContext(sandbox);
  // sprite-anim 用 window 读取 atlas、用 Image 加载图集；在 VM 里给出最小实现
  sandbox.window = sandbox;
  sandbox.Image = class FakeImage {
    constructor() { this.naturalWidth = 512; this.naturalHeight = 512; this.complete = true; }
    set src(v) { this._src = v; if (typeof this.onload === 'function') this.onload(); }
    get src() { return this._src; }
  };

  const loaded = [];
  for (const rel of ORDER) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const code = fs.readFileSync(full, 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
    loaded.push(rel);
  }

  const A = sandbox.Ashen;
  if (!A) throw new Error('Ashen 命名空间未创建');

  if (overrides) Object.assign(A, overrides);
  A.__loaded = loaded;
  return A;
}

/** 造一个确定性的可校验状态。 */
function makeState(A) {
  const s = A.State.create();
  return s;
}

/** 给角色穿一件指定槽位的物品（测试夹具用），走 registry。 */
function giveItem(A, state, unitId, slot, opts) {
  const res = A.Equipment.makeItem(state, Object.assign({ ilvl: 5, bias: 3, slot }, opts || {}));
  const st = res.state;
  const it = res.item;
  st.itemsById[it.id] = it;
  if (unitId) {
    const u = st.roster.find((x) => x.id === unitId);
    if (u.equip[slot]) st.stash.push(u.equip[slot]);
    u.equip[slot] = it.id;
  } else {
    st.stash.push(it.id);
  }
  return { state: st, item: it };
}

module.exports = { loadGame, makeState, giveItem, ROOT };
