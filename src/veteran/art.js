'use strict';
/* 老兵回路版美术映射。旧 A.Art 的 BASE 固定指向 v1，
   这里用独立映射，避免把 veteran-v1 的相对路径拼到 v1 目录下。
   资源缺失时只返回 ''，由 CSS 渐变底 + SVG 图标降级。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  const BASE = 'assets/art/veteran-v1/';

  const ASSETS = {
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
      focus: '50% 50%', alt: '生命金属板面底材',
    },
    'veteran.relic.channel': {
      path: 'relics/ember-channel.png', w: 1254, h: 1254,
      focus: '50% 50%', alpha: true, alt: '导能残片',
    },
    'veteran.relic.capacitor': {
      path: 'relics/pulse-chamber.png', w: 1254, h: 1254,
      focus: '50% 50%', alpha: true, alt: '脉冲储能腔',
    },
    'veteran.relic.splitter': {
      path: 'relics/prism-splitter.png', w: 1254, h: 1254,
      focus: '50% 50%', alpha: true, alt: '三叉分流构件',
    },
    'veteran.relic.threshold': {
      path: 'relics/threshold-seal.png', w: 1254, h: 1254,
      focus: '50% 50%', alpha: true, alt: '阈值闸',
    },
  };

  const status = {};
  const cache = {};

  function get(id) {
    const a = ASSETS[id];
    if (!a) return null;
    return Object.assign({ id, src: BASE + a.path }, a);
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

  /* 构件模板 → 收藏品物件图 */
  const TEMPLATE_ART = {
    straight: 'veteran.relic.channel',
    elbow: 'veteran.relic.channel',
    ember: 'veteran.relic.channel',
    capacitor: 'veteran.relic.capacitor',
    splitter: 'veteran.relic.splitter',
    threshold: 'veteran.relic.threshold',
  };

  function relicArtFor(templateId) {
    return TEMPLATE_ART[templateId] || null;
  }

  /** 构件缩略图：没有图时返回空串，调用方保留文字布局。 */
  function relicThumb(templateId) {
    const id = relicArtFor(templateId);
    if (!id) return '';
    return `<span class="relic-thumb">${imgTag(id, 'relic-img')}</span>`;
  }

  /** 场景横幅：图缺失时整块不渲染，CSS 渐变兜底。 */
  function sceneBanner(sceneId, cls, title, sub) {
    const img = imgTag(sceneId, 'banner-img');
    return `<div class="v-banner ${cls || ''} ${img ? '' : 'no-art'}">
      ${img}
      ${title ? `<div class="v-banner-title">${title}</div>` : ''}
      ${sub ? `<div class="v-banner-sub">${sub}</div>` : ''}
    </div>`;
  }

  function preloadFor(screen) {
    if (screen === 'camp' || screen === 'workshop') {
      return preload(['veteran.scene.workshop', 'veteran.surface.board',
        'veteran.relic.channel', 'veteran.relic.capacitor', 'veteran.relic.splitter', 'veteran.relic.threshold']);
    }
    if (screen === 'campNode') return preload(['veteran.scene.field']);
    if (screen === 'history') return preload(['veteran.scene.recovery']);
    return Promise.resolve({ loaded: [], failed: [] });
  }

  V.Art = {
    BASE, ASSETS, TEMPLATE_ART, get, load, preload, image, isReady, statusOf,
    imgTag, relicArtFor, relicThumb, sceneBanner, preloadFor,
  };
})(globalThis.Ashen ||= {});
