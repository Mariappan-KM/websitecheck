# Agent.md — SiteWatch India

## Status (2026-11-22)
- `PRODUCT_PLAN.md` — product plan.
- `preview/index.html` — static UI preview (no server). Python backend not built yet.
- `preview/shots/` — screenshots (desktop 1280, mobile 390).

## Principle: stop false positives first
Calling a business whose site is not hacked looks like a scam call. So:
1. Checks + confirmation gates decide the computed state.
2. A human must **approve** a site before it appears in Follow-ups.
3. Every **false positive** marked suggests a rule (or allowlist / spammer list) that stops similar ones.

## Tabs
| Tab | Purpose |
|---|---|
| Overview | KPIs per state + charts: lead funnel, score vs thresholds, hijack timeline, campaigns |
| Sites | Search / filter / CSV, click row → full report drawer (Decision, before/after, business, technical, all signals, matched custom rules, follow-up) |
| Follow-ups | Only **approved** (or already contacted) leads, never false positive / excluded. Overdue / today / upcoming / unscheduled |
| Rules & domains | ONE page: add domains, allowlist & spammer list, review queue (approve / mark FP), FP list with suggested rules, custom rule builder with test-before-save, thresholds + live score chart, rule quality chart, platforms → likely cause, evidence matrix, built-in checks with hit/FP stats, sources, India check, schedule, change history + undo, export/import |
| Daily runs | Run log |

## Scoring order (`score(site, cfg)`)
1. Built-in checks: affected weights → affected score; risk weights → risk score; gates collected.
2. Custom rules (enabled, matching): `exclude`, `force` (first wins), `add` / `subtract` score.
3. Computed state: confirm + all gates → Hacked (visible/hidden); ≥ review → Review; history → Was hacked; risk → At risk; else Clean.
4. Overrides in priority: allowlist → Clean; spammer list → Excluded; FP mark → False positive; custom exclude → Excluded; custom force → that state.
`r.why` explains any override; `r.computed` keeps the checks-only state.

## Custom rules
`{id,name,enabled,match:"all"|"any",conds:[{field,op,value}],action:{type,value},created,from}`
- Fields: domain, tld, title now/before, language now, platform, campaign, category, registered, india, or any check result (`signal:<id>`).
- Ops: contains (`a|b|c`), does not contain, equals, regex, date before/after, is true/false/pending.
- Invalid regex / empty value → cannot save; if present in imported config the rule is skipped and flagged.
- Test shows matched sites, state changes, and warns if it matches an approved lead.

## FP → suggested rule
| Reason | Suggestion |
|---|---|
| Real gambling | domain contains spam tokens → exclude; else title before contains gambling words → exclude |
| Sold / re-bought | `past_business` is false → exclude; else `old_assets_live` is false → force Review |
| Owner changed / already fixed | allowlist |
| Other | domain equals → exclude |

## Any platform
`config.platforms` = `match|match = likely cause` lines (WordPress, Joomla/Drupal/Magento, custom PHP, Shopify/Wix/Squarespace, static, `*` fallback). Risk checks renamed to be platform-neutral (ids unchanged for saved configs).

## Storage (browser localStorage; real app → SQLite)
`sw.config`, `sw.follow`, `sw.fps`, `sw.approved`, `sw.extra`, `sw.undo` (last 20 rule/list snapshots), `sw.changes`, `sw.theme`.
`normalizeConfig()` upgrades older saved configs: adds missing keys, refreshes built-in rule names, adds new built-in rules, keeps user weights.

## Charts
HTML marks, palette validated with the dataviz validator (blue `#2a78d6`/`#3987e5`, orange `#eb6834`/`#d95926`, light+dark pass). Hover/tap tooltips on every mark. Single-series charts have no legend; two-series charts have a legend. Matrix uses fill / outline / hatch so it is not colour-only.

## Verified (Playwright, 2026-11-22)
- Old saved config migrates (1 rule → 18 rules, platforms added, custom array).
- Mark a sold domain FP (sold) → suggestion "past_business is false → exclude" → test → save.
- Invalid regex `(slot` blocked with message.
- Rule test: `title_now contains maniak → force At risk` shows 2 state changes before saving.
- Approve the first victim site → appears in Follow-ups; FP site does not.
- Undo reverts the last rule change.
- No console errors; no horizontal page scroll at 1280 and 390.

