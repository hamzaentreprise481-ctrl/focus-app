"""Sequence 4B-4D: the REAL FOCUS prototype interface, filmed with a virtual
macro camera (no UI is invented or modified: every pixel of the screen comes
from assets/ui/*.png, captured from the running prototype by capture_ui.py).

The "camera" is a moving crop with a slight perspective tilt and a shallow
focus band, as if a lens were gliding over the laptop screen. A cursor is drawn
where the real hover/click happened during the capture.

Writes renders/ui/<shot>/u_####.png (1920x1080, linear-ish sRGB; graded later
with the same look as the 3D shots).
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "assets", "ui")
OUT = os.path.join(ROOT, "renders", "ui")
W, H = 1920, 1080
DPR = 2.0


def load(name):
    return Image.open(os.path.join(UI, name)).convert("RGB")


def box(name):
    x, y, w, h = (float(v) for v in open(os.path.join(UI, name)).read().split())
    return np.array([x, y, w, h]) * DPR


def ease(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * u * (u * (6 * u - 15) + 10)


def lerp(a, b, u):
    return np.asarray(a, float) + (np.asarray(b, float) - np.asarray(a, float)) * u


def cursor_img(scale=1.0):
    s = int(64 * scale)
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pts = [(0, 0), (0, 44), (11, 34), (19, 52), (26, 49), (18, 31), (33, 31)]
    pts = [(4 + x * scale * 0.9, 4 + y * scale * 0.9) for x, y in pts]
    sh = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(sh).polygon([(x + 2, y + 3) for x, y in pts], fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(2.5))
    im.alpha_composite(sh)
    d.polygon(pts, fill=(18, 18, 20, 255), outline=(255, 255, 255, 255))
    d.line(pts + [pts[0]], fill=(255, 255, 255, 255), width=max(2, int(2.2 * scale)))
    return im


CURSOR = cursor_img(1.0)


def perspective_coeffs(src_quad, dst_quad):
    """PIL PERSPECTIVE coefficients mapping output (dst) -> input (src)."""
    A, B = [], []
    for (x, y), (u, v) in zip(dst_quad, src_quad):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        B += [u, v]
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()


def render_frame(src_img, center, crop_w, tilt_deg, focus_y, blur_max, cursor=None, click=0.0):
    """center/crop in source px; tilt rotates the screen plane about its vertical axis."""
    crop_h = crop_w * H / W
    cx, cy = center
    # keep the (keystoned) crop inside the captured screenshot: no black borders
    mx = crop_w * 0.62
    my = crop_h * 0.62
    cx = min(max(cx, mx), src_img.width - mx)
    cy = min(max(cy, my), src_img.height - my)
    # source quad (the crop) -> destination with a gentle keystone (perspective)
    k = math.tan(math.radians(tilt_deg)) * 0.18
    quad = [(cx - crop_w / 2, cy - crop_h / 2), (cx + crop_w / 2, cy - crop_h / 2),
            (cx + crop_w / 2, cy + crop_h / 2), (cx - crop_w / 2, cy + crop_h / 2)]
    dst = [(-W * k, -H * k * 0.5), (W * (1 + k * 0.4), H * k * 0.2), (W * (1 + k * 0.4), H * (1 - k * 0.2)), (-W * k, H * (1 + k * 0.5))]
    coeffs = perspective_coeffs(quad, dst)
    frame = src_img.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    # cursor (drawn in source space -> projected)
    if cursor is not None:
        ccur = np.asarray(cursor, float)
        # forward map source -> dest by inverting coeffs numerically (small Newton on the homography)
        inv = np.linalg.inv(np.array([[coeffs[0], coeffs[1], coeffs[2]], [coeffs[3], coeffs[4], coeffs[5]], [coeffs[6], coeffs[7], 1.0]]))
        p = inv @ np.array([ccur[0], ccur[1], 1.0])
        px, py = p[0] / p[2], p[1] / p[2]
        sc = (W / crop_w) * DPR / 2.0 * 0.9 * (1 - 0.12 * click)
        cimg = CURSOR.resize((max(8, int(CURSOR.width * sc)), max(8, int(CURSOR.height * sc))), Image.LANCZOS)
        fr = frame.convert("RGBA")
        fr.alpha_composite(cimg, (int(px - 4 * sc), int(py - 4 * sc)))
        frame = fr.convert("RGB")
    # shallow focus band
    if blur_max > 0:
        bl = frame.filter(ImageFilter.GaussianBlur(blur_max))
        yy = np.arange(H, dtype=np.float32)[:, None]
        d = np.abs(yy - focus_y) / (H * 0.48)
        mask = np.clip(d ** 1.6, 0, 1)
        mask = np.repeat(mask, W, axis=1)
        a = np.asarray(frame, np.float32)
        b = np.asarray(bl, np.float32)
        frame = Image.fromarray((a * (1 - mask[..., None]) + b * mask[..., None]).astype(np.uint8))
    return frame


def shot(name, n, fn):
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    for i in range(n):
        u = i / (n - 1)
        img = fn(i, u)
        img.save(os.path.join(d, f"u_{i + 1:04d}.png"), compress_level=1)
    print(name, n, "frames")


def blend(a, b, t):
    return Image.blend(a, b, float(min(max(t, 0), 1)))


# ------------------------------------------------------------------ 4B dashboard
dash = load("dashboard.png")
dash_h = load("dashboard_hover_lucas.png")
lb = box("dashboard_lucas_box.txt")            # "Lucas Bernard" text box (CSS px -> screenshot px)
row_c = np.array([lb[0] + 560 * DPR / 2, lb[1] + lb[3] / 2 + 14])


def f4b(i, u):
    e = ease(u)
    center = lerp((1800, 900), (row_c[0] - 40, row_c[1] + 40), e)
    cw = lerp(2500, 1300, e)
    hover = 1.0 if i >= 44 else 0.0
    img = dash_h if hover else dash
    cur = lerp((2600, 1500), (lb[0] + 620, lb[1] + 30), ease(min(max((i - 22) / 22, 0), 1)))
    return render_frame(img, center, float(cw), 4.0, H * lerp(0.45, 0.55, e), 3.5, cursor=cur if i >= 22 else None)


# ------------------------------------------------------------------ 4C analysis panel
stud = load("student_bottom.png")
# panel coordinates measured on the 3200x2000 capture
P_TOP = np.array([2380, 760])
P_FOOT = np.array([2380, 1120])


def f4c(i, u):
    e = ease(u)
    center = lerp(P_TOP, P_FOOT, e)
    cw = lerp(1500, 1250, e)
    return render_frame(stud, center, float(cw), 5.0, H * lerp(0.40, 0.60, e), 2.6)


# ------------------------------------------------------------------ 4D action -> dialog
hov = load("student_hover_action.png")
dlg = load("accompagnement_dialog.png")
ab = box("student_action_box.txt")
btn_c = np.array([ab[0] + ab[2] / 2, ab[1] + ab[3] / 2])
D_C = np.array([1600, 1000])


def f4d(i, u):
    e = ease(u)
    click_f = 36
    if i < click_f:
        img = hov
        center = lerp((2390, 1480), btn_c + np.array([-80, -60]), ease(i / click_f))
        cw = lerp(1700, 1500, ease(i / click_f))
    else:
        t = ease((i - click_f) / (77 - click_f))
        img = blend(hov, dlg, (i - click_f) / 5.0)
        center = lerp(btn_c + np.array([-80, -60]), D_C + np.array([0, -10]), t)
        cw = lerp(1500, 1350, t)
    cur = lerp(btn_c + np.array([260, 220]), btn_c + np.array([30, 6]), ease(min(i / 30, 1)))
    click = max(0.0, 1 - abs(i - click_f) / 3)
    return render_frame(img, center, float(cw), -4.0, H * 0.5, 3.0, cursor=cur if i < click_f + 10 else None, click=click)


if __name__ == "__main__":
    which = sys.argv[1:] or ["4B", "4C", "4D"]
    if "4B" in which:
        shot("4B", 72, f4b)
    if "4C" in which:
        shot("4C", 78, f4c)
    if "4D" in which:
        shot("4D", 78, f4d)
