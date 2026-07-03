#!/usr/bin/env python3
"""Regenerate each ship's landscape SSD ``image.png`` from YOUR OWN SFB PDFs.

This repository ships only structural **metadata** (``detection.json`` / ``verified.json`` /
``boxlabels.json``) — the SSD page images are copyrighted (© Amarillo Design Bureau) and are
NOT distributed here. This utility reproduces them locally from PDFs you own, using the
source page / dpi / rotation recorded in each ``detection.json`` so the regenerated image
lines up pixel-for-pixel with the stored box coordinates.

Usage:
    python3 ssd-pipeline/extract_images.py --src /path/to/your/pdfs
    python3 ssd-pipeline/extract_images.py --src ./SFB --ship FED-CA --force

``--src`` is a folder containing your SFB PDF(s) (e.g. ``SFBBasicSetSSDscolor.pdf``).
See the README for where to buy them. Requires ``poppler`` (``pdftoppm``) and ``pillow``.
"""
import argparse, glob, json, os, subprocess, sys, tempfile
from PIL import Image


def render_page(pdf, page, dpi, out_png):
    """Render one PDF page to a PNG (same method ingest.py used to build the metadata)."""
    with tempfile.TemporaryDirectory() as td:
        pref = os.path.join(td, "p")
        subprocess.run(["pdftoppm", "-png", "-r", str(dpi), "-f", str(page), "-l", str(page), pdf, pref],
                       check=True, capture_output=True)
        files = [f for f in os.listdir(td) if f.endswith(".png")]
        if not files:
            raise RuntimeError("pdftoppm produced no image")
        Image.open(os.path.join(td, files[0])).convert("RGB").save(out_png)


def find_pdf(src_dir, name):
    exact = os.path.join(src_dir, name)
    if os.path.isfile(exact):
        return exact
    for f in glob.glob(os.path.join(src_dir, "**", "*.pdf"), recursive=True):
        if os.path.basename(f).lower() == name.lower():
            return f
    return None


def extract(ship_dir, src_dir, force):
    ship = os.path.basename(os.path.normpath(ship_dir))
    det = json.load(open(os.path.join(ship_dir, "detection.json")))
    src, rot = det["source"], det.get("rotationApplied", 0)
    out = os.path.join(ship_dir, "image.png")
    if os.path.exists(out) and not force:
        print(f"[{ship}] image.png already present (use --force to rebuild)")
        return True
    pdf = find_pdf(src_dir, src["pdf"])
    if not pdf:
        print(f"[{ship}] MISSING SOURCE: {src['pdf']} not found under {src_dir}")
        return False
    if det.get("segmentation", "single") != "single":
        print(f"[{ship}] note: multi-SSD page — rebuild this one with ingest.py --expect")
        return False
    raw = os.path.join(ship_dir, "raw.png")
    render_page(pdf, src["page"], src["dpi"], raw)
    im = Image.open(raw).convert("RGB").rotate(-rot, expand=True)
    im.save(out)
    ok = im.width == det["pxWidth"] and im.height == det["pxHeight"]
    tag = "OK" if ok else f"DIM MISMATCH (expected {det['pxWidth']}x{det['pxHeight']})"
    print(f"[{ship}] {src['pdf']} p{src['page']} @{src['dpi']}dpi rot{rot} -> {im.width}x{im.height}  {tag}")
    return ok


def main():
    ap = argparse.ArgumentParser(description="Regenerate SSD image.png files from your owned SFB PDFs.")
    ap.add_argument("--src", required=True, help="folder containing your SFB PDF(s)")
    ap.add_argument("--data", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
    ap.add_argument("--ship", default=None, help="only this ship code (e.g. FED-CA)")
    ap.add_argument("--force", action="store_true", help="rebuild even if image.png exists")
    a = ap.parse_args()
    dirs = ([os.path.join(a.data, a.ship)] if a.ship else
            sorted(os.path.dirname(d) for d in glob.glob(os.path.join(a.data, "*", "detection.json"))))
    if not dirs:
        sys.exit("no ships found under " + a.data)
    ok = sum(bool(extract(d, a.src, a.force)) for d in dirs)
    print(f"\n{ok}/{len(dirs)} SSD images ready.")
    sys.exit(0 if ok == len(dirs) else 1)


if __name__ == "__main__":
    main()
