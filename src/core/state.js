'use strict';
/* 纯工具：深拷贝。合并成单入口后，旧的默认状态 / ID 生成 / 一致性校验
   已随原玩法一并移除；这里只留不依赖 DOM / localStorage / 时钟的通用函数。 */
(function (A) {
  'use strict';

  function clone(value) {
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (e) { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(value));
  }

  A.State = { clone };
})(globalThis.Ashen ||= {});
