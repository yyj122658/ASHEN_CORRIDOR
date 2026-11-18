'use strict';
/* 十四相各有固定轮廓。# 为普通格，@ 标时钟心核，+ 标先天锚点。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const SIZE = 12;
  const PLATE_TARGET = 77;
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const key = (x, y) => x + ',' + y;

  /* 圣髑院《圣铁登记册》的形制名。 */
  const WEST = {
    hundun:     { name: 'Prima Materia',  zh: '原质',   form: '炼金 · 第一材料' },
    xianghu:    { name: 'Pale',           zh: '竖带',   form: '纹章 · 竖贯' },
    zaohuyou:   { name: 'Tracery',        zh: '窗花格', form: '营造 · 窗棂' },
    sida:       { name: 'Rood',           zh: '苦像',   form: '圣所 · 十字' },
    jiansui:    { name: 'Reliquary',      zh: '圣物匣', form: '圣所 · 匣' },
    dibuman:    { name: 'Buttress',       zh: '扶壁',   form: '营造 · 倚柱' },
    xuanzhen:   { name: 'Pavise',         zh: '塔盾',   form: '军械 · 盾' },
    chuyao:     { name: 'Cucurbit',       zh: '葫芦瓶', form: '炼金 · 甑' },
    bingdi:     { name: 'Amphora',        zh: '双耳瓶', form: '器用 · 瓶' },
    lunya:      { name: 'Rota',           zh: '命轮',   form: '图象 · 轮' },
    xuanhuang:  { name: 'Scythe',         zh: '长镰',   form: '军械 · 刃' },
    jiuceng:    { name: "Jacob's Ladder", zh: '天梯',   form: '经卷 · 梯' },
    suhui:      { name: 'Labyrinth',      zh: '迷径',   form: '图象 · 曲' },
    zhibi:      { name: 'Scourge',        zh: '苦鞭',   form: '戒律 · 鞭' },
  };

  const DESIGNS = {
    xianghu: {
      name: '象笏', source: '《礼记·玉藻》：诸侯以象（笏）',
      likeness: '房塌了以后只剩下来的一根梁',
      rows: [
        '....###',
        '....####',
        '...######',
        '..###+####',
        '##########',
        '#####@####',
        '.##########',
        '..###+#####',
        '...########',
        '....#####',
        '....####',
      ],
    },
    hundun: {
      name: '浑沌未凿', source: '《庄子·应帝王》：日凿一窍，七日而浑沌死',
      likeness: '一块一个孔都没开过的坯',
      rows: [
        '',
        '',
        '###########',
        '###########',
        '###########',
        '#####@#####',
        '###########',
        '###########',
        '###########',
      ],
    },
    suhui: {
      name: '溯洄从之', source: '《诗·秦风·蒹葭》：溯洄从之，道阻且长',
      likeness: '水退下去时留在滩上的那道折痕',
      rows: [
        '......######',
        '....#######',
        '..#######',
        '.########',
        '###+####',
        '..###+@##',
        '...########',
        '....#######',
        '.....###+###',
        '...#######',
        '.#####',
      ],
    },
    xuanzhen: {
      name: '悬针', source: '卫夫人《笔阵图》：悬针垂露之异',
      likeness: '挂在墙上的盾，上宽下尖，两边压得只剩一线',
      rows: [
        '..###',
        '.#####',
        '.#+####',
        '########',
        '#########',
        '+##@########',
        '##########',
        '#########',
        '##+####',
        '.#####',
        '..###',
      ],
    },
    jiansui: {
      name: '鉴燧之齐', source: '《考工记·攻金之工》：金锡半，谓之鉴燧之齐',
      likeness: '吊在灶上的一口空瓮，壁是通的，肚是空的',
      rows: [
        '....###',
        '..#######',
        '.####@####',
        '#####+#####',
        '####....###',
        '###+....###',
        '####....+##',
        '####....###',
        '.#########',
        '..#######',
        '....###',
      ],
    },
    zaohuyou: {
      name: '凿户牖', source: '《老子》十一章：凿户牖以为室，当其无，有室之用',
      likeness: '窗上漏花的格，方整却挡不全风',
      rows: [
        '',
        '.#########',
        '##..###..##',
        '##..###..##',
        '###########',
        '####+@+####',
        '###########',
        '##..###..##',
        '.#..###..#',
        '.#########',
      ],
    },
    lunya: {
      name: '轮牙', source: '《考工记·轮人》：牙也者，以为固抱也',
      likeness: '磨坊里那圈咬合用的齿轮',
      rows: [
        '.....+',
        '...#####+',
        '.+#######',
        '.#########',
        '.#########',
        '+####@####+',
        '.#########',
        '.#########',
        '..#######+',
        '..+#####',
        '.....+',
      ],
    },
    zhibi: {
      name: '栉比', source: '《诗·周颂·良耜》：其崇如墉，其比如栉',
      likeness: '一副脊骨带两排刺',
      rows: [
        '...#####',
        '.#########',
        '...##+##',
        '.####+####',
        '...##+##',
        '####@+#####',
        '...##+##',
        '.####+####',
        '...##+##',
        '.#########',
        '...#####',
      ],
    },
    xuanhuang: {
      name: '玄璜', source: '《周礼·春官·大宗伯》：以玄璜礼北方（半璧曰璜）',
      likeness: '挂在梁上的镰刀，刃在内侧',
      rows: [
        '...#######+',
        '.##########',
        '##@#######',
        '######',
        '###',
        '###',
        '####',
        '######',
        '#########',
        '.##########',
        '...#######+',
      ],
    },
    jiuceng: {
      name: '九层之台', source: '《老子》六十四章：九层之台，起于累土',
      likeness: '往下一级级收窄的石阶',
      rows: [
        '....###',
        '....###',
        '....###',
        '..##+####',
        '..#######',
        '..#######',
        '..###@###',
        '..#######',
        '##+########',
        '###########',
        '###########',
      ],
    },
    dibuman: {
      name: '地不满东南', source: '《淮南子·天文训》：天倾西北，故日月星辰移焉；地不满东南，故水潦尘埃归焉',
      likeness: '塌了一角的墙根',
      rows: [
        '',
        '.##########',
        '.##########',
        '.##########',
        '.###@######',
        '.########+',
        '.########',
        '.######+',
        '.######',
        '.###+',
        '.###',
      ],
    },
    chuyao: {
      name: '楚腰', source: '《韩非子·二柄》：楚灵王好细腰，而国中多饿人',
      likeness: '掐细了腰的坛子',
      rows: [
        '.#########',
        '.##########',
        '.####@####',
        '..#######',
        '....####',
        '.....++',
        '....####',
        '..#######',
        '.#########',
        '.#########',
        '..#######',
      ],
    },
    bingdi: {
      name: '并蒂', source: '并蒂莲：一茎两花，古人以为符瑞',
      likeness: '一根茎上结出的两颗果',
      rows: [
        '',
        '.###...###',
        '####...####',
        '#####.#####',
        '##@##.##@##',
        '#####.#####',
        '#####.#####',
        '.####.####',
        '..###.###',
        '...##.##',
        '...##+##',
      ],
    },
    sida: {
      name: '四达之衢', source: '《尔雅·释宫》：四达谓之衢',
      likeness: '城中心那口四通的十字路口',
      rows: [
        '....###',
        '...#####',
        '...#####',
        '.#########',
        '#####@#####',
        '#####+#####',
        '###########',
        '.#########',
        '...#####',
        '...#####',
        '....###',
      ],
    },
  };

  const ARCHETYPES = {};
  const FIXED = {};
  for (const [id, design] of Object.entries(DESIGNS)) {
    const { rows, ...lore } = design;
    const cells = [];
    const clockCore = [];
    const innateNodes = [];
    rows.forEach((row, y) => {
      [...row].forEach((mark, x) => {
        if (mark === '.') return;
        cells.push([x, y]);
        if (mark === '@') clockCore.push([x, y]);
        if (mark === '+') innateNodes.push([x, y]);
      });
    });
    ARCHETYPES[id] = { id, target: PLATE_TARGET, ...lore, west: WEST[id] };
    FIXED[id] = { cells, clockCore, innateNodes, holes: analyze(cells).holes };
  }

  function generate(opts) {
    const id = opts && opts.archetype;
    const archetype = Object.hasOwn(FIXED, id) ? id : 'hundun';
    const { cells, clockCore, innateNodes, holes } = FIXED[archetype];
    const copy = (coords) => coords.map((cell) => cell.slice());
    return {
      cells: copy(cells), clockCore: copy(clockCore), innateNodes: copy(innateNodes),
      archetype, holes, target: PLATE_TARGET, hit: cells.length === PLATE_TARGET,
    };
  }

  function isConnected(set) {
    if (!set.size) return true;
    const first = set.values().next().value;
    const seen = new Set([first]);
    const stack = [first];
    while (stack.length) {
      const [x, y] = stack.pop().split(',').map(Number);
      for (const [dx, dy] of ORTH) {
        const next = key(x + dx, y + dy);
        if (!set.has(next) || seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    return seen.size === set.size;
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
