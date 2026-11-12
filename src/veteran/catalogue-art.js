'use strict';
/* 每行对应一张原画，格位由物品 ID 固定，独立于库存排序。 */
(function (A) {
  const sheets = {
    ingredient: [
      'lampKelp sulfurLeaf heatBulb boneCap houndShank shellLichen hingeSnail mistJelly gateComb echoSac reedPith poolShrimp siltGrain saltPear springCress caveMillet redMorel brineBud blackBean emberPepper',
      'nightPlum ashRoot ribSprout skullMoss houndMarrow houndFlank shellChestnut basaltEar axleCrab jointPea dewPearl mistFilm combPollen honeyGrub echoFin memoryPearl glassWeed ribbonWeed silverRush lanternPrawn',
      'mossShrimplet pebbleRice tideQuince copperChard yellowDock cliffCelery amberSpelt chimneyMorel foldCap saltCaper coalOnion coiledGarlic rubyLentil ashChili craterPlum coalYam cinderTaro ivoryFan jointButton chalkCup',
      'spineShoots marrowFern crackSprig velvetMoss crownMoss boneLaver heelCord redTendon houndCheek shinCream hipMarrow spineFat skirtBlade ribEye tailSteak slateLichen rustLichen golemMoss pebbleNut ridgeHazel',
      'cragAcorn slateEar glassEar rockTrumpet brassWhelk gearLimpet jointClam hingeClaw stoneFiddler pinCrab curlPea stoneVetch axleBean greyCurd violetGel mistAgar rainBead lanternDew coldDroplet fogVeil',
      'paleSheet rippleFilm darkNectar waxHoney amberDrip goldDust redPollen hiveMeal waxGrub amberPupa queenLarva chimeBladder hollowLobe throatBell silverFin whisperWing fanBlade dreamBead soundOpal hushPearl',
    ],
    recipe: [
      'kelpBroth leafRoll ashGarlic roastCap braisedShank lichenCrisp steamSnail mistPudding combTea sacSkewer reedStew springSnails lichenShank emberFondue honeyEcho pithPickle shrimpSkewer siltCongee poachedPear cressStems',
      'milletCake morelCup budTea blackMash pepperSkin plumPaste rootWedges sproutCups mossCracker marrowSpoon flankStrips chestnutAsh earRibbons crabBasket peaPuree dewIce mistNoodles pollenMilk grubRoast finFan',
      'pearlSlices shrimpReed kelpGriddle pearGrain mossShrimp pearFlank marrowGrain sproutCap cressShank saltMillet morelSnail chestnutMillet earCress crabLeaf peaMorel lichenBud blackGarlic plumPepper ashPearls mistPepper',
      'jellyBean pollenPlum grubMash honeyFin pearlMist threeReeds shankPacket crabMillet threeEar darkHotpot gateCustard deepFeast glassRice chardPocket doubleMarrow wraithParcel hiveBell',
    ],
    rune: [
      'straight elbow splitter capacitor threshold ember rivet long tee cross jack rail dogleg hairpin kneejoint',
      'crook clevis spillway wishbone bellowsCell coil cistern ampoule pinValve sluice reed flint fuse brazier wickbend',
    ],
    etching: [
      'spark corridor5 ember12 wide14 flurry twinflow inverse needle ward ripple cinder pursuit bulwark torrent razor tide pulse sunder bloodrush sentinel',
      'echo rivet wick suture shrapnel bellows quench awl crucible tinThread fileTooth leadSeal tinderMesh anneal silverTap slagHook ironJaw coreDrill bronzeGong splitAnvil',
      'furnaceEye chalkLine sump oarlock brineWrap pikeHead capstan dryDock rushMat furnaceTong millStone soundingLine copperWick glassBell quarrySaw coalSeam lodestone turbine boneFlute awlPoint',
      'shutter marrowPin tinChime beltBuckle coilSpring fieldLamp waxTablet splitNeedle surveyLens houndClamp shellScale jointHammer veilStitch saltCradle ribRake jawSpring slagLance kilnMantle mawValve blackBloom',
    ],
  };
  const positions = new Map();
  for (const [kind, pages] of Object.entries(sheets)) {
    const columns = 5;
    const rows = kind === 'rune' ? 3 : 4;
    pages.forEach((ids, page) => {
      ids.split(' ').forEach((id, slot) => {
        positions.set(kind + '/' + id, {
          src: `assets/art/catalogue-v1/${kind === 'rune' ? 'engraved' : kind}-${page}.webp`, columns, rows,
          x: slot % columns, y: Math.floor(slot / columns),
        });
      });
    });
  }
  function lookup(kind, id) { return positions.get(kind + '/' + id); }
  function icon(kind, id) {
    const tile = lookup(kind, id);
    if (!tile) return '';
    const { src, columns, rows, x, y } = tile;
    return `<span class="catalogue-icon" aria-hidden="true" style="background-image:url('${src}');background-size:${columns * 100}% ${rows * 100}%;background-position:${x * 100 / (columns - 1)}% ${y * 100 / (rows - 1)}%"></span>`;
  }
  A.Veteran.CatalogueArt = { lookup, icon };
})(globalThis.Ashen);
