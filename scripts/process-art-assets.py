#!/usr/bin/env python3
"""Shared nearest-neighbor scaling and palette quantization for v4 art."""

import numpy as np
from PIL import Image


def resize_nearest(rgba: np.ndarray, size: tuple[int, int], fit: str) -> np.ndarray:
    """全程 NEAREST。

    fit=stretch  直接拉到目标尺寸（九宫格件就是靠这个对齐 slice 的）。
    fit=bottom   等比缩到框内，底部居中（战斗小人的站姿线）。
    fit=center   等比缩到框内，居中（头像 / 图标 / 板面缩略图）。
    """
    tw, th = size
    img = Image.fromarray(rgba, "RGBA")
    if fit == "stretch":
        return np.array(img.resize(size, Image.NEAREST))

    w, h = img.size
    scale = min(tw / w, th / h)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    small = img.resize((nw, nh), Image.NEAREST)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    ox = (tw - nw) // 2
    oy = th - nh if fit == "bottom" else (th - nh) // 2
    canvas.alpha_composite(small, (ox, oy))
    return np.array(canvas)


def snap_palette(rgba: np.ndarray, palette: np.ndarray, min_alpha: int = 128) -> np.ndarray:
    """把达到 alpha 阈值的像素吸到指定色板。"""
    out = rgba.copy()
    mask = out[..., 3] >= min_alpha
    if not mask.any():
        return out
    px = out[..., :3][mask].astype(np.int32)
    # 分块算，1254² 一次性广播会吃掉 140MB
    idx = np.empty(len(px), dtype=np.int32)
    for start in range(0, len(px), 200_000):
        chunk = px[start:start + 200_000]
        d = ((chunk[:, None, :] - palette[None, :, :]) ** 2).sum(axis=-1)
        idx[start:start + 200_000] = d.argmin(axis=1)
    out[..., :3][mask] = palette[idx].astype(np.uint8)
    return out
