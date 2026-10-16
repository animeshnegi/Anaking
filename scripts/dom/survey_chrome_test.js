/* jsdom check of the respondent-facing survey chrome: which section a question belongs to must
   never reach the respondent.  While a question is on screen the project details (brand, study,
   respondent code, timer) and the progress line are hidden; with the gamified feel on, a slim strip
   (ring, insight points, rank, voice and sound buttons) stays on top so the reward is visible.
   Needs the server on :8000 and jsdom.
   node scripts/dom/survey_chrome_test.js */
let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (e) { ({ JSDOM } = require("/tmp/node_modules/jsdom")); }
const http=require("http"); const BASE=process.env.BASE||"http://127.0.0.1:8000";
function req(method,p,body){return new Promise((res,rej)=>{const u=new URL(BASE+p);const h={};if(body)h["Content-Type"]="application/json";
  const r=http.request(u,{method,headers:h},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>res({status:x.statusCode,body:d}));});r.on("error",rej);if(body)r.write(body);r.end();});}
const get=p=>req("GET",p).then(r=>r.body);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0; const check=(l,c,d="")=>{console.log((c?"PASS  ":"FAIL  ")+l+(c?"":"  -> "+d)); if(!c)fails++;};

async function makeStudy(title){
  const cfg={sections:[{id:"S1",title:"Screeners"},{id:"S2",title:"Main section"}],questions:[
    {id:"Q1",section:"S1",type:"single_select",stem:"Your specialty?",
     options:[{code:1,label:"Oncology"},{code:2,label:"Haematology"}]},
    {id:"Q2",section:"S2",type:"single_select",stem:"Which therapies?",
     options:[{code:1,label:"Chemo"},{code:2,label:"IO"}]}],
    qc:{min_seconds:1}};
  const slug=JSON.parse((await req("POST","/api/studio/save",JSON.stringify({title,cfg}))).body).slug;
  await req("POST","/api/studio/status",JSON.stringify({slug,status:"live"}));
  await req("POST","/admin/reset?study="+slug+"&scope=all");
  return slug;
}

async function openSurvey(slug){
  const url="/survey/"+slug+"/test";
  const dom=new JSDOM(await get(url),{url:BASE+url,runScripts:"outside-only",pretendToBeVisual:true});
  const w=dom.window; w.scrollTo=()=>{}; w.requestAnimationFrame=fn=>setTimeout(fn,0);
  w.Element.prototype.scrollIntoView=function(){};
  w.fetch=(u,o)=>{const U=new URL(u,BASE);
    return req((o&&o.method)||"GET",U.pathname+U.search,o&&o.body).then(x=>({ok:x.status<400,status:x.status,json:()=>Promise.resolve(JSON.parse(x.body))}));};
  w.STUDY={slug:slug};                                  // the page's inline <script> does not run here
  const errs=[]; w.addEventListener("error",e=>errs.push(e.message));
  for (const f of ["qlogic.js","explainer.js","survey.js"]) w.eval(await get("/static/js/"+f));
  await sleep(900);
  return { w, $:s=>w.document.querySelector(s), $$:s=>[...w.document.querySelectorAll(s)], errs };
}

