#!/usr/bin/env python3
"""Rasterize the v4 topology set and pass every frame through the art pipeline."""
from collections import deque
from math import cos, pi, sin
import json
import runpy
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'assets/art'
OUT = ART / 'topology-v4'
CLEAN = runpy.run_path(str(ROOT / 'scripts/process-art-assets.py'))
INK, SLATE, STEEL, BONE, GOLD, FIRE, CYAN, VIOLET, RED = (
    '#1E2230', '#4F5968', '#7A838F', '#D4CABB', '#BC9C50',
    '#EC963F', '#57A6A7', '#79508F', '#A64D4F',
)
PALETTE = np.array([ImageColor.getrgb(c) for c in
    (INK, SLATE, STEEL, BONE, GOLD, FIRE, CYAN, VIOLET, RED)], dtype=np.int32)
ALLOWED = {tuple(rgb) for rgb in PALETTE}
FAMILIES = {'straight': CYAN, 'elbow': CYAN, 'splitter': CYAN,
            'capacitor': CYAN, 'threshold': GOLD, 'ember': FIRE}
DIRS = {'W': (-1, 0), 'E': (1, 0), 'N': (0, -1), 'S': (0, 1)}
NODES = {
    'battle': [[(-7, 6), (7, -6), (7, -8), (4, -7), (-8, 4)], [(-6, -7), (7, 5)], [(-8, 2), (-3, 7)], [(3, 7), (8, 2)]],
    'elite': [[(-8, 6), (-7, -3), (-3, 0), (0, -7), (3, 0), (7, -3), (8, 6), (-8, 6)], [(-4, 3), (4, 3)]],
    'chest': [[(-8, -4), (-5, -7), (5, -7), (8, -4), (8, 6), (-8, 6), (-8, -4), (8, -4)], [(-8, 0), (8, 0)], [(0, -2), (0, 3)]],
    'event': [[(-4, -4), (-2, -7), (3, -7), (5, -4), (4, -1), (0, 2), (0, 4)], [(0, 7), (0, 8)]],
    'camp': [[(0, -9), (4, -4), (4, -1), (6, -3), (7, 2), (3, 5), (-3, 5), (-7, 2), (-5, -3), (-3, -1), (0, -9)], [(-8, 8), (8, 8)]],
    'merchant': [[(0, -7), (0, 7)], [(-7, -3), (7, -3)], [(-7, -3), (-10, 3), (-4, 3), (-7, -3)], [(7, -3), (4, 3), (10, 3), (7, -3)], [(-5, 7), (5, 7)]],
    'boss': [[(-8, 0), (-7, -6), (-4, -8), (4, -8), (7, -6), (8, 0), (5, 2), (5, 7), (-5, 7), (-5, 2), (-8, 0)], [(-5, -2), (-2, -2)], [(2, -2), (5, -2)], [(-2, 5), (2, 5)]],
}
FRAME = 48
FRAMES = 8


def clean(image, size):
    pixels = CLEAN['resize_nearest'](np.asarray(image), size, 'stretch').copy()
    pixels[pixels[..., 3] < 128] = 0
    pixels[..., 3] = np.where(pixels[..., 3], 255, 0)
    pixels = CLEAN['snap_palette'](pixels, palette=PALETTE)
    assert {tuple(rgb) for rgb in pixels[pixels[..., 3] == 255, :3]} <= ALLOWED
    assert set(np.unique(pixels[..., 3])) <= {0, 255}
    assert pixels[..., 3].any()
    return Image.fromarray(pixels)


def save(image, relative):
    path = OUT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == '.webp':
        image.save(path, lossless=True)
    else:
        image.save(path, optimize=True)


def tile():
    image = Image.new('RGBA', (32, 32))
    d = ImageDraw.Draw(image)
    d.polygon([(5, 1), (26, 1), (30, 5), (30, 26), (26, 30), (5, 30), (1, 26), (1, 5)], fill=INK, outline=STEEL)
    d.line([(5, 2), (26, 2), (29, 5)], fill=SLATE)
    for x, y in [(5, 5), (25, 5), (5, 25), (25, 25)]:
        d.rectangle((x, y, x+1, y+1), fill=GOLD)
    return image, d