## Lessons from real data
- Old-file gate must ignore `/cdn-cgi/` and third-party CDN files.
- Oldest Wayback copy can already be spam (a sold domain) → not a hack lead.
- Victims run Shopify / Squarespace too → likely cause depends on platform.

## Research pipeline (research/)
1. `collect_urlscan.py` → `candidates.json`: urlscan public search, servers hosted in India (`page.country:IN`) + spam-title seed. Saves urlscan result + screenshot links (permanent proof).
2. `verify.py` → `findings.json` + `preview/findings.js` (dashboard loads it). Per domain, public data only:
   - live views of homepage AND the exact infected URL: browser, Googlebot, iPhone, Google-referrer
   - Wayback CDX + binary search → last clean copy / hijack window (title-similarity, no keyword list)
   - RDAP registration, old site-specific files still live (ignores /cdn-cgi/, wp-includes, third-party CDNs)
   - platform, India signals, self-published phone/email from the business page
   - gates: past_business, no_registration_gap, old_assets_live, seen_twice (urlscan earlier day + us today)
   - `post_check` FP guards: hosting-platform subdomains, spammer-owned domain names, ISP block pages, strict India rule (needs a strong signal)
   - `python verify.py --post-only` re-applies guards without re-fetching.
3. Results 2026-11-22 (49 suspects): 7 CONFIRMED (5 India), 19 was-hacked (spam gone), 10 review, 5 down, 7 not a lead, 1 ISP-blocked.

## Key lessons
- 29/49 hits were on inner pages; homepage looked normal → "Hacked – hidden" is the main lead type.
- Spam pages are rotated/removed fast → keep urlscan screenshot as proof; re-verify before any call.
- the first victim site: 10 of 12 sitemap pages rented to 11 gambling brands; /index.php still original; same Plesk/PHP 8.1.34/Cloudflare stack before and after → hosting access abused (.htaccess / DirectoryIndex rewrite). Clean until 2026-08-11; registry change 2026-08-27.

## UI theme (2026-11-22)
- Light theme only, from `stitch_modern_ui_redesign/.../threat_intelligence_secops_portal/DESIGN.md` (+ `sitewatch_india_modern_light_threat_overview` screen).
- Dark mode removed (no `prefers-color-scheme` / `data-theme` / theme button); old `sw.theme` key is cleared on load.
- Tokens: canvas #f8fafc, cards #fff + 1px #e2e8f0 + soft shadow, radius 16px (cards) / 8px (controls); primary indigo #4f46e5, cobalt #2563eb, crimson #dc2626 (confirmed hacked only), amber (review), emerald (clean).
- Fonts: Plus Jakarta Sans (headings), Manrope (body), JetBrains Mono (ids); icons: Material Symbols Outlined (Google Fonts).
- Shell: left sidebar (nav with live counts + scope summary), sticky top header (global search, India/Global switch, Run daily scan). Below 1024px the sidebar becomes a horizontal nav strip.
- Charts: indigo #4f46e5 + orange #ea580c (dataviz validator: all checks pass on light).
- Only the visual style was taken from the Stitch screens; their sample content (WhatsApp button, accuracy %, CVE text) was not copied — the dashboard shows only verified data.

## UI v2 — exact Stitch design (2026-11-22)
Built from `stitch_modern_ui_redesign/.../sitewatch_india_threat_lead_registry_table_view`, `..._national_threat_defacement_registry`,
`..._table_customizer_deep_dive_drawer` (look + markup) and `..._modern_table_view_deep_inspector` (options only). Plan board: `design_plan/index.html`.

Files (preview/):
- `index.html` — shell copied from the design: Tailwind CDN + the design's tailwind config (Noto Serif / Inter / Public Sans, primary #094cb2), sidebar, top bar, drawer, modal. Light only.
- `core.js` — data + logic, extracted unchanged from v1 (seed, config, scoring, custom rules, FP, approvals, storage, CSV).
- `app.js` — the six pages and components (design classes). `v1-backup.html` = previous page.
- `findings.js` (research/verify.py), `evidence.js` + `evidence/*.jpg` (research/capture.py: archive vs live screenshots, live headers as browser + Googlebot).

