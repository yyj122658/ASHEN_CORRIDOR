#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《灰烬回廊》96 张像素资产清洗。

流水线（严格按顺序，每一步都只做一件事）：

  1. 泛洪去背     从四角出发 BFS，只吃「与角落底色欧氏距离 <= 32 且与角落连通」的像素，
                  不做任何全局换色 —— 内部暗影与 1px 深色外轮廓靠这一点活下来。
  2. 裁边         透明精灵按 alpha 包围盒裁；UI 实底图按「非底色（距 #1E2230 > 24）」裁。
  3. 九宫格预处理 面板 / 进度条的上边框正中央 18% 用旁边干净的直线像素段平铺，
                  把菱形凸起抹平，避免 CSS border-image 横向拉伸时鼓包。
  4. 邻近降采样   全程 Image.NEAREST，禁止双线性。
  5. 十色吸附     alpha >= 128 的像素按最近邻吸到《遗迹秘仪》十色。

输出到 assets/art/curated/，不触碰 v1 / veteran-v1 / battle-v1 / battle-v3。

用法：
  python scripts/process-art-assets.py            # 全量清洗 + 报告
  python scripts/process-art-assets.py --dry-run  # 只读压缩包，打印将做的事
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

try:
    from scipy import ndimage
except ImportError:  # pragma: no cover - 兜底，慢但结果一致
    ndimage = None

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "art" / "curated"

ZIPS = [
    ROOT.parent / "output" / "Ashen_Corridor_49_assets.zip",
    ROOT.parent / "output" / "Ashen_Corridor_batch2_37_assets.zip",
    ROOT.parent / "output" / "Ashen_Corridor_batch3_10_UI_assets.zip",
]

# 《遗迹秘仪》十色：清洗产物、CSS 变量、色板吸附三处共用同一份
PALETTE = np.array(
    [
        [15, 17, 26],     # 0F111A 深轮廓黑
        [30, 34, 48],     # 1E2230 深渊蓝黑
        [79, 89, 104],    # 4F5968 石板灰
        [122, 131, 143],  # 7A838F 金属灰
        [212, 202, 187],  # D4CABB 骨石白
        [188, 140, 80],   # BC8C50 古铜金
        [224, 150, 63],   # E0963F 炬火橙
        [87, 166, 167],   # 57A6A7 共振青
        [121, 80, 143],   # 79508F 秘仪紫
        [166, 77, 79],    # A64D4F 危机红
    ],
    dtype=np.int32,
)
PALETTE_HEX = ["#0F111A", "#1E2230", "#4F5968", "#7A838F", "#D4CABB",
               "#BC8C50", "#E0963F", "#57A6A7", "#79508F", "#A64D4F"]
BACKDROP = np.array([30, 34, 48], dtype=np.int32)  # #1E2230

FLOOD_TOL = 32   # 泛洪阈值：角落底色欧氏距离
TRIM_TOL = 24    # UI 实底裁边：与 #1E2230 的距离

# 去背白名单：整套目录 + 5 个具体 UI 件
CUT_ALL = {"allies", "enemies", "portraits", "plates", "nodes", "icons", "vfx"}
CUT_UI = {"slot_active.png", "divider_ornate.png", "header_banner.png", "bar_frame.png"}

# UI 里保留实底的件（按钮、面板框、空槽）
SOLID_UI = {"panel_frame.png", "panel_sub.png", "slot_empty.png",
            "btn_primary.png", "btn_secondary.png", "btn_danger.png"}

# 实底图里还要额外裁掉外圈深色宽边的
TRIM_BG = {"btn_primary.png", "btn_secondary.png", "btn_danger.png",
           "bar_frame.png", "header_banner.png", "divider_ornate.png"}

NINE_SLICE = {"panel_frame.png", "bar_frame.png"}

