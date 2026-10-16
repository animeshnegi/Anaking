/* jsdom check of the Studio outline: a new study starts with one section the author names
   (there are no predefined section names), adding and naming sections, the per-question
   Title under the ID, and the list <-> thumbnails view switch.
   Needs the server on :8000 and jsdom.
   node scripts/dom/studio_sections_test.js */
let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (e) { ({ JSDOM } = require("/tmp/node_modules/jsdom")); }
const http=require("http"); const BASE=process.env.BASE||"http://127.0.0.1:8000";
function req(method,p,body){return new Promise((res,rej)=>{const u=new URL(BASE+p);const h={};if(body)h["Content-Type"]="application/json";
  const r=http.request(u,{method,headers:h},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>res({status:x.statusCode,body:d}));});r.on("error",rej);if(body)r.write(body);r.end();});}
const get=p=>req("GET",p).then(r=>r.body);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0; const check=(l,c,d="")=>{console.log((c?"PASS  ":"FAIL  ")+l+(c?"":"  -> "+d)); if(!c)fails++;};

(async()=>{
  // boot the Studio with no study open, then drive the "create a new study" flow
  const dom=new JSDOM(await get("/studio/"),{url:BASE+"/studio/",runScripts:"outside-only",pretendToBeVisual:true});
  const w=dom.window; w.scrollTo=()=>{}; w.requestAnimationFrame=f=>setTimeout(f,0);
  w.Element.prototype.scrollIntoView=function(){};
  w.confirm=()=>true;
  w.BEACON_PREVIEW_MODE=true;                        // survey.js renders questions, never boots
  w.fetch=(u,o)=>{const U=new URL(u,BASE);
    return req((o&&o.method)||"GET",U.pathname+U.search,o&&o.body).then(x=>({ok:x.status<400,status:x.status,json:()=>Promise.resolve(JSON.parse(x.body))}));};
  const errs=[]; w.addEventListener("error",e=>errs.push(e.message));
  for (const f of ["qlogic.js","survey.js","explainer.js","studio.js"]) w.eval(await get("/static/js/"+f));
  await sleep(800);
  const d=w.document, $=s=>d.querySelector(s), $$=s=>[...d.querySelectorAll(s)];
  const fire=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true}));
  const click=el=>el.dispatchEvent(new w.MouseEvent("click",{bubbles:true,cancelable:true}));

  // ---------- a brand new study starts with one section the author names ----------
  click($('[data-act="new"]')); await sleep(60);
  click($('[data-act="new-mode"][data-mode="scratch"]')); await sleep(60);
  check("new-study form offers a Study title", !!$("#ns-title"));
  click($('[data-act="new-create"]')); await sleep(1100);          // creates + opens the editor
  const secTitles=$$(".st-sec-head input").map(i=>i.value);
  check("a new study starts with one, empty section", secTitles.length===1 && secTitles[0]==="",
    JSON.stringify(secTitles));
  check("no predefined name is filled in", $$(".st-sec-head input").every(i=>!!i.placeholder) &&
    !["Screeners","Main"].some(n=>secTitles.includes(n)), JSON.stringify(secTitles));
  check("the starter questions live in that section", $$(".st-qi").length===4, $$(".st-qi").length);

  // ---------- Question Title sits under the Question ID ----------
  const idcol=$(".st-ehead-idcol");
  check("ID and Title live in the same column", !!idcol && !!idcol.querySelector("#f-id") && !!idcol.querySelector("#f-title"));
  check("Title is directly below ID",
    idcol.children[0].querySelector("#f-id") && idcol.children[1].querySelector("#f-title"),
    [...idcol.children].map(c=>c.textContent.slice(0,6)).join(","));
  check("Title is labelled Title", /Title/i.test(idcol.children[1].textContent));

  const tin=$("#f-title");
  check("Title starts empty with a placeholder", tin.value==="" && !!tin.placeholder, JSON.stringify(tin.value));
  tin.value="Specialty screener"; fire(tin,"input"); await sleep(60);
  check("typing a title shows it on the outline row",
    ($(".st-qi.on .st-qi-title")||{}).textContent==="Specialty screener",
    ($(".st-qi.on")||{}).textContent);
  check("the wording drops to a second, muted line", !!$(".st-qi-main.has-title .st-qi-stem"));
  await sleep(1500);
  const saved1=JSON.parse(await get("/api/studio/study?slug="+(w.location.hash||"").slice(1))).cfg;
  const slug=(w.location.hash||"").slice(1);
  check("the title is saved to the study", (saved1.questions[0]||{}).title==="Specialty screener",
    JSON.stringify((saved1.questions[0]||{}).title));

  // ---------- list <-> thumbnails ----------
  check("the outline offers a view switch", $$('[data-act="outline-view"]').length===2);
  check("list is the default view", $('[data-act="outline-view"][data-v="list"]').classList.contains("on") &&
    $$(".st-qi").length>0 && $$(".st-tcard").length===0);
  click($('[data-act="outline-view"][data-v="thumbs"]')); await sleep(80);
  const cards=$$(".st-tcard");
  check("thumbnails render one card per question", cards.length===4, cards.length);
  check("the switch marks thumbnails as active",
    $('[data-act="outline-view"][data-v="thumbs"]').classList.contains("on"));
  check("rows are replaced by the thumbnail grid", $$(".st-qi").length===0 && $$(".st-tgrid").length===1);
  check("a thumbnail carries id, title and wording",
    !!cards[0].querySelector(".st-tcard-id") && cards[0].querySelector(".st-tcard-title").textContent==="Specialty screener" &&
    !!cards[0].querySelector(".st-tcard-stem"));
  check("a thumbnail shows a schematic of the answer area",
    !!cards[0].querySelector(".st-tcard-body .st-tb-opts") && $$(".st-tb-opt").length>=3,
    cards[0].querySelector(".st-tcard-body").innerHTML.slice(0,60));
  check("a choice thumbnail draws radio dots", $$(".st-tb-radio").length>=3);
  check("a rating thumbnail draws a scale", $$(".st-tb-cell").length>=5, $$(".st-tb-cell").length);
  check("an open-text thumbnail draws a text box", $$(".st-tb-text").length>=1);
  check("thumbnails keep the badge/type footer", !!cards[0].querySelector(".st-tcard-foot"));
  check("the view choice is remembered for next time",
    w.localStorage.getItem("beacon.studio.outline_view")==="thumbs",
    w.localStorage.getItem("beacon.studio.outline_view"));

  // selecting from a thumbnail still drives the editor
  click(cards[1]); await sleep(80);
  check("clicking a thumbnail selects that question",
    $$(".st-tcard")[1].classList.contains("on") && $("#f-id").value===saved1.questions[1].id,
    $("#f-id").value);
  click($('[data-act="outline-view"][data-v="list"]')); await sleep(80);
  check("switching back to list restores the rows", $$(".st-qi").length===4 && $$(".st-tcard").length===0);

  // ---------- adding and naming sections ----------
  const before=$$(".st-sec").length;
  click($(".st-outline-head [data-act=addsec]")); await sleep(80);
  check("the outline header always offers + Section", $$(".st-sec").length===before+1);
  const lastIn=$$(".st-sec-head input").pop();
  check("a new section is created as an editable, empty name",
    !!lastIn && lastIn.value==="" && !!lastIn.placeholder, lastIn&&lastIn.value);
  lastIn.value="Closing"; fire(lastIn,"input"); await sleep(80);
  check("the new section can be named", $$(".st-sec-head input").pop().value==="Closing");
  await sleep(1500);
  const saved2=JSON.parse(await get("/api/studio/study?slug="+slug)).cfg;
  check("the new section is saved with its name",
    saved2.sections.length===2 && saved2.sections[1].title==="Closing" &&
    saved2.sections[0].title==="",
    JSON.stringify(saved2.sections.map(x=>x.title)));
  check("questions can be moved into the new section via the Section menu",
    $$("#f-section option").map(o=>o.textContent).includes("Closing"),
    $$("#f-section option").map(o=>o.textContent).join(","));

  await req("POST","/api/studio/delete",JSON.stringify({slug:slug}));    // leave the DB as we found it

  check("no JS errors", errs.length===0, errs.join(" | "));
  console.log(fails? "\n"+fails+" CHECK(S) FAILED" : "\nall checks passed");
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
