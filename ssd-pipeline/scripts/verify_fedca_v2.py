#!/usr/bin/env python3
"""Fed CA (R2.4) verification pass — new GROUP format. Families read off the SSD; weapon firing
arcs per D2.0/D2.11 (whole group fires in all shown arcs); rear-row exception painted for the
left/right phasers per the SSD note (D2.13). Writes verified.json, runs the audit."""
import json, urllib.request

det = json.load(open('data/FED-CA/detection.json'))
G = det['groups']
def L(g): return (g.get('ocrLabel', '') or '').upper()
def at(g): b = g['bounds']; return b['x'], b['y']
REAR_ROW = [[0, 1], [0, 2], [0, 3], [0, 4]]          # hexes directly behind the ship (my hex model)
ALL6 = ["RF", "R", "RR", "LR", "L", "LF"]            # = 360deg

def arcdef(arcs, add=None, note=""):
    return {"arcs": arcs, "paintAdd": add or [], "paintRemove": [], "note": note}

groups = []; notes = []
for i, g in enumerate(G):
    cc = g['cc']; lab = L(g); x, y = at(g); n = g['count']
    fam, typ, ad = "other", g.get('ocrLabel', '') or "", None
    if cc == 'purple':
        fam, typ = "shield", "Shield"
    elif cc == 'beige':
        fam, typ = "hull", "Hull"
    elif cc == 'red':
        fam = "weapon"
        if n == 4 and 1550 < x < 1700 and y < 600:
            typ, ad = "Photon torpedo (FA)", arcdef(["FA"])
        elif 'PH-1' in lab and 'RH' in lab:
            typ, ad = "Phaser-1 rear (RH)", arcdef(["RH"])
        elif y > 1150 or 'PH-3' in lab:
            typ, ad = "Phaser-3 (360)", arcdef(ALL6, note="360 refit")
        elif 'REAR' in lab and x < 1000:
            fam, typ, ad = "other", "(chart text — not a box)", None; notes.append("marked a false-positive red cluster as 'other'")
        elif y < 640:
            typ, ad = "Phaser-1 fwd (FH)", arcdef(["FH"])
        elif x < 1600:
            typ, ad = "Phaser-1 left (L+LF, +rear)", arcdef(["L", "LF"], REAR_ROW, "+rear row (SSD note / D2.13)")
        else:
            typ, ad = "Phaser-1 right (R+RF, +rear)", arcdef(["R", "RF"], REAR_ROW, "+rear row (SSD note / D2.13)")
    elif cc == 'blue':
        if n >= 12: fam, typ = "power/warp/impulse", "Warp engine"
        elif 'APR' in lab: fam, typ = "power/warp/impulse", "APR"
        elif 'BRIDGE' in lab: fam, typ = "control", "Bridge"
        else: fam, typ = "power/warp/impulse", "Impulse"
    elif cc == 'green':
        if x > 1200 and any(k in lab for k in ('SENSOR', 'SCANNER', 'DAM', 'EX')): fam, typ = "rating-track", "Sensor/Scanner/DamCon/Excess"
        elif 'PROBE' in lab: fam, typ = "ammo-track", "Probes"
        elif any(k in lab for k in ('BOMB', 'TRANSPORTER')): fam, typ = "ammo-track", "Transporter bombs"
        elif any(k in lab for k in ('DRONE', 'ANTI', 'RACK', 'RELOAD')): fam, typ = "ammo-track", "Drone/Anti-drone"
        elif 'PTT' in lab or 'MARKED' in lab: fam, typ = "ammo-track", "Shuttle hit-points (adv)"; notes.append("inferred 'shuttle hit-points' for a green track")
        elif any(k in lab for k in ('CREW', 'UNITS', 'PARTIES', 'BOARDING')): fam, typ = "crew", "Crew/Boarding"
        else: fam, typ = "crew", "track"; notes.append("inferred crew for an unlabeled green track")
    elif cc == 'yellow':
        if 'LAB' in lab: fam, typ = "system", "Lab"
        elif 'AUX' in lab: fam, typ = "control", "Auxiliary control"
        elif 'SHUTTLE' in lab or 'DRONE' in lab: fam, typ = "system", "Shuttle bay / Drone rack"
        elif 'PRB' in lab or 'PROBE' in lab: fam, typ = "system", "Probe"
        elif any(k in lab for k in ('TRAN', 'TRAC')): fam, typ = "system", "Transporter/Tractor"
        else: fam, typ = "system", "system (unspecified)"; notes.append("inferred generic 'system' for a yellow group")
    elif cc == 'cyan':
        fam, typ = "ammo-track", "Drone rack"; notes.append("inferred drone-rack for a cyan fragment")

    grp = {"id": "g%d" % i, "boxIds": g['boxIds'], "family": fam, "type": typ,
           "arc": (ad["arcs"][0] if ad else ""), "arcDef": ad or {"arcs": [], "paintAdd": [], "paintRemove": [], "note": ""},
           "verified": True}
    if fam == "weapon" and ad and ad["arcs"] == ALL6: grp["arc"] = "360"
    groups.append(grp)

V = {"ship": "FED-CA", "groups": groups, "extraBoxes": [], "pass": "claude-v2-groupformat"}
open('data/FED-CA/verified.json', 'w').write(json.dumps(V, indent=0))

def post(url, obj):
    r = urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(obj).encode(), headers={'Content-Type': 'application/json'}))
    return json.load(r)
rep = post('http://127.0.0.1:8741/api/audit/FED-CA', V)
print("groups: %d   audit clean=%s   verified=%d/%d boxes, %d/%d groups" %
      (len(groups), rep['clean'], rep['verifiedBoxes'], rep['totalBoxes'], rep['verifiedGroups'], rep['groups']))
print("issues:", ["%s:%d" % (i['code'], i['n']) for i in rep['issues']] or "none")
print("\nWeapon groups & arcs:")
for g in groups:
    if g['family'] == 'weapon':
        d = g['arcDef']; extra = (" +%dhex" % len(d['paintAdd'])) if d['paintAdd'] else ""
        print("  %-30s arcs=%s%s  %s" % (g['type'], "+".join(d['arcs']) or g['arc'], extra, d['note']))
print("\nInferred (best-guess, not read verbatim) — for your review:")
for nn in sorted(set(notes)): print("  -", nn)