# 内腔处理：这批 UI 原图的「框内」是亮橙实底，直接拿去做 border-image 的 fill，
# 会把整个面板刷成橙色。所以按 slice 的同一比例把内腔压成 --surface（或掏空），
# 只留边框本身 —— 这样 CSS 里 slice 取到的那一圈仍然是原画，
# 中间那格是干净的深底，fill 才等于「内底色 #1E2230」。
# 值： (填充色 或 None 表示透明, 横向内缩比例, 纵向内缩比例)
FLATTEN = {
    "panel_frame.png":   ((30, 34, 48), 12 / 48, 12 / 48),
    "panel_sub.png":     ((30, 34, 48), 10 / 48, 10 / 48),
    "slot_empty.png":    ((30, 34, 48), 12 / 48, 12 / 48),
    "slot_active.png":   (None,        12 / 48, 12 / 48),
    "header_banner.png": ((30, 34, 48), 0.05,    0.22),
}

NORMAL_ENEMIES = {"bone", "hound", "hulk", "shuffler", "wraith",
                  "boneBell", "houndLean", "hulkSlag", "wraithChoir"}
ELITE_ENEMIES = {"shufflerDragger", "stoker"}
BOSS_ENEMIES = {"gatekeeper", "memoryEater", "furnaceHeart"}


@dataclass
class Plan:
    """一张图该被怎么处理。全部由源路径推导，不做隐藏规则。"""
    src: str
    out: str
    cut: bool
    trim: str          # 'alpha' | 'backdrop' | ''
    straighten: bool
    knockout: bool
    size: tuple[int, int]
    fit: str           # 'bottom' | 'center' | 'stretch'
    extra: list[tuple[str, tuple[int, int], str]] = field(default_factory=list)


def plan_for(src: str) -> Plan | None:
    """源路径 → 输出方案。返回 None 表示不在 96 张清单内（json / md 之类）。"""
    parts = src.split("/")
    if len(parts) < 2 or not src.lower().endswith(".png"):
        return None
    top, name = parts[0], parts[-1]
    stem = name[:-4]

    if top == "sprites":            # sprites/allies/*.png → allies/
        top, name = parts[1], parts[-1]

    folder = {"sprites": None}.get(top, top)

    if folder == "allies":
        return Plan(src, f"allies/{name}", True, "alpha", False, False, (64, 64), "bottom")

    if folder == "enemies":
        size = 64
        if stem in ELITE_ENEMIES:
            size = 80
        elif stem in BOSS_ENEMIES:
            size = 112
        return Plan(src, f"enemies/{name}", True, "alpha", False, False, (size, size), "bottom")

    if folder == "portraits":
        return Plan(src, f"portraits/{name}", True, "alpha", False, False, (96, 96), "center")

    if folder == "plates":
        return Plan(src, f"plates/{name}", True, "alpha", False, False, (120, 120), "center")

    if folder == "nodes":
        return Plan(src, f"nodes/{name}", True, "alpha", False, False, (48, 48), "center")

    if folder == "icons":
        return Plan(src, f"icons/{name}", True, "alpha", False, False, (32, 32), "center")

    if folder == "vfx":
        return Plan(src, f"vfx/{name}", True, "alpha", False, False, (64, 64), "center")

    if folder in ("backgrounds", "scenes"):
        extra = []
        if folder == "backgrounds" and stem.startswith("biome_"):
            # 战斗画布是 320×100 = 3.2:1，1:1 像素对齐需要 960×300
            extra.append((f"backgrounds/{stem}_battle.png", (960, 300), "battle-crop"))
        return Plan(src, f"{folder}/{name}", False, "", False, False, (640, 360), "stretch", extra)

    if folder == "ui":
        if name in ("panel_frame.png", "panel_sub.png", "slot_empty.png", "slot_active.png"):
            size = (48, 48)
            fit = "stretch"
        elif name.startswith("btn_"):
            size, fit = (96, 32), "stretch"
        elif name in ("header_banner.png", "bar_frame.png"):
            size, fit = (192, 32), "stretch"
        elif name == "divider_ornate.png":
            size, fit = (256, 24), "stretch"
        else:
            return None
        cut = name in CUT_UI
        return Plan(
            src, f"ui/{name}", cut,
            "backdrop" if name in TRIM_BG else "",
            name in NINE_SLICE,
            name == "bar_frame.png",
            size, fit,
        )
    return None


