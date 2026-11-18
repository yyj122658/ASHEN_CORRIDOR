'use strict';
/* 面板派生 v4.0：底盘只给「心核基座」，其余全部由拓扑编译产出。

   v4.0 之后这里不再有「攻/防/血预算」这回事 ——
   一块裸金属就是一颗心核：结构完整度 25、脉冲幅值 10、阻抗 0、缓冲 0、节拍 10。
   所有增量都来自你把什么刻在它上面（见 circuit.js 的 compile）。

   底盘只剩一件事可做：**心核节拍频率**（spd）。这一点仍然是娘胎里带的，
   因为它由金属的内部共振决定，跟你刻什么无关。

   四层分工（改这块时别打破）：
   1. data.js    —— profile 只剩 spd 有意义，其余是历史字段
   2. derive.js  —— 底盘 → 心核基座，纯函数
   3. circuit.js —— compile：纹路拓扑 → 完整战斗面板（maxHp/atk/def/shieldCap）
   4. roster.js  —— 叠上瘢痕、本局生命修正
*/
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  /* 心核基座：裸装、未刻任何纹路时的值 */
  const CHASSIS = { maxHp: 25, atk: 10, def: 0, shieldCap: 0, spd: 10 };

  /* profile 只用来摊速度：权重每偏离基准 0.01 换 0.25 点节拍 */
  const BASE = { hp: 0.40, atk: 0.24, def: 0.18, spd: 0.18 };
  const SPD_PER_POINT = 25;

  function fallbackProfile() { return { ...BASE }; }

  /** 权重归一化：写歪了（和不为 1）也按比例摊回去。 */
  function normalized(profile) {
    const p = profile || {};
    const raw = {
      hp: Number(p.hp) || 0,
      atk: Number(p.atk) || 0,
      def: Number(p.def) || 0,
      spd: Number(p.spd) || 0,
    };
    const sum = raw.hp + raw.atk + raw.def + raw.spd;
    if (sum <= 0) return fallbackProfile();
    return { hp: raw.hp / sum, atk: raw.atk / sum, def: raw.def / sum, spd: raw.spd / sum };
  }

  /**
   * 心核基座。@param {object} body 底盘定义（BODIES[x]）@returns {{maxHp,atk,def,shieldCap,spd}}
   * 注意：这里**不看 profile 的 hp/atk/def** —— v4.0 起那三项没有意义了。
   */
  function chassis(body) {
    const w = normalized((body && body.profile) || BASE);
    return {
      maxHp: CHASSIS.maxHp,
      atk: CHASSIS.atk,
      def: CHASSIS.def,
      shieldCap: CHASSIS.shieldCap,
      spd: Math.max(1, Math.round(CHASSIS.spd + (w.spd - BASE.spd) * SPD_PER_POINT)),
    };
  }

  /** 负荷上限：由板面格数派生。两套系数见 data.js。 */
  function loadCap(cells, perCell) {
    const n = Number(cells) || 0;
    const k = Number.isFinite(perCell) ? perCell : 0.57;
    return Math.max(1, Math.round(n * k));
  }

  V.Derive = { CHASSIS, BASE, SPD_PER_POINT, normalized, chassis, loadCap };
})(globalThis.Ashen ||= {});
