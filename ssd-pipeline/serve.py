#!/usr/bin/env python3
"""Static server for the SSD pipeline viewer + B4 verify UI, with save / audit / rescan endpoints.
  GET  /viewer/verify.html?ship=FED-CA     -> B4 verify UI (edit groups, arcs, rescan)
  GET  /viewer/index.html?ship=FED-CA      -> read-only viewer
  POST /api/save/<ship>    body=state      -> writes data/<ship>/verified.json
  POST /api/audit/<ship>   body=state      -> group-aware consistency audit
  POST /api/rescan/<ship>  body={region}   -> border-based detector for missed (white/grey/shaded) boxes
"""
import http.server, socketserver, json, os, subprocess, tempfile, threading, urllib.parse
import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

PORT = int(os.environ.get("SFB_PORT", "8741"))
ROOT = os.path.dirname(os.path.abspath(__file__))
ADMIN_CODE = "8783"   # gate for destructive admin actions (clear saved games)
PDF_DIR = os.path.join(os.path.dirname(ROOT), "SFB")          # owner's PDFs live in repo/SFB
SSD_PDFS = ["SFBBasicSetSSDscolor.pdf", "AMSSDs2014color.pdf"]  # searched in this order
TITLE_INDEX = os.path.join(ROOT, "data", "_title_index.json")
RACE = {"FED": "FEDERATION", "KLI": "KLINGON", "KZI": "KZINTI", "GOR": "GORN", "ROM": "ROMULAN",
        "THO": "THOLIAN", "ORI": "ORION", "HYD": "HYDRAN", "LYR": "LYRAN", "ISC": "ISC",
        "AND": "ANDROMEDAN", "WYN": "WYN", "JIN": "JINDARIAN", "SEL": "SELTORIAN", "VUD": "VUDAR"}
SCAN_JOBS = {}                                                # ship -> {phase, progress, done, error, result}
_scan_lock = threading.Lock()
try:
    from ingest import ingest_ship
except Exception:
    ingest_ship = None

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

