"""Build docs/demo.gif + docs/screens/*.png from FAKE demo data (never real victims).

    pip install playwright pillow && python -m playwright install chromium
    python docs/make_demo.py

It copies the dashboard (preview/index.html, core.js, app.js) to a temp folder, writes
made-up sites (names end in -demo.in, phone numbers start with +91 55555 which is not a
real Indian mobile range), mock before/after screenshots, serves it on a local port with
a fake /api, and records the main pages with Playwright.
"""
import json, os, shutil, sys, tempfile, threading, urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs")
TODAY = "2026-11-23"
PORT = 8797
TAILWIND_MIRROR = "https://cdn.jsdelivr.net/npm/tailwindcss-cdn@3.4.10/tailwindcss.js"   # same Play CDN build, used if cdn.tailwindcss.com is unreachable

# ---------------- fake sites ----------------
# (domain, business, city, platform, brand, verdict kind)
SITES = [
    ("sharmadental-demo.in", "Sharma Dental Care", "Chennai", "WordPress", "LUCKY777", "confirmed"),
    ("greenleafschool-demo.ac.in", "Green Leaf Public School", "Pune", "Custom PHP", "GACORWIN88", "confirmed"),
    ("royalcaterers-demo.co.in", "Royal Caterers", "Madurai", "WordPress", "TOTOMAX4D", "confirmed"),
    ("apexsteel-demo.in", "Apex Steel Traders", "Mumbai", "Joomla", "LUCKY777", "confirmed"),
    ("kavyaboutique-demo.in", "Kavya Boutique", "Jaipur", "WordPress", "SPINRAJA99", "confirmed"),
    ("sunrisehospital-demo.in", "Sunrise Multispeciality Hospital", "Lucknow", "Drupal", "GACORWIN88", "confirmed"),
    ("bluewavetravels-demo.in", "Blue Wave Tours & Travels", "Kochi", "WordPress", "TOTOMAX4D", "confirmed"),
    ("shreeganesh-demo.co.in", "Shree Ganesh Interiors", "Coimbatore", "Custom PHP", "LUCKY777", "confirmed"),
    ("krishnaagro-demo.in", "Krishna Agro Exports", "Indore", "WordPress", "SPINRAJA99", "seen_once"),
    ("metrolabs-demo.in", "Metro Diagnostic Labs", "Hyderabad", "WordPress", "GACORWIN88", "seen_once"),
    ("vedaayurveda-demo.in", "Veda Ayurveda Clinic", "Kozhikode", "Shopify", "TOTOMAX4D", "seen_once"),
    ("cityplumbers-demo.in", "City Plumbers", "Bengaluru", "WordPress", "LUCKY777", "review"),
    ("anandphoto-demo.in", "Anand Photography", "Surat", "Wix", "SPINRAJA99", "review"),
    ("primeacademy-demo.in", "Prime Coaching Academy", "Patna", "WordPress", "GACORWIN88", "review"),
    ("lotusyoga-demo.in", "Lotus Yoga Studio", "Rishikesh", "Squarespace", "TOTOMAX4D", "review"),
    ("goldenbakery-demo.in", "Golden Bakery", "Chandigarh", "WordPress", "LUCKY777", "was_hacked"),
    ("swiftcouriers-demo.co.in", "Swift Couriers", "Ahmedabad", "Custom PHP", "SPINRAJA99", "was_hacked"),
    ("nilgiritea-demo.in", "Nilgiri Tea House", "Ooty", "WordPress", "GACORWIN88", "was_hacked"),
    ("starmotors-demo.in", "Star Motors", "Nagpur", "WordPress", "TOTOMAX4D", "was_hacked"),
    ("brightsolar-demo.in", "Bright Solar Systems", "Vadodara", "WordPress", "LUCKY777", "was_hacked"),
    ("oceanfoods-demo.in", "Ocean Foods", "Vizag", "WordPress", "SPINRAJA99", "down"),
    ("pearlhotel-demo.in", "Pearl Residency Hotel", "Mysuru", "Custom PHP", "GACORWIN88", "down"),
    ("silkhouse-demo.in", "Kanchi Silk House", "Kanchipuram", "WordPress", "TOTOMAX4D", "notfound"),
    ("techserve-demo.in", "TechServe IT Solutions", "Noida", "WordPress", "LUCKY777", "isp"),
    ("gacorwin88-demo.in", "", "", "Unknown", "GACORWIN88", "spammer"),
    ("situsdemo-demo.in", "", "", "Unknown", "SPINRAJA99", "foreign"),
    ("berita-demo.in", "", "", "WordPress", "", "foreign"),
]
SPAM_TITLE = {"LUCKY777": "LUCKY777 : Situs Slot Gacor Resmi Hari Ini Gampang Menang",
              "GACORWIN88": "GACORWIN88 Link Daftar Slot Online Terpercaya 2026",
              "TOTOMAX4D": "TOTOMAX4D | Bandar Togel Online Resmi dan Terpercaya",
              "SPINRAJA99": "SPINRAJA99 - Situs Slot Maxwin Terbaru dan Terpercaya"}
