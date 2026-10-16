/* jsdom check of the respondent-facing conjoint: an experiment authored and generated in the
   Studio must render its own attributes, levels, images and "none" wording - and a
   group-inclusion attribute must simply be absent from the tasks it is hidden in.
   Needs the server on :8000 and jsdom.
   node scripts/dom/survey_conjoint_test.js */
let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (e) { ({ JSDOM } = require("/tmp/node_modules/jsdom")); }
const http=require("http"); const BASE=process.env.BASE||"http://127.0.0.1:8000";
function req(method,p,body){return new Promise((res,rej)=>{const u=new URL(BASE+p);const h={};if(body)h["Content-Type"]="application/json";
  const r=http.request(u,{method,headers:h},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>res({status:x.statusCode,body:d}));});r.on("error",rej);if(body)r.write(body);r.end();});}
const get=p=>req("GET",p).then(r=>r.body);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0; const check=(l,c,d="")=>{console.log((c?"PASS  ":"FAIL  ")+l+(c?"":"  -> "+d)); if(!c)fails++;};
const POST=(p,b)=>req("POST",p,typeof b==="string"?b:JSON.stringify(b));

// a study whose conjoint design has the exact shape the Studio saves after "Generate design":
// levels positionally aligned to attributes, null where a group-inclusion attribute is hidden.
async function makeStudy(title, {hasOptOut, noneLabel, images}){
  const attrs=[{id:"A1",label:"Colour",levels:["Red","Blue"]},
               {id:"A2",label:"Price",levels:["$100","$200","$300"],group_inclusion:true}];
  const design=await POST("/api/studio/make_conjoint",
    {attributes:attrs,n_tasks:6,n_alts:2,seed:7}).then(r=>JSON.parse(r.body));
  const ids=design.attributes.map(a=>a.id);
  const imgs=images?{"A1":["/static/img/red.png","/static/img/blue.png"]}:{};
  const cfg={sections:[{id:"S1",title:"Screeners"}],questions:[
    {id:"Q1",section:"S1",type:"single_select",stem:"Your specialty?",
     options:[{code:1,label:"Oncology"},{code:2,label:"Haematology"}]},
    {id:"Q2",section:"S1",type:"choice_task",stem:"Which would you choose?",
     vignette:"62-year-old with advanced disease",conjoint:{title:"Trade-off"}}],
    conjoint:{attributes:design.attributes.map(a=>Object.assign({},a,{images:imgs[a.id]||[]})),
      tasks:design.tasks.map(task=>task.map((p,k)=>({alt_id:k+1,
        levels:ids.map(id=>p[id]===undefined||p[id]===null?null:p[id])}))),
      levels:design.levels,n_tasks:design.n_tasks,n_alts:design.n_alts,
      groups:design.groups,has_opt_out:hasOptOut,none_label:noneLabel},
    conjoint_min_dwell:0,qc:{min_seconds:0}};
  const slug=JSON.parse((await POST("/api/studio/save",{title:title,cfg:cfg})).body).slug;
  await POST("/api/studio/status",{slug:slug,status:"live"});
  await req("POST","/admin/reset?study="+slug+"&scope=all");
  return {slug:slug,design:design,ids:ids};
}

async function openSurvey(slug){
  const url="/survey/"+slug+"/test";
  const dom=new JSDOM(await get(url),{url:BASE+url,runScripts:"outside-only",pretendToBeVisual:true});
  const w=dom.window; w.scrollTo=()=>{}; w.requestAnimationFrame=fn=>setTimeout(fn,0);
  w.Element.prototype.scrollIntoView=function(){};
  w.fetch=(u,o)=>{const U=new URL(u,BASE);
    return req((o&&o.method)||"GET",U.pathname+U.search,o&&o.body).then(x=>({ok:x.status<400,status:x.status,json:()=>Promise.resolve(JSON.parse(x.body))}));};
  w.STUDY={slug:slug};
  const errs=[]; w.addEventListener("error",e=>errs.push(e.message));
  for (const f of ["qlogic.js","explainer.js","survey.js"]) w.eval(await get("/static/js/"+f));
  await sleep(900);
  return {w:w,$:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],errs:errs};
}

// the first task is drawn in a per-respondent random order, so collect what each of the
// six slots actually showed and then match the slots back to the design.
async function walkTasks(S){
  const slots=[];
  for (let guard=0; guard<12; guard++) {
    const cards=S.$$(".alt-cards .alt-card");
    if (!cards.length) break;
    slots.push({cards:cards.map(c=>[...c.querySelectorAll(".alt-row")].map(r=>({
      label:(r.querySelector(".lbl")||{}).textContent,
      text:(r.querySelector(".txt")||{}).textContent||"",
      img:!!r.querySelector("img.alt-level-img")})),),
      optout:((S.$(".optout-card")||{}).textContent||"")});
    S.$$(".alt-cards .alt-card")[0].click(); await sleep(60);
    S.$(".nav .btn.primary").click(); await sleep(350);
  }
  return slots;
}

