"""Edit, typography, audio mix and export.

  python assemble.py pilot   -> output/FOCUS_PILOT_8S.mp4      (sequence 2 alone, 8.0 s)
  python assemble.py film    -> output/FOCUS_CINEMATIC_FINAL.mp4 (55.0 s)

Picture: graded PNG sequences (renders/graded/*, renders/ui/*) are cut together
frame by frame following the EDL below; titles/captions are typeset here
(Inter, SIL OFL) so they stay perfectly crisp.
Sound: voice-over lines (Kokoro), score + sound design (make_music.py), ducking,
two-pass loudness normalisation to -14 LUFS / -1 dBTP, AAC 48 kHz stereo.
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = os.path.join(ROOT, "renders")
AUD = os.path.join(ROOT, "audio")
OUTD = os.path.join(ROOT, "output")
FONTS = os.path.join(ROOT, "assets", "fonts")
FPS = 24
W, H = 1920, 1080
SR = 48000

# ------------------------------------------------------------------- EDL (film)
# (film_frame_start, n_frames, source_dir, first_source_frame, prefix)
G = os.path.join(R, "graded")
EDL = [
    (0, 72, os.path.join(G, "desk_student"), 1, "f_"),       # 1A student writing (morning)
    (72, 78, os.path.join(G, "desk_student"), 73, "f_"),     # 1B the grade, then the error
    (150, 90, os.path.join(G, "desk_teacher"), 1, "f_"),     # 1C teacher's desk (evening)
    (240, 180, os.path.join(G, "pilot"), 1, "f_"),           # 2  transformation (pilot frames 1-180)
    (420, 360, os.path.join(G, "seq3"), 1, "f_"),            # 3  network (6 shots)
    (780, 72, os.path.join(G, "laptop"), 9, "f_"),           # 4A laptop (frames 1-8 used in the dissolve)
    (852, 72, os.path.join(R, "ui", "4B"), 1, "u_"),         # 4B real dashboard
    (924, 78, os.path.join(R, "ui", "4C"), 1, "u_"),         # 4C real analysis panel
    (1002, 78, os.path.join(R, "ui", "4D"), 1, "u_"),        # 4D real follow-up action
    (1080, 60, os.path.join(G, "desk_teacher"), 91, "f_"),   # 5A the teacher's decision
    (1140, 60, os.path.join(G, "desk_student"), 151, "f_"),  # 5B the student moves forward
    (1200, 12, None, 0, ""),                                 # music cut: black
    (1212, 108, os.path.join(G, "logo"), 1, "f_"),           # 6  reveal
]
DISSOLVES = [  # (film_frame_start, n, outgoing_dir, outgoing_first, incoming_dir, incoming_first)
    (240, 6, os.path.join(G, "desk_teacher"), 90, os.path.join(G, "pilot"), 1),        # light change on a match cut (outgoing held)
    (772, 8, os.path.join(G, "seq3"), 353, os.path.join(G, "laptop"), 1),
    (1080, 6, os.path.join(R, "ui", "4D"), 78, os.path.join(G, "desk_teacher"), 91),   # outgoing held
]
HOLD_OUT = {240, 1080}
UI_DIRS = {os.path.join(R, "ui", s) for s in ("4B", "4C", "4D")}

VO = [("01_grade", 3.15), ("02_story", 5.05), ("03_signal", 11.25), ("04_connects", 18.4),
      ("05_teachers", 35.6), ("06_students", 45.45), ("07_focus", 51.0), ("08_tagline", 52.3)]

# ------------------------------------------------------------------ typography


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def tracked_text(text, fnt, tracking_px, fill=(255, 255, 255, 255)):
    """Render text with letter-spacing on a transparent RGBA tile."""
    widths = [fnt.getlength(c) for c in text]
    total = int(sum(widths) + tracking_px * (len(text) - 1)) + 40
    asc, desc = fnt.getmetrics()
    im = Image.new("RGBA", (total, asc + desc + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x = 20
    for c, w_ in zip(text, widths):
        d.text((x, 20), c, font=fnt, fill=fill)
        x += w_ + tracking_px
    return im.crop(im.getbbox() or (0, 0, 1, 1))


def ease(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * u * (u * (6 * u - 15) + 10)


def title_layer(text, t, t0, dur, y_frac=0.885, size=66, track0=0.62, track1=0.40, fname="InterDisplay-Light.otf", alpha_max=0.96):
    """Cinematic title: blur-to-sharp, tracking tightens, fades out."""
    if t < t0 or t > t0 + dur:
        return None
    u_in = ease((t - t0) / 0.75)
    u_out = ease((t0 + dur - t) / 0.4)
    a = alpha_max * min(u_in, u_out)
    fnt = font(fname, size)
    tr = size * (track0 + (track1 - track0) * ease((t - t0) / 1.6))
    tile = tracked_text(text, fnt, tr)
    blur = (1 - u_in) * 6
    if blur > 0.2:
        tile = tile.filter(ImageFilter.GaussianBlur(blur))
    if a < 1:
        al = tile.getchannel("A").point(lambda v: int(v * a))
        tile.putalpha(al)
    return tile, (W // 2 - tile.width // 2, int(H * y_frac) - tile.height // 2)


def caption_layer(text, t, t0, dur, size=30):
    if t < t0 or t > t0 + dur:
        return None
    a = min(ease((t - t0) / 0.5), ease((t0 + dur - t) / 0.4)) * 0.92
    fnt = font("Inter-Regular.otf", size)
    tile = tracked_text(text, fnt, 0.6, fill=(255, 255, 255, 255))
    pad = 18
    bg = Image.new("RGBA", (tile.width + 2 * pad + 6, tile.height + 2 * pad), (8, 12, 22, int(170 * a)))
    ImageDraw.Draw(bg).rectangle([0, 0, 3, bg.height], fill=(120, 170, 255, int(255 * a)))
    al = tile.getchannel("A").point(lambda v: int(v * a))
    tile.putalpha(al)
    bg.alpha_composite(tile, (pad + 6, pad - 2))
    return bg, (110, H - 150)


def tag_layer(text, t, t0, dur, size=21):
    if t < t0 or t > t0 + dur:
        return None
    a = min(ease((t - t0) / 0.4), ease((t0 + dur - t) / 0.4)) * 0.75
    tile = tracked_text(text, font("Inter-Medium.otf", size), 1.6)
    al = tile.getchannel("A").point(lambda v: int(v * a))
    tile.putalpha(al)
    pill = Image.new("RGBA", (tile.width + 28, tile.height + 18), (8, 12, 22, int(150 * a / 0.75)))
    pill.alpha_composite(tile, (14, 8))
    return pill, (W - pill.width - 60, 48)


_GRAD = None


def bottom_gradient(t):
    """Soft dark band under the sequence-3 titles (keeps them clear of 3D labels)."""
    global _GRAD
    a = 0.0
    for t0, dur in ((20.0, 2.3), (22.5, 2.3), (25.0, 2.3)):
        if t0 - 0.3 <= t <= t0 + dur + 0.2:
            a = max(a, min(ease((t - t0 + 0.3) / 0.5), ease((t0 + dur + 0.2 - t) / 0.4)))
    if a <= 0:
        return None
    if _GRAD is None:
        g = np.zeros((H, W, 4), np.uint8)
        y = np.arange(H, dtype=np.float32)
        al = np.clip((y - H * 0.70) / (H * 0.30), 0, 1) ** 1.4 * 200
        g[..., 3] = al[:, None].astype(np.uint8)
        g[..., :3] = (2, 4, 10)
        _GRAD = Image.fromarray(g, "RGBA")
    gr = _GRAD.copy()
    gr.putalpha(gr.getchannel("A").point(lambda v: int(v * a)))
    return gr, (0, 0)


def overlays_film(t):
    L = [bottom_gradient(t)]
    for spec in (("EVIDENCE", 20.0, 2.3), ("UNDERSTANDING", 22.5, 2.3), ("NEXT STEP", 25.0, 2.3)):
        L.append(title_layer(spec[0], t, spec[1], spec[2]))
    L.append(tag_layer("CONCEPTUAL VISUALIZATION", t, 17.7, 14.6))
    L.append(tag_layer("FOCUS PROTOTYPE · DEMONSTRATION DATA", t, 32.6, 12.3))
    L.append(caption_layer("“Signal of difficulty — to be confirmed.”  (on-screen, translated)", t, 36.2, 2.2))
    L.append(caption_layer("“FOCUS never decides in the teacher’s place.”  (on-screen, translated)", t, 39.0, 2.6))
    L.append(caption_layer("The teacher chooses the follow-up.", t, 42.9, 2.0))
    L.append(title_layer("SEE BEYOND THE GRADE.", t, 52.2, 3.2, y_frac=0.66, size=38, track0=0.75, track1=0.52,
                         fname="InterDisplay-Regular.otf", alpha_max=0.92))
    return [x for x in L if x]


# ------------------------------------------------------------------ pixels


def load_png(path):
    return np.asarray(Image.open(path).convert("RGB"), np.float32) / 255.0


_VIG = None


def ui_look(x, seed):
    """Light grade for the UI captures so they sit in the film (no content change)."""
    global _VIG
    if _VIG is None:
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / np.sqrt(2)
        _VIG = (1 - 0.38 * np.clip(r, 0, 1) ** 2)[..., None]
    x = x * 0.93
    x = x * np.array([0.97, 0.99, 1.02], np.float32)
    x = 0.5 + (x - 0.5) * 1.03
    x = x * _VIG
    g = np.random.default_rng(seed).normal(0, 0.008, (H, W, 1)).astype(np.float32)
    return np.clip(x + g, 0, 1)


def src_frame(d, n, prefix, seed):
    p = os.path.join(d, f"{prefix}{n:04d}.png")
    x = load_png(p)
    if x.shape[:2] != (H, W):
        x = np.asarray(Image.fromarray((x * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS), np.float32) / 255
    if d in UI_DIRS:
        x = ui_look(x, seed)
    return x


SEQ3 = os.path.join(G, "seq3")
ZOOM_SPAN = (740, 771)    # ease to the laptop screen framing (x 1/0.9) before the 772-779 dissolve


def zoom(x, z):
    if abs(z - 1) < 1e-4:
        return x
    im = Image.fromarray((np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8))
    w2, h2 = int(round(W / z)), int(round(H / z))
    box = ((W - w2) // 2, (H - h2) // 2, (W - w2) // 2 + w2, (H - h2) // 2 + h2)
    return np.asarray(im.crop(box).resize((W, H), Image.LANCZOS), np.float32) / 255


def seq3_zoom(i):
    a, b = ZOOM_SPAN
    if i < a:
        return 1.0
    return 1 + (1 / 0.9 - 1) * ease((i - a) / (b - a))


def film_frame(i):
    for start, n, d, first, prefix in EDL:
        if start <= i < start + n:
            if d is None:
                base = np.zeros((H, W, 3), np.float32)
            else:
                base = src_frame(d, first + (i - start), prefix, i)
                if d == SEQ3:
                    base = zoom(base, seq3_zoom(i))
            break
    for start, n, d_out, f_out, d_in, f_in in DISSOLVES:
        if start <= i < start + n:
            k = i - start
            a = ease((k + 1) / (n + 1))
            pa = "u_" if d_out in UI_DIRS else "f_"
            pb = "u_" if d_in in UI_DIRS else "f_"
            fo = f_out if start in HOLD_OUT else f_out + k
            out_img = src_frame(d_out, fo, pa, i)
            if d_out == SEQ3:
                out_img = zoom(out_img, seq3_zoom(i))
            base = out_img * (1 - a) + src_frame(d_in, f_in + k, pb, i) * a
    return base


def compose(i, mode, out_dir):
    t = i / FPS
    if mode == "film":
        x = film_frame(i)
        layers = overlays_film(t)
    else:  # pilot: sequence 2 alone, pilot frames 1..192
        x = src_frame(os.path.join(G, "pilot"), i + 1, "f_", i)
        layers = []
    im = Image.fromarray((np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8)).convert("RGBA")
    for tile, pos in layers:
        im.alpha_composite(tile, pos)
    im.convert("RGB").save(os.path.join(out_dir, f"ff_{i:04d}.png"), compress_level=1)
    return i


# ------------------------------------------------------------------ audio


def read(path):
    y, sr = sf.read(path, always_2d=True)
    assert sr == SR, (path, sr)
    if y.shape[1] == 1:
        y = np.repeat(y, 2, 1)
    return y


def mix(mode):
    score = read(os.path.join(AUD, "score.wav"))
    sfx = read(os.path.join(AUD, "sfx.wav"))
    n = len(score)
    vo = np.zeros((n, 2))
    active = np.zeros(n)
    for name, t0 in VO:
        y = read(os.path.join(AUD, "vo", f"{name}.wav"))
        i0 = int(t0 * SR)
        k = min(len(y), n - i0)
        vo[i0:i0 + k] += y[:k] * 0.9
        active[i0:i0 + k] = 1
    # ducking envelope (attack 120 ms, release 450 ms)
    env = np.zeros(n)
    a_up, a_dn = 1 / (0.12 * SR), 1 / (0.45 * SR)
    lvl = 0.0
    for idx in range(0, n, 48):
        tgt = active[idx]
        lvl += (tgt - lvl) * (48 * (a_up if tgt > lvl else a_dn) * 3)
        env[idx:idx + 48] = min(max(lvl, 0), 1)
    duck_m = 10 ** (-7.0 * env / 20)
    duck_s = 10 ** (-3.0 * env / 20)
    out = score * duck_m[:, None] * 1.0 + sfx * duck_s[:, None] * 0.9 + vo * 1.05
    if mode == "pilot":
        a, b = int(10.0 * SR), int(18.0 * SR)
        out = out[a:b].copy()
        fi, fo = int(0.35 * SR), int(0.6 * SR)
        out[:fi] *= np.linspace(0, 1, fi)[:, None]
        out[-fo:] *= np.linspace(1, 0, fo)[:, None]
    raw = os.path.join(AUD, f"_mix_{mode}_raw.wav")
    sf.write(raw, out.astype(np.float32), SR)
    # two-pass loudness normalisation
    probe = subprocess.run(["ffmpeg", "-hide_banner", "-i", raw, "-af", "loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json",
                            "-f", "null", "-"], capture_output=True, text=True).stderr
    js = json.loads(probe[probe.rindex("{"):probe.rindex("}") + 1])
    final = os.path.join(AUD, f"FOCUS_{mode}_mix.wav")
    af = (f"loudnorm=I=-14:TP=-1.0:LRA=11:measured_I={js['input_i']}:measured_TP={js['input_tp']}:"
          f"measured_LRA={js['input_lra']}:measured_thresh={js['input_thresh']}:offset={js['target_offset']}:linear=true,"
          f"aresample={SR}")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-af", af, "-ar", str(SR), "-c:a", "pcm_s24le", final], check=True)
    os.remove(raw)
    return final


# ------------------------------------------------------------------ main


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "film"
    n = 192 if mode == "pilot" else 1320
    out_dir = os.path.join(R, f"final_{mode}")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(OUTD, exist_ok=True)
    with ProcessPoolExecutor(int(os.environ.get("FOCUS_WORKERS", "2"))) as ex:
        list(ex.map(compose, range(n), [mode] * n, [out_dir] * n, chunksize=8))
    wav = mix(mode)
    name = "FOCUS_PILOT_8S.mp4" if mode == "pilot" else "FOCUS_CINEMATIC_FINAL.mp4"
    out = os.path.join(OUTD, name)
    encode(out_dir, wav, out, "16M" if mode == "pilot" else "12M")
    if mode == "film":   # light copy for phones/tablets and web previews
        encode(out_dir, wav, os.path.join(OUTD, "FOCUS_CINEMATIC_FINAL_720p_web.mp4"), "3M", scale="1280:720")
    print("WROTE", out)


def encode(frames_dir, wav, out, bitrate, scale=None):
    """Two-pass H.264 High@4.1, BT.709, AAC 320k. Target bitrates keep the 55 s
    master under GitHub's 100 MB file limit while staying visually transparent."""
    passlog = out + ".passlog"
    vf = ["-vf", f"scale={scale}:flags=lanczos"] if scale else []
    common = ["-framerate", str(FPS), "-i", os.path.join(frames_dir, "ff_%04d.png")]
    venc = ["-c:v", "libx264", "-preset", "slow", "-b:v", bitrate, "-maxrate", str(int(bitrate[:-1]) * 3 // 2) + "M",
            "-bufsize", str(int(bitrate[:-1]) * 2) + "M", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            "-x264-params", "keyint=48:min-keyint=24", "-passlogfile", passlog]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *common, *vf, *venc, "-pass", "1", "-an", "-f", "mp4", os.devnull], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *common, "-i", wav, *vf, *venc, "-pass", "2",
                    "-c:a", "aac", "-b:a", "320k", "-ar", str(SR), "-ac", "2", "-movflags", "+faststart", "-shortest", out], check=True)
    for f in os.listdir(os.path.dirname(out)):
        if f.startswith(os.path.basename(passlog)):
            os.remove(os.path.join(os.path.dirname(out), f))


if __name__ == "__main__":
    main()
