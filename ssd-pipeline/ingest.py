#!/usr/bin/env python3
"""SSD Pipeline — Stage 1 (Scan + orientation) & Stage 2 (CV detection + OCR).

Renders a ship's SSD page from an owned SFB PDF, normalizes orientation for landscape
display, auto-detects the color-coded boxes (systems/weapons/power/shields/tracks),
groups them into systems, OCRs cluster labels and weapon firing-arc codes, and writes a
structured detection.json + the normalized page image for the viewer / B4 verify pass.

Usage:
  python3 ingest.py --pdf <path> --page N --ship FED-CA --out data [--dpi 200]
"""
import os, sys, json, argparse, subprocess, tempfile, re
import numpy as np
from PIL import Image
from scipy import ndimage

ARC_CODES = {"FA","FH","FX","RF","LF","RH","LH","RA","L","R","F","360","AB","LR","RR"}
COLOR_FAMILY = {   # colorClass -> likely system family (a hint; human confirms)
    "purple":"shield", "blue":"power/warp/impulse", "cyan":"power/special",
    "pink":"weapon", "red":"weapon", "yellow":"system", "green":"rating-track",
    "orange":"control", "beige":"hull",
}

# ---------------- Stage 1: render + orientation ----------------
def render_page(pdf, page, dpi, out_png):
    with tempfile.TemporaryDirectory() as td:
        pref = os.path.join(td, "p")
        subprocess.run(["pdftoppm","-png","-r",str(dpi),"-f",str(page),"-l",str(page),pdf,pref],
                       check=True, capture_output=True)
        files = [f for f in os.listdir(td) if f.endswith(".png")]
        if not files: raise RuntimeError("pdftoppm produced no image")
        Image.open(os.path.join(td, files[0])).convert("RGB").save(out_png)
    return out_png

def ocr_tsv(img_path):
    """Return list of words: {text, conf, x, y, w, h} via tesseract TSV."""
    try:
        r = subprocess.run(["tesseract", img_path, "stdout", "tsv"],
                           capture_output=True, text=True, timeout=120)
    except Exception:
        return []
    words=[]
    for line in r.stdout.splitlines()[1:]:
        c=line.split("\t")
        if len(c)<12: continue
        try:
            conf=float(c[10]); txt=c[11].strip()
        except: continue
        if conf<40 or not txt: continue
        words.append({"text":txt,"conf":round(conf,1),
                      "x":int(c[6]),"y":int(c[7]),"w":int(c[8]),"h":int(c[9])})
    return words

def osd_rotate(img_path):
    """Tesseract OSD: degrees to rotate (CW) to make text upright, + confidence. Reliable."""
    try:
        r=subprocess.run(["tesseract",img_path,"stdout","--psm","0"],capture_output=True,text=True,timeout=60)
        m=re.search(r"Rotate:\s*(\d+)",r.stdout); c=re.search(r"Orientation confidence:\s*([\d.]+)",r.stdout)
        return (int(m.group(1))%360 if m else None, float(c.group(1)) if c else 0.0)
    except Exception:
        return (None,0.0)

def _ocr_score(im,rot):
    with tempfile.NamedTemporaryFile(suffix=".png",delete=False) as tf:
        im.rotate(-rot,expand=True).save(tf.name); w=ocr_tsv(tf.name)
    os.unlink(tf.name)
    alpha=[x for x in w if re.search("[A-Za-z]",x["text"]) and len(x["text"])>=2]
    return len(alpha)*(sum(x["conf"] for x in alpha)/max(1,len(alpha)))

