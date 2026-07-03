#!/usr/bin/env python3
"""Static server for the SSD pipeline viewer + B4 verify UI, with save / audit / rescan endpoints.
  GET  /viewer/verify.html?ship=FED-CA     -> B4 verify UI (edit groups, arcs, rescan)
  GET  /viewer/index.html?ship=FED-CA      -> read-only viewer
  POST /api/save/<ship>    body=state      -> writes data/<ship>/verified.json
  POST /api/audit/<ship>   body=state      -> group-aware consistency audit
  POST /api/rescan/<ship>  body={region}   -> border-based detector for missed (white/grey/shaded) boxes
"""
import http.server, socketserver, json, os, subprocess, tempfile
import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

PORT = 8741
ROOT = os.path.dirname(os.path.abspath(__file__))

def _det(ship): return json.load(open(os.path.join(ROOT, "data", ship, "detection.json")))

def box_labels(ship):
    """Best-effort OCR of the letters/numbers printed inside each box (e.g. sensor/scanner ratings).
    Only inked interiors are OCR'd; result is a {boxId: text} prefill the user then edits. Cached."""
    cache = os.path.join(ROOT, "data", ship, "boxlabels.json")
    if os.path.exists(cache):
        return json.load(open(cache))
    det = _det(ship)
    im = Image.open(os.path.join(ROOT, "data", ship, "image.png")).convert("L")
    A = np.asarray(im); out = {}
    for b in det["boxes"]:
        x, y, w, h = b["x"], b["y"], b["w"], b["h"]
        ins = A[y + int(h * 0.18):y + int(h * 0.82), x + int(w * 0.18):x + int(w * 0.82)]
        if ins.size == 0 or (ins < 110).mean() < 0.03:   # blank interior -> no label
            continue
        c = im.crop((x + 3, y + 3, x + w - 3, y + h - 3)).point(lambda p: 0 if p < 125 else 255)
        c = c.resize((c.width * 6, c.height * 6), Image.LANCZOS)
        c = ImageOps.expand(c, border=30, fill=255)
        f = tempfile.mktemp(suffix=".png"); c.save(f)
        try:
            t = subprocess.run(["tesseract", f, "stdout", "--oem", "1", "--psm", "8",
                                "-c", "tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
                               capture_output=True, text=True, timeout=15).stdout.strip()
        except Exception:
            t = ""
        finally:
            try: os.remove(f)
            except Exception: pass
        s = "".join(ch for ch in t if ch.isalnum())[:3]
        if s:
            out[b["id"]] = s
    try: json.dump(out, open(cache, "w"))
    except Exception: pass
    return out

def audit(ship, st):
    """Group-aware: every detected/added box must be in a verified group; weapons need an arc."""
    det = _det(ship)
    det_ids = {b["id"] for b in det["boxes"]}
    extra_ids = {b["id"] for b in st.get("extraBoxes", [])}
    all_ids = (det_ids | extra_ids) - set(st.get("deleted", []))   # boxes the user deleted from the overlay
    in_group = {}; groups = st.get("groups", [])
    for g in groups:
        for bid in g.get("boxIds", []): in_group[bid] = g
    issues = []
    unassigned = [i for i in all_ids if i not in in_group]
    if unassigned:
        issues.append({"severity": "error", "code": "BOX_UNASSIGNED",
                       "message": f"{len(unassigned)} box(es) not in any group", "n": len(unassigned)})
    unverified = sum(1 for g in groups if not g.get("verified"))
    unv_boxes = sum(len(g.get("boxIds", [])) for g in groups if not g.get("verified"))
    if unverified:
        issues.append({"severity": "error", "code": "GROUP_UNVERIFIED",
                       "message": f"{unverified} group(s) / {unv_boxes} box(es) not verified", "n": unverified})
    orphan = [bid for bid in in_group if bid not in all_ids]
    if orphan:
        issues.append({"severity": "warn", "code": "HOTSPOT_UNBOUND",
                       "message": f"{len(orphan)} grouped box(es) reference no hotspot", "n": len(orphan)})
    ARC_FAMS = ("phaser", "heavy-weapon")   # direct-fire weapons carry a firing arc (D2.11); drones/ADDs do not
    noarc = [g for g in groups if g.get("family") in ARC_FAMS
             and not (g.get("arc") or (g.get("arcDef") or {}).get("arcs") or (g.get("arcDef") or {}).get("paintAdd"))]
    if noarc:
        issues.append({"severity": "error", "code": "ARC_MISSING",
                       "message": f"{len(noarc)} weapon group(s) missing a firing arc", "n": len(noarc)})
    verified_boxes = sum(len(g.get("boxIds", [])) for g in groups if g.get("verified"))
    return {"ship": ship, "clean": not any(i["severity"] == "error" for i in issues),
            "totalBoxes": len(all_ids), "verifiedBoxes": verified_boxes,
            "groups": len(groups), "verifiedGroups": len(groups) - unverified, "issues": issues}

def rescan(ship, region):
    """Find bordered boxes (white / grey / shaded) inside a normalized region that the chroma
    pass misses. Boxes are light interiors enclosed by the black border grid."""
    det = _det(ship)
    im = Image.open(os.path.join(ROOT, "data", ship, "image.png")).convert("RGB")
    W, H = im.size
    x0, y0 = int(region["x"] * W), int(region["y"] * H)
    x1, y1 = int((region["x"] + region["w"]) * W), int((region["y"] + region["h"]) * H)
    x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(W, x1), min(H, y1)
    crop = im.crop((x0, y0, x1, y1))
    g = np.asarray(crop.convert("L"))
    ch, cw = g.shape
    light = g >= 110            # box interiors (white or grey) vs dark borders/text
    lab, n = ndimage.label(light)
    objs = ndimage.find_objects(lab)
    areas = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    existing = [(b["x"], b["y"], b["w"], b["h"]) for b in det["boxes"]]
    out = []
    for i, sl in enumerate(objs):
        if sl is None: continue
        a = areas[i]; h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
        if a < 150 or w < 10 or h < 10 or w > 95 or h > 95: continue
        if w > cw * 0.9 or h > ch * 0.9: continue          # skip the background region
        if not (0.55 < a / (h * w + 1e-6) < 1.08 and 0.4 < w / h < 2.6): continue
        gx, gy = x0 + sl[1].start, y0 + sl[0].start
        if any(abs(gx - ex) < 8 and abs(gy - ey) < 8 for ex, ey, ew, eh in existing): continue  # already detected
        # median grey -> control (white/grey) vs shaded
        sub = np.asarray(crop)[sl][lab[sl] == i + 1]
        mv = int(np.median(sub)) if sub.size else 255
        out.append({"x": gx, "y": gy, "w": w, "h": h,
                    "bbox": [round(gx / W, 4), round(gy / H, 4), round(w / W, 4), round(h / H, 4)],
                    "cc": "control", "family": "control", "shaded": mv < 210, "src": "rescan"})
    return {"ship": ship, "found": len(out), "boxes": out}

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def _json(self, code, obj):
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps(obj).encode())
    def do_GET(self):
        if self.path.startswith("/api/labels/"):
            ship = self.path.rsplit("/", 1)[-1].split("?")[0]
            try: return self._json(200, box_labels(ship))
            except Exception as e: return self._json(500, {"error": str(e)})
        return super().do_GET()
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = self.rfile.read(n)
        try: payload = json.loads(body or "{}")
        except Exception: payload = {}
        ship = self.path.rsplit("/", 1)[-1]
        try:
            if self.path.startswith("/api/save/"):
                d = os.path.join(ROOT, "data", ship)
                if not os.path.isdir(d): return self._json(404, {"error": "no such ship"})
                open(os.path.join(d, "verified.json"), "wb").write(body)
                return self._json(200, {"ok": True, "savedBytes": len(body)})
            if self.path.startswith("/api/audit/"): return self._json(200, audit(ship, payload))
            if self.path.startswith("/api/rescan/"): return self._json(200, rescan(ship, payload.get("region", {})))
        except Exception as e:
            return self._json(500, {"error": str(e)})
        return self._json(404, {"error": "unknown endpoint"})
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()
    def log_message(self, *a): pass

if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), H) as httpd:
        print(f"SSD pipeline serving {ROOT} on http://127.0.0.1:{PORT}")
        httpd.serve_forever()
