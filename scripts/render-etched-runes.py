"""烘焙真实纹路通道、蚀刻法格形和目录徽章。"""
import json
import runpy
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PIPELINE = runpy.run_path(str(ROOT / "scripts/render-topology-art.py"))
clean, save = PIPELINE["clean"], PIPELINE["save"]
SHEETS = ROOT / "assets/source-v4/conduit-motifs"
INK, SLATE, STEEL, BONE, GOLD, FIRE, CYAN, VIOLET, RED = (
    PIPELINE[k] for k in ("INK", "SLATE", "STEEL", "BONE", "GOLD", "FIRE", "CYAN", "VIOLET", "RED")
)
CELL = 64
DIRS = {"W": (-1, 0), "E": (1, 0), "N": (0, -1), "S": (0, 1)}


def width_height(cells):
    return tuple(1 + max(cell[i] for cell in cells) for i in range(2))


def clean_shape(image, cells):
    mask = Image.new("L", image.size)
    draw = ImageDraw.Draw(mask)
    for x, y in cells:
        draw.rectangle((x * CELL, y * CELL, (x + 1) * CELL - 1, (y + 1) * CELL - 1), fill=255)
    image.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
    return clean(image, image.size)


def seal(draw, cx, cy, inlet, color):
    if inlet:
        draw.polygon([(cx, cy - 12), (cx + 12, cy), (cx, cy + 12), (cx - 12, cy)],
                     fill=INK, outline=color, width=2)
        draw.polygon([(cx, cy - 5), (cx + 5, cy), (cx, cy + 5), (cx - 5, cy)], fill=color)
    else:
        draw.rectangle((cx - 10, cy - 10, cx + 10, cy + 10), fill=INK, outline=color, width=3)
        draw.rectangle((cx - 4, cy - 4, cx + 4, cy + 4), outline=STEEL, width=2)


def load_motifs():
    source = runpy.run_path(str(ROOT / "scripts/render-v4-art.py"))
    sheets = json.loads((SHEETS / "catalogue.json").read_text(encoding="utf-8"))
    motifs = {}
    for kind, pages in sheets.items():
        motifs[kind] = {}
        for name, ids in pages.items():
            cells = source["atlas_cells"](f"conduit-motifs/{name}", 4, 4)
            for item_id, cell in zip(ids.split(), cells):
                assert item_id not in motifs[kind], (kind, item_id)
                cut = source["cut_actor"](cell)
                assert cut.width < cell.width * .98 and cut.height < cell.height * .98, (name, item_id)
                motifs[kind][item_id] = cut
    return motifs


def inlay(image, motif, bounds, fill=False):
    left, top, right, bottom = bounds
    shape = ImageOps.contain(motif, (right - left, bottom - top), Image.Resampling.NEAREST)
    x, y = (left + right - shape.width) // 2, (top + bottom - shape.height) // 2
    if fill:
        ImageDraw.Draw(image).bitmap((x + 2, y + 2), shape.getchannel("A"), fill=INK)
    image.alpha_composite(shape, (x, y))


def octagon(x, y, radius, cut):
    return [(x-radius, y-cut), (x-cut, y-radius), (x+cut, y-radius), (x+radius, y-cut),
            (x+radius, y+cut), (x+cut, y+radius), (x-cut, y+radius), (x-radius, y+cut)]


def diamond(x, y, radius):
    return [(x, y-radius), (x+radius, y), (x, y+radius), (x-radius, y)]


