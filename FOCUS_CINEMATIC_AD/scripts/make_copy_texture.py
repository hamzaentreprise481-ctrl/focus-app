"""Generate the student's math test sheet ("copie double", Seyes ruling) as
high-resolution textures for Blender.

Outputs (in assets/):
  copy_color.png   paper + ruling + blue student ink + red teacher ink (sRGB)
  copy_ink.png     grayscale mask of all ink (blue + red), used for glow/dissolve
  copy_red.png     grayscale mask of red teacher ink only
  copy_lines.png   grayscale mask of the Seyes ruling + margin
  copy_layout.json positions (in mm) of key elements (error circle centre, etc.)

Everything is drawn procedurally; fonts are OFL (see LICENSES.md).
"""
import json
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "assets", "fonts")
OUT = os.path.join(ROOT, "assets")

W_MM, H_MM = 210.0, 297.0
W = 4096
PX = W / W_MM                      # pixels per millimetre
H = int(round(H_MM * PX))

PAPER = np.array([243, 241, 236], np.float32)
LINE_FINE = np.array([186, 178, 214], np.float32)   # light lilac Seyes lines
LINE_BOLD = np.array([150, 138, 196], np.float32)
MARGIN = np.array([222, 120, 130], np.float32)
BLUE_INK = (24, 38, 104)
RED_INK = (196, 28, 36)

rng = random.Random(7)


def mm(v):
    return int(round(v * PX))


