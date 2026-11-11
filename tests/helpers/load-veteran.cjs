'use strict';
/* 老兵回路版的 Node VM 沙箱：执行真实脚本，测试不重新实现领域逻辑。
   只加载新模式需要的经典脚本；不启动旧 A.App，不碰旧存档。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

const ORDER = [
  /* 复用的纯工具 */
  'src/data/catalog.js',
  'src/core/random.js',
  'src/core/state.js',
  /* 新模式 */
  'src/veteran/data.js',
  'src/veteran/state.js',
  'src/veteran/circuit.js',
  'src/veteran/tactics.js',
  'src/veteran/positions.js',
  'src/veteran/combat.js',
  'src/veteran/encounter.js',
  'src/veteran/expedition.js',
  'src/veteran/roster.js',
  'src/veteran/storage.js',
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
