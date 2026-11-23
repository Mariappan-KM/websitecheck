"""Discovery source: same-server neighbours (no account, no paid API).

A hacker who gets into one hosting account / server often plants spam on every site there.
  1. Domain list: every registered domain with the chosen ending in the Common Crawl month
     (cached in cc_domains_<crawl>_<tld>.txt).
  2. Resolve all of them to IP addresses with normal DNS (cached in dns_cache.json for 30 days;
     the first run takes long — about 1 hour for 220,000 .in domains).
  3. For every verified victim, the other domains on the same IP are its neighbours.
     IPs with more than MAX_PER_IP domains (CDNs, huge shared hosts) are skipped: sharing
     them says nothing.
  4. Each neighbour: homepage as browser and as Googlebot, plus the same path the spam had
     on the victim. A page in a spam language makes it a suspect; verify.py decides.

Output: candidates_sameip.json
Usage:  python collect_sameip.py [CRAWL_ID] [MAX_NEIGHBOURS] [--tld=in] [--max-resolve=N]
"""
import json, os, socket, sys, time, urllib.parse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import verify as V

ROOT = os.path.dirname(os.path.abspath(__file__))
CRAWL = next((a for a in sys.argv[1:] if a.startswith("CC-MAIN")), "CC-MAIN-2026-43")
MAX_NEIGHBOURS = next((int(a) for a in sys.argv[1:] if a.isdigit()), 300)
TLD = next((a[6:] for a in sys.argv[1:] if a.startswith("--tld=")), "in")
MAX_RESOLVE = next((int(a[14:]) for a in sys.argv[1:] if a.startswith("--max-resolve=")), 0)    # 0 = all
MAX_PER_IP = 50
CACHE = os.path.join(ROOT, "dns_cache.json")
TODAY = date.today().isoformat()

def domain_pool():
    """All registered .TLD domains in the crawl (+ our own suspects). Cached per crawl."""
    fn = os.path.join(ROOT, f"cc_domains_{CRAWL}_{TLD}.txt")
    if os.path.exists(fn):
        pool = open(fn, encoding="utf-8").read().split()
    else:
        import duckdb, collect_commoncrawl as CC
        CC.CRAWL = CRAWL
        con = duckdb.connect(); con.execute("INSTALL httpfs; LOAD httpfs;")
        t = time.time(); part = CC.files_for_tld(con, CC.index_files(), TLD)
        def one(f):                                    # one file at a time: a single big DISTINCT runs out of memory
            c = duckdb.connect(); c.execute("LOAD httpfs;")
            return {r[0] for r in c.execute(f"""select distinct url_host_registered_domain from read_parquet('{f}')
                     where url_surtkey >= '{TLD},' and url_surtkey < '{TLD}-' and url_host_tld = '{TLD}' and url_host_registered_domain is not null""").fetchall()}
        found = set()
        with ThreadPoolExecutor(4) as ex:
            for i, s_ in enumerate(ex.map(one, part), 1):
                found |= s_; print(f"  index file {i}/{len(part)}: {len(found)} domains so far", flush=True)
        pool = sorted(found)
        open(fn, "w", encoding="utf-8").write("\n".join(sorted(pool)))
        print(f"{CRAWL}: {len(pool)} .{TLD} domains listed ({time.time()-t:.0f}s)", flush=True)
    try: pool += [c["domain"] for c in json.load(open(os.path.join(ROOT, "candidates_all.json"), encoding="utf-8"))]
    except Exception: pass
    pool = list(dict.fromkeys(pool))
    return pool[:MAX_RESOLVE] if MAX_RESOLVE else pool

