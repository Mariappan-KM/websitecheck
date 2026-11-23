"""Optional LLM helper. OFF by default; everything works without it.

Settings live in research/llm.json (git-ignored):
    {"provider": "none" | "ollama" | "openai", "url": "...", "model": "...", "api_key": "", "timeout": 90}
  ollama : free local models (https://ollama.com), e.g. "llama3.2", "qwen2.5". url http://127.0.0.1:11434
  openai : any OpenAI-compatible endpoint — LM Studio, llama.cpp server, vLLM, or a paid API with your own key.

What it is used for (never as the only proof — the 4 gates still decide):
  page_opinion()     is this page injected spam (also English casino / pharma / loan spam)?
  extract_business() owner name, category, city, phone, email from the site's own text
Rules that keep false positives low:
  - the LLM can only move a result TO "Review", never to "CONFIRMED hacked";
  - phone / email it returns are kept only if they appear literally in the page text.
"""
import json, os, re, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
CONF = os.path.join(ROOT, "llm.json")
DEFAULT = {"provider": "none", "url": "http://127.0.0.1:11434", "model": "llama3.2", "api_key": "", "timeout": 90}

def config():
    try: c = {**DEFAULT, **json.load(open(CONF, encoding="utf-8"))}
    except Exception: c = dict(DEFAULT)
    c["api_key"] = c.get("api_key") or os.environ.get("LLM_API_KEY", "")
    return c

def save_config(c):
    keep = {k: c[k] for k in DEFAULT if k in c}
    json.dump({**DEFAULT, **keep}, open(CONF, "w", encoding="utf-8"), indent=1)

def enabled():
    return config()["provider"] in ("ollama", "openai")

def _post(url, body, key, timeout):
    h = {"Content-Type": "application/json"}
    if key: h["Authorization"] = "Bearer " + key
    with urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(body).encode(), headers=h), timeout=timeout) as r:
        return json.load(r)

def ask(system, user, c=None):
    """Send one prompt, return the parsed JSON object (or raise)."""
    c = c or config()
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    if c["provider"] == "ollama":
        j = _post(c["url"].rstrip("/") + "/api/chat", {"model": c["model"], "messages": msgs, "stream": False, "format": "json",
                                                         "options": {"temperature": 0}}, "", c["timeout"])
        text = j["message"]["content"]
    elif c["provider"] == "openai":
        base = c["url"].rstrip("/")
        if not base.endswith("/v1"): base += "/v1"
        j = _post(base + "/chat/completions", {"model": c["model"], "messages": msgs, "temperature": 0}, c["api_key"], c["timeout"])
        text = j["choices"][0]["message"]["content"]
    else:
        raise RuntimeError("LLM is off")
    m = re.search(r"\{.*\}", text or "", re.S)                  # models sometimes wrap JSON in prose / code fences
    if not m: raise ValueError("LLM did not return JSON")
    return json.loads(m.group(0))

def page_text(html, limit=3000):
    body = re.sub(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html or "", flags=re.I | re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body)).strip()[:limit]

SPAM_SYSTEM = ("You check whether a web page of a normal website contains injected spam that does not belong to the site: "
               "gambling / casino / slot / togel / betting, pharma, payday loans, adult, crypto scams, essay-writing or link-farm SEO text. "
               "A real casino or pharmacy business site is NOT injected spam. Reply with JSON only: "
               '{"spam": true|false, "kind": "gambling|pharma|loan|adult|crypto|seo-links|other|none", "confidence": 0.0-1.0, "reason": "one short sentence"}')

def page_opinion(domain, url, title, html, home_title=""):
    """LLM second opinion on one page. Returns dict or None (off / failed)."""
    if not enabled(): return None
    try:
        r = ask(SPAM_SYSTEM, f"Website: {domain}\nHomepage title: {home_title}\nPage URL: {url}\nPage title: {title}\nPage text:\n{page_text(html)}")
        return {"spam": bool(r.get("spam")), "kind": str(r.get("kind") or "none")[:20], "confidence": max(0.0, min(1.0, float(r.get("confidence") or 0))),
                "reason": str(r.get("reason") or "")[:200], "model": config()["model"]}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"[:200]}

BIZ_SYSTEM = ("Extract the business or organisation that owns this website, using ONLY what is written in the text. "
              "Never guess. Use \"\" for anything not written. Reply with JSON only: "
              '{"name": "", "category": "", "city": "", "country": "", "phone": "", "email": ""}')

def extract_business(html):
    """Owner details from the site's own (clean) page. Phone / email kept only if literally present."""
    if not enabled() or not html: return None
    text = page_text(html, 4000)
    try:
        r = ask(BIZ_SYSTEM, text)
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"[:200]}
    out = {k: str(r.get(k) or "").strip()[:120] for k in ("name", "category", "city", "country", "phone", "email")}
    digits = re.sub(r"\D", "", out["phone"])
    if digits and digits[-8:] not in re.sub(r"\D", "", text): out["phone"] = ""         # made up -> drop
    if out["email"] and out["email"].lower() not in (html or "").lower(): out["email"] = ""
    return out

def apply_opinion(r, op):
    """Move a verdict toward Review when the LLM disagrees confidently. Never confirms anything."""
    if not op or "error" in op: return r
    r["llm"] = op
    if op["confidence"] < 0.7: return r
    if r["verdict"] == "CONFIRMED hacked" and not op["spam"]:
        r["verdict"], r["state"], r["llm_note"] = "Review", "review", "LLM sees no spam on the page — please look before contacting"
    elif op["spam"] and (r["verdict"].startswith("Was hacked") or r["verdict"].startswith("Clean")):
        r["verdict"], r["state"], r["llm_note"] = "Review", "review", f"LLM sees {op['kind']} spam that the language check missed"
    return r

def test():
    c = config()
    if c["provider"] == "none": return {"ok": False, "error": "LLM is off (provider = none)"}
    try:
        r = ask('Reply with JSON only: {"ok": true}', "ping", c)
        return {"ok": bool(r.get("ok", True)), "model": c["model"], "provider": c["provider"]}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:300]}

if __name__ == "__main__":
    print(json.dumps(test()))
