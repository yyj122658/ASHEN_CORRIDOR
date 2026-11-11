'use strict';
/* 逐帧战斗动画：只负责表现。
   - 读取 assets/art/battle-v1/atlas 的 rect / pivot / durationMs
   - 按战斗单位 ID 独立保存播放状态
   - 事件由战斗日志增量驱动，不修改任何战斗结果
   目前支持 blade（剑士）与 bone（骸骨兵），其余单位回退到原程序绘制。 */
(function (A) {
  'use strict';

  const BASE = 'assets/art/battle-v1/';
  const PRIORITY = { idle: 0, attack: 1, hurt: 2, death: 3 };

  let atlas = null;
  const images = {};      // 'blade.idle' -> HTMLImageElement
  const loadState = {};   // 'blade.idle' -> 'idle'|'loading'|'ready'|'failed'
  const states = {};      // unitId -> { anim, frame, elapsed, done }
  let lastSeq = 0;
  let ready = false;

  /* ---------- 初始化 ---------- */

  function init() {
    if (atlas) return true;
    const raw = typeof window !== 'undefined' ? window.ASHEN_BATTLE_ATLAS : null;
    if (!raw || !raw.characters) return false;
    atlas = raw;
    return true;
  }

  function sheetKey(charId, animId) { return charId + '.' + animId; }

  function loadOne(charId, animId) {
    const key = sheetKey(charId, animId);
    if (loadState[key] === 'ready' || loadState[key] === 'loading') return Promise.resolve(loadState[key] === 'ready' ? { key, ok: true } : { key, ok: false });
    const an = atlas.characters[charId].animations[animId];
    if (!an || !an.sheet) return Promise.resolve({ key, ok: false });

    loadState[key] = 'loading';
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { images[key] = img; loadState[key] = 'ready'; resolve({ key, ok: true }); };
      img.onerror = () => { loadState[key] = 'failed'; resolve({ key, ok: false }); };
      img.src = BASE + an.sheet;
    });
  }

  /** 预加载指定角色（默认两个都加载）的四个动作图集。 */
  function preload(chars) {
    if (!init()) return Promise.resolve({ loaded: 0, failed: 0, supported: false });
    const list = chars && chars.length ? chars : Object.keys(atlas.characters);
    const jobs = [];
    list.forEach((cid) => {
      const c = atlas.characters[cid];
      if (!c) return;
      Object.keys(c.animations).forEach((aid) => jobs.push(loadOne(cid, aid)));
    });
    return Promise.all(jobs).then((res) => {
      ready = res.some((r) => r.ok);
      return { loaded: res.filter((r) => r.ok).length, failed: res.filter((r) => !r.ok).length, supported: ready };
    });
  }

  function isReady() { return ready; }

  /* ---------- 角色识别 ---------- */

  /** 剑士按职业；骸骨兵必须按 enemyType === 'bone'，不猜名字/ID/shape。 */
  function charIdFor(u) {
    if (!u) return null;
    /* 旧模式按 cls 识别；老兵回路版没有职业，按 skinId 复用同一套动画。
       skinId 只决定显示，不参与任何能力计算。 */
    if (u.side === 'ally' && (u.cls === 'blade' || u.skinId === 'blade')) return 'blade';
    if (u.side === 'enemy' && u.enemyType === 'bone') return 'bone';
    return null;
  }

  function supports(u) {
    if (!ready) return false;
    const cid = charIdFor(u);
    if (!cid) return false;
    // 必须四个动作图集都在，否则整只降级，避免动画播到一半卡住
    return ['idle', 'attack', 'hurt', 'death'].every((a) => loadState[sheetKey(cid, a)] === 'ready');
  }

  /* ---------- 状态 ---------- */

  function ensure(u) {
    let st = states[u.id];
    if (!st) {
      st = { anim: u.alive === false ? 'death' : 'idle', frame: 0, elapsed: 0, done: u.alive === false };
      if (st.anim === 'death') st.frame = 5;
      states[u.id] = st;
    }
    return st;
  }

  function animationOf(u) {
    const cid = charIdFor(u);
    if (!cid || !atlas) return null;
    const st = ensure(u);
    const c = atlas.characters[cid];
    return c.animations[st.anim] || c.animations.idle;
  }

  /**
   * 播放某动作。
   * - 同一动作未播完时不重启（多段伤害不会反复抽刀）
   * - death 一旦进入不再被覆盖
   * - 低优先级不能打断未完成的高优先级
   */
  function play(u, anim, opts) {
    if (!u || !supports(u)) return false;
    if (!atlas.characters[charIdFor(u)].animations[anim]) return false;
    const st = ensure(u);
    const force = !!(opts && opts.force);

    if (st.anim === 'death' && anim !== 'death') return false;
    if (!force && st.anim === anim && !st.done) return false;
    if (!force && PRIORITY[anim] < PRIORITY[st.anim] && !st.done) return false;

    st.anim = anim;
    st.frame = 0;
    st.elapsed = 0;
    st.done = false;
    return true;
  }

  /** 恢复战斗时按存活状态初始化，不重放历史事件。 */
  function syncFromBattle(b) {
    Object.keys(states).forEach((k) => { delete states[k]; });
    if (!b) { lastSeq = 0; return; }
    const all = [...(b.allies || []), ...(b.enemies || [])];
    all.forEach((u) => {
      const st = { anim: 'idle', frame: 0, elapsed: 0, done: false };
      if (u.alive === false) { st.anim = 'death'; st.frame = 5; st.done = true; }
      states[u.id] = st;
    });
    lastSeq = b.logSeq || (b.logs && b.logs.length ? (b.logs[b.logs.length - 1].seq || 0) : 0);
  }

  /* ---------- 推进 ---------- */

  /**
   * @param units 当前战斗单位
   * @param dtMs 已按暂停/倍率处理过的时间增量
   */
  function update(units, dtMs, hooks) {
    if (!ready || !dtMs) return;
    units.forEach((u) => {
      if (!supports(u)) return;
      const st = ensure(u);
      if (st.done) return;
      const prevFrame = st.frame;
      const cid = charIdFor(u);
      const anim = atlas.characters[cid].animations[st.anim];
      if (!anim) return;

      st.elapsed += dtMs;
      let guard = 0;
      while (guard++ < 32) {
        const f = anim.frames[Math.min(st.frame, anim.frames.length - 1)];
        const dur = Math.max(16, f.durationMs || 120);
        if (st.elapsed < dur) break;
        st.elapsed -= dur;

        if (st.frame < anim.frameCount - 1) {
          st.frame += 1;
        } else if (anim.loop) {
          st.frame = 0;
        } else if (st.anim === 'death') {
          st.frame = anim.frameCount - 1;
          st.done = true;
          st.elapsed = 0;
          break;
        } else {
          st.anim = 'idle';
          st.frame = 0;
          st.elapsed = 0;
          st.done = false;
          break;
        }
      }

      // 攻击出手帧：只触发表现（剑光/音效），不产生任何数值影响
      if (hooks && hooks.onAttackImpact && st.anim === 'attack' && st.frame !== prevFrame) {
        const cur = atlas.characters[charIdFor(u)].animations.attack;
        if (cur && cur.impactFrame != null && st.frame === cur.impactFrame) hooks.onAttackImpact(u);
      }
    });
  }

  /* ---------- 事件 ---------- */

  /* 动作驱动由 battle 视图直接调 play() 完成（见 src/veteran/view.js 的
     consumeEvents），这里不再按日志推导动作。 */

  /* ---------- 绘制 ---------- */

  /**
   * 在 footX/footY 处绘制（逻辑坐标，已由调用方设定好世界变换）。
   * @returns true 表示已用动画绘制，false 表示应回退原绘制
   */
  function draw(ctx, u, footX, footY, cellPx) {
    if (!supports(u)) return false;
    const cid = charIdFor(u);
    const st = ensure(u);
    const c = atlas.characters[cid];
    const anim = c.animations[st.anim] || c.animations.idle;
    const f = anim.frames[Math.min(st.frame, anim.frames.length - 1)];
    const img = images[sheetKey(cid, st.anim)] || images[sheetKey(cid, 'idle')];
    if (!img || !f) return false;

    const s = cellPx / atlas.frameSize[0];
    const wantRight = u.side === 'ally';
    const artRight = c.facing === 'right';
    const flip = wantRight !== artRight;

    ctx.save();
    ctx.translate(footX, footY);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(
      img,
      f.rect.x, f.rect.y, f.rect.w || 512, f.rect.h || 512,
      -f.pivot.x * s, -f.pivot.y * s,
      512 * s, 512 * s
    );
    ctx.restore();
    return true;
  }

  /** 攻击视觉出手点：用于同步剑光/音效，不产生任何数值影响。 */
  function isImpactFrame(u, impactFrame) {
    const cid = charIdFor(u);
    if (!cid || !atlas) return false;
    const st = ensure(u);
    const anim = atlas.characters[cid].animations[st.anim];
    if (!anim || anim.impactFrame == null) return false;
    return st.anim === 'attack' && st.frame === anim.impactFrame;
  }

  function stateOf(unitId) { return states[unitId] || null; }

  function reset() {
    Object.keys(states).forEach((k) => { delete states[k]; });
    lastSeq = 0;
  }

  A.SpriteAnim = {
    init, preload, isReady, supports, charIdFor,
    play, update, draw, syncFromBattle, stateOf, isImpactFrame, reset,
    get atlas() { return atlas; },
  };
})(globalThis.Ashen ||= {});