def port_notch(draw, port):
    tx, ty = port["cell"]
    dx, dy = DIRS[port["dir"]]
    x = tx * CELL + (0 if dx < 0 else 63 if dx > 0 else 32)
    y = ty * CELL + (0 if dy < 0 else 63 if dy > 0 else 32)

    def inset(points):
        return [(x - depth*dx + side*abs(dy), y - depth*dy + side*abs(dx)) for depth, side in points]

    draw.polygon(inset([(0,-7), (8,-5), (12,-5), (12,4), (8,4), (0,6)]), fill=INK)
    draw.line(inset([(0,-7), (7,-4), (11,-4)]), fill=GOLD)
    draw.line(inset([(0,6), (7,3), (11,3)]), fill=GOLD)
    draw.line(inset([(0,-2), (10,-2)]), fill=SLATE)
    draw.line(inset([(0,1), (10,1)]), fill=SLATE)


def etch_family(draw, family, x, y, directions):
    if len(directions) > 2:
        draw.polygon(diamond(x, y, 7), outline=GOLD)
        draw.line([(x-3,y), (x,y-5), (x,y), (x+4,y)], fill=STEEL)
        draw.point((x, y), fill=BONE)
        return

    for dx, dy in directions:
        def engraving(points):
            return [(x + along*dx - side*dy, y + along*dy + side*dx) for along, side in points]

        draw.line(engraving([(6,5), (11,5), (14,8), (21,8)]), fill=GOLD)
        draw.line(engraving([(8,-5), (14,-5), (17,-8), (20,-8)]), fill=SLATE)
        draw.point(engraving([(23,8)])[0], fill=SLATE)
        if family == "straight":
            draw.line(engraving([(5,0), (10,0)]), fill=CYAN)
        elif family == "elbow":
            draw.line(engraving([(2,-4), (7,-4), (10,-7)]), fill=GOLD)
        elif family == "capacitor":
            for side in (-3, 3):
                draw.line(engraving([(3,side), (10,side), (13,side//2)]), fill=CYAN)
            draw.line(engraving([(4,0), (10,0)]), fill=STEEL)
        elif family == "threshold":
            draw.line(engraving([(5,-6), (8,-3), (8,3), (5,6)]), fill=GOLD)
        elif family == "ember":
            draw.line(engraving([(3,-4), (6,-6), (10,-6)]), fill=RED)
            draw.line(engraving([(4,3), (7,5), (11,5)]), fill=FIRE)
    center = {"ember": FIRE, "threshold": GOLD, "capacitor": CYAN, "elbow": GOLD}.get(family)
    if center:
        draw.polygon(diamond(x, y, 3), outline=center)


def rune_images(spec):
    cells = {(p["x"], p["y"]) for p in spec["cells"]}
    width, height = spec["cols"] * CELL, spec["rows"] * CELL
    image = Image.new("RGBA", (width, height))
    draw = ImageDraw.Draw(image)
    family = spec["family"]
    for tx, ty in sorted(cells):
        x, y = tx * CELL, ty * CELL
        left = x + (0 if (tx-1, ty) in cells else 5)
        right = x + (63 if (tx+1, ty) in cells else 58)
        top = y + (0 if (tx, ty-1) in cells else 5)
        bottom = y + (63 if (tx, ty+1) in cells else 58)
        draw.rectangle((left, top, right, bottom), fill=INK)
        for dx, dy in DIRS.values():
            if (tx+dx, ty+dy) in cells:
                continue
            for a, b in [(-23,-18), (14,20)]:
                draw.line((x+32+26*dx+a*dy, y+32+26*dy+a*dx,
                           x+32+26*dx+b*dy, y+32+26*dy+b*dx), fill=SLATE)
        for ox, oy, length in ((10,12,2), (22,8,0), (48,14,3), (54,24,0),
                               (9,39,0), (17,53,2), (28,51,0), (44,55,0), (51,47,2)):
            draw.line((x+ox, y+oy, x+ox+length, y+oy-(length > 0)), fill=SLATE)

    tracks = [[(int(x * CELL), int(y * CELL)) for x, y in trace] for trace in spec["traces"]]
    joints = {}
    for points in tracks:
        for a, b in zip(points, points[1:]):
            joints.setdefault(a, set()).add(b)
            joints.setdefault(b, set()).add(a)
    centers = {(x*CELL+32, y*CELL+32) for x, y in cells}
    route_centers = sorted(centers & joints.keys())
    powered = Image.new("RGBA", image.size)
    glow = ImageDraw.Draw(powered)
    for target, layers in [(draw, [(SLATE,11), (INK,9), (SLATE,5)]), (glow, [(CYAN,5)])]:
        for color, weight in layers:
            for points in tracks:
                target.line(points, fill=color, width=weight)
            for x, y in route_centers:
                radius = weight//2
                target.rectangle((x-radius, y-radius, x+radius, y+radius), fill=color)

    for x, y in route_centers:
        directions = [((ex>x)-(ex<x), (ey>y)-(ey<y)) for ex, ey in sorted(joints[x,y])]
        etch_family(draw, family, x, y, directions)
        if len(directions) > 2:
            glow.polygon(diamond(x, y, 4), fill=CYAN)
            glow.polygon(diamond(x, y, 2), fill=BONE)
        for dx, dy in directions:
            glow.line((x+13*dx, y+13*dy, x+17*dx, y+17*dy), fill=BONE)
    for port in spec["ports"]:
        port_notch(draw, port)
    return clean_shape(image, cells), clean_shape(powered, cells)


def blueprint_tile(mask, color):
    tile = Image.new("RGBA", (CELL, CELL))
    draw = ImageDraw.Draw(tile)
    for quarter, (a, b, c) in enumerate([((5,17),(17,5),(25,5)), ((39,5),(47,5),(59,17)),
                                          ((59,47),(47,59),(39,59)), ((25,59),(17,59),(5,47))]):
        draw.line((a,b,c), fill=color, width=2)
        x, y = ((13,13), (51,13), (51,51), (13,51))[quarter]
        draw.polygon(diamond(x, y, 4), outline=color)
        draw.point((x, y), fill=STEEL)
    for i, (dx, dy) in enumerate(DIRS.values()):
        if mask & (1 << i):
            def arm(points):
                return [(32+u*dx+v*dy, 32+u*dy+v*dx) for u, v in points]

            tip = 31 if dx > 0 or dy > 0 else 32
            for side in (-1, 1):
                draw.line(arm([(9,side*4), (16,side*10), (25,side*10), (tip,side*4)]), fill=color, width=2)
                draw.point(arm([(24,side*10)])[0], fill=STEEL)
            draw.line(arm([(5,0), (tip,0)]), fill=color, width=2)
            draw.line(arm([(18,0), (23,0)]), fill=BONE)
        else:
            px, py = 32+dx*20, 32+dy*20
            draw.polygon(diamond(px, py, 2), outline=color)
    draw.polygon(octagon(32, 32, 9, 4), outline=color, width=2)
    if mask:
        draw.polygon(diamond(32, 32, 4), fill=color)
        draw.point((32, 32), fill=BONE)
    return tile


def terminal_tiles():
    entry = Image.new("RGBA", (CELL, CELL))
    draw = ImageDraw.Draw(entry)
    draw.polygon(octagon(32, 32, 14, 9), fill=INK, outline=CYAN, width=2)
    draw.polygon([(32,19), (35,29), (45,32), (35,35), (32,45), (29,35), (19,32), (29,29)], fill=CYAN)
    draw.polygon(diamond(32, 32, 6), fill=BONE)

    exit = Image.new("RGBA", (CELL, CELL))
    draw = ImageDraw.Draw(exit)
    draw.polygon([(18,32), (24,20), (40,20), (46,32), (40,44), (24,44)], fill=INK, outline=GOLD, width=2)
    draw.polygon([(23,32), (27,25), (37,25), (41,32), (37,39), (27,39)], outline=FIRE, width=2)
    draw.polygon(diamond(32, 32, 5), fill=GOLD)
    return entry, exit


def blueprint_atlas():
    atlas = Image.new("RGBA", (4*CELL, 9*CELL))
    tiles = [blueprint_tile(mask, color) for color in (GOLD, VIOLET) for mask in range(16)]
    for i, tile in enumerate([*tiles, *terminal_tiles()]):
        atlas.paste(tile, (i % 4 * CELL, i // 4 * CELL))
    return clean(atlas, atlas.size)


def overlay_atlas():
    atlas = Image.new("RGBA", (3*CELL, CELL))
    draw = ImageDraw.Draw(atlas)
    draw.polygon(diamond(32, 32, 14), outline=SLATE, width=2)
    for x, y, size in [(18,26,2), (23,44,3), (40,18,3), (46,37,2), (15,36,1), (45,23,1)]:
        draw.polygon(diamond(x, y, size), fill=SLATE)
        draw.point((x, y), fill=CYAN)
    draw.polygon(diamond(32, 32, 10), fill=CYAN)
    draw.polygon(diamond(32, 32, 5), fill=BONE)

    cracks = [[(79,29), (86,30), (90,35), (96,32), (101,28), (111,32)],
              [(91,35), (87,42), (88,47)], [(98,33), (103,36), (107,43)],
              [(96,32), (95,27), (98,23), (96,17)]]
    for crack in cracks:
        draw.line(crack, fill=INK, width=5)
    for crack in cracks:
        draw.line(crack, fill=RED, width=2)
    draw.line([(91,34), (96,32), (100,29)], fill=FIRE)
    for point in [(83,26), (85,38), (98,37), (102,23), (109,36)]:
        draw.point(point, fill=RED)

    draw.polygon(octagon(160, 32, 13, 8), fill=INK, outline=STEEL, width=2)
    for start in (151, 157, 163):
        draw.line((start, 38, start+6, 26), fill=SLATE, width=3)
    draw.line((152, 32, 168, 32), fill=STEEL, width=3)
    return clean(atlas, atlas.size)


def etching_image(spec, motif):
    cells = {tuple(p) for p in spec["cells"]}
    cols, rows = width_height(cells)
    image = Image.new("RGBA", (cols * CELL, rows * CELL))
    draw = ImageDraw.Draw(image)
    rarity = spec["rarity"]
    border = VIOLET if rarity >= 5 else GOLD
    terminals = {tuple(p) for p in [spec["entry"], *spec["exits"]]}
    open_cells = cells - terminals
    candidates = [(x, y) for x, y in open_cells if {(x+1, y), (x, y+1), (x+1, y+1)} <= open_cells]
    span = 2 if candidates else 1
    x, y = min(candidates or open_cells or cells, key=lambda p: (
        (2*p[0] + span - cols)**2 + (2*p[1] + span - rows)**2, p[1], p[0]))
    inlay(image, motif, (x * CELL + 8, y * CELL + 8, (x + span) * CELL - 8, (y + span) * CELL - 8), fill=True)
    for tx, ty in cells:
        x, y = tx * CELL, ty * CELL
        for side, (dx, dy) in DIRS.items():
            horizontal = dx == 0
            edge = y + 32 + dy * 30 if horizontal else x + 32 + dx * 30
            v = x if horizontal else y
            if (tx + dx, ty + dy) in cells:
                spans = [(7, 15), (49, 57)]
                color, width = STEEL, 2
            else:
                spans = [(4, 23), (41, 60)] if side in spec["veins"].get(f"{tx},{ty}", []) else [(3, 61)]
                color, width = border, 3
            for a, b in spans:
                xy = (v + a, edge, v + b, edge) if horizontal else (edge, v + a, edge, v + b)
                draw.line(xy, fill=color, width=width)
    for k, dirs in spec["veins"].items():
        tx, ty = map(int, k.split(","))
        if (tx, ty) not in cells:
            continue
        for side in dirs:
            dx, dy = DIRS[side]
            x, y = tx * CELL + 32, ty * CELL + 32
            draw.line((x + dx * 18, y + dy * 18, x + dx * 32, y + dy * 32), fill=border, width=6)
            draw.line((x + dx * 22, y + dy * 22, x + dx * 32, y + dy * 32), fill=BONE, width=2)
    return clean_shape(image, cells)


def badge(image, color):
    face = Image.new("RGBA", (64, 64), INK)
    draw = ImageDraw.Draw(face)
    edge = [(8, 2), (55, 2), (61, 8), (61, 55), (55, 61), (8, 61), (2, 55), (2, 8)]
    draw.polygon(edge, outline=SLATE, width=2)
    for x, y in [(7, 7), (55, 7), (7, 55), (55, 55)]:
        draw.rectangle((x, y, x + 2, y + 2), fill=color)
    inlay(face, image, (7, 7, 57, 57))
    return clean(face, face.size)


def main():
    source = """
const V = require('./tests/helpers/load-veteran.cjs').loadVeteran().Veteran;
const etchings = Object.values(V.Data.MANUSCRIPTS).map(m => ({
  ...V.RuneArt.ETCHINGS[m.id], rarity: m.rarity, tile: V.CatalogueArt.lookup('etching', m.id)
}));
const runes = Object.fromEntries(Object.entries(V.RuneArt.RUNES).map(([id, spec]) => [id, {
  ...spec, family: V.Data.template(id).family || id
}]));
console.log(JSON.stringify({ runes, etchings }));
"""
    data = json.loads(subprocess.check_output(["node", "-e", source], cwd=ROOT))
    motifs = load_motifs()
    assert set(motifs["rune"]) == set(data["runes"])
    assert set(motifs["etching"]) == {spec["id"] for spec in data["etchings"]}
    art = set()
    for item_id, spec in data["runes"].items():
        motif = motifs["rune"][item_id]
        idle, powered = rune_images(spec)
        assert not ImageChops.subtract(powered.getchannel("A"), idle.getchannel("A")).getbbox(), item_id
        save(idle, f"relief/{item_id}.webp")
        save(idle, f"conduit/idle/{item_id}.png")
        save(powered, f"conduit/powered/{item_id}.png")
        hot = np.array(powered)
        rgb = hot[..., :3]
        rgb[(rgb == ImageColor.getrgb(CYAN)).all(axis=-1)] = ImageColor.getrgb(FIRE)
        save(clean(Image.fromarray(hot), powered.size), f"conduit/hot/{item_id}.png")
        crest = badge(motif, spec["accent"])
        art.add(crest.tobytes())
        save(crest, f"rune/{item_id}.webp")

    pages = {}
    for spec in data["etchings"]:
        motif = motifs["etching"][spec["id"]]
        image = etching_image(spec, motif)
        save(image, f"etch-relief/{spec['id']}.webp")
        tile = spec["tile"]
        page = pages.setdefault(Path(tile["src"]).name, Image.new("RGBA", (320, 256)))
        crest = badge(motif, VIOLET if spec["rarity"] >= 5 else GOLD)
        art.add(crest.tobytes())
        page.paste(crest, (tile["x"] * 64, tile["y"] * 64))
    assert len(art) == len(data["etchings"]) + len(data["runes"])
    for name, image in pages.items():
        save(image, f"catalogue/{name}")
    for inlet, name in [(True, "entry"), (False, "exit")]:
        marker = Image.new("RGBA", (26, 26))
        seal(ImageDraw.Draw(marker), 13, 13, inlet, CYAN if inlet else GOLD)
        save(clean(marker, marker.size), f"etch-relief/{name}.webp")
    save(blueprint_atlas(), "conduit/blueprint.png")
    save(overlay_atlas(), "conduit/overlays.png")
    print(f"{len(data['etchings'])} etching reliefs and {len(data['runes'])} rune reliefs generated")


if __name__ == "__main__":
    main()
