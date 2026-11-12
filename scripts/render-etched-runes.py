"""从游戏内的连续曲线烘焙凹槽深度；八个朝向共用一套纹理，光源固定在板面左上方。"""
import json
import re
import subprocess
import zlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, gaussian_filter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/art/etch-depth"
CELL = 128


def render(item_id: str, rune: dict) -> None:
    width, height = rune["cols"] * CELL, rune["rows"] * CELL
    sample = 3
    mask = Image.new("L", (width * sample, height * sample))
    draw = ImageDraw.Draw(mask)
    for path in re.findall(r'<path d="([^"]+)"', rune["engraving"].split('class="cut-lips"')[0]):
        numbers = np.array([float(n) for n in re.findall(r"-?[0-9.]+", path)]).reshape(-1, 2)
        t = np.linspace(0, 1, 41)[:, None]
        points = []
        for i in range(0, len(numbers) - 1, 3):
            a, b, c, d = numbers[i:i+4]
            points.extend((1-t)**3*a + 3*(1-t)**2*t*b + 3*(1-t)*t**2*c + t**3*d)
        draw.line([tuple(pt * CELL * sample) for pt in points], fill=255, width=1)

    dist = distance_transform_edt(np.asarray(mask) == 0)[1::sample, 1::sample] / sample
    rng = np.random.default_rng(zlib.crc32(item_id.encode()))
    grain = rng.normal(size=dist.shape)
    weather = gaussian_filter(grain, 4) * 10
    # 蚀边细小的不规则变化；沟底比唇缘宽暗，金属原面保持透明。
    radius = np.clip(3.15 + .34*weather + .16*grain, 2.3, 4.25)
    cut = np.clip(1 - dist/radius, 0, 1)
    depth = -4.2 * cut**.78
    pits = (rng.random(dist.shape) < .032) * rng.uniform(.4, 1.3, dist.shape)
    depth -= pits * np.exp(-((dist-radius)/1.8)**2)
    gy, gx = np.gradient(gaussian_filter(depth, .64))
    coverage = np.clip((radius+1.35-dist)/1.55, 0, 1)
    atlas = Image.new("RGBA", (4*width, 2*height))
    for mirror in range(2):
        for rot in range(4):
            # 将画面光向逆变换回局部坐标，翻转后仍然从同一侧照亮。
            lx, ly = -.48, -.74
            for _ in range(rot):
                lx, ly = ly, -lx
            if mirror:
                ly = -ly
            slope = -(gx*lx + gy*ly)
            glint = np.maximum(slope-.16, 0) * (1+.17*weather)
            polish = np.exp(-((dist/radius-.73)/.30)**2)
            value = np.clip(66 - 38*cut + 26*np.minimum(slope,0) + (94+66*polish)*glint + 3*grain, 11, 227)
            rgb = np.stack([value*1.04+4, value+2, value*.95+2], axis=-1)
            rgba = np.dstack([np.clip(rgb,0,255), coverage*255]).astype("uint8")
            atlas.paste(Image.fromarray(rgba), (rot*width,mirror*height))
    atlas.save(OUT / f"{item_id}.webp", lossless=True, method=4)


if __name__ == "__main__":
    source = "const V=require('./tests/helpers/load-veteran.cjs').loadVeteran().Veteran;console.log(JSON.stringify(V.RuneArt.RUNES))"
    runes = json.loads(subprocess.check_output(["node", "-e", source], cwd=ROOT))
    OUT.mkdir(parents=True, exist_ok=True)
    for item_id, rune in runes.items():
        render(item_id, rune)
