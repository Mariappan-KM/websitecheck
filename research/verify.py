"""Verify suspect domains with public data only (no login, no probing of private paths).

For each domain:
  1. Live view as browser, Googlebot and mobile -> titles, final URL.
  2. Wayback history -> baseline (oldest copy that differs from today) and
     hijack window (last copy similar to baseline .. first copy similar to now).
     Similarity = title word overlap; no keyword lists.
  3. Registry (RDAP) -> registration date, last changed.
  4. Old-file gate -> site-specific files from the baseline still load on the live server.
  5. Baseline page -> platform, India signals, self-published phone / email.
Writes findings.json and ../preview/findings.js (loaded by the dashboard).
"""
import json, re, sys, time, gzip, zlib, ssl, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
MOBILE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
TODAY = date.today().isoformat()

NOVERIFY = ssl.create_default_context(); NOVERIFY.check_hostname = False; NOVERIFY.verify_mode = ssl.CERT_NONE

def decode(raw, headers):
    m = re.search(r"charset=([\w-]+)", headers.get("Content-Type", "") or "", re.I)
    cs = m.group(1) if m else None
    if not cs:
        mb = re.search(rb'<meta[^>]+charset=["\']?([\w-]+)', raw[:4000], re.I)
        cs = mb.group(1).decode() if mb else "utf-8"
    try: return raw.decode(cs)
    except Exception:
        try: return raw.decode("utf-8")
        except Exception: return raw.decode("cp1252", "replace")

def read_with_deadline(r, limit, deadline):
    """Read in chunks; stop at the byte limit or when the overall deadline passes."""
    chunks, total = [], 0
    while total < limit:
        if time.time() > deadline:
            raise TimeoutError("download took too long")
        c = r.read(min(65536, limit - total))
        if not c: break
        chunks.append(c); total += len(c)
    return b"".join(chunks)