(async()=>{
  // ============ 1. a group-inclusion attribute is hidden in exactly the tasks it is not asked in
  const A=await makeStudy("Conjoint Render",{hasOptOut:true,noneLabel:"None of these",images:true});
  let S=await openSurvey(A.slug);
  check("the welcome screen is up", !!S.$("#start-btn"));
  S.$("#start-btn").click(); await sleep(500);
  S.$$(".opts .opt")[0].click(); await sleep(120);
  S.$(".nav .btn.primary").click(); await sleep(400);
  check("the choice task is rendered", !!S.$(".alt-cards"), (S.$("#app")||{}).textContent.slice(0,60));
  check("it is called a choice task and counted", /Choice task 1 of 6/.test((S.$(".task-count")||{}).textContent||""),
    (S.$(".task-count")||{}).textContent);
  check("the patient vignette is shown", /62-year-old/.test((S.$(".vignette")||{}).textContent||""),
    (S.$(".vignette")||{}).textContent);
  check("two alternatives are offered", S.$$(".alt-cards .alt-card").length===2);
  check("the opt-out card keeps the authored wording",
    ((S.$(".optout-card")||{}).textContent||"").includes("None of these"),
    (S.$(".optout-card")||{}).textContent);

  // finish the walk on the same page, then match every slot back to a design task.
  // Both the task order and the left/right position of the alternatives are drawn per
  // respondent, so a slot is identified by the *set* of alternative contents it shows.
  const slots=await walkTasks(S);
  check("every set was shown once", slots.length===6, slots.length);
  check("every set offers the opt-out card", slots.every(x=>x.optout.includes("None of these")));

  const sig=rows=>rows.filter(r=>r.label).map(r=>r.label+"="+r.text.slice(r.label.length).trim())
    .sort().join(" | ");
  const want=function(task){
    return task.map(function(p){
      const out=["Colour="+A.design.levels.A1[p.A1]];
      if (p.A2!==null) out.push("Price="+A.design.levels.A2[p.A2]);
      return out.sort().join(" | ");
    }).sort();
  };
  const left=A.design.tasks.map(function(t,i){return {i:i,t:t};});
  const unmatched=[];
  slots.forEach(function(got){
    const cards=got.cards.map(sig).sort();
    const at=left.findIndex(function(entry){
      const w=want(entry.t);
      return w.length===cards.length && w.every(function(x,i){return x===cards[i];});
    });
    if (at<0) { unmatched.push(cards); return; }
    got.task=left.splice(at,1)[0];
  });
  check("every slot matches exactly one design task (labels, levels and masking)",
    unmatched.length===0 && left.length===0, JSON.stringify(unmatched));
  const matched=slots.filter(g=>g.task);
  check("the design's task order is randomised per respondent, not fixed",
    matched.some((g,i)=>g.task.i!==i), matched.map(g=>g.task.i).join(","));
  check("each alternative shows one row per asked attribute",
    matched.every(g=>g.cards.every((rows,ci)=>rows.filter(r=>r.label).length===
      (g.task.t[ci].A2===null?1:2))), JSON.stringify(matched.map(g=>g.task.t)));
  check("a hidden group-inclusion attribute is simply absent",
    matched.filter(g=>g.task.t[0].A2===null).every(g=>!g.cards[0].some(r=>r.label==="Price")) &&
    matched.some(g=>g.task.t[0].A2===null) && matched.some(g=>g.task.t[0].A2!==null));
  check("the same attribute is asked, with its own levels, in the other sets",
    matched.filter(g=>g.task.t[0].A2!==null).every(g=>g.cards[0].some(r=>r.label==="Price" && /\$\d00/.test(r.text))));
  check("rows carry the authored attribute labels",
    matched.every(g=>g.cards.every(rows=>rows.every(r=>["Colour","Price"].includes(r.label)))));
  check("a level image is rendered next to the level it belongs to",
    matched.every(g=>g.cards.every(rows=>rows.filter(r=>r.label).every(r=>r.img===(r.label==="Colour")))));
  check("the survey reported no JS errors", S.errs.length===0, S.errs.join(" | "));

  // ============ 2. Allow "none" = off removes the opt-out card
  const B=await makeStudy("Conjoint NoNone",{hasOptOut:false,noneLabel:"None of these"});
  S=await openSurvey(B.slug);
  S.$("#start-btn").click(); await sleep(500);
  S.$$(".opts .opt")[0].click(); await sleep(120);
  S.$(".nav .btn.primary").click(); await sleep(400);
  check("with Allow \u201Cnone\u201D off there is no opt-out card", !S.$(".optout-card"));
  check("but the alternatives are still there", S.$$(".alt-cards .alt-card").length===2);
  S.$$(".alt-cards .alt-card")[0].click(); await sleep(60);
  S.$(".nav .btn.primary").click(); await sleep(300);
  check("an alternative can be picked and the survey moves on", !/Choose one|error/i.test((S.$("#err")||{}).textContent||""),
    (S.$("#err")||{}).textContent);
  check("picking a card with Allow \u201Cnone\u201D off raises no JS error", S.errs.length===0, S.errs.join(" | "));

  await POST("/api/studio/delete",{slug:A.slug});
  await POST("/api/studio/delete",{slug:B.slug});
  console.log(fails? "\n"+fails+" CHECK(S) FAILED" : "\nall checks passed");
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
