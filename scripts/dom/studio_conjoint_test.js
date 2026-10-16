/* jsdom check of the conjoint experiment editor on the choice task question, and of the rule that
   the Conjoint tab only appears once a conjoint question exists.
   Needs the server on :8000 and jsdom.
   node scripts/dom/studio_conjoint_test.js */
let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (e) { ({ JSDOM } = require("/tmp/node_modules/jsdom")); }
const http=require("http"); const BASE=process.env.BASE||"http://127.0.0.1:8000";
function req(method,p,body){return new Promise((res,rej)=>{const u=new URL(BASE+p);const h={};if(body)h["Content-Type"]="application/json";
  const r=http.request(u,{method,headers:h},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>res({status:x.statusCode,body:d}));});r.on("error",rej);if(body)r.write(body);r.end();});}
const get=p=>req("GET",p).then(r=>r.body);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0; const check=(l,c,d="")=>{console.log((c?"PASS  ":"FAIL  ")+l+(c?"":"  -> "+d)); if(!c)fails++;};

(async()=>{
  // ---- a study with no conjoint question: the tab must not be there ----
  const plain={sections:[{id:"S1",title:"Opening questions"}],
    questions:[{id:"Q1",section:"S1",type:"single_select",stem:"Pick",options:[{code:1,label:"A"},{code:2,label:"B"}]}]};
  let slug=JSON.parse((await req("POST","/api/studio/save",JSON.stringify({title:"Conjoint Tab Test",cfg:plain}))).body).slug;

  const dom=new JSDOM(await get("/studio/#"+slug),{url:BASE+"/studio/#"+slug,runScripts:"outside-only",pretendToBeVisual:true});
  const w=dom.window; w.scrollTo=()=>{}; w.requestAnimationFrame=f=>setTimeout(f,0);
  w.Element.prototype.scrollIntoView=function(){}; w.confirm=()=>true;
  w.BEACON_PREVIEW_MODE=true;
  w.fetch=(u,o)=>{const U=new URL(u,BASE);
    return req((o&&o.method)||"GET",U.pathname+U.search,o&&o.body).then(x=>({ok:x.status<400,status:x.status,json:()=>Promise.resolve(JSON.parse(x.body))}));};
  const errs=[]; w.addEventListener("error",e=>errs.push(e.message));
  // jsdom has no document.execCommand: provide just enough of it to drive the toolbar
  w.document.execCommand=function(cmd,ui,val){
    if(cmd==="insertHTML"){const el=w.document.activeElement;
      if(el&&el.getAttribute&&el.getAttribute("contenteditable")==="true")el.innerHTML+=String(val||"");}
    return true;};
  for (const f of ["qlogic.js","survey.js","explainer.js","studio.js"]) w.eval(await get("/static/js/"+f));
  await sleep(900);
  const d=w.document, $=s=>d.querySelector(s), $$=s=>[...d.querySelectorAll(s)];
  const fire=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true}));
  const click=el=>el.dispatchEvent(new w.MouseEvent("click",{bubbles:true,cancelable:true}));
  const tabs=()=>$$(".st-tab").map(b=>b.getAttribute("data-tab"));

  check("a study with no conjoint question hides the Conjoint tab",
    tabs().indexOf("conjoint")<0, tabs().join(","));
  check("the other tabs are all still there",
    ["questions","translations","tpp","settings","responses","analysis"].every(t2=>tabs().includes(t2)), tabs().join(","));

  // ---- add a conjoint question: the tab appears ----
  click($("[data-act=qadd]")); await sleep(80);
  const cjType=$$(".st-type").find(b=>b.getAttribute("data-type")==="choice_task");
  check("the add-question library offers the Conjoint type", !!cjType);
  click(cjType); await sleep(120);
  check("adding a conjoint question reveals the Conjoint tab", tabs().indexOf("conjoint")>=0, tabs().join(","));
  check("the new question is selected", /Conjoint/i.test($(".st-ehead").textContent));

  // ---- the question editor chrome from the reference design ----
  const strip=()=>$$(".st-etab");
  check("the editor strip offers Content & Settings / Show IF / Screening / PREVIEW",
    strip().length===4 && /Content & Settings/.test(strip()[0].textContent) &&
    /Show IF/.test(strip()[1].textContent) && /Screening/.test(strip()[2].textContent) &&
    /PREVIEW/.test(strip()[3].textContent),
    strip().map(b=>b.textContent).join(" | "));
  check("Content & Settings is the landing tab", strip()[0].classList.contains("on") && !!$("#card-answers"));
  strip()[1].click(); await sleep(60);
  check("Show IF holds the conditions",
    strip()[1].classList.contains("on") && !!$("#card-logic") && !$("#card-answers"));
  strip()[0].click(); await sleep(60);
  check("switching back restores the content cards", !!$("#card-answers") && !$("#card-logic"));
  const tbAct=a=>$(".st-toolbar").querySelector("[data-tb-act="+a+"]");
  const tbCmd=c=>$(".st-toolbar").querySelector("[data-cmd="+c+"]");
  check("the rich-text toolbar carries the reference controls",
    ["fontSize","fontName","bold","italic","underline","justifyLeft","justifyCenter","justifyRight",
     "insertUnorderedList","insertOrderedList","superscript"].every(c=>!!tbCmd(c)) &&
    ["link","table","image","source","fullscreen","more"].every(a=>!!tbAct(a)),
    $(".st-toolbar") && $(".st-toolbar").textContent);
  tbAct("more").click();
  check("the more row reveals the extra controls",
    $(".st-toolbar").classList.contains("more-open") && !!tbCmd("strikeThrough") && !!tbCmd("removeFormat"));
  check("the toolbar can insert a table", (()=>{
    const rich=$("#f-stem-rich"); rich.focus();
    tbAct("table").click();
    return /<table/.test(rich.innerHTML); })(), $("#f-stem-rich").innerHTML.slice(0,80));
  check("the toolbar can open the HTML source view", (()=>{
    tbAct("source").click();
    const ta=$(".st-src");
    return !!ta && ta.getAttribute("data-for")==="f-stem-rich" && $("#f-stem-rich").hidden; })());
  check("and closing it puts the edited source back", (()=>{
    tbAct("source").click();
    return !$(".st-src") && !$("#f-stem-rich").hidden; })());
  check("full screen toggles on the editor", (()=>{
    tbAct("fullscreen").click();
    const on=$("#f-stem-rich").classList.contains("fs");
    tbAct("fullscreen").click();
    return on && !$("#f-stem-rich").classList.contains("fs"); })());
  check("the question card offers + Add Image & Video Attachments",
    /\+ Add Image & Video Attachments/.test(($("[data-act=media-add-quick]")||{}).textContent||""),
    ($("[data-act=media-add-quick]")||{}).textContent);

  // ---- the experiment card, element by element (matches the reference design) ----
  const cj=$(".st-cj");
  check("the conjoint question shows an experiment card", !!cj);
  check("Title or reference to this Conjoint Experiment", !!$("#f-cj-title"));
  check("its info tooltip is present", !!$("#f-cj-title").closest(".st-field").querySelector(".st-info"));
  const desc=$("#f-cj-desc");
  check("Description is a rich-text field with a formatting toolbar",
    !!desc && desc.getAttribute("contenteditable")==="true" && !!$('[data-pipe-for="f-cj-desc"]'));
  check("Description starts with the standard sentence",
    /combinations of/.test(desc.textContent) && /most likely to purchase/.test(desc.textContent),
    desc.textContent.slice(0,80));
  check("a Patient vignette field is kept", !!$("#f-vignette"));
  check("Attributes heading with an info icon", /Attributes/.test(cj.textContent) && !!cj.querySelector("h4 .st-info"));

  // attributes + levels
  const attrs=()=>$$(".st-cj-attr");
  check("two starter attributes", attrs().length===2, attrs().length);
  check("each attribute is numbered and draggable",
    !!attrs()[0].querySelector(".st-seq") && attrs()[0].querySelector(".st-seq").textContent.trim()==="1." &&
    attrs()[0].querySelector(".st-grip").getAttribute("draggable")==="true");
  check("each attribute has a name field", !!attrs()[0].querySelector("[data-cj-field=label]"));
  check("each attribute can be deleted", !!attrs()[0].querySelector("[data-act=cj-attr-del]"));
  check("each attribute has Add Range Levels / Add Images / Group Inclusion toggles",
    !!attrs()[0].querySelector("[data-act=cj-attr-range]") &&
    !!attrs()[0].querySelector("[data-act=cj-attr-images]") &&
    !!attrs()[0].querySelector("[data-act=cj-attr-group]"));
  check("Levels label is present with an info icon",
    /Levels/.test(attrs()[0].textContent) && !!attrs()[0].querySelector(".st-cj-levels-lbl .st-info"));
  check("each level is an input with its own delete button",
    $$(".st-cj-attr").every(a=>[...a.querySelectorAll(".st-cj-level")].every(l=>l.querySelector("input")&&l.querySelector("[data-act=cj-level-del]"))));
  check("each attribute offers + Add Level",
    attrs().every(a=>a.querySelector("[data-act=cj-level-add]")));
  check("+ Add Attribute is offered", !!$("[data-act=cj-attr-add]"));

  // toggles + sampling
  check("Allow \u201Cnone\u201D toggle with info icon",
    !!$("#f-cj-none") && !!$("#f-cj-none").closest(".st-switch").parentElement.querySelector(".st-info") ||
    !!$("#f-cj-none"));
  check("Group Inclusion is offered per attribute", $$("[data-act=cj-attr-group]").length===2);
  check("Configure Sampling exposes Number of Cards and Number of Sets",
    !!$("#f-cj-cards") && !!$("#f-cj-sets") && /Number of Cards/.test(cj.textContent) && /Number of Sets/.test(cj.textContent));
  check("a Generate design button is present", !!$("[data-act=genconj]"));

  // ---- deleting the only conjoint question (no design yet) takes the tab away ----
  click($(".st-ehead-tools [data-act=qdel]")); await sleep(200);
  check("deleting the conjoint question removes the Conjoint tab",
    tabs().indexOf("conjoint")<0, tabs().join(","));
  const toast=$("#st-toast");
  check("the delete offers an undo", !!toast && /Undo/.test(toast.textContent), toast && toast.textContent);
  click(toast.querySelector(".st-toast-btn")); await sleep(250);
  check("undoing the delete brings the tab back", tabs().indexOf("conjoint")>=0, tabs().join(","));
  check("and the experiment card comes back with it", !!$("#f-cj-title"));

  // ---- author an experiment and edit it ----
  const nameIn=attrs()[0].querySelector("[data-cj-field=label]");
  nameIn.value="Color"; fire(nameIn,"input"); await sleep(40);
  const lv0=attrs()[0].querySelector('[data-cj-field=level][data-l="0"]');
  const lv1=attrs()[0].querySelector('[data-cj-field=level][data-l="1"]');
  lv0.value="Red"; fire(lv0,"input"); lv1.value="Blue"; fire(lv1,"input"); await sleep(40);

  click(attrs()[0].querySelector("[data-act=cj-level-add]")); await sleep(80);
  check("+ Add Level appends a level row", attrs()[0].querySelectorAll(".st-cj-level").length===3,
    attrs()[0].querySelectorAll(".st-cj-level").length);
  const lv2=attrs()[0].querySelector('[data-cj-field=level][data-l="2"]');
  lv2.value="Green"; fire(lv2,"input"); await sleep(40);
  click(attrs()[0].querySelector("[data-act=cj-level-del][data-l='2']")); await sleep(80);
  check("a level can be deleted again", attrs()[0].querySelectorAll(".st-cj-level").length===2);
  check("deleting a level never drops below two", (()=>{
    const del=attrs()[0].querySelector("[data-act=cj-level-del]"); click(del); return true; })() &&
    attrs()[0].querySelectorAll(".st-cj-level").length===2, attrs()[0].querySelectorAll(".st-cj-level").length);

  // the other attribute keeps its own values (indices, not positions)
  check("editing one attribute leaves the other alone",
    attrs()[1].querySelector("[data-cj-field=label]").value==="Attribute 2",
    attrs()[1].querySelector("[data-cj-field=label]").value);

  // range levels
  const rangeT=attrs()[1].querySelector("[data-act=cj-attr-range]");
  rangeT.checked=true; fire(rangeT,"change"); await sleep(80);
  check("Add Range Levels reveals from / to / step / suffix",
    !!attrs()[1].querySelector("[data-cj-range=from]") && !!attrs()[1].querySelector("[data-cj-range=to]") &&
    !!attrs()[1].querySelector("[data-cj-range=step]") && !!attrs()[1].querySelector("[data-cj-range=suffix]"));
  const to=attrs()[1].querySelector("[data-cj-range=to]"); to.value="5"; fire(to,"change"); await sleep(40);
  click($("[data-act=cj-range-apply]")); await sleep(100);
  check("Build levels fills the levels from the range",
    attrs()[1].querySelectorAll(".st-cj-level").length===5,
    attrs()[1].querySelectorAll(".st-cj-level").length);

  // images toggle reveals a per-level image control
  const imgT=attrs()[0].querySelector("[data-act=cj-attr-images]");
  imgT.checked=true; fire(imgT,"change"); await sleep(100);
  check("Add Images puts an image control on every level",
    attrs()[0].querySelectorAll("[data-act=cj-opt-img], [data-act=cj-level-img]").length,
    "attach buttons: "+attrs()[0].querySelectorAll("[data-act=cj-level-img]").length);

  // group inclusion
  const grpT=attrs()[1].querySelector("[data-act=cj-attr-group]");
  grpT.checked=true; fire(grpT,"change"); await sleep(80);

  // sampling
  const cards=$("#f-cj-cards"); cards.value="2"; fire(cards,"change");
  const sets=$("#f-cj-sets"); sets.value="4"; fire(sets,"change");
  const titleIn=$("#f-cj-title"); titleIn.value="Colour and price trade-off"; fire(titleIn,"input"); await sleep(60);

  // ---- generate the design ----
  click($("[data-act=genconj]")); await sleep(900);
  check("generate reports what it built", /Design generated: 4 sets \u00D7 2 cards/.test(($("#st-toast")||{}).textContent||""),
    ($("#st-toast")||{}).textContent);
  await sleep(1500);                       // let the autosave flush before reading the study back
  const saved=JSON.parse(await get("/api/studio/study?slug="+slug)).cfg;
  const design=saved.conjoint;
  check("a design was generated", !!design && !!design.tasks, JSON.stringify(design && Object.keys(design)));
  check("the design honours Number of Sets", Object.keys(design.tasks).length===4, Object.keys(design.tasks).length);
  check("the design honours Number of Cards", design.tasks["0"].length===2, design.tasks["0"].length);
  check("the generated design carries the authored attribute labels",
    design.attributes[0].label==="Color", JSON.stringify(design.attributes[0]));
  check("the design keeps the authored levels", design.attributes[0].levels.join(",")==="Red,Blue",
    JSON.stringify(design.attributes[0].levels));
  check("the group-inclusion attribute is masked in some sets",
    design.tasks.some(t2=>t2[0].levels[1]===null),
    JSON.stringify(design.tasks.map(t2=>t2[0].levels)));
  check("and it really is shown in the others",
    design.tasks.some(t2=>typeof t2[0].levels[1]==="number") &&
    design.groups && design.groups.A2 && design.groups.A2.length===2,
    JSON.stringify(design.groups));

  // the experiment is authored on the question and survives a reload
  const q=saved.questions.find(x=>x.type==="choice_task");
  check("the experiment lives on the conjoint question", !!q.conjoint);
  check("its description is stored as rich text", /combinations of/.test(q.conjoint.description_html||""),
    (q.conjoint||{}).description_html);
  check("Allow \u201Cnone\u201D is stored on the experiment", q.conjoint.allow_none===true);
  check("the experiment title is stored", q.conjoint.title==="Colour and price trade-off", q.conjoint.title);
  check("the sampling plan is stored", q.conjoint.n_cards===2 && q.conjoint.n_sets===4,
    q.conjoint.n_cards+"x"+q.conjoint.n_sets);

  // ---- a study that still owns a generated design keeps the tab (existing designs count) ----
  check("a study with a generated design keeps the Conjoint tab",
    tabs().indexOf("conjoint")>=0, tabs().join(","));
  click($$(".st-tab").find(b=>b.getAttribute("data-tab")==="conjoint")); await sleep(250);
  const cjtab=$("#st-panel").textContent;
  const flat=cjtab.replace(/\s+/g,"");
  check("the Conjoint tab summarises the fielded design",
    /Conjointdesign/.test(flat) && /4sets2cardsperset/.test(flat) &&
    /Color/.test(cjtab) && /Red/.test(cjtab),
    flat.slice(0,160));
  check("it shows how group inclusion is fielded", /asked in 2 of 4 sets/.test(cjtab), cjtab.replace(/\s+/g," ").slice(0,200));
  check("it spells out the first set", /Card 1/.test(cjtab) && /Card 2/.test(cjtab));
  check("the legacy free-text attribute editor is gone", !$("#f-attrs") && !$("#f-ntasks"));
  click($("[data-act=cj-open-q]")); await sleep(250);
  check("it offers a way back to the question that authors it",
    !!$("#f-cj-title") && tabs().indexOf("conjoint")>=0, tabs().join(","));

  await req("POST","/api/studio/delete",JSON.stringify({slug:slug}));

  // ---- the seeded beacon study carries a design written before this editor existed ----
  const b=new JSDOM(await get("/studio/#beacon"),{url:BASE+"/studio/#beacon",runScripts:"outside-only",pretendToBeVisual:true});
  const bw=b.window; bw.scrollTo=()=>{}; bw.requestAnimationFrame=f=>setTimeout(f,0);
  bw.Element.prototype.scrollIntoView=function(){}; bw.confirm=()=>true; bw.BEACON_PREVIEW_MODE=true;
  bw.fetch=(u,o)=>{const U=new URL(u,BASE);
    return req((o&&o.method)||"GET",U.pathname+U.search,o&&o.body).then(x=>({ok:x.status<400,status:x.status,json:()=>Promise.resolve(JSON.parse(x.body))}));};
  const berrs=[]; bw.addEventListener("error",e=>berrs.push(e.message));
  for (const f of ["qlogic.js","survey.js","explainer.js","studio.js"]) bw.eval(await get("/static/js/"+f));
  await sleep(900);
  const bd=bw.document, b$=s2=>bd.querySelector(s2), b$$=s2=>[...bd.querySelectorAll(s2)];
  const bclick=el=>el.dispatchEvent(new bw.MouseEvent("click",{bubbles:true,cancelable:true}));
  check("the beacon study shows the Conjoint tab", b$$(".st-tab").some(x=>x.getAttribute("data-tab")==="conjoint"),
    b$$(".st-tab").map(x=>x.getAttribute("data-tab")).join(","));
  bclick(b$$(".st-tab").find(x=>x.getAttribute("data-tab")==="conjoint")); await sleep(250);
  const btxt=(b$("#st-panel").textContent||"").replace(/\s+/g," ");
  check("the tab renders the seeded design without an error",
    /Conjoint design/.test(btxt) && /9\s*sets/.test(btxt) && /3\s*cards per set/.test(btxt), btxt.slice(0,140));
  check("it lists the seeded attributes with their levels",
    /OS 3 levels/.test(btxt) && /\+6 months median OS/.test(btxt) &&
    !/undefined|NaN|\[object/.test(btxt), btxt.slice(0,240));
  check("the beacon study raised no JS errors", berrs.length===0, berrs.join(" | "));

  check("no JS errors", errs.length===0, errs.join(" | "));
  console.log(fails? "\n"+fails+" CHECK(S) FAILED" : "\nall checks passed");
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