def fetch(url, ua=BROWSER, timeout=25, head=False, limit=3_000_000, _insecure=False):
    """Return (status, final_url, headers, text). Never raises. Retries once without
    certificate checks (many small sites have broken TLS; we only read public pages)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Encoding": "gzip, deflate"},
                                     method="HEAD" if head else "GET")
        with urllib.request.urlopen(req, timeout=timeout, context=NOVERIFY if _insecure else None) as r:
            raw = b"" if head else read_with_deadline(r, limit, time.time() + 45)
            enc = r.headers.get("Content-Encoding", "")
            if enc == "gzip": raw = gzip.decompress(raw)
            elif enc == "deflate": raw = zlib.decompress(raw)
            return r.status, r.geturl(), dict(r.headers), decode(raw, r.headers)
    except urllib.error.HTTPError as e:
        try: body = decode(e.read(200_000), e.headers or {})
        except Exception: body = ""
        return e.code, url, dict(e.headers or {}), body
    except Exception as e:
        if not _insecure and ("CERTIFICATE" in str(e).upper() or "SSL" in str(e).upper()):
            return fetch(url, ua, timeout, head, limit, True)
        return 0, url, {}, ""

def title_of(html):
    m = re.search(r"<title[^>]*>(.*?)</title>", html or "", re.I | re.S)
    if not m: return ""
    t = re.sub(r"\s+", " ", m.group(1)).strip()
    return (t.replace("&amp;", "&").replace("&#8211;", "–").replace("&#039;", "'").replace("&quot;", '"'))[:200]

def words(t):
    return {w for w in re.findall(r"[a-z0-9]{3,}", (t or "").lower())}

def similar(a, b):
    wa, wb = words(a), words(b)
    if not wa or not wb: return 0.0
    return len(wa & wb) / len(wa | wb)

def lang_guess(text):
    """Small language hint from function words / scripts (not a spam word list)."""
    body = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", text or "", flags=re.I | re.S)
    title = re.search(r"<title[^>]*>(.*?)</title>", body, re.I | re.S)
    raw = re.sub(r"<[^>]+>", " ", body) + (" " + title.group(1)) * 3 if title else re.sub(r"<[^>]+>", " ", body)   # short spam pages: the title counts more
    # words only (so "ini," and "Ini:" count), lower-case
    t = " " + re.sub(r"[^\w฀-๿ऀ-ॿ]+", " ", raw.lower())[:30000] + " "
    # common everyday words of each language (vocabulary, not a spam list)
    score = {"Indonesian": sum(t.count(f" {w} ") for w in ["yang", "dan", "dengan", "untuk", "ini", "di", "anda", "kami", "dari", "hari", "resmi",
                                                            "terbaru", "terpercaya", "mudah", "bermain", "permainan", "menang", "akses", "masuk", "daftar", "situs"]),
             "English": sum(t.count(f" {w} ") for w in ["the", "and", "with", "for", "our", "you", "your", "are", "of"]),
             "Vietnamese": len(re.findall("[ăâđêôơưẠ-ỹ]", t)) // 6,
             "Thai": len(re.findall("[฀-๿]", t)) // 20,
             "Hindi": len(re.findall("[ऀ-ॿ]", t)) // 20}
    ranked = sorted(score.items(), key=lambda kv: -kv[1])
    (best, top), (_, second) = ranked[0], ranked[1]
    if top >= 5 and top > second: return best
    if top >= 3 and top >= 2 * second: return best          # short pages: clear majority is enough
    return "Unknown"

FOREIGN = {"Indonesian", "Thai", "Vietnamese"}

# ---------- Wayback ----------
def wayback_list(target):
    url = ("http://web.archive.org/cdx/search/cdx?url=" + urllib.parse.quote(target, safe="/:.") +
           "&output=json&fl=timestamp,statuscode&filter=statuscode:200&collapse=timestamp:6&from=2021")
    for attempt in range(4):                       # the archive's list service fails intermittently
        st, _, _, body = fetch(url, timeout=60)
        try:
            rows = json.loads(body)[1:]
            return [r[0] for r in rows]
        except Exception:
            if st == 200 and body.strip() in ("", "[]"): return []     # genuinely no copies
            time.sleep(2 + 3 * attempt)
    return []

def wayback_page(target, ts):
    for attempt in range(3):                       # archived pages also fail intermittently
        st, _, h, body = fetch(f"https://web.archive.org/web/{ts}id_/https://{target}", timeout=60)
        if st == 200 and body.strip(): return body, h
        if st in (404, 403): break
        time.sleep(2 + 3 * attempt)
    return body, h

def history(target, now_title):
    """Find baseline and hijack window with few requests (binary search over monthly copies)."""
    snaps = wayback_list(target)
    if not snaps: return {"snapshots": 0}
    cache = {}
    def t_at(i):
        if i not in cache:
            body, h = wayback_page(target, snaps[i]); cache[i] = (title_of(body), body, h); time.sleep(0.5)
        return cache[i][0]
    i0 = 0
    while i0 < min(5, len(snaps) - 1) and not t_at(i0): i0 += 1     # oldest copies can be empty (redirect / error page)
    if i0: snaps = snaps[i0:]; cache = {k - i0: v for k, v in cache.items() if k >= i0}
    first = t_at(0)
    out = {"snapshots": len(snaps), "oldest": snaps[0][:8], "oldest_title": first}
    if similar(first, now_title) >= 0.5 or not first:
        out["baseline_is_spam"] = bool(first) and similar(first, now_title) >= 0.5
        return out
    # binary search: last index whose title is closer to baseline than to now
    lo, hi = 0, len(snaps) - 1
    if similar(t_at(hi), first) >= similar(t_at(hi), now_title):
        lo = hi                                       # even the latest copy is still the business
    else:
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if similar(t_at(mid), first) >= similar(t_at(mid), now_title): lo = mid
            else: hi = mid
    out.update({"last_clean": snaps[lo][:8], "last_clean_title": t_at(lo),
                "first_spam_archive": snaps[hi][:8] if hi != lo else None,
                "baseline_ts": snaps[lo]})
    out["_baseline_html"], out["_baseline_headers"] = cache[lo][1], cache[lo][2]
    return out

# ---------- RDAP ----------
SECOND_LEVEL = ("co.in", "ac.in", "gov.in", "org.in", "net.in", "edu.in", "res.in", "nic.in", "firm.in", "gen.in", "ind.in",
                "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.id", "ac.id", "com.my", "com.sg", "co.za", "com.br")
def registrable(host):
    """alumni.example.ac.in -> example.ac.in (registry lookups need the registered domain, not a subdomain)."""
    parts = host.lower().split(".")
    n = 3 if ".".join(parts[-2:]) in SECOND_LEVEL else 2
    return ".".join(parts[-n:])

def rdap(domain):
    st, _, _, body = fetch("https://rdap.org/domain/" + domain, timeout=30)
    try:
        d = json.loads(body)
    except Exception:
        return {}
    ev = {e.get("eventAction"): (e.get("eventDate") or "")[:10] for e in d.get("events", [])}
    return {"registered": ev.get("registration", ""), "last_changed": ev.get("last changed", ""),
            "expires": ev.get("expiration", ""),
            "nameservers": [n.get("ldhName", "").lower() for n in d.get("nameservers", [])]}

# ---------- Baseline analysis ----------
def site_assets(html, domain):
    paths = set()
    for m in re.finditer(r'(?:src|href)=["\']([^"\'#?]+\.(?:png|jpe?g|webp|gif|svg|css))', html or "", re.I):
        u = m.group(1)
        if u.startswith("//"): continue
        if u.startswith("http"):
            host = urllib.parse.urlparse(u).netloc.lower()
            if not host.endswith(domain): continue
            u = urllib.parse.urlparse(u).path
        if "cdn-cgi" in u or "/wp-includes/" in u: continue     # generic files prove nothing
        paths.add("/" + u.lstrip("/"))
    return sorted(paths)[:6]

def old_assets_live(domain, html):
    tested, live = [], []
    for p in site_assets(html, domain):
        st, _, h, _ = fetch(f"https://{domain}{p}", head=True, timeout=20)
        if st != 200: st, _, h, _ = fetch(f"https://{domain}{p}", timeout=20)   # some servers refuse HEAD
        ct = (h.get("Content-Type") or h.get("content-type") or "")
        ok = st == 200 and "text/html" not in ct          # spam catch-all pages return HTML
        tested.append(p); (live.append(p) if ok else None)
        if len(live) >= 2: break
    return tested, live

def platform(html, headers):
    h = (html or "").lower()
    pw = " ".join(v for k, v in (headers or {}).items() if "powered" in k.lower()).lower()
    for name, pat in [("WordPress", "wp-content"), ("Shopify", "cdn.shopify|/cdn/shop/"), ("Wix", "wix.com|wixstatic"),
                      ("Squarespace", "squarespace"), ("Joomla", "joomla"), ("Drupal", "drupal"),
                      ("Webflow", "webflow"), ("Blogger", "blogger.com")]:
        if re.search(pat, h): return name
    if ".php" in h or "php" in pw: return "Custom PHP"
    return "Unknown"

INDIA_PLACES = r"\b(tamil nadu|kerala|karnataka|maharashtra|gujarat|delhi|mumbai|chennai|bengaluru|bangalore|hyderabad|kolkata|pune|jaipur|lucknow|noida|gurgaon|gurugram|kochi|coimbatore|madurai|tirunelveli|ahmedabad|surat|indore|bhopal|patna|chandigarh|jammu|srinagar|odisha|bhubaneswar|punjab|haryana|telangana|andhra pradesh|uttar pradesh|west bengal|bihar|rajasthan|assam|india)\b"
def india_signals(html):
    text = re.sub(r"<[^>]+>", " ", html or "")
    sig = []
    if re.search(r"\+91[\s-]?\d", text): sig.append("+91 phone")
    elif re.search(r"(?<!\d)[6-9]\d{9}(?!\d)", text): sig.append("10-digit Indian mobile")
    if re.search(r"(?<!\d)[1-8]\d{2}\s?\d{3}(?!\d)", text) and re.search(INDIA_PLACES, text, re.I): sig.append("PIN code + Indian place")
    m = re.search(INDIA_PLACES, text, re.I)
    if m: sig.append("Place: " + m.group(1).title())
    if "₹" in text or re.search(r"\bINR\b|\bRs\.?\s?\d", text): sig.append("₹ / INR")
    if re.search(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b", text): sig.append("GSTIN")
    if re.search(r"[ऀ-ॿ஀-௿ఀ-౿ഀ-ൿঀ-৿]{4,}", text): sig.append("Indian-language text")
    if re.search(r"justdial|indiamart", html or "", re.I): sig.append("JustDial / IndiaMART link")
    return sig

def contacts(html):
    text = re.sub(r"<[^>]+>", " ", html or "")
    phones = re.findall(r"(?:\+91[\s-]?)?(?<!\d)[6-9]\d{4}[\s-]?\d{5}(?!\d)", text)
    emails = re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}", html or "")
    emails = [e for e in emails if not re.search(r"\.(png|jpg|webp|svg)$|example|sentry|wixpress", e, re.I)]
    return list(dict.fromkeys(p.strip() for p in phones))[:3], list(dict.fromkeys(emails))[:3]

# ---------- One domain ----------
def strip_url(u):
    p = urllib.parse.urlparse(u)
    return (p.netloc.lower().removeprefix("www.") + (p.path or "/") + (("?" + p.query) if p.query else ""))

def verify(cand):
    d = cand["domain"]
    page_url = cand.get("url") or f"https://{d}/"
    if not urllib.parse.urlparse(page_url).netloc.lower().endswith(d): page_url = f"https://{d}/"
    inner = strip_url(page_url) not in (d + "/", "www." + d + "/")
    spam_title = cand.get("title") or ""

    # live: homepage + the exact page urlscan saw
    hs, hfinal, hhdr, home = fetch(f"https://{d}/")
    if hs == 0: hs, hfinal, hhdr, home = fetch(f"http://{d}/")
    home_title = title_of(home)
    if inner:
        ps, pfinal, _, page = fetch(page_url); page_title = title_of(page)
    else:
        ps, pfinal, page, page_title = hs, hfinal, home, home_title
    dead = hs == 0 and ps == 0                      # site not reachable: skip the extra views
    g_title = "" if dead else title_of(fetch(page_url, GOOGLEBOT)[3])
    m_title = "" if dead else title_of(fetch(page_url, MOBILE)[3])
    try:   # visitor arriving from a Google search (some hacks only show spam then)
        if dead: raise TimeoutError("site down")
        rq = urllib.request.Request(page_url, headers={"User-Agent": BROWSER, "Referer": "https://www.google.com/"})
        with urllib.request.urlopen(rq, timeout=25, context=NOVERIFY) as rr: ref_title = title_of(decode(read_with_deadline(rr, 3_000_000, time.time() + 45), rr.headers))
    except Exception: ref_title = ""

    # Does the page still show what was seen earlier, and does its language belong to the site?
    page_lang, home_lang = lang_guess(page), lang_guess(home)
    from_title_search = cand.get("source", "urlscan") in ("urlscan", "snowball") or bool(cand.get("flagged"))   # title already a spam brand / page flagged by check_site
    page_foreign = page_lang in FOREIGN or from_title_search
    home_foreign = home_lang in FOREIGN
    same_page = bool(page_title) and similar(page_title, spam_title) >= 0.4
    still_spam = same_page and page_foreign
    cloak_spam = (not still_spam) and any(t and similar(t, spam_title) >= 0.4 for t in (g_title, m_title, ref_title)) and (from_title_search or page_foreign)
    # hidden hijack: an inner page in a foreign language on a site whose homepage is not foreign
    lang_mismatch = page_foreign and not home_foreign and home_lang != "Unknown"
    home_is_business = (inner and bool(home_title) and not home_foreign
                        and (lang_mismatch or (similar(home_title, spam_title) < 0.2 and similar(home_title, page_title) < 0.3)))
    # whole-site foreign language: legit foreign-language site unless the archive shows a non-foreign business
    foreign_site = False
    if home_foreign:
        hh0 = history(d + "/", home_title)
        base_lang = lang_guess(hh0.get("_baseline_html", ""))
        foreign_site = base_lang in FOREIGN or not hh0.get("last_clean_title")

    hist = history(strip_url(page_url), page_title or spam_title)
    base_html = hist.pop("_baseline_html", ""); base_hdr = hist.pop("_baseline_headers", {})
    if not base_html and inner:                    # no archive of the inner page -> homepage history
        hh = history(d + "/", home_title or spam_title)
        base_html = hh.pop("_baseline_html", ""); base_hdr = hh.pop("_baseline_headers", {})
        hist["home_history"] = hh
    reg = rdap(registrable(d))
    tested, live = old_assets_live(d, base_html) if base_html else ([], [])
    profile_html = home if home_is_business else base_html          # where business details come from
    phones, emails = contacts(profile_html)
    sig = india_signals(profile_html)
    if cand.get("server_country") == "IN": sig.append("Server hosted in India")
    fdom = urllib.parse.urlparse(pfinal).netloc.lower()
    orig = {k[len("x-archive-orig-"):]: v for k, v in base_hdr.items() if k.lower().startswith("x-archive-orig-")}
    r = {
        "domain": d, "checked": TODAY, "page_url": page_url, "inner_page": inner,
        "home_status": hs, "home_title": home_title, "page_status": ps, "page_title": page_title,
        "googlebot_title": g_title, "mobile_title": m_title, "google_referrer_title": ref_title, "final_url": pfinal,
        "redirect_offsite": bool(fdom) and not fdom.endswith(d),
        "page_lang": page_lang, "home_lang": home_lang, "foreign_site": foreign_site,
        "urlscan_title": spam_title, "urlscan_time": (cand.get("scan_time") or "")[:10], "source": cand.get("source", "urlscan"),
        "server_country": cand.get("server_country"), "ip": cand.get("ip"),
        "still_spam": still_spam, "spam_only_for_google_or_mobile": cloak_spam, "home_is_business": home_is_business,
        **hist, **{"rdap_" + k: v for k, v in reg.items()},
        "assets_tested": tested, "assets_live": live,
        "platform": platform(profile_html or base_html, orig),
        "india_signals": sig, "phones": phones, "emails": emails,
        "business_title": home_title if home_is_business else (hist.get("last_clean_title") or (hist.get("home_history") or {}).get("last_clean_title")),
    }
    lc = hist.get("last_clean") or (hist.get("home_history") or {}).get("last_clean")
    lc_date = f"{lc[:4]}-{lc[4:6]}-{lc[6:8]}" if lc else None
    gates = {
        # a real business owns the site: homepage is still the business, or the archive shows it before the spam
        "past_business": home_is_business or (bool(hist.get("last_clean_title")) and not hist.get("baseline_is_spam")),
        # not re-bought: registered before the last clean copy, or the owner's homepage is still live
        "no_registration_gap": home_is_business or (bool(reg.get("registered")) and bool(lc_date) and reg["registered"] <= lc_date),
        # same server: owner's homepage is live next to the spam page, or old site files still load
        "old_assets_live": home_is_business or bool(live),
        # spam seen by urlscan on an earlier day AND by us today
        "seen_twice": (still_spam or cloak_spam) and r["urlscan_time"] != TODAY,
    }
    r["gates"] = gates
    down = lambda st, t: st == 0 or st >= 500 or bool(re.search(r"bandwidth limit|account suspended|service unavailable", t or "", re.I))
    if down(hs, home_title) and down(ps, page_title): r["verdict"] = "Down / unreachable (re-check)"
    elif foreign_site: r["verdict"] = "Not a lead (foreign-language site)"
    elif not (still_spam or cloak_spam): r["verdict"] = "Was hacked (spam gone now)"
    elif hist.get("baseline_is_spam") and not home_is_business: r["verdict"] = "Not a lead (spam since first copy)"
    elif all(gates.values()): r["verdict"] = "CONFIRMED hacked"
    else: r["verdict"] = "Review"
    if r["verdict"] == "CONFIRMED hacked":
        r["state"] = "hacked_hidden" if (inner and home_is_business) or cloak_spam else "hacked_visible"
    else:
        r["state"] = {"Was hacked (spam gone now)": "was_hacked"}.get(r["verdict"], "excluded" if r["verdict"].startswith("Not a lead") else "review")
    r["india"] = d.endswith(".in") or len([x for x in sig if x != "Place: India"]) >= 2
    return r

# Shared hosting / free-site platforms: a hit there is a throwaway site, not a business owner.
PLATFORM_HOSTS = ("temporary.site", "mybluehost.me", "pages.dev", "netlify.app", "vercel.app", "github.io",
                  "wixsite.com", "blogspot.com", "web.app", "firebaseapp.com", "herokuapp.com", "000webhostapp.com")

def post_check(r, cand):
    """False-positive guards applied after verification."""
    host = (urllib.parse.urlparse(cand.get("url") or "").netloc or "").lower()
    # India needs a strong signal: weak ones alone (10-digit number, Indian server, "India" word) mislabel foreign sites
    strong = [x for x in r["india_signals"] if x in ("+91 phone", "PIN code + Indian place", "GSTIN", "₹ / INR", "Indian-language text")]
    r["india"] = r["domain"].endswith(".in") or (len(strong) >= 1 and len([x for x in r["india_signals"] if x != "Place: India"]) >= 2)
    # permanent proof: urlscan result page + screenshot taken when the spam was live
    for k in ("urlscan_result", "urlscan_screenshot"):
        if cand.get(k): r[k] = cand[k]
    # ISP block page (e.g. "Airtel found this site dangerous!") = the site is flagged, not clean
    isp = re.compile(r"found this (site|website) dangerous|blocked as per|site (is|has been) blocked|dangerous site", re.I)
    if any(isp.search(r.get(k) or "") for k in ("page_title", "home_title")):
        r["verdict"], r["state"], r["isp_blocked"] = "Blocked by ISP as dangerous", "hacked_visible", True
    if r["domain"] in PLATFORM_HOSTS or host.endswith(PLATFORM_HOSTS):
        r["verdict"], r["state"] = "Not a lead (hosting platform subdomain)", "excluded"
    # spammer-owned: the domain name itself appears in the spam brand (e.g. kumbang78.com -> "KUMBANG78")
    label = re.sub(r"[^a-z0-9]", "", r["domain"].split(".")[0])
    if (not r["verdict"].startswith("Not a lead (foreign") and len(label) >= 5 and label in re.sub(r"[^a-z0-9]", "", (cand.get("title") or "").lower()) and not r.get("home_is_business")
            and (r.get("home_lang") in FOREIGN or similar(r.get("home_title") or "", cand.get("title") or "") >= 0.4)):
        r["verdict"], r["state"] = "Not a lead (spammer-owned domain)", "excluded"
    return r

def write_outputs(out):
    out.sort(key=lambda r: (r["verdict"] != "CONFIRMED hacked", not r["india"], r["domain"]))
    json.dump(out, open("findings.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    with open("../preview/findings.js", "w", encoding="utf-8") as f:
        f.write("// generated by research/verify.py on " + TODAY + "\nwindow.FINDINGS = ")
        json.dump(out, f, ensure_ascii=False)
        f.write(";\n")
    print(f"wrote findings.json and ../preview/findings.js ({len(out)} sites)")

def main():
    """python verify.py [candidates file] [--new-only]
    --new-only: skip domains already in findings.json and merge the new results into it."""
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    new_only = "--new-only" in sys.argv
    import atexit, os
    lock = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".verify.lock")
    open(lock, "w").write(str(os.getpid())); atexit.register(lambda: os.path.exists(lock) and os.remove(lock))
    cands = json.load(open(args[0] if args else "candidates.json", encoding="utf-8"))
    old = json.load(open("findings.json", encoding="utf-8")) if new_only else []
    known = {r["domain"] for r in old}
    seen = set(); todo = []
    for c in cands:
        if c["domain"] in known or c["domain"] in seen: continue
        seen.add(c["domain"]); todo.append(c)
    print(f"{len(todo)} to verify ({len(cands) - len(todo)} skipped as already known)", flush=True)
    out = []
    with ThreadPoolExecutor(8) as ex:
        futs = [ex.submit(lambda c=c: post_check(verify(c), c)) for c in todo]
        for i, fut in enumerate(as_completed(futs), 1):
            try: r = fut.result()
            except Exception as e:
                print(f"[{i}/{len(todo)}] error: {type(e).__name__}: {e}", flush=True); continue
            out.append(r)
            print(f"[{i}/{len(todo)}] {r['domain']:<34} {r['verdict']:<34} india={str(r['india']):<5} gates={sum(r['gates'].values())}/4 {'inner' if r['inner_page'] else 'home'}", flush=True)
            if new_only and i % 25 == 0: write_outputs(old + out)      # checkpoint
    write_outputs(old + out)

def recheck_only():
    """Re-apply post_check to an existing findings.json without re-fetching."""
    cands = {}
    for fn in ("candidates.json", "candidates_cc.json", "candidates_snowball.json"):
        try: cands.update({c["domain"]: c for c in json.load(open(fn, encoding="utf-8"))})
        except FileNotFoundError: pass
    out = [post_check(r, cands.get(r["domain"], {"url": r.get("page_url"), "title": r.get("urlscan_title")}))
           for r in json.load(open("findings.json", encoding="utf-8"))]
    json.dump(out, open("findings.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    with open("../preview/findings.js", "w", encoding="utf-8") as f:
        f.write("// generated by research/verify.py on " + TODAY + "\nwindow.FINDINGS = ")
        json.dump(out, f, ensure_ascii=False); f.write(";\n")

if __name__ == "__main__":
    recheck_only() if "--post-only" in sys.argv else main()
