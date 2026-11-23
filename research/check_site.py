"""Check ONE website end-to-end (public data only).

    python check_site.py example.in            (or a full URL of a suspicious page)

1. Collect pages: homepage, sitemap (up to 30 pages), the given URL, earlier public
   sightings (urlscan scans, Common Crawl captures of the domain).
2. Look at every page as a browser: title + language. A page whose language does not
   fit the site (e.g. Indonesian / Thai / Vietnamese page on an English or Hindi site)
   is suspicious. Earlier sightings with a spam-looking title count as evidence too.
3. Verify the most suspicious page with the same 4 gates as the search (verify.py).
4. Screenshots (archive vs live) + headers.
Writes research/checks/<domain>.json and preview/checks.js (window.CHECKS) — never
touches findings.json, so it is safe while a big verification run is going.
"""
import asyncio, json, os, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import verify as V

ROOT = os.path.dirname(os.path.abspath(__file__))
CHECKS = os.path.join(ROOT, "checks")
PREVIEW = os.path.join(ROOT, "..", "preview")
MAX_PAGES = 30
UA = {"User-Agent": "SiteWatch-research/0.1"}

def step(msg):
    print(f"STEP {msg}", flush=True)

def norm(target):
    t = target.strip().lower()
    if not re.match(r"^https?://", t): t = "https://" + t
    u = urllib.parse.urlparse(t)
    host = u.netloc.split("@")[-1].split(":")[0].removeprefix("www.")
    if not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", host): raise SystemExit("Not a website address: " + target)
    page = t if (u.path not in ("", "/") or u.query) else None
    return host, page

def get_json(url, timeout=30):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return json.load(r)
    except Exception:
        return None

def sitemap_pages(d):
    urls, seen = [], set()
    queue = [f"https://{d}/sitemap.xml", f"https://{d}/sitemap_index.xml", f"https://{d}/wp-sitemap.xml"]
    st, _, _, robots = V.fetch(f"https://{d}/robots.txt", timeout=15)
    queue += re.findall(r"(?im)^sitemap:\s*(\S+)", robots or "")
    fetched = 0
    while queue and fetched < 6 and len(urls) < MAX_PAGES * 3:
        sm = queue.pop(0)
        if sm in seen: continue
        seen.add(sm); fetched += 1
        st, _, _, body = V.fetch(sm, timeout=20)
        if st != 200 or "<loc>" not in (body or ""): continue
        for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", body):
            loc = loc.replace("&amp;", "&")
            if loc.endswith(".xml") or "sitemap" in loc.rsplit("/", 1)[-1]: queue.append(loc)
            elif urllib.parse.urlparse(loc).netloc.lower().removeprefix("www.").endswith(d): urls.append(loc)
    return list(dict.fromkeys(urls))

def urlscan_sightings(d):
    j = get_json("https://urlscan.io/api/v1/search/?size=50&q=" + urllib.parse.quote(f"domain:{d}")) or {}
    out = []
    for r in j.get("results", []):
        p = r.get("page", {})
        if p.get("url"):
            out.append({"source": "urlscan", "url": p["url"], "title": p.get("title") or "", "time": r["task"]["time"][:10],
                        "link": f"https://urlscan.io/result/{r['task']['uuid']}/", "screenshot": r.get("screenshot")})
    return out

def local_sightings(d):
    """Earlier records of this domain in our own data (search candidates / results)."""
    out = []
    for fn in ("candidates_all.json", "candidates.json", "candidates_cc.json", "candidates_snowball.json"):
        try: rows = json.load(open(os.path.join(ROOT, fn), encoding="utf-8"))
        except Exception: continue
        for c in rows:
            if c.get("domain") == d and c.get("url"):
                src = c.get("source") or "urlscan"
                out.append({"source": "commoncrawl" if src == "commoncrawl" else "urlscan", "url": c["url"], "title": c.get("title") or "",
                            "lang": (c.get("cc_langs") or "").split(",")[0] or None, "time": (c.get("scan_time") or "")[:10],
                            "link": c.get("urlscan_result"), "screenshot": c.get("urlscan_screenshot"), "from": fn})
    seen, uniq = set(), []
    for x in out:
        if x["url"] not in seen: seen.add(x["url"]); uniq.append(x)
    return uniq

