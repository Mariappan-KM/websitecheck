/* SiteWatch India — screens built from the Stitch "Sovereign Triage Portal" designs.
   Logic (scoring, rules, storage) lives in core.js. Only verified data is shown. */

/* ---------- UI state ---------- */
ui.tab = load("sw.tab", "matrix");
if (!["matrix","check","leads","followups","gates","synd","outreach","reports","settings"].includes(ui.tab)) ui.tab = "matrix";
ui.gate = ""; ui.tier = ""; ui.fleet = ""; ui.result = ""; ui.preset = {conf:false, phone:false, showExcluded:false};
ui.sel = new Set(); ui.page = 1; ui.per = 10; ui.sort = {k:"score", dir:-1};
ui.inspect = null; ui.split = load("sw.split", true); ui.density = load("sw.density", "compact");
let EVID = window.EVIDENCE || {};
function mergeCheckEvidence(){ (CHECKS_DATA||[]).forEach(c=>{ if(c.captures) EVID[c.domain]=c.captures; }); }
mergeCheckEvidence();
let remed = load("sw.remed", {});     // domain -> {1:true,2:false,3:false}
let flags = load("sw.flags", {});     // domain -> date escalated

/* ---------- Columns (Customize Columns modal) ---------- */
const COLS = {
 domain:{t:"Target Domain & Jurisdiction",d:"Domain, place, registration and first-seen date",req:true},
 posture:{t:"Posture & Score",d:"Evidence score (60) + gates passed (40), with state tag"},
 gates:{t:"Verification Rigor Gates (G1–G4)",d:"G1 real business · G2 no re-buy · G3 same server · G4 seen on two days"},
 entity:{t:"Former Legitimate Entity",d:"Business name and type from the clean archive or live homepage"},
 payload:{t:"Syndicate / Slot Doorway",d:"Spam brand and the infected page"},
 contact:{t:"Owner Contact & Channel",d:"Phone / email the business published itself"},
 exposure:{t:"Exposure Window (days)",d:"Days between the last clean copy and the latest spam sighting"},
 platform:{t:"Platform & Likely Cause",d:"CMS / hosting stack seen in the archive"},
 action:{t:"Triage Action",d:"Inspect, or outreach once you approved the lead"}
};
const PRESETS = {
 "Default SOC View":["domain","posture","gates","entity","payload","contact","action"],
 "Forensic Audit":["domain","posture","gates","payload","exposure","platform","action"],
 "Owner Outreach & CRM":["domain","entity","contact","posture","action"],
 "Compact Density":["domain","posture","gates","action"]
};
let cols = load("sw.cols", {order:Object.keys(COLS), on:PRESETS["Default SOC View"], preset:"Default SOC View"});
for (const k of Object.keys(COLS)) if (!cols.order.includes(k)) cols.order.push(k);

/* ---------- Derived values ---------- */
const GATE_IDS = ["past_business","no_registration_gap","old_assets_live","seen_twice"];
const GATE_NAMES = ["G1 Archive business","G2 No re-buy (RDAP)","G3 Same server / old files","G4 Seen on two days"];
const BRAND_COLORS = ["bg-primary","bg-tertiary","bg-secondary","bg-primary-container","bg-error","bg-emerald-600"];
function gatesOf(s){ return GATE_IDS.map(id => s.signals[id] === undefined ? null : s.signals[id]); }
function gatesPassed(s){ return gatesOf(s).filter(v => v === true).length; }
function posture(s, r){ const maxAff = config.thresholds.confirm * 2; return Math.round(Math.min(1, Math.max(0, r.aff) / maxAff) * 60 + gatesPassed(s) * 10); }
const TIER = {hacked_visible:"critical",hacked_hidden:"critical",review:"triage",was_hacked:"monitor",at_risk:"monitor",clean:"clean",false_positive:"excluded",excluded:"excluded"};
const TAG = {hacked_visible:["CRITICAL","gpp_bad","bg-error-container text-on-error-container"],hacked_hidden:["CRITICAL · HIDDEN","visibility_off","bg-error-container text-on-error-container"],
 review:["TRIAGE","warning","bg-tertiary-fixed text-on-tertiary-fixed"],was_hacked:["WAS HACKED","history","bg-primary-fixed text-on-primary-fixed"],
 at_risk:["AT RISK","warning","bg-tertiary-fixed text-on-tertiary-fixed"],clean:["CLEAN","check_circle","bg-emerald-50 text-emerald-800"],
 false_positive:["FALSE POSITIVE","block","bg-surface-container text-secondary"],excluded:["EXCLUDED","block","bg-surface-container text-secondary"]};
function isPublicBody(s){ return /\.(gov|nic|ac|edu|res)\.in$|\.edu$/.test(s.domain) || /college|university|school|council|government|department|institute/i.test((s.business.name||"")+" "+(s.before.title||"")); }
function incidentId(s){ let h=0; for (const c of s.domain) h=(h*31+c.charCodeAt(0))%9973; return `SW-${TODAY.slice(0,4)}-${String(h).padStart(4,"0")}`; }
function exposureDays(s){ if(!s.before.date) return null; const a=Date.parse(s.before.date), b=Date.parse(s.now.date||s.lastChecked||TODAY); return isNaN(a)||isNaN(b)?null:Math.max(0,Math.round((b-a)/864e5)); }
function phoneDigits(p){ let d=(p||"").replace(/\D/g,""); if(d.length===10) d="91"+d; return d.length>=11?d:""; }
function pagePath(s){ const u=(s.fingerprints||[]).find(x=>/^https?:/.test(x)); try{ return u? new URL(u).pathname : "/"; }catch(e){ return "/"; } }
function rows(scope=true){ return allSites().map(s=>({s,r:score(s),f:fu(s.domain)})).filter(x=>!scope||!ui.indiaOnly||x.s.india); }
function brandsOf(list){ const m={}; list.forEach(x=>{ const b=x.s.campaign; if(b&&!["false_positive","excluded"].includes(x.r.state)){ (m[b]=m[b]||[]).push(x); } }); return Object.entries(m).sort((a,b)=>b[1].length-a[1].length); }
function topVictim(list){
 const pri={hacked_visible:0,hacked_hidden:0,review:1};
 return list.filter(x=>x.r.state in pri).sort((a,b)=>(pri[a.r.state]-pri[b.r.state]) || (b.s.india-a.s.india) || (posture(b.s,b.r)-posture(a.s,a.r)))[0];
}
function advisory(s){
 const proof=(s.proof||[]).find(p=>/urlscan/.test(p.label));
 return `Hello ${s.business.name||""}, this is a security notice about ${s.domain}. On ${s.lastChecked||TODAY} the page ${pagePath(s)} on your website was showing gambling spam ("${(s.now.title||"").slice(0,80)}") instead of your content.`+
  (proof?` Public proof: ${proof.url}`:"")+` This usually means the hosting or admin access was misused. We can explain how to clean and secure it — this information is free.`;
}