Pages (sidebar):
| Page | Contents |
|---|---|
| Surveillance Matrix | alert strip, title + Run Daily Sweep / STIX / CSV, search + pill filters + removable constraints, hero victim card (approve before outreach), 5 metrics, G1–G4 funnel (live counts), syndicate share bars, registry table, forensic dossier |
| Compromised Leads | title + LIVE badge, CSV / STIX / Batch Outreach, Split Inspector ↔ Full Canvas, 5 KPIs, filters (jurisdiction, gates, severity, syndicate), density ×3, columns modal, presets (India, Confidence 90+, Phone ready, Show excluded), bulk bar (approve / dispatch / CERT-In STIX), sortable paged table, live inspector, dossier, 3 info cards |
| Gate Funnel & Rigor | review queue, false positives + suggested rules, custom rule builder (test before save), thresholds + score chart, allow/spammer lists, rule quality, evidence matrix, built-in checks, history + undo, rules.json import/export |
| Syndicate Tracking | Matrix (brand cards, share, sites) / Syndicate Graph (brand → sites) |
| CERT-In Outreach | approved leads only: KPIs, overdue / today / upcoming / unscheduled, public bodies → CERT-In |
| System Settings | add domains, sources, India rule, platforms → cause, schedule + run log, rules import/export |

Shared: deep-dive drawer (visual diff, owner channel, 4-view telemetry + headers, remediation checklist, follow-up log, dossier .json, mark handled), Customize Columns modal (4 presets, drag/arrow reorder, required column locked, saved in `sw.cols`).