def cc_sightings(d):
    info = get_json("https://index.commoncrawl.org/collinfo.json") or [{"id": "CC-MAIN-2026-43"}]
    crawl = info[0]["id"]; out = []
    url = f"https://index.commoncrawl.org/{crawl}-index?url={urllib.parse.quote(d)}/*&output=json&limit=150&fl=url,languages,timestamp,status"
    body = ""
    for attempt in range(3):                       # the public index is often overloaded (504)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                body = r.read().decode("utf-8", "replace"); break
        except Exception:
            time.sleep(3 * (attempt + 1))
    try:
        if True:
            for line in body.splitlines():
                try: x = json.loads(line)
                except Exception: continue
                lang = (x.get("languages") or "").split(",")[0]
                if x.get("status") == "200" and lang in ("ind", "tha", "vie", "msa"):
                    out.append({"source": "commoncrawl", "url": x["url"], "title": "", "lang": lang, "time": x["timestamp"][:4] + "-" + x["timestamp"][4:6] + "-" + x["timestamp"][6:8],
                                "link": f"https://index.commoncrawl.org/{crawl}-index?url={x['url']}&output=json"})
    except Exception:
        pass
    return out[:40]

GENERIC = {"SLOT", "SITUS", "LINK", "GACOR", "LOGIN", "DAFTAR", "RESMI", "ONLINE", "TOGEL", "GAME", "GAMES", "HOME", "ABOUT",
           "CONTACT", "TERPERCAYA", "HARI", "MAXWIN", "DEPO", "JUDI", "RTP", "APK", "QRIS", "BANDAR", "AGEN", "BLOG", "NEWS", "INDIA", "PVT", "LTD",
           "FSSAI", "ASIA", "DANA", "GST", "ISO", "COVID", "NABH", "NAAC", "AICTE", "UGC", "CBSE", "ICSE", "IIT", "NIT"}   # real Indian terms, never brands
def known_brands():
    """Spam brand names learned from every earlier result (titles of verified spam pages)."""
    seen = {}                                     # token -> set of domains whose spam title had it
    for fn in ("findings.json", "candidates_all.json"):
        try: rows = json.load(open(os.path.join(ROOT, fn), encoding="utf-8"))
        except Exception: continue
        for r in rows:
            v = r.get("verdict", "")
            if fn == "findings.json" and not (v.startswith("CONFIRMED") or v.startswith("Was hacked")): continue
            for w in set(re.findall(r"\b[A-Z][A-Z0-9]{3,}\b", r.get("urlscan_title") or r.get("title") or "")):
                if w not in GENERIC: seen.setdefault(w, set()).add(r.get("domain"))
    # a brand has a digit (AGAM66, DEWI11) or was seen on 3+ different hacked sites; plain words like BOMBAY are not brands
    return {w for w, ds in seen.items() if re.search(r"\d", w) or len(ds) >= 3}

def look(url):
    st, final, _, html = V.fetch(url)
    return {"url": url, "status": st, "final_url": final, "title": V.title_of(html), "lang": V.lang_guess(html)}

async def captures(d, page_url, last_clean):
    import capture as C
    from playwright.async_api import async_playwright
    os.makedirs(C.OUT, exist_ok=True)
    e = {"captured": date.today().isoformat(), "page_url": page_url}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1280, "height": 800}, user_agent=C.BROWSER, ignore_https_errors=True, accept_downloads=False)
        pg = await ctx.new_page()
        if await C.shot(pg, page_url, C.OUT / f"{d}-live.jpg"): e["live"] = f"evidence/{d}-live.jpg"
        if last_clean and await C.shot(pg, f"https://web.archive.org/web/{last_clean}if_/{page_url}", C.OUT / f"{d}-before.jpg"):
            e["before"] = f"evidence/{d}-before.jpg"; e["before_ts"] = last_clean[:8]
        await b.close()
    e["headers"] = {"browser": C.headers(page_url, C.BROWSER), "googlebot": C.headers(page_url, C.GOOGLEBOT)}
    return e

def write_checks_js():
    allc = []
    for fn in sorted(os.listdir(CHECKS)):
        if fn.endswith(".json"):
            try: allc.append(json.load(open(os.path.join(CHECKS, fn), encoding="utf-8")))
            except Exception: pass
    with open(os.path.join(PREVIEW, "checks.js"), "w", encoding="utf-8") as f:
        f.write("// generated by research/check_site.py\nwindow.CHECKS = "); json.dump(allc, f, ensure_ascii=False); f.write(";\n")