/* ---------- Small components (design classes) ---------- */
const ic = (n, cls="text-[16px]") => `<span class="material-symbols-outlined ${cls}">${n}</span>`;
function tag(state, s, r){ const [t,i,c]=TAG[state]||TAG.review; return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold font-mono ${c} w-fit whitespace-nowrap">${ic(i,"text-[13px]")}${posture(s,r)}/100 ${t}</span>`; }
function dots(s){
 const g=gatesOf(s), n=g.filter(v=>v===true).length;
 const d=g.map((v,i)=>`<span class="w-2.5 h-2.5 rounded-full ${v===true?"bg-emerald-600":v===false?"bg-error":"bg-surface-dim"}" title="${GATE_NAMES[i]}: ${v===true?"PASS":v===false?"FAIL":"pending"}"></span>`).join("");
 const lbl = n===4?"4/4 Full":`${n}/4 Gates`, sub = g.includes(false)?"Gate failed — not a lead": n===4?"G1 Archive · G2 RDAP · G3 Server · G4 Persist":"Awaiting "+GATE_NAMES[g.findIndex(v=>v!==true)].split(" ")[0];
 return `<div class="flex flex-col gap-1"><div class="flex items-center gap-1.5">${d}<span class="text-[11px] font-mono ${n===4?"font-bold text-emerald-800":"text-secondary"} ml-1">${lbl}</span></div><div class="text-[10px] font-label text-secondary">${esc(sub)}</div></div>`;
}
function btn(label, icon, cls="bg-surface-container-high text-on-surface hover:bg-surface-container-highest", attrs=""){ return `<button class="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg ${cls} text-xs font-label font-semibold transition-all" ${attrs}>${icon?ic(icon):""}${label}</button>`; }
const BTN_PRIMARY = "bg-gradient-to-r from-primary to-primary-container text-on-primary shadow-sm hover:opacity-95 font-bold";
const BTN_GREEN = "bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm font-bold";
function kpi(label, icon, value, sub, tone=""){
 const red = tone==="red";
 return `<div class="p-4 rounded-xl ${red?"bg-error-container/40":"bg-surface-container-lowest"} shadow-sm flex flex-col justify-between">
  <div class="flex items-center justify-between"><span class="text-[11px] font-label font-semibold uppercase tracking-wider ${red?"text-on-error-container":"text-secondary"}">${label}</span>${ic(icon,"text-[18px] "+(red?"text-error":tone==="green"?"text-emerald-600":tone==="primary"?"text-primary":tone==="tertiary"?"text-tertiary":"text-secondary"))}</div>
  <div class="mt-2 flex items-baseline gap-2"><span class="font-headline text-2xl font-bold ${red?"text-on-error-container":tone==="primary"?"text-primary":"text-on-surface"}">${value}</span><span class="text-[11px] font-label ${red?"text-error font-medium":tone==="green"?"text-emerald-700":"text-secondary"}">${sub}</span></div></div>`;
}
function crumbs(...p){ return `<div class="flex items-center gap-2 text-xs font-label text-secondary">${p.map((x,i)=>i<p.length-1?`<span class="hover:text-primary cursor-pointer transition-colors">${esc(x)}</span><span>/</span>`:`<span class="text-on-surface font-semibold">${esc(x)}</span>`).join("")}</div>`; }
function pageHead(cr, title, badge, desc, actions){
 return `<div class="px-4 sm:px-8 pt-8 pb-6 flex flex-col gap-6 bg-surface-bright"><div class="flex flex-wrap items-center justify-between gap-4"><div class="space-y-1">${crumbs(...cr)}
  <div class="flex flex-wrap items-baseline gap-3"><h1 class="font-headline text-2xl sm:text-3xl font-semibold tracking-tight text-on-surface">${title}</h1>${badge||""}</div>
  <p class="text-sm text-secondary font-body max-w-3xl leading-relaxed">${desc}</p></div><div class="flex flex-wrap items-center gap-2.5">${actions||""}</div></div>`;
}
const LIVE = `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-label font-bold bg-primary-fixed text-on-primary-fixed"><span class="w-1.5 h-1.5 rounded-full bg-primary animate-ping"></span>LIVE EVIDENCE</span>`;
function card(inner, cls=""){ return `<section class="bg-surface-container-lowest rounded-2xl shadow-sm ${cls}">${inner}</section>`; }
function sel(id, opts, cur, labelPrefix=""){ return `<select id="${id}" class="bg-surface-container-lowest text-xs font-label text-on-surface px-3 py-2 rounded-lg shadow-sm focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer">${opts.map(([v,t])=>`<option value="${esc(v)}" ${cur===v?"selected":""}>${esc(labelPrefix+t)}</option>`).join("")}</select>`; }

/* ---------- Result groups (verifier outcome) ---------- */
const RESULTS={confirmed:["Hacked — confirmed","gpp_bad"],seen_today:["Hacked — seen once","gpp_maybe"],review:["Review","hourglass_top"],was_hacked:["Was hacked (spam gone)","history"],
 notfound:["Page not found (404)","link_off"],unreachable:["Unreachable / down","cloud_off"],isp:["Blocked by ISP","block"],clean:["Clean","verified_user"],
 foreign:["Foreign-language site","translate"],not_lead:["Not a lead (spammer / hosting)","do_not_disturb_on"],false_positive:["Marked false positive","block"],manual:["Manual / not scanned","edit_note"]};
function resultOf(s,r){
 if(fps[s.domain]) return "false_positive";
 const v=s.verdict||"";
 if(!v) return r.state==="clean"?"clean":"manual";
 if(v.startsWith("Down")) return "unreachable";
 if(v.startsWith("Blocked by ISP")) return "isp";
 if(v.startsWith("Not a lead (foreign")) return "foreign";
 if(v.startsWith("Not a lead")) return "not_lead";
 if(v.startsWith("Clean")) return "clean";
 if(v.startsWith("Was hacked")) return [404,410].includes(s.pageStatus)?"notfound":"was_hacked";
 if(v==="CONFIRMED hacked") return "confirmed";
 if(v==="Review"&&s.signals.past_business&&s.signals.no_registration_gap&&s.signals.old_assets_live&&!s.signals.seen_twice&&s.signals.meaning_changed) return "seen_today";
 return "review";
}

/* ---------- Filtering for registry tables ---------- */
function filteredRows(){
 const q=ui.q.trim().toLowerCase();
 let list=rows(false).filter(({s,r})=>{
  if(ui.indiaOnly && !s.india) return false;
  if(!ui.preset.showExcluded && !ui.result && ["excluded","false_positive"].includes(r.state)) return false;
  if(ui.tier && TIER[r.state]!==ui.tier) return false;
  if(ui.result && resultOf(s,r)!==ui.result) return false;
  if(ui.fleet && s.campaign!==ui.fleet) return false;
  if(ui.gate){ const g=gatesOf(s); if(ui.gate==="full"&&gatesPassed(s)!==4) return false; if(ui.gate==="pending"&&!(g.includes(null)&&!g.includes(false))) return false; if(ui.gate==="failed"&&!g.includes(false)) return false; }
  if(ui.preset.conf && posture(s,r)<90) return false;
  if(ui.preset.phone && !phoneDigits(s.business.phone)) return false;
  if(q){ const hay=[s.domain,s.business.name,s.business.city,s.business.phone,s.business.email,s.campaign,s.now.title,s.before.title,s.platform].join(" ").toLowerCase(); if(!hay.includes(q)) return false; }
  return true;
 });
 const k=ui.sort.k, d=ui.sort.dir;
 list.sort((a,b)=> k==="domain" ? d*a.s.domain.localeCompare(b.s.domain) : d*(posture(a.s,a.r)-posture(b.s,b.r)) || a.s.domain.localeCompare(b.s.domain));
 return list;
}
function presetCounts(){
 const base=rows(false).filter(x=>!["excluded","false_positive"].includes(x.r.state));
 const scope=rows(false).filter(x=>!ui.indiaOnly||x.s.india);
 return {unreach:scope.filter(x=>resultOf(x.s,x.r)==="unreachable").length, notfound:scope.filter(x=>resultOf(x.s,x.r)==="notfound").length,
  india:base.filter(x=>x.s.india).length, conf:base.filter(x=>posture(x.s,x.r)>=90&&(!ui.indiaOnly||x.s.india)).length,
  phone:base.filter(x=>phoneDigits(x.s.business.phone)&&(!ui.indiaOnly||x.s.india)).length, excl:rows().filter(x=>["excluded","false_positive"].includes(x.r.state)).length};
}

/* ---------- Registry table ---------- */
function cell(k, s, r, f){
 const pad = ui.density==="comfortable"?"py-5":ui.density==="dense"?"py-2":"py-3.5";
 const strike = ["excluded","false_positive"].includes(r.state);
 switch(k){
 case "domain": return `<td class="${pad} px-4 min-w-[220px]"><div class="flex items-center gap-2"><span class="text-base" title="${s.india?"India":"Outside India"}">${s.india?"🇮🇳":"🌐"}</span><div>
   <div class="font-mono ${["hacked_visible","hacked_hidden"].includes(r.state)?"font-semibold text-primary":"font-medium text-on-surface"} text-sm flex items-center gap-1.5 ${strike?"line-through text-secondary":""}">${esc(s.domain)}${["hacked_visible","hacked_hidden"].includes(r.state)?`<span class="w-2 h-2 rounded-full bg-error animate-ping" title="Spam live now"></span>`:""}${approved[s.domain]?`<span class="material-symbols-outlined text-[14px] text-emerald-700" title="Approved lead">verified</span>`:""}${flags[s.domain]?`<span class="material-symbols-outlined text-[14px] text-error" title="Escalated">flag</span>`:""}</div>
   <div class="text-[11px] text-secondary font-label">${esc([s.business.city||"",s.registered?"Reg "+s.registered.slice(0,4):"",s.firstSeen?"First seen "+s.firstSeen:""].filter(Boolean).join(" · "))}</div></div></div></td>`;
 case "posture": return `<td class="${pad} px-4 whitespace-nowrap"><div class="flex flex-col gap-1">${tag(r.state,s,r)}<span class="text-[10px] ${TIER[r.state]==="critical"||["unreachable","notfound"].includes(resultOf(s,r))?"text-error":"text-secondary"} font-medium font-label inline-flex items-center gap-1">${ic(RESULTS[resultOf(s,r)][1],"text-[12px]")}${RESULTS[resultOf(s,r)][0]}${s.pageStatus&&s.pageStatus!==200?` · HTTP ${s.pageStatus}`:""}</span></div></td>`;
 case "gates": return `<td class="${pad} px-4 min-w-[190px]">${dots(s)}</td>`;
 case "entity": return `<td class="${pad} px-4 min-w-[200px]"><div class="font-medium text-on-surface ${strike?"line-through text-secondary":""}">${esc(s.business.name||s.before.title||"—")}</div><div class="text-[11px] text-secondary font-label">${esc(s.business.category||s.platform||"")}</div></td>`;
 case "payload": return `<td class="${pad} px-4 min-w-[210px]"><div class="inline-flex items-center gap-1 font-semibold text-tertiary font-label">${s.campaign?ic("casino","text-[15px]")+esc(s.campaign):"—"}</div><div class="text-[11px] text-secondary truncate max-w-[220px]" title="${esc(s.now.title)}">${esc(pagePath(s))} · ${esc((s.now.title||"").slice(0,48))}</div></td>`;
 case "contact": { const ph=s.business.phone, em=s.business.email;
   return `<td class="${pad} px-4 whitespace-nowrap min-w-[190px]">${ph?`<div class="font-mono text-xs font-semibold ${approved[s.domain]?"text-emerald-700":"text-on-surface"} flex items-center gap-1">${ic("call","text-[14px]")}${esc(ph)}</div>`:em?`<div class="font-mono text-xs text-on-surface flex items-center gap-1">${ic("mail","text-[14px]")}${esc(em)}</div>`:`<div class="text-xs text-secondary">Not found</div>`}<div class="text-[10px] text-secondary font-label">${esc(approved[s.domain]?"Approved · "+FOLLOW[f.status]:(s.business.source||"").slice(0,34)||"No public contact")}</div></td>`; }
 case "exposure": { const d=exposureDays(s); return `<td class="${pad} px-4 whitespace-nowrap font-mono text-xs">${d===null?"—":`≤ ${d} days`}<div class="text-[10px] text-secondary font-label">${s.before.date?"clean "+esc(s.before.date):"no clean copy"}</div></td>`; }
 case "platform": return `<td class="${pad} px-4 min-w-[180px] text-xs">${esc(s.platform||"—")}<div class="text-[10px] text-secondary font-label truncate max-w-[220px]" title="${esc(platformCause(s))}">${esc(platformCause(s))}</div></td>`;
 case "action": { const hack=["hacked_visible","hacked_hidden"].includes(r.state), wa=phoneDigits(s.business.phone);
   let a;
   if(strike) a=`<span class="text-[11px] font-label text-secondary">Dismissed</span>`;
   else if(hack && approved[s.domain] && wa) a=`<button class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg ${BTN_GREEN} font-label text-xs" data-wa="${esc(s.domain)}">${ic("chat","text-[15px]")}WhatsApp</button>`;
   else a=`<button class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label font-medium text-xs transition-colors" data-insp="${esc(s.domain)}">${ic(hack?"stethoscope":"visibility","text-[14px]")}Inspect</button>`;
   return `<td class="${pad} px-4 text-right whitespace-nowrap"><div class="flex items-center justify-end gap-1.5">${a}<button class="p-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors" title="Deep-dive drawer" data-drawer="${esc(s.domain)}">${ic("open_in_full")}</button></div></td>`; }
 }
 return "";
}
function registryTable(list, {selectable=true, paged=true, id="ledger"}={}){
 const on=cols.order.filter(k=>cols.on.includes(k)||COLS[k].req);
 const total=list.length, pages=Math.max(1,Math.ceil(total/ui.per)); if(ui.page>pages) ui.page=pages;
 const shown=paged?list.slice((ui.page-1)*ui.per, ui.page*ui.per):list;
 const sortIc=k=>ui.sort.k===k?(ui.sort.dir<0?"arrow_downward":"arrow_upward"):"unfold_more";
 const ready=list.filter(x=>["hacked_visible","hacked_hidden"].includes(x.r.state)).length;
 return `<div class="w-full overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm"><div class="overflow-x-auto w-full"><table class="w-full text-left border-collapse" id="${id}">
 <thead><tr class="bg-surface-container text-on-surface-variant font-label text-[11px] uppercase tracking-wider">${selectable?`<th class="py-3 px-4 w-10 text-center"><input class="rounded accent-primary cursor-pointer" type="checkbox" id="selAll" ${shown.length&&shown.every(x=>ui.sel.has(x.s.domain))?"checked":""} aria-label="Select all"></th>`:""}
 ${on.map(k=>`<th class="py-3 px-4 font-semibold ${k==="action"?"text-right":""}">${k==="domain"||k==="posture"?`<button class="inline-flex items-center gap-1 uppercase tracking-wider" data-sort="${k==="domain"?"domain":"score"}">${COLS[k].t}${ic(sortIc(k==="domain"?"domain":"score"),"text-[14px]")}</button>`:COLS[k].t}</th>`).join("")}</tr></thead>
 <tbody class="text-xs divide-y-0 text-on-surface font-body">${shown.map(({s,r,f})=>{ const hack=["hacked_visible","hacked_hidden"].includes(r.state), selRow=ui.inspect===s.domain;
  return `<tr class="${selRow?"bg-primary/10":hack?"bg-primary/5 hover:bg-primary/10":["excluded","false_positive"].includes(r.state)?"opacity-60 hover:bg-surface-container":"hover:bg-surface-container"} transition-colors cursor-pointer" data-row="${esc(s.domain)}">
   ${selectable?`<td class="py-3.5 px-4 text-center"><input class="rounded accent-primary cursor-pointer" type="checkbox" data-sel="${esc(s.domain)}" ${ui.sel.has(s.domain)?"checked":""} aria-label="Select ${esc(s.domain)}"></td>`:""}
   ${on.map(k=>cell(k,s,r,f)).join("")}</tr>`;}).join("")||`<tr><td colspan="9" class="py-10 text-center text-secondary text-sm">No sites match these filters. ${ui.indiaOnly?"Try switching to Global.":""}${looksLikeSite(ui.q)?`<div class="mt-4"><button class="inline-flex items-center gap-2 px-4 py-2 rounded-lg ${BTN_PRIMARY} text-xs font-label" data-checknow="${esc(ui.q.trim())}">${ic("travel_explore")}Check ${esc(ui.q.trim())} now</button><div class="text-[11px] mt-2">Not in the list yet — run a full hacked-or-not check on this website (1–2 minutes).</div></div>`:""}</td></tr>`}</tbody></table></div>
 ${paged?`<div class="p-4 bg-surface-container-low flex flex-wrap items-center justify-between gap-4"><div class="flex flex-wrap items-center gap-2 text-xs font-label text-secondary"><span>Showing <strong class="text-on-surface">${total?(ui.page-1)*ui.per+1:0}–${Math.min(total,ui.page*ui.per)}</strong> of <strong>${total}</strong> monitored endpoints</span>${ready?`<span>·</span><span class="inline-flex items-center gap-1 font-semibold text-error"><span class="w-1.5 h-1.5 rounded-full bg-error"></span>${ready} confirmed lead${ready>1?"s":""} ready for review</span>`:""}</div>
  <div class="flex items-center gap-3"><div class="flex items-center gap-1 text-xs font-label text-secondary"><span>Rows per page:</span><select id="perPage" class="bg-surface-container-lowest text-xs rounded px-1.5 py-1 text-on-surface focus:outline-none">${[10,25,50].map(n=>`<option ${ui.per===n?"selected":""}>${n}</option>`).join("")}</select></div>
  <div class="flex items-center gap-1"><button class="p-1 rounded bg-surface-container text-secondary ${ui.page<=1?"opacity-40 cursor-not-allowed":""}" id="pgPrev" ${ui.page<=1?"disabled":""} aria-label="Previous page">${ic("chevron_left")}</button><span class="px-2 py-0.5 text-xs font-mono font-bold bg-surface-container-lowest text-on-surface rounded">${ui.page} / ${pages}</span><button class="p-1 rounded bg-surface-container text-secondary ${ui.page>=pages?"opacity-40 cursor-not-allowed":""}" id="pgNext" ${ui.page>=pages?"disabled":""} aria-label="Next page">${ic("chevron_right")}</button></div></div></div>`:""}</div>`;
}
function bindTable(){
 $$("[data-row]").forEach(tr=>tr.onclick=e=>{ if(e.target.closest("button,input,a")) return; ui.inspect=tr.dataset.row; if(ui.tab==="leads"&&ui.split) render(); else openDrawer(tr.dataset.row); });
 $$("[data-sel]").forEach(c=>c.onchange=()=>{ c.checked?ui.sel.add(c.dataset.sel):ui.sel.delete(c.dataset.sel); render(); });
 const all=$("#selAll"); if(all) all.onchange=()=>{ $$("[data-sel]").forEach(c=>all.checked?ui.sel.add(c.dataset.sel):ui.sel.delete(c.dataset.sel)); render(); };
 $$("[data-insp]").forEach(b=>b.onclick=()=>{ ui.inspect=b.dataset.insp; if(ui.tab==="leads"&&ui.split) render(); else openDrawer(b.dataset.insp); });
 $$("[data-drawer]").forEach(b=>b.onclick=()=>openDrawer(b.dataset.drawer));
 $$("[data-wa]").forEach(b=>b.onclick=()=>whatsapp(b.dataset.wa));
 $$("[data-checknow]").forEach(b=>b.onclick=()=>{ ui.tab="check"; ui.checkInput=b.dataset.checknow; render(); startCheck(b.dataset.checknow); });
 $$("[data-sort]").forEach(b=>b.onclick=()=>{ const k=b.dataset.sort; ui.sort = ui.sort.k===k?{k,dir:-ui.sort.dir}:{k,dir:k==="domain"?1:-1}; render(); });
 const pp=$("#perPage"); if(pp) pp.onchange=()=>{ ui.per=+pp.value; ui.page=1; render(); };
 const pv=$("#pgPrev"); if(pv) pv.onclick=()=>{ ui.page--; render(); };
 const nx=$("#pgNext"); if(nx) nx.onclick=()=>{ ui.page++; render(); };
}

/* ---------- Filter command bar ---------- */
function filterBar(){
 const pc=presetCounts(), brands=brandsOf(rows(false));
 const chip=(on,label,attr)=>`<button class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${on?"bg-primary text-on-primary":"bg-surface-container-lowest text-on-surface hover:bg-surface-container"} font-label text-[11px] font-medium shadow-xs transition-colors" ${attr}><span>${label}</span>${on?ic("check","text-[12px]"):""}</button>`;
 return `<div class="px-4 sm:px-8 py-4 bg-surface-container-low flex flex-col gap-3"><div class="flex flex-wrap items-center justify-between gap-3">
  <div class="relative flex-1 min-w-[240px] max-w-xl">${ic("search","absolute left-3 top-2.5 text-[18px] text-secondary")}<input class="w-full bg-surface-container-lowest text-xs font-body text-on-surface pl-10 pr-16 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary shadow-sm" id="omni" value="${esc(ui.q)}" placeholder="Filter by domain, phone (+91), business name, CMS, or keyword..." type="text"><div class="absolute right-2.5 top-2 flex items-center gap-1"><kbd class="bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded text-[10px] font-mono">⌘K</kbd></div></div>
  <div class="flex flex-wrap items-center gap-2">
   ${sel("fJur",[["india",`🇮🇳 India Priority (${pc.india})`],["all",`All Jurisdictions (${rows(false).length})`]],ui.indiaOnly?"india":"all")}
   ${sel("fGate",[["","All Verification Gates"],["full","G1–G4 Full Consensus"],["pending","Pending gates"],["failed","Failed a gate"]],ui.gate)}
   ${sel("fTier",[["","All Severity Tiers"],["critical","Critical (confirmed hacked)"],["triage","Triage (review)"],["monitor","Monitor (was hacked / at risk)"],["clean","Restored / Clean"],["excluded","Excluded / false positive"]],ui.tier)}
   ${sel("fFleet",[["","All Syndicates"]].concat(brands.map(([b,l])=>[b,`${b} (${l.length})`])),ui.fleet)}
   ${sel("fResult",[["","All Results"]].concat(resultCounts().map(([k,n])=>[k,`${RESULTS[k][0]} (${n})`])),ui.result||"")}
  </div>
  <div class="flex items-center gap-1 bg-surface-container p-1 rounded-lg">
   ${[["comfortable","density_large","Comfortable"],["compact","density_medium","Compact"],["dense","density_small","Dense"]].map(([k,i,t])=>`<button class="p-1.5 rounded ${ui.density===k?"bg-surface-container-lowest text-primary shadow-xs":"text-secondary hover:text-on-surface"} transition-colors" title="${t} view" data-dens="${k}">${ic(i)}</button>`).join("")}
   <button class="p-1.5 rounded text-secondary hover:text-on-surface transition-colors" title="Customize columns" id="openCols">${ic("view_column")}</button></div></div>
  <div class="flex flex-wrap items-center gap-2 pt-1 text-xs"><span class="text-[11px] font-label uppercase tracking-wider text-secondary font-semibold">Active Filter Presets:</span>
   ${chip(ui.indiaOnly,`🇮🇳 India Priority [${pc.india}]`,'data-pre="india"')}${chip(ui.preset.conf,`Confidence 90+ [${pc.conf}]`,'data-pre="conf"')}${chip(ui.preset.phone,`Phone Ready [${pc.phone}]`,'data-pre="phone"')}${chip(ui.preset.showExcluded,`Show Excluded / False Positive [${pc.excl}]`,'data-pre="showExcluded"')}${chip(ui.result==="unreachable",`Unreachable [${pc.unreach}]`,'data-res="unreachable"')}${chip(ui.result==="notfound",`Page Not Found [${pc.notfound}]`,'data-res="notfound"')}
   ${["unreachable","notfound","seen_today","review"].includes(ui.result)?`<button class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary text-on-primary font-label text-[11px] font-bold ml-1" id="recheckList">${ic("refresh","text-[13px]")}Check these again</button>`:""}
   <button class="text-xs text-primary font-label font-medium hover:underline ml-2" id="resetAll">Reset All</button></div></div>`;
}
function resultCounts(){
 const c={}; rows(false).filter(x=>!ui.indiaOnly||x.s.india).forEach(x=>{ const k=resultOf(x.s,x.r); c[k]=(c[k]||0)+1; });
 return Object.keys(RESULTS).filter(k=>c[k]).map(k=>[k,c[k]]);
}
async function recheckFiltered(){
 if(!SERVER) return showText("Start the server to re-check","Re-checking needs the local server — double-click start.bat.");
 const list=filteredRows().map(x=>x.s.domain).slice(0,20);
 if(!list.length) return toast("Nothing to re-check");
 let ok=0; for(const d of list){ try{ await api("/api/check",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target:d})}); ok++; }catch(e){ break; } }
 toast(`${ok} site(s) queued in Site Check${filteredRows().length>20?" (first 20)":""}`); chk.wasRunning=true; pollCheck();
}
function bindFilters(){
 const o=$("#omni"); if(o) o.oninput=()=>{ ui.q=o.value; ui.page=1; const p=o.selectionStart; render(); const n=$("#omni"); if(n){ n.focus(); n.setSelectionRange(p,p); } };
 const on=(id,fn)=>{ const e=$(id); if(e) e.onchange=()=>{ fn(e.value); ui.page=1; render(); }; };
 on("#fJur",v=>ui.indiaOnly=v==="india"); on("#fGate",v=>ui.gate=v); on("#fTier",v=>ui.tier=v); on("#fFleet",v=>ui.fleet=v); on("#fResult",v=>ui.result=v);
 $$("[data-res]").forEach(b=>b.onclick=()=>{ ui.result=ui.result===b.dataset.res?"":b.dataset.res; ui.page=1; render(); });
 const rl=$("#recheckList"); if(rl) rl.onclick=recheckFiltered;
 $$("[data-dens]").forEach(b=>b.onclick=()=>{ ui.density=b.dataset.dens; save("sw.density",ui.density); render(); });
 $$("[data-pre]").forEach(b=>b.onclick=()=>{ const k=b.dataset.pre; if(k==="india") ui.indiaOnly=!ui.indiaOnly; else ui.preset[k]=!ui.preset[k]; ui.page=1; render(); });
 const r=$("#resetAll"); if(r) r.onclick=()=>{ ui.q=""; ui.gate=ui.tier=ui.fleet=ui.result=""; ui.preset={conf:false,phone:false,showExcluded:false}; ui.page=1; render(); };
 const oc=$("#openCols"); if(oc) oc.onclick=openColumns;
}

/* ---------- Visual evidence + dossier pieces ---------- */
function shots(s, h="h-32"){
 const e=EVID[s.domain]||{};
 const box=(src,label,red,cap)=>`<div class="flex flex-col gap-1.5"><span class="text-[10px] font-label font-semibold ${red?"text-error":"text-secondary"}">${cap}</span><div class="${h} rounded-lg bg-surface-container overflow-hidden relative ${red?"ring-2 ring-error":""}">${src?`<a href="${esc(src)}" target="_blank" rel="noopener"><img class="w-full h-full object-cover object-top" src="${esc(src)}" alt="${esc(cap+" screenshot of "+s.domain)}"></a>`:`<div class="w-full h-full flex items-center justify-center text-[11px] text-secondary font-label p-2 text-center">No capture yet — run research/capture.py</div>`}<div class="absolute bottom-1.5 left-1.5 ${red?"bg-error font-bold":"bg-black/70"} text-white text-[9px] font-mono px-1.5 py-0.5 rounded">${esc(label)}</div></div></div>`;
 return `<div class="grid grid-cols-2 gap-2">${box(e.before,(s.business.name||"Business").slice(0,28),false,"ARCHIVE ("+(e.before_ts?ymd(e.before_ts):s.before.date||"—")+")")}${box(e.live,(s.campaign||"Spam page").slice(0,24),true,"LIVE PAGE ("+(e.captured||s.lastChecked||"—")+")")}</div>`;
}
function headersBox(s){
 const e=(EVID[s.domain]||{}).headers;
 if(!e) return `<div class="p-3.5 rounded-lg bg-surface-container font-mono text-[11px] text-secondary">No headers captured yet.</div>`;
 const blk=(name,h)=>`<div class="text-secondary"># Request: GET ${esc(pagePath(s))} (User-Agent: ${name})</div><div><span class="text-primary font-bold">HTTP ${h.status||"—"}</span>${h.error?` <span class="text-error">${esc(h.error)}</span>`:""}</div>${Object.entries(h).filter(([k])=>!["status","error"].includes(k)).map(([k,v])=>`<div><span class="text-secondary">${esc(k)}:</span> ${esc(String(v).slice(0,90))}</div>`).join("")}`;
 return `<div class="p-3.5 rounded-lg bg-surface-container font-mono text-[11px] text-on-surface space-y-1.5 overflow-x-auto leading-tight">${blk("Browser",e.browser)}<div class="pt-2"></div>${blk("Googlebot/2.1",e.googlebot)}</div>`;
}
function ring(pctV, cls="text-error"){ return `<svg class="w-14 h-14 -rotate-90" viewBox="0 0 36 36" aria-hidden="true"><path class="text-surface-dim" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" stroke-width="3.5"></path><path class="${cls}" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" stroke-dasharray="${pctV}, 100" stroke-linecap="round" stroke-width="3.5"></path></svg>`; }
function insightText(s){
 const ev=s.evidence||{}, bits=[];
 if(s.before.title) bits.push(`On ${s.before.date||"the last clean copy"} the page showed “${s.before.title}”.`);
 if(s.now.title) bits.push(`Now it shows “${s.now.title.slice(0,90)}”.`);
 if(ev.spam_in_index) bits.push(ev.spam_in_index+".");
 if(ev.old_assets_live) bits.push(ev.old_assets_live+".");
 return bits.join(" ");
}
function dossier(x){
 if(!x) return "";
 const {s,r}=x, wa=phoneDigits(s.business.phone), ok=approved[s.domain], g=gatesPassed(s);
 return `<div class="bg-surface-container-lowest rounded-xl p-6 shadow-md transition-all" id="dossier">
 <div class="flex flex-wrap items-start justify-between gap-4 pb-5"><div class="space-y-1"><div class="flex items-center gap-2"><span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${TIER[r.state]==="critical"?"bg-error-container text-on-error-container":"bg-surface-container text-secondary"}">${TIER[r.state]==="critical"?"PRIORITY TARGET":STATES[r.state].toUpperCase()}</span><span class="text-xs font-label text-secondary font-mono">CID: ${incidentId(s)}</span></div>
  <h2 class="font-headline text-xl font-bold text-on-surface">Forensic Dossier: <span class="font-mono text-primary">${esc(s.domain)}</span></h2>
  <p class="text-xs font-body text-secondary max-w-3xl">${esc(g===4?"All 4 verification gates passed: a real business page was replaced with gambling spam on the same server.":`${g} of 4 verification gates passed — ${r.pending.length?"pending: "+r.pending.map(p=>GATE_NAMES[GATE_IDS.indexOf(p.id)]||p.id).join(", "):"check gates"}.`)}</p></div>
  <div class="flex flex-wrap items-center gap-2 noprint">
   <a class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-xs font-label font-semibold text-on-surface transition-colors" href="https://web.archive.org/web/*/${esc(s.domain)}*" target="_blank" rel="noopener">${ic("history")}Wayback Engine</a>
   <a class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-xs font-label font-semibold text-on-surface transition-colors" href="https://rdap.org/domain/${esc(s.domain)}" target="_blank" rel="noopener">${ic("dns")}Dig / WHOIS</a>
   <button class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg ${ok&&wa?BTN_GREEN:"bg-surface-container text-secondary cursor-not-allowed"} text-xs font-label font-bold transition-colors" ${ok&&wa?`data-wa="${esc(s.domain)}"`:"disabled"} title="${ok?wa?"Open WhatsApp with the prepared advisory":"No phone found":"Approve this lead first (Gate Funnel & Rigor)"}">${ic("chat")}Launch Remediation Outreach${wa?" ("+esc(s.business.phone)+")":""}</button>
   <button class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-xs font-label font-semibold text-on-surface" data-print="${esc(s.domain)}">${ic("print")}Print dossier</button></div></div>
 <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
  <div class="flex flex-col gap-3"><div class="flex items-center justify-between text-xs font-label font-semibold text-secondary uppercase tracking-wider"><span>Visual Inversion Evidence</span><span class="${s.signals.past_business&&s.signals.meaning_changed?"text-emerald-700":"text-secondary"} font-mono font-bold">${s.signals.past_business?"G1 PASSED":"G1 PENDING"}</span></div>${shots(s)}
   <div class="p-3 rounded-lg bg-surface-container text-xs font-body text-on-surface-variant leading-relaxed"><strong class="text-on-surface">Forensic Insight:</strong> ${esc(insightText(s))}</div></div>
  <div class="flex flex-col gap-3"><div class="flex items-center justify-between text-xs font-label font-semibold text-secondary uppercase tracking-wider"><span>Server Response &amp; Cloaking Rules</span><span class="text-primary font-mono font-bold">${s.signals.cloaking?"CLOAKED":"SAME FOR ALL VIEWS"}</span></div>${headersBox(s)}
   <div class="p-3 rounded-lg bg-surface-container-low flex items-center justify-between"><div class="space-y-0.5"><div class="text-[11px] font-label font-semibold uppercase tracking-wider text-secondary">Verification Confidence</div><div class="font-headline font-bold text-base text-on-surface">${g}/4 gates · ${posture(s,r)}/100</div><div class="text-[10px] text-secondary font-label">Evidence score ${r.aff} (confirm ≥ ${config.thresholds.confirm})</div></div><div class="w-16 h-16 flex items-center justify-center">${ring(posture(s,r), g===4?"text-error":"text-tertiary")}</div></div></div>
  <div class="flex flex-col gap-3"><div class="flex items-center justify-between text-xs font-label font-semibold text-secondary uppercase tracking-wider"><span>Owner Channel (self-published)</span><span class="${s.business.phone||s.business.email?"text-emerald-700":"text-secondary"} font-mono font-bold">${s.business.phone||s.business.email?"CONTACT FOUND":"NO CONTACT"}</span></div>
   <div class="p-4 rounded-xl bg-surface-container flex flex-col gap-3"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center flex-shrink-0">${ic("storefront","text-[22px]")}</div><div class="min-w-0"><div class="font-semibold text-sm text-on-surface">${esc(s.business.name||"Business name not found")}</div><div class="text-xs text-secondary font-label">Owner name: not verified · ${esc(s.business.city||"")}</div></div></div>
    <div class="space-y-1.5 text-xs font-body">
     <div class="flex items-center justify-between gap-2"><span class="text-secondary font-label">Phone:</span><span class="font-mono font-semibold text-on-surface">${esc(s.business.phone||"—")}</span></div>
     <div class="flex items-center justify-between gap-2"><span class="text-secondary font-label">Email:</span><span class="font-mono text-on-surface truncate">${esc(s.business.email||"—")}</span></div>
     <div class="flex items-center justify-between gap-2"><span class="text-secondary font-label">Source:</span><span class="font-label text-on-surface text-right">${esc(s.business.source||"—")}</span></div>
     <div class="flex items-center justify-between gap-2"><span class="text-secondary font-label">Lead status:</span><span class="font-label ${ok?"text-emerald-700 font-semibold":"text-secondary"}">${ok?"Approved "+esc(ok):"Not approved yet"}</span></div></div>
    <div class="pt-2 noprint"><button class="w-full py-2.5 px-4 rounded-lg ${ok?BTN_GREEN:"bg-surface-container-high text-secondary"} text-xs font-label font-bold flex items-center justify-center gap-2 transition-all" data-advisory="${esc(s.domain)}">${ic("outgoing_mail","text-[18px]")}${ok?"Copy prepared English advisory":"Preview advisory (approve to send)"}</button></div></div>
   <div class="flex items-center gap-2 text-[11px] font-label text-secondary">${ic("shield","text-[14px]")}<span>${isPublicBody(s)?"Public body — report to CERT-In (incident@cert-in.org.in), not a sales lead.":"CERT-In: not reported from SiteWatch."}</span></div></div></div>
 ${(s.proof||[]).length?`<div class="mt-5 flex flex-wrap gap-2 text-xs font-label">${s.proof.map(p=>`<a class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:underline" href="${esc(p.url)}" target="_blank" rel="noopener">${ic("link","text-[13px]")}${esc(p.label)}</a>`).join("")}</div>`:""}</div>`;
}
function bindDossier(){
 $$("[data-advisory]").forEach(b=>b.onclick=()=>{ const s=allSites().find(x=>x.domain===b.dataset.advisory); const t=advisory(s); if(approved[s.domain]){ try{ navigator.clipboard.writeText(t); toast("Advisory copied — review before sending. Email first; check DND before calling."); }catch(e){ showText("Prepared advisory",t); } } else showText("Advisory preview (approve the lead to send)",t); });
 $$("[data-print]").forEach(b=>b.onclick=()=>{ document.body.classList.add("print-dossier"); window.print(); document.body.classList.remove("print-dossier"); });
 $$("[data-wa]").forEach(b=>b.onclick=()=>whatsapp(b.dataset.wa));
}
function whatsapp(d){
 const s=allSites().find(x=>x.domain===d); if(!s) return;
 if(!approved[d]) return toast("Approve this lead first — no outreach before human review.");
 const n=phoneDigits(s.business.phone); if(!n) return toast("No phone number found for this site.");
 const f=fu(d); f.log.push({date:TODAY,type:"WhatsApp",status:f.status,note:"Opened WhatsApp with prepared advisory"}); if(f.status==="new") f.status="called"; follow[d]=f; save("sw.follow",follow);
 window.open("https://wa.me/"+n+"?text="+encodeURIComponent(advisory(s)),"_blank","noopener");
 render();
}

/* ---------- PAGE: Surveillance Matrix (national registry) ---------- */
function vMatrix(){
 const all=rows(), list=filteredRows(), top=topVictim(all);
 const c=st=>all.filter(x=>x.r.state===st).length, hacked=c("hacked_visible")+c("hacked_hidden");
 const fpStopped=rows(false).filter(x=>["false_positive","excluded"].includes(x.r.state)).length;
 const brands=brandsOf(all), bTotal=brands.reduce((a,[,l])=>a+l.length,0)||1;
 const g=GATE_IDS.map(id=>({pass:all.filter(x=>x.s.signals[id]===true).length,fail:all.filter(x=>x.s.signals[id]===false).length,pend:all.filter(x=>x.s.signals[id]==null).length}));
 const gateRow=(i,title,desc,stat,sub,col)=>`<div class="bg-surface-container-low p-4 rounded-xl flex items-center justify-between gap-4"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full ${col} flex items-center justify-center font-bold text-xs shrink-0">G${i}</div><div><div class="text-xs font-semibold text-on-surface">${title}</div><div class="text-[11px] text-secondary">${desc}</div></div></div><div class="text-right shrink-0"><span class="inline-flex items-center text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">${stat}</span><div class="text-[10px] text-secondary mt-0.5">${sub}</div></div></div>`;
 const t=top?top.s:null;
 const constraints=[ui.result&&[RESULTS[ui.result][0],"bg-tertiary-fixed text-on-tertiary-fixed","result"],ui.indiaOnly&&["🇮🇳 India focus","bg-primary/10 text-primary","jur"],ui.tier&&[`Tier: ${ui.tier}`,"bg-error-container text-on-error-container","tier"],ui.fleet&&[`${ui.fleet} injections`,"bg-surface-container text-on-surface-variant","fleet"],ui.gate&&[`Gates: ${ui.gate}`,"bg-surface-container text-on-surface-variant","gate"],ui.q&&[`“${ui.q}”`,"bg-surface-container text-on-surface-variant","q"]].filter(Boolean);
 $("#main").innerHTML=`<div class="flex flex-col w-full text-on-surface">
 ${t?`<div class="bg-primary/10 px-4 sm:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-label"><div class="flex items-center gap-2"><span class="inline-flex w-2 h-2 rounded-full bg-primary animate-pulse"></span><span class="font-semibold text-primary uppercase tracking-wider text-[11px]">Incident Alert</span><span class="text-secondary">•</span><span class="text-on-surface-variant font-medium">${esc(STATES[top.r.state])}: ${esc(t.domain)}${t.business.city?" ("+esc(t.business.city)+")":""}.</span></div><div class="flex items-center gap-4 text-secondary"><span>Last check: <strong class="text-on-surface font-mono">${esc(t.lastChecked||TODAY)}</strong></span><span class="text-outline-variant opacity-40">|</span><button class="text-primary hover:underline font-medium" data-go="leads">Open lead registry</button></div></div>`:""}
 <div class="p-4 sm:p-8 space-y-8 max-w-[1720px] mx-auto w-full">
  <header class="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2"><div class="space-y-2 max-w-4xl"><div class="flex items-center gap-2 font-label text-xs uppercase tracking-widest text-tertiary font-bold">${ic("shield","text-sm")} SiteWatch Verification Pipeline</div>
   <h1 class="font-headline text-3xl md:text-4xl lg:text-5xl text-on-surface font-semibold tracking-tight leading-tight">National Threat &amp; Defacement Registry</h1>
   <p class="font-body text-secondary text-sm md:text-base leading-relaxed max-w-3xl">Business websites taken over by gambling spam, found through public scans and confirmed with four checks: the Internet Archive shows a real business before, the domain was not re-bought, the original site files are still on the same server, and the spam was seen on two different days.</p></div>
   <div class="flex flex-wrap items-center gap-3">
    <button class="bg-gradient-to-r from-primary to-primary-container text-on-primary px-4 py-2.5 rounded-xl font-label text-xs font-semibold shadow-sm hover:shadow transition-all flex items-center gap-2" id="runSweep">${ic("play_circle","text-base")} Run Daily Sweep [${esc(config.schedule)} IST]</button>
    <button class="bg-surface-container-high text-on-surface hover:bg-surface-container-highest px-3.5 py-2.5 rounded-xl font-label text-xs font-semibold transition-all flex items-center gap-1.5" id="stix">${ic("download","text-base text-secondary")} STIX 2.1 JSON</button>
    <button class="bg-surface-container-high text-on-surface hover:bg-surface-container-highest px-3.5 py-2.5 rounded-xl font-label text-xs font-semibold transition-all flex items-center gap-1.5" id="csv">${ic("table_view","text-base text-secondary")} Export Lead CSV</button></div></header>
  <section class="bg-surface-container-lowest p-5 rounded-2xl shadow-sm space-y-4"><div class="flex flex-col xl:flex-row gap-4 items-stretch xl:items-center justify-between">
   <div class="relative flex-1 min-w-[240px]">${ic("manage_search","absolute left-3.5 top-1/2 -translate-y-1/2 text-secondary text-lg")}<input id="omni" value="${esc(ui.q)}" class="w-full bg-surface-container-low text-on-surface placeholder:text-secondary text-xs pl-10 pr-14 py-3 rounded-xl focus:outline-none focus:bg-surface-container-lowest focus:ring-1 focus:ring-primary transition-all font-body" placeholder="Search domain, owner phone (+91), city, syndicate..." type="text"><kbd class="absolute right-3.5 top-1/2 -translate-y-1/2 bg-surface-container-high text-secondary px-2 py-0.5 rounded text-[10px] font-mono">⌘K</kbd></div>
   <div class="flex flex-wrap items-center gap-2">
    ${pillSel("fJur","public","Jurisdiction",[["india","🇮🇳 India Priority"],["all","Global"]],ui.indiaOnly?"india":"all")}
    ${pillSel("fGate","filter_alt","Stage",[["","All Gates"],["full","G1–G4 passed"],["pending","Pending"],["failed","Failed"]],ui.gate)}
    ${pillSel("fTier","crisis_alert","Tier",[["","All"],["critical","Critical"],["triage","Triage"],["monitor","Monitor"],["clean","Clean"],["excluded","Excluded"]],ui.tier)}
    ${pillSel("fFleet","radar","Fleet",[["","All"]].concat(brands.map(([b])=>[b,b])),ui.fleet)}
    ${pillSel("fResult","fact_check","Result",[["","All"]].concat(resultCounts().map(([k,n])=>[k,`${RESULTS[k][0]} (${n})`])),ui.result||"")}</div></div>
   <div class="flex flex-wrap items-center justify-between gap-3 pt-2"><div class="flex flex-wrap items-center gap-2"><span class="text-xs font-label text-secondary uppercase tracking-wider mr-1">Active Constraints:</span>${constraints.map(([l,cl,k])=>`<span class="inline-flex items-center gap-1.5 ${cl} px-2.5 py-1 rounded-lg text-xs font-medium">${esc(l)}<button class="hover:text-error ml-0.5" data-unset="${k}" aria-label="Remove">${ic("close","text-[13px]")}</button></span>`).join("")||`<span class="text-xs text-secondary">none</span>`}<button class="text-xs font-label text-secondary hover:text-error transition-colors underline ml-2" id="resetAll">Reset Filter Matrix</button></div>
   <div class="text-xs font-label text-secondary">Displaying <span class="font-semibold text-on-surface">${list.length}</span> of <span class="font-semibold text-on-surface">${rows(false).length}</span> monitored endpoints</div></div></section>
  ${t?heroCard(top):""}
  <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
   ${metric("Ingested","data_exploration",all.length,`${rows(false).length} global`,"Sites in scope from urlscan + manual list","primary")}
   ${metric("Confirmed Hijacked","dangerous",hacked,hacked?"Lead":"none",all.filter(x=>["hacked_visible","hacked_hidden"].includes(x.r.state)).map(x=>x.s.domain).slice(0,2).join(", ")||"—","error")}
   ${metric("In Triage Pipeline","hourglass_top",c("review"),"Awaiting gates","Review before any outreach","tertiary")}
   ${metric("Was Hacked / Cleaned","verified",c("was_hacked"),"Spam gone","urlscan screenshot kept as proof","green")}
   ${metric("False Positives Stopped","rule",fpStopped,"Excluded","Spammer-owned, re-bought, hosting or marked by you","primary")}</section>
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
   <section class="lg:col-span-7 bg-surface-container-lowest p-6 rounded-2xl shadow-sm space-y-6"><div class="flex items-center justify-between gap-3"><div class="space-y-1"><h3 class="font-headline text-lg font-semibold text-on-surface">4-Tier Heuristic Verification Funnel</h3><p class="text-xs font-body text-secondary">Each gate removes a kind of false positive before anyone is contacted.</p></div><button class="bg-surface-container px-2.5 py-1 rounded-lg text-xs font-label font-medium text-secondary hover:text-primary" data-go="gates">Configure rigor</button></div>
    <div class="space-y-4">
     ${gateRow(1,"Wayback Historical Identity Match","Archive shows a real, non-gambling business before",`${g[0].pass} passed`,`${g[0].fail} failed · ${g[0].pend} pending`,"bg-emerald-100 text-emerald-800")}
     ${gateRow(2,"RDAP Registration Gap Check","Domain was not dropped and re-bought by a spammer",`${g[1].pass} passed`,`${g[1].fail} re-bought · ${g[1].pend} pending`,"bg-emerald-100 text-emerald-800")}
     ${gateRow(3,"Same Server / Old Files Still Live","Owner's homepage or original files still load next to the spam",`${g[2].pass} passed`,`${g[2].fail} failed · ${g[2].pend} pending`,"bg-emerald-100 text-emerald-800")}
     ${gateRow(4,"Dual-Day Persistence","Spam seen by urlscan earlier and by us today",`${g[3].pass} passed`,`${g[3].fail} gone · ${g[3].pend} pending`,"bg-tertiary-fixed text-on-tertiary-fixed")}</div></section>
   <section class="lg:col-span-5 bg-surface-container-lowest p-6 rounded-2xl shadow-sm space-y-6 flex flex-col"><div class="space-y-1"><div class="flex items-center justify-between"><h3 class="font-headline text-lg font-semibold text-on-surface">Syndicate Attribution &amp; Fleet</h3>${ic("hub","text-secondary text-sm")}</div><p class="text-xs font-body text-secondary">Spam brands seen on the sites in scope (from page titles).</p></div>
    <div class="space-y-4">${brands.slice(0,5).map(([b,l],i)=>`<div class="space-y-1.5"><div class="flex items-center justify-between text-xs"><span class="font-label font-bold text-on-surface flex items-center gap-1.5"><span class="w-2 h-2 rounded-full ${BRAND_COLORS[i]}"></span>${esc(b)}</span><span class="font-mono text-secondary">${(l.length/bTotal*100).toFixed(1)}% (${l.length} site${l.length>1?"s":""})</span></div><div class="w-full bg-surface-container-high h-2.5 rounded-full overflow-hidden"><div class="${BRAND_COLORS[i]} h-full rounded-full" style="width:${l.length/bTotal*100}%"></div></div><div class="text-[10px] text-secondary font-label truncate">${esc(l.map(x=>x.s.domain).join(", "))}</div></div>`).join("")||`<div class="text-xs text-secondary">No brands in scope.</div>`}</div>
    <div class="mt-auto p-3 bg-surface-container rounded-xl flex items-center gap-3">${ic("vpn_lock","text-primary text-xl")}<div class="text-[11px] text-on-surface-variant font-body">Hosting origin of the spam groups is not attributed — only brands seen on victim pages are shown.</div></div></section></div>
  <section class="bg-surface-container-lowest rounded-2xl shadow-sm overflow-hidden"><div class="p-6 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h3 class="font-headline text-xl font-semibold text-on-surface">Active Surveillance Registry</h3><p class="text-xs text-secondary font-body">Monitored sites, gate status, and outreach eligibility.</p></div><div class="flex items-center gap-2">${btn("Column Visibility","view_column","bg-surface-container-high text-on-surface hover:bg-surface-container-highest",'id="openCols"')}${btn(ui.density==="dense"?"Comfortable Density":"Compact Density","density_small","bg-surface-container-high text-on-surface hover:bg-surface-container-highest",'id="toggleDensity"')}</div></div>
   <div class="px-0">${registryTable(list,{selectable:false})}</div></section>
  ${t?dossier(top):""}
 </div></div>`;
 bindFilters(); bindTable(); bindDossier(); bindCommon();
 $$("[data-unset]").forEach(b=>b.onclick=()=>{ const k=b.dataset.unset; if(k==="jur") ui.indiaOnly=false; else if(k==="q") ui.q=""; else ui[k]=""; render(); });
 const td=$("#toggleDensity"); if(td) td.onclick=()=>{ ui.density=ui.density==="dense"?"compact":"dense"; save("sw.density",ui.density); render(); };
}
function pillSel(id, icon, label, opts, cur){
 return `<label class="relative bg-surface-container-low hover:bg-surface-container text-on-surface pl-3 pr-2 py-2 rounded-xl text-xs font-label font-medium flex items-center gap-2 cursor-pointer">${ic(icon,"text-sm text-secondary")}<span>${label}:</span><select id="${id}" class="bg-transparent font-semibold text-primary focus:outline-none cursor-pointer pr-1">${opts.map(([v,t])=>`<option value="${esc(v)}" ${cur===v?"selected":""}>${esc(t)}</option>`).join("")}</select></label>`;
}
function metric(label, icon, value, chip, sub, tone){
 const col={primary:"text-primary",error:"text-error",tertiary:"text-tertiary",green:"text-emerald-600"}[tone]||"text-secondary";
 return `<div class="bg-surface-container-lowest p-5 rounded-2xl shadow-sm space-y-2"><div class="flex items-center justify-between text-secondary"><span class="text-xs font-label uppercase tracking-wider font-semibold">${label}</span>${ic(icon,"text-lg "+col)}</div><div class="flex items-baseline gap-2"><span class="font-headline text-3xl font-bold ${tone==="error"&&value?"text-error":"text-on-surface"}">${value}</span><span class="text-xs font-label ${tone==="error"?"text-error bg-error-container/50":tone==="green"?"text-emerald-700 bg-emerald-50":"text-secondary bg-surface-container"} font-semibold px-1.5 py-0.5 rounded">${esc(chip)}</span></div><div class="text-[11px] text-secondary font-body truncate" title="${esc(sub)}">${esc(sub)}</div></div>`;
}
function heroCard(x){
 const {s,r}=x, ok=approved[s.domain], wa=phoneDigits(s.business.phone), g=gatesPassed(s);
 const views=s.signals.cloaking?"Google / mobile only (cloaked)":"Everyone (browser, Googlebot, mobile)";
 const narrative=[s.business.name?`${s.business.name}${s.business.city?" in "+s.business.city:""}.`:"",
  s.platform?`Platform: ${s.platform}.`:"", s.before.date?`Last clean archive copy: ${s.before.date}.`:"",
  `Spam now on ${pagePath(s)}: “${(s.now.title||"").slice(0,90)}”.`, exposureDays(s)!==null?`Exposure window: up to ${exposureDays(s)} days.`:""].filter(Boolean).join(" ");
 return `<section class="bg-surface-container-lowest rounded-2xl p-6 lg:p-8 shadow-sm relative overflow-hidden"><div class="absolute -right-24 -top-24 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none"></div>
 <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative z-10"><div class="lg:col-span-8 space-y-4">
  <div class="flex flex-wrap items-center gap-2.5"><span class="${TIER[r.state]==="critical"?"bg-error text-on-error":"bg-tertiary-fixed text-on-tertiary-fixed"} px-2.5 py-0.5 rounded-full font-label text-[11px] font-bold tracking-wider uppercase flex items-center gap-1">${ic("fmd_bad","text-xs")} ${esc(STATES[r.state])}</span><span class="bg-tertiary-fixed text-on-tertiary-fixed px-2.5 py-0.5 rounded-full font-label text-[11px] font-semibold">${g}/4 gates${s.signals.seen_twice?" · dual-day confirmed":""}</span><span class="text-secondary text-xs font-mono">${incidentId(s)}</span></div>
  <div class="space-y-1"><h2 class="font-headline text-2xl lg:text-3xl text-on-surface font-semibold break-all">${esc(s.domain)}</h2><div class="flex flex-wrap items-center gap-2 text-sm text-secondary font-label">${ic("location_on","text-base text-primary")}<span>${esc(s.business.city||"Location unknown")}${s.india?", India":""}</span><span>•</span><span class="text-on-surface font-medium">Legitimate identity: ${esc(s.business.name||s.before.title||"unknown")}</span></div></div>
  <p class="font-body text-on-surface-variant text-sm leading-relaxed max-w-3xl">${esc(narrative)}</p>
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
   ${badge("Syndicate Fleet",`${ic("hub","text-xs text-primary")} ${esc(s.campaign||"—")}`)}${badge("Published Contact",`<span class="font-mono">${esc(s.business.phone||s.business.email||"Not found")}</span>`)}${badge("Spam Shown To",esc(views))}${badge("Posture Score",`<span class="text-error font-bold">${posture(s,r)} / 100</span>`)}</div></div>
  <div class="lg:col-span-4 bg-surface-container-low p-6 rounded-2xl space-y-4"><div class="space-y-1"><div class="text-xs font-label uppercase tracking-wider text-secondary font-bold">Action Protocol Required</div><div class="text-sm font-headline font-semibold text-on-surface">${ok?"Approved — outreach available":"Review &amp; approve before outreach"}</div><div class="text-xs text-on-surface-variant font-body">${ok?"Email first; check DND before calling. Contact was published by the business itself.":"False positives come first: nothing is sent until you approve this lead."}</div></div>
   <div class="space-y-2.5">${ok&&wa?`<button class="w-full bg-[#25D366] hover:bg-[#20ba5a] text-white py-2.5 px-4 rounded-xl font-label text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2" data-wa="${esc(s.domain)}">${ic("chat","text-base")} WhatsApp Direct Outreach (${esc(s.business.phone)})</button>`:`<button class="w-full bg-gradient-to-r from-primary to-primary-container text-on-primary py-2.5 px-4 rounded-xl font-label text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2" data-approve="${esc(s.domain)}" ${ok?"disabled":""}>${ic("verified","text-base")} ${ok?"Approved (no phone)":"Approve as Lead"}</button>`}
    <button class="w-full bg-surface-container-high hover:bg-surface-container-highest text-primary py-2.5 px-4 rounded-xl font-label text-xs font-semibold transition-all flex items-center justify-center gap-2" data-drawer="${esc(s.domain)}">${ic("quick_reference","text-base")} Inspect Forensic Dossier</button>
    <button class="w-full bg-surface-container text-on-surface-variant hover:text-on-surface py-2 px-4 rounded-xl font-label text-[11px] font-medium transition-all flex items-center justify-center gap-2" data-print="${esc(s.domain)}">${ic("notification_important","text-sm")} Generate CERT-In Incident Notification Slip</button></div></div></div></section>`;
}
const badge=(k,v)=>`<div class="bg-surface-container p-3 rounded-xl"><div class="text-[10px] font-label uppercase text-secondary font-medium">${k}</div><div class="text-xs font-semibold text-on-surface mt-0.5 truncate flex items-center gap-1">${v}</div></div>`;

/* ---------- PAGE: Compromised Leads (table view + split inspector) ---------- */
function vLeads(){
 const list=filteredRows(), all=rows();
 const hacked=all.filter(x=>["hacked_visible","hacked_hidden"].includes(x.r.state));
 const withContact=hacked.filter(x=>x.s.business.phone||x.s.business.email).length;
 if(!ui.inspect || !list.some(x=>x.s.domain===ui.inspect)) ui.inspect=(list.find(x=>["hacked_visible","hacked_hidden"].includes(x.r.state))||list[0]||{s:{}}).s.domain||null;
 const insp=list.find(x=>x.s.domain===ui.inspect);
 const nSel=ui.sel.size;
 $("#main").innerHTML=`<div class="flex flex-col w-full">
 ${pageHead(["Threat Surveillance","Target Registry & Ledger","Table View"],"Active Surveillance &amp; Remediation Registry",LIVE,
   `Ledger of ${rows(false).length} monitored sites (${rows(false).filter(x=>x.s.india).length} in India) with four verification gates, owner contact published by the business itself, and forensic proof.`,
   btn("Export CSV","file_download","bg-surface-container-high text-on-surface hover:bg-surface-container-highest",'id="csv"')+btn("Export STIX 2.1","hub","bg-surface-container-high text-on-surface hover:bg-surface-container-highest",'id="stix"')+btn("Batch Outreach"+(nSel?` (${nSel})`:""),"send",BTN_PRIMARY,'id="batch"')+
   `<div class="flex items-center gap-1 bg-surface-container p-1 rounded-lg ml-1">${[["split","splitscreen","Split Inspector"],["full","view_stream","Full Canvas"]].map(([k,i,t])=>`<button class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-label ${(ui.split?"split":"full")===k?"bg-surface-container-lowest text-on-surface shadow-sm":"text-secondary"}" data-view="${k}">${ic(i,"text-[15px]")}${t}</button>`).join("")}</div>`)}
  <div class="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
   ${kpi("Total Monitored","radar",all.length,`Across ${brandsOf(all).length} syndicates`)}
   ${kpi("Confirmed Breach","flag_circle",hacked.length,`${hacked.filter(x=>x.s.india).length} 🇮🇳 need remediation`,"red")}
   ${kpi("Multi-Gate Triage","hourglass_top",all.filter(x=>x.r.state==="review").length,"Gates pending","tertiary")}
   ${kpi("Restored Baseline","verified",all.filter(x=>x.r.state==="was_hacked").length,"Spam gone now","green")}
   ${kpi("Direct Outreach Ready","contact_phone",hacked.length?Math.round(withContact/hacked.length*100)+"%":"—",`${withContact} contact${withContact===1?"":"s"} found`,"primary")}</div></div>
 ${filterBar()}
 ${nSel?`<div class="mx-4 sm:mx-8 mt-6 px-4 py-3 rounded-xl bg-primary/10 flex flex-wrap items-center gap-3 text-xs font-label"><span class="font-semibold text-primary">${nSel} target${nSel>1?"s":""} selected</span><span class="text-secondary">|</span><span class="text-secondary">${[...ui.sel].filter(d=>approved[d]).length} approved</span><span class="ml-auto"></span>
  ${btn("Approve selected","verified","bg-surface-container-lowest text-on-surface hover:bg-surface-container",'id="bApprove"')}${btn("Dispatch outreach","send",BTN_PRIMARY,'id="batch2"')}${btn("Generate CERT-In dossier","report","bg-surface-container-lowest text-on-surface hover:bg-surface-container",'id="bDossier"')}${btn("Clear","close","bg-transparent text-secondary",'id="bClear"')}</div>`:""}
 <div class="px-4 sm:px-8 py-6 w-full grid grid-cols-1 ${ui.split?"xl:grid-cols-12":""} gap-6">
  <div class="${ui.split?"xl:col-span-8":""} min-w-0">${registryTable(list)}</div>
  ${ui.split?`<div class="xl:col-span-4 min-w-0">${inspector(insp)}</div>`:""}</div>
 <div class="px-4 sm:px-8 pb-8 w-full">${dossier(insp)}</div>
 <div class="px-4 sm:px-8 pb-12 grid grid-cols-1 md:grid-cols-3 gap-4">
  ${infoCard("verified","Dual-Day Consensus","A site counts as hacked only when urlscan saw the spam on an earlier day and our check sees it again today.")}
  ${infoCard("shield","Zero-Spam Owner Safety","Only contact details the business published itself are shown, and nothing is sent until you approve the lead.")}
  ${infoCard("policy","CERT-In Compliance Export","STIX 2.1 JSON and a printable dossier per site, for reporting to CERT-In (incident@cert-in.org.in).")}</div></div>`;
 bindFilters(); bindTable(); bindDossier(); bindCommon(); bindInspector(); bindFollowBoxes();
 $$("[data-view]").forEach(b=>b.onclick=()=>{ ui.split=b.dataset.view==="split"; save("sw.split",ui.split); render(); });
 const bc=$("#bClear"); if(bc) bc.onclick=()=>{ ui.sel.clear(); render(); };
 const ba=$("#bApprove"); if(ba) ba.onclick=()=>{ let n=0; ui.sel.forEach(d=>{ const x=rows(false).find(y=>y.s.domain===d); if(x&&!approved[d]&&!["excluded","false_positive"].includes(x.r.state)){ approve(d); n++; } }); toast(`${n} lead(s) approved`); render(); };
 const bd=$("#bDossier"); if(bd) bd.onclick=()=>exportSTIX([...ui.sel]);
 ["#batch","#batch2"].forEach(id=>{ const b=$(id); if(b) b.onclick=batchOutreach; });
}
const infoCard=(i,t,d)=>`<div class="p-5 rounded-2xl bg-surface-container-lowest shadow-sm flex gap-3"><div class="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">${ic(i,"text-[18px]")}</div><div><div class="text-sm font-semibold text-on-surface">${t}</div><div class="text-xs text-secondary mt-1 leading-relaxed">${d}</div></div></div>`;
function inspector(x){
 if(!x) return `<div class="bg-surface-container-lowest rounded-xl p-6 shadow-sm text-sm text-secondary">Select a row to inspect.</div>`;
 const {s,r}=x, g=gatesPassed(s), fp=fps[s.domain], ok=approved[s.domain], f=fu(s.domain);
 return `<div class="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden xl:sticky xl:top-20">
 <div class="p-4 bg-surface-container-low flex items-center justify-between gap-2"><div class="flex items-center gap-2 min-w-0"><div class="w-8 h-8 rounded-lg bg-error-container text-on-error-container flex items-center justify-center shrink-0">${ic("troubleshoot","text-[18px]")}</div><div class="min-w-0"><div class="text-sm font-semibold text-on-surface">Live Forensic Inspector</div><div class="text-[11px] text-secondary font-mono truncate">Target: ${esc(s.domain)}</div></div></div><span class="px-2 py-0.5 rounded-full text-[10px] font-bold font-label ${TIER[r.state]==="critical"?"bg-error-container text-on-error-container":"bg-surface-container text-secondary"}">${esc(STATES[r.state])}</span></div>
 <div class="p-4 space-y-4">
  <div class="p-4 rounded-xl bg-surface-container-low flex items-center justify-between"><div><div class="text-[11px] font-label font-semibold uppercase tracking-wider text-secondary">Breach Confidence Score</div><div class="flex items-baseline gap-1"><span class="font-headline text-4xl font-bold ${g===4?"text-error":"text-on-surface"}">${posture(s,r)}</span><span class="text-xs text-secondary">/ 100</span></div><div class="text-[11px] ${s.signals.cloaking?"text-error":"text-secondary"} font-label flex items-center gap-1">${ic(s.signals.cloaking?"warning":"info","text-[14px]")}${s.signals.cloaking?"Spam hidden from normal visitors":`${g}/4 gates passed`}</div></div><div class="relative w-16 h-16 flex items-center justify-center">${ring(posture(s,r),g===4?"text-error":"text-tertiary")}<span class="absolute text-[11px] font-bold">${posture(s,r)}%</span></div></div>
  <div><div class="flex items-center justify-between mb-2"><span class="text-xs font-semibold text-on-surface">Visual DOM Inversion Proof</span><span class="text-[10px] text-secondary font-label">Wayback vs live</span></div>${shots(s,"h-28")}</div>
  <div class="p-4 rounded-xl bg-surface-container-low space-y-2"><div class="flex items-center justify-between"><span class="text-xs font-semibold text-on-surface flex items-center gap-1">${ic("contacts","text-[16px] text-tertiary")}Owner Card</span><span class="px-2 py-0.5 rounded text-[10px] font-label font-bold ${ok?"bg-emerald-50 text-emerald-800":"bg-surface-container text-secondary"}">${ok?"APPROVED":fp?"FALSE POSITIVE":"NOT APPROVED"}</span></div>
   ${[["Business",s.business.name||"—"],["Location",s.business.city||"—"],["Phone",s.business.phone||"—"],["Email",s.business.email||"—"],["Follow-up",FOLLOW[f.status]]].map(([k,v])=>`<div class="flex items-center justify-between gap-3 text-xs"><span class="text-secondary font-label">${k}:</span><span class="text-on-surface text-right truncate ${k==="Phone"?"font-mono":""}">${esc(v)}</span></div>`).join("")}
   <div class="pt-2 flex flex-wrap gap-2">${fp?`${btn("Undo false positive","undo","bg-surface-container-high text-on-surface",`data-unfp="${esc(s.domain)}"`)}`:`${ok?"":btn("Approve as lead","verified",BTN_PRIMARY,`data-approve="${esc(s.domain)}"`)}<select id="iReason" class="bg-surface-container-lowest text-xs font-label rounded-lg px-2 py-2">${Object.entries(FP_REASONS).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select>${btn("Mark false positive","block","bg-surface-container-high text-on-surface",`data-fp="${esc(s.domain)}"`)}`}</div></div>
  <div><div class="flex items-center gap-1 mb-2 text-xs font-semibold text-on-surface">${ic("terminal","text-[16px] text-primary")}Ingestion Forensics Artifacts</div>${headersBox(s)}</div>
  <div class="p-4 rounded-xl bg-surface-container-low">${followBox(s.domain,true)}</div>
  <div class="space-y-2"><div class="text-xs font-semibold text-on-surface">Recommended Triage Actions</div>${["Re-check the page today, then approve or mark false positive","Email the owner first with the proof links (check DND before calling)","Offer cleanup: remove injected files / .htaccess rules, reset passwords, request Google re-index"].map((t,i)=>`<div class="flex items-start gap-2 text-xs"><span class="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">${i+1}</span><span class="text-on-surface-variant">${t}</span></div>`).join("")}</div>
  <div class="grid grid-cols-2 gap-2 pt-1">${btn("Audit History","history","bg-surface-container-high text-on-surface justify-center",`data-audit="${esc(s.domain)}"`)}${btn(flags[s.domain]?"Escalated":"Flag Escalate","flag",flags[s.domain]?"bg-error-container text-on-error-container justify-center":"bg-surface-container-high text-error justify-center",`data-flag="${esc(s.domain)}"`)}</div></div></div>`;
}
/* ---------- Inline follow-up box (Site Check result + Leads inspector) ---------- */
function followBox(d, compact){
 const f=fu(d), s=allSites().find(x=>x.domain===d)||{business:{}};
 const inp="bg-surface-container-lowest text-xs rounded-lg px-2 py-2 shadow-sm";
 return `<div class="space-y-3" data-fbox="${esc(d)}">
  <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-headline ${compact?"text-sm":"text-lg"} font-semibold text-on-surface flex items-center gap-1.5">${ic("forward_to_inbox","text-[18px] text-primary")}Follow-up</h3>
   <span class="text-[11px] font-label text-secondary">${approved[d]?"Approved lead":"Not approved yet — logging still works"}${s.business.phone?` · ${esc(s.business.phone)}`:""}</span></div>
  <div class="flex flex-wrap gap-2 items-center"><label class="text-[11px] font-label text-secondary">Status <select data-fst class="${inp}">${Object.entries(FOLLOW).map(([k,v])=>`<option value="${k}" ${f.status===k?"selected":""}>${v}</option>`).join("")}</select></label>
   <label class="text-[11px] font-label text-secondary">Next <input type="date" data-fnx value="${esc(f.next)}" class="${inp}"></label>
   ${[["Tomorrow",1],["+3 days",3],["+1 week",7]].map(([t,n])=>`<button class="px-2.5 py-1.5 rounded-lg bg-surface-container text-[11px] font-label hover:bg-surface-container-high" data-fquick="${n}">${t}</button>`).join("")}</div>
  <div class="flex flex-wrap gap-2"><select data-fty class="${inp}"><option>Email</option><option>Call</option><option>WhatsApp</option><option>Visit</option><option>Note</option></select>
   <input data-fnote placeholder="What happened? e.g. called, no answer — call back Monday" class="flex-1 min-w-[180px] ${inp}">
   <button class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg ${BTN_PRIMARY} text-xs font-label" data-fadd>${ic("add")}Log</button></div>
  <div class="space-y-2 border-l-2 border-surface-container-high pl-3 ${compact?"max-h-40":"max-h-60"} overflow-y-auto">${f.log.slice().reverse().map(l=>`<div class="text-xs"><span class="font-semibold">${esc(l.date)}</span> · ${esc(l.type)} · <span class="text-secondary">${esc(FOLLOW[l.status]||l.status)}</span><div class="text-on-surface-variant">${esc(l.note)}</div></div>`).join("")||`<div class="text-xs text-secondary">No activity yet.</div>`}</div></div>`;
}
function bindFollowBoxes(after){
 $$("[data-fbox]").forEach(box=>{
  const d=box.dataset.fbox, f=fu(d);
  const done=(msg)=>{ follow[d]=f; save("sw.follow",follow); if(msg) toast(msg); shell(); after?after():render(); };
  box.querySelector("[data-fst]").onchange=e=>{ const old=f.status; f.status=e.target.value; f.log.push({date:TODAY,type:"Status",status:f.status,note:`${FOLLOW[old]} → ${FOLLOW[f.status]}`}); done("Status saved"); };
  box.querySelector("[data-fnx]").onchange=e=>{ f.next=e.target.value; done("Next follow-up: "+(f.next||"none")); };
  box.querySelectorAll("[data-fquick]").forEach(b=>b.onclick=()=>{ const t=new Date(); t.setDate(t.getDate()+(+b.dataset.fquick)); f.next=t.toISOString().slice(0,10); done("Next follow-up: "+f.next); });
  const add=()=>{ const n=box.querySelector("[data-fnote]").value.trim(); if(!n) return toast("Type what happened first");
   const type=box.querySelector("[data-fty]").value; if(f.status==="new"&&["Email","Call","WhatsApp","Visit"].includes(type)) f.status=type==="Email"?"emailed":"called";
   f.log.push({date:TODAY,type,status:f.status,note:n}); done("Logged — it now shows in Follow-ups"); };
  box.querySelector("[data-fadd]").onclick=add;
  box.querySelector("[data-fnote]").onkeydown=e=>{ if(e.key==="Enter") add(); };
 });
}
function bindInspector(){
 $$("[data-approve]").forEach(b=>b.onclick=()=>{ approve(b.dataset.approve); toast("Approved as lead — re-verify before contact."); render(); if($("#drawer").dataset.open) openDrawer(b.dataset.approve); });
 $$("[data-fp]").forEach(b=>b.onclick=()=>{ const reason=($("#iReason")||$("#dReason")||{value:"other"}).value; markFP(b.dataset.fp,reason,""); toast("Marked false positive — see Gate Funnel & Rigor for the suggested rule."); render(); if($("#drawer").dataset.open) openDrawer(b.dataset.fp); });
 $$("[data-unfp]").forEach(b=>b.onclick=()=>{ unmarkFP(b.dataset.unfp); render(); if($("#drawer").dataset.open) openDrawer(b.dataset.unfp); });
 $$("[data-flag]").forEach(b=>b.onclick=()=>{ const d=b.dataset.flag; if(flags[d]) delete flags[d]; else flags[d]=TODAY; save("sw.flags",flags); const f=fu(d); f.log.push({date:TODAY,type:"Escalation",status:f.status,note:flags[d]?"Flagged for escalation":"Escalation removed"}); follow[d]=f; save("sw.follow",follow); render(); });
 $$("[data-audit]").forEach(b=>b.onclick=()=>{ const f=fu(b.dataset.audit); showText("Audit history — "+b.dataset.audit, f.log.length?f.log.map(l=>`${l.date} · ${l.type} · ${FOLLOW[l.status]||l.status}\n${l.note}`).join("\n\n"):"No activity yet."); });
}

/* ---------- Deep-dive drawer (table customizer screen) ---------- */
function openDrawer(d){
 const x=rows(false).find(y=>y.s.domain===d); if(!x) return;
 const {s,r}=x, f=fu(d), g=gatesPassed(s), ev=s.evidence||{}, rm=remed[d]||{};
 const steps=[["Remove injected pages and rewrite rules","Delete spam files / .htaccess or DirectoryIndex changes; restore the original pages"],["Reset hosting, FTP, CMS and database passwords","Removes the attacker's access; enable 2FA and update plugins / PHP"],["Clean Google results","Remove spam URLs in Search Console, submit the clean sitemap, request review"]];
 const dr=$("#drawer"); dr.dataset.open="1";
 dr.innerHTML=`<div class="p-6 bg-surface-container-low flex flex-col gap-3"><div class="flex items-center justify-between"><div class="flex items-center gap-2">${ic("policy","text-[20px] text-primary")}<span class="text-xs font-label font-bold uppercase tracking-wider text-secondary">Target Deep-Dive Inspector</span></div>
  <div class="flex items-center gap-1.5"><button class="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center text-secondary hover:text-on-surface transition-colors" title="Expand to full view" id="drExpand">${ic(dr.classList.contains("w-full")?"close_fullscreen":"open_in_full","text-[18px]")}</button><button class="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center text-secondary hover:text-on-surface transition-colors" title="Close drawer" id="drClose">${ic("close","text-[18px]")}</button></div></div>
  <div class="flex items-start justify-between gap-3 pt-1"><div class="min-w-0"><h2 class="font-headline font-bold text-xl text-on-surface tracking-tight leading-tight break-all">${esc(s.domain)}</h2><p class="text-xs font-label text-secondary mt-0.5">${esc([s.business.city,s.business.name].filter(Boolean).join(" · ")||"—")}</p></div>${tag(r.state,s,r)}</div>
  <div class="flex items-center gap-2 pt-2"><div class="flex-1 bg-surface-container-highest rounded-full h-1.5 overflow-hidden flex"><div class="bg-primary h-full" style="width:${g*25}%"></div></div><span class="font-mono text-[10px] text-primary font-semibold">${g===4?"ALL GATES CLEARED (G1-G4)":`${g}/4 GATES`}</span></div></div>
 <div class="flex-1 overflow-y-auto p-6 space-y-6">
  <div class="space-y-3"><div class="flex items-center justify-between"><h3 class="font-headline font-semibold text-sm text-on-surface flex items-center gap-1.5">${ic("difference","text-[18px] text-primary")}Forensic Visual Diff</h3><span class="text-[10px] font-label text-secondary uppercase tracking-wider">Archive vs live</span></div>${shots(s,"aspect-[4/3]")}
   <div class="grid grid-cols-2 gap-3 text-[11px] font-label"><p class="text-secondary leading-snug">${esc(s.before.title||"No clean copy")}</p><p class="text-error font-medium leading-snug">${esc((s.now.title||"").slice(0,100))}</p></div></div>
  <div class="p-4 rounded-xl bg-surface-container-low space-y-3"><div class="flex items-center justify-between"><span class="text-xs font-label uppercase tracking-wider font-semibold text-secondary flex items-center gap-1">${ic("contacts","text-[16px] text-tertiary")}Owner &amp; Lead Channel</span><span class="px-2 py-0.5 rounded text-[10px] font-label font-bold ${approved[d]?"bg-primary-fixed text-on-primary-fixed":"bg-surface-container text-secondary"}">${approved[d]?"LEAD APPROVED":fps[d]?"FALSE POSITIVE":"AWAITING REVIEW"}</span></div>
   ${[["Business",s.business.name],["Owner name","Not verified"],["Phone",s.business.phone],["Email",s.business.email],["Contact source",s.business.source],["Platform",s.platform],["Registered",s.registered]].map(([k,v])=>`<div class="flex items-center justify-between gap-3 text-xs"><span class="text-secondary font-label shrink-0">${k}:</span><span class="text-on-surface text-right truncate ${k==="Phone"?"font-mono":""}">${esc(v||"—")}</span></div>`).join("")}
   <div class="flex flex-wrap gap-2 pt-1">${fps[d]?btn("Undo false positive","undo","bg-surface-container-high text-on-surface",`data-unfp="${esc(d)}"`):(approved[d]?(phoneDigits(s.business.phone)?btn("Send WhatsApp advisory","chat",BTN_GREEN,`data-wa="${esc(d)}"`):""):btn("Approve as lead","verified",BTN_PRIMARY,`data-approve="${esc(d)}"`)+`<select id="dReason" class="bg-surface-container-lowest text-xs font-label rounded-lg px-2 py-2">${Object.entries(FP_REASONS).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select>`+btn("Mark false positive","block","bg-surface-container-high text-on-surface",`data-fp="${esc(d)}"`))}</div></div>
  <div class="space-y-3"><div class="flex items-center justify-between"><h3 class="font-headline font-semibold text-sm text-on-surface flex items-center gap-1.5">${ic("terminal","text-[18px] text-primary")}Doorway &amp; Cloaking Telemetry</h3><span class="text-[10px] font-mono text-secondary">4-view differential</span></div>
   <div class="p-3.5 rounded-xl bg-surface-container text-xs font-mono space-y-2.5">${[["Infected page",pagePath(s)],["Cloaking",ev.cloaking||(s.signals.cloaking?"Yes":"Same content for all views")],["Spam pages",ev.spam_in_index||"—"],["Old files",ev.old_assets_live||"—"],["Registry",ev.no_registration_gap||(s.registered?"Registered "+s.registered:"—")]].map(([k,v])=>`<div class="flex items-start justify-between gap-2"><span class="text-secondary shrink-0">${k}:</span><span class="text-on-surface bg-surface-container-lowest px-2 py-0.5 rounded text-right">${esc(String(v).slice(0,160))}</span></div>`).join("")}</div>${headersBox(s)}</div>
  <div class="space-y-3"><div class="flex items-center justify-between"><h3 class="font-headline font-semibold text-sm text-on-surface flex items-center gap-1.5">${ic("healing","text-[18px] text-tertiary")}Remediation Action Protocol</h3><span class="text-[10px] font-label text-secondary">Done by the owner / with their access</span></div>
   <div class="space-y-2">${steps.map(([t,dd],i)=>`<div class="p-3 rounded-xl bg-surface-container flex items-center justify-between gap-3"><div class="flex items-center gap-3"><span class="w-6 h-6 rounded-full ${rm[i+1]?"bg-emerald-600 text-white":"bg-primary/10 text-primary"} flex items-center justify-center text-[11px] font-bold shrink-0">${rm[i+1]?ic("check","text-[14px]"):i+1}</span><div><div class="text-xs font-semibold text-on-surface">${t}</div><div class="text-[11px] text-secondary">${dd}</div></div></div><button class="px-3 py-1 rounded-lg text-[11px] font-label font-semibold ${rm[i+1]?"bg-emerald-50 text-emerald-800":"bg-surface-container-lowest text-primary"}" data-step="${i+1}">${rm[i+1]?"Done":"Mark done"}</button></div>`).join("")}</div></div>
  <div class="space-y-3"><h3 class="font-headline font-semibold text-sm text-on-surface flex items-center gap-1.5">${ic("forward_to_inbox","text-[18px] text-primary")}Follow-up</h3>
   <div class="flex flex-wrap gap-2"><select id="fst" class="bg-surface-container-lowest text-xs font-label rounded-lg px-2 py-2 shadow-sm">${Object.entries(FOLLOW).map(([k,v])=>`<option value="${k}" ${f.status===k?"selected":""}>${v}</option>`).join("")}</select><input type="date" id="fnx" value="${esc(f.next)}" class="bg-surface-container-lowest text-xs rounded-lg px-2 py-2 shadow-sm"></div>
   <div class="flex flex-wrap gap-2"><select id="fty" class="bg-surface-container-lowest text-xs font-label rounded-lg px-2 py-2 shadow-sm"><option>Email</option><option>Call</option><option>WhatsApp</option><option>Note</option></select><input id="fnote" placeholder="What happened? e.g. called, no answer" class="flex-1 min-w-[160px] bg-surface-container-lowest text-xs rounded-lg px-3 py-2 shadow-sm">${btn("Log","add",BTN_PRIMARY,'id="fadd"')}</div>
   <div class="space-y-2 border-l-2 border-surface-container-high pl-3">${f.log.slice().reverse().map(l=>`<div class="text-xs"><span class="font-semibold">${esc(l.date)}</span> · ${esc(l.type)} · <span class="text-secondary">${esc(FOLLOW[l.status]||l.status)}</span><div class="text-on-surface-variant">${esc(l.note)}</div></div>`).join("")||`<div class="text-xs text-secondary">No activity yet.</div>`}</div></div></div>
 <div class="p-4 bg-surface-container-low flex flex-wrap items-center justify-between gap-2">${btn("Download Lead Dossier (.json)","download","bg-surface-container-high text-on-surface",'id="drJson"')}${btn(f.status==="won"?"Incident handled":"Mark Incident Handled","task_alt",BTN_PRIMARY,'id="drHandled"')}</div>`;
 dr.classList.remove("translate-x-full"); $("#scrim").classList.remove("hidden");
 $("#drClose").onclick=closeDrawer; $("#drExpand").onclick=()=>{ dr.classList.toggle("w-full"); dr.classList.toggle("sm:w-[520px]"); openDrawer(d); };
 const upd=()=>{ follow[d]=f; save("sw.follow",follow); render(); openDrawer(d); };
 $("#fst").onchange=e=>{ f.status=e.target.value; upd(); };
 $("#fnx").onchange=e=>{ f.next=e.target.value; upd(); };
 $("#fadd").onclick=()=>{ const n=$("#fnote").value.trim(); if(!n) return; f.log.push({date:TODAY,type:$("#fty").value,status:f.status,note:n}); upd(); };
 $$("[data-step]").forEach(b=>b.onclick=()=>{ const k=b.dataset.step; remed[d]=remed[d]||{}; remed[d][k]=!remed[d][k]; save("sw.remed",remed); openDrawer(d); });
 $("#drJson").onclick=()=>download(`dossier-${d}.json`,JSON.stringify({domain:d,state:STATES[r.state],posture:posture(s,r),gates:Object.fromEntries(GATE_IDS.map(id=>[id,s.signals[id]??null])),business:s.business,platform:s.platform,registered:s.registered,before:s.before,now:s.now,evidence:s.evidence,proof:s.proof||[],captures:EVID[d]||null,approved:approved[d]||null,false_positive:fps[d]||null,followup:f,remediation:remed[d]||{}},null,2),"application/json");
 $("#drHandled").onclick=()=>{ f.status="won"; f.log.push({date:TODAY,type:"Note",status:"won",note:"Incident marked handled"}); upd(); };
 bindInspector(); bindDossier();
}
function closeDrawer(){ const dr=$("#drawer"); dr.classList.add("translate-x-full"); delete dr.dataset.open; $("#scrim").classList.add("hidden"); }

/* ---------- Customize Columns modal ---------- */
function openColumns(){
 let draftCols={order:cols.order.slice(),on:cols.on.slice(),preset:cols.preset};
 const m=$("#modal");
 const paint=()=>{
  const n=draftCols.order.filter(k=>draftCols.on.includes(k)||COLS[k].req).length;
  m.innerHTML=`<div class="w-full max-w-xl bg-surface-container-lowest rounded-2xl shadow-2xl overflow-hidden flex flex-col" role="dialog" aria-modal="true" aria-label="Customize columns">
  <div class="p-6 bg-surface-container-low flex items-start justify-between gap-4"><div><div class="flex items-center gap-2 text-xs font-label text-primary font-bold uppercase tracking-wider">${ic("view_column")}<span>Table Configuration</span></div><h2 class="font-headline font-bold text-xl text-on-surface tracking-tight mt-1">Customize Columns &amp; Density</h2><p class="text-xs font-body text-secondary mt-1">Toggle visibility, drag to reorder, or pick a preset.</p></div><button class="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center text-secondary hover:text-on-surface" id="mClose" aria-label="Close">${ic("close","text-[20px]")}</button></div>
  <div class="px-6 py-3 bg-surface-container flex items-center gap-2 overflow-x-auto text-xs font-label"><span class="text-secondary shrink-0 pr-1">Presets:</span>${Object.keys(PRESETS).map(p=>`<button class="px-3 py-1 rounded-lg ${draftCols.preset===p?"bg-primary text-on-primary shadow-sm":"bg-surface-container-lowest text-on-surface hover:bg-surface-container-high"} font-medium shrink-0" data-preset="${esc(p)}">${p}</button>`).join("")}</div>
  <div class="p-6 space-y-2 max-h-[380px] overflow-y-auto" id="colList">${draftCols.order.map(k=>{ const c=COLS[k]; return c.req?`<div class="flex items-center justify-between p-3 rounded-xl bg-surface-container-low"><div class="flex items-center gap-3">${ic("lock","text-[18px] text-secondary opacity-40")}<div><div class="text-xs font-medium text-on-surface flex items-center gap-1.5"><span>${c.t}</span><span class="text-[10px] font-label font-bold text-secondary uppercase bg-surface-container px-1.5 rounded">Required</span></div><div class="text-[11px] font-label text-secondary">${c.d}</div></div></div><input checked disabled class="w-4 h-4 accent-primary opacity-60" type="checkbox" aria-label="${c.t}"></div>`
   :`<div class="flex items-center justify-between p-3 rounded-xl hover:bg-surface-container transition-colors ${draftCols.on.includes(k)?"":"opacity-75"}" draggable="true" data-col="${k}"><div class="flex items-center gap-3">${ic("drag_indicator","text-[18px] text-secondary cursor-grab")}<div><div class="text-xs font-medium text-on-surface">${c.t}</div><div class="text-[11px] font-label text-secondary">${c.d}</div></div></div><div class="flex items-center gap-1"><button class="p-1 text-secondary hover:text-primary" data-up="${k}" aria-label="Move up">${ic("arrow_upward","text-[14px]")}</button><input ${draftCols.on.includes(k)?"checked":""} class="w-4 h-4 accent-primary cursor-pointer" type="checkbox" data-tog="${k}" aria-label="${c.t}"></div></div>`; }).join("")}</div>
  <div class="p-5 bg-surface-container-low flex items-center justify-between gap-3"><button class="text-xs font-label text-secondary hover:text-on-surface" id="mReset">Reset to Default</button><div class="flex gap-2"><button class="px-4 py-2 rounded-lg bg-surface-container-high text-xs font-label font-semibold" id="mCancel">Cancel</button><button class="px-4 py-2 rounded-lg ${BTN_PRIMARY} text-xs font-label" id="mApply">Apply &amp; Save View (${n} active columns)</button></div></div></div>`;
  m.querySelector("#mClose").onclick=m.querySelector("#mCancel").onclick=closeModal;
  m.querySelector("#mReset").onclick=()=>{ draftCols={order:Object.keys(COLS),on:PRESETS["Default SOC View"].slice(),preset:"Default SOC View"}; paint(); };
  m.querySelector("#mApply").onclick=()=>{ cols=draftCols; save("sw.cols",cols); closeModal(); render(); };
  m.querySelectorAll("[data-preset]").forEach(b=>b.onclick=()=>{ const p=b.dataset.preset; draftCols.on=PRESETS[p].slice(); draftCols.preset=p; draftCols.order=PRESETS[p].concat(Object.keys(COLS).filter(k=>!PRESETS[p].includes(k))); if(p==="Compact Density"){ ui.density="dense"; save("sw.density","dense"); } paint(); });
  m.querySelectorAll("[data-tog]").forEach(c=>c.onchange=()=>{ const k=c.dataset.tog; draftCols.on=c.checked?draftCols.on.concat(k):draftCols.on.filter(x=>x!==k); draftCols.preset="Custom"; paint(); });
  m.querySelectorAll("[data-up]").forEach(b=>b.onclick=()=>{ const k=b.dataset.up, i=draftCols.order.indexOf(k); if(i>1){ draftCols.order.splice(i,1); draftCols.order.splice(i-1,0,k); draftCols.preset="Custom"; paint(); } });
  let dragK=null;
  m.querySelectorAll("[data-col]").forEach(el=>{ el.ondragstart=()=>{ dragK=el.dataset.col; }; el.ondragover=e=>e.preventDefault(); el.ondrop=e=>{ e.preventDefault(); const to=el.dataset.col; if(!dragK||dragK===to) return; const o=draftCols.order; o.splice(o.indexOf(dragK),1); o.splice(o.indexOf(to),0,dragK); draftCols.preset="Custom"; paint(); }; });
 };
 paint(); m.classList.remove("hidden"); m.classList.add("flex");
}
function closeModal(){ const m=$("#modal"); m.classList.add("hidden"); m.classList.remove("flex"); delete m.dataset.progress; }
function showText(title, text){
 const m=$("#modal");
 m.innerHTML=`<div class="w-full max-w-xl bg-surface-container-lowest rounded-2xl shadow-2xl overflow-hidden" role="dialog" aria-modal="true"><div class="p-6 bg-surface-container-low flex items-start justify-between gap-4"><h2 class="font-headline font-bold text-lg text-on-surface">${esc(title)}</h2><button class="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center text-secondary" id="mClose" aria-label="Close">${ic("close","text-[20px]")}</button></div><pre class="p-6 text-xs whitespace-pre-wrap font-body text-on-surface max-h-[60vh] overflow-y-auto">${esc(text)}</pre></div>`;
 m.querySelector("#mClose").onclick=closeModal; m.classList.remove("hidden"); m.classList.add("flex");
}

/* ---------- Exports ---------- */
function exportSTIX(domains){
 const list=rows(false).filter(x=>domains?domains.includes(x.s.domain):["hacked_visible","hacked_hidden"].includes(x.r.state));
 const now=new Date().toISOString(), uid=()=>"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==="x"?r:(r&3|8)).toString(16)});
 const ident={type:"identity",spec_version:"2.1",id:"identity--"+uid(),created:now,modified:now,name:"SiteWatch India (local workspace)",identity_class:"organization"};
 const objs=[ident];
 list.forEach(({s,r})=>{ const url=(s.fingerprints||[]).find(x=>/^https?:/.test(x))||`https://${s.domain}/`;
  objs.push({type:"indicator",spec_version:"2.1",id:"indicator--"+uid(),created:now,modified:now,created_by_ref:ident.id,name:`Gambling spam injection on ${s.domain}`,
   description:`${STATES[r.state]}. Now: "${s.now.title}". Before (${s.before.date||"n/a"}): "${s.before.title||"n/a"}". Gates passed: ${gatesPassed(s)}/4.`,
   indicator_types:["compromised"],pattern:`[url:value = '${url.replace(/'/g,"\\'")}']`,pattern_type:"stix",valid_from:now,labels:[s.campaign||"unattributed"]}); });
 download(`sitewatch-stix-${TODAY}.json`,JSON.stringify({type:"bundle",id:"bundle--"+uid(),objects:objs},null,2),"application/json");
 toast(`STIX 2.1 bundle with ${list.length} indicator(s) downloaded`);
}
function batchOutreach(){
 const pick=(ui.sel.size?[...ui.sel]:rows().filter(x=>["hacked_visible","hacked_hidden"].includes(x.r.state)).map(x=>x.s.domain));
 const ok=pick.filter(d=>approved[d]), skipped=pick.length-ok.length;
 if(!ok.length) return toast("No approved leads selected — approve leads first (false positives come first).");
 const text=ok.map(d=>{ const s=allSites().find(x=>x.domain===d); return `=== ${d} · ${s.business.phone||s.business.email||"no contact"} ===\n${advisory(s)}`; }).join("\n\n");
 showText(`Prepared advisories for ${ok.length} approved lead(s)${skipped?` · ${skipped} skipped (not approved)`:""}`, text+"\n\nReminder: email first; check the DND registry before any call.");
}

/* ---------- PAGE: Gate Funnel & Rigor (rules, review queue, false positives) ---------- */
function vGates(){
 const T=config.thresholds, stats=ruleStats();
 const scope=rows();
 const queue=scope.filter(x=>LEAD_STATES.includes(x.r.state)&&!approved[x.s.domain]);
 const fpRows=allSites().filter(s=>fps[s.domain]);
 const stat=id=>stats[id]?`<span class="text-[11px] font-label text-secondary">hits ${stats[id].hits} · FP ${stats[id].fp}</span>`:`<span class="text-[11px] font-label text-secondary">no hits</span>`;
 const ruleGroup=(g,title,sub)=>card(`<div class="p-6 space-y-3"><div><h3 class="font-headline text-lg font-semibold text-on-surface">${title}</h3><p class="text-xs text-secondary">${sub}</p></div>${config.rules.filter(r=>r.group===g).map(r=>`<div class="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-surface-container-low"><input type="checkbox" class="w-4 h-4 accent-primary" data-en="${r.id}" ${r.enabled?"checked":""} aria-label="Enable ${esc(r.name)}"><div class="flex-1 min-w-[200px]"><div class="text-xs font-semibold text-on-surface">${esc(r.name)} <span class="font-mono text-[10px] text-secondary">${r.id}</span> ${g!=="gate"?stat(r.id):""}</div><div class="text-[11px] text-secondary">${esc(r.desc)}${r.param?` · ${esc(r.param.label)} <input type="number" step="0.05" data-pm="${r.id}" value="${r.param.value}" class="w-16 bg-surface-container-lowest rounded px-1 text-xs">`:""}</div></div>${"weight" in r?`<label class="text-[11px] font-label text-secondary">weight <input type="number" data-w="${r.id}" value="${r.weight}" min="0" max="100" class="w-16 bg-surface-container-lowest rounded-lg px-2 py-1 text-xs text-on-surface shadow-sm"></label>`:`<span class="text-[11px] font-label text-secondary">${g==="gate"?"must pass":"state only"}</span>`}</div>`).join("")}</div>`);
 $("#main").innerHTML=`<div class="flex flex-col w-full">
 ${pageHead(["Threat Surveillance","Verification","Gate Funnel & Rigor"],"Gate Funnel &amp; Rigor",`<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-label font-bold bg-error-container text-on-error-container">${ic("rule","text-[13px]")}FALSE POSITIVES FIRST</span>`,
   "Calling a business whose site is not hacked looks like a scam call. Nothing reaches outreach until you approve it, and every false positive you mark suggests a rule that stops similar ones.",
   btn("Export rules.json","download","bg-surface-container-high text-on-surface hover:bg-surface-container-highest",'id="exp"')+btn("Import","upload","bg-surface-container-high text-on-surface hover:bg-surface-container-highest",'id="imp"')+`<input type="file" id="impf" accept=".json" hidden>`)}</div>
 <div class="p-4 sm:p-8 space-y-8 max-w-[1720px] mx-auto w-full">
  ${card(`<div class="p-6 space-y-4"><div class="flex flex-wrap items-center justify-between gap-2"><div><h3 class="font-headline text-lg font-semibold text-on-surface">Review queue (${queue.length})</h3><p class="text-xs text-secondary">Look at the proof, then approve as a lead or mark false positive.</p></div><span class="text-[11px] font-label text-secondary">${ui.indiaOnly?"🇮🇳 India scope":"Global scope"} — switch in the top bar</span></div>
   ${queue.length?queue.map(({s,r})=>`<div class="p-4 rounded-xl bg-surface-container-low space-y-2"><div class="flex flex-wrap items-center gap-2"><span class="font-mono font-semibold text-sm text-primary">${esc(s.domain)}</span>${tag(r.state,s,r)}${dots(s)}<span class="ml-auto"></span>${btn("Open proof","open_in_full","bg-surface-container-lowest text-on-surface",`data-drawer="${esc(s.domain)}"`)}</div>
    <div class="text-xs text-on-surface-variant"><span class="text-secondary">Before:</span> ${esc(s.before.title||"—")} <span class="text-secondary">→ Now:</span> ${esc((s.now.title||"").slice(0,110))}</div>
    <div class="flex flex-wrap items-center gap-2">${btn(r.pending.length?"Approve anyway (re-verify first)":"Approve as lead","verified",BTN_PRIMARY,`data-approve="${esc(s.domain)}"`)}<select data-fpr="${esc(s.domain)}" class="bg-surface-container-lowest text-xs font-label rounded-lg px-2 py-2 shadow-sm">${Object.entries(FP_REASONS).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select>${btn("Mark false positive","block","bg-surface-container-high text-on-surface",`data-qfp="${esc(s.domain)}"`)}</div></div>`).join(""):`<div class="text-sm text-secondary">Nothing waiting.</div>`}</div>`)}
  ${fpRows.length?card(`<div class="p-6 space-y-3"><h3 class="font-headline text-lg font-semibold text-on-surface">Marked false positive (${fpRows.length})</h3>${fpRows.map(s=>{ const fp=fps[s.domain], sg=suggestRule(s,fp.reason); return `<div class="p-4 rounded-xl bg-surface-container-low space-y-2"><div class="flex flex-wrap items-center gap-2"><span class="font-mono font-semibold text-sm line-through text-secondary">${esc(s.domain)}</span><span class="text-[11px] text-secondary">${esc(FP_REASONS[fp.reason])} · ${esc(fp.date)}</span><span class="ml-auto"></span>${btn("Undo","undo","bg-surface-container-lowest text-on-surface",`data-unfp="${esc(s.domain)}"`)}</div>
    <div class="flex flex-wrap items-center gap-2">${sg?btn("Use suggested rule","auto_fix_high",BTN_PRIMARY,`data-sugg="${esc(s.domain)}"`)+`<span class="text-[11px] font-mono text-secondary">${esc(ruleSummary(sg))}</span>`:`<span class="text-[11px] text-secondary">Best fix:</span>`}${btn("Allowlist","check_circle","bg-surface-container-lowest text-on-surface",`data-aw="${esc(s.domain)}"`)}${btn("Spammer list","block","bg-surface-container-lowest text-on-surface",`data-bk="${esc(s.domain)}"`)}</div></div>`; }).join("")}</div>`):""}
  <div id="customCard">${card(`<div class="p-6 space-y-3"><div><h3 class="font-headline text-lg font-semibold text-on-surface">Custom rules (${config.custom.length})</h3><p class="text-xs text-secondary">Order: allowlist → spammer list → false-positive mark → exclude → force state → ± score → built-in checks.</p></div>
   ${config.custom.map(cr=>{ const err=ruleError(cr); return `<div class="p-4 rounded-xl bg-surface-container-low space-y-1"><div class="flex flex-wrap items-center gap-2"><input type="checkbox" class="w-4 h-4 accent-primary" data-ct="${cr.id}" ${cr.enabled?"checked":""} aria-label="Enable rule"><span class="text-sm font-semibold">${esc(cr.name)}</span>${stat(cr.id)}${cr.from?`<span class="text-[11px] text-secondary">from ${esc(cr.from)}</span>`:""}<span class="ml-auto"></span>${btn("Edit","edit","bg-surface-container-lowest text-on-surface",`data-ce="${cr.id}"`)}${btn("Delete","delete","bg-surface-container-lowest text-error",`data-cd="${cr.id}"`)}</div><div class="text-[11px] font-mono text-secondary">${esc(ruleSummary(cr))}</div>${err?`<div class="text-[11px] text-error">⚠ ${esc(err)} — rule is skipped</div>`:""}</div>`; }).join("")}
   <div id="builderWrap"></div></div>`)}</div>
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
   <div class="lg:col-span-7">${card(`<div class="p-6 space-y-4"><h3 class="font-headline text-lg font-semibold text-on-surface">Thresholds</h3><div class="flex flex-wrap gap-4 text-xs font-label">${[["tc","Confirm ≥",T.confirm],["tr","Review ≥",T.review],["tk","At risk ≥",T.risk]].map(([id,l,v])=>`<label class="flex items-center gap-2">${l}<input type="number" id="${id}" value="${v}" class="w-20 bg-surface-container-low rounded-lg px-2 py-1.5 text-sm"></label>`).join("")}</div><div id="impact" class="text-xs text-secondary"></div><div id="scoreLive"></div></div>`)}</div>
   <div class="lg:col-span-5 space-y-8">${card(`<div class="p-6 space-y-3"><h3 class="font-headline text-lg font-semibold text-on-surface">Allowlist &amp; spammer list</h3><p class="text-xs text-secondary">Allowlist = always Clean. Spammer list = spammer-owned, never a lead.</p>
    <div><div class="text-[11px] font-label font-semibold uppercase tracking-wider text-secondary mb-1">Allowlist</div>${config.allow.map(d=>`<span class="inline-flex items-center gap-1 bg-surface-container px-2.5 py-1 rounded-lg text-xs m-0.5">${esc(d)}<button data-rma="${esc(d)}" aria-label="Remove">${ic("close","text-[13px]")}</button></span>`).join("")||`<span class="text-xs text-secondary">empty</span>`}</div>
    <div><div class="text-[11px] font-label font-semibold uppercase tracking-wider text-secondary mb-1">Spammer-owned</div>${config.block.map(d=>`<span class="inline-flex items-center gap-1 bg-error-container/50 px-2.5 py-1 rounded-lg text-xs m-0.5">${esc(d)}<button data-rmb="${esc(d)}" aria-label="Remove">${ic("close","text-[13px]")}</button></span>`).join("")||`<span class="text-xs text-secondary">empty</span>`}</div>
    <div class="flex flex-wrap gap-2"><input id="listd" placeholder="domain" class="flex-1 min-w-[140px] bg-surface-container-low rounded-lg px-3 py-2 text-xs">${btn("Allowlist","add","bg-surface-container-high text-on-surface",'id="toAllow"')}${btn("Spammer list","add","bg-surface-container-high text-on-surface",'id="toBlock"')}</div></div>`)}
    ${card(`<div class="p-6 space-y-3"><h3 class="font-headline text-lg font-semibold text-on-surface">Rule quality</h3><p class="text-xs text-secondary">Rules with many false positives need a fix.</p>${cRuleQuality(stats)}</div>`)}</div></div>
  ${card(`<div class="p-6 space-y-3"><h3 class="font-headline text-lg font-semibold text-on-surface">Evidence matrix</h3><p class="text-xs text-secondary">Which check fired on which site — spot a rule that fires on clean sites.</p>${cMatrix(scope.map(({s,r})=>({s,r})))}</div>`)}
  ${ruleGroup("affected","Affected checks (add score)","Sum of hit weights = evidence score")}
  ${ruleGroup("gate","Confirmation gates (G1–G4)","All enabled gates must pass, otherwise the site stays in Review")}
  ${ruleGroup("history","History","Marks sites that had a spam period")}
  ${ruleGroup("risk","At-risk checks","Any platform · public data only — no probing")}
  ${card(`<div class="p-6 space-y-2"><h3 class="font-headline text-lg font-semibold text-on-surface">Change history</h3>${changes.slice(-10).reverse().map(c=>`<div class="text-xs"><span class="text-secondary font-mono">${esc(c.date)}</span> · ${esc(c.text)}</div>`).join("")||`<div class="text-xs text-secondary">No changes yet.</div>`}<div class="pt-2 flex flex-wrap gap-2">${btn("Undo last rule/list change","undo","bg-surface-container-high text-on-surface",`id="undoBtn" ${undo.length?"":"disabled"}`)}${btn("Reset to defaults","restart_alt","bg-surface-container-high text-on-surface",'id="rst"')}</div></div>`)}
 </div>`;
 bindGates(); renderBuilder(); showImpact(); bindCommon(); bindInspector();
}
function bindGates(){
 const T=config.thresholds, changed=()=>{ persist(); showImpact(); };
 $$("[data-qfp]").forEach(b=>b.onclick=()=>{ const d=b.dataset.qfp; markFP(d,document.querySelector(`[data-fpr="${d}"]`).value,""); render(); });
 $$("[data-sugg]").forEach(b=>b.onclick=()=>{ const s=allSites().find(x=>x.domain===b.dataset.sugg); draft=suggestRule(s,fps[s.domain].reason); renderBuilder(); $("#customCard").scrollIntoView({behavior:"smooth"}); });
 const addList=(k,d)=>{ d=(d||"").trim().toLowerCase(); if(!d||config[k].includes(d)) return; snapshot(`Added ${d} to ${k==="allow"?"allowlist":"spammer list"}`); config[k].push(d); persist(); render(); };
 $$("[data-aw]").forEach(b=>b.onclick=()=>addList("allow",b.dataset.aw)); $$("[data-bk]").forEach(b=>b.onclick=()=>addList("block",b.dataset.bk));
 $("#toAllow").onclick=()=>addList("allow",$("#listd").value); $("#toBlock").onclick=()=>addList("block",$("#listd").value);
 $$("[data-rma]").forEach(b=>b.onclick=()=>{ snapshot(`Removed ${b.dataset.rma} from allowlist`); config.allow=config.allow.filter(x=>x!==b.dataset.rma); persist(); render(); });
 $$("[data-rmb]").forEach(b=>b.onclick=()=>{ snapshot(`Removed ${b.dataset.rmb} from spammer list`); config.block=config.block.filter(x=>x!==b.dataset.rmb); persist(); render(); });
 $$("[data-ct]").forEach(i=>i.onchange=()=>{ const cr=config.custom.find(x=>x.id===i.dataset.ct); snapshot(`${i.checked?"Enabled":"Disabled"} rule “${cr.name}”`); cr.enabled=i.checked; persist(); render(); });
 $$("[data-ce]").forEach(b=>b.onclick=()=>{ draft=structuredClone(config.custom.find(x=>x.id===b.dataset.ce)); renderBuilder(); });
 $$("[data-cd]").forEach(b=>b.onclick=()=>{ const cr=config.custom.find(x=>x.id===b.dataset.cd); snapshot(`Deleted rule “${cr.name}”`); config.custom=config.custom.filter(x=>x.id!==cr.id); persist(); render(); });
 $$("[data-en]").forEach(i=>i.onchange=()=>{ config.rules.find(r=>r.id===i.dataset.en).enabled=i.checked; changed(); });
 $$("[data-w]").forEach(i=>i.oninput=()=>{ config.rules.find(r=>r.id===i.dataset.w).weight=+i.value||0; changed(); });
 $$("[data-pm]").forEach(i=>i.oninput=()=>{ config.rules.find(r=>r.id===i.dataset.pm).param.value=+i.value; changed(); });
 $("#tc").oninput=e=>{ T.confirm=+e.target.value; changed(); }; $("#tr").oninput=e=>{ T.review=+e.target.value; changed(); }; $("#tk").oninput=e=>{ T.risk=+e.target.value; changed(); };
 $("#undoBtn").onclick=()=>{ const p=undo.pop(); if(!p) return; Object.assign(config,JSON.parse(p)); changes.push({date:TODAY,text:"Undo"}); save("sw.undo",undo); save("sw.changes",changes); persist(); render(); };
 $("#rst").onclick=()=>{ snapshot("Reset to defaults"); config=structuredClone(DEFAULT_CONFIG); persist(); render(); };
 bindRulesIO();
}
function bindRulesIO(){
 const e=$("#exp"); if(e) e.onclick=()=>download("rules.json",JSON.stringify(config,null,2),"application/json");
 const i=$("#imp"); if(i) i.onclick=()=>$("#impf").click();
 const f=$("#impf"); if(f) f.onchange=ev=>{ const file=ev.target.files[0]; if(!file) return; file.text().then(t=>{ try{ snapshot("Imported rules.json"); config=normalizeConfig(JSON.parse(t)); persist(); render(); }catch(err){ toast("Invalid rules.json"); } }); };
}

/* Rule builder (logic from v1, design classes) */
function renderBuilder(){
 const w=$("#builderWrap"); if(!w) return;
 if(!draft){ w.innerHTML=btn("New rule","add",BTN_PRIMARY,'id="newRule"'); $("#newRule").onclick=()=>{ draft={name:"",enabled:true,match:"all",conds:[{field:"domain",op:"contains",value:""}],action:{type:"exclude",value:""}}; renderBuilder(); }; return; }
 const a=draft.action, inp="bg-surface-container-lowest text-xs rounded-lg px-2 py-2 shadow-sm";
 w.innerHTML=`<div class="p-4 rounded-xl bg-primary/5 ring-1 ring-primary/30 space-y-3" id="builder">
  <div class="flex flex-wrap items-center gap-2"><b class="text-sm">${draft.id?"Edit rule":"New rule"}</b><input data-b="name" placeholder="Rule name" value="${esc(draft.name)}" class="${inp} flex-1 min-w-[180px]"><select data-b="match" class="${inp}"><option value="all" ${draft.match==="all"?"selected":""}>ALL conditions</option><option value="any" ${draft.match==="any"?"selected":""}>ANY condition</option></select></div>
  ${draft.conds.map((c,i)=>`<div class="flex flex-wrap items-center gap-2"><span class="text-[11px] font-label text-secondary w-8">${i?draft.match==="any"?"OR":"AND":"IF"}</span><select data-ci="${i}" data-k="field" class="${inp}">${fieldOptions(c.field)}</select><select data-ci="${i}" data-k="op" class="${inp}">${Object.entries(OPS).map(([k,v])=>`<option value="${k}" ${c.op===k?"selected":""}>${v}</option>`).join("")}</select>${["is_true","is_false","is_pending"].includes(c.op)?"":`<input data-ci="${i}" data-k="value" value="${esc(c.value)}" placeholder="${["before","after"].includes(c.op)?"YYYY-MM-DD":"slot|toto|gacor"}" class="${inp} flex-1 min-w-[140px]">`}<button class="p-1.5 rounded-lg bg-surface-container text-secondary" data-rmc="${i}" aria-label="Remove condition">${ic("close","text-[14px]")}</button></div>`).join("")}
  ${btn("condition","add","bg-surface-container-high text-on-surface",'id="addCond"')}
  <div class="flex flex-wrap items-center gap-2"><span class="text-[11px] font-label text-secondary w-8">THEN</span><select data-b="atype" class="${inp}">${Object.entries(ACTIONS).map(([k,v])=>`<option value="${k}" ${a.type===k?"selected":""}>${v}</option>`).join("")}</select>${a.type==="force"?`<select data-b="aval" class="${inp}">${Object.entries(STATES).map(([k,v])=>`<option value="${k}" ${a.value===k?"selected":""}>${v}</option>`).join("")}</select>`:["add","subtract"].includes(a.type)?`<input type="number" data-b="aval" value="${esc(a.value)}" class="${inp} w-24">`:""}</div>
  <div class="text-xs" id="diff"></div>
  <div class="flex gap-2">${btn("Save rule","save",BTN_PRIMARY,'id="saveRule"')}${btn("Cancel","close","bg-surface-container-high text-on-surface",'id="cancelRule"')}</div></div>`;
 const b=$("#builder");
 const onEdit=e=>{ const t=e.target;
  if(t.dataset.b){ const k=t.dataset.b;
   if(k==="name") draft.name=t.value; else if(k==="match"){ draft.match=t.value; return renderBuilder(); }
   else if(k==="atype"){ a.type=t.value; a.value=t.value==="force"?"review":["add","subtract"].includes(t.value)?"20":""; return renderBuilder(); }
   else if(k==="aval") a.value=t.value; }
  if(t.dataset.ci!==undefined){ draft.conds[+t.dataset.ci][t.dataset.k]=t.value; if(t.dataset.k!=="value"&&e.type==="change") return renderBuilder(); }
  updateDiff(); };
 b.addEventListener("input",onEdit); b.addEventListener("change",e=>{ if(e.target.tagName==="SELECT") onEdit(e); });
 b.querySelectorAll("[data-rmc]").forEach(x=>x.onclick=()=>{ draft.conds.splice(+x.dataset.rmc,1); renderBuilder(); });
 $("#addCond").onclick=()=>{ draft.conds.push({field:"title_now",op:"contains",value:""}); renderBuilder(); };
 $("#cancelRule").onclick=()=>{ draft=null; renderBuilder(); };
 $("#saveRule").onclick=()=>{ const err=(!draft.name.trim()&&"Give the rule a name")||(!draft.conds.length&&"Add at least one condition")||ruleError(draft);
  if(err){ $("#diff").innerHTML=`<span class="text-error">⚠ ${esc(err)}</span>`; return; }
  snapshot(`${draft.id?"Edited":"Added"} rule “${draft.name}”`); if(!draft.id){ draft.id="c"+Date.now(); draft.created=TODAY; }
  config.custom=config.custom.filter(x=>x.id!==draft.id).concat([draft]); draft=null; persist(); render(); };
 updateDiff();
}
function updateDiff(){
 const el=$("#diff"); if(!el||!draft) return;
 const err=ruleError(draft); if(err){ el.innerHTML=`<span class="text-error">⚠ ${esc(err)}</span>`; return; }
 const test={...draft,id:draft.id||"__draft",enabled:true}, cfg2={...config,custom:config.custom.filter(x=>x.id!==test.id).concat([test])};
 const matched=allSites().filter(s=>ruleMatch(s,test));
 const diffs=allSites().map(s=>({d:s.domain,a:score(s).state,b:score(s,cfg2).state})).filter(x=>x.a!==x.b);
 el.innerHTML=`<b>Test:</b> matches ${matched.length} site(s)${matched.length?": "+matched.map(s=>esc(s.domain)).join(", "):""}<br>`+(diffs.length?`Would change ${diffs.length}: `+diffs.map(x=>`${esc(x.d)} ${esc(STATES[x.a])} → ${esc(STATES[x.b])}`).join(" · "):"No state changes.")+(matched.some(s=>approved[s.domain])?`<div class="text-error">⚠ Matches an approved lead — check it is really a false positive.</div>`:"");
}
function showImpact(){
 const el=$("#impact"); if(!el) return;
 const c={}; allSites().forEach(s=>{ const st=score(s).state; c[st]=(c[st]||0)+1; });
 el.innerHTML="Result now: "+Object.entries(c).map(([k,v])=>`${STATES[k]} ${v}`).join(" · ");
 const sl=$("#scoreLive"); if(sl) sl.innerHTML=cScore(rows().map(({s,r})=>({s,r})));
}

/* ---------- PAGE: Syndicate Tracking ---------- */
function vSynd(){
 const all=rows(), brands=brandsOf(all), tot=brands.reduce((a,[,l])=>a+l.length,0)||1;
 ui.graph = ui.graph || "matrix";
 $("#main").innerHTML=`<div class="flex flex-col w-full">
 ${pageHead(["Threat Surveillance","Syndicates","Syndicate Tracking"],"Syndicate Tracking",`<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-label font-bold bg-primary-fixed text-on-primary-fixed">${brands.length} BRANDS</span>`,
  "Spam brands seen on victim pages, grouped from page titles. Shared brands point to the same spam operation renting many hacked sites.",
  `<div class="flex items-center gap-1 bg-surface-container p-1 rounded-lg">${[["matrix","table_rows","Matrix"],["graph","schema","Syndicate Graph"]].map(([k,i,t])=>`<button class="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-label ${ui.graph===k?"bg-surface-container-lowest text-on-surface shadow-sm":"text-secondary"}" data-graph="${k}">${ic(i,"text-[15px]")}${t}</button>`).join("")}</div>`)}</div>
 <div class="p-4 sm:p-8 space-y-6 max-w-[1720px] mx-auto w-full">
 ${ui.graph==="matrix"?`<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">${brands.map(([b,l],i)=>{ const dates=l.map(x=>x.s.firstSeen).filter(Boolean).sort();
  return card(`<div class="p-6 space-y-3"><div class="flex items-center justify-between"><span class="font-label font-bold text-on-surface flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full ${BRAND_COLORS[i%BRAND_COLORS.length]}"></span>${esc(b)}</span><span class="font-mono text-xs text-secondary">${(l.length/tot*100).toFixed(1)}% · ${l.length} site${l.length>1?"s":""} · ${l.filter(x=>x.s.india).length} 🇮🇳</span></div>
   <div class="w-full bg-surface-container-high h-2.5 rounded-full overflow-hidden"><div class="${BRAND_COLORS[i%BRAND_COLORS.length]} h-full rounded-full" style="width:${l.length/tot*100}%"></div></div>
   <div class="text-[11px] text-secondary font-label">First seen ${esc(dates[0]||"—")} · last seen ${esc(dates[dates.length-1]||"—")}</div>
   <div class="space-y-1.5">${l.map(({s,r})=>`<button class="w-full flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-left" data-drawer="${esc(s.domain)}"><span class="font-mono text-xs truncate">${s.india?"🇮🇳 ":""}${esc(s.domain)}</span>${tag(r.state,s,r)}</button>`).join("")}</div></div>`); }).join("")||card(`<div class="p-6 text-sm text-secondary">No brands in scope.</div>`)}</div>`
 :card(`<div class="p-6 space-y-6">${brands.map(([b,l],i)=>`<div class="flex flex-col md:flex-row md:items-center gap-4"><div class="md:w-48 shrink-0 flex items-center gap-2"><span class="w-10 h-10 rounded-full ${BRAND_COLORS[i%BRAND_COLORS.length]} text-white flex items-center justify-center">${ic("hub","text-[18px]")}</span><span class="font-label font-bold text-sm">${esc(b)}</span></div><div class="hidden md:block w-10 border-t-2 border-dashed border-outline-variant"></div><div class="flex flex-wrap gap-2">${l.map(({s,r})=>`<button class="px-2.5 py-1 rounded-full text-[11px] font-mono ${["hacked_visible","hacked_hidden"].includes(r.state)?"bg-error-container text-on-error-container":"bg-surface-container text-on-surface"}" data-drawer="${esc(s.domain)}">${s.india?"🇮🇳 ":""}${esc(s.domain)}</button>`).join("")}</div></div>`).join("")||`<div class="text-sm text-secondary">No brands in scope.</div>`}</div>`)}
 </div>`;
 $$("[data-graph]").forEach(b=>b.onclick=()=>{ ui.graph=b.dataset.graph; render(); });
 bindTable(); bindCommon();
}

/* ---------- PAGE: CERT-In Outreach (approvals + follow-ups) ---------- */
function followData(){
 const all=rows();
 const leads=all.filter(x=>(approved[x.s.domain]||x.f.status!=="new")&&!["false_positive","excluded"].includes(x.r.state));
 const open=leads.filter(x=>!["won","lost","dnc"].includes(x.f.status));
 const grp={overdue:[],today:[],upcoming:[],unscheduled:[]};
 open.forEach(x=>{ const n=x.f.next; if(!n) grp.unscheduled.push(x); else if(n<TODAY) grp.overdue.push(x); else if(n===TODAY) grp.today.push(x); else grp.upcoming.push(x); });
 return {all,leads,open,grp};
}
function followTable(title,list,icon){
 return card(`<div class="p-6 pb-3 flex items-center justify-between"><h3 class="font-headline text-lg font-semibold text-on-surface flex items-center gap-2">${icon?ic(icon,"text-[20px] text-primary"):""}${title} (${list.length})</h3></div>${list.length?`<div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead><tr class="bg-surface-container text-on-surface-variant font-label text-[11px] uppercase tracking-wider"><th class="py-3 px-4">Domain</th><th class="py-3 px-4">State</th><th class="py-3 px-4">Business / contact</th><th class="py-3 px-4">Follow-up</th><th class="py-3 px-4">Next</th><th class="py-3 px-4">Last note</th><th class="py-3 px-4 text-right">Action</th></tr></thead><tbody>${list.map(({s,r,f})=>`<tr class="hover:bg-surface-container cursor-pointer" data-row="${esc(s.domain)}"><td class="py-3 px-4 font-mono font-semibold text-primary">${esc(s.domain)}</td><td class="py-3 px-4">${tag(r.state,s,r)}</td><td class="py-3 px-4">${esc(s.business.name||"—")}<div class="text-[11px] text-secondary font-mono">${esc(s.business.phone||s.business.email||"no contact")}</div></td><td class="py-3 px-4"><span class="px-2 py-0.5 rounded-full bg-surface-container text-[11px] font-label font-semibold">${FOLLOW[f.status]}</span></td><td class="py-3 px-4 font-mono ${f.next&&f.next<TODAY?"text-error font-bold":""}">${esc(f.next||"—")}</td><td class="py-3 px-4 text-secondary max-w-[220px] truncate">${esc(f.log.length?f.log[f.log.length-1].note:"")}</td><td class="py-3 px-4 text-right"><button class="p-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high" data-drawer="${esc(s.domain)}" aria-label="Open">${ic("open_in_full")}</button></td></tr>`).join("")}</tbody></table></div>`:`<div class="px-6 pb-6 text-sm text-secondary">Nothing here.</div>`}`);
}
/* ---------- PAGE: Follow-ups ---------- */
function vFollowups(){
 const {leads,grp}=followData(), cnt=k=>leads.filter(x=>x.f.status===k).length;
 const closed=leads.filter(x=>["won","lost","dnc"].includes(x.f.status));
 $("#main").innerHTML=`<div class="flex flex-col w-full">
 ${pageHead(["Threat Surveillance","Outreach","Follow-ups"],"Follow-ups",`<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-label font-bold ${grp.overdue.length?"bg-error-container text-on-error-container":"bg-primary-fixed text-on-primary-fixed"}">${grp.overdue.length+grp.today.length} DUE</span>`,
  "Every approved lead and what happened with it. Click a row to log a call or email, change the status or set the next date. Email first; check DND before calling.",
  btn("Export CSV","file_download","bg-surface-container-high text-on-surface hover:bg-surface-container-highest",'id="csv"')+btn("Batch Outreach","send",BTN_PRIMARY,'id="batch"'))}
  <div class="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">${kpi("Approved Leads","verified",Object.keys(approved).length,"human-checked","primary")}${kpi("Contacted","call",leads.filter(x=>!["new","dnc"].includes(x.f.status)).length,"any outreach logged")}${kpi("No Response","schedule",cnt("no_response"),"follow up","tertiary")}${kpi("Interested","thumb_up",cnt("interested"),"in talks","green")}${kpi("Won","task_alt",cnt("won"),"handled","green")}</div></div>
 <div class="p-4 sm:p-8 space-y-6 max-w-[1720px] mx-auto w-full">
  ${followTable("Overdue",grp.overdue,"alarm")}${followTable("Due today",grp.today,"today")}${followTable("Upcoming",grp.upcoming,"event_upcoming")}${followTable("Not scheduled yet",grp.unscheduled,"event_busy")}${followTable("Closed (won / lost / do not contact)",closed,"inventory_2")}
 </div>`;
 bindTable(); bindCommon();
 const b=$("#batch"); if(b) b.onclick=batchOutreach;
}
/* ---------- PAGE: CERT-In Outreach ---------- */
function vOutreach(){
 const {all,leads}=followData();
 const ready=leads.filter(x=>x.f.status==="new"&&["hacked_visible","hacked_hidden"].includes(x.r.state));
 const pub=all.filter(x=>isPublicBody(x.s)&&!["false_positive","excluded","clean"].includes(x.r.state));
 $("#main").innerHTML=`<div class="flex flex-col w-full">
 ${pageHead(["Threat Surveillance","Outreach","CERT-In Outreach"],"CERT-In Outreach",LIVE,
  "Approved leads not contacted yet, public bodies to report to CERT-In, and exports. Ongoing calls and emails are tracked in Follow-ups.",
  btn("Open Follow-ups","forward_to_inbox","bg-surface-container-high text-on-surface hover:bg-surface-container-highest",'data-go="followups"')+btn("Export CSV","file_download","bg-surface-container-high text-on-surface hover:bg-surface-container-highest",'id="csv"')+btn("Export STIX 2.1","hub","bg-surface-container-high text-on-surface hover:bg-surface-container-highest",'id="stix"')+btn("Batch Outreach","send",BTN_PRIMARY,'id="batch"'))}</div>
 <div class="p-4 sm:p-8 space-y-6 max-w-[1720px] mx-auto w-full">
  ${followTable("Approved — ready for first contact",ready,"outgoing_mail")}
  ${card(`<div class="p-6 space-y-3"><div class="flex items-center gap-2">${ic("account_balance","text-primary")}<h3 class="font-headline text-lg font-semibold text-on-surface">Public bodies — report to CERT-In (${pub.length})</h3></div><p class="text-xs text-secondary">Government, council and education sites: send the dossier to incident@cert-in.org.in instead of selling a cleanup.</p>${pub.map(({s,r})=>`<div class="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-surface-container-low"><span class="font-mono text-xs font-semibold">${esc(s.domain)}</span>${tag(r.state,s,r)}<span class="text-xs text-secondary">${esc(s.business.name||"")}</span><span class="ml-auto"></span>${btn("Dossier","print","bg-surface-container-lowest text-on-surface",`data-drawer="${esc(s.domain)}"`)}</div>`).join("")||`<div class="text-xs text-secondary">None in scope.</div>`}</div>`)}
 </div>`;
 bindTable(); bindCommon();
 const b=$("#batch"); if(b) b.onclick=batchOutreach;
}

/* ---------- PAGE: Site Check (one website, full details) ---------- */
const looksLikeSite=q=>/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test((q||"").trim());
let chk={status:null,timer:null};
async function loadChecks(){ if(SERVER){ try{ refreshChecks(await api("/api/checks")); mergeCheckEvidence(); }catch(e){} } }
async function startCheck(target){
 if(!SERVER) return showText("Start the server to check a website","Site Check needs the local server.\n\nDouble-click start.bat (or run: python server.py) and use http://127.0.0.1:8790");
 try{ const r=await api("/api/check",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target})});
  if(r.queued){ toast(r.position?`${target} added to the queue (#${r.position}) — it starts automatically`:`${target} is being checked now`); }
  else { toast("Checking "+target+" …"); chk.status={running:true,target,step:"Starting",log:[],queue:[]}; }
  chk.wasRunning=true; if(ui.tab==="check") vCheck(true); pollCheck(); }
 catch(e){ toast(e.message); }
}
async function pollCheck(){
 clearTimeout(chk.timer);
 try{ chk.status=await api("/api/check-status"); }catch(e){ chk.timer=setTimeout(pollCheck,3000); return; }   // keep trying: a busy server must not freeze the page
 const st=chk.status;
 const doneKey=st.finished+"|"+(st.domain||"");
 if(st.finished&&st.domain&&!st.error&&chk.lastDone!==doneKey&&chk.wasRunning){ chk.lastDone=doneKey; await loadChecks(); ui.checkDomain=st.domain; toast(`${st.domain}: ${st.result||"done"}`); }
 if(!chk.lastDone&&st.finished) chk.lastDone=doneKey;
 if(!st.running&&st.error&&chk.wasRunning) toast("Check stopped: "+st.error);
 if(!st.running&&!chk.wasRunning&&$("#chkBtn")&&$("#chkBtn").disabled) await loadChecks();
 chk.wasRunning=st.running||(st.queue||[]).length>0;
 if(ui.tab==="check") vCheck(true);
 if(chk.wasRunning) chk.timer=setTimeout(pollCheck,2000);
}
function verdictText(rep){
 const v=rep.verdict||"";
 if(v==="CONFIRMED hacked") return ["Hacked — confirmed","All 4 checks passed: a real business page was replaced or joined by spam on the same server, seen on two different days.","bg-error-container text-on-error-container","gpp_bad"];
 if(v.startsWith("Was hacked")) return ["Was hacked — spam removed now","Spam was seen earlier (proof links below) but the page is clean today. Watch it: re-infection is common.","bg-primary-fixed text-on-primary-fixed","history"];
 if(v.startsWith("Blocked by ISP")) return ["Blocked by an Indian ISP as dangerous","The live site shows an ISP warning page instead of the business — usually after malware or spam reports.","bg-error-container text-on-error-container","block"];
 const g=rep.gates||{};
 if(v==="Review"&&g.past_business&&g.no_registration_gap&&g.old_assets_live&&!g.seen_twice&&(rep.still_spam||rep.spam_only_for_google_or_mobile))
  return ["Hacked — seen today, confirm tomorrow","Spam is live right now on a real business site (gates 1–3 passed). Only the second-day check is missing: click “Check again” tomorrow to confirm before contacting anyone.","bg-error-container text-on-error-container","gpp_maybe"];
 if(v==="Review") return ["Suspicious — needs review","Spam signs found, but not every check passed yet (see the gates). Re-check on another day before contacting anyone.","bg-tertiary-fixed text-on-tertiary-fixed","hourglass_top"];
 if(v.startsWith("Clean")) return ["Clean — no spam found","No page in a foreign language, no earlier spam sightings, nothing hidden for Google or phones.","bg-emerald-50 text-emerald-800","verified_user"];
 if(v.startsWith("Down")) return ["Unreachable — check again later","The website did not answer. Only archive and earlier sightings could be used.","bg-surface-container text-secondary","cloud_off"];
 return ["Not a lead",v.replace("Not a lead ","").replace(/[()]/g,"")+" — not a hacked business website.","bg-surface-container text-secondary","do_not_disturb_on"];
}
function vCheck(soft){
 const st=chk.status||{}, running=st.running;
 const list=CHECKS_DATA.slice().sort((a,b)=>(b.check_time||"").localeCompare(a.check_time||""));
 const rep=list.find(c=>c.domain===ui.checkDomain)||(soft?null:null);
 const x=rep?{s:fromFinding(rep),r:null}:null; if(x) x.r=score(x.s);
 const focus=document.activeElement&&document.activeElement.id==="chkInput", val=($("#chkInput")||{}).value;
 const gateRows=x?GATE_IDS.map((id,i)=>{ let v=x.s.signals[id]; let ev=(x.s.evidence||{})[id]||"";
  if(id==="seen_twice"&&v===false&&(rep.still_spam||rep.spam_only_for_google_or_mobile)){ v=null; ev="Seen once (today). Check again tomorrow — if the spam is still there, this gate passes."; } return `<div class="flex items-start gap-3 p-3 rounded-xl bg-surface-container-low"><span class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${v===true?"bg-emerald-100 text-emerald-800":v===false?"bg-error-container text-on-error-container":"bg-surface-container text-secondary"}">G${i+1}</span><div class="min-w-0"><div class="text-xs font-semibold">${GATE_NAMES[i].slice(3)} — <span class="${v===true?"text-emerald-700":v===false?"text-error":"text-secondary"}">${v===true?"passed":v===false?"failed":"pending"}</span></div><div class="text-[11px] text-secondary break-words">${esc(ev||"—")}</div></div></div>`; }).join(""):"";
 const [vt,vd,vc,vi]=rep?verdictText(rep):["","","",""];
 $("#main").innerHTML=`<div class="flex flex-col w-full">
 ${pageHead(["Threat Surveillance","Site Check"],"Site Check",`<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-label font-bold bg-primary-fixed text-on-primary-fixed">${list.length} CHECKED</span>`,
  "Type any website to find out if it is hacked: homepage, sitemap pages, earlier public scans and crawl captures are checked as a browser, Googlebot and a phone, then verified with the same 4 gates.","")}
  <div class="flex flex-col sm:flex-row gap-3 max-w-3xl"><div class="relative flex-1">${ic("travel_explore","absolute left-3.5 top-1/2 -translate-y-1/2 text-secondary text-lg")}<input id="chkInput" class="w-full bg-surface-container-lowest text-sm font-mono pl-11 pr-4 py-3 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary" placeholder="example.in  or  https://example.in/page" value="${esc(val!==undefined?val:(running?"":(ui.checkInput||"")))}" aria-label="Website to check"></div>
   <button id="chkBtn" class="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl ${BTN_PRIMARY} text-sm font-label">${ic(running?"playlist_add":"search")}${running?"Add to queue":"Check website"}</button></div>
  ${SERVER?"":`<div class="text-xs text-error">Site Check needs the local server — double-click start.bat.</div>`}</div>
 <div class="p-4 sm:p-8 space-y-6 max-w-[1720px] mx-auto w-full">
  ${running||st.error&&st.target===ui.checkInput?card(`<div class="p-6 space-y-3"><div class="flex items-center justify-between"><div><div class="text-[11px] font-label font-semibold uppercase tracking-wider text-secondary">${running?"Checking":"Stopped"}</div><div class="font-headline text-lg font-semibold font-mono">${esc(st.target||"")}</div></div>${running?`<span class="w-3 h-3 rounded-full bg-primary animate-ping"></span>`:""}</div>
   <div class="text-sm">${esc(st.step||"")}${running&&st.started?` · <span class="font-mono text-secondary">${Math.max(0,Math.round((Date.now()-Date.parse(st.started.replace(" ","T")))/1000))}s</span>`:""}</div>
   <div class="flex flex-wrap gap-1.5">${["Collecting pages","Checking","Verifying","Taking screenshots"].map((k,i)=>{ const cur=(st.step||"").startsWith(k)||(k==="Checking"&&(st.step||"").startsWith("Checking")); const order=["Collecting","Checking","Verifying","Taking"]; const at=order.findIndex(o=>(st.step||"").startsWith(o)); return `<span class="px-2.5 py-1 rounded-full text-[11px] font-label ${i<at?"bg-emerald-50 text-emerald-800":i===at?"bg-primary text-on-primary":"bg-surface-container text-secondary"}">${i<at?"✓ ":""}${["Pages","Look at pages","4 gates","Screenshots"][i]}</span>`; }).join("")}</div>
   ${(st.queue||[]).length?`<div class="text-xs"><span class="text-secondary">Waiting in queue:</span> ${st.queue.map((q,i)=>`<span class="font-mono px-2 py-0.5 rounded bg-surface-container-low">${i+1}. ${esc(q)}</span>`).join(" ")}</div>`:""}${st.error?`<div class="text-xs text-error">⚠ ${esc(st.error)}</div>`:""}<pre class="p-3 rounded-lg bg-surface-container text-[11px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">${esc((st.log||[]).slice(-8).join("\n"))}</pre><div class="text-[11px] text-secondary">Usually 1–3 minutes. You can use other pages meanwhile.</div></div>`):""}
  ${rep?`
  <section class="rounded-2xl p-6 shadow-sm ${vc}"><div class="flex flex-wrap items-center gap-4"><span class="w-12 h-12 rounded-xl bg-white/60 flex items-center justify-center">${ic(vi,"text-[28px]")}</span><div class="flex-1 min-w-[220px]"><div class="text-[11px] font-label font-bold uppercase tracking-wider opacity-80">${esc(rep.domain)} · checked ${esc(rep.check_time||"")}</div><div class="font-headline text-2xl font-semibold">${vt}</div><div class="text-sm opacity-90">${vd}</div></div>
   <div class="flex flex-wrap gap-2">${x.r&&LEAD_STATES.includes(x.r.state)&&!approved[rep.domain]?btn("Approve as lead","verified",BTN_PRIMARY,`data-approve="${esc(rep.domain)}"`):""}${btn("Follow-up & full drawer","open_in_full","bg-surface-container-lowest text-on-surface",`data-drawer="${esc(rep.domain)}"`)}${btn("Check again","refresh","bg-surface-container-lowest text-on-surface",`data-recheck="${esc(rep.check_target||rep.domain)}"`)}${btn("Print","print","bg-surface-container-lowest text-on-surface",`data-print="${esc(rep.domain)}"`)}</div></div></section>
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
   <div class="lg:col-span-5">${card(`<div class="p-6 space-y-3"><h3 class="font-headline text-lg font-semibold">Verification gates</h3>${gateRows}
    <div class="grid grid-cols-2 gap-2 pt-2 text-xs">${[["Infected page",pagePath(x.s)],["Language now",(rep.page_lang||"—")+" (homepage: "+((rep.home||{}).lang||rep.home_lang||"—")+")"],["India",rep.india?"Yes — "+((rep.india_signals||[]).slice(0,3).join(", ")||"."+rep.domain.split(".").slice(-2).join(".")+" domain"):"Not shown as Indian"],["Platform",rep.platform||"—"],["Registered",rep.rdap_registered||"—"],["Checked in",(rep.check_seconds||"—")+" s · "+(rep.pages_checked||[]).length+" pages"]].map(([k,v])=>`<div class="p-3 rounded-xl bg-surface-container-low"><div class="text-[10px] font-label uppercase text-secondary">${k}</div><div class="font-medium mt-0.5 break-words">${esc(String(v))}</div></div>`).join("")}</div></div>`)}</div>
   <div class="lg:col-span-7">${card(`<div class="p-6 space-y-3"><h3 class="font-headline text-lg font-semibold">Pages checked (${(rep.pages_checked||[]).length})</h3><p class="text-xs text-secondary">Homepage: “${esc((rep.home||{}).title||rep.home_title||"")}” (${esc((rep.home||{}).lang||"")}). Pages in a language that does not fit the site are marked suspicious.</p>
    <div class="overflow-x-auto max-h-80 overflow-y-auto"><table class="w-full text-left text-xs"><thead class="sticky top-0"><tr class="bg-surface-container text-on-surface-variant font-label text-[11px] uppercase tracking-wider"><th class="py-2 px-3">Page</th><th class="py-2 px-3">Language</th><th class="py-2 px-3">Title</th><th class="py-2 px-3 text-center">Suspicious</th></tr></thead><tbody>${(rep.pages_checked||[]).map(p=>`<tr class="${p.suspicious>=2?"bg-error-container/30":""}"><td class="py-2 px-3 font-mono max-w-[260px] truncate" title="${esc(p.url)}">${esc(p.url.replace(/^https?:\/\/[^/]+/,"")||"/")}</td><td class="py-2 px-3">${esc(p.lang)}${p.status&&p.status!==200?` <span class="text-secondary">(${p.status})</span>`:""}</td><td class="py-2 px-3 max-w-[260px] truncate" title="${esc(p.title)}">${esc(p.title||"—")}</td><td class="py-2 px-3 text-center font-mono ${p.suspicious>=2?"text-error font-bold":"text-secondary"}">${p.suspicious}</td></tr>`).join("")||`<tr><td class="py-3 px-3 text-secondary" colspan="4">No pages found.</td></tr>`}</tbody></table></div>
    ${(rep.sightings||[]).length?`<div class="pt-2"><div class="text-[11px] font-label font-semibold uppercase tracking-wider text-secondary mb-1">Earlier sightings (${rep.sightings.length})</div><div class="space-y-1">${rep.sightings.slice(0,12).map(sg=>`<div class="flex flex-wrap items-center gap-2 text-xs"><span class="px-2 py-0.5 rounded-full bg-surface-container text-[10px] font-label font-bold">${esc(sg.source)}</span><span class="font-mono text-secondary">${esc(sg.time||"")}</span><span class="truncate max-w-[340px]" title="${esc(sg.url)}">${esc(sg.title||sg.url)}</span>${sg.link?`<a class="text-primary hover:underline" href="${esc(sg.link)}" target="_blank" rel="noopener">proof</a>`:""}</div>`).join("")}</div></div>`:""}</div>`)}</div></div>
  ${card(`<div class="p-6">${followBox(rep.domain)}</div>`)}
  ${dossier(x)}`:(!running?card(`<div class="p-8 text-sm text-secondary">${list.length?"Pick a checked website below, or type a new one above.":"No website checked yet. Type one above — for example a site you suspect, or a client's website."}</div>`):"")}
  ${list.length?card(`<div class="p-6 space-y-2"><h3 class="font-headline text-lg font-semibold">Checked websites</h3>${list.map(c=>{ const [t,,cl]=verdictText(c); return `<button class="w-full flex flex-wrap items-center gap-3 p-3 rounded-xl ${ui.checkDomain===c.domain?"bg-primary/10":"bg-surface-container-low hover:bg-surface-container"} text-left" data-showcheck="${esc(c.domain)}"><span class="font-mono text-sm font-semibold">${c.india?"🇮🇳 ":""}${esc(c.domain)}</span><span class="px-2 py-0.5 rounded-full text-[11px] font-bold font-label ${cl}">${t}</span><span class="ml-auto text-[11px] font-mono text-secondary">${esc(c.check_time||"")}</span></button>`; }).join("")}</div>`):""}
 </div>`;
 const inp=$("#chkInput"); if(focus&&inp){ inp.focus(); inp.setSelectionRange(inp.value.length,inp.value.length); }
 const go=()=>{ const v=$("#chkInput").value.trim(); if(!looksLikeSite(v)) return toast("Type a website like example.in"); ui.checkInput=v; startCheck(v); };
 $("#chkBtn").onclick=go; if(inp) inp.onkeydown=e=>{ if(e.key==="Enter") go(); };
 $$("[data-showcheck]").forEach(b=>b.onclick=()=>{ ui.checkDomain=b.dataset.showcheck; vCheck(); window.scrollTo(0,0); });
 $$("[data-recheck]").forEach(b=>b.onclick=()=>{ ui.checkInput=b.dataset.recheck; startCheck(b.dataset.recheck); });
 bindTable(); bindDossier(); bindCommon(); bindInspector(); bindFollowBoxes(()=>vCheck(true));
 if(!soft&&SERVER&&!chk.loaded){ chk.loaded=true; loadChecks().then(()=>{ if(!ui.checkDomain&&CHECKS_DATA.length) ui.checkDomain=CHECKS_DATA.slice().sort((a,b)=>(b.check_time||"").localeCompare(a.check_time||""))[0].domain; pollCheck(); vCheck(true); }); }
}

/* ---------- PAGE: Search Reports (one row per search run) ---------- */
const GROUPS=[["confirmed","Confirmed","bg-error-container text-on-error-container"],["was_hacked","Was hacked","bg-primary-fixed text-on-primary-fixed"],["review","Review","bg-tertiary-fixed text-on-tertiary-fixed"],["not_lead","Not a lead","bg-surface-container text-secondary"],["issues","Issues","bg-error/10 text-error"]];
let RUNS_DATA = window.RUNS || [];
async function loadRuns(){ if(SERVER){ try{ RUNS_DATA=await api("/api/runs"); }catch(e){} } return RUNS_DATA; }
function fmtDur(s){ if(s==null) return "—"; const h=Math.floor(s/3600), m=Math.floor(s%3600/60); return h?`${h}h ${m}m`:m?`${m}m ${s%60}s`:`${s}s`; }
async function vReports(){
 await loadRuns();
 const runs=RUNS_DATA.slice().reverse();
 const tot=k=>runs.reduce((a,r)=>a+((r.counts||{})[k]||0),0), totI=k=>runs.reduce((a,r)=>a+((r.india_counts||{})[k]||0),0);
 ui.openRun = ui.openRun || (runs[0]&&runs[0].id);
 const src=r=>[(r.params||{}).sources&&r.params.sources.commoncrawl?"Common Crawl":null,(r.params||{}).sources&&r.params.sources.snowball?"Snowball":null,(r.params||{}).recheck_issues?"Re-check issues":null].filter(Boolean).join(" + ")||"—";
 const looked=r=>{ const l=r.looked_at||{}; return [l.commoncrawl_pages!=null?`${l.commoncrawl_pages.toLocaleString()} CC pages / ${(l.commoncrawl_domains||0).toLocaleString()} domains`:null,l.snowball_brands!=null?`${l.snowball_brands} brands`:null].filter(Boolean).join(" · ")||"—"; };
 const cellG=(r,k)=>{ const n=(r.counts||{})[k]||0, i=(r.india_counts||{})[k]||0; return `<td class="py-3 px-3 text-center font-mono ${n?"":"text-secondary"}">${n}${i?`<div class="text-[10px] text-secondary">🇮🇳 ${i}</div>`:""}</td>`; };
 const detail=r=>{ if(!r) return ""; return card(`<div class="p-6 space-y-4"><div class="flex flex-wrap items-center justify-between gap-2"><div><h3 class="font-headline text-lg font-semibold text-on-surface">Run ${esc(r.started||r.id)}</h3><p class="text-xs text-secondary">${esc(src(r))} · since ${esc((r.params||{}).since||"any date")} · ${esc(fmtDur(r.duration_s))} · ${r.status==="done"?"finished":esc(r.status)}${r.error?` — <span class="text-error">${esc(r.error)}</span>`:""}</p></div></div>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">${[["Looked at",looked(r)],["Suspects",`${r.suspects||0} (${r.skipped_old||0} older skipped, ${r.skipped_known||0} already known)`],["Verified now",r.verified||0],["Errors",r.errors||0]].map(([k,v])=>`<div class="p-3 rounded-xl bg-surface-container-low"><div class="text-[10px] font-label uppercase text-secondary">${k}</div><div class="font-semibold mt-0.5">${esc(String(v))}</div></div>`).join("")}</div>
  ${GROUPS.map(([k,label,cls])=>{ const list=(r.domains||{})[k]||[]; if(!list.length) return ""; return `<div><div class="flex items-center gap-2 mb-2"><span class="px-2 py-0.5 rounded-full text-[11px] font-bold font-label ${cls}">${label} · ${list.length}</span></div><div class="flex flex-wrap gap-1.5">${list.slice().sort((a,b)=>b.india-a.india).map(x=>`<button class="px-2.5 py-1 rounded-full text-[11px] font-mono bg-surface-container-low hover:bg-surface-container" data-drawer="${esc(x.domain)}" title="${esc(x.verdict)}">${x.india?"🇮🇳 ":""}${esc(x.domain)}</button>`).join("")}</div></div>`; }).join("")||`<div class="text-xs text-secondary">No sites verified in this run.</div>`}</div>`); };
 $("#main").innerHTML=`<div class="flex flex-col w-full">
 ${pageHead(["Threat Surveillance","Discovery","Search Reports"],"Search Reports",`<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-label font-bold bg-primary-fixed text-on-primary-fixed">${runs.length} RUNS</span>`,
  "What each search looked at, what it found, and what had issues. Click a run for its site lists; click a site for its full details.",
  btn("Run Search","travel_explore",BTN_PRIMARY,'data-search'))}
  <div class="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">${kpi("Runs","history",runs.length,runs[0]?"last "+esc((runs[0].started||"").slice(0,16)):"none yet")}${kpi("Confirmed","gpp_bad",tot("confirmed"),`🇮🇳 ${totI("confirmed")} in India`,"red")}${kpi("Was Hacked","history",tot("was_hacked"),`🇮🇳 ${totI("was_hacked")}`,"primary")}${kpi("Review","hourglass_top",tot("review"),"gates pending","tertiary")}${kpi("Issues","report",tot("issues")+runs.reduce((a,r)=>a+(r.errors||0),0),"down / errors — re-check")}</div></div>
 <div class="p-4 sm:p-8 space-y-6 max-w-[1720px] mx-auto w-full">
  ${card(runs.length?`<div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead><tr class="bg-surface-container text-on-surface-variant font-label text-[11px] uppercase tracking-wider"><th class="py-3 px-4">Date &amp; time</th><th class="py-3 px-4">Sources</th><th class="py-3 px-4">Looked at</th><th class="py-3 px-3 text-center">Suspects</th><th class="py-3 px-3 text-center">Verified</th>${GROUPS.map(([,l])=>`<th class="py-3 px-3 text-center">${l}</th>`).join("")}<th class="py-3 px-3 text-center">Errors</th><th class="py-3 px-4">Time</th></tr></thead>
   <tbody>${runs.map(r=>`<tr class="cursor-pointer ${ui.openRun===r.id?"bg-primary/10":"hover:bg-surface-container"}" data-run="${esc(r.id)}"><td class="py-3 px-4 font-mono whitespace-nowrap">${esc((r.started||"").slice(0,16))}${r.status==="running"?` <span class="text-primary font-bold">running</span>`:r.status==="stopped"?` <span class="text-error">stopped</span>`:""}</td><td class="py-3 px-4">${esc(src(r))}</td><td class="py-3 px-4 text-secondary">${esc(looked(r))}</td><td class="py-3 px-3 text-center font-mono">${r.suspects||0}</td><td class="py-3 px-3 text-center font-mono">${r.verified||0}</td>${GROUPS.map(([k])=>cellG(r,k)).join("")}<td class="py-3 px-3 text-center font-mono ${r.errors?"text-error":"text-secondary"}">${r.errors||0}</td><td class="py-3 px-4 font-mono">${esc(fmtDur(r.duration_s))}</td></tr>`).join("")}</tbody></table></div>`:`<div class="p-8 text-sm text-secondary">No search runs yet. ${SERVER?"Click Run Search to start one.":"Start the server (start.bat) and use Run Search — every run is saved here."}</div>`)}
  ${detail(runs.find(r=>r.id===ui.openRun))}
 </div>`;
 $$("[data-run]").forEach(tr=>tr.onclick=()=>{ ui.openRun=tr.dataset.run; vReports(); });
 bindTable(); bindCommon();
}

/* ---------- PAGE: System Settings ---------- */
function vSettings(){
 $("#main").innerHTML=`<div class="flex flex-col w-full">
 ${pageHead(["Configuration","System Settings"],"System Settings","",
  "Domains to scan, discovery sources, the India rule, platform → likely cause, and the daily schedule. The scanner itself runs as Python scripts in research/.",
  btn("Run Search","travel_explore",BTN_PRIMARY,'data-search')+btn("Export rules.json","download","bg-surface-container-high text-on-surface hover:bg-surface-container-highest",'id="exp"')+btn("Import","upload","bg-surface-container-high text-on-surface hover:bg-surface-container-highest",'id="imp"')+`<input type="file" id="impf" accept=".json" hidden>`)}</div>
 <div class="p-4 sm:p-8 space-y-8 max-w-[1720px] mx-auto w-full">
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
   ${card(`<div class="p-6 space-y-3"><h3 class="font-headline text-lg font-semibold text-on-surface">Add domains</h3><p class="text-xs text-secondary">One per line, or paste a list. Any platform: WordPress, Shopify, Wix, Joomla, custom PHP, static…</p><textarea id="newd" rows="5" class="w-full bg-surface-container-low rounded-xl p-3 text-xs font-mono" placeholder="example.in&#10;https://shop.co.in/…"></textarea><div class="flex flex-wrap items-center gap-3">${btn("Add to scan queue","add",BTN_PRIMARY,'id="newok"')}<span class="text-xs text-secondary" id="newmsg">${extra.length} added manually so far</span></div></div>`)}
   ${card(`<div class="p-6 space-y-3"><h3 class="font-headline text-lg font-semibold text-on-surface">Discovery sources</h3>${config.sources.map(s=>`<div class="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low"><input type="checkbox" class="w-4 h-4 accent-primary" data-src="${s.id}" ${s.enabled?"checked":""} aria-label="${esc(s.name)}"><div class="flex-1"><div class="text-xs font-semibold">${esc(s.name)} <span class="font-mono text-[10px] text-secondary">${s.id}</span></div><div class="text-[11px] text-secondary">${esc(s.desc)}${s.param?` <input data-sp="${s.id}" value="${esc(s.param.value)}" class="w-28 bg-surface-container-lowest rounded px-1 text-xs">`:""}</div></div></div>`).join("")}</div>`)}
   ${card(`<div class="p-6 space-y-3"><h3 class="font-headline text-lg font-semibold text-on-surface">India check</h3><p class="text-xs text-secondary">.in / .co.in are India. For .com / .org the verifier needs one strong signal (+91, PIN + place, GSTIN, ₹, Indian-language text) plus one more. Minimum signals: <input type="number" id="imin" value="${config.indiaMinSignals}" class="w-14 bg-surface-container-low rounded px-1"></p><textarea id="isig" rows="6" class="w-full bg-surface-container-low rounded-xl p-3 text-xs">${esc(config.indiaSignals.join("\n"))}</textarea></div>`)}
   ${card(`<div class="p-6 space-y-3"><h3 class="font-headline text-lg font-semibold text-on-surface">Platforms → likely cause</h3><p class="text-xs text-secondary">One per line: <span class="font-mono">match|match = cause</span>, <span class="font-mono">*</span> = fallback.</p><textarea id="plat" rows="8" class="w-full bg-surface-container-low rounded-xl p-3 text-xs font-mono">${esc(config.platforms.map(p=>p.match+" = "+p.cause).join("\n"))}</textarea></div>`)}
  </div>
  ${card(`<div class="p-6 space-y-3"><div class="flex flex-wrap items-center justify-between gap-3"><h3 class="font-headline text-lg font-semibold text-on-surface">Daily scan</h3><label class="text-xs font-label flex items-center gap-2">Run at <input type="time" id="sched" value="${config.schedule}" class="bg-surface-container-low rounded-lg px-2 py-1"></label></div>
   <div class="p-3.5 rounded-lg bg-surface-container font-mono text-[11px] space-y-1"><div class="text-secondary"># easiest: double-click start.bat, then use Run Search. Or by hand, inside research/:</div><div>python research/collect_urlscan.py</div><div>python research/verify.py</div><div>python research/capture.py</div></div>
   <div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead><tr class="bg-surface-container text-on-surface-variant font-label text-[11px] uppercase tracking-wider"><th class="py-3 px-4">Date</th><th class="py-3 px-4">Sources</th><th class="py-3 px-4">Suspects</th><th class="py-3 px-4">India</th><th class="py-3 px-4">Confirmed</th><th class="py-3 px-4">Review</th><th class="py-3 px-4">Note</th></tr></thead><tbody>${runsData().map(r=>`<tr><td class="py-3 px-4 font-mono">${esc(r.date)}</td><td class="py-3 px-4">${esc(r.sources)}</td><td class="py-3 px-4">${r.suspects}</td><td class="py-3 px-4">${r.india}</td><td class="py-3 px-4">${r.confirmed}</td><td class="py-3 px-4">${r.review}</td><td class="py-3 px-4 text-secondary">${esc(r.note||"")}</td></tr>`).join("")}</tbody></table></div></div>`)}
 </div>`;
 bindCommon(); bindRulesIO();
 const changed=()=>persist();
 $("#newok").onclick=()=>{ const n=addDomainsFrom($("#newd").value); render(); $("#newmsg").textContent=`${n} new domain(s) queued — they stay in Review until the next scan checks them.`; };
 $$("[data-src]").forEach(i=>i.onchange=()=>{ config.sources.find(s=>s.id===i.dataset.src).enabled=i.checked; changed(); });
 $$("[data-sp]").forEach(i=>i.oninput=()=>{ config.sources.find(s=>s.id===i.dataset.sp).param.value=i.value; changed(); });
 $("#imin").oninput=e=>{ config.indiaMinSignals=+e.target.value; changed(); };
 $("#isig").oninput=e=>{ config.indiaSignals=e.target.value.split("\n").map(x=>x.trim()).filter(Boolean); changed(); };
 $("#plat").oninput=e=>{ config.platforms=e.target.value.split("\n").map(l=>{ const i=l.indexOf("="); return i<0?null:{match:l.slice(0,i).trim(),cause:l.slice(i+1).trim()}; }).filter(p=>p&&p.match); changed(); };
 $("#sched").oninput=e=>{ config.schedule=e.target.value; changed(); };
}
function runsData(){
 const F=window.FINDINGS||[];
 const r=runs.slice();
 if(F.length) r.push({date:(F[0].checked||TODAY),sources:"urlscan (India-hosted) + verify.py",suspects:F.length,india:F.filter(f=>f.india).length,confirmed:F.filter(f=>f.verdict==="CONFIRMED hacked").length,review:F.filter(f=>f.verdict==="Review").length,note:"Automated verification run"});
 return r.reverse();
}

/* ---------- Shell ---------- */
const $$ = s => document.querySelectorAll(s);
const PAGES = {matrix:["Surveillance Matrix",vMatrix],check:["Site Check",vCheck],leads:["Compromised Leads",vLeads],followups:["Follow-ups",vFollowups],gates:["Gate Funnel & Rigor",vGates],synd:["Syndicate Tracking",vSynd],outreach:["CERT-In Outreach",vOutreach],reports:["Search Reports",vReports],settings:["System Settings",vSettings]};
function render(){
 save("sw.tab",ui.tab);
 $$("[data-nav]").forEach(a=>{ const on=a.dataset.nav===ui.tab; a.classList.toggle("bg-surface-container-high",on); a.classList.toggle("text-primary",on); a.classList.toggle("font-semibold",on); a.classList.toggle("text-on-surface-variant",!on); if(on) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
 PAGES[ui.tab][1]();
 shell();
}
function shell(){
 const all=rows(), hacked=all.filter(x=>["hacked_visible","hacked_hidden"].includes(x.r.state)).length, review=all.filter(x=>x.r.state==="review").length;
 const q=all.filter(x=>LEAD_STATES.includes(x.r.state)&&!approved[x.s.domain]).length;
 const set=(id,n)=>{ const e=$(id); if(e){ e.textContent=n; e.classList.toggle("hidden",!n); } };
 set("#cntLeads",hacked); set("#cntQueue",q);
 const fd=followData().grp; set("#cntFollow",fd.overdue.length+fd.today.length);
 $("#statusBadge").textContent=`${hacked} hacked · ${review} review`;
 $("#jurBtn").innerHTML=`${ic("public","text-[16px]")}<span class="text-xs font-label font-bold tracking-wide">${ui.indiaOnly?"🇮🇳 India":"Global"}</span>`;
 const F=window.FINDINGS||[]; $("#lastScan").textContent=(F[0]&&F[0].checked)||TODAY;
 const g=$("#gsearch"); if(g && document.activeElement!==g) g.value=ui.q;
 document.title = PAGES[ui.tab][0] + " · SiteWatch India";
}
function bindCommon(){
 $$("[data-go]").forEach(b=>b.onclick=()=>{ ui.tab=b.dataset.go; render(); window.scrollTo(0,0); });
 const c=$("#csv"); if(c) c.onclick=()=>exportCSV(filteredRows());
 const s=$("#stix"); if(s) s.onclick=()=>exportSTIX();
 $$("#runSweep,[data-search]").forEach(r=>r.onclick=openSearch);
 $$("[data-approve]").forEach(b=>{ if(!b.onclick) b.onclick=()=>{ approve(b.dataset.approve); render(); }; });
 $$("[data-print]").forEach(b=>{ if(!b.onclick) b.onclick=()=>{ document.body.classList.add("print-dossier"); window.print(); document.body.classList.remove("print-dossier"); }; });
 $$("[data-drawer]").forEach(b=>{ if(!b.onclick) b.onclick=()=>openDrawer(b.dataset.drawer); });
}
/* ---------- Search runs via the local server (server.py) ---------- */
const SERVER = location.protocol.startsWith("http");
let srv = {status:null, timer:null, wasRunning:false};
async function api(path, opts){ const r=await fetch(path,opts); const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); return j; }
async function openSearch(){
 if(!SERVER) return showText("Start the server to run searches","This page was opened as a file, so it can only show results.\n\nTo run searches from the dashboard:\n  1. Double-click start.bat in the project folder\n     (or run: python server.py)\n  2. Use the page that opens at http://127.0.0.1:8790\n\nWithout the server you can still run the scripts in research/ by hand.");
 let st; try{ st=await api("/api/status"); }catch(e){ return toast("Server not reachable: "+e.message); }
 if(st.running||st.verify_busy) return showProgress();
 let d; try{ d=await api("/api/defaults"); }catch(e){ return toast("Could not load defaults: "+e.message); }
 const m=$("#modal"), inp="bg-surface-container-low text-sm rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-1 focus:ring-primary";
 const chk=(id,on,label,sub,dis)=>`<label class="flex items-start gap-3 p-3 rounded-xl ${dis?"opacity-50":"hover:bg-surface-container"} cursor-pointer"><input type="checkbox" id="${id}" class="w-4 h-4 mt-0.5 accent-primary" ${on?"checked":""} ${dis?"disabled":""}><span><span class="text-sm font-medium text-on-surface">${label}</span><span class="block text-[11px] text-secondary">${sub}</span></span></label>`;
 m.innerHTML=`<div class="w-full max-w-2xl bg-surface-container-lowest rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]" role="dialog" aria-modal="true" aria-label="Run search">
  <div class="p-6 bg-surface-container-low flex items-start justify-between gap-4"><div><div class="flex items-center gap-2 text-xs font-label text-primary font-bold uppercase tracking-wider">${ic("travel_explore")}<span>Discovery Sweep</span></div><h2 class="font-headline font-bold text-xl text-on-surface tracking-tight mt-1">Run Search</h2><p class="text-xs text-secondary mt-1">Default values are filled in. Every site found is verified with the 4 gates before it can become a lead.</p></div><button class="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center text-secondary" id="mClose" aria-label="Close">${ic("close","text-[20px]")}</button></div>
  <div class="p-6 space-y-5 overflow-y-auto">
   <div><div class="text-[11px] font-label font-semibold uppercase tracking-wider text-secondary mb-1">Sources</div>
    ${chk("sCC",d.sources.commoncrawl,"Common Crawl language filter","Free public crawl: pages on the domain ending below whose main language is one of the languages chosen")}
    ${chk("sSB",d.sources.snowball,"Snowball from spam brands","Brands seen on verified victims → other pages with the same brand (public urlscan search)")}
    ${chk("sUS",false,"urlscan .in search",d.urlscan_key?"Coming next — key found in research/.env":"Needs a free urlscan API key in research/.env",true)}</div>
   <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
    <label class="text-xs font-label text-secondary">Common Crawl month<input id="fCrawl" class="${inp} mt-1 font-mono" value="${esc(d.crawl)}"></label>
    <label class="text-xs font-label text-secondary">Domain ending<input id="fTld" class="${inp} mt-1 font-mono" value="${esc(d.tld)}"></label>
    <label class="text-xs font-label text-secondary">Max domains (Common Crawl)<input id="fMax" type="number" min="1" max="3000" class="${inp} mt-1" value="${d.max_domains}"></label>
    <label class="text-xs font-label text-secondary">Sites per brand (Snowball)<input id="fPer" type="number" min="1" max="200" class="${inp} mt-1" value="${d.per_brand}"></label></div>
   <div><div class="text-[11px] font-label font-semibold uppercase tracking-wider text-secondary mb-2">Languages (page language that does not fit an Indian site)</div><div class="flex flex-wrap gap-2">${Object.entries(d.lang_choices).map(([k,v])=>`<label class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-low text-xs cursor-pointer"><input type="checkbox" class="accent-primary" data-lang="${k}" ${d.langs.includes(k)?"checked":""}>${v}</label>`).join("")}</div></div>
   <div class="grid grid-cols-1 sm:grid-cols-2 gap-4"><label class="text-xs font-label text-secondary">Only suspects first seen since<input id="fSince" type="date" class="${inp} mt-1" value="${esc(d.since)}"><span class="block text-[10px] mt-1">Common Crawl is monthly (newest ${esc(d.crawl)}), so a recent date mostly keeps Snowball finds. Clear the date to take everything.</span></label>
    <div>${chk("fRe",d.recheck_issues,"Re-check issues","Verify again the sites that were down / unreachable last time")}</div></div>
   <div class="grid grid-cols-1 sm:grid-cols-2 gap-1">${chk("fNew",d.new_only,"Only new domains","Skip sites already verified")}${chk("fCap",d.capture,"Take screenshots after","Archive vs live, Indian sites only")}</div>
   <div class="p-3 rounded-lg bg-surface-container text-[11px] text-on-surface-variant">${ic("schedule","text-[14px]")} About 1 minute per site (8 at a time). 400 domains ≈ 1 hour. You can close this window — the search keeps running in the server.</div>
   <div id="sErr" class="text-xs text-error"></div></div>
  <div class="p-5 bg-surface-container-low flex items-center justify-between gap-3"><button class="text-xs font-label text-secondary hover:text-on-surface" id="sReset">Reset to defaults</button><div class="flex gap-2"><button class="px-4 py-2 rounded-lg bg-surface-container-high text-xs font-label font-semibold" id="sCancel">Cancel</button><button class="px-4 py-2 rounded-lg ${BTN_PRIMARY} text-xs font-label inline-flex items-center gap-2" id="sStart">${ic("play_circle")}Start search</button></div></div></div>`;
 m.classList.remove("hidden"); m.classList.add("flex");
 m.querySelector("#mClose").onclick=m.querySelector("#sCancel").onclick=closeModal;
 m.querySelector("#sReset").onclick=()=>{ closeModal(); openSearch(); };
 m.querySelector("#sStart").onclick=async()=>{
  const body={sources:{commoncrawl:$("#sCC").checked,snowball:$("#sSB").checked,urlscan:false},crawl:$("#fCrawl").value.trim(),tld:$("#fTld").value.trim(),
   max_domains:+$("#fMax").value,per_brand:+$("#fPer").value,langs:[...m.querySelectorAll("[data-lang]:checked")].map(x=>x.dataset.lang),new_only:$("#fNew").checked,capture:$("#fCap").checked,since:$("#fSince").value,recheck_issues:$("#fRe").checked};
  const b=$("#sStart"); b.disabled=true;
  try{ await api("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); toast("Search started"); showProgress(); pollStatus(); }
  catch(e){ $("#sErr").textContent="⚠ "+e.message; b.disabled=false; }
 };
}
function progressHTML(st){
 const pctV=st.total?Math.round(st.done/st.total*100):null;
 return `<div class="space-y-4"><div class="flex items-center justify-between gap-3"><div><div class="text-[11px] font-label font-semibold uppercase tracking-wider text-secondary">${st.running?"Running":st.verify_busy?"Verification running (started outside the dashboard)":st.error?"Stopped":"Last run"}</div><div class="font-headline text-lg font-semibold text-on-surface">${esc(st.step||"—")}</div></div>${st.running?`<span class="w-3 h-3 rounded-full bg-primary animate-ping"></span>`:""}</div>
  ${pctV!==null?`<div><div class="w-full bg-surface-container-high h-2.5 rounded-full overflow-hidden"><div class="bg-primary h-full rounded-full transition-all" style="width:${pctV}%"></div></div><div class="text-[11px] font-mono text-secondary mt-1">${st.done} / ${st.total} sites · ${pctV}%</div></div>`:""}
  ${st.error?`<div class="text-xs text-error">⚠ ${esc(st.error)}</div>`:""}
  ${st.summary?`<div class="p-3 rounded-lg bg-emerald-50 text-emerald-900 text-xs">New sites checked: <b>${st.summary.new_sites}</b> · new confirmed Indian victims: <b>${st.summary.new_india_confirmed.length}</b>${st.summary.new_india_confirmed.length?" ("+esc(st.summary.new_india_confirmed.join(", "))+")":""} · Indian was-hacked: <b>${st.summary.new_india_was_hacked}</b></div>`:""}
  <pre class="p-3 rounded-lg bg-surface-container text-[11px] font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">${esc((st.log||[]).slice(-14).join("\n")||"No output yet.")}</pre>
  <div class="text-[11px] text-secondary">${st.started?"Started "+esc(st.started):""}${st.finished?" · finished "+esc(st.finished):""} · full log: research/server_run.log</div></div>`;
}
async function showProgress(){
 const m=$("#modal");
 const paint=st=>{ m.innerHTML=`<div class="w-full max-w-2xl bg-surface-container-lowest rounded-2xl shadow-2xl overflow-hidden" role="dialog" aria-modal="true" aria-label="Search progress"><div class="p-6 bg-surface-container-low flex items-start justify-between gap-4"><div><div class="flex items-center gap-2 text-xs font-label text-primary font-bold uppercase tracking-wider">${ic("travel_explore")}<span>Discovery Sweep</span></div><h2 class="font-headline font-bold text-xl text-on-surface mt-1">Search progress</h2></div><button class="w-8 h-8 rounded-lg hover:bg-surface-container flex items-center justify-center text-secondary" id="mClose" aria-label="Close">${ic("close","text-[20px]")}</button></div><div class="p-6" id="progBody">${progressHTML(st)}</div>${!st.running&&!st.verify_busy?`<div class="p-5 bg-surface-container-low flex justify-end gap-2"><button class="px-4 py-2 rounded-lg ${BTN_PRIMARY} text-xs font-label" id="newRun">New search</button></div>`:""}</div>`;
  m.querySelector("#mClose").onclick=closeModal; const n=m.querySelector("#newRun"); if(n) n.onclick=()=>{ closeModal(); srv.status={running:false}; openSearch(); }; };
 try{ paint(await api("/api/status")); }catch(e){ return toast(e.message); }
 m.dataset.progress="1"; m.classList.remove("hidden"); m.classList.add("flex");
}
function engineLabel(st){
 const t=$("#engineTxt"), d=$("#engineDot"); if(!t) return;
 if(st&&st.verify_busy&&!st.running){ t.textContent="Engine: Verifying (run started outside dashboard)"; d.className="w-2 h-2 rounded-full bg-primary animate-ping"; }
 else if(st&&st.running){ t.textContent=`Engine: ${st.step||"Verifying"}${st.total?` ${st.done}/${st.total}`:""}`; d.className="w-2 h-2 rounded-full bg-primary animate-ping"; }
 else { t.textContent=SERVER?"Engine: Ready · Run Search":"Engine: Offline (file mode)"; d.className=`w-2 h-2 rounded-full ${SERVER?"bg-emerald-500 animate-pulse":"bg-outline"}`; }
}
async function pollStatus(){
 if(!SERVER) return engineLabel(null);
 clearTimeout(srv.timer);
 let st; try{ st=await api("/api/status"); }catch(e){ engineLabel(null); srv.timer=setTimeout(pollStatus,10000); return; }
 engineLabel(st);
 const m=$("#modal"); if(m.dataset.progress&&!m.classList.contains("hidden")){ const pb=$("#progBody"); if(pb) pb.innerHTML=progressHTML(st); }
 const busy=st.running||st.verify_busy;
 // never reload on our own: a reload would close the drawer / form the user is working in
 if(srv.wasRunning&&!busy) resultsReady(st);
 srv.wasRunning=busy; srv.status=st;
 srv.timer=setTimeout(pollStatus, srv.wasRunning?2000:15000);
}
function resultsReady(st){
 if($("#resultsBar")) return;
 const n=st.summary?st.summary.new_india_confirmed.length:null;
 const bar=document.createElement("div"); bar.id="resultsBar"; bar.setAttribute("role","status");
 bar.className="fixed bottom-5 right-5 z-[80] bg-inverse-surface text-inverse-on-surface px-4 py-3 rounded-xl text-xs font-label shadow-lg flex items-center gap-3 max-w-[92vw]";
 bar.innerHTML=`<span>${st.error?"Search stopped: "+esc(st.error):"New results are ready"+(n!==null?` — ${n} new confirmed Indian victim(s)`:"")+"."}</span>${st.error?"":`<button class="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-bold" id="rbReload">Reload</button>`}<button class="px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface font-bold" id="rbReport">Report</button><button class="opacity-70 hover:opacity-100" id="rbClose" aria-label="Dismiss">${ic("close","text-[16px]")}</button>`;
 document.body.appendChild(bar);
 const r=bar.querySelector("#rbReload"); if(r) r.onclick=()=>location.reload();
 bar.querySelector("#rbReport").onclick=()=>{ ui.tab="reports"; ui.openRun=st.summary&&st.summary.run_id; bar.remove(); render(); };
 bar.querySelector("#rbClose").onclick=()=>bar.remove();
}
function toast(m){ const t=document.createElement("div"); t.setAttribute("role","status"); t.textContent=m; t.className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[80] bg-inverse-surface text-inverse-on-surface px-4 py-2.5 rounded-xl text-xs font-label shadow-lg max-w-[90vw]"; document.body.appendChild(t); setTimeout(()=>t.remove(),3200); }

/* chart helpers from v1 (HTML marks) */
const pct=(v,max)=>Math.max(0,Math.min(100,v/max*100));
const tip=t=>`data-tip="${esc(t)}"`;
function cScore(scope){
 const T=config.thresholds, list=scope.slice().sort((a,b)=>b.r.aff-a.r.aff);
 if(!list.length) return '<span class="text-xs text-secondary">No sites in scope.</span>';
 const max=Math.max(T.confirm*1.5,10,...list.map(x=>x.r.aff))*1.05;
 const thr=`<span class="thr" style="left:${pct(T.review,max)}%"></span><span class="thr" style="left:${pct(T.confirm,max)}%"></span>`;
 return `<div class="chart"><div class="legend"><span><i style="background:var(--series-1)"></i>All gates passed</span><span><i style="border:2px solid var(--series-1);background:#fff;width:7px;height:7px"></i>Gate pending / failed</span><span>┆ thresholds</span></div>
 ${list.map(({s,r})=>{ const ok=r.pending.length===0; return `<div class="hrow"><span class="lbl" title="${esc(s.domain)}">${esc(s.domain)}</span><div class="track"><span class="tline" style="left:0;width:${pct(Math.max(0,r.aff),max)}%"></span>${thr}<span class="dot ${ok?"":"hollow"}" style="left:${pct(Math.max(0,r.aff),max)}%" ${tip(`${s.domain}\nScore ${r.aff} → ${STATES[r.state]}${r.why?"\n"+r.why:""}${ok?"":"\nGates not passed: "+r.pending.length}`)}></span></div><span class="val">${r.aff}</span></div>`; }).join("")}
 <div class="hrow"><span></span><div class="axis"><span style="left:0">0</span><span style="left:${pct(T.review,max)}%">Review ${T.review}</span><span style="left:${pct(T.confirm,max)}%">Confirm ${T.confirm}</span></div><span></span></div></div>`;
}
function cMatrix(scope){
 const rl=config.rules.filter(r=>r.enabled&&["affected","gate","history"].includes(r.group));
 if(!scope.length) return '<span class="text-xs text-secondary">No sites in scope.</span>';
 return `<div class="legend"><span><i class="sq" style="background:var(--series-1)"></i>Hit / pass</span><span><i class="sq" style="border:1.5px solid #737784;opacity:.6"></i>Miss / fail</span><span><i class="sq" style="background:repeating-linear-gradient(45deg,var(--grid) 0 2px,transparent 2px 5px);border:1px solid var(--grid)"></i>Pending</span></div>
 <div class="overflow-x-auto"><table class="matrix"><thead><tr><th></th>${rl.map(r=>`<th class="c" title="${esc(r.name)}">${esc(r.id)}</th>`).join("")}</tr></thead>
 <tbody>${scope.map(({s,r})=>`<tr><td class="n"><span class="font-mono">${esc(s.domain)}</span> <span class="text-[10px] text-secondary">${esc(STATES[r.state])}</span></td>${rl.map(rule=>{ const v=s.signals[rule.id]; const k=v===true?"t":v===false?"f":"p";
  return `<td><span class="cell ${k}" ${tip(`${s.domain}\n${rule.name}: ${v===true?"hit / pass":v===false?"miss / fail":"pending"}${s.evidence[rule.id]?"\n"+s.evidence[rule.id]:""}`)}></span></td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function cRuleQuality(stats){
 const names=Object.fromEntries(config.rules.map(r=>[r.id,r.name]).concat(config.custom.map(r=>[r.id,"Custom: "+r.name])));
 const e=Object.entries(stats).filter(([,v])=>v.hits).sort((a,b)=>b[1].fp/b[1].hits-a[1].fp/a[1].hits||b[1].hits-a[1].hits);
 if(!e.length) return '<span class="text-xs text-secondary">No rule hits yet.</span>';
 const max=Math.max(...e.map(([,v])=>v.hits));
 return `<div class="chart"><div class="legend"><span><i class="sq" style="background:var(--series-1)"></i>Hits still valid</span><span><i class="sq" style="background:var(--series-2)"></i>Hits marked false positive</span></div>
 ${e.map(([id,v])=>{ const ok=v.hits-v.fp; return `<div class="hrow"><span class="lbl" title="${esc(names[id]||id)}">${esc(names[id]||id)}</span><div class="track" ${tip(`${names[id]||id}\nHits: ${v.hits}\nFalse positives: ${v.fp} (${Math.round(v.fp/v.hits*100)}%)`)}><div class="stack" style="width:${pct(v.hits,max)}%">${ok?`<span style="flex:${ok}"></span>`:""}${v.fp?`<span class="o" style="flex:${v.fp}"></span>`:""}</div></div><span class="val">${v.fp}/${v.hits}</span></div>`; }).join("")}</div>`;
}

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded",()=>{
 $("#nav").addEventListener("click",e=>{ const a=e.target.closest("[data-nav]"); if(!a) return; e.preventDefault(); ui.tab=a.dataset.nav; closeDrawer(); closeSide(); render(); window.scrollTo(0,0); });
 $("#jurBtn").onclick=()=>{ ui.indiaOnly=!ui.indiaOnly; ui.page=1; render(); };
 $("#gsearch").addEventListener("input",e=>{ ui.q=e.target.value; ui.page=1; if(!["matrix","leads"].includes(ui.tab)) ui.tab="leads"; render(); const g=$("#gsearch"); g.focus(); });
 $("#scrim").onclick=()=>{ closeDrawer(); closeSide(); };
 $("#menuBtn").onclick=()=>{ $("#side").classList.remove("-translate-x-full"); $("#scrim").classList.remove("hidden"); };
 document.addEventListener("keydown",e=>{ if(e.key==="Escape"){ closeDrawer(); closeModal(); closeSide(); } if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){ e.preventDefault(); $("#gsearch").focus(); } });
 $("#modal").addEventListener("click",e=>{ if(e.target.id==="modal") closeModal(); });
 // tooltips
 const t=$("#tip");
 const show=(el,x,y)=>{ t.textContent=el.dataset.tip; t.style.display="block"; const w=t.offsetWidth,h=t.offsetHeight; t.style.left=Math.min(innerWidth-w-8,Math.max(8,x+12))+"px"; t.style.top=(y+h+20>innerHeight?y-h-12:y+14)+"px"; };
 document.addEventListener("mousemove",e=>{ const el=e.target.closest("[data-tip]"); if(el) show(el,e.clientX,e.clientY); else t.style.display="none"; });
 addEventListener("scroll",()=>t.style.display="none",{passive:true});
 try{ localStorage.removeItem("sw.theme"); }catch(e){}
 $("#engineBtn").onclick=()=>{ if(srv.status&&(srv.status.running||srv.status.verify_busy)) showProgress(); else openSearch(); };
 render(); pollStatus();
});
function closeSide(){ if(innerWidth<1024){ $("#side").classList.add("-translate-x-full"); if(!$("#drawer").dataset.open) $("#scrim").classList.add("hidden"); } }
