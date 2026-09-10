/* jsdom check of the Studio "Pipe in answer" picker. Needs a running server on :8000 and jsdom
   (npm i jsdom in /tmp or here):  node scripts/dom/pipe_picker_test.js */
const path=require("path");
let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (e) { ({ JSDOM } = require("/tmp/node_modules/jsdom")); }
const http=require("http"); const BASE=process.env.BASE||"http://127.0.0.1:8000"; const TK="token="+(process.env.TOKEN||"beacon-admin");
function req(method,p,body){return new Promise((res,rej)=>{const u=new URL(BASE+p);const h={};if(body)h["Content-Type"]="application/json";
  const r=http.request(u,{method,headers:h},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>res({status:x.statusCode,body:d}));});r.on("error",rej);if(body)r.write(body);r.end();});}
const get=p=>req("GET",p+(p.includes("?")?"&":"?")+TK).then(r=>r.body);
let fails=0; const check=(l,c,d="")=>{console.log((c?"PASS  ":"FAIL  ")+l+(c?"":"  -> "+d)); if(!c)fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const cfg={sections:[{id:"S1",title:"A"}],questions:[
    {id:"Q1",section:"S1",type:"single_select",stem:"Your specialty?",options:[{code:1,label:"Oncology"},{code:2,label:"Haematology"}]},
    {id:"Q2",section:"S1",type:"multi_select",stem:"Therapies used?",options:[{code:1,label:"Chemo"},{code:2,label:"IO"}]},
    {id:"Q3",section:"S1",type:"open_text",stem:"Tell us more"}],tpp:{},explainer_scenes:[]};
  const slug=JSON.parse((await req("POST","/api/studio/save?"+TK,JSON.stringify({title:"Pipe Picker Test",cfg}))).body).slug;
  const dom=new JSDOM(await get("/studio/"),{url:BASE+"/studio/?"+TK+"#"+slug,runScripts:"outside-only",pretendToBeVisual:true}); const w=dom.window;
  w.BEACON_PREVIEW_MODE=true; w.requestAnimationFrame=fn=>setTimeout(fn,0); w.scrollTo=()=>{};
  w.fetch=(u,o)=>req((o&&o.method)||"GET",new URL(u,BASE).pathname+new URL(u,BASE).search,o&&o.body).then(x=>({ok:x.status<400,status:x.status,json:()=>Promise.resolve(JSON.parse(x.body))}));
  const errs=[]; w.addEventListener("error",e=>errs.push(e.message));
  for (const f of ["qlogic.js","survey.js","explainer.js","studio.js"]) w.eval(await get("/static/js/"+f));
  await sleep(700);
  const $=s=>w.document.querySelector(s), $$=s=>[...w.document.querySelectorAll(s)];
  const fire=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true}));
  const mdown=el=>el.dispatchEvent(new w.MouseEvent("mousedown",{bubbles:true,cancelable:true}));

  w.Element.prototype.scrollIntoView=function(){};
  // open Q3 (has two earlier questions)
  $$(".st-qi")[2].click(); await sleep(50);
  check("Pipe button present on question text, help text", $$("[data-pipe-for=f-stem-rich]").length===1 && $$("[data-pipe-for=f-help-rich]").length===1);
  // put the caret in the middle of "Tell us more" (after "Tell ")
  const rich=$("#f-stem-rich"); rich.focus();
  const r=w.document.createRange(); r.setStart(rich.firstChild,5); r.collapse(true); const sel=w.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const btn=$("[data-pipe-for=f-stem-rich]"); mdown(btn); btn.click(); await sleep(50);
  const pop=$("#st-pipe-pop");
  check("picker opens, grouped by Q1 and Q2 only", !pop.hidden && $$(".st-pipe-q").length===2 && !pop.textContent.includes("Q3 "));
  check("plain-English items with live examples", pop.textContent.includes("Their answer (as text)") && /e\.g\. "Oncology"/.test(pop.textContent) && pop.textContent.includes("First option they ticked"));
  // search filters
  const srch=$(".st-pipe-search"); srch.value="therap"; fire(srch,"input"); await sleep(10);
  check("search hides non-matching questions", $$(".st-pipe-q").filter(d=>d.style.display!=="none").length===1);
  srch.value=""; fire(srch,"input");
  // click an item -> inserted at caret as chip
  $$(".st-pipe-item").find(b=>b.getAttribute("data-token")==="{Q1}").click(); await sleep(30);
  check("token inserted at the caret as a chip", rich.querySelector("span.pipe") && rich.querySelector("span.pipe").textContent==="{Q1}" && rich.textContent.startsWith("Tell {Q1}"), rich.textContent);
  check("picker closed after insert", pop.hidden);
  check("live preview resolves it ('Tell Oncology')", /Tell Oncology/.test($("#st-prev-body h2").textContent), $("#st-prev-body h2").textContent);
  // insert a fixed option label from Q2 at end
  const r2=w.document.createRange(); r2.selectNodeContents(rich); r2.collapse(false); sel.removeAllRanges(); sel.addRange(r2);
  mdown(btn); btn.click(); await sleep(30);
  $$(".st-pipe-item").find(b=>b.getAttribute("data-token")==="{Q2.opt:2}").click(); await sleep(30);
  check("second token appended", rich.querySelectorAll("span.pipe").length===2 && /IO/.test($("#st-prev-body h2").textContent));
  // option label pipe on a select question (Q2)
  $$(".st-qi")[1].click(); await sleep(100);
  check("pipe buttons beside each option label", $$("[data-pipe-for^=f-opt-]").length===2);
  const inp=$("#f-opt-0"); inp.focus(); inp.setSelectionRange(5,5);          // after "Chemo"
  const b0=$("[data-pipe-for=f-opt-0]"); mdown(b0); b0.click(); await sleep(30);
  check("picker for option shows only Q1", $$(".st-pipe-q").length===1);
  $$(".st-pipe-item").find(b=>b.getAttribute("data-token")==="{Q1}").click(); await sleep(30);
  check("token inserted into option label at caret", $("#f-opt-0").value==="Chemo{Q1}", $("#f-opt-0").value);
  check("preview option shows piped 'ChemoOncology'", /ChemoOncology/.test($("#st-prev-body").textContent));
  // re-open Q3; wait for autosave; check stored HTML is plain (no chips)
  $$(".st-qi")[2].click(); await sleep(100);
  check("re-opened editor shows existing tokens as chips", $$("#f-stem-rich span.pipe").length===2 && $("#f-stem-rich").textContent.includes("{Q2.opt:2}"));
  await sleep(1600);
  const saved=JSON.parse(await get("/api/studio/study?slug="+slug)).cfg;
  check("saved Q3 stem_html holds plain tokens, no chip markup", /Tell \{Q1\}/.test(saved.questions[2].stem_html) && !/class="pipe"/.test(saved.questions[2].stem_html) && saved.questions[2].stem.includes("{Q2.opt:2}"), saved.questions[2].stem_html);
  check("saved Q2 option label carries token", saved.questions[1].options[0].label==="Chemo{Q1}");
  check("no JS errors", errs.length===0, errs.join("; "));
  await req("POST","/api/studio/delete?"+TK,JSON.stringify({slug}));
  process.exit(fails?1:0);
})().catch(e=>{console.error("ERR",e);process.exit(1)});