def main():
    d, given = norm(sys.argv[1])
    os.makedirs(CHECKS, exist_ok=True)
    t0 = time.time()
    step(f"Collecting pages of {d}")
    home = look(f"https://{d}/")
    if home["status"] == 0: home = look(f"http://{d}/")
    with ThreadPoolExecutor(3) as ex:
        f_sm, f_us, f_cc = ex.submit(sitemap_pages, d), ex.submit(urlscan_sightings, d), ex.submit(cc_sightings, d)
        sm, us, cc = f_sm.result(), f_us.result(), f_cc.result()
    seen_urls = set(); sightings = []
    for s_ in local_sightings(d) + us + cc:
        if s_["url"] not in seen_urls: seen_urls.add(s_["url"]); sightings.append(s_)
    urls = ([given] if given else []) + [s["url"] for s in sightings] + sm
    urls = [u for u in dict.fromkeys(urls) if urllib.parse.urlparse(u).netloc.lower().removeprefix("www.").endswith(d)][:MAX_PAGES]
    step(f"Checking {len(urls)} pages (+ homepage)")
    with ThreadPoolExecutor(8) as ex:
        pages = list(ex.map(look, urls))
    home_foreign = home["lang"] in V.FOREIGN
    sight_by_url = {}
    for s in sightings: sight_by_url.setdefault(s["url"], s)
    brands = known_brands()
    def score(p):
        s = sight_by_url.get(p["url"])
        sc = 0
        hit = [w for w in re.findall(r"\b[A-Z][A-Z0-9]{3,}\b", p.get("title") or "") if w in brands]
        if hit: sc += 2; p["brand"] = hit[0]                                         # title carries a known spam brand
        if p["lang"] in V.FOREIGN and not home_foreign: sc += 3                    # language does not belong to the site
        if s and s["source"] == "commoncrawl": sc += 2                               # crawl saw a foreign-language page here
        if s and s["source"] == "urlscan" and s["title"] and V.similar(s["title"], home["title"]) < 0.2: sc += 1
        if p["url"] == given: sc += 1
        return sc
    for p in pages: p["suspicious"] = score(p)
    pages.sort(key=lambda p: -p["suspicious"])
    best = pages[0] if pages and pages[0]["suspicious"] >= 2 else None
    if home_foreign and (not best or best["suspicious"] < 3):
        best = {"url": f"https://{d}/", "title": home["title"], "lang": home["lang"], "suspicious": 3}     # whole-site takeover or foreign site
    # earlier evidence of the same hack on this site (any page), seen before today
    def foreign_sighting(x):
        if x["source"] == "commoncrawl": return True
        return bool(x["title"]) and V.similar(x["title"], home["title"]) < 0.2 and not home_foreign
    prior = sorted([x for x in sightings if x.get("time") and x["time"] < date.today().isoformat() and foreign_sighting(x)], key=lambda x: x["time"])
    if best:
        s = sight_by_url.get(best["url"]) or (prior[0] if prior else None)
        own = sight_by_url.get(best["url"])
        cand = {"domain": d, "url": best["url"], "title": (own or {}).get("title") or best["title"],
                "scan_time": (s or {}).get("time") or date.today().isoformat(),
                "source": "urlscan" if (s and s["source"] == "urlscan") else ("commoncrawl" if s else "manual"),
                "urlscan_result": (s or {}).get("link"), "urlscan_screenshot": (s or {}).get("screenshot"),
                "flagged": best["suspicious"] >= 2, "flag_reason": ("spam brand " + best["brand"]) if best.get("brand") else "language does not fit the site"}
    else:
        cand = {"domain": d, "url": f"https://{d}/", "title": home["title"], "scan_time": date.today().isoformat(), "source": "manual"}
    step("Verifying with the 4 gates")
    r = V.post_check(V.verify(cand), cand)
    if not best:
        r["verdict"], r["state"] = ("Clean (no spam found)", "clean") if home["status"] not in (0,) and home["status"] < 500 else (r["verdict"], r["state"])
    r.update({"source": "manual-check", "check_time": time.strftime("%Y-%m-%d %H:%M:%S"), "check_target": sys.argv[1],
              "pages_checked": [{"url": p["url"], "title": p["title"], "lang": p["lang"], "status": p["status"], "suspicious": p["suspicious"], "brand": p.get("brand")} for p in pages],
              "spam_pages": sum(1 for p in pages if p["suspicious"] >= 2),
              "home": {"title": home["title"], "lang": home["lang"], "status": home["status"]},
              "sightings": sightings[:30], "sitemap_pages": len(sm),
              "earlier_evidence": prior[0] if prior else None})
    if "--no-capture" not in sys.argv:
        step("Taking screenshots")
        try:
            r["captures"] = asyncio.run(captures(d, r["page_url"], r.get("last_clean") or (r.get("home_history") or {}).get("last_clean")))
        except Exception as e:
            r["captures_error"] = f"{type(e).__name__}: {e}"
    r["check_seconds"] = round(time.time() - t0)
    json.dump(r, open(os.path.join(CHECKS, d + ".json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    write_checks_js()
    print(f"RESULT {d} | {r['verdict']} | india={r['india']} | {len(pages)} pages checked | {r['check_seconds']}s", flush=True)

if __name__ == "__main__":
    main()