(async()=>{
  const css=(await get("/static/css/survey.css")).replace(/\n/g,"");
  const slug=await makeStudy("Chrome Test");
  const S=await openSurvey(slug);
  const d=S.w.document, body=S.w.document.body;

  // ---------- welcome screen: project information is on show ----------
  check("welcome screen is up", !!S.$("#welcome") && !!S.$("#start-btn"));
  check("welcome shows the project bar (brand + study name)",
    !!S.$(".topbar") && /PROJECT BEACON/.test(S.$(".topbar").textContent));
  check("body is not in the answering state on the welcome screen",
    !body.classList.contains("answering"));
  check("project bar is not hidden on the welcome screen",
    !/body\.answering \.topbar/.test(css) || /body\.answering \.topbar,body\.answering \.progress-wrap\{display:none\}/.test(css));

  // ---------- answering: everything is hidden ----------
  S.$("#start-btn").click(); await sleep(500);
  const card=S.$("#app .card") || S.$("#app");
  check("question 1 is rendered", /Q1|specialty/i.test((card||{}).textContent||""),
    ((card||{}).textContent||"").slice(0,60));
  check("body is in the answering state", body.classList.contains("answering"));
  check("no section chip on the question card", S.$$(".section-tag").length===0,
    S.$$(".section-tag").map(n=>n.textContent).join(","));
  check("no internal section wording on the card",
    !/\bScreeners?\b|\bMain section\b/i.test((card||{}).textContent||""),
    ((card||{}).textContent||"").slice(0,90));
  check("progress strip carries no text at all", !S.$("#progress-label"),
    (S.$("#progress-label")||{}).textContent);
  check("no step counter anywhere on the page",
    !/Step\s+\d+\s+of\s+\d+/i.test(d.body.textContent), "found a step counter");
  check("progress bar itself is still there and fills",
    !!S.$("#progress-fill") && S.$("#progress-fill").style.width !== "");
  check("the between-section popup is gone from the page", !S.$("#celebrate"));

  // ---------- the stylesheet actually does the hiding ----------
  check("css hides the project bar while answering",
    /body\.answering \.topbar[^{]*\{display:none\}/.test(css), css.slice(0,0));
  check("css hides the progress strip while answering",
    /body\.answering \.progress-wrap/.test(css));
  check("css moves the test-mode reminder to the top when the bar is gone",
    /body\.answering\.testmode::before\{top:0\}/.test(css));
  check("css keeps the gamified strip on top while answering",
    /body\.answering\.gamified \.topbar\{display:flex/.test(css));
  check("css hides brand and study name inside that strip",
    /body\.answering\.gamified \.topbar \.brand,body\.answering\.gamified \.topbar \.meta\{display:none\}/.test(css));

  // ---------- cross a section boundary: sections run straight into each other ----------
  const next=[...S.$$("button")].find(b=>/Next/.test(b.textContent));
  const pick=S.$$("#app .opt, #app label.opt, #app .opt-row");
  if (pick.length) pick[0].click();
  await sleep(120);
  const ptsBefore=Number((S.$("#points")||{}).textContent||0);
  if (next) next.click();                            // Q1 is the last question of section S1
  await sleep(400);
  check("crossing a section shows no popup or overlay",
    !S.$("#celebrate") && S.$$(".overlay:not([hidden])").length===0);
  check("the next question is on screen immediately",
    /therapies/i.test(S.$("#app").textContent), S.$("#app").textContent.slice(0,60));
  check("the section bonus is still awarded to the HUD",
    Number((S.$("#points")||{}).textContent||0) > ptsBefore,
    ptsBefore + " -> " + (S.$("#points")||{}).textContent);
  check("the bonus floats up as a +N next to the counter", !!S.$(".pts-float") && /^\+\d+$/.test(S.$(".pts-float").textContent));
  check("second question shows no section chip either", S.$$(".section-tag").length===0);
  check("still in the answering state on question 2", body.classList.contains("answering"));

  // ---------- closing screen: project information comes back ----------
  const pick2=S.$$("#app .opt, #app label.opt, #app .opt-row");
  if (pick2.length) pick2[0].click();
  await sleep(120);
  const submit=[...S.$$("button")].find(b=>/Submit/.test(b.textContent));
  if (submit) submit.click();
  await sleep(1800);
  check("survey reached the closing screen", /Thank you|recorded/i.test(S.$("#app").textContent),
    S.$("#app").textContent.slice(0,80));
  check("body leaves the answering state on the closing screen",
    !body.classList.contains("answering"));
  check("project bar is back for the closing screen",
    !!S.$(".topbar") && /PROJECT BEACON/.test(S.$(".topbar").textContent));

  // ---------- screening out also ends the answering state ----------
  // the seeded BEACON study screens out on Q1 = "Radiation oncology" (code 5); the live
  // study's screening switch may be parked off by its author, so run this on a clone
  // whose Q1 switch is removed - the option marks then fire as shipped
  const bcfg=JSON.parse(await get("/api/studio/study?slug=beacon")).cfg;
  const bq1=(bcfg.questions||[]).find(q=>q.id==="Q1"); if (bq1) delete bq1.screening;
  const bslug=JSON.parse((await req("POST","/api/studio/save",JSON.stringify({title:"Chrome Beacon Clone",cfg:bcfg}))).body).slug;
  await req("POST","/api/studio/status",JSON.stringify({slug:bslug,status:"live"}));
  const S2=await openSurvey(bslug);
  S2.$("#start-btn").click(); await sleep(600);
  const body2=S2.w.document.body;
  check("beacon run: answering while on a question", body2.classList.contains("answering"));
  const skip=[...S2.$$("#app .opt")].find(o=>/Radiation oncology/i.test(o.textContent));
  check("the screening question offers a screen-out answer", !!skip);
  if (skip) {
    skip.click(); await sleep(120);
    const nx=[...S2.$$("button")].find(b=>/Next/.test(b.textContent));
    if (nx) nx.click();
    await sleep(600);
    check("screen-out screen is shown", /End of survey/i.test(S2.$("#app").textContent),
      S2.$("#app").textContent.slice(0,70));
    check("body leaves the answering state when screened out",
      !body2.classList.contains("answering"));
  }

  await req("POST","/api/studio/delete",JSON.stringify({slug:slug}));    // leave the DB as we found it
  await req("POST","/api/studio/delete",JSON.stringify({slug:bslug}));

  check("no JS errors", S.errs.length===0, S.errs.join(" | "));
  console.log(fails? "\n"+fails+" CHECK(S) FAILED" : "\nall checks passed");
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
