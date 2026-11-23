// SiteWatch core: data, scoring, rules, storage (no DOM rendering). Extracted from v1 index.html unchanged.
/* ---------- Seed data: hand-researched sites, kept locally in seed.js ---------- */
const SEED_SITES = window.SEED_SITES || [];   // optional local preview/seed.js (git-ignored)

const DEFAULT_CONFIG = {
 thresholds:{confirm:60,review:30,risk:40},
 target:{tlds:["in","co.in","com","org"],indiaOnly:true},
 rules:[
  {id:"meaning_changed",group:"affected",name:"Page meaning changed vs Wayback baseline",desc:"Local multilingual embedding similarity below threshold",weight:40,enabled:true,param:{label:"similarity below",value:0.35}},
  {id:"language_changed",group:"affected",name:"Page language changed",desc:"e.g. English/Hindi → Indonesian/Thai",weight:25,enabled:true},
  {id:"title_domain_mismatch",group:"affected",name:"Title does not match domain",desc:"Domain words vs title words / meaning",weight:20,enabled:true},
  {id:"redirect_offsite",group:"affected",name:"Redirects to another domain",desc:"HTTP, meta-refresh or JS redirect",weight:35,enabled:true},
  {id:"cloaking",group:"affected",name:"Different content for Google / mobile / Google-referrer",desc:"Compares 4 fetch views + Google snippets",weight:35,enabled:true},
  {id:"spam_in_index",group:"affected",name:"Spam URLs in sitemap or Google index",desc:"Doorway paths like /slot-gacor/",weight:25,enabled:true},
  {id:"campaign_fingerprint",group:"affected",name:"Shares fingerprint with a known campaign",desc:"Spam domains, asset URLs, analytics IDs, HTML hash",weight:20,enabled:true},
  {id:"past_business",group:"gate",name:"Wayback shows a real business before",desc:"Fails if oldest copy is already spam",enabled:true},
  {id:"no_registration_gap",group:"gate",name:"No registration gap (not re-bought)",desc:"RDAP registration date older than spam",enabled:true},
  {id:"old_assets_live",group:"gate",name:"Old site-specific files still on server",desc:"Ignores /cdn-cgi/ and third-party CDNs",enabled:true},
  {id:"seen_twice",group:"gate",name:"Spam seen on 2 different days",desc:"Avoids one-off glitches",enabled:true},
  {id:"past_spam_period",group:"history",name:"Spam period in history",desc:"Wayback / urlscan saw spam earlier",enabled:true},
  {id:"old_wordpress",group:"risk",name:"Outdated CMS / framework (any platform)",desc:"WordPress, Joomla, Drupal, Magento, OpenCart… from generator tag / asset versions",weight:15,enabled:true},
  {id:"vulnerable_plugin",group:"risk",name:"Plugin / extension / theme / app with known vulnerability",desc:"Matched to public vuln feeds, any platform",weight:30,enabled:true},
  {id:"old_php",group:"risk",name:"Unsupported server software",desc:"PHP / Node / server version from public headers",weight:10,enabled:true},
  {id:"shared_ip_victim",group:"risk",name:"Same server IP as a victim",desc:"Shared hosting neighbour infected",weight:15,enabled:true},
  {id:"same_agency_victim",group:"risk",name:"Same 'Designed by' agency as a victim",desc:"Agency reuses theme / passwords",weight:20,enabled:true},
  {id:"targeted_plugin",group:"risk",name:"Plugin targeted by an active campaign",desc:"Most victims share this plugin version",weight:25,enabled:true}
 ],
 sources:[
  {id:"manual",name:"Manual list",enabled:true,desc:"Domains you add"},
  {id:"urlscan",name:"urlscan.io fingerprint search",enabled:true,desc:"Title / domain / link fingerprints"},
  {id:"snowball",name:"Snowball from victims",enabled:true,desc:"Max depth",param:{value:3}},
  {id:"commoncrawl_language",name:"Common Crawl language filter",enabled:true,desc:"Languages",param:{value:"id, th, vi"}},
  {id:"search",name:"Search engine (paid API)",enabled:false,desc:"site:.in + fingerprint queries"}
 ],
 indiaSignals:["+91 / 10-digit mobile","6-digit PIN code","Indian city / state","₹ / INR prices","GSTIN pattern","Indian-language text","JustDial / IndiaMART link","India IP location"],
 indiaMinSignals:2,
 schedule:"06:00",
platforms:[
  {match:"wordpress",cause:"Vulnerable or nulled plugin/theme, stolen wp-admin / FTP / cPanel password"},
  {match:"joomla|drupal|magento|opencart|prestashop",cause:"Outdated core or extension, stolen admin password"},
  {match:"php|laravel|codeigniter|custom",cause:"Code flaw (file upload, SQL injection), exposed .env, old framework"},
  {match:"shopify|wix|squarespace|webflow|blogger",cause:"Account takeover or DNS / registrar change — not server code"},
  {match:"static|html",cause:"Hosting / cPanel / FTP password stolen"},
  {match:"*",cause:"Check DNS / registrar takeover, expired hosting, dangling subdomain"}
 ],
 custom:[],      // user rules: {id,name,enabled,match:"all"|"any",conds:[{field,op,value}],action:{type,value},created,from}
 allow:[],       // domains always Clean
 block:[]        // spammer-owned domains, never a lead
};

