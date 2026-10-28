"""生成摘板扩展图标：蓝色圆角底 + 白色剪贴板/板夹造型。"""
from PIL import Image, ImageDraw
import os

OUT = os.path.dirname(os.path.abspath(__file__))

def make(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 蓝色圆角底
    r = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(51, 112, 255, 255))
    # 白色板身
    bx0, by0 = size * 0.24, size * 0.20
    bx1, by1 = size * 0.76, size * 0.84
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=size*0.06, fill=(255, 255, 255, 255))
    # 顶部夹子
    cx0, cy0 = size * 0.38, size * 0.14
    cx1, cy1 = size * 0.62, size * 0.26
    d.rounded_rectangle([cx0, cy0, cx1, cy1], radius=size*0.04, fill=(255, 214, 102, 255))
    # 三条文本线
    line_col = (51, 112, 255, 255)
    for i, ly in enumerate([0.38, 0.50, 0.62]):
        lx0 = size * 0.32
        lx1 = size * (0.68 if i < 2 else 0.55)
        lw = max(2, int(size * 0.045))
        d.rounded_rectangle([lx0, size*ly - lw/2, lx1, size*ly + lw/2],
                            radius=lw/2, fill=line_col)
    img.save(os.path.join(OUT, f"icon{size}.png"))
    print("icon", size, "ok")

for s in (16, 48, 128):
    make(s)