# ----------------------------------------------------------------- paper base
def paper_base():
    nrng = np.random.default_rng(3)
    img = np.ones((H, W, 3), np.float32) * PAPER
    # low-frequency tone variation + fibres
    lo = nrng.normal(0, 1, (H // 64 + 1, W // 64 + 1)).astype(np.float32)
    lo = np.array(Image.fromarray(lo).resize((W, H), Image.BICUBIC))
    hi = nrng.normal(0, 1, (H, W)).astype(np.float32)
    img += (lo * 2.2 + hi * 1.6)[..., None]
    return img


def ruling(img):
    # Seyes: fine horizontal every 2 mm, bold every 8 mm, vertical every 8 mm
    top = 22.0
    y = top
    i = 0
    while y < H_MM - 8:
        bold = (i % 4 == 0)
        col = LINE_BOLD if bold else LINE_FINE
        th = 0.16 if bold else 0.09
        y0, y1 = mm(y - th / 2), max(mm(y + th / 2), mm(y - th / 2) + 1)
        img[y0:y1, :, :] = img[y0:y1, :, :] * 0.25 + col * 0.75
        y += 2.0
        i += 1
    x = 8.0
    while x < W_MM:
        x0, x1 = mm(x - 0.06), max(mm(x + 0.06), mm(x - 0.06) + 1)
        img[mm(top):mm(H_MM - 10), x0:x1, :] = img[mm(top):mm(H_MM - 10), x0:x1, :] * 0.35 + LINE_FINE * 0.65
        x += 8.0
    # red margin
    mx = 32.0
    img[:, mm(mx - 0.15):mm(mx + 0.15), :] = img[:, mm(mx - 0.15):mm(mx + 0.15), :] * 0.2 + MARGIN * 0.8
    return img


# ----------------------------------------------------------- handwriting
class Hand:
    def __init__(self, font_file, size_mm, slant=0.0, jitter=1.0):
        self.font = ImageFont.truetype(os.path.join(FONTS, font_file), mm(size_mm))
        self.size = mm(size_mm)
        self.slant = slant
        self.jitter = jitter

    def write(self, mask, text, x_mm, base_mm, seed=0):
        """Draw text onto the float mask (0..1). Returns end x in mm."""
        r = random.Random(seed)
        x = mm(x_mm)
        base = mm(base_mm)
        drift = 0.0
        for ch in text:
            if ch == " ":
                x += int(self.size * (0.28 + r.uniform(-0.03, 0.05)))
                continue
            s = int(self.size * (1 + r.uniform(-0.04, 0.04) * self.jitter))
            f = self.font if s == self.size else self.font.font_variant(size=s)
            asc, desc = f.getmetrics()
            pad = s // 2
            tile = Image.new("L", (int(s * 1.6) + 2 * pad, asc + desc + 2 * pad), 0)
            ImageDraw.Draw(tile).text((pad, pad), ch, font=f, fill=255)
            ang = r.uniform(-4, 4) * self.jitter + self.slant
            tile = tile.rotate(ang, resample=Image.BICUBIC, center=(pad, pad + asc))
            drift += r.uniform(-0.012, 0.012) * self.size
            drift *= 0.85
            px = x - pad
            py = base - asc - pad + int(drift)
            arr = np.asarray(tile, np.float32) / 255.0
            # ballpoint pressure variation
            press = r.uniform(0.82, 1.0)
            arr *= press
            h, w = arr.shape
            ys, xs = max(0, py), max(0, px)
            ye, xe = min(mask.shape[0], py + h), min(mask.shape[1], px + w)
            sub = arr[ys - py:ye - py, xs - px:xe - px]
            mask[ys:ye, xs:xe] = np.maximum(mask[ys:ye, xs:xe], sub)
            adv = f.getlength(ch)
            x += int(adv * (0.96 + r.uniform(-0.03, 0.05)))
        return x / PX


def wobbly_path(points, r, amp):
    out = []
    for (x, y) in points:
        out.append((x + r.uniform(-amp, amp), y + r.uniform(-amp, amp)))
    return out


def stroke(mask, pts_mm, width_mm, seed=0):
    img = Image.fromarray((mask * 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    pts = [(mm(x), mm(y)) for x, y in pts_mm]
    d.line(pts, fill=255, width=max(2, mm(width_mm)), joint="curve")
    for p in (pts[0], pts[-1]):
        rr = max(1, mm(width_mm) // 2)
        d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=255)
    return np.asarray(img, np.float32) / 255.0


def ellipse_path(cx, cy, rx, ry, start=-0.4, turns=1.1, n=220, seed=0):
    """Hand-drawn ellipse: smooth low-frequency wobble + slight spiral overshoot."""
    r = random.Random(seed)
    phases = [r.uniform(0, 2 * math.pi) for _ in range(3)]
    pts = []
    for i in range(n):
        u = i / (n - 1)
        t = start + 2 * math.pi * turns * u
        wob = 0.035 * math.sin(2 * t + phases[0]) + 0.02 * math.sin(3 * t + phases[1]) + 0.012 * math.sin(5 * t + phases[2])
        k = 1 + wob + 0.07 * u
        pts.append((cx + rx * k * math.cos(t), cy + ry * k * math.sin(t) + 0.25 * math.sin(2 * t)))
    return pts


def main():
    base = paper_base()
    img = ruling(base.copy())
    lines = np.clip(np.abs(img - base).sum(axis=2) / 120.0, 0, 1)
    Image.fromarray((lines * 255).astype(np.uint8)).save(os.path.join(OUT, "copy_lines.png"))
    del base
    blue = np.zeros((H, W), np.float32)
    red = np.zeros((H, W), np.float32)

    student = Hand("caveat-latin-500-normal.ttf", 8.2, slant=-1.5)
    student_small = Hand("caveat-latin-500-normal.ttf", 6.6, slant=-1.5)
    teacher = Hand("kalam-latin-400-normal.ttf", 6.0, slant=2.0, jitter=0.6)
    teacher_big = Hand("kalam-latin-400-normal.ttf", 9.0, slant=1.0, jitter=0.5)

    layout = {}
    # header
    student_small.write(blue, "Seconde 3", 36, 30, seed=1)
    student_small.write(blue, "Contrôle — Calcul littéral", 36, 38, seed=2)
    # grade, circled in red (top right)
    gx = teacher_big.write(red, "11/20", 160, 36, seed=3)
    red = stroke(red, ellipse_path(171.0, 33.2, 14.5, 6.8, seed=4), 0.55)
    layout["grade_center_mm"] = [171.5, 32.5]

    # exercise 2
    ex_end = student.write(blue, "Exercice 2 :", 36, 54, seed=5)
    blue = stroke(blue, wobbly_path([(36, 55.6), (ex_end - 1, 55.3)], rng, 0.15), 0.32)
    student_small.write(blue, "Développer et réduire.", ex_end + 3, 54, seed=6)

    student.write(blue, "A = (x + 3)²", 40, 70, seed=7)
    a2_start = 40
    a2_mid = student.write(blue, "A = ", a2_start, 78, seed=8)
    a2_end = student.write(blue, "x² + 9", a2_mid, 78, seed=9)
    # red ellipse around the error
    ecx, ecy = (a2_mid + a2_end) / 2 + 0.3, 75.6
    red = stroke(red, ellipse_path(ecx, ecy, (a2_end - a2_mid) / 2 + 3.6, 4.3, seed=10), 0.5)
    teacher.write(red, "2 × 3 × x ?", a2_end + 10, 78.5, seed=11)
    layout["error_center_mm"] = [ecx, ecy]

    student.write(blue, "B = (2x − 1)(x + 4)", 40, 94, seed=12)
    student.write(blue, "B = 2x² + 8x − x − 4", 40, 102, seed=13)
    b_end = student.write(blue, "B = 2x² + 7x − 4", 40, 110, seed=14)
    red = stroke(red, wobbly_path([(b_end + 9, 106.8), (b_end + 11, 109.6), (b_end + 17, 102.4)], rng, 0.1), 0.5)

    student.write(blue, "C = (x − 5)²", 40, 126, seed=15)
    c_mid = student.write(blue, "C = ", 40, 134, seed=16)
    c_end = student.write(blue, "x² − 25", c_mid, 134, seed=17)
    # wavy red underline under the repeated error
    wav = [(c_mid + i * 0.5, 136.4 + 0.55 * math.sin(i * 0.9)) for i in range(int((c_end - c_mid) / 0.5) + 2)]
    red = stroke(red, wav, 0.45)
    teacher.write(red, "?", c_end + 6, 134.5, seed=18)
    layout["error2_center_mm"] = [(c_mid + c_end) / 2, 133.0]

    # exercise 3
    student.write(blue, "Exercice 3 :", 36, 150, seed=19)
    student_small.write(blue, "Résoudre 3x − 7 = 2x + 5", 70, 150, seed=20)
    student.write(blue, "3x − 2x = 5 + 7", 40, 166, seed=21)
    e_end = student.write(blue, "x = 12", 40, 174, seed=22)
    red = stroke(red, wobbly_path([(e_end + 8, 170.8), (e_end + 10, 173.6), (e_end + 16, 166.4)], rng, 0.1), 0.5)

    student.write(blue, "Exercice 4 :", 36, 190, seed=23)
    student_small.write(blue, "Factoriser 4x² − 9", 70, 190, seed=24)
    student.write(blue, "4x² − 9 = (2x − 3)(2x + 3)", 40, 206, seed=25)

    # soften ink edges slightly (ballpoint bleed)
    blue = np.asarray(Image.fromarray((blue * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1)), np.float32) / 255
    red = np.asarray(Image.fromarray((red * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255
    blue = np.clip(blue * 1.15, 0, 1)
    red = np.clip(red * 1.15, 0, 1)

    col = img
    col = col * (1 - blue[..., None] * 0.92) + np.array(BLUE_INK, np.float32) * blue[..., None] * 0.92
    # ungraded version (the student is still writing: no red marks yet)
    Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).save(os.path.join(OUT, "copy_ungraded_color.png"))
    col = col * (1 - red[..., None] * 0.9) + np.array(RED_INK, np.float32) * red[..., None] * 0.9
    col = np.clip(col, 0, 255).astype(np.uint8)
    Image.fromarray(col).save(os.path.join(OUT, "copy_color.png"))
    ink = np.clip(np.maximum(blue, red), 0, 1)
    Image.fromarray((ink * 255).astype(np.uint8)).save(os.path.join(OUT, "copy_ink.png"))
    Image.fromarray((red * 255).astype(np.uint8)).save(os.path.join(OUT, "copy_red.png"))
    layout.update({"width_mm": W_MM, "height_mm": H_MM, "px_per_mm": PX, "size_px": [W, H]})
    with open(os.path.join(OUT, "copy_layout.json"), "w") as fh:
        json.dump(layout, fh, indent=2)
    # preview
    Image.fromarray(col).resize((W // 4, H // 4), Image.LANCZOS).save(os.path.join(ROOT, "quality_control", "copy_preview.png"))
    print("ok", W, H, layout)


GREEN_INK = (22, 120, 72)


def make_reprise():
    """The student's new attempt after the teacher's follow-up (sequence 5)."""
    base = paper_base()
    img = ruling(base.copy())
    del base
    blue = np.zeros((H, W), np.float32)
    green = np.zeros((H, W), np.float32)
    student = Hand("caveat-latin-500-normal.ttf", 8.2, slant=-1.5)
    student_small = Hand("caveat-latin-500-normal.ttf", 6.6, slant=-1.5)
    teacher = Hand("kalam-latin-400-normal.ttf", 6.0, slant=2.0, jitter=0.6)
    student_small.write(blue, "Seconde 3", 36, 30, seed=31)
    student_small.write(blue, "Reprise — identités remarquables", 36, 38, seed=32)
    student_small.write(blue, "(a + b)² = a² + 2ab + b²", 40, 54, seed=33)
    student.write(blue, "A = (x + 3)²", 40, 70, seed=34)
    student.write(blue, "A = x² + 2 × 3 × x + 9", 40, 78, seed=35)
    a_end = student.write(blue, "A = x² + 6x + 9", 40, 86, seed=36)
    green = stroke(green, wobbly_path([(a_end + 10, 84.2), (a_end + 12, 86.8), (a_end + 18, 80.8)], rng, 0.1), 0.5)
    student.write(blue, "C = (x − 5)²", 40, 102, seed=37)
    student.write(blue, "C = x² − 2 × 5 × x + 25", 40, 110, seed=38)
    c_end = student.write(blue, "C = x² − 10x + 25", 40, 118, seed=39)
    green = stroke(green, wobbly_path([(c_end + 10, 116.2), (c_end + 12, 118.8), (c_end + 18, 112.8)], rng, 0.1), 0.5)
    teacher.write(green, "Bien !", c_end + 24, 118.5, seed=40)
    blue = np.asarray(Image.fromarray((blue * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1)), np.float32) / 255
    green = np.asarray(Image.fromarray((green * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255
    blue, green = np.clip(blue * 1.15, 0, 1), np.clip(green * 1.15, 0, 1)
    col = img * (1 - blue[..., None] * 0.92) + np.array(BLUE_INK, np.float32) * blue[..., None] * 0.92
    col = col * (1 - green[..., None] * 0.9) + np.array(GREEN_INK, np.float32) * green[..., None] * 0.9
    Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).save(os.path.join(OUT, "reprise_color.png"))
    Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).resize((W // 4, H // 4), Image.LANCZOS).save(
        os.path.join(ROOT, "quality_control", "reprise_preview.png"))


def make_sticky():
    """Teacher's sticky note: the pedagogical decision (sequence 5)."""
    S = 1400  # 76 x 76 mm note
    nrng = np.random.default_rng(9)
    img = np.ones((S, S, 3), np.float32) * np.array([250, 236, 140], np.float32)
    img += nrng.normal(0, 2.0, (S, S, 1))
    img[: int(S * 0.22)] *= 0.97          # adhesive band reads slightly different
    ink = np.zeros((S, S), np.float32)
    teacher = Hand("kalam-latin-400-normal.ttf", 7.0, slant=1.5, jitter=0.6)
    # Hand works in mm on the big page scale; draw on a temporary canvas then crop
    canvas = np.zeros((H, W), np.float32)
    teacher.write(canvas, "Revoir (a + b)²", 8, 26, seed=51)
    teacher.write(canvas, "ensemble — jeudi", 8, 40, seed=52)
    teacher.write(canvas, "+ 3 exercices", 8, 54, seed=53)
    cut = canvas[: int(76 * PX), : int(76 * PX)]
    cut = np.asarray(Image.fromarray((cut * 255).astype(np.uint8)).resize((S, S), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
    img = img * (1 - cut[..., None] * 0.9) + np.array([30, 40, 110], np.float32) * cut[..., None] * 0.9
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(os.path.join(OUT, "sticky_note.png"))


if __name__ == "__main__":
    main()
    make_reprise()
    make_sticky()
