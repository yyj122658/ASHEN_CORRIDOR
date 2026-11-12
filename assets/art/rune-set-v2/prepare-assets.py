"""第二批纹章定尺与材质接缝校准；仅处理本目录的新资产。"""
from __future__ import annotations

import hashlib
import json
from array import array
from pathlib import Path
import runpy

from PIL import Image, ImageChops, ImageDraw

ROOT: Path = Path(__file__).resolve().parent
CELL: int = 256
alpha_bbox = runpy.run_path(str(ROOT.parents[2] / "scripts" / "prepare-runes.py"))["alpha_bbox"]
SPECS: dict[str, tuple[str, list[str], list[tuple[int, int, str]]]] = {
    "rivet": ("铆纹", ["X"], [(0, 0, "W"), (0, 0, "E")]),
    "long": ("长直纹章", ["XXX"], [(0, 0, "W"), (2, 0, "E")]),
    "tee": ("三通纹章", ["XXX", ".X."], [(0, 0, "W"), (2, 0, "E"), (1, 1, "S")]),
    "cross": ("四通纹章", [".X.", "XXX", ".X."], [(0, 1, "W"), (1, 0, "N"), (2, 1, "E"), (1, 2, "S")]),
}


def checksum(path: Path) -> str:
    """记录文件哈希，方便接入时核对。"""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def port_offset(image: Image.Image, x: int, y: int, direction: str) -> float:
    """扫描开口附近的高亮琥珀刻线，估算距格边中点的偏差。"""
    scores: list[float] = []
    for along in range(CELL):
        values: list[float] = []
        for depth in range(32):
            if direction == "W":
                px, py = x * CELL + depth, y * CELL + along
            elif direction == "E":
                px, py = (x + 1) * CELL - 1 - depth, y * CELL + along
            elif direction == "N":
                px, py = x * CELL + along, y * CELL + depth
            else:
                px, py = x * CELL + along, (y + 1) * CELL - 1 - depth
            r, g, b, a = image.getpixel((px, py))
            values.append(max(0, r - b) * max(0, g - b) * a / 255)
        scores.append(max(values))
    peak: float = max(scores)
    assert peak > 5000, "未识别到琥珀开口"
    hits: list[int] = [i for i, score in enumerate(scores) if score >= peak * 0.85]
    return abs(sum(hits) / len(hits) - (CELL - 1) / 2) / CELL


def prepare_rune(ident: str) -> dict:
    """复用第一批的 alpha 阈值校准，保留原画。"""
    name, mask, edges = SPECS[ident]
    source: Path = ROOT / "raw" / f"{ident}.png"
    raw: Image.Image = Image.open(source).convert("RGBA")
    bbox: tuple[int, int, int, int] = alpha_bbox(raw)
    assert bbox, ident
    cols, rows = len(mask[0]), len(mask)
    image: Image.Image = raw.crop(bbox).resize((cols * CELL, rows * CELL), Image.Resampling.LANCZOS)
    # 格外余光裁到精确占格内，外溢为零，避免盖住相邻构件。
    gate: Image.Image = Image.new("L", image.size)
    draw: ImageDraw.ImageDraw = ImageDraw.Draw(gate)
    cells: list[list[int]] = []
    for y, row in enumerate(mask):
        for x, flag in enumerate(row):
            if flag == "X":
                cells.append([x, y])
                draw.rectangle((x * CELL, y * CELL, (x + 1) * CELL - 1, (y + 1) * CELL - 1), fill=255)
    image.putalpha(ImageChops.multiply(image.getchannel("A"), gate))
    path: Path = ROOT / f"{ident}.png"
    image.save(path, optimize=True)
    solid: tuple[int, int, int, int] = alpha_bbox(image)
    assert solid == (0, 0, image.width, image.height), (ident, solid)
    for y, row in enumerate(mask):
        for x, flag in enumerate(row):
            alpha: int = image.getpixel((x * CELL + CELL // 2, y * CELL + CELL // 2))[3]
            assert (alpha >= 64) == (flag == "X"), (ident, x, y)
    ports: list[dict] = []
    for i, (x, y, direction) in enumerate(edges):
        offset: float = port_offset(image, x, y, direction)
        assert offset <= 0.1, (ident, direction, offset)
        ports.append({"id": "in" if i == 0 else f"out{i}", "cell": [x, y], "dir": direction,
                      "role": "in" if i == 0 else "out", "visualOffsetCells": round(offset, 4)})
    return {"file": path.name, "name": name, "width": image.width, "height": image.height,
            "alpha": True, "cellPx": CELL, "cells": cells, "ports": ports, "mask": mask,
            "solidBounds": list(solid), "sourceBounds": list(bbox), "sourceSize": list(raw.size),
            "sourceSha256": checksum(source), "outsideMaskGlowCells": 0,
            "portRoles": "proposed-art-directions-not-runtime-rules",
            "bytes": path.stat().st_size, "sha256": checksum(path), "status": "calibrated-art"}


def prepare_texture() -> dict:
    """将纯材质定尺，消除横纵拼接处的色差，不添加图案。"""
    source: Path = ROOT / "raw" / "living-metal.png"
    image: Image.Image = Image.open(source).convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
    w, h = image.size
    values: array = array("f", (v for rgb in image.getdata() for v in rgb))
    for y in range(h):
        start: int = y * w * 3
        for channel in range(3):
            delta: float = values[start + (w - 1) * 3 + channel] - values[start + channel]
            for x in range(w):
                values[start + x * 3 + channel] -= delta * (x / (w - 1) - 0.5)
    for x in range(w):
        for channel in range(3):
            delta = values[((h - 1) * w + x) * 3 + channel] - values[x * 3 + channel]
            for y in range(h):
                values[(y * w + x) * 3 + channel] -= delta * (y / (h - 1) - 0.5)
    data: bytes = bytes(max(0, min(255, round(v))) for v in values)
    image = Image.frombytes("RGB", (w, h), data)
    assert image.crop((0, 0, 1, h)).tobytes() == image.crop((w - 1, 0, w, h)).tobytes()
    assert image.crop((0, 0, w, 1)).tobytes() == image.crop((0, h - 1, w, h)).tobytes()
    path: Path = ROOT / "living-metal.png"
    image.save(path, optimize=True)
    return {"file": path.name, "name": "生命金属平铺底材", "width": w, "height": h, "alpha": False,
            "tileable": True, "oppositeEdgePixelDifference": 0, "bytes": path.stat().st_size,
            "sha256": checksum(path), "sourceSha256": checksum(source),
            "processing": "resize-1024-and-linear-periodic-color-correction"}


def main() -> None:
    """只写本批校准文件与清单。"""
    assets: dict = {ident: prepare_rune(ident) for ident in SPECS}
    assets["living-metal"] = prepare_texture()
    manifest: dict = {"version": 2, "generator": "Built-in ImageGen + documented calibration",
                      "cellPx": CELL, "alphaThreshold": 64, "assetCount": len(assets),
                      "runtimeIntegrated": False, "assets": assets}
    (ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("PASS: four rune masks, flush bounds, ports <= 0.1 cell; texture opposite edges match exactly")


if __name__ == "__main__":
    main()

