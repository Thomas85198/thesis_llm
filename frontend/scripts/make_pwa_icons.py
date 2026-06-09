# -*- coding: utf-8 -*-
"""產生 PWA / Apple icon（沿用 app/icon.svg 的品牌：靛藍圓角方塊 + 白色文件 + 勾）。
輸出到 frontend/public/。重跑即可重產。需要 Pillow。"""
import os
from PIL import Image, ImageDraw

INDIGO = (79, 70, 229, 255)      # #4F46E5
FOLD = (199, 210, 254, 255)      # #C7D2FE
WHITE = (255, 255, 255, 255)

OUT = os.path.join(os.path.dirname(__file__), "..", "public")


def _doc_and_check(d: ImageDraw.ImageDraw, s: float):
    """以 32×32 viewBox 座標畫白色文件 + 靛藍勾，s = size/32 縮放係數。"""
    # 文件本體（含右上摺角缺口）
    body = [(10, 6), (17, 6), (22, 11), (22, 25), (10, 25)]
    d.polygon([(x * s, y * s) for x, y in body], fill=WHITE)
    # 摺角
    fold = [(17, 6), (22, 11), (17, 11)]
    d.polygon([(x * s, y * s) for x, y in fold], fill=FOLD)
    # 勾
    check = [(13.2, 16.9), (15.7, 19.4), (20.2, 14.2)]
    d.line([(x * s, y * s) for x, y in check], fill=INDIGO,
           width=max(2, round(2.2 * s)), joint="curve")


def make(size: int, maskable: bool, name: str):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        # 滿版靛藍（遮罩自己會切圓角）；文件落在 32-grid 中央 ~31–69%，在安全區內
        d.rectangle([0, 0, size, size], fill=INDIGO)
    else:
        r = round(size * 7 / 32)  # 對齊 SVG 的 rx=7/32
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=INDIGO)
    _doc_and_check(d, size / 32)
    img.save(os.path.join(OUT, name))
    print("saved", name)


if __name__ == "__main__":
    make(192, False, "icon-192.png")
    make(512, False, "icon-512.png")
    make(512, True, "icon-maskable-512.png")
    make(180, True, "apple-icon-180.png")  # iOS 不吃透明，用滿版底
