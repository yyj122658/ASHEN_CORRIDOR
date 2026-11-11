'use strict';
/* 可保存、可重放的确定性随机数。
   所有函数都是纯函数：输入 state(uint32) 返回 { value, state }，不读时钟、不读 Math.random。
   外层只需保存 32 位无符号整数即可精确重放后续序列。 */
(function (A) {
  'use strict';

  /** mulberry32：state=0 也能正常工作（不像 xorshift 会陷入吸收态）。 */
  function next(state) {
    let s = (state >>> 0) + 0x6D2B79F5;
    s >>>= 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return { value, state: s };
  }

  function range(state, min, max) {
    const r = next(state);
    return { value: min + r.value * (max - min), state: r.state };
  }

  function int(state, minInclusive, maxInclusive) {
    const r = next(state);
    const span = maxInclusive - minInclusive + 1;
    return { value: minInclusive + Math.floor(r.value * span), state: r.state };
  }

  function pick(state, arr) {
    if (!arr || !arr.length) return { value: undefined, state };
    const r = next(state);
    return { value: arr[Math.floor(r.value * arr.length)], state: r.state };
  }

  function chance(state, p) {
    const r = next(state);
    return { value: r.value < p, state: r.state };
  }

  /** Fisher-Yates，返回新数组，不修改入参。 */
  function shuffle(state, arr) {
    const out = arr.slice();
    let s = state;
    for (let i = out.length - 1; i > 0; i--) {
      const r = next(s);
      s = r.state;
      const j = Math.floor(r.value * (i + 1));
      const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return { value: out, state: s };
  }

  /** weights: number[]，与 items 等长。 */
  function weighted(state, items, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    const r = next(state);
    let acc = r.value * total;
    for (let i = 0; i < items.length; i++) {
      acc -= weights[i];
      if (acc <= 0) return { value: items[i], state: r.state };
    }
    return { value: items[items.length - 1], state: r.state };
  }

  /** 把任意字符串/数字混成一个可用的初始种子（FNV-1a）。 */
  function seedFrom(input) {
    const str = String(input);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  A.Random = { next, range, int, pick, chance, shuffle, weighted, seedFrom };
})(globalThis.Ashen ||= {});