# --------------------------------------------------------------------------- #
# 图像步骤
# --------------------------------------------------------------------------- #

def flood_cut(rgba: np.ndarray, tol: int = FLOOD_TOL) -> np.ndarray:
    """从四角做连通泛洪，只清掉「与角落同色系且连成一片」的背景。

    阈值判的是「与角落底色的距离」而不是「与邻居的差」，
    所以内部阴影即使很暗也不会被误伤 —— 它只要不与角落连通就安全。
    """
    h, w = rgba.shape[:2]
    rgb = rgba[..., :3].astype(np.int32)
    corners = ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1))
    seeds = [rgb[y, x] for y, x in corners]

    candidate = np.zeros((h, w), dtype=bool)
    for s in seeds:
        d = np.sqrt(((rgb - s) ** 2).sum(axis=-1))
        candidate |= d <= tol
    if not candidate.any():
        return rgba

    if ndimage is not None:
        labels, _ = ndimage.label(candidate)
        keep = {labels[y, x] for y, x in corners if labels[y, x] > 0}
        bg = np.isin(labels, list(keep)) if keep else np.zeros_like(candidate)
    else:  # 纯 BFS，慢一点但等价
        from collections import deque
        bg = np.zeros((h, w), dtype=bool)
        q = deque()
        for y, x in corners:
            if candidate[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
        while q:
            y, x = q.popleft()
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not bg[ny, nx]:
                    bg[ny, nx] = True
                    q.append((ny, nx))

    out = rgba.copy()
    out[..., 3][bg] = 0
    # 半透明边（AI 图常有 1px 羽化）一并压掉，避免缩放后出现灰边
    out[..., 3][out[..., 3] < 24] = 0
    return out


def trim_alpha(rgba: np.ndarray, pad: int = 1) -> np.ndarray:
    a = rgba[..., 3]
    ys, xs = np.nonzero(a > 0)
    if not len(ys):
        return rgba
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    h, w = a.shape
    return rgba[max(0, y0 - pad):min(h, y1 + pad), max(0, x0 - pad):min(w, x1 + pad)]


def trim_backdrop(rgba: np.ndarray, tol: int = TRIM_TOL) -> np.ndarray:
    """实底图裁掉外圈多余的深色宽边。透明像素不算内容。"""
    rgb = rgba[..., :3].astype(np.int32)
    d = np.sqrt(((rgb - BACKDROP) ** 2).sum(axis=-1))
    content = (d > tol) & (rgba[..., 3] > 0)
    ys, xs = np.nonzero(content)
    if not len(ys):
        return rgba
    h, w = rgba.shape[:2]
    y0, y1 = max(0, int(ys.min()) - 1), min(h, int(ys.max()) + 2)
    x0, x1 = max(0, int(xs.min()) - 1), min(w, int(xs.max()) + 2)
    return rgba[y0:y1, x0:x1]


def straighten_border(rgba: np.ndarray, band_frac=0.12, center_frac=0.18, ref_frac=0.28) -> np.ndarray:
    """把上下边框正中央的菱形凸起抹平。

    做法不是「画一条直线」，而是从旁边 28% 处取一列**真实像素**横向平铺 ——
    这样边框的锤纹、描边、氧化色都原样保留，只是中间不再鼓起来。
    """
    h, w = rgba.shape[:2]
    if h < 8 or w < 8:
        return rgba
    x0 = int(round(w * (0.5 - center_frac / 2)))
    x1 = int(round(w * (0.5 + center_frac / 2)))
    band = max(1, int(round(h * band_frac)))
    ref = int(round(w * ref_frac))
    out = rgba.copy()
    for y in list(range(0, band)) + list(range(h - band, h)):
        out[y, x0:x1] = out[y, ref]
    return out


def flatten_center(rgba: np.ndarray, target, fx: float, fy: float) -> np.ndarray:
    """把边框以内压成纯色（或掏空），保住边框原画。

    内缩比例与 CSS 的 border-image-slice 对齐：slice 12/48 就把 12/48 以内清掉，
    于是「被 slice 切走的那一圈」还是原图，被 stretch 的中间那一格是干净的底。
    """
    h, w = rgba.shape[:2]
    x0, x1 = int(round(w * fx)), int(round(w * (1 - fx)))
    y0, y1 = int(round(h * fy)), int(round(h * (1 - fy)))
    if x1 <= x0 or y1 <= y0:
        return rgba
    out = rgba.copy()
    if target is None:
        out[y0:y1, x0:x1, 3] = 0
    else:
        out[y0:y1, x0:x1, :3] = target
        out[y0:y1, x0:x1, 3] = 255
    return out


def knockout_slot(rgba: np.ndarray, tol: int = 44) -> np.ndarray:
    """把进度条框内部的中心槽掏空（只动中间那一块，不碰四边）。"""
    h, w = rgba.shape[:2]
    y0, y1 = int(h * 0.16), int(h * 0.84)
    x0, x1 = int(w * 0.05), int(w * 0.95)
    sub = rgba[y0:y1, x0:x1]
    rgb = sub[..., :3].astype(np.int32)
    d = np.sqrt(((rgb - BACKDROP) ** 2).sum(axis=-1))
    sub[..., 3][d <= tol] = 0
    return rgba


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


def battle_crop(rgba: np.ndarray, size=(960, 300)) -> np.ndarray:
    """16:9 场景 → 3.2:1 战斗背景：先按宽缩到 960，再取一条 300px 高的横带。

    取带位置偏下（0.55），让地平线落在画布 GROUND=84/100 附近，和站位线对得上。
    """
    tw, th = size
    img = Image.fromarray(rgba, "RGBA")
    w, h = img.size
    nw = tw
    nh = max(th, int(round(h * (tw / w))))
    resized = np.array(img.resize((nw, nh), Image.NEAREST))
    top = int(round((nh - th) * 0.55))
    return resized[top:top + th, :, :]


def snap_palette(rgba: np.ndarray, min_alpha: int = 128) -> np.ndarray:
    """把不透明像素吸到十色。alpha < 128 的留着不动（反正看不见）。"""
    out = rgba.copy()
    mask = out[..., 3] >= min_alpha
    if not mask.any():
        return out
    px = out[..., :3][mask].astype(np.int32)
    # 分块算，1254² 一次性广播会吃掉 140MB
    idx = np.empty(len(px), dtype=np.int32)
    for start in range(0, len(px), 200_000):
        chunk = px[start:start + 200_000]
        d = ((chunk[:, None, :] - PALETTE[None, :, :]) ** 2).sum(axis=-1)
        idx[start:start + 200_000] = d.argmin(axis=1)
    out[..., :3][mask] = PALETTE[idx].astype(np.uint8)
    return out


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #

def load_zip_entries() -> dict[str, bytes]:
    """把三个包里所有 PNG 读进内存（总共不到 200MB，比反复解压快）。"""
    entries: dict[str, bytes] = {}
    for zpath in ZIPS:
        if not zpath.exists():
            print(f"  ! 缺包：{zpath}", file=sys.stderr)
            continue
        with zipfile.ZipFile(zpath) as z:
            for name in z.namelist():
                if name.lower().endswith(".png"):
                    entries[name] = z.read(name)
    return entries


def process(raw: bytes, plan: Plan) -> tuple[np.ndarray, dict]:
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    src_size = img.size
    rgba = np.array(img)

    if plan.cut:
        rgba = flood_cut(rgba)
    if plan.trim == "alpha":
        rgba = trim_alpha(rgba)
    elif plan.trim == "backdrop":
        rgba = trim_backdrop(rgba)
    if plan.straighten:
        rgba = straighten_border(rgba)
    if plan.knockout:
        rgba = knockout_slot(rgba)
    name = plan.out.rsplit("/", 1)[-1]
    if name in FLATTEN:
        target, fx, fy = FLATTEN[name]
        rgba = flatten_center(rgba, target, fx, fy)

    rgba = resize_nearest(rgba, plan.size, plan.fit)
    rgba = snap_palette(rgba)

    alpha = rgba[..., 3]
    stats = {
        "src": plan.src,
        "src_size": f"{src_size[0]}x{src_size[1]}",
        "size": f"{plan.size[0]}x{plan.size[1]}",
        "alpha": round(float((alpha == 0).mean()), 3),
        "colors": int(len(np.unique(rgba[..., :3][alpha >= 128].reshape(-1, 3), axis=0))) if (alpha >= 128).any() else 0,
        "cut": plan.cut,
        "trim": plan.trim or "-",
    }
    return rgba, stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default="", help="只重跑某个前缀，例如 ui/ 或 icons/")
    args = ap.parse_args()

    entries = load_zip_entries()
    plans: list[Plan] = []
    skipped: list[str] = []
    for name in sorted(entries):
        p = plan_for(name)
        if p:
            plans.append(p)
        else:
            skipped.append(name)
    if args.only:
        plans = [p for p in plans if p.out.startswith(args.only)]

    print(f"压缩包内 PNG：{len(entries)}　→　清洗 {len(plans)} 张，忽略 {len(skipped)} 个非清单文件")
    if args.dry_run:
        for p in plans:
            print(f"  {p.src:38s} → {p.out:34s} {p.size[0]:>4}x{p.size[1]:<4} cut={int(p.cut)} trim={p.trim or '-'}")
        return 0

    rows = []
    for p in plans:
        rgba, stats = process(entries[p.src], p)
        dst = OUT / p.out
        dst.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rgba, "RGBA").save(dst, "PNG", optimize=True)
        stats["out"] = p.out
        rows.append(stats)

        for out_name, size, mode in p.extra:
            big = battle_crop(rgba, size)
            d2 = OUT / out_name
            d2.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(big, "RGBA").save(d2, "PNG", optimize=True)
            rows.append({**stats, "out": out_name, "size": f"{size[0]}x{size[1]}",
                         "alpha": round(float((big[..., 3] == 0).mean()), 3)})

    # ---- 报告 ----
    print("\n输出目录：", OUT.relative_to(ROOT))
    print(f"{'文件':38s} {'源尺寸':>11s} {'输出':>9s} {'透明':>6s} {'色数':>4s}  处理")
    print("-" * 96)
    for r in rows:
        flag = []
        if r["cut"]:
            flag.append("去背")
        if r["trim"] != "-":
            flag.append("裁边")
        print(f"{r['out']:38s} {r['src_size']:>11s} {r['size']:>9s} {r['alpha']:>6.2f} {r['colors']:>4d}  {'+'.join(flag)}")

    by_dir: dict[str, int] = {}
    for r in rows:
        by_dir[r["out"].split("/")[0]] = by_dir.get(r["out"].split("/")[0], 0) + 1
    print("\n目录统计：", json.dumps(by_dir, ensure_ascii=False))
    print(f"合计 {len(rows)} 个文件（96 张原图 + {len(rows) - len(plans)} 张战斗背景适配版）")

    # 抽检：色数超出十色的直接报错，说明吸附漏了
    bad = [r["out"] for r in rows if r["colors"] > 12]
    print("色数异常：", bad or "无")
    return 0 if not bad else 1


if __name__ == "__main__":
    raise SystemExit(main())
