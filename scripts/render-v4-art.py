#!/usr/bin/env python3
"""Build the complete v4 image set from original sheets and game data."""
import json
from pathlib import Path
import random
import runpy
import subprocess
from zlib import crc32

import numpy as np
from PIL import Image, ImageColor, ImageDraw, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parents[1]
TOPOLOGY = runpy.run_path(str(ROOT / 'scripts/render-topology-art.py'))
INK, SLATE, STEEL, BONE, GOLD, FIRE, CYAN, VIOLET, RED = (
    TOPOLOGY[key] for key in ('INK','SLATE','STEEL','BONE','GOLD','FIRE','CYAN','VIOLET','RED')
)
clean, save, tile, character = (TOPOLOGY[key] for key in ('clean','save','tile','character'))
ACTORS = ['blade','ranger','warden','warlock','cleric','rogue', *[f'wanderer{i}' for i in range(8)]]
FOES = ['bone','hound','hulk','shuffler','wraith','gatekeeper','memoryEater','furnaceHeart']
SOURCES = ROOT / 'assets/source-v4'
POSE_ROWS = [
    ['warden', 'warlock', 'cleric', 'rogue'],
    ['wanderer0', 'wanderer1', 'wanderer2', 'wanderer3'],
    ['wanderer4', 'wanderer5', 'wanderer6', 'wanderer7'],
    ['bone', 'hound', 'hulk', 'shuffler'],
    ['wraith', 'gatekeeper', 'memoryEater', 'furnaceHeart'],
]


def atlas_cells(name, columns, rows):
    image = Image.open(SOURCES / (name + '.png')).convert('RGBA')
    for row in range(rows):
        for col in range(columns):
            left, right = col * image.width // columns, (col+1) * image.width // columns
            top, bottom = row * image.height // rows, (row+1) * image.height // rows
            yield image.crop((left, top, right, bottom))


def cut_actor(cell):
    pixels = np.array(cell)
    r, g, b = (pixels[..., i].astype('int16') for i in range(3))
    # Let dark violet costume clusters survive the high-chroma background cut.
    mask = (r > 120) & (b > 100) & (r - g > 67) & (b - g > 55)
    pixels[mask] = 0
    pixels[:2] = pixels[-2:] = pixels[:, :2] = pixels[:, -2:] = 0
    image = Image.fromarray(pixels)
    box = image.getbbox()
    assert box and box[2] - box[0] > cell.width / 8
    assert (pixels[..., 3] == 0).mean() > .18
    return image.crop(box)


