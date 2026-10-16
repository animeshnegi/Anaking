/* jsdom check of the dashboard Actions (Request E): Preview / Duplicate / Launch / Pause /
   Relaunch / Reminder / invite log, driving the real endpoints.  Needs the server on :8000.
   node scripts/dom/studio_actions_test.js */
let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (e) { ({ JSDOM } = require("/tmp/node_modules/jsdom")); }
const http=require("http"); const BASE=process.env.BASE||"http://127.0.0.1:8000";
function req(method,p,body){return new Promise((res,rej)=>{const u=new URL(BASE+p);const h={};if(body)h["Content-Type"]="application/json";
  const r=http.request(u,{method,headers:h},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>res({status:x.statusCode,body:d}));});r.on("error",rej);if(body)r.write(body);r.end();});}
const get=p=>req("GET",p).then(r=>r.body);
let fails=0; const check=(l,c,d="")=>{console.log((c?"PASS  ":"FAIL  ")+l+(c?"":"  -> "+d)); if(!c)fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const cfg={sections:[{id:"S1",title:"Screener"}],questions:[
    {id:"Q1",section:"S1",type:"single_select",stem:"Your specialty?",options:[{code:1,label:"Oncology"},{code:2,label:"Haematology"}]}],
    tpp:{},explainer_scenes:[]};
  const slug=JSON.parse((await req("POST","/api/studio/save",JSON.stringify({title:"Actions Test",cfg}))).body).slug;
  const card=()=>w.document.querySelector('.st-card[data-slug="'+slug+'"]');
  const btn=a=>card()&&card().querySelector('[data-act="'+a+'"]');
  const modal=()=>w.document.getElementById("st-modal");
  const posts=[];
  const dom=new JSDOM(await get("/studio/"),{url:BASE+"/studio/",runScripts:"outside-only",pretendToBeVisual:true});
  const w=dom.window;
  w.BEACON_PREVIEW_MODE=true; w.requestAnimationFrame=fn=>setTimeout(fn,0); w.scrollTo=()=>{}; w.Element.prototype.scrollIntoView=function(){};
  w.confirm=()=>true; w.prompt=()=>null;
  w.fetch=(u,o)=>{const U=new URL(u,BASE); const m=(o&&o.method)||"GET";
    if(m!=="GET")posts.push(U.pathname);
    return req(m,U.pathname+U.search,o&&o.body).then(x=>({ok:x.status<400,status:x.status,json:()=>Promise.resolve(JSON.parse(x.body))}));};
  const errs=[]; w.addEventListener("error",e=>errs.push(e.message));
  for (const f of ["qlogic.js","survey.js","explainer.js","studio.js"]) w.eval(await get("/static/js/"+f));
  await sleep(800);
  const $=s=>w.document.querySelector(s), $$=s=>[...w.document.querySelectorAll(s)];
  const fire=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true}));

  // ---------------------------------------------------------------- the card
  check("dashboard lists the draft card", !!card(), [...w.document.querySelectorAll(".st-card")].map(c=>c.getAttribute("data-slug")).join());
  check("Preview Survey is a link to the test link in a new window",
    !!btn("preview") && btn("preview").getAttribute("href")==="/survey/"+slug+"/test" && btn("preview").getAttribute("target")==="_blank");
  check("Duplicate Survey button on the card", !!btn("dup"));
  check("Launch Survey offered while the study is a draft", !!btn("launch") && /Launch Survey/.test(btn("launch").textContent));
  check("Pause / Relaunch hidden in draft", !btn("pause") && !btn("relaunch"));
  check("Reminder disabled with no recipients", !!btn("remind") && btn("remind").disabled===true && /2 left/.test(btn("remind").textContent));
  check("card says there is no invite list yet", /No invite list yet/.test(card().textContent));

  // ---------------------------------------------------------------- launch modal
  btn("launch").click(); await sleep(300);
  check("launch modal opens", !modal().hidden && /Launch Actions Test/.test(modal().textContent));
  check("modal shows the public link with a copy button",
    $("#lf-link") && $("#lf-link").value===BASE+"/survey/"+slug && !!$('[data-act="copy-public"]'));
  check("recipients textarea + subject + message + CSV picker",
    !!$("#lf-recipients") && !!$("#lf-subject") && !!$("#lf-message") && $('input[data-act="inv-csv"]').type==="file");
  check("no SMTP configured is explained, not hidden", /No SMTP server is configured/.test(modal().textContent));

  // CSV upload merges into the list (and skips an email/name header row)
  const file=new w.File(["email,name\nc@clinic.org,Dr C\nb@clinic.org\nnot-an-email\n"],"panel.csv",{type:"text/csv"});
  const csvInput=$('input[data-act="inv-csv"]');
  Object.defineProperty(csvInput,"files",{value:[file],configurable:true});
  fire(csvInput,"change"); await sleep(400);
  check("CSV fills the textarea, ignoring junk rows",
    $("#lf-recipients").value==="c@clinic.org, Dr C\nb@clinic.org", JSON.stringify($("#lf-recipients").value));
  check("CSV note reports how many addresses were read", /2 addresses read from the file/.test($("#lf-csv-note").textContent));

  $("#lf-recipients").value="a@clinic.org, Dr A\nb@clinic.org\na@clinic.org";     // paste + a duplicate
  $("#lf-subject").value="Two minutes of your time";
  $('[data-act="launch-go"]').click(); await sleep(700);
  check("Launch posts to the launch endpoint", posts.includes("/api/studio/launch"), posts.join());
  check("modal closes after launching", modal().hidden);
  check("study went live", JSON.parse(await get("/api/studio/study?slug="+slug)).status==="live");
  check("card now offers Pause instead of Launch", !!btn("pause") && !btn("launch") && /Pause Survey/.test(btn("pause").textContent));
  check("reminder is enabled once the list exists", btn("remind") && btn("remind").disabled===false);
  check("card shows the list size, that it was recorded and when it launched",
    /2 recipients/.test(card().textContent) && /recorded in the log/.test(card().textContent) &&
    /launched just now/.test(card().textContent), card().textContent);
  const launched=JSON.parse(await get("/api/studio/invites?study="+slug));
  check("both people were sent one personal link each", launched.outbox.length===2 &&
    launched.outbox.every(r=>r.link.includes("?rid=")) && launched.summary.recipients===2);
  check("the pasted list was deduped and the subject kept",
    launched.recipients.map(r=>r.email).join()==="a@clinic.org,b@clinic.org" &&
    launched.subject==="Two minutes of your time", JSON.stringify(launched.recipients.map(r=>r.email))+" / "+launched.subject);

  // ---------------------------------------------------------------- invite log
  const logBtn=card().querySelector('[data-act="outbox"]');
  check("card links to the invite log", !!logBtn);
  logBtn.click(); await sleep(300);
  check("invite log lists every send with its link",
    $$("#st-modal .st-tbl-out tbody tr").length===2 && !!$("#st-modal .st-link-in") &&
    $$("#st-modal .st-kpi").length===4);
  check("invite log offers the CSV download", !!$('#st-modal a[href*="invites.csv"]'));
  $('[data-act="modal-close"]').click(); await sleep(50);
  check("invite log closes", modal().hidden);

  // ---------------------------------------------------------------- reminder
  btn("remind").click(); await sleep(600);
  check("Reminder posts to the remind endpoint", posts.includes("/api/studio/remind"), posts.join());
  const after=JSON.parse(await get("/api/studio/invites?study="+slug));
  check("reminder recorded for both people, capped at two",
    after.reminders_sent===1 && after.outbox.filter(r=>r.kind==="reminder").length===2);
  check("button now reads one left", /1 left/.test(btn("remind").textContent), btn("remind").textContent);

  // ---------------------------------------------------------------- pause / relaunch
  btn("pause").click(); await sleep(500);
  check("Pause posts and the card flips to Relaunch",
    posts.includes("/api/studio/pause") && !!btn("relaunch") && !btn("pause"));
  check("paused study refuses a new start", (await req("POST","/api/start",JSON.stringify({study:slug}))).status===403);
  btn("relaunch").click(); await sleep(500);
  check("Relaunch puts it back live", (await req("POST","/api/start",JSON.stringify({study:slug}))).status===200 &&
    !!btn("pause") && !btn("relaunch"));

  // ---------------------------------------------------------------- duplicate
  btn("dup").click(); await sleep(600);
  check("Duplicate posts to the duplicate endpoint", posts.includes("/api/studio/duplicate"), posts.join());
  const titles=[...w.document.querySelectorAll(".st-card h3")].map(h=>h.textContent);
  check("a copy appears on the dashboard as a draft", titles.includes("Actions Test (copy)"), titles.join());
  check("toast confirms the copy", /Duplicated as \/actions-test-copy/.test($("#st-toast").textContent), $("#st-toast").textContent);

  check("no JS errors", errs.length===0, errs.join("; "));
  await req("POST","/api/studio/delete",JSON.stringify({slug}));
  await req("POST","/api/studio/delete",JSON.stringify({slug:slug+"-copy"}));
  process.exit(fails?1:0);
})().catch(e=>{console.error("ERR",e);process.exit(1)});