def _page_count(pdf_path):
    out = subprocess.run(["pdfinfo", pdf_path], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.startswith("Pages:"):
            return int(line.split()[1])
    return 0

def _title_of(pdf_path, page):
    """OCR the top title strip of one page (upper-cased), e.g. 'STAR FLEET BATTLES R2.4 FEDERATION HEAVY CRUISER (CA)'."""
    with tempfile.TemporaryDirectory() as td:
        pref = os.path.join(td, "p")
        subprocess.run(["pdftoppm", "-png", "-r", "100", "-f", str(page), "-l", str(page), pdf_path, pref], capture_output=True)
        fs = [x for x in os.listdir(td) if x.endswith(".png")]
        if not fs:
            return ""
        im = Image.open(os.path.join(td, fs[0])).convert("RGB"); W, Hh = im.size
        sp = os.path.join(td, "s.png"); im.crop((0, 0, W, int(Hh * 0.06))).save(sp)
        r = subprocess.run(["tesseract", sp, "stdout"], capture_output=True, text=True)
        return " ".join(r.stdout.split()).upper()

def _title_matches(title, race, hull):
    return race in title and (f"({hull})" in title or f"({hull}" in title or f" {hull} " in title or title.rstrip().endswith(hull))

def find_and_scan(ship):
    """Background job: locate <ship>'s SSD page in the PDFs by title, then ingest it. Reports progress."""
    job = SCAN_JOBS[ship]
    parts = ship.split("-")
    race = RACE.get(parts[0].upper(), parts[0].upper())
    hull = parts[1].upper() if len(parts) > 1 else ""
    try:
        idx = json.load(open(TITLE_INDEX)) if os.path.exists(TITLE_INDEX) else {}
    except Exception:
        idx = {}
    pdfs = [(os.path.join(PDF_DIR, n), n) for n in SSD_PDFS if os.path.isfile(os.path.join(PDF_DIR, n))]
    if not pdfs:
        job.update(phase="error", done=True, error=f"No SFB PDFs found in {PDF_DIR}. See the README to add them.")
        return
    total = sum(_page_count(p) for p, _ in pdfs) or 1
    scanned = 0; found = None
    for path, name in pdfs:
        for page in range(1, _page_count(path) + 1):
            key = f"{name}:{page}"
            title = idx.get(key)
            if title is None:
                title = _title_of(path, page); idx[key] = title
            scanned += 1; job["progress"] = round(scanned / total * 0.6, 3)
            if _title_matches(title, race, hull):
                found = (path, name, page); break
        if found:
            break
    try:
        json.dump(idx, open(TITLE_INDEX, "w"))
    except Exception:
        pass
    if not found:
        job.update(phase="notfound", done=True, error=f"No SSD for {ship} was found in your PDFs.")
        return
    if ingest_ship is None:
        job.update(phase="error", done=True, error="ingest module unavailable on the server.")
        return
    path, name, page = found
    job.update(phase="scanning page", progress=0.62, source={"pdf": name, "page": page})
    try:
        det = ingest_ship(path, page, ship, os.path.join(ROOT, "data"), 200, None,
                          lambda m, f: job.update(phase=m, progress=round(0.62 + 0.38 * f, 3)))
        job.update(phase="done", progress=1.0, done=True,
                   result={"ship": ship, "source": {"pdf": name, "page": page}, "boxes": det["counts"]["boxes"]})
    except Exception as e:
        job.update(phase="error", done=True, error=str(e))

def start_scan(ship):
    with _scan_lock:
        j = SCAN_JOBS.get(ship)
        if j and not j.get("done"):
            return
        SCAN_JOBS[ship] = {"phase": "searching PDFs", "progress": 0.0, "done": False, "error": None, "result": None}
    threading.Thread(target=find_and_scan, args=(ship,), daemon=True).start()

WEAPON_CHARTS_FUNCS = """
export function bandIndex(def, trueRange) {
  return def.bands.findIndex(b => trueRange >= b.minTrue && trueRange <= b.maxTrue);
}

// overload warhead: photon carries a fixed value; a disruptor doubles the standard band damage (E3.52)
function overloadDmg(def, trueRange) {
  if (def.overload.fixedDamage != null) return def.overload.fixedDamage;
  const bi = bandIndex(def, Math.max(1, trueRange));   // clamp so a point-blank (R0) bolt reads the R1 band
  return 2 * (def.fixedDamage[bi] || 0);
}

export function damageFor(def, trueRange, die, mode = false) {   // mode: false | true/'overload' | 'prox'
  const ov = (mode === true || mode === 'overload') && def.overload;
  const prox = mode === 'prox' && def.proximity;
  if (prox) {
    const pd = def.proximity;
    if (trueRange < (pd.minRange || 0) || trueRange > pd.maxRange) return 0;   // E4.32: automatic miss inside min range
    const bi = bandIndex(def, trueRange); if (bi < 0) return 0;
    const hb = def.hitBand1d[bi]; if (!hb) return 0;
    return (die >= hb[0] && die <= hb[1] + (pd.dieBonus || 0)) ? pd.fixedDamage : 0;
  }
  if (ov) {
    const od = def.overload;
    if (trueRange > od.maxRange) return 0;
    if (trueRange <= (od.feedbackRange ?? -1)) return (die >= 1 && die <= 6) ? overloadDmg(def, trueRange) : 0;   // R0-1 overload hits 1-6 (E4.43)
    if (def.minRange && trueRange < def.minRange) return 0;
    const bi = bandIndex(def, trueRange); if (bi < 0) return 0;
    const hb = def.hitBand1d[bi]; if (!hb) return 0;
    return (die >= hb[0] && die <= hb[1]) ? overloadDmg(def, trueRange) : 0;
  }
  if (def.minRange && trueRange < def.minRange) return 0;
  if (trueRange > def.maxRange) return 0;
  const bi = bandIndex(def, trueRange); if (bi < 0) return 0;
  if (def.resolution === 'range-of-effect') return def.effectGrid[die - 1]?.[bi] ?? 0;
  const hb = def.hitBand1d[bi]; if (!hb) return 0;
  return (die >= hb[0] && die <= hb[1]) ? def.fixedDamage[bi] : 0;
}

// Feedback damage (E4.431 photon, E3.54 disruptor): a point-blank overloaded bolt that HITS scores damage on
// the FIRING ship's facing shield. A miss produces no feedback (D6.1264).
export function feedbackFor(def, trueRange, die, mode, hit) {
  const ov = (mode === true || mode === 'overload') && def.overload;
  if (!ov || !hit) return 0;
  return trueRange <= (def.overload.feedbackRange ?? -1) ? (def.overload.feedback || 0) : 0;
}
"""

def _js_val(v, indent=0):
    """Serialize to JS keeping scalar arrays and small objects inline (readable data file)."""
    pad = "  " * indent
    if isinstance(v, dict):
        if len(v) <= 3 and all(not isinstance(x, (dict, list)) for x in v.values()):
            return "{" + ", ".join(f"{json.dumps(k)}: {json.dumps(x)}" for k, x in v.items()) + "}"
        items = [f"{pad}  {json.dumps(k)}: {_js_val(x, indent + 1)}" for k, x in v.items()]
        return "{\n" + ",\n".join(items) + f"\n{pad}}}"
    if isinstance(v, list):
        if all(not isinstance(x, (dict, list)) for x in v):
            return "[" + ", ".join(json.dumps(x) for x in v) + "]"
        items = [f"{pad}  {_js_val(x, indent + 1)}" for x in v]
        return "[\n" + ",\n".join(items) + f"\n{pad}]"
    return json.dumps(v)

def write_weapon_charts(weapons):
    """Rewrite viewer/weapon-charts.js from edited chart data (functional game-mechanics data)."""
    header = ("// Direct-fire weapon catalog for the standard races (v0, standard loads).\n"
              "// Functional game-mechanics data transcribed from owned material (phaser Type I/II/III\n"
              "// grids from the SSDs; disruptor E3.4 + photon E4.12 from the rulebook). Editable via\n"
              "// viewer/weapons.html against the scanned source tables.\n\n")
    js = header + "export const WEAPONS = " + _js_val(weapons) + ";\n" + WEAPON_CHARTS_FUNCS
    with open(os.path.join(ROOT, "viewer", "weapon-charts.js"), "w") as f:
        f.write(js)
    return len(js)

# ---------- shared battle state: per-ship optimistic locking + fog-of-war plan filtering ----------
_BATTLE_LOCK = threading.Lock()
def _battle_path(): return os.path.join(ROOT, "data", "_battle.json")
def _load_battle():
    p = _battle_path()
    if os.path.exists(p):
        try: return json.load(open(p))
        except Exception: return {}
    return {}

def _fleet_for_code(data, code):
    code = (code or "").strip().upper()
    if not code: return None
    for side in ("friendly", "enemy"):
        if (((data.get("fleets", {}) or {}).get(side) or {}).get("code", "") or "").upper() == code:
            return side
    return None

def battle_view(data, my_fleet):
    """What a client may see: no commander codes; fire plans filtered to the commander's own fleet."""
    fleets = {s: {"name": ((data.get("fleets", {}) or {}).get(s) or {}).get("name", "")} for s in ("friendly", "enemy")}
    plans = {}
    if my_fleet: plans[my_fleet] = (data.get("plans", {}) or {}).get(my_fleet, {"groups": []})
    my_ships = {s["id"] for s in data.get("ships", []) if s.get("side") == my_fleet}
    eaf = {sid: col for sid, col in (data.get("eaf", {}) or {}).items() if sid in my_ships}   # energy allocation fog of war
    return {"rev": data.get("rev", 0), "turn": data.get("turn", 1), "impulse": data.get("impulse", 0),
            "phase": data.get("phase", "energy"), "fleets": fleets, "myFleet": my_fleet, "plans": plans,
            "eaf": eaf, "ships": data.get("ships", []),
            "committed": data.get("committed", {}), "lastFire": data.get("lastFire"),
            "seed": data.get("seed", 0), "rngCursor": data.get("rngCursor", 0), "seekers": data.get("seekers", []), "tractors": data.get("tractors", []), "terrain": data.get("terrain"), "settings": data.get("settings")}

def merge_plan(current, posted, touched):
    """Per-ship merge: touched ships take their fire assignments from `posted`; other ships keep `current`."""
    touched = set(touched)
    groups = {}
    for g in (current or {}).get("groups", []):
        groups[g["id"]] = {"id": g["id"], "color": g.get("color"), "targetShipId": g.get("targetShipId"),
                           "members": [m for m in g.get("members", []) if m.get("shipId") not in touched]}
    for pg in (posted or {}).get("groups", []):
        tmem = [m for m in pg.get("members", []) if m.get("shipId") in touched]
        g = groups.get(pg["id"])
        if g is None:
            if not tmem: continue
            g = {"id": pg["id"], "color": pg.get("color"), "targetShipId": pg.get("targetShipId"), "members": []}
            groups[pg["id"]] = g
        if tmem:
            g["targetShipId"] = pg.get("targetShipId"); g["color"] = pg.get("color", g.get("color"))
            g["members"] = g["members"] + tmem
    return {"groups": [g for g in groups.values() if g.get("members")]}

def apply_battle_post(payload):
    """Atomic read-check-write. Reject if any affected ship changed since the client read it (first write wins)."""
    with _BATTLE_LOCK:
        cur = _load_battle()
        kind = payload.get("kind", "edit")
        if kind == "new" or not cur.get("ships"):                       # creator: accept full state, seed ship revs
            data = {k: v for k, v in payload.items() if k not in ("kind", "code")}
            for s in data.get("ships", []): s["rev"] = 0
            data["rev"] = 1
            data["phase"] = data.get("phase", "energy")                 # a new battle opens in energy allocation
            data.setdefault("rngCursor", 0)                             # shared dice cursor starts at 0
            data["seed"] = int(data.get("seed") or 0) or (int.from_bytes(os.urandom(4), "big") & 0x7fffffff) or 1   # authoritative shared dice seed
            with open(_battle_path(), "w") as f: json.dump(data, f, indent=1)
            return 200, {"ok": True, "rev": 1, "seed": data["seed"], "ships": {s["id"]: 0 for s in data.get("ships", [])}}
        my = _fleet_for_code(cur, payload.get("code", ""))
        if my is None: return 403, {"error": "invalid commander code"}
        if "rngCursor" in payload: cur["rngCursor"] = max(cur.get("rngCursor", 0), int(payload.get("rngCursor") or 0))   # shared dice cursor: monotonic, never rewind
        if kind == "commit":                                            # lock in this fleet's firing plan for the impulse
            committed = cur.get("committed", {}) or {}
            was_all = all(committed.get(s) for s in ("friendly", "enemy"))
            committed[my] = True
            plans = cur.get("plans", {}) or {}
            if payload.get("plan") is not None: plans[my] = payload["plan"]
            cur["committed"] = committed; cur["plans"] = plans; cur["rev"] = cur.get("rev", 0) + 1
            with open(_battle_path(), "w") as f: json.dump(cur, f, indent=1)
            now_all = all(committed.get(s) for s in ("friendly", "enemy"))
            resp = {"ok": True, "rev": cur["rev"], "allCommitted": now_all, "committed": committed}
            if now_all and not was_all:                                 # this commit completed the set → resolve here
                resp["resolve"] = True
                resp["plans"] = {s: (plans.get(s) or {"groups": []}) for s in ("friendly", "enemy")}
                resp["ships"] = cur.get("ships", [])
            return 200, resp
        if kind == "fireResult":                                        # authoritative simultaneous resolution (single writer)
            ships = payload.get("ships", cur.get("ships", []))
            for s in ships: s["rev"] = s.get("rev", 0) + 1
            cur["ships"] = ships; cur["committed"] = {}; cur["lastFire"] = payload.get("lastFire"); cur["rev"] = cur.get("rev", 0) + 1
            with open(_battle_path(), "w") as f: json.dump(cur, f, indent=1)
            return 200, {"ok": True, "rev": cur["rev"], "ships": {s["id"]: s["rev"] for s in ships}}
        if kind == "lockEnergy":                                         # seal this fleet's energy allocation for the turn
            committed = cur.get("committed", {}) or {}
            was_all = all(committed.get(s) for s in ("friendly", "enemy"))
            committed[my] = True
            eaf = cur.get("eaf", {}) or {}
            eaf.update(payload.get("eaf", {}))
            cur["committed"] = committed; cur["eaf"] = eaf; cur["rev"] = cur.get("rev", 0) + 1
            with open(_battle_path(), "w") as f: json.dump(cur, f, indent=1)
            resp = {"ok": True, "rev": cur["rev"], "committed": committed}
            if all(committed.get(s) for s in ("friendly", "enemy")) and not was_all:   # last lock → resolver folds
                resp["resolve"] = True; resp["eaf"] = eaf
            return 200, resp
        if kind == "energyResolved":                                    # authoritative fold (single resolver) → impulse phase
            ships = payload.get("ships", cur.get("ships", []))
            for s in ships: s["rev"] = s.get("rev", 0) + 1
            cur["ships"] = ships; cur["phase"] = payload.get("phase", "impulse")
            cur["committed"] = {}; cur["rev"] = cur.get("rev", 0) + 1
            with open(_battle_path(), "w") as f: json.dump(cur, f, indent=1)
            return 200, {"ok": True, "rev": cur["rev"], "ships": {s["id"]: s["rev"] for s in ships}}
        curships = {s["id"]: s for s in cur.get("ships", [])}
        posted = payload.get("ships", [])
        if kind != "step":                                              # check every affected ship's version
            conflict = [ps["id"] for ps in posted if ps["id"] in curships and ps.get("rev", 0) != curships[ps["id"]].get("rev", 0)]
            if conflict: return 409, {"conflict": True, "ships": conflict, "view": battle_view(cur, my)}
        touched, newrevs = [], {}
        for ps in posted:
            sid = ps["id"]; c = curships.get(sid); nr = (c.get("rev", 0) if c else 0) + 1
            touched.append(sid); newrevs[sid] = nr
            if c and kind != "step" and ps.get("side") != my:
                c["status"] = ps.get("status", c.get("status")); c["rev"] = nr   # opponent ship: fire damage only
            else:
                ps["rev"] = nr; curships[sid] = ps                               # mine / step / new: full update
        plans = cur.get("plans", {}) or {}
        if kind != "step":
            plans[my] = merge_plan(plans.get(my, {"groups": []}), payload.get("plan", {"groups": []}), touched)
        result = {"rev": cur.get("rev", 0) + 1,
                  "turn": payload.get("turn", cur.get("turn", 1)) if kind == "step" else cur.get("turn", 1),
                  "impulse": payload.get("impulse", cur.get("impulse", 0)) if kind == "step" else cur.get("impulse", 0),
                  "fleets": cur.get("fleets", {}), "plans": plans, "ships": list(curships.values()),
                  "committed": {} if kind == "step" else cur.get("committed", {}),   # new impulse clears commits
                  "phase": payload.get("phase", cur.get("phase", "impulse")),        # step may wrap turn → 'energy'
                  "eaf": cur.get("eaf", {}), "lastFire": cur.get("lastFire"),
                  "seed": cur.get("seed", 0), "rngCursor": cur.get("rngCursor", 0),
                  "seekers": payload.get("seekers", cur.get("seekers", [])),
                  "tractors": payload.get("tractors", cur.get("tractors", [])),
                  "terrain": payload.get("terrain", cur.get("terrain")),
                  "settings": payload.get("settings", cur.get("settings"))}   # carry the shared dice + seeking weapons + tractors + terrain + settings through edit/step
        with open(_battle_path(), "w") as f: json.dump(result, f, indent=1)
        return 200, {"ok": True, "rev": result["rev"], "ships": newrevs}

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def _json(self, code, obj):
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps(obj).encode())
    def do_GET(self):
        if self.path.startswith("/api/"):
            seg = self.path[5:].split("?")[0].rstrip("/").split("/")
            api, ship = seg[0], (seg[-1] if len(seg) > 1 else "")
            ship = ship.upper()
            try:
                if api == "labels":
                    return self._json(200, box_labels(ship))
                if api == "find":
                    exists = os.path.isfile(os.path.join(ROOT, "data", ship, "detection.json"))
                    return self._json(200, {"ship": ship, "exists": exists})
                if api == "scanstart":
                    start_scan(ship)
                    return self._json(200, {"ship": ship, "started": True})
                if api == "scanstatus":
                    return self._json(200, SCAN_JOBS.get(ship, {"done": True, "error": "no scan running"}))
                if api == "ships":
                    d = os.path.join(ROOT, "data")
                    ships = sorted(n for n in os.listdir(d)
                                   if os.path.isfile(os.path.join(d, n, "detection.json")))
                    verified = [n for n in ships if os.path.isfile(os.path.join(d, n, "verified.json"))]
                    return self._json(200, {"ships": ships, "verified": verified})
                if api == "battle":
                    data = _load_battle()
                    if not data.get("ships"): return self._json(200, {"error": "no saved battle"})
                    q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                    my = _fleet_for_code(data, q.get("code", [""])[0])
                    return self._json(200, battle_view(data, my))
                if api == "eaf-layouts":   # list the saved EAF layouts (shared across ships of a race)
                    d = os.path.join(ROOT, "data", "eaf-layouts"); os.makedirs(d, exist_ok=True)
                    out = []
                    for n in sorted(os.listdir(d)):
                        if n.endswith(".json"):
                            try: out.append(json.load(open(os.path.join(d, n))))
                            except Exception: pass
                    return self._json(200, {"layouts": out})
                if api == "eaf-layout":   # one layout by id (path segment is lower-cased for layout ids)
                    lid = seg[-1].lower()
                    p = os.path.join(ROOT, "data", "eaf-layouts", lid + ".json")
                    if not os.path.isfile(p): return self._json(200, {"error": "no such layout"})
                    return self._json(200, json.load(open(p)))
            except Exception as e:
                return self._json(500, {"error": str(e)})
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
            if self.path.startswith("/api/eaf-layout/"):   # save a shared EAF layout (drag-authored in verify.html)
                lid = self.path.rsplit("/", 1)[-1].lower()
                d = os.path.join(ROOT, "data", "eaf-layouts"); os.makedirs(d, exist_ok=True)
                json.dump(payload, open(os.path.join(d, lid + ".json"), "w"), indent=2)   # pretty-printed — keeps the committed layout diffs reviewable
                return self._json(200, {"ok": True, "id": lid})
            if self.path.startswith("/api/counter-art/"):   # upload custom ship-counter art (user-provided image, git-ignored) into data/<ship>/
                import base64, re as _re
                name = _re.sub(r"[^A-Za-z0-9_-]", "", self.path.rsplit("/", 1)[-1])
                ship_dir = os.path.join(ROOT, "data", name)
                if not name or not os.path.isdir(ship_dir): return self._json(404, {"error": "unknown ship"})
                data = payload.get("dataUrl", ""); data = data.split(",", 1)[1] if "," in data else data
                open(os.path.join(ship_dir, "counter.png"), "wb").write(base64.b64decode(data))
                return self._json(200, {"ok": True, "file": "counter.png"})
            if self.path.startswith("/api/eaf-art/"):   # upload a new EAF form image (for a new race) into viewer/assets
                import base64, re as _re
                name = _re.sub(r"[^A-Za-z0-9_-]", "", self.path.rsplit("/", 1)[-1])
                data = payload.get("dataUrl", ""); data = data.split(",", 1)[1] if "," in data else data
                open(os.path.join(ROOT, "viewer", "assets", name + ".png"), "wb").write(base64.b64decode(data))
                return self._json(200, {"ok": True, "name": name})
            if self.path.startswith("/api/audit/"): return self._json(200, audit(ship, payload))
            if self.path.startswith("/api/rescan/"): return self._json(200, rescan(ship, payload.get("region", {})))
            if self.path == "/api/weapon-charts":
                return self._json(200, {"ok": True, "bytes": write_weapon_charts(payload)})
            if self.path == "/api/battle":
                status, body = apply_battle_post(payload)
                return self._json(status, body)
            if self.path == "/api/clear-battles":
                if str(payload.get("code", "")) != ADMIN_CODE:
                    return self._json(403, {"error": "invalid admin code"})
                with _BATTLE_LOCK:
                    p = _battle_path(); removed = os.path.exists(p)
                    if removed: os.remove(p)
                return self._json(200, {"ok": True, "cleared": 1 if removed else 0})
        except Exception as e:
            return self._json(500, {"error": str(e)})
        return self._json(404, {"error": "unknown endpoint"})
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()
    def log_message(self, *a): pass

if __name__ == "__main__":
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), H) as httpd:   # concurrent commanders; battle writes guarded by _BATTLE_LOCK
        print(f"SSD pipeline serving {ROOT} on http://127.0.0.1:{PORT}")
        httpd.serve_forever()