Rules kept from the design but made honest:
- Posture score /100 = evidence score (60, capped at 2× confirm threshold) + 10 per gate passed (40).
- WhatsApp / outreach buttons only for approved leads; prepared English advisory with proof link; owner name always "Not verified".
- Remediation steps are a checklist (we never act on the owner's server). Hosting "hubs", DEFCON, accuracy %, fake headers removed.
- New storage keys: `sw.tab`, `sw.cols`, `sw.density`, `sw.split`, `sw.remed`, `sw.flags` (old keys unchanged).

Verified (Playwright, 41/41): scope + badges, pagination, filters, omni search, approval gate for WhatsApp, inspector approve, columns presets, density, split/full, bulk approve, drawer (real email, follow-up log, remediation, dossier json), STIX + CSV downloads, FP → suggested rule → save, invalid regex blocked, undo, live re-score, outreach shows approved only, India/Global, header search, persistence after reload, no console errors, mobile 390px no overflow + menu.

## Local server + Run Search (2026-11-22)
- Start: double-click `start.bat` (or `python server.py`) → http://127.0.0.1:8790 (port 8790 because 8765 is used by another local server.py). Listens on 127.0.0.1 only.
- `server.py` (stdlib only) serves `preview/` and: `GET /api/defaults`, `POST /api/search`, `GET /api/status`. One run at a time; POST checks Origin (blocks other websites) and validates values.
- Run = `collect_commoncrawl.py` → `snowball.py` → `verify.py candidates_new.json --new-only` → `capture.py`; new candidates also appended to `candidates_all.json`. Log: `research/server_run.log`.
- Defaults shown in the form: Common Crawl ✓, Snowball ✓, urlscan ✗ (needs key), latest crawl month, langs ind/tha/vie/msa, ending `in`, max 400, 60 per brand, only new ✓, screenshots ✓.
- Dashboard: "Run Daily Sweep" (Surveillance Matrix), "Run Search" (System Settings) and the top-bar engine label open the form / progress. Polls status every 2 s while running, reloads when done. Opened as a file it explains how to start the server.
- `verify.py` writes `research/.verify.lock` while running; the server refuses a second run while it exists.

## Discovery wave 2 (no account needed)
- `collect_commoncrawl.py [CRAWL] [MAX] --langs=ind,tha,vie,msa --tld=in`: reads Common Crawl's columnar index with DuckDB (only files whose SURT range covers `in,`), keeps pages whose main language is foreign, reads the archived page title from the WARC record. CC-MAIN-2026-43: 110,416 pages on 3,169 .in domains.
- `snowball.py [PER_BRAND]`: brands on verified victims (+ first-victim brands) → public urlscan title search → new domains (442 on first run).
- verify.py language rule (fixes false positives found on the first CC run — Indonesian news / adult sites were marked hacked):
  - hidden hijack = inner page in Indonesian/Thai/Vietnamese on a site whose homepage is not foreign;
  - homepage foreign now AND foreign (or absent) in the archive → "Not a lead (foreign-language site)";
  - spammer-owned only when the homepage itself is foreign/spam (a business name in its own title is normal).
- verify.py robustness: 45 s hard deadline per download (one site hung forever), results recorded as each site finishes (`as_completed`), dead sites skip extra views, checkpoint every 25.

## Search Reports + Follow-ups pages (2026-11-22)
- Every search started from the dashboard is saved in `research/runs.json` (and `preview/runs.js` for file mode): sources, what was looked at (CC pages/domains, snowball brands), suspects (skipped older than "since" / already known), verified, groups confirmed / was hacked / review / not a lead / issues (+ India counts), errors, duration, per-group domain lists. API: `GET /api/runs`.
- Search form adds "Only suspects first seen since" (default today; CC is monthly so recent dates keep mostly Snowball finds) and "Re-check issues" (re-verifies down/unreachable sites).
- Sidebar: Follow-ups (badge = due today + overdue; overdue / today / upcoming / not scheduled / closed) and Search Reports (run table → run details → site drawer). CERT-In Outreach now = approved-not-contacted + public bodies + exports.
- Auto-reload removed: when a run finishes a bar offers Reload / Report (a reload used to close the drawer and lose typed follow-up notes).

## Site Check — one website, full details (2026-11-22)
- `research/check_site.py <domain|url> [--no-capture]`: homepage + up to 30 sitemap pages + earlier sightings (our own candidates/results, public urlscan scans of the domain, Common Crawl index with 3 retries) → every page fetched as a browser: title + language → suspicious score (foreign language on a non-foreign site +3, Common Crawl foreign capture +2, title carries a learned spam brand +2, given URL +1) → `verify()` on the most suspicious page → screenshots. Earlier foreign/spam sightings of the same site (before today) count for G4 even if the page URL changed.
- Learned brands: tokens from verified spam titles that contain a digit or appear on 3+ hacked sites; real Indian terms (FSSAI, NAAC, GST…) excluded.
- Verdicts: Hacked / Was hacked / Blocked by ISP / Review / Clean (no spam found) / Unreachable / Not a lead.
- Output `research/checks/<domain>.json` + `preview/checks.js`; never writes findings.json (safe during a big run). The dashboard merges checks over search results.
- Server: `POST /api/check {target}`, `GET /api/check-status`, `GET /api/checks` (one check at a time, Origin check, input validated).
- UI: sidebar "Site Check" (input, progress, verdict banner, gate explanations, pages table, earlier sightings, dossier, history). Top search: unknown website → "Check <site> now".
- verify.py: archive list + archived pages retried (the archive fails intermittently and was causing false "no business before"); oldest empty-title copies skipped.
- Windows note: stopping a background task does not kill its python child; python's HTTP server allows several listeners on one port, so restart = close the start.bat window first.

## Fix: a college sub-site page reported as not hacked (2026-11-22)
Root causes (verify.py): (1) language detector needed 5 function words, short image-heavy spam pages → "Unknown" → spam not counted; (2) check_site's suspicious flag (learned brand SLOT88) was not passed to verify; (3) RDAP looked up the subdomain.
Fixes: lang_guess counts words (punctuation-safe), weights the <title>, wider everyday Indonesian vocabulary, short-page majority rule; cand["flagged"] from check_site counts like a title-search source; `registrable()` (handles .ac.in/.co.in/… second levels) for RDAP. Regression: 17/18 known cases unchanged; a clean test site moved foreign-site → Review (archive English, now Vietnamese = hacked or re-bought → human review).
UI: Review with gates 1–3 passed and spam live now → "Hacked — seen today, confirm tomorrow"; gate 4 shown as pending ("seen once").
Note: the 906-site results were computed before this fix; short-page spam sites may sit in "Was hacked"/"Review" — re-verify them with the new logic.
- Inline follow-up box (`followBox`/`bindFollowBoxes` in app.js) on the Site Check result and in the Leads inspector: status, next date (+ Tomorrow / +3 days / +1 week), type + note → Log (Enter works). Logging an Email/Call/WhatsApp/Visit on a "New" lead moves it to Emailed/Called, so it appears in Follow-ups. Status changes are logged too.
- Result filter (`resultOf()` in app.js): every site gets one outcome from the verifier — Hacked confirmed / Hacked seen once / Review / Was hacked / Page not found (404, spam page removed) / Unreachable (no answer or 5xx) / Blocked by ISP / Clean / Foreign-language site / Not a lead / Marked false positive / Manual. Shown under the posture tag (with HTTP code), as a "Result" dropdown (Leads) and pill (Matrix) with counts, plus chips "Unreachable" and "Page Not Found". For Unreachable / 404 / Seen once / Review a "Check these again" button queues the filtered sites (max 20) in Site Check. core.js keeps `verdict`, `pageStatus`, `homeStatus` on each site.

## Open source (2026-11-23)
- Private data (victim lists, screenshots, seed sites, plan) is git-ignored; seed sites live in local `preview/seed.js` and `research/seeds.json`.
- `README.md` — what it is, why (help owners clean hacked sites), quick start, how it finds/decides, owner cleanup checklist, responsible use, limits.
- `start.sh` (macOS/Linux, picks the first python3/python that is 3.10+, opens the browser with open/xdg-open) mirrors `start.bat`. `.gitattributes` keeps LF for .sh, CRLF for .bat.
- `LICENSE` — MIT. `requirements.txt` — duckdb, playwright (`python -m playwright install chromium`).

## New discovery sources + optional LLM (2026-11-23)
Tested first: victim spam pages do NOT link to other victims (6 confirmed victims: 0 `.in` links; they link to the spammer's landing / image hosts). So no link-graph source.
- `research/collect_assets.py [MAX_HOSTS]` — "Shared spam files". Live spam pages of verified victims (findings + checks: CONFIRMED / ISP / Review with past_business, still showing spam) → outside hosts in src/href (COMMON regex drops CDNs, fonts, analytics, social) → ranked by number of victims → urlscan public `domain:HOST` search → pages whose *title* is in a spam language (lang_guess on the title; drops normal sites that load e.g. bbb.org). Output `candidates_assets.json`, source `assets` (not a title-search source: live page language decides).
- `research/collect_sameip.py [CRAWL] [MAX_NEIGHBOURS] --tld= --max-resolve=` — "Same-server neighbours". Domain pool = distinct registered domains of the TLD in the crawl (DuckDB per index file; one big DISTINCT ran out of memory) cached in `cc_domains_<crawl>_<tld>.txt`, + candidates_all. DNS (100 threads, ~60/s) cached in `dns_cache.json` 30 days. Victims (CONFIRMED / Was hacked / ISP) → same-IP domains, IPs with > 50 domains skipped. Neighbour: homepage as browser + Googlebot + the victim's spam path; spam-language page → candidate (`flagged`, source `sameip`, `via`). scan_time = today → G4 needs a later re-check.
- `research/llm.py` — provider none (default) | ollama | openai-compatible; config `research/llm.json` (git-ignored), key also from env `LLM_API_KEY`. `page_opinion()` (spam/kind/confidence/reason), `extract_business()` (phone/email dropped unless literally in the page text), `apply_opinion()`: confidence ≥ 0.7 → CONFIRMED + "no spam" → Review; Was hacked / Clean + "spam" → Review; never confirms. verify.py calls it only when enabled and the site is not dead / not a lead; check_site re-applies after its "Clean" override.
- server.py: sources `assets` (default on), `sameip` (default off), params `max_hosts` 1–200, `max_neighbours` 1–5000; `GET/POST /api/llm` (key masked as ••••last4; masked value = keep saved key), `POST /api/llm-test`; run report counts `sources.assets/sameip`, `looked_at.spam_hosts/neighbours`.
- UI: Search dialog has the two new sources + their limits + "AI second opinion: on/off" line; Settings → "AI helper (optional)" card (provider, URL, model, key, Save, Save & test); dossier shows "AI second opinion" box + `llm_note`; fromFinding uses `llm_business` for empty name / category / city.
Verified: 12 shared-file suspects → spammer sites excluded (foreign-language / not a lead), real businesses → Review (seen once). llm.py against a mock Ollama/OpenAI server: both providers, invented email dropped, never confirms, low confidence ignored, server down → silent. Site Check regression on 3 known victims: 2 unchanged (Review, CONFIRMED); the first victim site is now Clean (owner cleaned it: homepage is the business, spam pages 404).
Full same-server run (CC-MAIN-2026-43, .in): 222,468 domains resolved in ~1 h, 296 victims, 92 share an IP (≤ 50 sites) → 951 neighbours → 7 spam-language suspects → 3 Review (incl. one cloaked for Googlebot), 1 Was hacked, 1 spammer-owned, 2 "foreign-language site". Low yield: keep it off by default. Known gap: a government education site with an English title was marked foreign-language site (home body foreign + no clean archive) — check the foreign_site rule against the home *title* language.