VERDICT = {"confirmed": "CONFIRMED hacked", "seen_once": "Review", "review": "Review", "was_hacked": "Was hacked (spam gone now)",
           "down": "Down / unreachable (re-check)", "notfound": "Was hacked (spam gone now)", "isp": "Blocked by ISP as dangerous",
           "spammer": "Not a lead (spammer-owned domain)", "foreign": "Not a lead (foreign-language site)"}

def site(i, dom, biz, city, plat, brand, kind):
    days = 3 + i % 9
    spam = kind in ("confirmed", "seen_once", "review", "isp")
    inner = i % 3 != 0
    page = f"https://{dom}/{'blog/' + brand.lower() + '/' if inner else ''}"
    gates = {"past_business": kind not in ("spammer", "foreign"), "no_registration_gap": kind not in ("spammer", "foreign", "review") or i % 2 == 0,
             "old_assets_live": kind in ("confirmed", "seen_once", "isp") or (kind == "review" and i % 2 == 1),
             "seen_twice": kind in ("confirmed", "isp")}
    state = {"confirmed": "hacked_hidden" if inner else "hacked_visible", "isp": "hacked_visible", "was_hacked": "was_hacked", "notfound": "was_hacked",
             "spammer": "excluded", "foreign": "excluded"}.get(kind, "review")
    title_now = SPAM_TITLE.get(brand, "Berita Terkini Hari Ini") if kind != "isp" else "This site has been blocked as per instructions of the Department of Telecom"
    return {
        "domain": dom, "checked": TODAY, "page_url": page, "inner_page": inner,
        "home_status": 0 if kind == "down" else 200, "home_title": f"{biz} | {city}" if biz else title_now,
        "page_status": 0 if kind == "down" else 404 if kind == "notfound" else 200,
        "page_title": title_now if spam else ("" if kind in ("down", "notfound") else f"{biz} | {city}"),
        "googlebot_title": title_now if spam else "", "mobile_title": title_now if spam else "", "google_referrer_title": title_now if spam else "",
        "final_url": page, "redirect_offsite": False, "page_lang": "Indonesian" if spam or kind in ("spammer", "foreign") else "English",
        "home_lang": "Indonesian" if kind in ("spammer", "foreign") else "English", "foreign_site": kind == "foreign",
        "urlscan_title": SPAM_TITLE.get(brand, ""), "urlscan_time": f"2026-11-{23 - days:02d}", "source": ["commoncrawl", "snowball", "assets", "urlscan"][i % 4],
        "server_country": "IN", "ip": f"203.0.113.{10 + i}", "still_spam": spam and kind != "isp", "spam_only_for_google_or_mobile": False,
        "home_is_business": inner and spam, "snapshots": 12 + i, "oldest": "20220105", "oldest_title": f"{biz} | {city}",
        "last_clean": f"202609{10 + i % 18:02d}", "last_clean_title": f"{biz} | {city}" if biz else "", "first_spam_archive": None,
        "rdap_registered": f"{2012 + i % 10}-0{1 + i % 9}-15", "rdap_last_changed": "2026-09-30", "rdap_expires": "2027-09-30", "rdap_nameservers": ["ns1.example-host.in", "ns2.example-host.in"],
        "assets_tested": ["/wp-content/themes/demo/logo.png", "/assets/css/style.css"], "assets_live": ["/wp-content/themes/demo/logo.png"] if gates["old_assets_live"] else [],
        "platform": plat, "india_signals": ["+91 phone", "PIN code + Indian place", f"Place: {city}"] if city else [],
        "phones": [f"+91 55555 {10100 + i}"] if biz else [], "emails": [f"info@{dom}"] if biz else [],
        "business_title": f"{biz} | {city}" if biz else "", "gates": gates, "verdict": VERDICT[kind], "state": state, "india": True,
        **({"isp_blocked": True} if kind == "isp" else {}),
        **({"llm": {"spam": True, "kind": "gambling", "confidence": 0.93, "reason": "Indonesian slot-gambling text and casino links on a dental clinic's blog page.", "model": "llama3.2"}} if i == 0 else {}),
    }