def detect_orientation(img_path):
    """Primary: Tesseract OSD (robust). Fallback: OCR-score with a landscape bias, since
    SFB SSDs are landscape-native. Returns (rotationApplied, orientationClass, info)."""
    im=Image.open(img_path).convert("RGB")
    orot,oconf=osd_rotate(img_path)
    if orot is not None and oconf>=1.0:
        best=orot; method=f"osd(conf={oconf})"
    else:
        s={r:_ocr_score(im,r) for r in (0,90,180,270)}
        land=max((90,270),key=lambda r:s[r]); port=max((0,180),key=lambda r:s[r])
        best=land if s[land]>=0.6*s[port] else port
        method="ocr-heuristic(landscape-biased)"
    corrected=im.rotate(-best,expand=True)
    ocls="landscape" if corrected.width>=corrected.height else "portrait"
    return best,ocls,{"method":method,"osdRotate":orot,"osdConf":round(oconf,2)}

# ---------------- Stage 2: CV box detection ----------------
def detect_boxes(im):
    rgb=np.asarray(im).astype(np.int32); H,W=rgb.shape[:2]
    mx=rgb.max(2); mn=rgb.min(2); chroma=mx-mn
    hsv=np.asarray(im.convert("HSV")); hue=hsv[...,0].astype(np.int32)
    boxes=[]
    def collect(mask, tag):
        lab,n=ndimage.label(mask)
        if n==0: return
        objs=ndimage.find_objects(lab)
        areas=ndimage.sum(np.ones_like(lab),lab,range(1,n+1))
        for i,sl in enumerate(objs):
            if sl is None: continue
            a=areas[i]; h=sl[0].stop-sl[0].start; w=sl[1].stop-sl[1].start
            if a<160 or w<8 or h<8 or w>90 or h>90: continue
            fill=a/(h*w+1e-6)
            if not (0.4<fill<1.06 and 0.33<w/h<3.0): continue
            sub=lab[sl]==i+1
            rr=int(np.median(rgb[sl][...,0][sub])); gg=int(np.median(rgb[sl][...,1][sub])); bb=int(np.median(rgb[sl][...,2][sub]))
            hh=int(np.median(hue[sl][sub]))
            boxes.append({"x":sl[1].start,"y":sl[0].start,"w":w,"h":h,
                          "cc":classify(rr,gg,bb,hh,tag),"src":tag})
    # single chroma pass (saturated + pastel color boxes, incl. lavender shields & tan hull);
    # the black inter-box borders keep adjacent boxes separate. RGB classify() sorts the family.
    collect((chroma>16)&(mx>90), "chroma")
    # de-duplicate overlapping boxes from the two passes (keep first)
    boxes=dedupe(boxes)
    for idx,b in enumerate(boxes):
        b["id"]=f"box{idx+1}"
        b["bbox"]=[round(b["x"]/W,4),round(b["y"]/H,4),round(b["w"]/W,4),round(b["h"]/H,4)]
        b["family"]=COLOR_FAMILY.get(b["cc"],"?")
    return boxes,(W,H)

def hue_class(h, tag):
    if tag=="beige": return "beige"
    h%=256
    if h<10 or h>=232: return "red"
    if h<26: return "orange"
    if h<54: return "yellow"
    if h<100: return "green"
    if h<140: return "cyan"
    if h<182: return "blue"
    return "purple"

def classify(r,g,b,hue,tag):
    """RGB-aware class: separate lavender shields (purple) and tan hull (beige) from blue/yellow."""
    mx,mn=max(r,g,b),min(r,g,b); chroma=mx-mn
    # lavender/shield: light, R & B high & near-equal, B not below R (excludes pink), G clearly lowest
    if r>135 and b>135 and abs(r-b)<45 and b>=r-6 and g<=min(r,b)-6 and chroma<120:
        return "purple"
    # tan/cream hull: light, warm R>=G>=B, but B still high (unlike deep-blue-poor yellow)
    if r>=g>=b and mx>168 and b>118 and 10<=(r-b)<=85:
        return "beige"
    if tag=="beige": return "beige"
    return hue_class(hue, tag)

def dedupe(boxes):
    out=[]
    for b in boxes:
        if any(abs(b["x"]-o["x"])<6 and abs(b["y"]-o["y"])<6 for o in out): continue
        out.append(b)
    return out