def resolve(domains, cache):
    """IP for every domain; cache entries younger than 30 days are reused."""
    old = (date.today() - timedelta(days=30)).isoformat()
    todo = [d for d in domains if d not in cache or cache[d][1] < old]
    print(f"{len(domains)} domains, {len(domains) - len(todo)} IPs cached, resolving {len(todo)}", flush=True)
    def one(d):
        try: return d, socket.gethostbyname(d)
        except Exception: return d, ""
    with ThreadPoolExecutor(100) as ex:
        for i, (d, ip) in enumerate(ex.map(one, todo), 1):
            cache[d] = [ip, TODAY]
            if i % 2000 == 0 or i == len(todo):
                print(f"[{i}/{len(todo)}] DNS lookups", flush=True)
                if i % 20000 == 0: json.dump(cache, open(CACHE, "w"))         # keep progress if stopped
    json.dump(cache, open(CACHE, "w"))
    return cache

def victims():
    rows = []
    try: rows += json.load(open(os.path.join(ROOT, "findings.json"), encoding="utf-8"))
    except Exception: pass
    folder = os.path.join(ROOT, "checks")
    for fn in (os.listdir(folder) if os.path.isdir(folder) else []):
        try: rows.append(json.load(open(os.path.join(folder, fn), encoding="utf-8")))
        except Exception: pass
    ok = ("CONFIRMED hacked", "Was hacked (spam gone now)", "Blocked by ISP as dangerous")
    return list({r["domain"]: r for r in rows if r.get("verdict") in ok}.values())

def look_neighbour(n, victim):
    """Is there a spam-language page on the neighbour? Homepage (browser, Googlebot) and the victim's spam path."""
    path = urllib.parse.urlparse(victim.get("page_url") or "").path
    tries = [(f"https://{n}/", V.BROWSER), (f"https://{n}/", V.GOOGLEBOT)]
    if path and path != "/": tries.append((f"https://{n}{path}", V.BROWSER))
    for url, ua in tries:
        st, final, _, html = V.fetch(url, ua=ua, timeout=20)
        if st == 200 and urllib.parse.urlparse(final).netloc.lower().removeprefix("www.").endswith(n) and V.lang_guess(html) in V.FOREIGN:
            return {"domain": n, "host": n, "url": url, "scan_time": TODAY, "title": V.title_of(html), "server_country": None,
                    "query": f"same server as {victim['domain']}", "source": "sameip", "via": victim["domain"],
                    "flagged": True, "flag_reason": "spam-language page " + ("for Googlebot" if ua == V.GOOGLEBOT else "on the same server as a victim")}
    return None

def main():
    pool = domain_pool()
    vic = victims()
    try: cache = json.load(open(CACHE))
    except Exception: cache = {}
    cache = resolve(list(dict.fromkeys(pool + [v["domain"] for v in vic])), cache)
    by_ip = defaultdict(list)
    for d in pool:
        ip = cache.get(d, [""])[0]
        if ip: by_ip[ip].append(d)
    known = set()
    for fn in ("findings.json", "candidates_all.json"):
        try: known |= {r["domain"] for r in json.load(open(os.path.join(ROOT, fn), encoding="utf-8"))}
        except Exception: pass
    pairs, seen, shared = [], set(), 0
    for v in vic:
        ip = cache.get(v["domain"], [""])[0]
        group = by_ip.get(ip, [])
        if not ip or len(group) > MAX_PER_IP: continue
        others = [n for n in group if n != v["domain"] and n not in known and n not in seen]
        if others: shared += 1
        for n in others: seen.add(n); pairs.append((n, v, ip))
    pairs = pairs[:MAX_NEIGHBOURS]
    print(f"{len(vic)} victims, {shared} share a server with other domains -> {len(pairs)} neighbours to look at", flush=True)
    out = []
    with ThreadPoolExecutor(16) as ex:
        for i, (res, (n, v, ip)) in enumerate(zip(ex.map(lambda p: look_neighbour(p[0], p[1]), pairs), pairs), 1):
            if res: res["ip"] = ip; out.append(res)
            if i % 10 == 0 or i == len(pairs): print(f"[{i}/{len(pairs)}] neighbours looked at, {len(out)} with spam-language pages", flush=True)
    json.dump(out, open(os.path.join(ROOT, "candidates_sameip.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"wrote candidates_sameip.json: {len(out)} new domains")

if __name__ == "__main__":
    main()