def render_characters(enemies):
    figures = {}
    poses = {ident: tuple(cut_actor(pose) for pose in atlas_cells(ident + '-attack', 4, 1))
             for ident in ('ranger', 'blade')}
    for index, names in enumerate(POSE_ROWS, 1):
        cells = iter(atlas_cells(f'field-poses-{index}', 4, 4))
        for ident in names:
            poses[ident] = tuple(cut_actor(next(cells)) for _ in range(4))
    for filename, ids, columns in [('visitors', ACTORS, 7), ('enemies', FOES, 4)]:
        for ident, cell in zip(ids, atlas_cells(filename, columns, 2), strict=True):
            figure = cut_actor(cell)
            figures[ident] = figure
            if ident in ACTORS:
                character(ident, figure, attacks=poses[ident])
                source = figure.crop((0, 0, figure.width, max(1, round(figure.height * .58))))
                portrait = Image.new('RGBA', (96, 96), INK)
                ImageDraw.Draw(portrait).polygon([(0, 66), (44, 20), (92, 66), (92, 95), (0, 95)], fill=SLATE)
                bust = ImageOps.contain(source, (92, 91), Image.Resampling.NEAREST)
                portrait.paste(bust, ((96-bust.width)//2, 96-bust.height), bust)
                save(clean(portrait, (96,96)), 'portrait/' + ident + '.png')
                save(actor_card(figure), 'sprite/' + ident + '.png')
    markings = {
        'boneBell': (GOLD, CYAN), 'houndLean': (GOLD, STEEL), 'hulkSlag': (RED, FIRE),
        'wraithChoir': (VIOLET, CYAN), 'shufflerDragger': (GOLD, RED), 'stoker': (RED, GOLD),
    }
    for enemy in enemies:
        ident = enemy['id']
        figure = figures.get(ident)
        if figure is None:
            base = enemy['sprite']
            old, new = map(ImageColor.getrgb, markings[ident])
            figure = recolor(figures[base], old, new)
            poses[ident] = tuple(recolor(pose, old, new) for pose in poses[base])
        character(ident, figure, left=True, attacks=poses[ident])
        save(actor_card(figure), 'enemy/' + ident + '.png')


def recolor(figure, old, new):
    pixels = np.array(clean(figure, figure.size))
    mask = (pixels[...,3] != 0) & (pixels[...,:3] == old).all(axis=-1)
    pixels[mask,:3] = new
    return Image.fromarray(pixels)


def actor_card(figure):
    sprite = ImageOps.contain(figure, (60, 60), Image.Resampling.NEAREST)
    output = Image.new('RGBA', (64,64))
    output.paste(sprite, ((64-sprite.width)//2, 62-sprite.height))
    return clean(output, (64,64))


def render_scenes():
    names = ['scenes/camp', 'scenes/workshop', 'scenes/merchant', 'scenes/event_altar',
             'scenes/chest', 'scenes/extract', 'backgrounds/biome_water',
             'backgrounds/biome_spring', 'backgrounds/biome_furnace']
    for name, cell in zip(names, atlas_cells('environments', 3, 3), strict=True):
        # Clip one pixel cluster inside atlas seams.
        cell = cell.crop((4, 4, cell.width-4, cell.height-4))
        small = ImageOps.fit(cell, (320,180), Image.Resampling.NEAREST)
        save(clean(small, (640,360)), name + '.png')
        if name.startswith('backgrounds/'):
            stage = ImageOps.fit(cell, (320,100), Image.Resampling.NEAREST, centering=(.5,.74))
            save(clean(stage, (960,300)), name + '_battle.png')
    angle = Image.open(SOURCES / 'angled-sanctum.png').convert('RGBA')
    angle = ImageEnhance.Brightness(angle).enhance(1.30)
    save(clean(angle, (480, 258)), 'backgrounds/angled_sanctum.png')


def render_controls():
    frames = {
        'panel_frame': ((48,48), GOLD, SLATE, 7), 'panel_sub': ((48,48), STEEL, SLATE, 6),
        'slot_empty': ((48,48), STEEL, SLATE, 6), 'slot_active': ((48,48), CYAN, GOLD, 6),
        'btn_primary': ((96,32), GOLD, FIRE, 6), 'btn_secondary': ((96,32), STEEL, SLATE, 6),
        'btn_danger': ((96,32), RED, GOLD, 6), 'bar_frame': ((96,24), STEEL, SLATE, 4),
    }
    for ident, (size, edge, accent, corner) in frames.items():
        w,h = size
        image = Image.new('RGBA', size)
        draw = ImageDraw.Draw(image)
        points = [(corner,1),(w-corner-1,1),(w-2,corner),(w-2,h-corner-1),
                  (w-corner-1,h-2),(corner,h-2),(1,h-corner-1),(1,corner)]
        draw.polygon(points, fill=INK, outline=edge, width=2)
        draw.line((corner+1,4,w-corner-2,4), fill=accent)
        draw.line((corner+1,h-4,w-corner-2,h-4), fill=accent)
        for x,y in [(corner,corner),(w-1-corner,corner),(corner,h-1-corner),(w-1-corner,h-1-corner)]:
            draw.rectangle((x-1,y-1,x+1,y+1), fill=GOLD)
            draw.point((x,y-1), fill=BONE)
        save(clean(image, size), 'ui/' + ident + '.png')
    for ident, color, spacing in [('header_banner',GOLD,16),('divider_ornate',STEEL,12)]:
        image = Image.new('RGBA',(96,12))
        draw = ImageDraw.Draw(image)
        draw.line((0,6,95,6),fill=color)
        for x in range(spacing//2,96,spacing):
            draw.polygon([(x,3),(x+3,6),(x,9),(x-3,6)], fill=INK, outline=color)
            draw.point((x,6), fill=BONE)
        save(clean(image, image.size), 'ui/' + ident + '.png')
    for ident, color in [('scar_mark',VIOLET),('rust_mark',RED)]:
        image, draw = tile()
        draw.line([(21,7),(12,15),(20,17),(11,25)], fill=color, width=3)
        draw.line([(15,13),(8,10),(6,10)], fill=GOLD, width=2)
        draw.line([(17,20),(24,22),(25,25)], fill=STEEL, width=2)
        save(clean(image,(32,32)), 'ui/' + ident + '.png')
    render_board_materials()


def render_board_materials():
    rng = random.Random(77)
    forge = Image.new('RGBA', (512, 352))
    draw = ImageDraw.Draw(forge)
    for _ in range(2700):
        x, y = rng.randrange(forge.width), rng.randrange(forge.height)
        length = rng.randrange(3, 39)
        color = rng.choices([INK, SLATE, STEEL, BONE], [27, 10, 60, 3])[0]
        draw.line((x, y, x+length, y), fill=color)
        if length > 24 and color == STEEL:
            draw.line((x+4, y+1, x+length-6, y+1), fill=SLATE)
    save(clean(forge, forge.size), 'ui/forged-steel.png')
    old = Image.new('RGBA', forge.size, SLATE)
    old.alpha_composite(forge)
    save(clean(old, (128,128)), 'ui/living-metal.png')

    wax = Image.new('RGBA', (448, 288))
    draw = ImageDraw.Draw(wax)
    for _ in range(1900):
        x, y = rng.randrange(wax.width), rng.randrange(wax.height)
        draw.point((x, y), fill=rng.choice((BONE, STEEL, INK)))
    for _ in range(155):
        x, y = rng.randrange(wax.width), rng.randrange(wax.height)
        length = rng.randrange(4, 26)
        draw.line([(x,y), (x+length//3,y+1), (x+length,y-1)], fill=rng.choice((BONE, STEEL)))
    save(clean(wax, wax.size), 'ui/wax-grain.png')


def signature(draw, rng, color):
    for x in [10,13,16,19,22]:
        y = 27 if rng.randrange(2) else 28
        draw.point((x,y), fill=color)


def ingredient_icon(draw, ident, item, rng, color):
    key = ident.lower()
    if any(s in key for s in ('kelp','leaf','fern','sprig','weed','grass','cress','dock','chard','shoot','sprout','lav','moss','reed','lichen','pollen','pea','bean')):
        for x, y in [(13,11),(20,12),(11,17),(20,18)]:
            draw.polygon([(16,23),(x-3,y-4),(x+2,y-3),(x+4,y+1)], fill=color, outline=SLATE)
        draw.line([(12,9),(16,17),(16,24),(22,11)], fill=BONE)
    elif any(s in key for s in ('sac','gel','jelly','droplet','dew','film','nectar','drip','honey','wax','curd')):
        draw.polygon([(15,6),(20,13),(24,17),(24,21),(21,24),(12,24),(9,20),(9,17)], fill=color, outline=BONE)
        draw.line([(12,16),(12,19),(14,21)], fill=BONE, width=2)
        draw.line([(17,22),(21,21),(23,18)], fill=SLATE)
    elif any(s in key for s in ('cap','morel','ear','agar','veil','shroom','trumpet','bell')):
        draw.polygon([(8,13),(12,8),(19,8),(24,13),(23,16),(8,16)],fill=color,outline=BONE)
        draw.polygon([(14,16),(18,16),(20,24),(12,24)],fill=SLATE,outline=STEEL)
        draw.point((14,11),fill=BONE)
        draw.point((20,13),fill=GOLD)
    elif item.get('family') or any(s in key for s in ('shank','bone','marrow','steak','meat','flank','tendon','spine','cord','shrim','prawn','sac','crab','fin','claw','larva','grub','wing','comb')):
        points = [(7,19),(10,11),(15,8),(19,9),(25,15),(22,22),(16,24),(11,22)]
        draw.polygon(points, fill=color, outline=STEEL)
        draw.line([(11,18),(14,12),(20,11),(23,15)], fill=BONE, width=2)
        for i in range(3):
            draw.line((13+i*3,17,15+i*3,20), fill=SLATE)
    else:
        for x,y,r in [(12,18,5),(20,17,5),(16,12,4)]:
            draw.polygon([(x-r,y),(x,y-r),(x+r,y),(x+r-2,y+r-2),(x-r+2,y+r-2)], fill=color, outline=STEEL)
            draw.line((x-2,y-1,x,y-3,x+2,y-1),fill=BONE)
        draw.line([(16,13),(16,7),(21,6)], fill=GOLD)
    for _ in range(4):
        x,y = rng.randrange(8,24), rng.randrange(9,23)
        draw.point((x,y), fill=GOLD)


def catalogue_icon(kind, item):
    ident = item['id']
    rng = random.Random(crc32(ident.encode()))
    color = rng.choice([GOLD,FIRE,CYAN,VIOLET,RED,BONE,STEEL])
    image, draw = tile()
    if kind == 'recipe':
        vessel = [(6,17),(25,17),(23,22),(20,25),(11,25),(8,22)]
        draw.polygon(vessel, fill=SLATE, outline=STEEL)
        draw.ellipse((6,12,25,19), fill=GOLD, outline=BONE)
        for _ in range(7):
            x,y = rng.randrange(9,23),rng.randrange(14,18)
            draw.rectangle((x,y,x+1,y+1),fill=color if x%2 else BONE)
        for x in [11,17,21]:
            y = rng.randrange(7,11)
            draw.line([(x,y),(x-1,y-2),(x+1,y-4)], fill=STEEL)
        draw.line((11,22,20,22),fill=GOLD)
    else:
        ingredient_icon(draw, ident, item, rng, color)
    signature(draw,rng,color)
    return clean(image,(64,64))


def render_catalogue(groups):
    pages = {}
    for kind, items in groups.items():
        for item, tile_meta in items:
            name = tile_meta['src'].rsplit('/',1)[1]
            sheet = pages.setdefault(name,Image.new('RGBA',(320,256)))
            sheet.paste(catalogue_icon(kind,item),(tile_meta['x']*64,tile_meta['y']*64))
    assert len(pages) == 10
    for name, sheet in pages.items():
        save(sheet, 'catalogue/' + name)


def main():
    data = json.loads(subprocess.check_output(['node','-e',"""
const V = require('./tests/helpers/load-veteran.cjs').loadVeteran().Veteran;
const groups = Object.fromEntries(Object.entries({ingredient: V.Kitchen.INGREDIENTS, recipe: V.Kitchen.RECIPES})
  .map(([kind, list]) => [kind, Object.values(list).map(item => [item, V.CatalogueArt.lookup(kind, item.id)])]));
console.log(JSON.stringify({groups,enemies:Object.values(V.Data.ENEMIES).map(({id,sprite}) => ({id,sprite:sprite || null}))}));
"""],cwd=ROOT,text=True,encoding='utf-8'))
    render_controls()
    render_catalogue(data['groups'])
    runpy.run_path(str(ROOT / 'scripts/render-etched-runes.py'), run_name='__main__')
    render_scenes()
    render_characters(data['enemies'])


if __name__ == '__main__':
    main()
