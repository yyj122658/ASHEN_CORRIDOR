'use strict';
/* 生命金属板面生成：从原型种子长出「不规则的一块铁」。

   形状与容量分开：
   - 原型种子（archetype）只决定气质：内部有「毛坯区」macro 与「允许区」allow；
   - 目标格数（target）决定容量：所有底盘统一 77 格，避免「谁大用谁」的公式化配队。

   包围盒 12×12：77/144 ≈ 53% 密度。包围盒再小会把形状吃掉——
   9×9 里塞 77 格是 95%，十四种原型会退化成同一个满方块。

   生成是纯函数：同一 seed + 同一 archetype + 同一 target 永远得到同一块铁，
   随机数只来自 A.Random（不读时钟、不读 Math.random），因此可以存档、可重放。

   约束（会被强制保证）：
   1. 单一连通块（四邻接），没有孤岛；
   2. 没有孤立格（每格至少一个面相邻），否则 2 格纹路永远放不进去；
   3. 孔洞不会被后续补格填回；
   4. 格数精确等于 target（补不满时返回实际值并标记）。
*/
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  const SIZE = 12;            // 包围盒 12×12（容 144 格，目标 77 → 密度 53%）
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const key = (x, y) => x + ',' + y;
  const unkey = (k) => k.split(',').map(Number);
  const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy);

  /* 所有底盘同格数：格数不再是强弱轴，形状只决定「哪几格能放」。
     原型的 allow 由 macro 外扩一圈自动生成，给收束阶段留补格余地。 */
  const PLATE_TARGET = 77;

  function expand(f) {
    return (x, y) => f(x, y)
      || f(x + 1, y) || f(x - 1, y) || f(x, y + 1) || f(x, y - 1);
  }

  /* 西方那套名字：圣髑院的《圣铁登记册》。
     圣髑院在奥伦的格雷沙姆——挂王室敕许的结社，管这本册子，
     实际上就是「国际炼金术标准委员会」的执行机构：定什么算正统，登记在册的才算。
     格雷沙姆自认是「炼金术的罗马」，罗马的合法性来自圣髑，所以每块活金属都被当圣髑编号归档。

     他们先定形制、再填名字，一栏一栏填，格式必须齐。
     所以这一列整齐得发闷：两字、三字、一个词，没有一个是抄写人自己发挥的。
     东方那套（name）正好相反，是从旧书里摘词，摘的人不敢改字，长短只能是原文的长度。
     两套都是正名，描述的是同一批形状：
     **东方问「它像什么」，西方问「它该归入哪一类」**——一个相信相似，一个相信秩序。
     这也正是功法和炼金术分家的那个岔口（东方走体内路线，西方走体外铭刻）。

     沃尔芬的材料共振派骂这本册子「给活的东西编目录」，可他们自己没别的一套词，
     骂着照用——碎片地带的人也一样。所以营地里西边七个人口径一致，东边那套才是另一个体系。 */
  const WEST = {
    full:      { name: 'Prima Materia',  zh: '原质',   form: '炼金 · 第一材料' },
    /* 形制名是**登记册的分类**，不是板面上的零件：这一列与「营造 · 窗棂」「军械 · 盾」
       并列，写的是「这东西归入哪一类器物」。所以这里用「纹章」，而零件叫「纹路」——
       两层词，各管各的（见 terms.js 的 ALLOW 白名单）。 */
    bar:       { name: 'Pale',           zh: '竖带',   form: '纹章 · 竖贯' },
    square:    { name: 'Tracery',        zh: '窗花格', form: '营造 · 窗棂' },
    cross:     { name: 'Rood',           zh: '苦像',   form: '圣所 · 十字' },
    ring:      { name: 'Reliquary',      zh: '圣物匣', form: '圣所 · 匣' },
    ell:       { name: 'Buttress',       zh: '扶壁',   form: '营造 · 倚柱' },
    shield:    { name: 'Pavise',         zh: '塔盾',   form: '军械 · 盾' },
    hourglass: { name: 'Cucurbit',       zh: '葫芦瓶', form: '炼金 · 甑' },
    bilobe:    { name: 'Amphora',        zh: '双耳瓶', form: '器用 · 瓶' },
    gear:      { name: 'Rota',           zh: '命轮',   form: '图象 · 轮' },
    crescent:  { name: 'Scythe',         zh: '长镰',   form: '军械 · 刃' },
    stair:     { name: "Jacob's Ladder", zh: '天梯',   form: '经卷 · 梯' },
    zigzag:    { name: 'Labyrinth',      zh: '迷径',   form: '图象 · 曲' },
    spine:     { name: 'Scourge',        zh: '苦鞭',   form: '戒律 · 鞭' },
  };

  /* 原型种子：macro = 初始毛坯，allow = 允许长到的范围（形状身份靠它保住）。
     name 是《铁相录》里的十四相（正名），likeness 是作坊里的外号，source 是正名的出处。
     相是「形状的类」，底盘是「某个人手上那块铁」，别混。

     《铁相录》是苍梧（东洲）传抄的私本，不是官修。
     钧天的修行管理总局编过一版「定本」，编不下去——要统一就得给没名的形状现造字，
     而抄谱的人守的第一条规矩就是「不自己造字」。所以现在通行的还是那本长短不齐的抄本。

     十四相的正名**没有一个是自己编的**，全是从旧书里摘的现成词：
     铸钟的官、量地的篇、相剑的句子、礼天的玉。
     理由很实在——自己编的比喻各人各说，一个师傅叫「弯月」、另一个叫「镰刀」，
     图谱就没法通用了；而旧书里的词被十几代人读过，谁看了都不会理解偏。
     摘词的人不敢改字，原文多长就是多长，所以十四相的名字长短不齐：
     两字的「楚腰」和五字的「地不满东南」并排躺着，没人觉得该削平。
     作坊里的人私下还叫外号（likeness），那是口头的话，进不了谱页。 */
  const ARCHETYPES = (() => {
    const raw = {
      full: {
        /* 77 = 11×7，正好铺满一块实心板。故意让毛坯面积**等于**目标：
           少了要往外补（长出毛刺），多了要往里啃（边缘啃成豁口）。
           等于目标时，腐蚀掉的格子会被原样还回去，最终永远是那块规整的方板——
           这就是「浑沌未凿」：一块一个孔都没开过的板，什么都能刻，什么都不特别顺。
           《庄子·应帝王》里浑沌本是完整的，被人「日凿一窍」，七日就死了——
           所以这一相的好处和坏处是同一件事：没开过孔，也就没有任何一处已经顺了手。 */
        name: '浑沌未凿', source: '《庄子·应帝王》：日凿一窍，七日而浑沌死',
        likeness: '一块一个孔都没开过的坯', erode: 0.2,
        macro: (x, y) => x <= 10 && y >= 2 && y <= 8,
      },
      bar: {
        /* 长条。正名取《礼记·玉藻》的笏制：诸侯执象笏，那是一块又长又窄的板，
           上朝时握在手里。作坊里没人说得出「笏」，只说是房塌了剩下的那根梁。 */
        name: '象笏', source: '《礼记·玉藻》：诸侯以象（笏）',
        likeness: '房塌了以后只剩下来的一根梁', erode: 0.3,
        macro: (x) => x >= 2 && x <= 8,
      },
      square: {
        /* 《老子》十一章：「凿户牖以为室，当其无，有室之用。」
           方框上挖出两处空——正是「凿户牖」。这一相的道理和老子的原话一样：
           有用的不是那几块铁，是空出来的地方。 */
        name: '凿户牖', source: '《老子》十一章：凿户牖以为室，当其无，有室之用',
        likeness: '窗上漏花的格，方整却挡不全风', erode: 0.8,
        macro: (x, y) => x >= 1 && x <= 9 && y >= 1 && y <= 9,
      },
      cross: {
        /* 《尔雅·释宫》：「四达谓之衢。」一达是路，二达是歧，三达是剧旁，四达才是衢。
           十字四头都通，正好是「衢」的定义。 */
        name: '四达之衢', source: '《尔雅·释宫》：四达谓之衢',
        likeness: '城中心那口四通的十字路口', erode: 0.45,
        macro: (x, y) => (x >= 3 && x <= 8) || (y >= 3 && y <= 8),
      },
      ring: {
        /* 壁厚固定 2 格：这是「瓮壁」，不是一圈随便挖空的框。
           以前毛坯是 108 格（壁厚 3）再腐蚀回 77，壁被啃得厚薄不一，
           底子塌一半，看着像破环而不是瓮。毛坯 80 格 + 轻微腐蚀，壁就齐了。
           正名取《考工记》攻金之工一节里最末一条「鉴燧之齐」——镜与阳燧，铸来照见和聚火，
           「金锡半」是六种配比里锡最重的一种，白而硬，只用来做这个。
           一块中间空透的板，用铸镜的配比来叫它，是摘词的人能做的最贴切的借用。 */
        name: '鉴燧之齐', source: '《考工记·攻金之工》：金锡半，谓之鉴燧之齐',
        likeness: '吊在灶上的一口空瓮，壁是通的，肚是空的', erode: 0.12, minHoles: 1,
        macro: (x, y) => !(x >= 2 && x <= 9 && y >= 2 && y <= 9),
      },
      ell: {
        /* 缺的是右下角。图上看右上为东北、左下为西南，缺右下就是缺东南。
           《淮南子·天文训》讲共工触不周山：天倾西北，地不满东南。
           「地不满东南」五个字，原文多长就多长，摘词的人一个字没敢改。 */
        name: '地不满东南', source: '《淮南子·天文训》：天倾西北，故日月星辰移焉；地不满东南，故水潦尘埃归焉',
        likeness: '塌了一角的墙根', erode: 0.7,
        macro: (x, y) => x <= 10 && y <= 10 && !(x >= 7 && y >= 7),
      },
      shield: {
        /* 上宽下尖，收成一线。这是书法里竖画的「悬针」——起笔重，收笔尖。
           传卫夫人《笔阵图》论「悬针垂露之异」。用笔法给铁命名，
           是因为这一相讲究的也正是收笔那一下：收到哪里，格就断在哪里。 */
        name: '悬针', source: '卫夫人《笔阵图》：悬针垂露之异',
        likeness: '挂在墙上的盾，上宽下尖，两边压得只剩一线', erode: 0.7,
        macro: (x, y) => (y <= 9 ? (x >= 1 && x <= 10) : Math.abs(x - 5.5) <= (11 - y) * 1.6),
      },
      hourglass: {
        /* 《韩非子·二柄》：「楚灵王好细腰，而国中多饿人。」楚腰两个字，
           后来成了「细」的代称。掐细了腰的坛子，正名就叫这个。 */
        name: '楚腰', source: '《韩非子·二柄》：楚灵王好细腰，而国中多饿人',
        likeness: '掐细了腰的坛子', erode: 0.5,
        macro: (x, y) => {
          const w = y < 6 ? 1 + y * 0.9 : 1 + (11 - y) * 0.9;
          return Math.abs(x - 5.5) <= w;
        },
      },
      bilobe: {
        /* 两团并排、中间相连。并蒂莲是一茎两花，古人以为符瑞——
           「蒂」是花和茎相接的那一处，正是两团之间那一点连着的格。 */
        name: '并蒂', source: '并蒂莲：一茎两花，古人以为符瑞',
        likeness: '一根茎上结出的两颗果', erode: 0.65,
        macro: (x, y) => dist(x, y, 4.5, 5.5) <= 4.6 || dist(x, y, 7.5, 5.5) <= 4.6,
      },
      gear: {
        /* 《考工记·轮人》：「牙也者，以为固抱也。」轮子最外那圈叫「牙」，
           作用是箍住辐条，不让它散。齿缘这一相，正名就取这个「牙」字。 */
        name: '轮牙', source: '《考工记·轮人》：牙也者，以为固抱也',
        likeness: '磨坊里那圈咬合用的齿轮', erode: 0.45,
        macro: (x, y) => {
          const d = dist(x, y, 5.5, 5.5);
          if (d <= 5.2) return true;
          if (d > 6.6) return false;
          return Math.cos(Math.atan2(y - 5.5, x - 5.5) * 8) > 0.1;
        },
      },
      crescent: {
        /* 《周礼·春官·大宗伯》：「以玄璜礼北方。」半璧曰璜——璜是弧形的玉，
           两端穿绳，所以必有一个孔。这一相也是一弧、也必有一孔，
           孔是钝掉的那一处，不是缺陷；沿革下来就成了作坊里说的「那把弯镰」。 */
        name: '玄璜', source: '《周礼·春官·大宗伯》：以玄璜礼北方（半璧曰璜）',
        likeness: '挂在梁上的镰刀，刃在内侧', erode: 0.1, minHoles: 1,
        /* 两圆相减：外圆给弧背，内圆给刃口。内圆要够大够靠右，两头才收得出尖——
           内圆小、偏中间的话，削出来的是「左边一厚块」，不是镰刀。
           毛坯 80 格，比目标多 3 格，收束只啃掉两头的毛刺，刀形不会走样。 */
        macro: (x, y) => dist(x, y, 5.5, 5.5) <= 7.6 && dist(x, y, 9.8, 5.5) >= 5.3,
      },
      stair: {
        /* 《老子》六十四章：「九层之台，起于累土。」一级级往上垒、
           越往下一级越宽，正是这一相。取这句，是因为它讲的是「垒」而不是「形」。 */
        name: '九层之台', source: '《老子》六十四章：九层之台，起于累土',
        likeness: '往下一级级收窄的石阶', erode: 0.45,
        macro: (x, y) => (y <= 3 && x >= 1) || (y >= 4 && y <= 7 && x >= 3) || (y >= 8 && x >= 5),
      },
      zigzag: {
        /* 《诗·秦风·蒹葭》：「溯洄从之，道阻且长。」逆流而上是来回折的，
           没有一条直路。这一相的形状就是那道折痕——不是画歪了，是水路本来如此。 */
        name: '溯洄从之', source: '《诗·秦风·蒹葭》：溯洄从之，道阻且长',
        likeness: '水退下去时留在滩上的那道折痕', erode: 0.18,
        macro: (x, y) => Math.abs(x - (5.5 + 3.0 * Math.sin(y * 1.05))) <= 3.6,
      },
      spine: {
        /* 《诗·周颂·良耜》：「其崇如墉，其比如栉。」栉是梳子。
           一根脊、两排齿，密得能当梳——这一相就是「比」的那个样子。 */
        name: '栉比', source: '《诗·周颂·良耜》：其崇如墉，其比如栉',
        likeness: '一副脊骨带两排刺', erode: 0.28,
        macro: (x, y) => (x >= 5 && x <= 7)
          || ((x >= 0 && x <= 4) && [2, 3, 4, 8, 9, 10].includes(y))
          || ((x >= 8 && x <= 11) && [2, 3, 4, 8, 9, 10].includes(y)),
      },
    };
    const out = {};
    Object.entries(raw).forEach(([id, a]) => {
      out[id] = { id, target: PLATE_TARGET, ...a, west: WEST[id] || null, allow: expand(a.macro) };
    });
    return out;
  })();

  function makeRng(seed) {
    let s = seed >>> 0;
    return function rnd() {
      const r = A.Random.next(s);
      s = r.state;
      return r.value;
    };
  }

  function neighbors(set, x, y) {
    let n = 0;
    for (let i = 0; i < 4; i++) if (set.has(key(x + ORTH[i][0], y + ORTH[i][1]))) n++;
    return n;
  }

  /** 最大连通块（四邻接） */
  function largestComponent(set) {
    const seen = new Set();
    let best = [];
    for (const k of set) {
      if (seen.has(k)) continue;
      const comp = [];
      const stack = [k];
      seen.add(k);
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        const [x, y] = unkey(cur);
        for (let i = 0; i < 4; i++) {
          const nk = key(x + ORTH[i][0], y + ORTH[i][1]);
          if (set.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
        }
      }
      if (comp.length > best.length) best = comp;
    }
    return best;
  }

  function isConnected(set) { return largestComponent(set).length === set.size; }

  /**
   * 生成一块板面。
   * @param {object} opts {seed, archetype, target}
   * @returns {{cells:number[][], archetype:string, target:number, hit:boolean, seed:number}}
   */
  function buildOnce(archKey, arch, target, seed) {
    const rnd = makeRng(seed);

    let set = new Set();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) if (arch.macro(x, y)) set.add(key(x, y));
    }

    const canCut = (x, y) => {
      const trial = new Set(set);
      trial.delete(key(x, y));
      return trial.size > 0 && isConnected(trial);
    };

    /* 腐蚀与咬口删掉的格子按顺序记下来，收束阶段原样还回去用 */
    const removed = [];

    /* 1. 边缘腐蚀：按裸露边数判概率；每删一格先验证整块仍连通 */
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (!set.has(key(x, y))) continue;
        const exposed = 4 - neighbors(set, x, y) + (arch.allow(x, y) ? 0 : 4);
        if (exposed === 0) continue;
        /* erode 是每个原型的手感阀：厚块让它磨圆，细带/月牙几乎不磨，
           否则一刀下去先把自己的轮廓吃掉，再靠补格填回来就成了圆团。 */
        const soften = arch.erode == null ? 1 : arch.erode;
        const p = (exposed >= 3 ? 0.6 : exposed === 2 ? 0.45 : 0.3) * soften;
        if (rnd() >= p) continue;
        if (canCut(x, y)) { set.delete(key(x, y)); removed.push(key(x, y)); }
      }
    }

    /* 2. 咬口：1~2 处从边缘再切深一格 */
    const bites = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < bites; i++) {
      const bx = Math.floor(rnd() * SIZE);
      const by = Math.floor(rnd() * SIZE);
      if (!set.has(key(bx, by)) || neighbors(set, bx, by) > 2) continue;
      if (canCut(bx, by)) { set.delete(key(bx, by)); removed.push(key(bx, by)); }
    }

    /* 3. 孔洞：0~2 个，可能连成一条缝；不能把板面切成两块 */
    const holeCells = new Set();
    const holes = Math.floor(rnd() * 2.6);
    for (let i = 0; i < holes; i++) {
      const hx = 1 + Math.floor(rnd() * (SIZE - 2));
      const hy = 1 + Math.floor(rnd() * (SIZE - 2));
      if (neighbors(set, hx, hy) < 3) continue;
      const trial = new Set(set);
      const cut = [key(hx, hy)];
      trial.delete(key(hx, hy));
      if (rnd() < 0.55) {
        const horiz = rnd() < 0.5;
        const k2 = key(hx + (horiz ? 1 : 0), hy + (horiz ? 0 : 1));
        trial.delete(k2);
        cut.push(k2);
      }
      if (trial.size && isConnected(trial)) {
        set = trial;
        cut.forEach((k) => holeCells.add(k));
      }
    }

    /* 4. 收束到目标格数。
       多了就啃边缘（优先啃露头的），少了就**把刚啃掉的格子原位还回去**——
       注意不是「补凹处」。补凹处看着更聪明，实际会把新月内侧的口子填平、
       把十字的手臂填粗，十二个原型里有六个会因此长成圆团。
       LIFO 还原之后，最终形状永远是宏观轮廓的子集，形状身份不可能丢。 */
    let guard = 0;
    while (set.size > target && guard++ < 400) {
      const cand = [...set].filter((k) => {
        const [x, y] = unkey(k);
        return neighbors(set, x, y) <= 2;
      });
      if (!cand.length) break;
      /* 优先啃只剩一个邻居的露头格，轮廓才会自然收边 */
      const loose = cand.filter((k) => {
        const [x, y] = unkey(k);
        return neighbors(set, x, y) <= 1;
      });
      const pool = loose.length ? loose : cand;
      const pick = pool[Math.floor(rnd() * pool.length)];
      const [px, py] = unkey(pick);
      if (canCut(px, py)) set.delete(pick);
    }
    guard = 0;
    while (set.size < target && guard++ < 400) {
      /* 第一优先：把腐蚀/咬口啃掉的格子还回去 */
      let restored = false;
      while (removed.length && set.size < target) {
        const k = removed.pop();
        const [rx, ry] = unkey(k);
        if (neighbors(set, rx, ry) === 0) continue;
        set.add(k);
        restored = true;
      }
      if (set.size >= target) break;
      if (restored) continue;
      /* 还完了还不够，说明宏观轮廓本身就小于目标：只能在轮廓外一圈补，
         并且只补两面以上相邻的位置，免得长出毛刺 */
      const tight = [];
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const k = key(x, y);
          if (set.has(k) || holeCells.has(k) || !arch.allow(x, y)) continue;
          if (neighbors(set, x, y) >= 2) tight.push(k);
        }
      }
      if (!tight.length) break;
      set.add(tight[Math.floor(rnd() * tight.length)]);
    }

    /* 5. 清孤立格，只保留最大连通块 */
    let changed = true;
    while (changed) {
      changed = false;
      for (const k of [...set]) {
        const [x, y] = unkey(k);
        if (neighbors(set, x, y) === 0) { set.delete(k); changed = true; }
      }
    }
    const finalSet = new Set(largestComponent(set));
    const cells = [...finalSet].map(unkey).sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));

    return {
      cells,
      archetype: archKey,
      target,
      seed,
      holes: analyze(cells).holes,
      hit: cells.length === target,
    };
  }

  /**
   * 对外入口。形状保证（格数命中 + 最小孔数）靠确定性重试：
   * 同一 seed 的重试序列固定，所以仍然可存档、可重放。
   */
  function generate(opts) {
    const o = opts || {};
    const archKey = ARCHETYPES[o.archetype] ? o.archetype : 'full';
    const arch = ARCHETYPES[archKey];
    const target = Number.isFinite(o.target) ? o.target : arch.target;
    const seed = (o.seed == null ? 1 : o.seed) >>> 0;
    const needHoles = arch.minHoles || 0;

    let best = null;
    for (let i = 0; i < 24; i++) {
      const trySeed = (seed + Math.imul(i, 0x9E3779B1)) >>> 0;
      const cand = buildOnce(archKey, arch, target, trySeed);
      cand.holes = analyze(cand.cells).holes;
      cand.hit = cand.cells.length === target && cand.holes >= needHoles;
      cand.seed = seed;
      if (!best) best = cand;
      else if (cand.hit && !best.hit) best = cand;
      else if (!best.hit && !cand.hit && Math.abs(cand.cells.length - target) < Math.abs(best.cells.length - target)) best = cand;
      if (cand.hit) return cand;
    }
    return best;
  }

  /**
   * 板面几何分析：宽高、孔洞数（不与外部连通的空格）、最长直线段。
   * 孔洞用「从包围盒边界向内泛洪」，剩下的空格就是被围住的洞。
   */
  function analyze(cells) {
    const set = new Set((cells || []).map((c) => key(c[0], c[1])));
    if (!set.size) {
      return { count: 0, width: 0, height: 0, holes: 0, longestRun: 0, connected: false };
    }
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const minX = Math.min.apply(null, xs);
    const maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys);
    const maxY = Math.max.apply(null, ys);

    /* 泛洪外侧空格（包围盒外扩一圈作为起点） */
    const outside = new Set();
    const stack = [[minX - 1, minY - 1]];
    outside.add(key(minX - 1, minY - 1));
    while (stack.length) {
      const [x, y] = stack.pop();
      for (let i = 0; i < 4; i++) {
        const nx = x + ORTH[i][0];
        const ny = y + ORTH[i][1];
        if (nx < minX - 1 || ny < minY - 1 || nx > maxX + 1 || ny > maxY + 1) continue;
        const k = key(nx, ny);
        if (outside.has(k) || set.has(k)) continue;
        outside.add(k);
        stack.push([nx, ny]);
      }
    }
    let holes = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const k = key(x, y);
        if (!set.has(k) && !outside.has(k)) holes++;
      }
    }

    /* 最长连续段（横或竖） */
    let run = 0;
    for (let y = minY; y <= maxY; y++) {
      let cur = 0;
      for (let x = minX; x <= maxX + 1; x++) {
        if (set.has(key(x, y))) cur++;
        else { if (cur > run) run = cur; cur = 0; }
      }
    }
    for (let x = minX; x <= maxX; x++) {
      let cur = 0;
      for (let y = minY; y <= maxY + 1; y++) {
        if (set.has(key(x, y))) cur++;
        else { if (cur > run) run = cur; cur = 0; }
      }
    }

    return {
      count: set.size,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      holes,
      longestRun: run,
      connected: isConnected(set),
    };
  }

  V.PlateGen = { SIZE, PLATE_TARGET, ARCHETYPES, generate, analyze, isConnected };
})(globalThis.Ashen ||= {});
