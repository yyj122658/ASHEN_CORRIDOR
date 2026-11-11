'use strict';
/* 固定资产映射与失败降级。路径相对 index.html。
   不通过 fetch(manifest.json)，保证 file:// 直接打开可用。 */
(function (A) {
  'use strict';

  const BASE = 'assets/art/v1/';

  const ART = {
    'scene.camp':       { path: 'scenes/camp.png',            objectPosition: '65% 50%', ratio: '3/2' },
    'scene.corridor':   { path: 'scenes/corridor.png',        objectPosition: '50% 50%', ratio: '3/1', groundY: 0.84 },
    'scene.boss':       { path: 'scenes/boss-chamber.png',    objectPosition: '50% 50%', ratio: '3/1', groundY: 0.84 },

    'portrait.blade':   { path: 'portraits/blade.png',        objectPosition: '50% 35%', ratio: '1/1' },
    'portrait.warden':  { path: 'portraits/warden.png',       objectPosition: '50% 35%', ratio: '1/1' },
    'portrait.ranger':  { path: 'portraits/ranger.png',       objectPosition: '50% 35%', ratio: '1/1' },
    'portrait.warlock': { path: 'portraits/warlock.png',      objectPosition: '50% 35%', ratio: '1/1' },
    'portrait.cleric':  { path: 'portraits/cleric.png',       objectPosition: '50% 35%', ratio: '1/1' },
    'portrait.rogue':   { path: 'portraits/rogue.png',        objectPosition: '50% 35%', ratio: '1/1' },

    'node.battle':      { path: 'nodes/battle.png',           objectPosition: '50% 50%', ratio: '3/2', fallbackId: 'scene.corridor' },
    'node.elite':       { path: 'nodes/elite.png',            objectPosition: '50% 50%', ratio: '3/2', fallbackId: 'scene.corridor' },
    'node.chest':       { path: 'nodes/chest.png',            objectPosition: '50% 50%', ratio: '3/2', fallbackId: 'scene.corridor' },
    'node.event':       { path: 'nodes/event.png',            objectPosition: '50% 50%', ratio: '3/2', fallbackId: 'scene.corridor' },
    'node.camp':        { path: 'nodes/camp.png',             objectPosition: '50% 50%', ratio: '3/2', fallbackId: 'scene.corridor' },
    'node.merchant':    { path: 'nodes/merchant.png',         objectPosition: '50% 50%', ratio: '3/2', fallbackId: 'scene.corridor' },
    'node.boss':        { path: 'nodes/boss.png',             objectPosition: '50% 50%', ratio: '3/2', fallbackId: 'scene.corridor' },

    'enemy.gatekeeper': { path: 'enemies/gatekeeper.png',     objectPosition: '50% 30%', ratio: '1/1' },
    'enemy.memoryEater':{ path: 'enemies/memory-eater.png',   objectPosition: '50% 30%', ratio: '1/1' },
  };

  // 运行时状态：'unknown' | 'ready' | 'failed'
  const status = {};
  const cache = {};

  function getArt(id) {
    const def = ART[id];
    if (!def) return null;
    return {
      id,
      src: BASE + def.path,
      fallbackId: def.fallbackId || null,
      objectPosition: def.objectPosition,
      groundY: def.groundY,
      ratio: def.ratio,
      status: status[id] || 'unknown',
    };
  }

  function loadImage(id) {
    const def = ART[id];
    if (!def) return Promise.resolve({ id, ok: false });
    if (cache[id]) return Promise.resolve({ id, ok: status[id] === 'ready' });

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        status[id] = 'ready';
        cache[id] = img;
        resolve({ id, ok: true, img });
      };
      img.onerror = () => {
        status[id] = 'failed';
        resolve({ id, ok: false });
      };
      img.src = BASE + def.path;
    });
  }

  function preloadArt(ids) {
    const list = ids || Object.keys(ART);
    return Promise.all(list.map(loadImage)).then((res) => ({
      loaded: res.filter((r) => r.ok).map((r) => r.id),
      failed: res.filter((r) => !r.ok).map((r) => r.id),
    }));
  }

  function getImage(id) {
    if (status[id] === 'ready' && cache[id]) return cache[id];
    return null;
  }

  function isReady(id) { return status[id] === 'ready'; }
  function statusOf(id) { return status[id] || 'unknown'; }

  /** 生成 <img> 标签；失败时 onerror 隐藏并挂上降级类。 */
  function imgTag(id, cls, alt) {
    const art = getArt(id);
    if (!art) return '';
    const st = statusOf(id);
    if (st === 'failed') return '';
    return `<img class="art ${cls || ''}" src="${art.src}" loading="lazy" decoding="async"
      alt="${alt || ''}" style="object-position:${art.objectPosition}"
      onerror="this.classList.add('art-broken');this.removeAttribute('src')">`;
  }

  /** 防止 <img onerror> 被当作可执行内容：本函数只用于我们自己写的固定路径。 */
  function safeText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  A.Art = { ART, getArt, preloadArt, getImage, isReady, statusOf, imgTag, safeText, BASE };
})(globalThis.Ashen ||= {});