# ---------------- grouping + labels/arcs ----------------
def group_boxes(boxes):
    """Cluster boxes into system groups by same color-family + spatial proximity (grid gap)."""
    groups=[]; used=[False]*len(boxes)
    for i,b in enumerate(boxes):
        if used[i]: continue
        cluster=[i]; used[i]=True; changed=True
        while changed:
            changed=False
            for j,c in enumerate(boxes):
                if used[j]: continue
                if c["cc"]!=b["cc"]: continue
                if any(near(boxes[k],c) for k in cluster):
                    cluster.append(j); used[j]=True; changed=True
        xs=[boxes[k]["x"] for k in cluster]; ys=[boxes[k]["y"] for k in cluster]
        xe=[boxes[k]["x"]+boxes[k]["w"] for k in cluster]; ye=[boxes[k]["y"]+boxes[k]["h"] for k in cluster]
        groups.append({"cc":b["cc"],"family":b["family"],"count":len(cluster),
                       "boxIds":[boxes[k]["id"] for k in cluster],
                       "bounds":{"x":min(xs),"y":min(ys),"w":max(xe)-min(xs),"h":max(ye)-min(ys)}})
    return groups

def near(a,b,gap=10):
    ax0,ay0,ax1,ay1=a["x"],a["y"],a["x"]+a["w"],a["y"]+a["h"]
    bx0,by0,bx1,by1=b["x"],b["y"],b["x"]+b["w"],b["y"]+b["h"]
    return not (bx0>ax1+gap or bx1<ax0-gap or by0>ay1+gap or by1<ay0-gap)

def label_groups(groups, words):
    for g in groups:
        b=g["bounds"]; cx,cy=b["x"]+b["w"]/2,b["y"]+b["h"]/2
        near_words=[]
        for w in words:
            wx,wy=w["x"]+w["w"]/2,w["y"]+w["h"]/2
            d=abs(wx-cx)+abs(wy-cy)
            if wx>b["x"]-90 and wx<b["x"]+b["w"]+90 and wy>b["y"]-70 and wy<b["y"]+b["h"]+70:
                near_words.append((d,w["text"]))
        near_words.sort()
        toks=[t for _,t in near_words[:6]]
        g["ocrLabel"]=" ".join(toks[:3]) if toks else ""
        arcs=[t.upper() for _,t in near_words if t.upper() in ARC_CODES]
        if arcs: g["proposedArc"]=arcs[0]
    return groups

# ---------------- multi-SSD page segmentation ----------------
def ocr_top_text(im, frac=0.14):
    with tempfile.NamedTemporaryFile(suffix=".png",delete=False) as tf:
        im.crop((0,0,im.width,int(im.height*frac))).save(tf.name)
        w=ocr_tsv(tf.name)
    os.unlink(tf.name)
    return " ".join(x["text"] for x in w)

def is_multi_ssd(top_txt):
    return ("&" in top_txt) or (len(re.findall(r"R\d+\.\d+", top_txt))>=2)

def segment_multi_ssd(im, expect=None):
    """Split a page holding >1 SSD at the widest interior low-content band; return the panel
    best matching `expect` (a title token), else the larger panel."""
    g=np.asarray(im.convert("L")); H,W=g.shape; dark=(g<225)
    def widest_gap(density):
        n=len(density); thr=max(density.max()*0.05, density.mean()*0.12); low=density<thr
        best=None; i=0
        while i<n:
            if low[i]:
                j=i
                while j<n and low[j]: j+=1
                if i>n*0.30 and j<n*0.70 and (j-i)>n*0.02 and density[:i].sum()>0 and density[j:].sum()>0:
                    if best is None or (j-i)>best[1]-best[0]: best=(i,j)
                i=j
            else: i+=1
        return best
    for axis,proj in (("h",dark.mean(1)),("v",dark.mean(0))):
        gap=widest_gap(proj)
        if not gap: continue
        mid=(gap[0]+gap[1])//2
        panels=([im.crop((0,0,W,mid)),im.crop((0,mid,W,H))] if axis=="h"
                else [im.crop((0,0,mid,H)),im.crop((mid,0,W,H))])
        if expect:
            best=None; bs=-1
            for p in panels:
                txt=ocr_top_text(p,0.16).upper()
                sc=sum(txt.count(tok) for tok in expect.upper().split())
                if sc>bs: bs=sc; best=p
            return best, f"multi-SSD {axis}-split → panel matching '{expect}'"
        return max(panels,key=lambda p:p.width*p.height), f"multi-SSD {axis}-split → larger panel"
    return im, "single"

