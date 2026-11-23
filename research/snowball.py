"""Discovery source: snowball from spam brands already seen on verified victims.

A spam operation rents pages on many hacked sites, all showing the same brand
(e.g. DEWI11, POLOTOTO). For every brand on a confirmed / was-hacked / ISP-blocked site,
search urlscan's public index (no account needed for a plain title search) for other
pages with that brand in the title.

Output: candidates_snowball.json
Usage:  python snowball.py [MAX_PER_BRAND]
"""
import json, re, sys, time, urllib.parse, urllib.request

MAX_PER_BRAND = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 60
UA = {"User-Agent": "SiteWatch-research/0.1"}
# generic title words are not brand names
GENERIC = {"SLOT", "SITUS", "LINK", "GACOR", "LOGIN", "DAFTAR", "RESMI", "ONLINE", "TOGEL", "GAME", "GAMES",
           "TERPERCAYA", "HARI", "INI", "MAXWIN", "DEPO", "JUDI", "RTP", "APK", "QRIS", "BANDAR", "AGEN", "HOME"}
PLATFORM = ("pages.dev", "temporary.site", "mybluehost.me", "netlify.app", "vercel.app", "github.io", "blogspot.com", "wixsite.com", "web.app")
SEED_BRANDS = ["NUSANTARA88", "ESSE4D", "CIATOTO", "WDBOSS", "AGAM66", "PGKING", "NIRWANA88", "PGRAJA", "JP500", "WEB77", "AGAM99"]  # brands seen on a verified victim

def brands_from(title):
    return [w for w in re.findall(r"\b[A-Z][A-Z0-9]{3,}\b", title or "") if w not in GENERIC and re.search(r"[A-Z]", w)][:1]

def search(brand):
    url = "https://urlscan.io/api/v1/search/?size=100&q=" + urllib.parse.quote(f"page.title:{brand}")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
            return json.load(r).get("results", [])
    except Exception as e:
        print("  search failed:", brand, type(e).__name__, flush=True); return []

def main():
    F = json.load(open("findings.json", encoding="utf-8"))
    known = {r["domain"] for r in F}
    good = [r for r in F if r["verdict"] in ("CONFIRMED hacked", "Was hacked (spam gone now)", "Blocked by ISP as dangerous")]
    brands = list(dict.fromkeys(SEED_BRANDS + [b for r in good for b in brands_from(r.get("urlscan_title"))]))
    print(f"{len(brands)} brands from {len(good)} verified victims: {', '.join(brands)}", flush=True)
    out, seen = [], set()
    for b in brands:
        res = search(b); kept = 0
        for r in res:
            p = r.get("page", {}); apex = (p.get("apexDomain") or p.get("domain") or "").lower(); host = (p.get("domain") or "").lower()
            if not apex or apex in known or apex in seen or host.endswith(PLATFORM) or apex.endswith(PLATFORM): continue
            seen.add(apex); kept += 1
            out.append({"domain": apex, "host": host, "url": p.get("url"), "scan_time": r["task"]["time"], "title": p.get("title"),
                        "server_country": p.get("country"), "ip": p.get("ip"), "query": f"snowball page.title:{b}", "source": "snowball", "brand": b,
                        "urlscan_result": "https://urlscan.io/result/%s/" % r["task"]["uuid"],
                        "urlscan_screenshot": r.get("screenshot") or "https://urlscan.io/screenshots/%s.png" % r["task"]["uuid"]})
            if kept >= MAX_PER_BRAND: break
        print(f"  {b:<14} {len(res):>3} results -> {kept} new domains", flush=True)
        time.sleep(2.5)                                   # be polite to the public API
    json.dump(out, open("candidates_snowball.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"wrote candidates_snowball.json: {len(out)} new domains")

if __name__ == "__main__":
    main()
