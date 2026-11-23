"""Collect suspect domains from urlscan.io public search (servers hosted in India).
Discovery seed only - every domain is verified separately by verify.py."""
import json, time, urllib.parse, urllib.request, sys

QUERIES = [
    'page.country:IN AND page.title:(gacor OR togel OR maxwin OR situs OR slot88 OR toto)',
    'page.country:IN AND page.title:(slot AND (online OR gacor OR deposit))',
]
UA = {"User-Agent": "SiteWatch-research/0.1"}

def search(q, after=None):
    url = "https://urlscan.io/api/v1/search/?size=100&q=" + urllib.parse.quote(q)
    if after: url += "&search_after=" + urllib.parse.quote(after)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
        return json.load(r)

def main():
    seen = {}
    for q in QUERIES:
        after = None
        for _ in range(10):                      # max 1000 results per query
            d = search(q, after)
            res = d.get("results", [])
            for r in res:
                p = r.get("page", {})
                apex = (p.get("apexDomain") or p.get("domain") or "").lower()
                if not apex or apex in seen: continue
                seen[apex] = {"domain": apex, "host": p.get("domain"), "url": p.get("url"),
                              "scan_time": r["task"]["time"], "title": p.get("title"),
                              "urlscan_result": "https://urlscan.io/result/%s/" % r["task"]["uuid"],
                              "urlscan_screenshot": r.get("screenshot") or "https://urlscan.io/screenshots/%s.png" % r["task"]["uuid"],
                              "server_country": p.get("country"), "ip": p.get("ip"), "query": q}
            if len(res) < 100 or not d.get("has_more", True): break
            after = ",".join(str(x) for x in res[-1]["sort"])
            time.sleep(2)
        time.sleep(2)
    json.dump(list(seen.values()), open("candidates.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(len(seen), "unique domains -> candidates.json")

if __name__ == "__main__":
    main()