def build_data():
    F = [site(i, *row) for i, row in enumerate(SITES)]
    ev = {}
    for f in F[:8] + F[8:11]:
        ev[f["domain"]] = {"captured": TODAY, "page_url": f["page_url"], "live": "evidence/spam.jpg", "before": "evidence/business.jpg", "before_ts": f["last_clean"],
                           "headers": {"browser": {"status": 200, "server": "nginx", "content-type": "text/html; charset=UTF-8"},
                                       "googlebot": {"status": 200, "server": "nginx", "content-type": "text/html; charset=UTF-8"}}}
    chk = dict(F[0]); chk.update({"source": "manual-check", "check_time": TODAY + " 10:42:10", "check_target": "sharmadental-demo.in", "sitemap_pages": 18, "spam_pages": 6,
        "home": {"title": F[0]["home_title"], "lang": "English", "status": 200}, "check_seconds": 74, "earlier_evidence": None, "sightings": [],
        "captures": ev[F[0]["domain"]],
        "pages_checked": [{"url": f"https://sharmadental-demo.in/{p}", "title": t, "lang": l, "status": 200, "suspicious": s, "brand": b}
                          for p, t, l, s, b in [("blog/lucky777/", SPAM_TITLE["LUCKY777"], "Indonesian", 7, "LUCKY777"), ("blog/slot-gacor/", SPAM_TITLE["LUCKY777"], "Indonesian", 5, "LUCKY777"),
                                                ("services/", "Services | Sharma Dental Care", "English", 0, None), ("contact/", "Contact | Sharma Dental Care", "English", 0, None)]]})
    runs = [{"id": f"202611{d}-0900{i}", "started": f"2026-11-{d} 09:00:0{i}", "finished": f"2026-11-{d} 10:1{i}:00", "duration_s": 4300 + 300 * i, "status": "done", "error": None,
             "params": {"sources": {"commoncrawl": True, "snowball": True, "assets": True, "sameip": i == 2}, "crawl": "CC-MAIN-2026-43", "tld": "in", "since": f"2026-11-{d}"},
             "sources": {"commoncrawl": 400, "snowball": 120 + 20 * i, "assets": 36 + 5 * i}, "looked_at": {"commoncrawl_pages": 110416, "commoncrawl_domains": 3169, "snowball_brands": 18, "spam_hosts": 300},
             "suspects": 520 + 40 * i, "skipped_old": 0, "skipped_known": 60, "rechecked": 0, "verified": 480 + 30 * i, "errors": 2,
             "counts": {"confirmed": 6 + i, "review": 12, "was_hacked": 20, "issues": 9, "not_lead": 300}, "india_counts": {"confirmed": 5 + i, "review": 8, "was_hacked": 11, "issues": 6},
             "domains": {"confirmed": [{"domain": f["domain"], "india": True, "verdict": f["verdict"]} for f in F[:6 + i]],
                         "review": [{"domain": f["domain"], "india": True, "verdict": f["verdict"]} for f in F[8:15]]}} for i, d in enumerate(("21", "22", "23"))]
    return F, ev, [chk], runs

