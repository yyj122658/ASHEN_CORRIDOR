'use strict';
/* 回廊食材、栖地与营火料理。 */
(function (A) {
  const V = (A.Veteran ||= {});

  const INGREDIENTS = Object.fromEntries([
    { id: 'lampKelp', name: '灯藻', source: '余光水道采集', desc: '沿水线结成发亮的薄带，叶梢有淡淡盐味。' },
    { id: 'sulfurLeaf', name: '硫叶', source: '硫泉阶井采集', desc: '一丛丛长在温泉边，剥去老叶便露出脆嫩的叶心。' },
    { id: 'heatBulb', name: '地火蒜', source: '黑炉底床采集', desc: '根须伸入热灰，烤熟的瓣肉带甜。' },
    { id: 'boneCap', name: '骨伞', source: '骸骨兵', desc: '长在骨缝里的厚菌盖，吸饱了残骸中的养分。' },
    { id: 'houndShank', name: '骨犬腱', source: '骨犬', desc: '骨架内侧的赤色腿腱，细筋耐炖。' },
    { id: 'shellLichen', name: '石衣', source: '石傀', desc: '成片贴在傀壳上的地衣。削下柔软的边缘就能下锅。' },
    { id: 'hingeSnail', name: '轴窝螺', source: '扰位石傀', desc: '躲在活动石节里的小螺，靠傀儡掀起的碎屑觅食。' },
    { id: 'mistJelly', name: '雾胶', source: '幽魂', desc: '幽魂聚形时裹住的一团菌胶，受热后慢慢化成浓汤。' },
    { id: 'gateComb', name: '甲巢蜜', source: '守门人', desc: '甲缝里一小片温热的蜂房，蜜汁带泉花香。' },
    { id: 'echoSac', name: '回声囊', source: '噬忆者', desc: '藏在颈鳍下的薄囊，割开后仍会发出细细的回音。' },
  ].map((item) => [item.id, item]));

  const ECOSYSTEM = {
    bone: { ingredient: 'boneCap', role: '分解者的载体', food: '骨伞分解腐骨，菌丝牵动骨兵。', habitat: '水道的旧骨堆、黑炉弃坑' },
    hound: { ingredient: 'houndShank', role: '追猎者', food: '追逐沿灯藻带啃食的水鼠，也会翻找井道残骸。', habitat: '余光水道与阶井下坡' },
    hulk: { ingredient: 'shellLichen', role: '移动的菌床', food: '壳上的石衣借井口微光生长，从傀体渗出的盐水取矿物。', habitat: '硫泉石壁、黑炉通风井' },
    shuffler: { ingredient: 'hingeSnail', role: '食腐者的宿主', food: '推开落石后，轴窝里的螺群钻出来吃碎藻和尸屑。', habitat: '阶井坍坡与深层碎石道' },
    wraith: { ingredient: 'mistJelly', role: '分解者', food: '雾胶消化落进冷凝水的组织，留下的矿泥养肥地火蒜。', habitat: '黑炉冷凝沟' },
    /* 亚种与精英沿用同族产物：一副骨架长不出第二种肉，只是采收量不同。 */
    boneBell: { ingredient: 'boneCap', role: '同族的另一支', food: '鸣钟骨守着旧钟，钟罩里积下的骨粉比别处厚。', habitat: '阶井的钟室、水道的回音厅' },
    houndLean: { ingredient: 'houndShank', role: '饿瘦的追猎者', food: '瘦犬跑得更远，腿腱细但筋道。', habitat: '三层的坡道与碎石堆' },
    hulkSlag: { ingredient: 'shellLichen', role: '烧过的菌床', food: '炉渣把壳面烤脆，地衣只长在没被烧透的缝里。', habitat: '黑炉底床的排渣口' },
    wraithChoir: { ingredient: 'mistJelly', role: '会唱的解者', food: '唱喑把同族的雾胶聚在自己身上，像抱着一团湿布。', habitat: '黑炉冷凝沟深处' },
    shufflerDragger: { ingredient: 'hingeSnail', role: '拖运者', food: '拖骸者把猎物拖回巢里，石节中的螺群跟着搬家。', habitat: '阶井的坍坡与拖痕尽头' },
    stoker: { ingredient: 'heatBulb', role: '添火的人', food: '火工往炉膛里丢地火蒜，蒜皮在热灰里自己裂开。', habitat: '黑炉底床的炉口' },
    gatekeeper: { ingredient: 'gateComb', role: '蜂群的宿主', food: '护甲中的蜂群采地火蒜花，守门人靠分得的蜜越冬。', habitat: '第七层炉门外壁' },
    memoryEater: { ingredient: 'echoSac', role: '顶层捕食者', food: '回声囊引来游荡幽魂，颈鳍随即合拢，吞下雾胶。', habitat: '第七层炉门内侧' },
    furnaceHeart: { ingredient: 'heatBulb', role: '还在烧的炉', food: '炉心俑本身就是炉膛，壳缝里塞满没烧完的蒜头。', habitat: '第七层炉心' },
  };

  const BIOMES = [
    { name: '余光水道', forage: 'lampKelp', desc: '天井余光养出一带灯藻。骨犬伏在岸边捕水鼠，骨伞从剩骨里冒头。' },
    { name: '硫泉阶井', forage: 'sulfurLeaf', desc: '温泉边的硫叶长得最密。石傀掀开叶泥，壳里的小螺便跟着出来捡食。' },
    { name: '黑炉底床', forage: 'heatBulb', desc: '地火蒜在热灰里抽芽。幽魂把腐质化成矿泥，炉门深处的噬忆者循雾追来。' },
  ];

  function biome(floor) { return BIOMES[floor <= 2 ? 0 : floor <= 4 ? 1 : 2]; }

  /* 同地生长或同一猎物身上的副产，每份基础材料另伴随其中一种。 */
  const COMPANIONS = {
    lampKelp: [
      ['reedPith', '水芦心', '紫芦细茎里的白芯，脆得一掰就断。'],
      ['poolShrimp', '灯池虾', '躲在藻叶背光面的细甲虾。'],
      ['siltGrain', '淤滩黍', '退水的浅滩上长着低矮而饱满的黍穗。'],
      ['saltPear', '盐梨', '垂进咸水的矮枝结出微酸的小梨。'],
    ],
    sulfurLeaf: [
      ['springCress', '温泉芹', '冒泡的泉眼边，嫩茎里存着清水。'],
      ['caveMillet', '井壁粟', '卡在石缝泥里的金黄色细谷。'],
      ['redMorel', '赤褶菌', '红伞下的深褶能挂住浓汤。'],
      ['brineBud', '盐花苞', '根泡在卤泉里，花苞本身就带咸味。'],
    ],
    heatBulb: [
      ['blackBean', '炉底豆', '黑色豆荚在炉壁余热中自然裂开。'],
      ['emberPepper', '烬椒', '暗红果皮细薄，烤后浮出甜辣香。'],
      ['nightPlum', '夜梅', '通风井的黑梅肉厚核小，酸味很足。'],
      ['ashRoot', '白灰薯', '深埋灰床的块根，断面像白瓷。'],
    ],
    boneCap: [
      ['ribSprout', '骨槽芽', '根尖扎进陈骨粉，啃下去却清甜。'],
      ['skullMoss', '盔苔', '骨兵盔内潮湿处附着的细嫩绿苔。'],
    ],
    houndShank: [
      ['houndMarrow', '骨犬髓', '细骨中央能推出一截乳白骨髓。'],
      ['houndFlank', '犬腹排', '骨犬肋下薄肉，顺着筋膜就能分片。'],
    ],
    shellLichen: [
      ['shellChestnut', '壳栗', '石傀背上的矮树将小栗子藏在缝里。'],
      ['basaltEar', '玄岩耳', '附生于傀壳阴面的黑色胶耳。'],
    ],
    hingeSnail: [
      ['axleCrab', '轴隙蟹', '寄在傀儡石节里的软甲小蟹。'],
      ['jointPea', '节窝豌豆', '随傀儡迁移的藤豆，常落进空石节。'],
    ],
    mistJelly: [
      ['dewPearl', '凝露珠', '雾胶边缘凝成的小囊，薄膜里含着甜露。'],
      ['mistFilm', '雾绡', '幽魂散去后仍能整张揭起的柔韧胶膜。'],
    ],
    gateComb: [
      ['combPollen', '甲巢花粉', '蜂群将炉蒜花粉藏在甲缝的干燥小室里。'],
      ['honeyGrub', '蜜房幼蛹', '胖乎乎的白蛹，带着蜂蜜的甜香。'],
    ],
    echoSac: [
      ['echoFin', '回声鳍', '噬忆者颈侧的薄鳍，贴炭即卷。'],
      ['memoryPearl', '忆珠', '回声囊内结出的软珠，切开有淡淡果香。'],
    ],
  };
  for (const [base, entries] of Object.entries(COMPANIONS)) {
    for (const [id, name, desc] of entries) INGREDIENTS[id] = { id, name, source: INGREDIENTS[base].source, desc };
  }

  /* 同源副产按烹调性质归入原材料家族，图鉴沿用每种材料自己的身份。 */
  const VARIETIES = {
    lampKelp: [
      ['glassWeed', '玻璃藻', 'lampKelp', '叶片近乎透明，炖煮时很快变软。'],
      ['ribbonWeed', '蓝绶藻', 'lampKelp', '长带状藻叶，凉拌后仍有韧性。'],
      ['silverRush', '银茎蒲', 'reedPith', '银灰蒲茎内藏着脆嫩的白芯。'],
      ['lanternPrawn', '红须灯虾', 'poolShrimp', '长须发红，尾肉细甜。'],
      ['mossShrimplet', '苔间青虾', 'poolShrimp', '栖在水苔边的小青虾。'],
      ['pebbleRice', '石隙稻', 'siltGrain', '从碎石间抽出的短穗，煮粥清香。'],
      ['tideQuince', '潮木梨', 'saltPear', '青黄果肉带一点潮水的咸味。'],
    ],
    sulfurLeaf: [
      ['copperChard', '铜脉菜', 'sulfurLeaf', '叶梗呈铜色，叶片宽大适合包馅。'],
      ['yellowDock', '黄泉酸叶', 'sulfurLeaf', '酸味顺着嫩叶的黄脉散开。'],
      ['cliffCelery', '岩壁芹', 'springCress', '细长嫩梗在崖壁滴水处成束长出。'],
      ['amberSpelt', '琥珀麦', 'caveMillet', '黏实的琥珀色麦仁能压成薄饼。'],
      ['chimneyMorel', '烟囱肚菌', 'redMorel', '中空菌身布满深坑，适合塞馅。'],
      ['foldCap', '百褶赤菇', 'redMorel', '细密菌褶里容易留住浓汁。'],
      ['saltCaper', '卤泉蕾', 'brineBud', '小小的未开花蕾带天然卤香。'],
    ],
    heatBulb: [
      ['coalOnion', '炭皮葱', 'heatBulb', '剥去黑皮便能闻到甜辛气味。'],
      ['coiledGarlic', '盘火蒜', 'heatBulb', '蒜瓣抱作螺旋，适合整头炙烤。'],
      ['rubyLentil', '赤晶扁豆', 'blackBean', '红色扁豆煨过便成绵密豆泥。'],
      ['ashChili', '灰尖椒', 'emberPepper', '灰白尖端下藏着炽红的椒肉。'],
      ['craterPlum', '炉坑李', 'nightPlum', '炉坑边熟透的紫李，汁多味酸。'],
      ['coalYam', '煤皮山药', 'ashRoot', '表皮黑硬，刮开却是雪白软肉。'],
      ['cinderTaro', '烬纹芋', 'ashRoot', '蒸熟后紫红纹路仍留在芋心。'],
    ],
    boneCap: [
      ['ivoryFan', '象牙扇菌', 'boneCap', '扇状菌帽在肋骨内侧层层铺开。'],
      ['jointButton', '关节圆菇', 'boneCap', '藏在关节窝的菌盖厚而圆。'],
      ['chalkCup', '灰杯菌', 'redMorel', '灰白菌体向上卷成小盏。'],
      ['spineShoots', '脊骨笋', 'ribSprout', '一排嫩笋沿骨缝整齐长出。'],
      ['marrowFern', '髓床蕨', 'ribSprout', '卷曲的嫩蕨从髓床的泥土中探头。'],
      ['crackSprig', '裂缝苗', 'springCress', '渗水骨缝里的细梗带芹香。'],
      ['velvetMoss', '骨绒苔', 'skullMoss', '骨面短绒般的细苔可以焙成薄片。'],
      ['crownMoss', '冠缘苔', 'skullMoss', '绕着盔缘形成绿色细带。'],
      ['boneLaver', '骨背紫苔', 'shellLichen', '紫色地衣紧贴骨背，阴干后有咸鲜味。'],
    ],
    houndShank: [
      ['heelCord', '犬踵筋', 'houndShank', '短而厚的跟筋需要慢慢煨软。'],
      ['redTendon', '赤背腱', 'houndShank', '顺着背脊延伸的长腱肌理分明。'],
      ['houndCheek', '猎犬颊肉', 'houndShank', '反复咬合留下的细筋适合久炖。'],
      ['shinCream', '胫骨白髓', 'houndMarrow', '骨管里的白髓质地滑润。'],
      ['hipMarrow', '髋骨红髓', 'houndMarrow', '靠近髋窝的红髓味道浓厚。'],
      ['spineFat', '脊脂', 'houndMarrow', '脊骨侧面的油脂稍遇热便融化。'],
      ['skirtBlade', '薄裙排', 'houndFlank', '纤维长而薄，横切可得嫩肉丝。'],
      ['ribEye', '肋心肉', 'houndFlank', '肋条中央的肉切片仍带细小油纹。'],
      ['tailSteak', '犬尾排', 'houndFlank', '近尾根的紧实肉排香气最足。'],
    ],
    shellLichen: [
      ['slateLichen', '板岩衣', 'shellLichen', '片状地衣沿壳面铺展。'],
      ['rustLichen', '赤锈地衣', 'shellLichen', '橙红边缘留着矿泉的咸香。'],
      ['golemMoss', '傀背青苔', 'skullMoss', '青苔在傀背的水洼周围生长。'],
      ['pebbleNut', '砾栗', 'shellChestnut', '小栗子壳硬如石，烤后会裂口。'],
      ['ridgeHazel', '脊棱榛', 'shellChestnut', '傀儡脊棱的矮枝上挂着成簇榛果。'],
      ['cragAcorn', '岩橡子', 'shellChestnut', '壳缝里掉出的橡仁带有淡淡坚果味。'],
      ['slateEar', '青板耳', 'basaltEar', '灰青胶耳在石板背阴处舒展开来。'],
      ['glassEar', '琉璃耳', 'basaltEar', '湿润时半透明，切丝特别爽脆。'],
      ['rockTrumpet', '石角菇', 'redMorel', '深褶的角形菌盖从傀壳空洞钻出。'],
    ],
    hingeSnail: [
      ['brassWhelk', '黄铜螺', 'hingeSnail', '铜色壳纹里藏着紧致螺肉。'],
      ['gearLimpet', '齿轮笠贝', 'hingeSnail', '扁壳吸在活动关节的齿边。'],
      ['jointClam', '石节蛤', 'hingeSnail', '关节积水中滤食的小蛤，汤汁很鲜。'],
      ['hingeClaw', '合页钳虾', 'poolShrimp', '一对小钳像傀儡转动的合页。'],
      ['stoneFiddler', '石窝招潮蟹', 'axleCrab', '巨钳间夹着细小的石屑。'],
      ['pinCrab', '销轴青蟹', 'axleCrab', '常贴着轴销潜伏，腹肉细嫩。'],
      ['curlPea', '卷须青豆', 'jointPea', '细卷须攀着石节，豆荚紧贴藤身。'],
      ['stoneVetch', '石缝巢豆', 'jointPea', '成串豆粒滚入石缝，饱满清甜。'],
      ['axleBean', '转轴乌豆', 'blackBean', '藏进轴窝的黑豆，味浓耐煮。'],
    ],
    mistJelly: [
      ['greyCurd', '烟凝乳', 'mistJelly', '雾胶外层的乳状物在冷石上凝结。'],
      ['violetGel', '紫霭胶', 'mistJelly', '幽魂聚形时透出紫色的柔软胶质。'],
      ['mistAgar', '雾心冻', 'mistJelly', '纯净凝胶在雾心结成厚块。'],
      ['rainBead', '雨雾珠', 'dewPearl', '珠囊里能尝到清凉的凝水。'],
      ['lanternDew', '磷灯露', 'dewPearl', '亮星般的露囊附在幽魂外沿。'],
      ['coldDroplet', '寒滴囊', 'dewPearl', '小囊摸起来总比周围更凉。'],
      ['fogVeil', '烟罗', 'mistFilm', '纱状薄膜可以轻轻揭起。'],
      ['paleSheet', '月白雾皮', 'mistFilm', '月白色胶皮受热就能舒展开。'],
      ['rippleFilm', '涟纹胶绡', 'mistFilm', '薄层上的水纹在热汤里仍然清晰。'],
    ],
    gateComb: [
      ['darkNectar', '炉花黑蜜', 'gateComb', '采自炉边暗色花丛的浓蜜。'],
      ['waxHoney', '封蜡清蜜', 'gateComb', '封盖蜂房内的蜜汁明亮清透。'],
      ['amberDrip', '甲隙流蜜', 'gateComb', '温热护甲间渗出的稠蜜。'],
      ['goldDust', '金花粉', 'combPollen', '金黄色的细粉带有花芯香。'],
      ['redPollen', '烬红蕊粉', 'combPollen', '细蜂把红花蕊粉压成小丸。'],
      ['hiveMeal', '巢底粉团', 'combPollen', '蜂巢底部存着松散的干粉团。'],
      ['waxGrub', '蜡房白蛹', 'honeyGrub', '软白蜂蛹留有一丝蜡房清香。'],
      ['amberPupa', '琥珀蜂蛹', 'honeyGrub', '薄皮透出蜜色，适合慢煎。'],
      ['queenLarva', '王台蜜蛹', 'honeyGrub', '深巢王台里格外饱满的一枚。'],
    ],
    echoSac: [
      ['chimeBladder', '铃鸣囊', 'echoSac', '窄小的共鸣囊发出短促铃声。'],
      ['hollowLobe', '空鸣瓣', 'echoSac', '薄囊卷作瓣状，便于包入馅料。'],
      ['throatBell', '喉钟囊', 'echoSac', '厚实囊壁在热锅里仍能维持形状。'],
      ['silverFin', '银边颈鳍', 'echoFin', '银色鳍缘贴火时最先变酥。'],
      ['whisperWing', '低语鳍', 'echoFin', '风过薄鳍能听见极轻的沙响。'],
      ['fanBlade', '扇骨鳍', 'echoFin', '软骨将扇状鳍片撑得很平。'],
      ['dreamBead', '梦珠', 'memoryPearl', '珠心呈淡紫色，入口略甜。'],
      ['soundOpal', '声纹软珀', 'memoryPearl', '薄切能看到层层声纹。'],
      ['hushPearl', '静音珠', 'memoryPearl', '沉在囊底的乳白软珠毫无回音。'],
    ],
  };
  for (const [base, entries] of Object.entries(VARIETIES)) {
    for (const [id, name, family, desc] of entries) INGREDIENTS[id] = { id, name, family, source: INGREDIENTS[base].source, desc };
  }

  function ingredientOptions(base) {
    return base ? [base, ...COMPANIONS[base].map(([id]) => id), ...VARIETIES[base].map(([id]) => id)] : [];
  }

  function forageOptions(floor) { return ingredientOptions(biome(floor).forage); }
  function harvestOptions(enemyType) { return ingredientOptions(ECOSYSTEM[enemyType]?.ingredient); }

  /** 原有基础材料必出，另从同源副产中取一份。种子不随重试或挑选的纹路改变。 */
  function addYield(loot, options, seed) {
    if (!Array.isArray(options) || !options.length) return loot;
    const extra = options.length > 1 ? options[A.Random.int(seed, 1, options.length - 1).value] : options[0];
    for (const id of [options[0], extra]) loot[id] = (loot[id] || 0) + 1;
    return loot;
  }

  const RECIPES = Object.fromEntries([
    { id: 'kelpBroth', name: '灯藻清汤', needs: { lampKelp: 1 }, heal: 0.09, calm: 8, method: '汤刚沸就下藻，叶缘卷起时分碗。' },
    { id: 'leafRoll', name: '炙硫叶卷', needs: { sulfurLeaf: 1 }, heal: 0.12, calm: 6, method: '嫩叶叠紧，在平石上烙出焦边。' },
    { id: 'ashGarlic', name: '灰埋蒜', needs: { heatBulb: 1 }, heal: 0.1, calm: 10, method: '整头埋入余灰，剥开焦皮分食甜芯。' },
    { id: 'roastCap', name: '石板骨伞', needs: { boneCap: 1 }, heal: 0.14, calm: 5, method: '菌盖朝下慢烤，连着伞褶里的原汁端起。' },
    { id: 'braisedShank', name: '慢煨犬腱', needs: { houndShank: 1 }, heal: 0.2, calm: 3, method: '切断筋纹入锅，煨到肉能离筋。' },
    { id: 'lichenCrisp', name: '薄焙石衣', needs: { shellLichen: 1 }, heal: 0.08, calm: 12, method: '揭下整片石衣，在温石上焙到边缘发脆。' },
    { id: 'steamSnail', name: '壳蒸轴螺', needs: { hingeSnail: 1 }, heal: 0.16, calm: 6, method: '螺口朝上架在锅沿，收住壳内鲜汁。' },
    { id: 'mistPudding', name: '凝雾羹', needs: { mistJelly: 1 }, heal: 0.1, calm: 14, method: '将雾胶打散，用余火搅到能挂住勺背。' },
    { id: 'combTea', name: '甲蜜饮', needs: { gateComb: 1 }, heal: 0.08, calm: 20, method: '捏开蜂房，让蜜顺着杯沿流进温水。' },
    { id: 'sacSkewer', name: '回声薄串', needs: { echoSac: 1 }, heal: 0.25, calm: 7, method: '剪开薄囊穿串，两面轮流贴近炭火。' },
    { id: 'reedStew', name: '灯藻骨伞锅', needs: { lampKelp: 1, boneCap: 1 }, heal: 0.28, calm: 13, method: '骨伞先炖出底汤，离火前铺一层嫩藻。' },
    { id: 'springSnails', name: '硫叶焗轴螺', needs: { sulfurLeaf: 1, hingeSnail: 1 }, heal: 0.3, calm: 14, method: '用硫叶裹住带壳螺，贴锅焗出清汁。' },
    { id: 'lichenShank', name: '石衣包腱', needs: { houndShank: 1, shellLichen: 1 }, heal: 0.36, calm: 13, method: '湿石衣裹住腱肉，炭焖至肉汁渗透外皮。' },
    { id: 'emberFondue', name: '地火蒜雾羹', needs: { heatBulb: 1, mistJelly: 1 }, heal: 0.26, calm: 25, method: '烤蒜压成泥，趁热搅入浓雾羹。' },
    { id: 'honeyEcho', name: '蜜炙回声囊', needs: { gateComb: 1, echoSac: 1 }, heal: 0.42, calm: 30, method: '先把囊片烤脆，最后薄刷甲蜜收光。' },
    { id: 'pithPickle', name: '盐渍芦心', needs: { reedPith: 1 }, heal: 0.07, calm: 10, method: '把芦心拍裂，用自身的咸汁浸软。' },
    { id: 'shrimpSkewer', name: '灯虾炭串', needs: { poolShrimp: 1 }, heal: 0.15, calm: 5, method: '从虾尾穿起，壳烤出红斑就翻一面。' },
    { id: 'siltCongee', name: '浅滩黍粥', needs: { siltGrain: 1 }, heal: 0.13, calm: 7, method: '黍粒泡胀后压碎，小火熬到泛起米油。' },
    { id: 'poachedPear', name: '温盐梨', needs: { saltPear: 1 }, heal: 0.06, calm: 11, method: '梨切成舟形，用滚水轻汆至边缘透明。' },
    { id: 'cressStems', name: '脆泉芹', needs: { springCress: 1 }, heal: 0.08, calm: 9, method: '嫩茎分指节切段，沸水一过随即摊凉。' },
    { id: 'milletCake', name: '井粟粑', needs: { caveMillet: 1 }, heal: 0.16, calm: 4, method: '把熟粟捣到发黏，拍扁贴锅烘香。' },
    { id: 'morelCup', name: '赤褶菌盏', needs: { redMorel: 1 }, heal: 0.12, calm: 9, method: '削平菌脚，将菌盏直立蒸熟，保留菌汁。' },
    { id: 'budTea', name: '盐花清饮', needs: { brineBud: 1 }, heal: 0.05, calm: 14, method: '半开的花苞在杯中轻揉，冲水后滤去花托。' },
    { id: 'blackMash', name: '炉豆泥', needs: { blackBean: 1 }, heal: 0.18, calm: 6, method: '豆煮开花，用锅底余温压成粗泥。' },
    { id: 'pepperSkin', name: '虎皮烬椒', needs: { emberPepper: 1 }, heal: 0.09, calm: 12, method: '整椒贴着热锅转动，表皮起皱才剖开。' },
    { id: 'plumPaste', name: '夜梅膏', needs: { nightPlum: 1 }, heal: 0.07, calm: 15, method: '剔核收浓果肉，冷却后分成小块。' },
    { id: 'rootWedges', name: '灰薯角', needs: { ashRoot: 1 }, heal: 0.19, calm: 5, method: '连皮劈成厚角，在余烬上烘到外硬内松。' },
    { id: 'sproutCups', name: '骨芽小盅', needs: { ribSprout: 1 }, heal: 0.11, calm: 8, method: '整把嫩芽竖在盅内，蒸到芽尖微垂。' },
    { id: 'mossCracker', name: '盔苔脆片', needs: { skullMoss: 1 }, heal: 0.06, calm: 13, method: '苔叶摊得极薄，在离火的温板上焙干。' },
    { id: 'marrowSpoon', name: '炙髓匙', needs: { houndMarrow: 1 }, heal: 0.21, calm: 4, method: '留半截骨槽作匙，炭炙至骨髓微颤。' },
    { id: 'flankStrips', name: '犬排细切', needs: { houndFlank: 1 }, heal: 0.18, calm: 5, method: '整片腹排煎熟，静置片刻再横纹切丝。' },
    { id: 'chestnutAsh', name: '灰烬开口栗', needs: { shellChestnut: 1 }, heal: 0.15, calm: 8, method: '栗壳浅划一道，埋在火旁听壳口绽开。' },
    { id: 'earRibbons', name: '玄耳细带', needs: { basaltEar: 1 }, heal: 0.1, calm: 11, method: '胶耳煨软后切长带，趁滑润时食用。' },
    { id: 'crabBasket', name: '石节蒸蟹', needs: { axleCrab: 1 }, heal: 0.19, calm: 7, method: '蟹腹朝上隔水蒸，把壳内鲜汁留到最后。' },
    { id: 'peaPuree', name: '节豆蓉', needs: { jointPea: 1 }, heal: 0.14, calm: 9, method: '嫩豆捣碎过筛，慢慢烘掉多余水汽。' },
    { id: 'dewIce', name: '露珠冷盏', needs: { dewPearl: 1 }, heal: 0.08, calm: 16, method: '珠囊盛进凉石盏，用勺背压破一半。' },
    { id: 'mistNoodles', name: '雾绡宽条', needs: { mistFilm: 1 }, heal: 0.14, calm: 11, method: '胶膜卷紧切带，清汤烫开便成宽条。' },
    { id: 'pollenMilk', name: '花粉热浆', needs: { combPollen: 1 }, heal: 0.09, calm: 18, method: '少量温水研开花粉，再添热水搅到细滑。' },
    { id: 'grubRoast', name: '蜜蛹酥', needs: { honeyGrub: 1 }, heal: 0.23, calm: 9, method: '幼蛹滚着煎出自己的油，外皮酥透才收锅。' },
    { id: 'finFan', name: '扇炙鸣鳍', needs: { echoFin: 1 }, heal: 0.22, calm: 10, method: '将薄鳍展成扇面，在火上迅速翻烤。' },
    { id: 'pearlSlices', name: '忆珠薄切', needs: { memoryPearl: 1 }, heal: 0.12, calm: 21, method: '用温刀薄切珠肉，让半透明的薄片贴在杯壁上。' },
    { id: 'shrimpReed', name: '芦心酿虾', needs: { reedPith: 1, poolShrimp: 1 }, heal: 0.26, calm: 13, method: '芦心挑开一道口，将虾蓉填入蒸熟。' },
    { id: 'kelpGriddle', name: '藻衣黍饼', needs: { lampKelp: 1, siltGrain: 1 }, heal: 0.28, calm: 11, method: '把软黍压在藻叶上，叶面朝下烙出脆底。' },
    { id: 'pearGrain', name: '梨汁黍酪', needs: { saltPear: 1, siltGrain: 1 }, heal: 0.19, calm: 18, method: '熟黍研浆，再将梨汁分三次拌进去。' },
    { id: 'mossShrimp', name: '苔裹虾球', needs: { skullMoss: 1, poolShrimp: 1 }, heal: 0.24, calm: 14, method: '虾肉拍碎成团，滚上苔末慢烤。' },
    { id: 'pearFlank', name: '盐梨烧排', needs: { saltPear: 1, houndFlank: 1 }, heal: 0.33, calm: 12, method: '梨片垫在腹排下焖，出锅前收干酸汁。' },
    { id: 'marrowGrain', name: '骨髓黍饭', needs: { houndMarrow: 1, siltGrain: 1 }, heal: 0.39, calm: 8, method: '把炙髓拨进热饭，翻拌到每粒黍都油亮。' },
    { id: 'sproutCap', name: '骨芽酿菌盖', needs: { ribSprout: 1, boneCap: 1 }, heal: 0.29, calm: 12, method: '嫩芽切丁，填进伞盖里，盖上锅盖焖软。' },
    { id: 'cressShank', name: '泉芹汆犬丝', needs: { springCress: 1, houndShank: 1 }, heal: 0.35, calm: 10, method: '煨透的犬腱撕细，浇上刚滚的芹茎汤。' },
    { id: 'saltMillet', name: '花卤井粟饭', needs: { brineBud: 1, caveMillet: 1 }, heal: 0.24, calm: 18, method: '盐花挤汁调水，代替清水把粟粒焖熟。' },
    { id: 'morelSnail', name: '菌盏焖螺', needs: { redMorel: 1, hingeSnail: 1 }, heal: 0.31, calm: 15, method: '取出螺肉塞进赤褶菌，沿锅边添水焖煮。' },
    { id: 'chestnutMillet', name: '栗粟锅巴', needs: { shellChestnut: 1, caveMillet: 1 }, heal: 0.34, calm: 11, method: '栗仁敲碎混入粟饭，在锅底轻压出一层金壳。' },
    { id: 'earCress', name: '双脆泉芹', needs: { basaltEar: 1, springCress: 1 }, heal: 0.2, calm: 20, method: '胶耳先烫、芹段后下，分别捞出再合拌。' },
    { id: 'crabLeaf', name: '硫叶蟹盒', needs: { sulfurLeaf: 1, axleCrab: 1 }, heal: 0.34, calm: 13, method: '小蟹剥肉填进两片嫩叶中，用热板压紧。' },
    { id: 'peaMorel', name: '豆蓉菌酿', needs: { jointPea: 1, redMorel: 1 }, heal: 0.28, calm: 19, method: '豆蓉挤入菌褶，在小火上烘出波纹。' },
    { id: 'lichenBud', name: '盐花石衣卷', needs: { brineBud: 1, shellLichen: 1 }, heal: 0.17, calm: 27, method: '把盐花夹进柔软的石衣，卷细后斜刀切段。' },
    { id: 'blackGarlic', name: '蒜芯豆丸', needs: { blackBean: 1, heatBulb: 1 }, heal: 0.31, calm: 17, method: '熟炉豆压泥，把烤软的蒜瓣包在丸心。' },
    { id: 'plumPepper', name: '夜梅椒酱', needs: { nightPlum: 1, emberPepper: 1 }, heal: 0.18, calm: 28, method: '椒皮剁细，和去核梅肉一同熬出红酱。' },
    { id: 'ashPearls', name: '白薯露珠圆', needs: { ashRoot: 1, dewPearl: 1 }, heal: 0.29, calm: 22, method: '薯泥搓成小窝，托着凝露珠温热上桌。' },
    { id: 'mistPepper', name: '烬椒拌雾带', needs: { mistFilm: 1, emberPepper: 1 }, heal: 0.25, calm: 21, method: '焦椒切丝，缠上刚烫好的雾绡宽条。' },
    { id: 'jellyBean', name: '雾胶焖炉豆', needs: { mistJelly: 1, blackBean: 1 }, heal: 0.32, calm: 19, method: '将炉豆煨至裂皮，以雾胶收住满锅汤汁。' },
    { id: 'pollenPlum', name: '花粉梅糕', needs: { combPollen: 1, nightPlum: 1 }, heal: 0.2, calm: 34, method: '梅膏摊成方片，晾凉后筛上一层细花粉。' },
    { id: 'grubMash', name: '蜜蛹薯盅', needs: { honeyGrub: 1, ashRoot: 1 }, heal: 0.44, calm: 16, method: '整薯烤熟挖成盅，盛进干煎的幼蛹。' },
    { id: 'honeyFin', name: '甲蜜炙鳍', needs: { gateComb: 1, echoFin: 1 }, heal: 0.33, calm: 31, method: '鳍烤到翘边再刷蜜，只用余火收出薄壳。' },
    { id: 'pearlMist', name: '忆珠雾冻', needs: { memoryPearl: 1, mistJelly: 1 }, heal: 0.24, calm: 38, method: '珠肉切方，拌入温雾胶，搁在凉石上定型。' },
    { id: 'threeReeds', name: '水道三鲜羹', needs: { reedPith: 1, poolShrimp: 1, boneCap: 1 }, heal: 0.43, calm: 20, method: '菌盖打底，虾肉增鲜，最后撒入细芦丁。' },
    { id: 'shankPacket', name: '芦扎焖犬腱', needs: { reedPith: 1, lampKelp: 1, houndShank: 1 }, heal: 0.47, calm: 16, method: '藻叶裹住腱肉，用芦丝捆牢，埋进热灰。' },
    { id: 'crabMillet', name: '泉井蟹粟煲', needs: { axleCrab: 1, caveMillet: 1, springCress: 1 }, heal: 0.45, calm: 22, method: '蟹壳煮汤焖粟，拌回蟹肉与泉芹嫩尖。' },
    { id: 'threeEar', name: '傀壳三味糊', needs: { shellChestnut: 1, basaltEar: 1, jointPea: 1 }, heal: 0.39, calm: 27, method: '栗与豌豆压成细糊，再拌入爽脆的玄耳丁。' },
    { id: 'darkHotpot', name: '炉底赤汤锅', needs: { emberPepper: 1, blackBean: 1, houndFlank: 1 }, heal: 0.51, calm: 18, method: '椒豆先煮厚汤，最后涮入整叠腹排。' },
    { id: 'gateCustard', name: '炉门蜜露羹', needs: { gateComb: 1, dewPearl: 1, combPollen: 1 }, heal: 0.28, calm: 40, method: '蜜与花粉调浆，小火煨暖后放入完整露珠。' },
    { id: 'deepFeast', name: '七层回音盏', needs: { echoSac: 1, memoryPearl: 1, heatBulb: 1 }, heal: 0.55, calm: 28, method: '蒜泥与忆珠嵌进回声囊，封口炖到囊肉酥软。' },
    { id: 'glassRice', name: '琉藻送春饭', needs: { glassWeed: 1, pebbleRice: 1, lanternPrawn: 1 }, heal: 0.42, calm: 21, method: '稻饭蒸到将熟时铺上虾仁，最后撒入细剪的玻璃藻。' },
    { id: 'chardPocket', name: '铜脉菌麦包', needs: { copperChard: 1, amberSpelt: 1, chimneyMorel: 1 }, heal: 0.4, calm: 26, method: '麦仁和切碎的菌脚填入叶包，封口朝下贴锅焖熟。' },
    { id: 'doubleMarrow', name: '双髓封栗', needs: { houndMarrow: 1, hipMarrow: 1, ridgeHazel: 1 }, heal: 0.54, calm: 17, method: '将两份骨髓分别炙香和捣细，合拌榛仁后移到锅边收浓。' },
    { id: 'wraithParcel', name: '雾绡珍珠包', needs: { fogVeil: 1, rainBead: 2 }, heal: 0.24, calm: 36, method: '将露珠分作两层藏入烟罗，隔水蒸到绡皮粘合。' },
    { id: 'hiveBell', name: '巢蜜炖喉钟', needs: { darkNectar: 1, throatBell: 1, craterPlum: 1 }, heal: 0.46, calm: 32, method: '梅肉填满囊壁，注入炉花蜜，沿炉口慢炖到汤色透红。' },
  ].map((recipe) => [recipe.id, recipe]));

  function acceptsIngredient(requiredId, candidateId) {
    if (!Object.hasOwn(INGREDIENTS, requiredId) || !Object.hasOwn(INGREDIENTS, candidateId)) return false;
    return (INGREDIENTS[requiredId].family || requiredId) === (INGREDIENTS[candidateId].family || candidateId);
  }

  /** 先给整张菜谱预留指名原料，余量才能在同类缺口之间调配。 */
  function planIngredients(stock, recipe) {
    if (!stock || !recipe?.needs) return null;
    const used = {};
    const missing = [];
    for (const [id, qty] of Object.entries(recipe.needs)) {
      if (!Object.hasOwn(INGREDIENTS, id) || !Number.isSafeInteger(qty) || qty < 1) return null;
      const exact = Number.isSafeInteger(stock[id]) && stock[id] > 0 ? Math.min(qty, stock[id]) : 0;
      if (exact) used[id] = exact;
      if (exact < qty) missing.push([id, qty - exact]);
    }
    for (let [id, need] of missing) {
      for (const [candidate, count] of Object.entries(stock)) {
        if (!Number.isSafeInteger(count) || !acceptsIngredient(id, candidate)) continue;
        const available = count - (used[candidate] || 0);
        if (available <= 0) continue;
        const take = Math.min(available, need);
        used[candidate] = (used[candidate] || 0) + take;
        need -= take;
        if (!need) break;
      }
      if (need) return null;
    }
    return Object.keys(used).length ? used : null;
  }

  function prepare(st, recipeId) {
    if (!Object.hasOwn(RECIPES, recipeId)) return V.State.fail(st, 'unknown_recipe', '找不到这道菜');
    if (st.run && st.run.stage !== 'camp') return V.State.fail(st, 'bad_stage', '到营火才能做菜');
    const stock = st.run ? st.run.ingredients : st.pantry;
    const ingredients = planIngredients(stock, RECIPES[recipeId]);
    if (!ingredients) return V.State.fail(st, 'missing_ingredients', '食材不足');
    const left = { ...stock };
    for (const [id, qty] of Object.entries(ingredients)) {
      left[id] -= qty;
      if (!left[id]) delete left[id];
    }
    const after = st.run ? { ...st, run: { ...st.run, ingredients: left, packOrder: V.Expedition.packSlots(st) } } : st;
    if (!V.Expedition.canPack(after, 'meal:' + recipeId)) return V.State.fail(st, 'bag_full', '背包没有存放成菜的空间');
    return V.State.ok(st, [], { left });
  }
  function canCook(st, recipeId) { return prepare(st, recipeId).ok; }

  function cook(st, recipeId) {
    const plan = prepare(st, recipeId);
    if (!plan.ok) return plan;
    const next = V.State.clone(st);
    if (next.run) next.run.ingredients = plan.left;
    else next.pantry = plan.left;
    const meals = next.run ? (next.run.meals ||= {}) : (next.packedMeals ||= {});
    meals[recipeId] = (meals[recipeId] || 0) + 1;
    (next.cookedRecipes ||= {})[recipeId] = (next.cookedRecipes[recipeId] || 0) + 1;
    V.Expedition.recordPackChange(st, next);
    return V.State.ok(next, [{ type: 'cooked', meta: { recipeId } }]);
  }

  function mealEffect(st, recipeId, uid) {
    if (!Object.hasOwn(RECIPES, recipeId)) return V.State.fail(st, 'unknown_recipe', '找不到这道菜');
    if (st.run && !['map', 'loot', 'camp', 'merchant'].includes(st.run.stage)) return V.State.fail(st, 'bad_stage', '当前无法用餐');
    const meals = st.run ? st.run.meals : st.packedMeals;
    if (!(meals?.[recipeId] > 0)) return V.State.fail(st, 'missing_meal', '背包中没有这道菜');
    const unit = V.State.unitById(st, uid);
    const target = st.run ? st.run.party.find(p => p.uid === uid) : unit;
    if (!unit || !target || (target.hp != null && target.hp <= 0)) return V.State.fail(st, 'bad_target', '请选择一名存活的传奇');
    const max = V.Roster.stats(st, unit).maxHp, recipe = RECIPES[recipeId];
    const heal = Math.max(0, Math.min(max - (target.hp ?? max), Math.round(max * recipe.heal)));
    const calm = Math.min(target.stress || 0, recipe.calm);
    return heal || calm ? V.State.ok(st, [], { heal, calm }) : V.State.fail(st, 'no_effect', '这名传奇目前无需用餐');
  }

  function canEat(st, recipeId, uid) { return mealEffect(st, recipeId, uid).ok; }
  function eat(st, recipeId, uid, token) {
    const effect = mealEffect(st, recipeId, uid);
    if (!effect.ok) return effect;
    const removed = V.Expedition.removeServing(st, 'meal:' + recipeId, token);
    if (!removed.ok) return removed;
    const next = removed.state, unit = V.State.unitById(next, uid);
    const target = next.run ? next.run.party.find(p => p.uid === uid) : unit;
    if (effect.heal) target.hp += effect.heal;
    target.stress = (target.stress || 0) - effect.calm;
    unit.stress = target.stress;
    return V.State.ok(next, [{ type: 'mealEaten', meta: { recipeId, uid, heal: effect.heal, calm: effect.calm } }]);
  }

  function transferMeal(st, recipeId, direction, token) {
    if (st.run) return V.State.fail(st, 'bad_stage', '回前哨才能存取成菜');
    if (!Object.hasOwn(RECIPES, recipeId)) return V.State.fail(st, 'unknown_recipe', '找不到这道菜');
    const base = 'meal:' + recipeId;
    if (direction === 'store') {
      const removed = V.Expedition.removeServing(st, base, token);
      if (!removed.ok) return removed;
      const next = removed.state;
      const store = (next.mealStore ||= {});
      store[recipeId] = (store[recipeId] || 0) + 1;
      if (V.Expedition.storeLayout(next,'meal').overflow.length) return V.State.fail(st,'store_full','料理架已满');
      return V.State.ok(next, [{ type: 'mealStored', meta: { recipeId } }]);
    }
    if (direction !== 'pack' || !(st.mealStore?.[recipeId] > 0)) return V.State.fail(st, 'missing_meal', '仓库中没有这道菜');
    if (!V.Expedition.canPack(st, base)) return V.State.fail(st, 'bag_full', '背包没有存放成菜的空间');
    const next = V.State.clone(st);
    if (--next.mealStore[recipeId] === 0) delete next.mealStore[recipeId];
    const meals = (next.packedMeals ||= {});
    meals[recipeId] = (meals[recipeId] || 0) + 1;
    V.Expedition.recordPackChange(st, next);
    return V.State.ok(next, [{ type: 'mealPacked', meta: { recipeId } }]);
  }

  V.Kitchen = { INGREDIENTS, RECIPES, ECOSYSTEM, biome, forageOptions, harvestOptions, addYield, acceptsIngredient, planIngredients, canCook, cook, canEat, eat, transferMeal };
})(globalThis.Ashen ||= {});
