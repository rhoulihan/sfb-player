import subprocess, tempfile, os, sys
from PIL import Image
pdf=sys.argv[1]; lo=int(sys.argv[2]); hi=int(sys.argv[3])
for p in range(lo,hi+1):
    with tempfile.TemporaryDirectory() as td:
        pref=os.path.join(td,"p")
        subprocess.run(["pdftoppm","-png","-r","100","-f",str(p),"-l",str(p),pdf,pref],capture_output=True)
        f=[x for x in os.listdir(td) if x.endswith(".png")]
        if not f: continue
        im=Image.open(os.path.join(td,f[0])).convert("RGB")
        W,H=im.size
        strip=im.crop((0,0,W,int(H*0.06)))
        strip.save(os.path.join(td,"s.png"))
        r=subprocess.run(["tesseract",os.path.join(td,"s.png"),"stdout"],capture_output=True,text=True)
        t=" ".join(r.stdout.split())
        print(f"p{p}: {t[:90]}")
