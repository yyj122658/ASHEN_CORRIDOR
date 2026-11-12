'use strict';
/* 灰烬回廊的 Node VM 沙箱：执行真实脚本，测试不重新实现领域逻辑。
   加载单入口所需的全部经典脚本（纯工具 + 玩法模块）。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

const ORDER = [
  /* 复用的纯工具 */
  'src/core/random.js',
  'src/core/state.js',
  /* 玩法模块 */
  'src/veteran/data.js',
  'src/veteran/state.js',
  'src/veteran/kitchen.js',
  'src/veteran/catalogue-art.js',
  'src/veteran/circuit.js',
  'src/veteran/tactics.js',
  'src/veteran/positions.js',
  'src/veteran/combat.js',
  'src/veteran/encounter.js',
  'src/veteran/expedition.js',
  'src/veteran/roster.js',
  'src/veteran/storage.js',
  'src/veteran/rune-art.js',
  'src/veteran/plate-gen.js',
  'src/veteran/manuscript.js',
  /* 表现层资源（无 DOM 依赖，供动画测试使用） */
  'assets/art/battle-v1/atlas-data.js',
  'src/ui/sprite-anim.js',
];

function loadVeteran(overrides) {
  const sandbox = {
    console,
    structuredClone: typeof structuredClone === 'function' ? structuredClone : undefined,
    Math,
    Date,
    JSON,
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
    vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: rel });
    loaded.push(rel);
  }

  const A = sandbox.Ashen;
  if (!A) throw new Error('Ashen 命名空间未创建');
  if (!A.Veteran) throw new Error('Ashen.Veteran 未创建');
  if (overrides) Object.assign(A, overrides);
  A.__loaded = loaded;
  return A;
}

module.exports = { loadVeteran, ROOT };