FOLLOW = {"sharmadental-demo.in": {"status": "interested", "next": "2026-11-25", "log": [
              {"date": "2026-11-21", "type": "Email", "status": "emailed", "note": "Sent the before/after screenshots and the cleanup checklist"},
              {"date": "2026-11-22", "type": "Call", "status": "interested", "note": "Owner confirmed, asked for a quote — call back Tuesday"}]},
          "greenleafschool-demo.ac.in": {"status": "emailed", "next": "2026-11-23", "log": [{"date": "2026-11-20", "type": "Email", "status": "emailed", "note": "Emailed the principal's office"}]},
          "royalcaterers-demo.co.in": {"status": "no_response", "next": "2026-11-21", "log": [{"date": "2026-11-18", "type": "WhatsApp", "status": "called", "note": "Shared the report on WhatsApp"}]},
          "apexsteel-demo.in": {"status": "won", "next": "", "log": [{"date": "2026-11-15", "type": "Call", "status": "won", "note": "Site cleaned, plugins updated"}]}}

BUSINESS_HTML = """<html><body style="margin:0;font-family:Georgia,serif;background:#f6f8fb">
<div style="background:#0f5c8c;color:#fff;padding:26px 60px;display:flex;justify-content:space-between;align-items:center"><b style="font-size:30px">🦷 Sharma Dental Care</b><span style="font:16px Arial">Home · Services · Doctors · Contact</span></div>
<div style="padding:70px 60px"><h1 style="font-size:52px;color:#123">Gentle dental care in Chennai</h1><p style="font:22px Arial;color:#456;max-width:700px">Root canal, implants, braces and family dentistry since 2009. Book an appointment today.</p>
<div style="margin-top:30px;display:inline-block;background:#0f5c8c;color:#fff;font:20px Arial;padding:16px 30px;border-radius:8px">Book appointment</div></div></body></html>"""
SPAM_HTML = """<html><body style="margin:0;font-family:Arial;background:#120018;color:#fff">
<div style="background:linear-gradient(90deg,#ff0080,#ffb000);padding:22px 60px;font-size:34px;font-weight:900">LUCKY777 🎰 SLOT GACOR</div>
<div style="padding:60px"><h1 style="font-size:50px">Situs Slot Gacor Resmi Hari Ini Gampang Menang</h1><p style="font-size:22px;color:#fbd">Daftar sekarang dan dapatkan bonus 100% · RTP live 98% · Deposit QRIS</p>
<div style="margin-top:30px;display:flex;gap:20px">""" + "".join(f'<div style="width:180px;height:130px;border-radius:14px;background:hsl({h},80%,45%);display:flex;align-items:center;justify-content:center;font-size:40px">🎰</div>' for h in (300, 40, 200, 120, 0)) + "</div></div></body></html>"

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_json(self, o):
        b = json.dumps(o).encode(); self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        api = {"/api/checks": CHECKS, "/api/runs": RUNS, "/api/status": {"running": False, "log": []}, "/api/check-status": {"running": False, "queue": [], "log": []},
               "/api/llm": {"provider": "ollama", "url": "http://127.0.0.1:11434", "model": "llama3.2", "api_key": "", "timeout": 90, "enabled": True},
               "/api/defaults": {"sources": {"commoncrawl": True, "snowball": True, "assets": True, "sameip": False, "urlscan": False}, "urlscan_key": False, "crawl": "CC-MAIN-2026-43",
                                 "langs": ["ind", "tha", "vie", "msa"], "lang_choices": {"ind": "Indonesian", "tha": "Thai", "vie": "Vietnamese", "msa": "Malay"}, "tld": "in",
                                 "max_domains": 400, "per_brand": 60, "max_hosts": 30, "max_neighbours": 300, "sameip_cached": True, "new_only": True, "capture": True,
                                 "since": TODAY, "recheck_issues": False, "llm": {"provider": "ollama", "model": "llama3.2", "enabled": True}}}
        for k, v in api.items():
            if self.path.startswith(k): return self.send_json(v)
        return super().do_GET()