def route(cells, start, end):
    queue = deque([[start]])
    seen = {start}
    while queue:
        path = queue.popleft()
        x, y = path[-1]
        if path[-1] == end:
            return path
        for dx, dy in DIRS.values():
            p = (x+dx, y+dy)
            if p in cells and p not in seen:
                seen.add(p)
                queue.append(path + [p])
    raise ValueError(f'No route for {start} to {end}')


def component(tpl, family, insignia=False):
    image, d = tile()
    cells = {tuple(c) for c in tpl['cells']}
    cols, rows = (max(c[axis] for c in cells) + 1 for axis in (0, 1))
    step = min(11, 22 // max(cols, rows))
    ox, oy = (32-cols*step)//2, (32-rows*step)//2
    for x, y in sorted(cells):
        px, py = ox+x*step, oy+y*step
        d.rectangle((px, py, px+step-1, py+step-1), fill=SLATE, outline=STEEL)
        d.line((px+1, py+step-2, px+step-2, py+step-2), fill=INK)
        d.point((px+1, py+1), fill=BONE)

    def center(p):
        return (ox+p[0]*step+step//2, oy+p[1]*step+step//2)

    def contact(p):
        x, y = center(p['cell'])
        dx, dy = DIRS[p['dir']]
        return x+dx*(step//2+1), y+dy*(step//2+1)

    by_id = {p['id']: p for p in tpl['ports']}
    color = FAMILIES[family]
    for u, v in tpl['links']:
        a, b = by_id[u], by_id[v]
        line = [contact(a), *map(center, route(cells, tuple(a['cell']), tuple(b['cell']))), contact(b)]
        d.line(line, fill=INK, width=5)
        d.line(line, fill=color, width=2)
        for x, y in (line[0], line[-1]):
            d.rectangle((x-1, y-1, x+1, y+1), fill=GOLD)
            d.point((x, y), fill=BONE)
    if family == 'capacitor':
        # Etch the stacked plates above and below the conductor.
        x, y = center(min(cells, key=lambda p: (abs(p[0] + .5 - cols/2) + abs(p[1] + .5 - rows/2), p)))
        for dy in (-3, 3):
            d.line((x-3, y+dy, x+3, y+dy), fill=GOLD)
            d.point((x, y+dy), fill=BONE)
    if insignia:
        d.line([(2, 8), (2, 5), (5, 2), (9, 2)], fill=GOLD, width=2)
        d.line([(22, 29), (26, 29), (29, 26), (29, 23)], fill=GOLD, width=2)
        d.polygon([(16, 1), (19, 4), (16, 7), (13, 4)], fill=color)
        d.point((16, 4), fill=BONE)
    return clean(image, (64, 64))


def silhouette(cells):
    image = Image.new('RGBA', (32, 32))
    d = ImageDraw.Draw(image)
    xmin, ymin = (min(c[a] for c in cells) for a in (0, 1))
    xmax, ymax = (max(c[a] for c in cells) for a in (0, 1))
    ox, oy = 15-(xmax+xmin), 15-(ymax+ymin)
    occupied = {tuple(c) for c in cells}
    for x, y in cells:
        left, top = ox+2*x, oy+2*y
        d.rectangle((left, top, left+1, top+1), fill=GOLD)
        if (x, y-1) not in occupied:
            d.line((left, top, left+1, top), fill=BONE)
    return clean(image, (64, 64))


def medal(kind, strokes):
    image = Image.new('RGBA', (32, 32))
    d = ImageDraw.Draw(image)
    d.ellipse((1, 1, 30, 30), fill=INK, outline=STEEL)
    d.ellipse((3, 3, 28, 28), outline=GOLD, width=2)
    d.arc((5, 5, 26, 26), 182, 292, fill=SLATE)
    for x, y in [(15, 2), (2, 15), (15, 29), (29, 15)]:
        d.rectangle((x-1, y-1, x+1, y+1), fill=GOLD)
        d.point((x, y), fill=BONE)
    color = {'boss': RED, 'camp': FIRE, 'event': VIOLET}.get(kind, GOLD)
    for line in strokes:
        d.line([(16+x, 15+y) for x, y in line], fill=color, width=2)
    return clean(image, (64, 64))


def ring(radius, cy=24, sides=6):
    return [(round(24+radius*cos(pi*k*2/sides)), round(cy+radius*sin(pi*k*2/sides))) for k in range(sides)]


def effect(name, frame, color):
    image = Image.new('RGBA', (FRAME, FRAME))
    d = ImageDraw.Draw(image)
    if name.startswith('arrow'):
        tail = 4 + frame
        d.line((tail, 24, 41, 24), fill=color, width=3)
        d.line((tail+5, 24, 39, 24), fill=BONE)
        d.polygon([(46,24),(37,19),(39,24),(37,29)], fill=color, outline=BONE)
        d.line([(tail,20),(tail+7,24),(tail,28)], fill=GOLD)
        if frame < 5:
            d.point((max(0,tail-3),24), fill=color)
    elif name.startswith('spell'):
        radius = 6 + frame % 4
        ring_points = ring(radius + 3, sides=6)
        d.polygon(ring_points, outline=color)
        d.polygon([(24,24-radius),(24+radius,24),(24,24+radius),(24-radius,24)],
                  fill=color, outline=BONE)
        d.rectangle((22,22,25,25),fill=BONE)
        d.line([(4+frame,24),(12+frame,24),(17+frame,22)],fill=color,width=2)
    elif name.startswith('bash'):
        radius = 3 + frame * 2
        d.polygon(ring(radius, sides=8), outline=color, width=2)
        for x,y in ring(radius+4,sides=8):
            d.line((x-2,y,x+2,y),fill=BONE if frame < 3 else color)
    elif name.startswith('thrust'):
        tip = 29 + 2*frame
        y = 22 + frame % 3
        d.line((max(1,tip-28),y,tip,y),fill=color,width=3)
        d.line((tip-13,y,tip,y),fill=BONE)
        d.line([(tip-6,y-4),(tip,y),(tip-6,y+4)],fill=color,width=2)
        d.point((max(0,tip-32),y+2),fill=GOLD)
    elif name.startswith('slash'):
        start = -100 + frame * 24
        points = [(round(19 + 23 * cos(a*pi/180)), round(24 + 22*sin(a*pi/180)))
                  for a in range(start, min(95,start+102)+1, 4)]
        d.line(points, fill=GOLD, width=5 if frame < 4 else 2)
        d.line(points, fill=color, width=3 if frame < 4 else 1)
        if frame < 4:
            d.line(points[2:-1], fill=BONE)
    elif name in ('pulse', 'overheat', 'corrosion'):
        # Stretch the tile from source to contact. Both ends finish on its middle row.
        width = [1, 2, 4, 3, 2, 2, 1, 1][frame]
        d.line([(0, 24), (9, 23), (21, 24), (34, 23), (47, 24)], fill=color, width=width)
        for x in range(frame*3 % 8, 48, 8):
            y = 23 + (x*7+frame*9) % 7 - 3
            d.line([(x, 24), (min(47, x+3), y), (min(47, x+6), 24)], fill=color)
            if frame < 5:
                d.line((x, 24, min(47, x+3), 24), fill=BONE if name != 'corrosion' else VIOLET)
    elif name == 'brazier':
        flame = [(14, 36), (15, 27), (20, 30), (20, 17), (26, 7+frame%3*2),
                 (29, 21), (34, 26), (33, 35), (28, 39), (19, 39)]
        d.polygon(flame, fill=FIRE)
        d.polygon([(19, 37), (20, 30), (24, 32), (25, 20), (29, 30), (29, 37)], fill=GOLD)
        d.line((22, 37, 25, 30, 27, 36), fill=BONE, width=2)
        d.polygon([(11, 38), (37, 38), (32, 43), (16, 43)], fill=SLATE, outline=GOLD)
        d.rectangle((19, 44, 29, 45), fill=STEEL)
        for k in range(5):
            x, y = 11+(k*11+frame)%26, 25-(frame*3+k*7)%23
            d.rectangle((x, y, x+k%2, y+1), fill=GOLD if k%2 else FIRE)
    else:
        if name == 'shield':
            d.polygon(ring(6+2*frame), outline=CYAN, width=2)
            d.polygon(ring(3+2*frame), outline=STEEL)
        elif name == 'membrane':
            vertices = ring(13+frame)
            for i, (x, y) in enumerate(vertices):
                nx, ny = vertices[(i+1) % len(vertices)]
                d.line([(x, y), (round(x+(nx-x)*(8-frame)/8), round(y+(ny-y)*(8-frame)/8))], fill=CYAN, width=2)
        elif name == 'interrupt':
            r = 19-frame*2
            for sides, radius in ((4, r), (6, r+2)):
                d.polygon(ring(radius, sides=sides), outline=GOLD)
        elif name == 'fuse':
            shift = frame+1
            d.polygon([(13-shift, 13), (23-shift, 13), (19-shift, 21), (24-shift, 25), (20-shift, 33), (13-shift, 29)], fill=SLATE, outline=RED)
            d.polygon([(24+shift, 14), (33+shift, 17), (33+shift, 33), (22+shift, 33), (26+shift, 25), (21+shift, 21)], fill=INK, outline=RED)
            d.line([(24-shift, 13), (19-shift, 21), (24-shift, 25), (20-shift, 33)], fill=FIRE)
        else:
            r = 3+2*frame
            d.polygon(ring(r, sides=8), outline=color)
            if frame < 4:
                d.line((24-r, 24, 24+r, 24), fill=color, width=2)
                d.line((24, 24-r, 24, 24+r), fill=BONE)
        for k, (x, y) in enumerate(ring(9+frame*2, sides=8)):
            sx, sy = 1 if x >= 24 else -1, 1 if y >= 24 else -1
            if (k+frame) % 3:
                d.line([(x, y), (x+sx*2, y), (x+sx*2, y+sy*(3-frame//3))],
                       fill=BONE if frame < 2 and k%2 else color)
    return clean(image, (FRAME, FRAME))


GAIT = [
    ((4, 0), (-4, 1), 0), ((2, 0), (-2, 3), 1),
    ((0, 0), (1, 5), 2), ((-2, 0), (4, 2), 1),
    ((-4, 1), (4, 0), 0), ((-2, 3), (2, 0), 1),
    ((1, 5), (0, 0), 2), ((4, 2), (-2, 0), 1),
]


def gait_frame(idle, steps, left):
    frame = Image.new('RGBA', (80, 80))
    _, head, _, sole = idle.getbbox()
    hip = sole - max(6, round((sole - head) * .30))
    near, far, rise = steps
    direction = -1 if left else 1
    start = hip - 2
    for x, step in [(0, near), (32, far)]:
        stride, lift = step
        leg = idle.crop((x, start, x + 32, sole))
        height = max(3, leg.height + rise - lift)
        leg = leg.resize((32, height), Image.Resampling.NEAREST)
        for row in range(height):
            dx = round(stride * direction * row / (height - 1))
            frame.alpha_composite(leg.crop((0, row, 32, row + 1)), (8 + x + dx, 14 + start - rise + row))
    for row in range(head, hip + 1):
        lean = direction * round((2 + rise) * (hip - row) / max(1, hip - head))
        frame.alpha_composite(idle.crop((0, row, 64, row + 1)), (8 + lean, 14 + row - rise))
    return clean(frame, frame.size)


def character(filename, figure, left=False, attacks=()):
    image = figure.crop(figure.getbbox())
    strike_size = 80
    strip = Image.new('RGBA', (64*6 + strike_size*(len(attacks)+len(GAIT)), strike_size))
    poses = [(0,0,1,1), (-2,-1,.95,1.03), (-4,0,.88,.95), (6,-2,1.07,.98), (-3,1,1.03,.86), (0,2,1,.34)]
    for i, (shift, lift, sx, sy) in enumerate(poses):
        scale = min(44/image.width, 53/image.height)
        size = (max(1, round(image.width*scale*sx)), max(1, round(image.height*scale*sy)))
        pose = clean(image, size)
        strip.paste(pose, (i*64+32-pose.width//2+(-shift if left else shift), 60-pose.height+lift))
    if attacks:
        # Align the foot line across poses so a long bow or sword does not shift the body.
        centers = []
        for frame in attacks:
            foot_band = np.asarray(frame)[-max(2, frame.height // 80):,:,3]
            xs = np.where(foot_band > 127)[1]
            centers.append(round((xs.min() + xs.max()) / 2))
        extent = max(max(center, frame.width-center) for frame, center in zip(attacks, centers))
        height = max(frame.height for frame in attacks)
        scale = min(37/extent, (71 if filename == 'blade' else 56)/height)
        rendered = []
        for frame, center in zip(attacks, centers):
            pose = clean(frame, (round(frame.width*scale), round(frame.height*scale)))
            cell = Image.new('RGBA',(strike_size,strike_size))
            cell.paste(pose, (40-round(center*scale), 74-pose.height))
            rendered.append(cell)
        assert len({frame.tobytes() for frame in rendered}) == 4
        for i, frame in enumerate(rendered):
            strip.paste(frame, (64*6 + i*strike_size, 0))
    idle = strip.crop((0, 0, 64, 64))
    for i, steps in enumerate(GAIT):
        strip.paste(gait_frame(idle, steps, left), (384 + (len(attacks) + i) * 80, 0))
    save(strip, 'actors/' + filename + '.png')


def main():
    data = json.loads(subprocess.check_output(['node', '-e', """
const V = require('./tests/helpers/load-veteran.cjs').loadVeteran().Veteran;
const templates = Object.values(V.Data.TEMPLATES).map(t => ({...t, family: V.Circuit.familyOf(t)}));
const plates = Object.fromEntries(Object.values(V.Data.BODIES).map(body => [
  body.archetype, V.PlateGen.generate({archetype: body.archetype}).cells
]));
console.log(JSON.stringify({templates, plates}));
"""], cwd=ROOT, text=True, encoding='utf-8'))
    assert len(data['templates']) == 30 and len(data['plates']) == 14
    for tpl in data['templates']:
        if tpl['id'] in FAMILIES:
            save(component(tpl, tpl['id'], True), 'family/' + tpl['id'] + '.png')
    for shape, cells in data['plates'].items():
        assert len(cells) == 77
        save(silhouette(cells), 'plate/' + shape + '.png')
    for kind, strokes in NODES.items():
        save(medal(kind, strokes), 'node/' + kind + '.png')

    effects = [('pulse', CYAN), ('overheat', FIRE), ('corrosion', VIOLET),
               ('impact', CYAN), ('impactHot', FIRE), ('impactCrack', VIOLET),
               ('fuse', RED), ('shield', CYAN), ('membrane', CYAN),
               ('interrupt', GOLD), ('brazier', FIRE),
               ('arrow', CYAN), ('arrowHot', FIRE), ('arrowCrack', VIOLET),
               ('slash', GOLD), ('slashHot', FIRE), ('slashCrack', VIOLET),
               ('spell', CYAN), ('spellHot', FIRE), ('spellCrack', VIOLET),
               ('bash', GOLD), ('bashHot', FIRE), ('bashCrack', VIOLET),
               ('thrust', CYAN), ('thrustHot', FIRE), ('thrustCrack', VIOLET)]
    atlas = Image.new('RGBA', (FRAME*FRAMES, FRAME*len(effects)))
    for row, (name, color) in enumerate(effects):
        for frame in range(FRAMES):
            atlas.paste(effect(name, frame, color), (frame*FRAME, row*FRAME))
    save(atlas, 'effects.png')

    print('27 badges and 208 effect frames')


if __name__ == '__main__':
    main()
