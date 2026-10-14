"""Capture the REAL FOCUS prototype interface (this repository, unmodified,
running locally with its built-in demonstration data) with Playwright.

  npx next build && npx next start -p 3100     # from the repo root
  python capture_ui.py

Outputs assets/ui/*.png (2x device pixel ratio) and assets/ui/scroll_student/*.png.
Nothing here alters the application or its data: it only navigates, hovers,
scrolls and clicks like a teacher would.
"""
import glob
import os

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "ui")
os.makedirs(os.path.join(OUT, "scroll_student"), exist_ok=True)
BASE = os.environ.get("FOCUS_URL", "http://localhost:3100")
exe = (glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome") or [None])[0]


def ease(u):
    return u * u * (3 - 2 * u)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=2)

    # 1. dashboard
    pg.goto(BASE + "/", wait_until="networkidle")
    pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(OUT, "dashboard.png"))
    pg.hover("text=Lucas Bernard")
    pg.wait_for_timeout(400)
    pg.screenshot(path=os.path.join(OUT, "dashboard_hover_lucas.png"))
    box = pg.locator("text=Lucas Bernard").bounding_box()
    with open(os.path.join(OUT, "dashboard_lucas_box.txt"), "w") as fh:
        fh.write(f"{box['x']} {box['y']} {box['width']} {box['height']}\n")

    # 2. student page (opened by clicking, as a teacher would)
    pg.click("text=Lucas Bernard")
    pg.wait_for_load_state("networkidle")
    pg.wait_for_timeout(1200)
    pg.screenshot(path=os.path.join(OUT, "student_top.png"))
    sh = pg.evaluate("document.querySelector('main').scrollHeight")
    ch = pg.evaluate("document.querySelector('main').clientHeight")
    maxs = sh - ch
    n = 96
    for i in range(n):
        y = maxs * ease(i / (n - 1))
        pg.evaluate(f"document.querySelector('main').scrollTop = {y}")
        pg.wait_for_timeout(30)
        pg.screenshot(path=os.path.join(OUT, "scroll_student", f"s_{i:03d}.png"))
    pg.screenshot(path=os.path.join(OUT, "student_bottom.png"))
    # analysis panel alone (element screenshot)
    panel = pg.locator("text=Analyse FOCUS").locator("xpath=ancestor::div[contains(@class,'rounded')][1]")
    try:
        panel.screenshot(path=os.path.join(OUT, "analysis_panel.png"))
    except Exception as e:  # layout may differ; the full screenshots remain
        print("panel screenshot skipped:", e)

    # 3. the "Créer un accompagnement" action (a simulation modal in this V0)
    pg.hover("text=Créer un accompagnement")
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(OUT, "student_hover_action.png"))
    btn = pg.locator("text=Créer un accompagnement").bounding_box()
    with open(os.path.join(OUT, "student_action_box.txt"), "w") as fh:
        fh.write(f"{btn['x']} {btn['y']} {btn['width']} {btn['height']}\n")
    pg.click("text=Créer un accompagnement")
    pg.wait_for_timeout(900)
    pg.screenshot(path=os.path.join(OUT, "accompagnement_dialog.png"))

    # 4. class view and evaluation detail
    pg.goto(BASE + "/classes/seconde-3", wait_until="networkidle")
    pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(OUT, "class.png"))
    pg.goto(BASE + "/evaluations/eval-1", wait_until="networkidle")
    pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(OUT, "evaluation_calcul_litteral.png"))
    b.close()
print("captured to", OUT)