def main():
    global CHECKS, RUNS
    from playwright.sync_api import sync_playwright
    from PIL import Image
    tmp = tempfile.mkdtemp(prefix="sitewatch-demo-")
    for f in ("index.html", "core.js", "app.js"): shutil.copy(os.path.join(ROOT, "preview", f), tmp)
    F, ev, CHECKS, RUNS = build_data()
    for name, val in (("findings", ("FINDINGS", F)), ("evidence", ("EVIDENCE", ev)), ("checks", ("CHECKS", CHECKS)), ("runs", ("RUNS", RUNS)), ("seed", ("SEED_SITES", []))):
        open(os.path.join(tmp, name + ".js"), "w", encoding="utf-8").write(f"window.{val[0]} = {json.dumps(val[1], ensure_ascii=False)};\n")
    os.makedirs(os.path.join(tmp, "evidence"))
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), lambda *a, **k: Handler(*a, directory=tmp, **k))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try: tw = urllib.request.urlopen("https://cdn.tailwindcss.com/3.4.16", timeout=10).read()
    except Exception: tw = urllib.request.urlopen(TAILWIND_MIRROR, timeout=30).read()
    shots = os.path.join(OUT, "screens"); os.makedirs(shots, exist_ok=True)
    frames = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 800})
        for fn, html in (("business.jpg", BUSINESS_HTML), ("spam.jpg", SPAM_HTML)):
            pg.set_content(html); pg.screenshot(path=os.path.join(tmp, "evidence", fn), type="jpeg", quality=80)
        pg.route("**/cdn.tailwindcss.com/**", lambda r: r.fulfill(status=200, body=tw, content_type="application/javascript"))
        base = f"http://127.0.0.1:{PORT}/"
        pg.goto(base, wait_until="domcontentloaded")
        pg.evaluate("""f => { localStorage.clear(); localStorage.setItem('sw.follow', JSON.stringify(f));
            localStorage.setItem('sw.approved', JSON.stringify(Object.fromEntries(Object.keys(f).map(k=>[k,'2026-11-20'])))); }""", FOLLOW)
        def snap(name, caption):
            pg.wait_for_timeout(1200)
            path = os.path.join(shots, name + ".png"); pg.screenshot(path=path); frames.append((path, caption)); print("frame", name)
        def tab(t):
            pg.evaluate(f"localStorage.setItem('sw.tab', JSON.stringify('{t}'))"); pg.reload(wait_until="domcontentloaded"); pg.wait_for_selector("#main *"); pg.wait_for_timeout(300); pg.evaluate("window.scrollTo(0,0)")
        tab("matrix"); snap("1-overview", "Overview: every site and its result")
        tab("leads"); snap("2-leads", "Leads: filter by result, gate, spam brand")
        pg.locator("[data-row]").first.click(); pg.wait_for_timeout(800); pg.evaluate("document.querySelector('[data-row]').scrollIntoView({block:'start'}); window.scrollBy(0,-90)"); snap("3-inspect", "Inspect: proof, 4 gates, owner contact")
        tab("check"); pg.wait_for_timeout(1500); snap("4-site-check", "Site Check: test any website")
        pg.mouse.wheel(0, 900); snap("5-evidence", "Before vs now: real business replaced by spam")
        tab("followups"); snap("6-followups", "Follow-ups: calls, emails, next date")
        tab("reports"); snap("7-reports", "Search reports: searched / found / issues")
        tab("settings"); pg.locator("#llmCard").scroll_into_view_if_needed(); snap("8-ai-helper", "Optional AI helper (local LLM)")
        pg.evaluate("window.scrollTo(0,0)"); pg.click("[data-search]"); pg.wait_for_selector("#sAS"); snap("9-search", "Run Search: free sources, default values")
        b.close()
    srv.shutdown()
    # GIF: 1000 px wide, ~2.6 s per frame, with a caption bar
    from PIL import ImageDraw, ImageFont
    try: font = ImageFont.truetype("arial.ttf", 22)
    except Exception: font = ImageFont.load_default()
    imgs = []
    for path, cap in frames:
        im = Image.open(path).convert("RGB").resize((1000, 625), Image.LANCZOS)
        canvas = Image.new("RGB", (1000, 665), (9, 76, 178)); canvas.paste(im, (0, 40))
        ImageDraw.Draw(canvas).text((16, 8), cap, fill=(255, 255, 255), font=font)
        imgs.append(canvas.quantize(colors=128, method=Image.Quantize.MEDIANCUT))
    gif = os.path.join(OUT, "demo.gif")
    imgs[0].save(gif, save_all=True, append_images=imgs[1:], duration=2600, loop=0, optimize=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"wrote {gif} ({os.path.getsize(gif) // 1024} KB, {len(imgs)} frames) and {len(frames)} PNGs in docs/screens/")

if __name__ == "__main__":
    main()
