"""Discovery source: Common Crawl language filter (no account, no keyword list).

Finds .in pages whose detected main language is Indonesian / Thai / Vietnamese / Malay —
unusual for Indian business sites and typical of slot / gambling spam injections.
For each domain the archived page (WARC record) is read to get the title it showed at
crawl time; that is the "seen earlier" evidence used by verify.py (like urlscan's title).

Output: candidates_cc.json   (merge-ready, same shape as candidates.json)
Usage:  python collect_commoncrawl.py [CRAWL_ID] [MAX_DOMAINS]
"""
import gzip, io, json, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import duckdb

CRAWL = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].startswith("CC-MAIN") else "CC-MAIN-2026-43"
MAX_DOMAINS = next((int(a) for a in sys.argv[1:] if a.isdigit()), 400)
LANGS = ("ind", "tha", "vie", "msa")          # ISO-639-3 codes used by Common Crawl
for _a in sys.argv[1:]:
    if _a.startswith("--langs="): LANGS = tuple(x.strip() for x in _a[8:].split(",") if x.strip())
TLD = next((a[6:] for a in sys.argv[1:] if a.startswith("--tld=")), "in")
BASE = "https://data.commoncrawl.org/"
SKIP_HOSTS = ("pages.dev", "blogspot.", "wixsite.", "github.io")

def index_files():
    with urllib.request.urlopen(f"{BASE}crawl-data/{CRAWL}/cc-index-table.paths.gz", timeout=60) as r:
        paths = gzip.decompress(r.read()).decode().split()
    return [BASE + p for p in paths if "subset=warc/" in p]

def file_range(con, url):
    r = con.execute(f"select min(stats_min_value), max(stats_max_value) from parquet_metadata('{url}') where path_in_schema='url_surtkey'").fetchone()
    return r[0], r[1]

def files_for_tld(con, files, tld="in"):
    """Read every file's SURT min/max (footer only, parallel) and keep files overlapping 'in,...'."""
    lo_key, hi_key = tld + ",", tld + "-"          # '-' sorts right after ','
    def rng(f):
        c = duckdb.connect(); c.execute("LOAD httpfs;")
        try: return f, file_range(c, f)
        except Exception: return f, (None, None)
    with ThreadPoolExecutor(12) as ex:
        ranges = list(ex.map(rng, files))
    return [f for f, (mn, mx) in ranges if mn is not None and mn < hi_key and mx >= lo_key]

def warc_title(rec):
    """Read one WARC record by byte range and return the HTML <title>."""
    rng = f"bytes={rec['off']}-{rec['off'] + rec['len'] - 1}"
    req = urllib.request.Request(BASE + rec["warc"], headers={"Range": rng, "User-Agent": "SiteWatch-research/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = gzip.GzipFile(fileobj=io.BytesIO(r.read())).read(400_000)
    except Exception:
        return ""
    html = raw.decode("utf-8", "replace")
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip()[:200] if m else ""

def main():
    con = duckdb.connect(); con.execute("INSTALL httpfs; LOAD httpfs;")
    files = index_files()
    t = time.time(); part = files_for_tld(con, files, TLD)
    print(f"{CRAWL}: {len(files)} index files, .{TLD} in {len(part)} file(s) ({time.time()-t:.0f}s)", flush=True)
    lst = ",".join(f"'{f}'" for f in part)
    langs = ",".join(f"'{l}'" for l in LANGS)
    t = time.time()
    rows = con.execute(f"""
      select url_host_registered_domain as d, url, url_host_name as host, content_languages as langs,
             fetch_time, warc_filename, warc_record_offset, warc_record_length,
             (url_path = '/' or url_path = '') as is_home
      from read_parquet([{lst}])
      where url_surtkey >= '{TLD},' and url_surtkey < '{TLD}-'
        and url_host_tld = '{TLD}' and fetch_status = 200 and content_mime_detected = 'text/html'
        and split_part(content_languages, ',', 1) in ({langs})
    """).fetchall()
    print(f"{len(rows)} foreign-language .in pages ({time.time()-t:.0f}s)", flush=True)
    # one representative page per domain: prefer an inner page (hidden hacks), keep page count
    by = {}
    for d, url, host, langs, ft, wf, off, ln, home in rows:
        if not d or any(s in host for s in SKIP_HOSTS): continue
        e = by.setdefault(d, {"pages": 0, "rec": None})
        e["pages"] += 1
        if e["rec"] is None or (e["rec"]["home"] and not home):
            e["rec"] = {"url": url, "host": host, "langs": langs, "time": str(ft), "warc": wf, "off": off, "len": ln, "home": home}
    doms = sorted(by.items(), key=lambda kv: -kv[1]["pages"])[:MAX_DOMAINS]
    print(f"{len(by)} domains, reading titles for {len(doms)}", flush=True)
    with ThreadPoolExecutor(8) as ex:
        titles = list(ex.map(lambda kv: warc_title(kv[1]["rec"]), doms))
    out = []
    for (d, e), title in zip(doms, titles):
        r = e["rec"]
        out.append({"domain": d, "host": r["host"], "url": r["url"], "scan_time": r["time"][:10],
                    "title": title, "server_country": None, "ip": None, "query": f"commoncrawl {CRAWL} lang={r['langs']}",
                    "source": "commoncrawl", "cc_pages": e["pages"], "cc_langs": r["langs"],
                    "urlscan_result": f"https://index.commoncrawl.org/{CRAWL}-index?url={r['url']}&output=json"})
    json.dump(out, open("candidates_cc.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"wrote candidates_cc.json: {len(out)} domains ({sum(1 for o in out if o['title'])} with titles)")

if __name__ == "__main__":
    main()
