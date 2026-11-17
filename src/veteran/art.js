'use strict';
/* 灰烬回廊美术映射。
   - veteran-v1：工坊 / 营火 / 静养 / 板面底材 / 纹路缩略图，走本模块自己的 BASE。
   - v1：营地场景、节点插画、职业立绘、首领肖像，走 A.Art 的固定映射。
   两套都缺失时只返回 ''，由 CSS 渐变底 + SVG 图标降级。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  const BASE = 'assets/art/veteran-v1/';

  const ASSETS = {
    'veteran.enemy.hound': {
      path: '../battle-v2/hound.png', w: 1254, h: 1254,
      bounds: [91, 449, 1132, 463],
      focus: '50% 60%', alpha: true, alt: '披覆锈铁的四足骨犬',
    },
    'veteran.scene.workshop': {
      path: 'scenes/workshop.png', w: 1536, h: 1024,
      focus: '65% 50%', alt: '旧铜工作台与暖炉',
    },
    'veteran.scene.field': {
      path: 'scenes/field-inscription.png', w: 1536, h: 1024,
      focus: '55% 55%', alt: '营火旁的临时烙印台',
    },
    'veteran.scene.recovery': {
      path: 'scenes/recovery.png', w: 1536, h: 1024,
      focus: '60% 50%', alt: '营地的静养角落',
    },
    'veteran.surface.board': {
      path: 'surfaces/living-metal.png', w: 1254, h: 1254,
      focus: '50% 50%', alt: '金属板面板面底材',
    },
    'veteran.relic.channel': {
      path: 'relics/ember-channel.png', w: 1254, h: 1254,
      focus: '50% 50%', alpha: true, alt: '导能残片',
    },
    'veteran.relic.capacitor': {
      path: 'relics/pulse-chamber.png', w: 1254, h: 1254,
      focus: '50% 50%', alpha: true, alt: '同心纹',
    },
    'veteran.relic.splitter': {
      path: 'relics/prism-splitter.png', w: 1254, h: 1254,
      focus: '50% 50%', alpha: true, alt: '鹿角纹',
    },
    'veteran.relic.threshold': {
      path: 'relics/threshold-seal.png', w: 1254, h: 1254,
      focus: '50% 50%', alpha: true, alt: '闭鳞纹',
    },
  };

  /* 2026-11-16：curated 产物的入口。路径带 assets/ 前缀，get() 会原样用，
     不再拼 BASE —— 旧的 veteran-v1 目录保留，两边可以共存。 */
  const CURATED = 'assets/art/curated/';

  Object.entries({
    'veteran.icon.etching':      'icons/etching_scroll.png',
    'veteran.icon.channel':      'icons/rune_channel.png',
    'veteran.icon.capacitor':    'icons/rune_capacitor.png',
    'veteran.icon.ember':        'icons/rune_ember.png',
    'veteran.icon.splitter':     'icons/rune_splitter.png',
    'veteran.icon.threshold':    'icons/rune_threshold.png',
    'veteran.icon.scar':         'icons/scar_mark.png',
    'veteran.icon.rust':         'icons/rust_mark.png',
  }).forEach(([id, path]) => {
    ASSETS[id] = { path: CURATED + path, w: 32, h: 32, focus: '50% 50%', alpha: true, alt: '' };
  });

  /* 十四相板面轮廓：id 用底盘 archetype（full / bar / square …），
     和数据里的 BODIES[].archetype 一一对应，界面不用再记一张表。 */
  const ARCHETYPES = ['full', 'bar', 'square', 'cross', 'ring', 'ell', 'shield',
    'hourglass', 'bilobe', 'gear', 'crescent', 'stair', 'zigzag', 'spine'];
  ARCHETYPES.forEach((key) => {
    ASSETS['veteran.plate.' + key] = {
      path: CURATED + 'plates/plate_' + key + '.png',
      w: 120, h: 120, focus: '50% 50%', alpha: true, alt: '',
    };
  });

  const status = {};
  const cache = {};

  function get(id) {
    const a = ASSETS[id];
    if (!a) return null;
    /* 带 assets/ 前缀的是 curated 的绝对路径，其余仍按 veteran-v1 拼 */
    const src = a.path.startsWith('assets/') ? a.path : BASE + a.path;
    return Object.assign({ id, src }, a);
  }

  function load(id) {
    const art = get(id);
    if (!art) return Promise.resolve({ id, ok: false });
    if (status[id] === 'ready') return Promise.resolve({ id, ok: true, img: cache[id] });
    if (status[id] === 'failed') return Promise.resolve({ id, ok: false });
    if (status[id] === 'loading') {
      return new Promise((resolve) => {
        const wait = () => {
          if (status[id] === 'loading') setTimeout(wait, 60);
          else resolve({ id, ok: status[id] === 'ready', img: cache[id] });
        };
        wait();
      });
    }
    status[id] = 'loading';
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
      img.src = art.src;
    });
  }

  function preload(ids) {
    return Promise.all((ids || []).map(load)).then((rs) => ({
      loaded: rs.filter((r) => r.ok).map((r) => r.id),
      failed: rs.filter((r) => !r.ok).map((r) => r.id),
    }));
  }

  function image(id) {
    return status[id] === 'ready' ? cache[id] : null;
  }
  function isReady(id) { return status[id] === 'ready'; }
  function statusOf(id) { return status[id] || 'unknown'; }

  /**
   * imgTag(id, cls, extraStyle)
   * 失败时立刻返回空串（事后失败由 onerror 隐藏），不会留破图。
   */
  function imgTag(id, cls, extraStyle) {
    const art = get(id);
    if (!art) return '';
    if (status[id] === 'failed') return '';
    const style = `object-position:${art.focus};${extraStyle || ''}`;
    /* 这些图都由 preloadFor 按页面预取过，这里用 eager 命中缓存；
       lazy 会让首屏外的缩略图在截图/快速滚动时显示为空框。 */
    return `<img class="v-art ${cls || ''}" src="${art.src}" loading="eager" decoding="async"
      alt="${art.alt}" style="${style}"
      onerror="this.classList.add('art-broken');this.removeAttribute('src')">`;
  }

  /* ---------- v1 美术（营地场景 / 节点插画 / 立绘 / 首领） ---------- */

  /* 皮肤 → 立绘 id。2026-11-16 起十四人全有清洗头像，所以按 SKINS 直接推，
     不再手写六个 —— 手写的那份永远会漏掉后加的八位（wanderer0..7）。 */
  const SKIN_PORTRAIT = Object.fromEntries(
    (V.Data.SKINS || []).map((skin) => [skin.id, 'portrait.' + skin.id]),
  );

  /** 用 A.Art 的固定映射产出图片标签；没登记或已失败时返回 ''。 */
  function v1Tag(id, cls, style) {
    const art = A.Art && A.Art.getArt ? A.Art.getArt(id) : null;
    if (!art) return '';
    if (A.Art.statusOf(id) === 'failed') return '';
    return `<img class="v-art v1-art ${cls || ''}" src="${art.src}" loading="lazy" decoding="async"
      alt="" style="object-position:${art.objectPosition};${style || ''}"
      onerror="this.classList.add('art-broken');this.removeAttribute('src')">`;
  }

  /** 任意图片 id：v1 优先，其次 veteran-v1。 */
  function anyImgTag(id, cls, style) {
    return v1Tag(id, cls, style) || imgTag(id, cls, style);
  }

  /** 老兵立绘：按皮肤取 v1 肖像，缺失时返回 ''，卡片保留文字布局。 */
  function portraitTag(skinId, cls) {
    const id = SKIN_PORTRAIT[skinId];
    if (id) return v1Tag(id, 'portrait-img ' + (cls || ''));
    const skin = V.Data.SKINS.find((s) => s.id === skinId);
    if (!skin || skin.portraitCell == null) return '';
    const x = skin.portraitCell % 4, y = Math.floor(skin.portraitCell / 4);
    return `<svg class="v-art portrait-img portrait-atlas ${cls || ''}" viewBox="${x + 0.008} ${y + 0.008} .984 .984" preserveAspectRatio="xMidYMin slice" role="img" aria-label="${skin.name}"><image href="assets/art/portraits-v2/wanderers.png" x="0" y="0" width="4" height="4" onerror="this.parentNode.classList.add('art-broken')"/></svg>`;
  }

  /** 首领肖像：gatekeeper / memoryEater。 */
  function bossTag(bossId, cls) {
    if (!bossId || !A.Art.getArt('enemy.' + bossId)) return '';
    return v1Tag('enemy.' + bossId, 'boss-img ' + (cls || ''));
  }

  /** 板面轮廓缩略图：按底盘 archetype 取 curated/plates/plate_<key>.png。
      缺图时返回空串，调用方保留原有排版（不留破图）。 */
  function plateTag(archetype, cls) {
    const id = 'veteran.plate.' + archetype;
    const art = get(id);
    if (!art || status[id] === 'failed') return '';
    return `<img class="v-art plate-art ${cls || ''}" src="${art.src}" loading="eager" decoding="async"
      alt="" style="object-position:${art.focus}"
      onerror="this.classList.add('art-broken');this.removeAttribute('src')">`;
  }

  /** 图标：etching / channel / capacitor / ember / splitter / threshold / scar / rust。 */
  function iconTag(name, cls) {
    const id = 'veteran.icon.' + name;
    const art = get(id);
    if (!art || status[id] === 'failed') return '';
    return `<img class="v-art icon-art ${cls || ''}" src="${art.src}" loading="eager" decoding="async"
      alt="" onerror="this.classList.add('art-broken');this.removeAttribute('src')">`;
  }

  /* 纹路模板 → 收藏品物件图 */
  const TEMPLATE_ART = Object.fromEntries(Object.values(V.Data.TEMPLATES).map((t) => [t.id, t.relicArt]));

  function relicArtFor(templateId) {
    return TEMPLATE_ART[templateId] || null;
  }

  /** 纹路缩略图：没有图时返回空串，调用方保留文字布局。 */
  function relicThumb(templateId) {
    const mark = V.RuneArt?.thumb(templateId, 'relic-img');
    return mark ? `<span class="relic-thumb">${mark}</span>` : '';
  }

  /** 场景横幅：图缺失时整块不渲染，CSS 渐变兜底。
      先查 v1（营地 / 节点插画），再查 veteran-v1（工坊 / 营火 / 静养）。 */
  function sceneBanner(sceneId, cls, title, sub) {
    const img = anyImgTag(sceneId, 'banner-img');
    return `<div class="v-banner ${cls || ''} ${img ? '' : 'no-art'}">
      ${img}
      ${title ? `<div class="v-banner-title">${title}</div>` : ''}
      ${sub ? `<div class="v-banner-sub">${sub}</div>` : ''}
    </div>`;
  }

  function preloadFor(screen) {
    if (screen === 'camp' || screen === 'workshop') {
      return preload(['veteran.scene.workshop', 'veteran.surface.board']);
    }
    if (screen === 'campNode') return preload(['veteran.scene.field']);
    if (screen === 'history') return preload(['veteran.scene.recovery']);
    return Promise.resolve({ loaded: [], failed: [] });
  }

  V.Art = {
    BASE, ASSETS, TEMPLATE_ART, SKIN_PORTRAIT, get, load, preload, image, isReady, statusOf,
    imgTag, v1Tag, anyImgTag, portraitTag, bossTag, plateTag, iconTag, CURATED,
    relicArtFor, relicThumb, sceneBanner, preloadFor,
  };
})(globalThis.Ashen ||= {});
