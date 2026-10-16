/* jsdom check of the answer-option row controls: per-row delete button, position badges and the
   three ways of changing the sequence (drag the grip, the ▲ / ▼ buttons, ↑ / ↓ on a focused grip).
   Needs the server on :8000 and jsdom.
   node scripts/dom/studio_reorder_test.js */
let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (e) { ({ JSDOM } = require("/tmp/node_modules/jsdom")); }
const http=require("http"); const BASE=process.env.BASE||"http://127.0.0.1:8000";
function req(method,p,body){return new Promise((res,rej)=>{const u=new URL(BASE+p);const h={};if(body)h["Content-Type"]="application/json";
  const r=http.request(u,{method,headers:h},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>res({status:x.statusCode,body:d}));});r.on("error",rej);if(body)r.write(body);r.end();});}
const get=p=>req("GET",p).then(r=>r.body);
let fails=0; const check=(l,c,d="")=>{console.log((c?"PASS  ":">>>---FAIL  ")+l+(c?"":"  -> "+d)); if(!c)fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const cfg={sections:[{id:"S1",title:"Screener"}],questions:[
    {id:"Q1",section:"S1",type:"single_select",stem:"Pick one",options:[
      {code:1,label:"Alpha"},{code:2,label:"Beta"},{code:3,label:"Gamma"}]},
    {id:"Q2",section:"S1",type:"semantic_diff",stem:"Rate each",rows:[
      {code:"a",label:"Service",left:"Poor",right:"Great"},{code:"b",label:"Price",left:"Poor",right:"Great"}],
      scale:{min:1,max:7}}]};
  const slug=JSON.parse((await req("POST","/api/studio/save",JSON.stringify({title:"Reorder Test",cfg}))).body).slug;
  const saved=async()=>JSON.parse(await get("/api/studio/study?slug="+slug)).cfg;
  const dom=new JSDOM(await get("/studio/"),{url:BASE+"/studio/#"+slug,runScripts:"outside-only",pretendToBeVisual:true}); const w=dom.window;
  w.BEACON_PREVIEW_MODE=true; w.requestAnimationFrame=fn=>setTimeout(fn,0); w.scrollTo=()=>{}; w.Element.prototype.scrollIntoView=function(){};
  let saves=0;
  w.fetch=(u,o)=>{const U=new URL(u,BASE); if(U.pathname==="/api/studio/save")saves++;
    return req((o&&o.method)||"GET",U.pathname+U.search,o&&o.body).then(x=>({ok:x.status<400,status:x.status,json:()=>Promise.resolve(JSON.parse(x.body))}));};
  const errs=[]; w.addEventListener("error",e=>errs.push(e.message));
  for (const f of ["qlogic.js","survey.js","explainer.js","studio.js"]) w.eval(await get("/static/js/"+f));
  await sleep(700);
  // jsdom has no layout: give every list row a synthetic 40px band so the drop maths is exercised
  w.Element.prototype.getBoundingClientRect=function(){
    const row=this.closest&&this.closest(".st-item"), wrap=this.closest&&this.closest(".st-items");
    const nil={top:0,bottom:0,height:0,left:0,right:0,width:0,x:0,y:0};
    if(!row||!wrap) return nil;
    const rows=[...wrap.querySelectorAll(".st-item:not(.st-item-head)")]; const i=rows.indexOf(row);
    if(i<0) return nil;
    return {top:i*40,bottom:i*40+40,height:40,left:0,right:400,width:400,x:0,y:i*40};
  };
  const $=s=>w.document.querySelector(s), $$=s=>[...w.document.querySelectorAll(s)];
  const rows=()=>$$('.st-items[data-kind=opt] .st-item:not(.st-item-head)');
  const labels=()=>rows().map(r=>r.querySelector("[data-k=label]").value);
  const codes=()=>rows().map(r=>String(r.querySelector("[data-k=code]").value));
  const seqs=()=>rows().map(r=>r.querySelector(".st-seq").textContent.trim());
  const key=(el,k)=>el.dispatchEvent(new w.KeyboardEvent("keydown",{key:k,bubbles:true,cancelable:true}));
  // drag helper: start on the grip of row `from`, hover `y`, then drop there
  function drag(from,y){
    const grip=rows()[from].querySelector(".st-grip");
    const mk=(t)=>{const ev=new w.MouseEvent(t,{bubbles:true,cancelable:true,clientY:y});
      Object.defineProperty(ev,"dataTransfer",{value:{setData(){},setDragImage(){},effectAllowed:"",dropEffect:""}});return ev;};
    grip.dispatchEvent(mk("dragstart"));
    rows()[from].dispatchEvent(mk("dragover"));
    rows()[from].dispatchEvent(mk("drop"));
    grip.dispatchEvent(mk("dragend"));
  }

  check("studio workspace renders the options list", rows().length===3, rows().length);
  check("each option row shows a delete button",
    rows().every(r=>r.querySelector(".st-item-tools [data-act=it-del]")),
    rows().map(r=>!!r.querySelector("[data-act=it-del]")).join(","));
  check("each option row shows a drag grip", rows().every(r=>r.querySelector(".st-grip[draggable=true]")));
  check("positions are numbered in order", seqs().join(" ")==="1. 2. 3.", seqs().join(" "));
  check("option add/remove/move buttons all present",
    rows().every(r=>r.querySelector("[data-act=it-up]")&&r.querySelector("[data-act=it-down]")&&r.querySelector("[data-act=it-del]")));
  check("first row's move-up is disabled, last row's move-down is disabled",
    rows()[0].querySelector("[data-act=it-up]").disabled===true &&
    rows()[2].querySelector("[data-act=it-down]").disabled===true);
  check("labels start Alpha / Beta / Gamma", labels().join(",")==="Alpha,Beta,Gamma", labels().join(","));

  // --- ▲ / ▼ buttons swap with the neighbour and the codes travel with their label
  rows()[0].querySelector("[data-act=it-down]").click(); await sleep(30);
  check("▼ button swaps first two options", labels().join(",")==="Beta,Alpha,Gamma", labels().join(","));
  check("codes follow their own option (not renumbered)", codes().join(",")==="2,1,3", codes().join(","));
  check("position badges renumber after the swap", seqs().join(" ")==="1. 2. 3.", seqs().join(" "));
  rows()[2].querySelector("[data-act=it-up]").click(); await sleep(30);
  check("▲ button swaps last two back", labels().join(",")==="Beta,Gamma,Alpha", labels().join(","));

  // --- drag the grip to the top of the list
  drag(2,10); await sleep(30);                       // grab the last row, drop above row 1
  check("drag reorders an option to the top", labels().join(",")==="Alpha,Beta,Gamma", labels().join(","));
  check("drag keeps the codes attached", codes().join(",")==="1,2,3", codes().join(","));
  drag(0,150); await sleep(30);                      // grab the first row, drop after row 3
  check("drag moves an option to the bottom", labels().join(",")==="Beta,Gamma,Alpha", labels().join(","));
  check("no stray drag classes left behind", $$(".st-item.dragging,.st-item.drop-before").length===0);

  // --- keyboard: ↑ / ↓ on a focused grip
  rows()[0].querySelector(".st-grip").focus();
  key(rows()[0].querySelector(".st-grip"),"ArrowDown"); await sleep(30);
  check("↓ on a focused grip swaps with the next option", labels().join(",")==="Gamma,Beta,Alpha", labels().join(","));
  key(rows()[1].querySelector(".st-grip"),"ArrowUp"); await sleep(30);
  check("↑ on a focused grip swaps back", labels().join(",")==="Beta,Gamma,Alpha", labels().join(","));
  check("focus follows the moved row", w.document.activeElement===rows()[0].querySelector(".st-grip"));

  // --- delete removes exactly the row that was clicked
  const beta=rows().find(r=>r.querySelector("[data-k=label]").value==="Beta");
  beta.querySelector("[data-act=it-del]").click(); await sleep(30);
  check("delete button removes only that option",
    labels().join(",")==="Gamma,Alpha", labels().join(","));
  check("remaining positions renumber after a delete", seqs().join(" ")==="1. 2.", seqs().join(" "));

  // --- persists to the server
  await sleep(1600);
  const sv=(await saved()).questions[0].options.map(o=>o.label).join(",");
  check("new option order is saved to the server", sv==="Gamma,Alpha", sv);

  // --- pole rows (semantic differential) keep the header and the inputs on the same tracks
  $$(".st-qi")[1].click(); await sleep(40);
  const pwrap=$('.st-items[data-kind=row]');
  check("pole list marks itself so header + rows share one grid", !!pwrap && pwrap.classList.contains("has-poles"));
  const poles=[...pwrap.querySelectorAll(":scope > .st-item")];
  // the behaviour chips are an extra child that lives on grid line 2, so compare the main-line cells
  const mainCells=r=>[...r.children].filter(c=>!c.classList.contains("st-flags"));
  check("header and every pole row have the same number of main-line tracks",
    new Set([...poles.map(r=>mainCells(r).length)]).size===1 && mainCells(poles[0]).length===7,
    poles.map(r=>mainCells(r).length).join(","));
  check("behaviour chips sit on their own line under the label",
    poles.slice(1).every(r=>r.querySelector(":scope > .st-flags")) &&
    /\.st-flags\{grid-column:4\/-1/.test((await get("/static/css/studio.css")).replace(/\n/g,"")));
  check("pole rows expose left/right inputs, delete and reorder",
    poles.slice(1).every(r=>r.querySelector("[data-k=left]")&&r.querySelector("[data-k=right]")&&r.querySelector("[data-act=it-del]")));
  check("pole rows keep their ▲ / ▼ buttons", poles.slice(1).every(r=>r.querySelector("[data-act=it-up]")&&r.querySelector("[data-act=it-down]")));

  // --- the label keeps its width: the in-row pipe button is the icon-only variant
  $$(".st-qi")[0].click(); await sleep(40);
  check("in-row pipe button is icon-only so the label keeps its width",
    rows().every(r=>{ const b=r.querySelector(".st-with-pipe .st-pipe-btn"); return b && b.classList.contains("icon") && b.textContent.trim()==="\u2794"; }),
    rows().map(r=>r.querySelector(".st-pipe-btn").textContent.trim()).join("|"));
  check("compact pipe button still targets its own label input",
    rows().every((r,i)=>r.querySelector(".st-pipe-btn").getAttribute("data-pipe-for")==="f-opt-"+i));
  const pb=rows()[0].querySelector(".st-pipe-btn");
  pb.dispatchEvent(new w.MouseEvent("mousedown",{bubbles:true,cancelable:true})); pb.click(); await sleep(40);
  check("compact pipe button still opens the picker", !$("#st-pipe-pop").hidden);
  const pc=$("#st-pipe-pop [data-act=pipe-close]"); if(pc) pc.click(); await sleep(20);

  // --- the stylesheet keeps the row shrinkable (this is what used to clip the buttons away)
  const css=await get("/static/css/studio.css");
  check("row grid lets the label track shrink (no clipped buttons)",
    /\.st-item\{[^}]*grid-template-columns:[^}]*minmax\(0,1fr\)/.test(css.replace(/\n/g,"")));
  check("item tools are not hidden behind hover",
    !/\.st-item-tools\{[^}]*opacity:\.55/.test(css.replace(/\n/g,"")));

  await req("POST","/api/studio/delete",JSON.stringify({slug:slug}));    // leave the DB as we found it

  check("no JS errors", errs.length===0, errs.join(" | "));
  console.log(fails? "\n"+fails+" CHECK(S) FAILED" : "\nall checks passed");
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
