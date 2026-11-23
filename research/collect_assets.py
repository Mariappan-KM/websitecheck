"""Discovery source: shared spam files (no account, no keyword list).

Spam injected into hacked sites loads its images, scripts and landing links from the
spammer's own hosts (e.g. a05storage.com, xxx.b-cdn.net). The same hosts are loaded by
every other site in that campaign. So:
  1. open the live spam page of every verified victim and collect the outside hosts it uses
     (common CDNs, fonts, analytics and social sites are ignored),
  2. ask urlscan's public search which other pages loaded that host (domain:HOST),
  3. those pages are new suspects; verify.py decides with the 4 gates.

Output: candidates_assets.json
Usage:  python collect_assets.py [MAX_HOSTS]
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import verify as V

MAX_HOSTS = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 30
UA = {"User-Agent": "SiteWatch-research/0.1"}
ROOT = os.path.dirname(os.path.abspath(__file__))
PLATFORM = V.PLATFORM_HOSTS
# hosts almost every website loads: they say nothing about a spam campaign
COMMON = re.compile(r"(^|\.)(google|googleapis|gstatic|googletagmanager|google-analytics|googlesyndication|googleusercontent|doubleclick|youtube|ytimg|"
                    r"facebook|fbcdn|instagram|twitter|x|linkedin|pinterest|tiktok|reddit|whatsapp|wa|t|telegram|apple|microsoft|bing|yahoo|yandex|baidu|"
                    r"amazon|amazonaws|cloudflare|cloudflareinsights|jsdelivr|unpkg|cdnjs|jquery|bootstrapcdn|fontawesome|fonts|typekit|gravatar|wp|wordpress|w|"
                    r"gmpg|schema|w3|ampproject|archive|creativecommons|github|githubusercontent|gitlab|envato|themeforest|shopify|wix|wixstatic|squarespace|"
                    r"hotjar|clarity|datadoghq-browser-agent|tawk|livechatinc|placeholder|paypal|stripe|recaptcha|hcaptcha|addthis|sharethis|disqus|vimeo|"
                    r"maps|openstreetmap|mapbox|unsplash|pexels|adobe|cookielaw|onetrust|bit|tinyurl|wikipedia|wikimedia)\.[a-z.]{2,6}$")

def outside_hosts(victim):
    """Hosts of images / scripts / styles / links on the victim's spam page, excluding its own and common ones."""
    ua = V.GOOGLEBOT if victim.get("spam_only_for_google_or_mobile") else V.BROWSER
    st, _, _, html = V.fetch(victim["page_url"], ua=ua, timeout=25)
    if st != 200 or V.lang_guess(html) not in V.FOREIGN: return victim["domain"], []      # spam gone: nothing to learn
    hosts = []
    for u in re.findall(r'(?:src|href|data-src)=["\'](?:https?:)?//([^/"\'#?:]+)', html or "", re.I):
        h = u.lower().removeprefix("www.")
        if "." not in h or h.endswith(victim["domain"]) or COMMON.search(h) or h.endswith(PLATFORM): continue
        hosts.append(h)
    return victim["domain"], list(dict.fromkeys(hosts))

def urlscan(host):
    url = "https://urlscan.io/api/v1/search/?size=100&q=" + urllib.parse.quote(f"domain:{host}")
    for attempt in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.load(r).get("results", [])
        except Exception as e:
            print("  search failed:", host, type(e).__name__, flush=True); time.sleep(5)
    return []

def victims():
    """Verified spam pages: search results + single-site checks."""
    rows = []
    try: rows += json.load(open(os.path.join(ROOT, "findings.json"), encoding="utf-8"))
    except Exception: pass
    folder = os.path.join(ROOT, "checks")
    for fn in (os.listdir(folder) if os.path.isdir(folder) else []):
        try: rows.append(json.load(open(os.path.join(folder, fn), encoding="utf-8")))
        except Exception: pass
    good = [r for r in rows if r.get("page_url") and (r.get("still_spam") or r.get("spam_only_for_google_or_mobile"))
            and (r.get("verdict") in ("CONFIRMED hacked", "Blocked by ISP as dangerous") or (r.get("verdict") == "Review" and r.get("gates", {}).get("past_business")))]
    return list({r["domain"]: r for r in good}.values())

def main():
    vic = victims()
    known = set()
    for fn in ("findings.json", "candidates_all.json"):
        try: known |= {r["domain"] for r in json.load(open(os.path.join(ROOT, fn), encoding="utf-8"))}
        except Exception: pass
    print(f"{len(vic)} verified spam pages to read", flush=True)
    with ThreadPoolExecutor(8) as ex:
        found = list(ex.map(outside_hosts, vic))
    count = Counter(h for _, hs in found for h in hs)                 # hosts used by several victims first
    order = [h for h, _ in count.most_common()][:MAX_HOSTS]
    print(f"{len(count)} spam hosts found, searching {len(order)}: {', '.join(order[:12])}{' …' if len(order) > 12 else ''}", flush=True)
    out, seen = [], set()
    for i, host in enumerate(order, 1):
        res = urlscan(host); kept = 0
        for r in res:
            p = r.get("page", {}); apex = (p.get("apexDomain") or p.get("domain") or "").lower(); h = (p.get("domain") or "").lower()
            if not apex or apex in known or apex in seen or h.endswith(PLATFORM) or apex.endswith(PLATFORM) or host.endswith(apex): continue
            if V.lang_guess(f"<title>{p.get('title') or ''}</title>") not in V.FOREIGN: continue   # normal sites also load big hosts: keep only spam-language pages
            seen.add(apex); kept += 1
            out.append({"domain": apex, "host": h, "url": p.get("url"), "scan_time": r["task"]["time"], "title": p.get("title"),
                        "server_country": p.get("country"), "ip": p.get("ip"), "query": f"assets domain:{host}", "source": "assets", "asset_host": host,
                        "urlscan_result": "https://urlscan.io/result/%s/" % r["task"]["uuid"],
                        "urlscan_screenshot": r.get("screenshot") or "https://urlscan.io/screenshots/%s.png" % r["task"]["uuid"]})
        print(f"[{i}/{len(order)}] {host:<40} {len(res):>3} results -> {kept} new domains", flush=True)
        time.sleep(2.5)                                   # be polite to the public API
    json.dump(out, open(os.path.join(ROOT, "candidates_assets.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"wrote candidates_assets.json: {len(out)} new domains")

if __name__ == "__main__":
    main()