/* Custom-rule vocabulary */
const FIELDS = {
 domain:"Domain",tld:"TLD",title_now:"Title now",title_before:"Title before",lang_now:"Language now",
 platform:"Platform",campaign:"Campaign",category:"Business category",registered:"Registered date",india:"India (yes/no)"
};
const OPS = {contains:"contains (a|b|c)",not_contains:"does not contain",equals:"equals",regex:"matches pattern",
 before:"date before",after:"date after",is_true:"is true / pass",is_false:"is false / fail",is_pending:"is pending"};
const ACTIONS = {exclude:"Exclude (not a lead)",force:"Force state",add:"Add to score",subtract:"Subtract from score"};
const FP_REASONS = {real_gambling:"Real gambling / Indonesian business",sold:"Domain sold or re-bought",
 owner_changed:"Owner changed site on purpose",fixed:"Already fixed / stale check",other:"Other"};

const STATES = {
 hacked_visible:"Hacked – visible",hacked_hidden:"Hacked – hidden",was_hacked:"Was hacked",
 at_risk:"At risk",review:"Review",clean:"Clean",false_positive:"False positive",excluded:"Excluded"
};
const NOT_LEADS = ["false_positive","excluded","clean"];
const KPI_ICON={hacked_visible:"gpp_bad",hacked_hidden:"visibility_off",was_hacked:"restore",at_risk:"warning",review:"hourglass_top",clean:"verified_user",false_positive:"block",excluded:"do_not_disturb_on"};
const KPI_STYLE={hacked_visible:"background:var(--red-bg);color:var(--red)",hacked_hidden:"background:var(--red-bg);color:var(--red)",was_hacked:"background:var(--blue-bg);color:var(--blue)",at_risk:"background:var(--orange-bg);color:var(--orange)",review:"background:var(--yellow-bg);color:var(--yellow)",clean:"background:var(--green-bg);color:var(--green)"};
const FOLLOW = {new:"New",emailed:"Emailed",called:"Called",no_response:"No response",interested:"Interested",won:"Won",lost:"Lost",dnc:"Do not contact"};
const TODAY = new Date().toISOString().slice(0,10);

