#!/usr/bin/env python3
"""生命金属纹章：把原画校准成统一格距的切片。

背景：`assets/art/rune-set-v1/` 里的 6 张是「待校准原画」——每张的画面尺寸、
外边距、单格比例都不一样，不能直接按整张图宽高映射到 4x4 板面。

本脚本只做一件事：按逻辑 cells 蒙版把每张原画对到统一格距。
  1. 取 alpha 包围盒（不是整张画布），丢掉透明外边距；
  2. 按蒙版的列数/行数算出该纹章占几格；
  3. 把包围盒精确缩放到 (列数 × 格距) × (行数 × 格距)。

为什么是「精确缩放」而不是等比缩放：原画单格比例在 0.97~1.27 之间，板面格子是
正方形。等比缩放会留出空隙，异形纹章之间拼不上；精确缩放到正方形格，最多把
直导管横向压扁约 20%，但相邻构件的金色边框能严丝合缝对上，端口位置也由逻辑
数据决定，不受影响。

用法：
    pip install Pillow
    python scripts/prepare-runes.py            # 默认格距 160px
    python scripts/prepare-runes.py --cell 96  # 换格距

输出：assets/art/rune-set-v1/grid/<template>.png + grid/manifest.json
原图不做任何修改。
"""
import argparse
import hashlib
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, 'assets', 'art', 'rune-set-v1')
OUT_DIR = os.path.join(SRC_DIR, 'grid')

# 原画外面有一圈 alpha 个位数的极淡外发光。按 alpha>0 取包围盒会把发光算进去，
# 导致切片留出空白边距、相邻构件拼不上。alpha>=64 得到的边界与 manifest 的
# solidBounds 逐像素吻合，用这个阈值。
ALPHA_MIN = 64


def alpha_bbox(img):
    """实心区域的包围盒（忽略极淡外发光）；全透明返回 None。"""
    alpha = img.split()[-1]
    solid = alpha.point(lambda v: 255 if v >= ALPHA_MIN else 0)
    return solid.getbbox()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cell', type=int, default=160, help='单格像素（默认 160）')
    args = ap.parse_args()
    cell = args.cell

    man_path = os.path.join(SRC_DIR, 'manifest.json')
    if not os.path.exists(man_path):
        sys.exit('找不到 manifest.json')
    man = json.load(open(man_path, encoding='utf-8'))

    os.makedirs(OUT_DIR, exist_ok=True)
    out = {'cellPx': cell, 'source': 'manifest.json', 'assets': {}}
    problems = []

    for tid, meta in man['assets'].items():
        src = os.path.join(SRC_DIR, meta['file'])
        img = Image.open(src).convert('RGBA')
        mask = meta['mask']
        cols, rows = len(mask[0]), len(mask)

        bbox = alpha_bbox(img)
        if not bbox:
            problems.append(f'{tid}: 全透明')
            continue

        x0, y0, x1, y1 = bbox
        declared = meta.get('solidBounds')
        if declared:
            # 只做提示：manifest 的 solidBounds 是参考值，不是验收过的切片坐标
            dx = abs((x1 - x0) - (declared[2] - declared[0]))
            dy = abs((y1 - y0) - (declared[3] - declared[1]))
            if dx > 4 or dy > 4:
                problems.append(f'{tid}: 实测 bbox 与 manifest 差异 {dx}x{dy}px')

        crop = img.crop((x0, y0, x1, y1))
        target = (cols * cell, rows * cell)
        resized = crop.resize(target, Image.LANCZOS)
        name = f'{tid}.png'
        resized.save(os.path.join(OUT_DIR, name), optimize=True)

        out['assets'][tid] = {
            'file': name,
            'name': meta['name'],
            'mask': mask,
            'cols': cols,
            'rows': rows,
            'width': target[0],
            'height': target[1],
            'sourceBbox': list(bbox),
            'sourceSize': [meta['width'], meta['height']],
            'squash': [
                round((x1 - x0) / cols / ((y1 - y0) / rows), 3),
                round((y1 - y0) / rows / ((x1 - x0) / cols), 3),
            ],
            'bytes': os.path.getsize(os.path.join(OUT_DIR, name)),
        }
        print(f'{tid:10s} {meta["width"]}x{meta["height"]} bbox={bbox} -> {target[0]}x{target[1]}')

    out['problems'] = problems
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print('\n输出目录:', OUT_DIR)
    if problems:
        print('需要注意:')
        for p in problems:
            print('  -', p)


if __name__ == '__main__':
    main()