# ---------------- main ----------------
def ingest_ship(pdf, page, ship, out="data", dpi=200, expect=None, progress=None):
    """Render + orient + CV-detect one ship's SSD page; write data/<ship>/{image.png,detection.json}.
    `progress(msg, frac)` is called through the run (frac 0..1) so callers can show a progress bar."""
    def prog(m, f):
        if progress: progress(m, f)
    shipdir = os.path.join(out, ship); os.makedirs(shipdir, exist_ok=True)
    raw = os.path.join(shipdir, "raw.png")
    prog("rendering page", 0.15); render_page(pdf, page, dpi, raw)
    prog("detecting orientation", 0.40)
    rot, ocls, oinfo = detect_orientation(raw)
    im = Image.open(raw).convert("RGB").rotate(-rot, expand=True)
    seg_note = "single"
    if is_multi_ssd(ocr_top_text(Image.open(raw).convert("RGB"), 0.06)):
        im, seg_note = segment_multi_ssd(im, expect=expect)
        ocls = "landscape" if im.width >= im.height else "portrait"
    img_path = os.path.join(shipdir, "image.png"); im.save(img_path)
    prog("reading labels (OCR)", 0.60); words = ocr_tsv(img_path)
    prog("detecting control boxes", 0.80); boxes, (W, H) = detect_boxes(im)
    groups = label_groups(group_boxes(boxes), words)
    from collections import Counter
    cc = Counter(b["cc"] for b in boxes)
    weapon_groups = [g for g in groups if g["cc"] in ("pink", "red")]
    det = {"ship": ship, "source": {"pdf": os.path.basename(pdf), "page": page, "dpi": dpi},
           "image": "image.png", "pxWidth": W, "pxHeight": H,
           "rotationApplied": rot, "orientationClass": ocls,
           "orientationInfo": oinfo, "segmentation": seg_note,
           "counts": {"boxes": len(boxes), "groups": len(groups), "weaponGroups": len(weapon_groups),
                      "byColor": dict(cc)},
           "boxes": boxes, "groups": groups, "ocrWords": len(words)}
    with open(os.path.join(shipdir, "detection.json"), "w") as f: json.dump(det, f, indent=1)
    prog("done", 1.0)
    return det


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--pdf",required=True); ap.add_argument("--page",type=int,required=True)
    ap.add_argument("--ship",required=True); ap.add_argument("--out",default="data")
    ap.add_argument("--dpi",type=int,default=200)
    ap.add_argument("--expect",default=None,help="title token(s) to pick the right panel on multi-SSD pages")
    a=ap.parse_args()
    det=ingest_ship(a.pdf,a.page,a.ship,a.out,a.dpi,a.expect,lambda m,f:print(f"[{a.ship}] {m} ({int(f*100)}%)"))
    c=det["counts"]
    print(f"[{a.ship}] boxes={c['boxes']} groups={c['groups']} weaponGroups={c['weaponGroups']} colors={c['byColor']}")
    print(f"[{a.ship}] wrote {a.out}/{a.ship}/detection.json + image.png")

if __name__=="__main__":
    main()