/* ---------- Storage (per-browser convenience; real app uses SQLite) ---------- */
function load(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function save(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
let config = load("sw.config", structuredClone(DEFAULT_CONFIG));
// older saved configs lack the new keys
function normalizeConfig(c){
 const d=structuredClone(DEFAULT_CONFIG);
 for(const k of Object.keys(d)) if(c[k]===undefined) c[k]=d[k];
 for(const k of ["custom","allow","block","platforms"]) if(!Array.isArray(c[k])) c[k]=d[k];
 // keep user weights / enabled, refresh names and add new built-in rules
 for(const dr of d.rules){const r=c.rules.find(x=>x.id===dr.id);if(r){r.name=dr.name;r.desc=dr.desc}else c.rules.push(dr)}
 return c;
}
config=normalizeConfig(config);
let follow = load("sw.follow", {});            // domain -> {status,next,log:[]}
let approved=load("sw.approved", {});          // domain -> date approved as lead
let fps    = load("sw.fps", {});               // domain -> {reason,note,date}
let undo   = load("sw.undo", []);              // snapshots of {custom,allow,block}
let changes= load("sw.changes", []);           // [{date,text}]
let draft  = null;                             // rule being edited in the builder
let extra  = load("sw.extra", []);             // manually added domains
let runs   = load("sw.runs", [{date:"2026-11-22",sources:"manual, urlscan",suspects:9,india:1,confirmed:0,review:7,note:"Manual research session: urlscan title search + Wayback + RDAP"}]);
let ui = {tab:"overview",q:"",state:"",follow:"",tld:"",indiaOnly:config.target.indiaOnly};

/* Verifier output (research/verify.py → findings.js) mapped to the dashboard's site shape */
const ymd=t=>t?`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`:"";
const cleanName=t=>(t||"").replace(/^\s*home\s*[-–|:]\s*/i,"").replace(/\s*[-–|:]\s*home\s*$/i,"").trim();
function fromFinding(f){
 const spam=f.still_spam||f.spam_only_for_google_or_mobile||f.isp_blocked, hh=f.home_history||{};
 const place=(f.india_signals.find(x=>x.startsWith("Place: "))||"").slice(7);
 const brand=((f.urlscan_title||"").match(/[A-Z][A-Z0-9]{3,}/)||[""])[0];
 const g=f.gates||{};
 return {domain:f.domain,tld:f.domain.endsWith(".co.in")?"co.in":f.domain.split(".").pop(),india:f.india,indiaSignals:f.india_signals,
  business:{name:cleanName(f.business_title),category:"",city:place,phone:(f.phones||[])[0]||"",email:(f.emails||[])[0]||"",
   source:f.home_is_business?"Live homepage (owner's site still up)":(f.last_clean||hh.last_clean)?"Wayback "+ymd(f.last_clean||hh.last_clean):""},
  platform:f.platform,likelyCause:"",campaign:brand,visibleSpam:!(f.inner_page&&f.home_is_business)&&!f.spam_only_for_google_or_mobile,
  registered:f.rdap_registered||"",
  before:{date:ymd(f.last_clean||hh.last_clean),title:f.business_title||""},
  now:{date:f.checked,title:spam?(f.page_title||f.urlscan_title):(f.page_title||f.home_title||""),lang:f.page_lang},
  fingerprints:[f.page_url].concat(f.urlscan_title?["urlscan "+f.urlscan_time+": "+f.urlscan_title]:[]),
  signals:{meaning_changed:spam?true:(f.verdict.startsWith("Down")?null:false),language_changed:spam?f.page_lang!==f.home_lang&&f.page_lang!=="Unknown":null,
   title_domain_mismatch:spam||f.verdict.startsWith("Down")?true:false,redirect_offsite:f.redirect_offsite,cloaking:f.spam_only_for_google_or_mobile,spam_in_index:f.inner_page&&spam?true:null,
   campaign_fingerprint:spam||f.verdict.startsWith("Down")?true:false,past_business:g.past_business,no_registration_gap:g.no_registration_gap,old_assets_live:g.old_assets_live,
   seen_twice:g.seen_twice,past_spam_period:f.verdict.startsWith("Was hacked")?true:null},
  evidence:{
   meaning_changed:spam?`Page ${f.page_url} now: “${f.page_title||f.googlebot_title}”`:`Page now: “${f.page_title||"—"}” (${f.verdict})`,
   title_domain_mismatch:`urlscan ${f.urlscan_time} saw: “${f.urlscan_title}”`,
   cloaking:f.spam_only_for_google_or_mobile?`Normal: “${f.page_title}” · Googlebot: “${f.googlebot_title}” · Google referrer: “${f.google_referrer_title||""}”`:"",
   spam_in_index:f.inner_page?(f.home_is_business?`Homepage still the business: “${f.home_title}” — spam only on inner page`:"Spam on inner page"):"",
   past_business:f.business_title?`Business: “${f.business_title}”`:"",
   no_registration_gap:f.rdap_registered?`Registered ${f.rdap_registered}, last changed ${f.rdap_last_changed||"—"}`:"",
   old_assets_live:f.home_is_business?"Owner's homepage live on the same domain":(f.assets_live||[]).length?"200: "+f.assets_live.join(", "):(f.assets_tested||[]).length?"Old files not found: "+f.assets_tested.join(", "):"",
   seen_twice:`urlscan ${f.urlscan_time} + our check ${f.checked}`},
  proof:[f.urlscan_result&&{label:f.source==="commoncrawl"?`Common Crawl capture ${f.urlscan_time} (foreign-language page)`:`urlscan scan ${f.urlscan_time} (spam live)`,url:f.urlscan_result},f.urlscan_screenshot&&{label:"urlscan screenshot",url:f.urlscan_screenshot},
   (f.last_clean||hh.last_clean)&&{label:`Wayback clean copy ${ymd(f.last_clean||hh.last_clean)}`,url:`https://web.archive.org/web/${f.last_clean||hh.last_clean}/${f.page_url}`}].filter(Boolean),
  firstSeen:f.urlscan_time,lastChecked:f.checked,source:"urlscan · "+f.verdict,
  verdict:f.verdict,pageStatus:f.page_status,homeStatus:f.home_status};
}
// results of the big searches (findings.js) + single-site checks (checks.js; a newer check overrides)
let CHECKS_DATA=window.CHECKS||[];
function buildFound(){ const m=new Map(); (window.FINDINGS||[]).forEach(f=>m.set(f.domain,f)); CHECKS_DATA.forEach(c=>m.set(c.domain,c));
 return [...m.values()].map(fromFinding).filter(x=>!SEED_SITES.some(s=>s.domain===x.domain)); }
let FOUND=buildFound();
function refreshChecks(list){ CHECKS_DATA=list||[]; FOUND=buildFound(); }
function allSites(){return SEED_SITES.concat(FOUND,extra)}
function fu(d){return follow[d]||{status:"new",next:"",log:[]}}

/* ---------- Scoring: pure function of signals + config ---------- */
function fieldVal(s,f){
 if(f.startsWith("signal:")){const v=s.signals[f.slice(7)];return v===undefined?null:v}
 return ({domain:s.domain,tld:s.tld,title_now:s.now.title,title_before:s.before.title,lang_now:s.now.lang,
  platform:s.platform,campaign:s.campaign,category:s.business.category,registered:s.registered,india:s.india?"yes":"no"})[f];
}
function condMatch(s,c){
 const v=fieldVal(s,c.field), str=String(v??"").toLowerCase(), val=String(c.value??"").toLowerCase().trim();
 const any=()=>val.split("|").map(t=>t.trim()).filter(Boolean).some(t=>str.includes(t));
 switch(c.op){
  case "contains":return any();
  case "not_contains":return !any();
  case "equals":return str===val;
  case "regex":return new RegExp(c.value,"i").test(String(v??""));
  case "before":return !!v&&String(v)<c.value;
  case "after":return !!v&&String(v)>c.value;
  case "is_true":return v===true;
  case "is_false":return v===false;
  case "is_pending":return v===null||v===undefined;
 }
 return false;
}
function ruleMatch(s,rule){
 if(!rule.conds.length) return false;
 try{const res=rule.conds.map(c=>condMatch(s,c));return rule.match==="any"?res.some(Boolean):res.every(Boolean)}
 catch(e){return false} // invalid pattern: rule is skipped (also flagged in the UI)
}
function ruleError(rule){for(const c of rule.conds){if(c.op==="regex"){try{new RegExp(c.value)}catch(e){return "Invalid pattern: "+e.message}}if(!["is_true","is_false","is_pending"].includes(c.op)&&!String(c.value??"").trim())return "Empty value"}return ""}

/* Order: allowlist → blocklist → marked false positive → custom exclude → custom force → custom ±score → built-in logic */
function score(site,cfg=config){
 const r = {aff:0,risk:0,gates:[],hits:[],custom:[],why:""};
 for(const rule of cfg.rules){
  if(!rule.enabled) continue;
  const v = site.signals[rule.id];
  if(rule.group==="affected" && v===true){r.aff+=rule.weight;r.hits.push(rule.id)}
  if(rule.group==="risk" && v===true){r.risk+=rule.weight;r.hits.push(rule.id)}
  if(rule.group==="gate") r.gates.push({id:rule.id,v:v===undefined?null:v});
 }
 let forced=null, excluded=false;
 for(const cr of cfg.custom||[]){
  if(!cr.enabled||!ruleMatch(site,cr)) continue;
  r.custom.push(cr.id);
  const a=cr.action;
  if(a.type==="exclude"){excluded=true;r.why=r.why||`Custom rule: ${cr.name}`}
  else if(a.type==="force"&&!forced){forced=a.value;r.why=r.why||`Custom rule: ${cr.name}`}
  else if(a.type==="add") r.aff+=+a.value||0;
  else if(a.type==="subtract") r.aff-=+a.value||0;
 }
 const T=cfg.thresholds, gatesOk=r.gates.every(g=>g.v===true), hist=cfg.rules.find(x=>x.id==="past_spam_period");
 if(r.aff>=T.confirm && gatesOk) r.state = site.visibleSpam?"hacked_visible":"hacked_hidden";
 else if(r.aff>=T.review) r.state="review";
 else if(hist&&hist.enabled&&site.signals.past_spam_period===true) r.state="was_hacked";
 else if(r.risk>=T.risk) r.state="at_risk";
 else r.state="clean";
 r.computed=r.state;
 if((cfg.allow||[]).includes(site.domain)){r.state="clean";r.why="Allowlist"}
 else if((cfg.block||[]).includes(site.domain)){r.state="excluded";r.why="Spammer-owned list"}
 else if(fps[site.domain]){r.state="false_positive";r.why="Marked false positive: "+FP_REASONS[fps[site.domain].reason]}
 else if(excluded) r.state="excluded";
 else if(forced&&STATES[forced]) r.state=forced;
 r.pending = r.gates.filter(g=>g.v!==true);
 return r;
}

/* Per-rule stats: hits and how many of those were marked false positive */
function ruleStats(){
 const st={};
 const bump=(id,s)=>{st[id]=st[id]||{hits:0,fp:0};st[id].hits++;if(fps[s.domain])st[id].fp++};
 allSites().forEach(s=>{
  config.rules.forEach(rule=>{if(rule.enabled&&rule.group!=="gate"&&s.signals[rule.id]===true)bump(rule.id,s)});
  (config.custom||[]).forEach(cr=>{if(cr.enabled&&ruleMatch(s,cr))bump(cr.id,s)});
 });
 return st;
}
function snapshot(text){
 undo.push(JSON.stringify({custom:config.custom,allow:config.allow,block:config.block}));
 if(undo.length>20) undo.shift();
 changes.push({date:new Date().toISOString().slice(0,16).replace("T"," "),text});
 save("sw.undo",undo);save("sw.changes",changes);
}
function persist(){save("sw.config",config)}

const $ = s=>document.querySelector(s);
const esc = s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/* ---------- One page: Rules & domains ---------- */
const LEAD_STATES=["review","hacked_visible","hacked_hidden"];
function fieldOptions(sel){
 return Object.entries(FIELDS).map(([k,v])=>`<option value="${k}" ${sel===k?"selected":""}>${v}</option>`).join("")+
  `<optgroup label="Check result">${config.rules.map(r=>`<option value="signal:${r.id}" ${sel==="signal:"+r.id?"selected":""}>Check: ${esc(r.name)}</option>`).join("")}</optgroup>`;
}
function fieldLabel(f){return f.startsWith("signal:")?"Check “"+((config.rules.find(r=>r.id===f.slice(7))||{}).name||f)+"”":FIELDS[f]||f}
function ruleSummary(rule){
 const cs=rule.conds.map(c=>`${fieldLabel(c.field)} ${OPS[c.op].split(" (")[0]}${["is_true","is_false","is_pending"].includes(c.op)?"":` “${c.value}”`}`).join(rule.match==="any"?" OR ":" AND ");
 const a=rule.action;
 return `IF ${cs} → ${ACTIONS[a.type]}${a.type==="force"?": "+STATES[a.value]:["add","subtract"].includes(a.type)?" "+a.value:""}`;
}
function platformCause(s){
 if(s.likelyCause) return s.likelyCause;
 const p=(s.platform||"").toLowerCase();
 const hit=config.platforms.find(x=>x.match.split("|").some(t=>t.trim()&&p.includes(t.trim().toLowerCase())));
 return hit?hit.cause:(config.platforms.find(x=>x.match==="*")||{}).cause||"";
}
function suggestRule(s,reason){
 const base={name:"",enabled:true,match:"all",conds:[],action:{type:"exclude",value:""},from:s.domain};
 if(reason==="real_gambling"){
  const toks=["slot","toto","gacor","judi","togel","casino","bet","qq","88","777"].filter(t=>s.domain.includes(t));
  if(toks.length) return {...base,name:"Spammer-owned domain names",conds:[{field:"domain",op:"contains",value:toks.join("|")}]};
  return {...base,name:"Was always gambling",conds:[{field:"title_before",op:"contains",value:"slot|casino|toto|judi|togel|bet"}]};
 }
 if(reason==="sold"){
  if(s.signals.past_business===false) return {...base,name:"No real business in history",conds:[{field:"signal:past_business",op:"is_false",value:""}]};
  return {...base,name:"Old files gone → maybe sold",conds:[{field:"signal:old_assets_live",op:"is_false",value:""}],action:{type:"force",value:"review"}};
 }
 if(reason==="other") return {...base,name:"Exclude "+s.domain,conds:[{field:"domain",op:"equals",value:s.domain}]};
 return null; // owner_changed / fixed → allowlist is the better fix
}
function markFP(d,reason,note){
 fps[d]={reason,note:note||"",date:TODAY};save("sw.fps",fps);
 const f=fu(d);f.log.push({date:TODAY,type:"False positive",status:f.status,note:FP_REASONS[reason]+(note?": "+note:"")});follow[d]=f;save("sw.follow",follow);
 changes.push({date:TODAY,text:`Marked ${d} false positive (${FP_REASONS[reason]})`});save("sw.changes",changes);
}
function unmarkFP(d){delete fps[d];save("sw.fps",fps);changes.push({date:TODAY,text:`Removed false-positive mark from ${d}`});save("sw.changes",changes)}
function approve(d){
 approved[d]=TODAY;save("sw.approved",approved);
 const f=fu(d);f.log.push({date:TODAY,type:"Approved",status:f.status,note:"Approved as lead — re-verify before contact"});follow[d]=f;save("sw.follow",follow);
}
function addDomainsFrom(text){
 const ds=text.split(/[\s,]+/).map(x=>x.trim().toLowerCase().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/.*$/,"")).filter(x=>/^[a-z0-9.-]+\.[a-z]{2,}$/.test(x));
 let n=0;
 ds.forEach(d=>{if(allSites().some(s=>s.domain===d))return;n++;const tld=d.endsWith(".co.in")?"co.in":d.split(".").pop();
  extra.push({domain:d,tld,india:tld==="in"||tld==="co.in",indiaSignals:tld.endsWith("in")?[".in domain"]:[],business:{name:"",category:"",city:"",phone:"",email:"",source:""},platform:"Not scanned",likelyCause:"",campaign:"",visibleSpam:false,registered:"",before:{date:"",title:""},now:{date:"",title:"(queued for scan)",lang:""},fingerprints:[],signals:{},evidence:{},firstSeen:TODAY,lastChecked:"",source:"manual"})});
 save("sw.extra",extra);return n;
}

/* ---------- Actions ---------- */
function exportCSV(list){
 const cols=["domain","state","affected_score","india","business","category","city","phone","email","before_title","now_title","campaign","platform","likely_cause","registered","followup","next","last_note"];
 const lines=[cols.join(",")].concat(list.map(({s,r,f})=>[s.domain,STATES[r.state],r.aff,s.india,s.business.name,s.business.category,s.business.city,s.business.phone,s.business.email,s.before.title,s.now.title,s.campaign,s.platform,s.likelyCause,s.registered,FOLLOW[f.status],f.next,f.log.length?f.log[f.log.length-1].note:""].map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")));
 download(`sitewatch-${TODAY}.csv`,lines.join("\n"),"text/csv");
}
function download(name,text,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
