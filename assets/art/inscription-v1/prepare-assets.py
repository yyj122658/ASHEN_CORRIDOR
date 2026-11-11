"""功法素材定尺与同母版纹路切片；只处理本目录。"""
from __future__ import annotations
import hashlib
import json
import statistics
from pathlib import Path
from array import array
from PIL import Image, ImageChops, ImageDraw, ImageOps

ROOT: Path = Path(__file__).resolve().parent
NAMES: list[str] = ["ns", "ew", "ne", "es", "sw", "wn", "nes", "esw", "swn", "wne", "nesw", "n", "e", "s", "w"]


def record(path: Path, **extra: object) -> dict:
    """对交付文件记录实际尺寸和哈希。"""
    image: Image.Image = Image.open(path)
    return {"file": path.name, "width": image.width, "height": image.height,
            "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), **extra}


def periodic(image: Image.Image) -> Image.Image:
    """仅消除两对边界的色差，保留材质细节。"""
    w, h = image.size
    values: array = array("f", (v for rgb in image.getdata() for v in rgb))
    for y in range(h):
        start: int = y*w*3
        for c in range(3):
            delta: float = values[start+(w-1)*3+c]-values[start+c]
            for x in range(w):
                values[start+x*3+c] -= delta*(x/(w-1)-0.5)
    for x in range(w):
        for c in range(3):
            delta = values[((h-1)*w+x)*3+c]-values[x*3+c]
            for y in range(h):
                values[(y*w+x)*3+c] -= delta*(y/(h-1)-0.5)
    out: Image.Image = Image.frombytes("RGB", (w,h), bytes(max(0,min(255,round(v))) for v in values))
    assert out.crop((0,0,1,h)).tobytes()==out.crop((w-1,0,w,h)).tobytes()
    assert out.crop((0,0,w,1)).tobytes()==out.crop((0,h-1,w,h)).tobytes()
    return out


def main() -> None:
    """输出三张卷轴、一张薄膜与十五张白色片段，并逐张校验。"""
    assets: dict = {}
    for name in ("scroll-common", "scroll-fine", "scroll-rare"):
        image: Image.Image = Image.open(ROOT/"raw"/f"{name}.png").resize((768,1024),Image.Resampling.LANCZOS)
        path: Path = ROOT/f"{name}.png"
        image.save(path,optimize=True)
        assets[name]=record(path,aspect="3:4",alpha=image.mode=="RGBA")

    # 薄膜按半透明覆盖层交付；不沿用生成器可能烘焙的不透明背景。
    texture: Image.Image = Image.open(ROOT/"raw"/"membrane-texture.png").convert("RGB").resize((1024,1024),Image.Resampling.LANCZOS)
    texture=periodic(texture)
    texture=Image.blend(Image.new("RGB",texture.size,(89,83,96)),texture,0.3).convert("RGBA")
    texture.putalpha(112)
    path=ROOT/"membrane-texture.png";texture.save(path,optimize=True)
    assets["membrane-texture"]=record(path,alpha=True,uniformAlpha=112,tileable=True,oppositeEdgePixelDifference=0)

    raw: Image.Image = Image.open(ROOT/"raw"/"stroke-master.png").convert("RGBA")
    alpha: Image.Image = ImageChops.multiply(raw.getchannel("A"),ImageOps.grayscale(raw))
    bbox: tuple[int,int,int,int] = alpha.point(lambda a:255 if a>=64 else 0).getbbox()
    assert bbox
    strip: Image.Image = alpha.crop(bbox).resize((20,256),Image.Resampling.LANCZOS)
    # 两端用同一横截面，使相邻格直线的接缝亮度一致。
    for x in range(20):
        value: int = round((strip.getpixel((x,0))+strip.getpixel((x,255)))/2)
        strip.putpixel((x,0),value);strip.putpixel((x,255),value)
    vertical: Image.Image = Image.new("L",(256,256));vertical.paste(strip,(118,0))
    horizontal: Image.Image = vertical.transpose(Image.Transpose.ROTATE_90)
    arms: dict[str,Image.Image] = {}
    for direction,source,rect in (
        ("n",vertical,(0,0,255,137)),("s",vertical,(0,118,255,255)),
        ("e",horizontal,(118,0,255,255)),("w",horizontal,(0,0,137,255))):
        gate: Image.Image = Image.new("L",(256,256))
        ImageDraw.Draw(gate).rectangle(rect,fill=255)
        arms[direction]=ImageChops.multiply(source,gate)
    for name in NAMES:
        channel: Image.Image = Image.new("L",(256,256))
        for direction in name:
            channel=ImageChops.lighter(channel,arms[direction])
        output: Image.Image = Image.new("RGBA",(256,256),(255,255,255,0));output.putalpha(channel)
        path=ROOT/f"{name}.png";output.save(path,optimize=True)
        measured: dict = {}
        widths: list[int] = []
        for direction in "nesw":
            edge: list[int] = [channel.getpixel((i,0) if direction=="n" else (255,i) if direction=="e" else (i,255) if direction=="s" else (0,i)) for i in range(256)]
            hits: list[int] = [i for i,a in enumerate(edge) if a>=64]
            if direction in name:
                assert hits,(name,direction)
                offset: float = abs((hits[0]+hits[-1])/2-127.5)
                assert offset<=3,(name,direction,offset)
                width: int = hits[-1]-hits[0]+1; widths.append(width)
                measured[direction]={"insetPx":0,"centerOffsetPx":offset,"widthPxAlpha64":width}
            else:
                assert max(edge)==0,(name,"unexpected opening",direction)
        assert max(widths)<=21 and min(widths)>=16,(name,widths)
        assert all(r==g==b for r,g,b,a in output.getdata())
        assets[name]=record(path,alpha=True,monochrome=True,directions=list(name.upper()),
            nominalStrokeWidthPx=20,measuredStrokeWidthPx=statistics.mean(widths),
            widthThresholdAlpha=64,edgeOffsets=measured,source="raw/stroke-master.png",
            method="shared-master-crop-scale-rotate-and-alpha-union")
    manifest: dict = {"version":1,"assetCount":19,"directions":"file-name N up E right S down W left",
                      "runtimeIntegrated":False,"assets":assets}
    (ROOT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    print("PASS: 19 assets; 15 monochrome tiles, correct active edges, offsets <=3px, uniform stroke; periodic membrane")


if __name__=="__main__":
    main()

