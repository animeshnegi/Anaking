/* jsdom check of the Studio workspace: outline / editor / preview, autosave, type picker, options,
   logic, undo delete and the pipe picker.  Needs the server on :8000 and jsdom.
   node scripts/dom/studio_workspace_test.js */
let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (e) { ({ JSDOM } = require("/tmp/node_modules/jsdom")); }
const http=require("http"); const BASE=process.env.BASE||"http://127.0.0.1:8000"; const TK="token="+(process.env.TOKEN||"beacon-admin");
function req(method,p,body){return new Promise((res,rej)=>{const u=new URL(BASE+p);const h={};if(body)h["Content-Type"]="application/json";
  const r=http.request(u,{method,headers:h},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>res({status:x.statusCode,body:d}));});r.on("error",rej);if(body)r.write(body);r.end();});}
const get=p=>req("GET",p+(p.includes("?")?"&":"?")+TK).then(r=>r.body);
let fails=0; const check=(l,c,d="")=>{console.log((c?"PASS  ":"FAIL  ")+l+(c?"":"  -> "+d)); if(!c)fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const cfg={sections:[{id:"S1",title:"Screener"},{id:"S2",title:"Main"}],questions:[
    {id:"Q1",section:"S1",type:"single_select",stem:"Your specialty?",options:[{code:1,label:"Oncology"},{code:2,label:"Haematology"}]},
    {id:"Q2",section:"S2",type:"multi_select",stem:"Therapies used?",options:[{code:1,label:"Chemo"},{code:2,label:"IO"}]},
    {id:"Q3",section:"S2",type:"open_text",stem:"Tell us more"}],tpp:{},explainer_scenes:[]};
  const slug=JSON.parse((await req("POST","/api/studio/save?"+TK,JSON.stringify({title:"Workspace Test",cfg}))).body).slug;
  const saved=async()=>JSON.parse(await get("/api/studio/study?slug="+slug)).cfg;
  const dom=new JSDOM(await get("/studio/"),{url:BASE+"/studio/?"+TK+"#"+slug,runScripts:"outside-only",pretendToBeVisual:true}); const w=dom.window;
  w.BEACON_PREVIEW_MODE=true; w.requestAnimationFrame=fn=>setTimeout(fn,0); w.scrollTo=()=>{}; w.Element.prototype.scrollIntoView=function(){};
  w.confirm=()=>true;
  let saves=0;
  w.fetch=(u,o)=>{const U=new URL(u,BASE); if(U.pathname==="/api/studio/save")saves++;
    return req((o&&o.method)||"GET",U.pathname+U.search,o&&o.body).then(x=>({ok:x.status<400,status:x.status,json:()=>Promise.resolve(JSON.parse(x.body))}));};
  const errs=[]; w.addEventListener("error",e=>errs.push(e.message));
  for (const f of ["qlogic.js","survey.js","explainer.js","studio.js"]) w.eval(await get("/static/js/"+f));
  await sleep(700);
  const $=s=>w.document.querySelector(s), $$=s=>[...w.document.querySelectorAll(s)];
  const fire=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true}));
  const mdown=el=>el.dispatchEvent(new w.MouseEvent("mousedown",{bubbles:true,cancelable:true}));

  // --- layout
  check("three-pane workspace renders", $("#st-outline") && $("#st-editor") && $("#st-previewpane"));
  check("outline lists both sections and all questions", $$(".st-sec").length===2 && $$(".st-qi").length===3);
  check("first question auto-selected and its editor shown", $(".st-qi.on .st-qi-id").textContent==="Q1" && $("#f-stem-rich").textContent==="Your specialty?");
  check("editor is one scrolling form with cards (no tabs)", $$(".st-ecard").length===6 && !$("[data-edtab]"));
  check("status segment + save state + autosave switch in bar", $(".st-status-btn.on.draft") && $("#st-savestate .st-ss.ok") && $("#st-autosave").checked);
  check("preview shows Q1", /Your specialty/.test($("#st-prev-body").textContent));

  // --- select Q3, edit stem -> preview, outline and autosave
  $$(".st-qi")[2].click(); await sleep(30);
  check("clicking outline row switches editor", $("#f-stem-rich").textContent==="Tell us more" && $(".st-qi.on .st-qi-id").textContent==="Q3");
  const rich=$("#f-stem-rich"); rich.textContent="Tell us more please"; fire(rich,"input"); await sleep(20);
  check("typing updates preview immediately", /Tell us more please/.test($("#st-prev-body").textContent));
  check("outline row text updates live", $$(".st-qi")[2].querySelector(".st-qi-stem").textContent==="Tell us more please");
  check("save state shows pending", /Unsaved/.test($("#st-savestate").textContent));
  await sleep(1600);
  check("autosaved to server (~1s after typing)", saves>=1 && (await saved()).questions[2].stem==="Tell us more please", "saves="+saves);
  check("save state shows saved", /All changes saved/.test($("#st-savestate").textContent));

  // --- required switch, id rename
  $("#f-required").click(); fire($("#f-required"),"change"); await sleep(20);
  check("required toggle -> optional badge in outline", /optional/.test($$(".st-qi")[2].textContent));
  const idIn=$("#f-id"); idIn.value="Q1"; fire(idIn,"change"); await sleep(20);
  check("duplicate id rejected", $("#f-id").value==="Q3");
  idIn.value="Q9"; fire(idIn,"change"); await sleep(20);
  check("id rename applied to outline", $$(".st-qi")[2].querySelector(".st-qi-id").textContent==="Q9");

  // --- pipe picker on rich stem
  rich.focus(); const r=w.document.createRange(); r.setStart(rich.firstChild,5); r.collapse(true); const s=w.getSelection(); s.removeAllRanges(); s.addRange(r);
  const pbtn=$("[data-pipe-for=f-stem-rich]"); mdown(pbtn); pbtn.click(); await sleep(30);
  check("pipe picker opens above the form, Q1+Q2 only", !$("#st-pipe-pop").hidden && $$(".st-pipe-q").length===2);
  $$(".st-pipe-item").find(b=>b.getAttribute("data-token")==="{Q1}").click(); await sleep(30);
  check("token inserted at caret and resolved in preview", rich.querySelector("span.pipe") && /Tell Oncology/.test($("#st-prev-body").textContent), $("#st-prev-body h2")&&$("#st-prev-body h2").textContent);

  // --- options editor on Q2
  $$(".st-qi")[1].click(); await sleep(30);
  check("answer options card lists 2 options with flags", $$('.st-items[data-kind=opt] .st-item:not(.st-item-head)').length===2 && $$(".st-flag").length===6);
  $("[data-act=opt-add-none]").click(); await sleep(20);
  const opts=$$('.st-items[data-kind=opt] .st-item:not(.st-item-head)');
  check("+ None of these adds exclusive pinned option 99", opts.length===3 && opts[2].querySelector("[data-k=code]").value==="99" && opts[2].querySelector(".st-flag.on"));
  check("preview shows the new option", /None of these/.test($("#st-prev-body").textContent));
  const lbl=$("#f-opt-0"); lbl.value="Chemotherapy"; fire(lbl,"input"); await sleep(20);
  check("option label edit -> preview", /Chemotherapy/.test($("#st-prev-body").textContent));
  $$("[data-act=it-del]")[0].click(); await sleep(20);
  check("remove option", $$('.st-items[data-kind=opt] .st-item:not(.st-item-head)').length===2 && !/Chemotherapy/.test($("#st-prev-body").textContent));
  // layout segment
  $$("[data-act=set-layout]").find(b=>b.getAttribute("data-v")==="inline").click(); await sleep(20);
  check("layout segment applies", $("#st-prev-body .opts.opt-inline"));

  // --- logic card: add a rule on Q2 referencing Q1
  $("[data-act=rule-add]").click(); await sleep(30);
  check("condition row added with plain-English connector", $$("#f-rules .st-rule").length===1 && /when/.test($(".st-rule-no").textContent) && /Show this question/.test($(".st-logic-intro").textContent));
  check("logic badge in outline + card marker", /logic/.test($$(".st-qi")[1].textContent) && $("#card-logic .st-dot"));
  check("preview evaluates rule against sample answers", /SHOWN|HIDDEN/.test(($("#sif-result")||{}).textContent||""));

  // --- change type via header select (Q2 multi -> single keeps options)
  const ty=$("#f-type"); ty.value="single_select"; fire(ty,"change"); await sleep(30);
  check("type change keeps options & logic", $$('.st-items[data-kind=opt] .st-item:not(.st-item-head)').length===2 && $$("#f-rules .st-rule").length===1 && $(".st-qi.on .st-qi-ic").textContent==="\u25C9");

  // --- add question via type picker
  $$("[data-act=qadd]")[1].click(); await sleep(20);
  check("type picker modal opens with grouped, plain-English types", !$("#st-modal").hidden && $$(".st-type").length===14 && /Choose one/.test($("#st-modal").textContent));
  $$(".st-type").find(b=>b.getAttribute("data-type")==="rating_grid").click(); await sleep(40);
  check("new rating grid inserted after selected question in Main, selected, next free id", $("#st-modal").hidden && $$(".st-qi").length===4 && $(".st-qi.on .st-qi-id").textContent==="Q10" && $$(".st-qi")[2].classList.contains("on"));
  check("rows card with scale fields shown", $$('.st-items[data-kind=row] .st-item:not(.st-item-head)').length===2 && $("#f-smin"));

  // --- delete with undo
  $$("[data-act=qdel]").find(b=>b.closest(".st-qi-tools")).click(); await sleep(30);
  check("delete removes row and offers undo", $$(".st-qi").length===3 && /Undo/.test($("#st-toast").textContent));
  $("#st-toast .st-toast-btn").click(); await sleep(30);
  check("undo restores it", $$(".st-qi").length===4);

  // --- section add + rename reflects in editor select
  $("[data-act=addsec]").click(); await sleep(20);
  const secIn=$('[data-sec-title="2"]'); secIn.value="Closing"; fire(secIn,"input"); await sleep(20);
  check("section added and renamed", $$(".st-sec").length===3 && (await new Promise(r=>setTimeout(()=>r($('#f-section option[value="S3"]').textContent),0)))==="Closing");

  // --- Ctrl+S flush + final server state
  w.dispatchEvent(new w.KeyboardEvent("keydown",{key:"s",ctrlKey:true,bubbles:true,cancelable:true})); await sleep(700);
  const fin=await saved();
  check("final study persisted: 4 questions, 3 sections, rule on Q2, stem token plain", fin.questions.length===4 && fin.sections.length===3 && fin.questions[1].show_if.rules.length===1 && /Tell \{Q1\}/.test(fin.questions[3].stem_html) && !/class="pipe"/.test(fin.questions[3].stem_html), JSON.stringify(fin.questions.map(q=>q.id)));
  check("status change via segment -> server", await (async()=>{ $$(".st-status-btn").find(b=>b.getAttribute("data-status")==="live").click(); await sleep(500); return JSON.parse(await get("/api/studio/study?slug="+slug)).status==="live" && $(".st-status-btn.on").getAttribute("data-status")==="live"; })());

  // --- settings tab autosaves QC fields
  $$("[data-tab]").find(b=>b.getAttribute("data-tab")==="settings").click(); await sleep(30);
  const ms=$("#f-minsec"); ms.value="420"; fire(ms,"input"); const vb=$("#f-verb"); vb.value="Q9, Q3"; fire(vb,"input"); await sleep(1600);
  const fin2=await saved();
  check("settings fields autosave", fin2.qc.min_seconds===420 && fin2.qc.verbatim_qs.join()==="Q9,Q3", JSON.stringify(fin2.qc));

  // --- back to dashboard
  $$("[data-tab]").find(b=>b.getAttribute("data-tab")==="questions").click(); await sleep(30);
  $("[data-act=back]").click(); await sleep(500);
  check("dashboard with search/filter and stat cards", $("#home-search") && $$(".st-card").length>=1 && $(".st-seg-btn.on"));
  check("no JS errors", errs.length===0, errs.join("; "));
  await req("POST","/api/studio/delete?"+TK,JSON.stringify({slug}));
  process.exit(fails?1:0);
})().catch(e=>{console.error("ERR",e);process.exit(1)});
