#!/usr/bin/env python3
"""First verification pass for the Federation CA (R2.4): assign system families to the 54 detected
groups and firing arcs to weapons (read off the SSD), flag genuinely-ambiguous cases, write
verified.json, and run the consistency audit."""
import json, urllib.request

det = json.load(open('data/FED-CA/detection.json'))
gs = sorted(det['groups'], key=lambda g: (g['cc'], -g['count']))
def L(g): return (g.get('ocrLabel', '') or '').upper()
def at(g): b = g['bounds']; return b['x'], b['y']

boxes = {}; flags = []; assigned = 0
def setg(g, fam, typ, arc="", verified=True, flag=None):
    global assigned
    for bid in g['boxIds']:
        rec = {"family": fam, "type": typ, "arc": arc, "verified": verified}
        if flag: rec["flag"] = flag
        boxes[bid] = rec
    assigned += 1
    if flag: flags.append((typ or fam, g['count'], flag))

for g in gs:
    cc = g['cc']; lab = L(g); x, y = at(g); n = g['count']
    if cc == 'purple':
        setg(g, "shield", lab if 'SHIELD' in lab else "shield")
    elif cc == 'beige':
        setg(g, "hull", "hull")
    elif cc == 'red':  # weapons — arcs read directly from the SSD
        if n == 4 and 1550 < x < 1700 and y < 600:      setg(g, "weapon", "Photon torpedo", "FA")
        elif 'PH-1' in lab and 'RH' in lab:             setg(g, "weapon", "Phaser-1", "RH")
        elif y > 1150 or 'PH-3' in lab:                 setg(g, "weapon", "Phaser-3", "360")
        elif 'REAR' in lab and x < 1000:                setg(g, "other", "(photon-table text?)", "", False,
                                                             "likely FALSE POSITIVE — photon torpedo TABLE cells, not boxes")
        elif y < 640:                                   setg(g, "weapon", "Phaser-1", "FH")
        elif x < 1600:                                  setg(g, "weapon", "Phaser-1", "LF", True,
                                                             "mixed-arc group: #3=LF, #4=L — needs PER-BOX split")
        else:                                           setg(g, "weapon", "Phaser-1", "RF", True,
                                                             "mixed-arc group: #5=RF, #6=R — needs PER-BOX split")
    elif cc == 'blue':
        if n >= 12:                                     setg(g, "power/warp/impulse", "Warp engine")
        elif 'APR' in lab:                              setg(g, "power/warp/impulse", "APR")
        elif 'BRIDGE' in lab:                           setg(g, "control", "Bridge")
        else:                                           setg(g, "power/warp/impulse", "Impulse")
    elif cc == 'green':
        if x > 1200 and any(k in lab for k in ('SENSOR', 'SCANNER', 'DAM', 'EX')):
            setg(g, "rating-track", "Sensor/Scanner/DamCon/Excess")
        elif 'PROBE' in lab:                            setg(g, "ammo-track", "Probes")
        elif any(k in lab for k in ('BOMB', 'TRANSPORTER')): setg(g, "ammo-track", "Transporter bombs")
        elif any(k in lab for k in ('DRONE', 'ANTI', 'RACK', 'RELOAD')): setg(g, "ammo-track", "Drone/Anti-drone")
        elif 'PTT' in lab or 'MARKED' in lab:           setg(g, "ammo-track", "Shuttle hit-points (adv)")
        elif any(k in lab for k in ('CREW', 'UNITS', 'PARTIES', 'BOARDING')): setg(g, "crew", "Crew/Boarding")
        else:                                           setg(g, "crew", "track", flag="green track — confirm crew vs rating vs ammo")
    elif cc == 'yellow':
        if 'LAB' in lab:                                setg(g, "system", "Lab")
        elif 'AUX' in lab:                              setg(g, "control", "Auxiliary control")
        elif 'SHUTTLE' in lab or 'DRONE' in lab:        setg(g, "system", "Shuttle bay / Drone rack")
        elif 'PRB' in lab or 'PROBE' in lab:            setg(g, "system", "Probe")
        elif any(k in lab for k in ('TRAN', 'TRAC')):   setg(g, "system", "Transporter/Tractor")
        else:                                           setg(g, "system", "system", flag="yellow system — confirm exact type")
    elif cc == 'cyan':                                  setg(g, "ammo-track", "Drone rack", flag="cyan — confirm")

for rec in boxes.values():
    if rec.get("flag"): rec["verified"] = False

V = {"ship": "FED-CA", "boxes": boxes, "pass": "claude-first-pass"}
open('data/FED-CA/verified.json', 'w').write(json.dumps(V, indent=0))

def post(url, obj):
    r = urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(obj).encode(),
                                                      headers={'Content-Type': 'application/json'}))
    return json.load(r)
rep = post('http://127.0.0.1:8741/api/audit/FED-CA', V)
print("groups assigned: %d/%d   boxes: %d" % (assigned, len(gs), len(boxes)))
print("audit: clean=%s  verified=%d/%d" % (rep['clean'], rep['verified'], rep['totalBoxes']))
print("audit issues:", ["%s:%d" % (i['code'], i['n']) for i in rep['issues']])
print("\nFLAGGED for your review (%d groups):" % len(flags))
for t, c, f in flags:
    print("  - %s (x%d): %s" % (t, c, f))
