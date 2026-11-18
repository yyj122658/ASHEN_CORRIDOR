'use strict';
/* 战斗图集按单位身份加载，动作只消费表现事件。 */
(function (A) {
  'use strict';

  const EFFECTS = ['pulse', 'overheat', 'corrosion', 'impact', 'impactHot', 'impactCrack',
    'fuse', 'shield', 'membrane', 'interrupt', 'brazier',
    'arrow', 'arrowHot', 'arrowCrack', 'slash', 'slashHot', 'slashCrack',
    'spell', 'spellHot', 'spellCrack', 'bash', 'bashHot', 'bashCrack', 'thrust', 'thrustHot', 'thrustCrack'];
  const EFFECT_ART = 'vfx.topology';
  const EFFECT_SIZE = 48;
  const EFFECT_FRAMES = 8;
  const PRIORITY = { idle: 0, attack: 1, charge: 1, release: 1, cast: 1, move: 1, run: 0, guard: 2, dodge: 2, hurt: 2, death: 3 };
  const strikeTravel = { attack: [0, -.12, 1, .38, .04, 0], release: [-.12, 1, .38, .04, 0] };
  const ease = t => t * t * (3 - 2 * t);

  const reactions = {
    move:[[0,1,-5],[0,-7,7],[0,-2,2]],
    dodge:[[-2,2,-6],[-19,-4,-17],[-6,1,-5]],
    guard:[[-3,2,-6],[-5,4,-9],[-2,2,-3]],
    cast:[[0,2,-5],[-2,-7,-7],[3,-2,5]],
  };

  function drawGesture(ctx, anim, time, scale) {
    const poses = reactions[anim];
    if (!poses) return;
    const stops = [0,.27,.54,.77,1], rest = [0,0,0];
    const i = time < stops[1] ? 0 : time < stops[2] ? 1 : time < stops[3] ? 2 : 3;
    const a = poses[i-1] || rest, b = poses[i] || rest;
    const t = (time - stops[i]) / (stops[i+1] - stops[i]);
    const value = k => a[k] + (b[k]-a[k])*ease(t);
    ctx.translate(value(0)*scale, value(1)*scale);
    ctx.rotate(value(2)*Math.PI/180);

  }

  let atlas = null;
  const sheets = new Map();
  const loading = new Map();
  const states = Object.create(null);

  function characterStrip(id, facing) {
    const size = 64;
    const sheet = A.Art.BASE + 'actors/' + id + '.png';
    function sequence(poses, durations, loop, impactFrame) {
      return { sheet, loop, impactFrame, frameCount: poses.length,
        frames: poses.map((pose, i) => {
          const weaponPose = pose >= 6;
          const width = weaponPose ? 80 : size;
          return {
            rect: { x: weaponPose ? 6 * size + (pose - 6) * width : pose * size, y: 0, w: width, h: width },
            pivot: { x: width / 2, y: weaponPose ? 74 : 60 }, durationMs: durations[i],
          };
        }),
      };
    }
    return { facing, frameSize: size, animations: {
      idle: sequence([0, 1], [610, 410], true),
      attack: sequence([6, 7, 8, 9, 0], [80, 100, 116, 105, 65], false, 2),
      charge: sequence([6, 7], [115, 110], false),
      release: sequence([7, 8, 9, 0], [24, 116, 105, 65], false, 1),
      run: sequence([10, 11, 12, 13, 14, 15, 16, 17], [38, 42, 38, 42, 38, 42, 38, 42], true),
      move: sequence([10, 12, 14, 16], [52, 66, 65, 58], false),
      cast: sequence([6, 7, 8, 9], [95, 140, 150, 85], false),
      hurt: sequence([4, 0], [170, 75], false),
      death: sequence([4, 4, 5, 5, 5, 5], [50, 95, 65, 65, 65, 65], false),
    } };
  }

  function init() {
    if (atlas) return true;
    const characters = {};
    A.Veteran.Data.SKINS.forEach(({id}) => { characters[id] = characterStrip(id, 'right'); });
    A.Veteran.Data.SKINS.forEach(({id}) => {
      const c = characters[id], clips = c.animations;
      const gesture = (source, indices, durations) => ({
        sheet:source.sheet, frameCount:indices.length, loop:false,
        frames:indices.map((index,i) => ({...source.frames[Math.min(index,source.frames.length-1)], durationMs:durations[i]})),
      });
      characters[id] = {...c, animations:{...clips,
        guard:gesture(clips.hurt,[0,0,1],[75,105,90]),
        dodge:gesture(clips.idle,[1,0,1],[65,90,75]),
      }};
    });
    for (const id of Object.keys(A.Veteran.Data.ENEMIES)) characters[id] = characterStrip(id, 'left');
    atlas = { characters };
    return true;
  }

  function loadSheet(sheet) {
    if (sheets.has(sheet)) return Promise.resolve(true);
    if (loading.has(sheet)) return loading.get(sheet);
    const job = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { sheets.set(sheet, img); resolve(true); };
      img.onerror = () => resolve(false);
      img.src = sheet;
    });
    loading.set(sheet, job);
    job.then(() => loading.delete(sheet));
    return job;
  }

  function preload(chars) {
    if (!init()) return Promise.resolve({ loaded: 0, failed: 0, supported: false });
    const list = chars ? new Set(chars) : Object.keys(atlas.characters);
    const jobs = [];
    list.forEach((cid) => {
      const c = atlas.characters[cid];
      if (!c) return;
      for (const action of ['idle','attack','hurt','death']) jobs.push(loadSheet(c.animations[action].sheet));
    });
    return Promise.all(jobs).then((res) => ({
      loaded: res.filter(Boolean).length, failed: res.filter((ok) => !ok).length, supported: isReady(),
    }));
  }

  function preloadEffects() {
    return A.Art.preloadArt([EFFECT_ART]).then(({failed}) => !failed.length);
  }

  function drawEffect(ctx, kind, progress, x, y, width, height) {
    const row = EFFECTS.indexOf(kind);
    const img = A.Art.getImage(EFFECT_ART);
    if (row < 0 || !img) return false;
    const frame = Math.max(0, Math.min(EFFECT_FRAMES - 1, Math.floor(progress * EFFECT_FRAMES)));
    ctx.drawImage(img, frame * EFFECT_SIZE, row * EFFECT_SIZE, EFFECT_SIZE, EFFECT_SIZE,
      Math.round(x - width / 2), Math.round(y - height / 2), width, height);
    return true;
  }

  function isReady() { return sheets.size > 0; }

  function weaponFor(u) {
    return u ? A.Veteran.Positions.style(u).effect : null;
  }

  function charIdFor(u) {
    if (!u || !init()) return null;
    if (u.side === 'ally') {
      const id = u.skinId || u.cls;
      return A.Veteran.Data.SKINS.some((skin) => skin.id === id) ? id : null;
    }
    if (u.side !== 'enemy' || !Object.hasOwn(A.Veteran.Data.ENEMIES, u.enemyType)) return null;
    return u.enemyType;
  }

  function supports(u) {
    const cid = charIdFor(u);
    return !!cid && Object.values(atlas.characters[cid].animations).every((anim) => sheets.has(anim.sheet));
  }

  /* ---------- 状态 ---------- */

  function ensure(u) {
    let st = states[u.id];
    if (!st) {
      st = { anim: u.alive === false ? 'death' : 'idle', frame: 0, elapsed: 0, done: u.alive === false };
      const cid = charIdFor(u);
      if (cid && st.anim === 'death') st.frame = atlas.characters[cid].animations.death.frameCount - 1;
      states[u.id] = st;
    }
    return st;
  }

  /**
   * 播放某动作。
   * - 同一动作未播完时不重启（多段伤害不会反复抽刀）
   * - death 一旦进入不再被覆盖
   * - 低优先级不能打断未完成的高优先级
   */
  function play(u, anim, opts) {
    if (!charIdFor(u)) return false;
    if (!atlas.characters[charIdFor(u)].animations[anim]) return false;
    const st = ensure(u);
    const force = !!(opts && opts.force);

    if (st.anim === 'death' && anim !== 'death') return false;
    if (!force && anim !== 'death' && (st.cues?.length || st.anim === 'charge' && (u.casting || u.charging))) return false;
    if (!force && st.anim === anim && !st.done) return false;
    if (!force && PRIORITY[anim] < PRIORITY[st.anim] && !st.done) return false;

    const pending = st.cues || [];
    st.cues = null;
    st.anim = anim;
    st.frame = 0;
    st.elapsed = 0;
    st.done = false;
    for (const cue of pending) cue(false);
    return true;
  }

  function strike(u, cue, prepared) {
    const st = ensure(u);
    if (st.cues) {
      st.cues.push(cue);
      return false;
    }
    const action = prepared && st.anim === 'charge' ? 'release' : 'attack';
    if (!supports(u) || !play(u, action, { force: true })) {
      cue(false);
      return false;
    }
    st.cues = [cue];
    return true;
  }

  function reach(u) {
    const st = states[u.id];
    const path = strikeTravel[st?.anim];
    if (!path) return 0;
    const frame = atlas.characters[charIdFor(u)].animations[st.anim].frames[st.frame];
    const t = ease(Math.min(1, st.elapsed / frame.durationMs));
    return path[st.frame] + (path[st.frame + 1] - path[st.frame]) * t;
  }

  function face(u, dx, dt) {
    const st = ensure(u);
    const next = Math.abs(dx) > 2 ? dx > 0 : st.facingRight ?? u.side === 'ally';
    if (st.facingRight !== undefined && st.facingRight !== next && u.alive !== false) st.turnMs = 85;
    else st.turnMs = Math.max(0, (st.turnMs || 0) - dt);
    if (u.alive !== false || st.facingRight === undefined) st.facingRight = next;
    return st.facingRight;
  }

  function run(u, moving, dt = 0) {
    const state = ensure(u);
    state.runCarry = moving ? 55 : Math.max(0, (state.runCarry || 0) - dt);
    if (moving && state.anim === 'idle') play(u, 'run');
    if (!moving && !state.runCarry && state.anim === 'run') play(u, 'idle');
  }

  /** 恢复战斗时按存活状态初始化，不重放历史事件。 */
  function syncFromBattle(b) {
    Object.keys(states).forEach((k) => { delete states[k]; });
    if (b) for (const u of [...(b.allies || []), ...(b.enemies || [])]) {
      ensure(u);
      if (u.alive !== false && ((u.casting && !u.pendingSkill?.effect?.heal) || u.charging?.mult > 0)) play(u, 'charge');
    }
  }

  /* ---------- 推进 ---------- */

  /**
   * @param units 当前战斗单位
   * @param dtMs 已按暂停/倍率处理过的时间增量
   */
  function update(units, dtMs, hooks) {
    if (!dtMs) return;
    units.forEach((u) => {
      if (!charIdFor(u)) return;
      const st = ensure(u);
      if (st.done) return;
      if (st.anim === 'charge' && !u.casting && !u.charging) play(u, 'idle', { force: true });
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
          if (st.frame === anim.impactFrame) {
            const pending = st.cues || [];
            st.cues = null;
            for (const cue of pending) cue(true);
            hooks?.onAttackImpact?.(u);
          }
        } else if (anim.loop) {
          st.frame = 0;
        } else if (st.anim === 'charge') {
          st.elapsed = 0;
          break;
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
  function draw(ctx, u, footX, footY, cellPx, reduceMotion = false, facingRight = u.side === 'ally') {
    if (!supports(u)) return false;
    const cid = charIdFor(u);
    const st = ensure(u);
    const c = atlas.characters[cid];
    const anim = c.animations[st.anim] || c.animations.idle;
    const f = anim.frames[Math.min(st.frame, anim.frames.length - 1)];
    const img = sheets.get(anim.sheet);
    if (!img || !f) return false;

    const s = cellPx / c.frameSize;
    const artRight = c.facing === 'right';
    const flip = facingRight !== artRight;

    ctx.save();
    ctx.translate(footX, footY);
    const turn = reduceMotion ? 0 : (st.turnMs || 0) / 85;
    if (flip || turn) ctx.scale((flip ? -1 : 1) * (1 - .26 * turn), 1);
    if (!reduceMotion && strikeTravel[st.anim]) {
      const push = reach(u);
      const melee = A.Veteran.Positions.style(u).mode === 'melee';
      ctx.rotate((artRight ? 1 : -1) * push * (melee ? .09 : -.055));
    }
    if (!reduceMotion && u.side === 'ally' && reactions[st.anim]) {
      let elapsed = st.elapsed, duration = 0;
      anim.frames.forEach((frame,i) => {
        if (i < st.frame) elapsed += frame.durationMs;
        duration += frame.durationMs;
      });
      drawGesture(ctx, st.anim, Math.min(1,elapsed/duration), cellPx/100);
    }
    ctx.drawImage(
      img,
      f.rect.x, f.rect.y, f.rect.w, f.rect.h,
      -f.pivot.x * s, -f.pivot.y * s,
      f.rect.w * s, f.rect.h * s
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
    return st.frame === anim.impactFrame;
  }

  function stateOf(unitId) { return states[unitId] || null; }

  function reset() {
    Object.keys(states).forEach((k) => { delete states[k]; });
  }

  A.SpriteAnim = {
    init, preload, preloadEffects, drawEffect, isReady, supports, charIdFor,
    play, strike, weaponFor, reach, face, run, update, draw, syncFromBattle, stateOf, isImpactFrame, reset,
    get atlas() { return atlas; },
  };
})(globalThis.Ashen ||= {});
