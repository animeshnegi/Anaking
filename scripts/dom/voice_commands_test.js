/* jsdom check of the voice-command answering mode plus the pure command parser.
   Voice answering runs on the browser's own Web Speech API (free to deploy); in jsdom
   we shim a fake webkitSpeechRecognition and feed it utterances, exactly as the
   microphone would. Respondents must always keep the manual route too.
   Needs the server on :8000 and jsdom.
   node scripts/dom/voice_commands_test.js */
let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (e) { ({ JSDOM } = require("/tmp/node_modules/jsdom")); }
const http=require("http"); const BASE=process.env.BASE||"http://127.0.0.1:8000";
function req(method,p,body){return new Promise((res,rej)=>{const u=new URL(BASE+p);const h={};if(body)h["Content-Type"]="application/json";
  const r=http.request(u,{method,headers:h},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>res({status:x.statusCode,body:d}));});r.on("error",rej);if(body)r.write(body);r.end();});}
const get=p=>req("GET",p).then(r=>r.body);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0; const check=(l,c,d="")=>{console.log((c?"PASS  ":"FAIL  ")+l+(c?"":"  -> "+d)); if(!c)fails++;};

/* ---------------- 1. pure parser (no DOM, no microphone) ---------------- */
function parserChecks(){
  global.window={};
  require("../../static/js/voice.js");
  const B=global.window.BeaconVoice;
  const ctx={options:[{code:"1",label:"Chemotherapy"},{code:"2",label:"Immunotherapy"},
    {code:"3",label:"Targeted therapy"},{code:"98",label:"None of these",exclusive:true}],multi:true};
  const run=(t)=>B.parseCommand(t,ctx).map(a=>a.act==="pick"?a.code:a.act).join(",");
  check("parser: 'next' navigates", run("next")==="next");
  check("parser: 'option 2' picks by number", run("option 2")==="2");
  check("parser: bare number picks", run("2")==="2");
  check("parser: ordinal picks", run("second")==="2" && run("the second one")==="2");
  check("parser: spoken number picks", run("three")==="3");
  check("parser: label match picks", run("targeted therapy")==="3");
  check("parser: fuzzy prefix picks", run("immuno")==="2");
  check("parser: 'and' joins several picks", run("chemotherapy and targeted therapy")==="1,3");
  check("parser: mixed number + label join", run("option 1 and immunotherapy")==="1,2");
  check("parser: 'none of these' hits the exclusive option", run("none of these")==="98");
  check("parser: 'back' and 'clear'", run("back")==="back" && run("clear")==="clear");
  check("parser: out-of-range number is unknown", B.parseCommand("option 9",ctx)[0].act==="unknown");
  check("parser: gibberish is unknown", B.parseCommand("blorp",ctx)[0].act==="unknown");
  check("parser: unsupported flag when no SpeechRecognition", B.supported()===false);
}

/* ---------------- 2. live survey integration ---------------- */
async function makeStudy(title,gamify){
  const cfg={sections:[{id:"S1",title:"Screeners"},{id:"S2",title:"Main section"}],questions:[
    {id:"Q1",section:"S1",type:"single_select",stem:"Your specialty?",
     options:[{code:1,label:"Oncology"},{code:2,label:"Haematology"},{code:98,label:"None of these",exclusive:true}]},
    {id:"Q2",section:"S2",type:"multi_select",stem:"Which therapies?",
     options:[{code:1,label:"Chemotherapy"},{code:2,label:"Immunotherapy"},{code:3,label:"Targeted therapy"}]}],
    qc:{min_seconds:1}};
  if(gamify===false) cfg.gamify=false;
  const slug=JSON.parse((await req("POST","/api/studio/save",JSON.stringify({title,cfg}))).body).slug;
  await req("POST","/api/studio/status",JSON.stringify({slug,status:"live"}));
  await req("POST","/admin/reset?study="+slug+"&scope=all");
  return slug;
}

// Fake Web Speech API: captures the instance so the test can "speak" into it.
function FakeSR(){ FakeSR.last=this; this.onresult=null; this.onend=null; this.onerror=null; this.starts=0; }
FakeSR.prototype.start=function(){ this.starts++; };
FakeSR.prototype.stop=function(){ if(this.onend) this.onend(); };
function say(text){
  const rec=FakeSR.last; if(!rec||!rec.onresult) throw new Error("recognition not started");
  rec.onresult({resultIndex:0,results:[{isFinal:true,length:1,0:{transcript:text}}]});
}

// what a browser keeps for this survey (the page saves its position on unload; fire that here)
function storageOf(S){S.w.dispatchEvent(new S.w.Event("beforeunload"));const ls=S.w.localStorage,o={};for(let i=0;i<ls.length;i++){const k=ls.key(i);o[k]=ls.getItem(k);}return o;}

async function openSurvey(slug,withVoice,seed){
  const url="/survey/"+slug+"/test";
  const dom=new JSDOM(await get(url),{url:BASE+url,runScripts:"outside-only",pretendToBeVisual:true});
  const w=dom.window; w.scrollTo=()=>{}; w.requestAnimationFrame=fn=>setTimeout(fn,0);
  w.Element.prototype.scrollIntoView=function(){};
  w.fetch=(u,o)=>{const U=new URL(u,BASE);
    return req((o&&o.method)||"GET",U.pathname+U.search,o&&o.body).then(x=>({ok:x.status<400,status:x.status,json:()=>Promise.resolve(JSON.parse(x.body))}));};
  w.STUDY={slug:slug};
  if(seed) for(const k of Object.keys(seed)) w.localStorage.setItem(k,seed[k]);   // a browser that already has a saved session
  if(withVoice) w.webkitSpeechRecognition=FakeSR;
  for (const f of ["qlogic.js","voice.js","explainer.js","survey.js"]) w.eval(await get("/static/js/"+f));
  await sleep(900);
  return { w, $:s=>w.document.querySelector(s), $$:s=>[...w.document.querySelectorAll(s)] };
}

(async()=>{
  parserChecks();

  const slug=await makeStudy("Voice Test");
  const S=await openSurvey(slug,true);

  // welcome screen offers the voice-vs-manual choice
  check("welcome screen is up", !!S.$("#welcome") && !!S.$("#start-btn"));
  check("voice-choice picker is offered when speech is supported",
    !!S.$("#voice-choice") && S.$("#voice-choice").hidden===false);
  check("voice picker defaults to manual", S.$('input[name="voice-pref"]:checked').value==="manual");
  check("mic button is visible in the HUD", !!S.$("#voice-btn") && S.$("#voice-btn").hidden===false);
  check("welcome names the option 'Answer by voice'",
    /Answer by voice/.test(S.$('input[name="voice-pref"][value="voice"]').closest("label").textContent));
  check("the voice option is enabled where speech recognition exists", S.$('input[name="voice-pref"][value="voice"]').disabled===false);
  check("the voice option explains that it is free", /free/i.test(S.$(".voice-note").textContent));

  // pick voice mode and start
  S.$('input[name="voice-pref"][value="voice"]').click();
  S.$("#start-btn").click(); await sleep(600);
  check("survey starts in voice mode (voice bar shown)", !!S.$(".voice-bar") && S.$(".voice-bar").hidden!==true);
  check("mic button shows the on state", S.$("#voice-btn").classList.contains("on"));
  check("recognition started", FakeSR.last && FakeSR.last.starts>=1);

  // Q1 is on screen - answer purely by voice
  check("Q1 on screen", /specialty/i.test(S.$("#app").textContent));
  say("option 2"); await sleep(250);
  const q1=Array.from(S.$$("#app .opt")).map(o=>({code:o.dataset.code,on:o.querySelector("input").checked}));
  check("voice 'option 2' selected Haematology",
    q1.some(o=>o.code==="2"&&o.on) && q1.filter(o=>o.on).length===1, JSON.stringify(q1));
  check("selection fires the bull's-eye hit animation",
    S.$('#app .opt[data-code="2"]').classList.contains("hit"));
  check("tapping still works alongside voice (manual never blocked)",
    (S.$('#app .opt[data-code="1"] input').click(), S.$('#app .opt[data-code="1"] input').checked)===true);

  // 'next' advances
  say("next"); await sleep(500);
  check("voice 'next' advances to Q2", /therapies/i.test(S.$("#app").textContent));

  // multi-select: several answers in one breath, then clear, then pick again
  say("chemotherapy and targeted therapy"); await sleep(250);
  let picked=S.$$("#app .opt input:checked").map(i=>i.value);
  check("one utterance selects two options", picked.includes("1")&&picked.includes("3")&&picked.length===2, picked.join(","));
  say("clear"); await sleep(250);
  check("voice 'clear' unchecks everything", S.$$("#app .opt input:checked").length===0);
  say("immuno"); await sleep(250);
  check("fuzzy label 'immuno' picks Immunotherapy", S.$$("#app .opt input:checked").map(i=>i.value).join(",")==="2");
  say("next"); await sleep(700);

  // both questions answered -> thank-you screen with the target finish
  check("survey completes", /thank/i.test(S.$("#app").textContent));
  check("completion shows the bull's-eye target", !!S.$(".done-target svg"));

  // ---------- no speech support: the option stays visible (disabled, with the reason); tapping works ----------
  const S2=await openSurvey(slug,false);
  const vr2=S2.$('input[name="voice-pref"][value="voice"]');
  check("without speech support the voice option is still listed",
    !!S2.$("#voice-choice") && S2.$("#voice-choice").hidden===false);
  check("without speech support the voice option is disabled", !!vr2 && vr2.disabled===true);
  check("without speech support the option says why", /Not available in this browser/.test(S2.$(".voice-note").textContent));
  check("without speech support the mic button stays hidden", S2.$("#voice-btn").hidden===true);
  S2.$("#start-btn").click(); await sleep(500);
  check("manual flow still starts without speech support", /specialty/i.test(S2.$("#app").textContent));

  // ---------- microphone trouble is reported, never a silent "Listening..." ----------
  const S5=await openSurvey(slug,true);
  S5.$('input[name="voice-pref"][value="voice"]').click();
  S5.$("#start-btn").click(); await sleep(400);
  const B5=S5.w.document.body;
  check("voice mode is on, mic reads pressed", B5.classList.contains("voice-on") && S5.$("#voice-btn").getAttribute("aria-pressed")==="true");
  check("the voice bar carries a Stop button", !!S5.$(".vb-stop"));
  const startsBefore=FakeSR.last.starts;
  FakeSR.last.onerror({error:"not-allowed"}); FakeSR.last.onend();     // Chrome reports the block, then ends the session
  await sleep(150);
  check("a blocked microphone switches voice off", !B5.classList.contains("voice-on") && S5.$("#voice-btn").getAttribute("aria-pressed")==="false");
  check("the coach says the microphone is blocked",
    /Microphone access is blocked/.test(S5.$(".coach-msg").textContent), S5.$(".coach-msg").textContent);
  check("the voice bar is hidden after a block", S5.$(".voice-bar").hidden===true);
  check("no restart loop after a block", FakeSR.last.starts===startsBefore, FakeSR.last.starts+" vs "+startsBefore);
  S5.$("#voice-btn").click(); await sleep(150);
  check("the mic button turns voice back on", B5.classList.contains("voice-on") && FakeSR.last.starts===startsBefore+1);
  S5.$(".vb-stop").click(); await sleep(150);
  check("Stop switches voice off and hides the bar", !B5.classList.contains("voice-on") && S5.$(".voice-bar").hidden===true);
  check("Stop says taps still work", /Voice answering is off/.test(S5.$(".coach-msg").textContent));

  // ---------- a silent microphone (sessions end without any audio) gives up with a message ----------
  const S6=await openSurvey(slug,true);
  S6.$('input[name="voice-pref"][value="voice"]').click();
  S6.$("#start-btn").click(); await sleep(300);
  for (let i=0;i<3;i++) FakeSR.last.onend();                          // three sessions that never hear audio
  check("a silent microphone switches voice off after a few empty sessions", !S6.w.document.body.classList.contains("voice-on"));
  check("the coach says the microphone cannot be heard",
    /Can\u2019t hear the microphone/.test(S6.$(".coach-msg").textContent), S6.$(".coach-msg").textContent);

  // ---------- a returning visitor is offered the choice again until they have answered something ----------
  const slugBack=await makeStudy("Voice Test Return");
  const R1=await openSurvey(slugBack,true);                              // first visit: welcome, session saved
  check("first visit shows the welcome", !!R1.$("#start-btn"));
  const R2=await openSurvey(slugBack,true,storageOf(R1));                // came back before answering anything
  check("a returning visitor who has answered nothing sees the welcome again", !!R2.$("#start-btn") && !!R2.$("#voice-choice"));
  check("the returning visitor is offered the voice option again",
    !!R2.$('input[name="voice-pref"][value="voice"]') && R2.$('input[name="voice-pref"][value="voice"]').disabled===false);
  R2.$('input[name="voice-pref"][value="voice"]').click();
  R2.$("#start-btn").click(); await sleep(500);
  check("the same session carries on from the welcome into Q1", /specialty/i.test(R2.$("#app").textContent));
  R2.$('#app .opt[data-code="1"] input').click(); await sleep(250);
  R2.$(".nav .btn.primary").click(); await sleep(900);                   // Q1 answered and saved -> Q2
  const R3=await openSurvey(slugBack,true,storageOf(R2));                // came back after answering
  check("a returning visitor mid-survey resumes at the next question, not the welcome",
    !R3.$("#start-btn") && /therapies/i.test(R3.$("#app").textContent), R3.$("#app").textContent.slice(0,80));

  // ---------- gamification switch ----------
  const slugFlat=await makeStudy("Voice Test Flat",false);
  const S3=await openSurvey(slugFlat,true);
  S3.$("#start-btn").click(); await sleep(500);
  check("gamify=false hides the HUD (points ring)", S3.$("#hud").hidden===true);
  check("gamify=false leaves the body un-gamified", !S3.w.document.body.classList.contains("gamified"));
  check("progress bar itself stays with gamify off", !!S3.$("#progress-wrap"));
  const slugGame=await makeStudy("Voice Test Game");
  const S4=await openSurvey(slugGame,true);
  S4.$("#start-btn").click(); await sleep(500);
  check("gamify default keeps the HUD", S4.$("#hud").hidden===false);
  check("gamify default marks the body gamified (strip stays on top while answering)", S4.w.document.body.classList.contains("gamified"));

  await req("POST","/api/studio/delete",JSON.stringify({slug:slug}));
  await req("POST","/api/studio/delete",JSON.stringify({slug:slugFlat}));
  await req("POST","/api/studio/delete",JSON.stringify({slug:slugGame}));
  await req("POST","/api/studio/delete",JSON.stringify({slug:slugBack}));
  console.log(fails?("\n"+fails+" FAIL"):"\nALL PASS");
  process.exit(fails?1:0);
})().catch(e=>{console.error("CRASH",e);process.exit(2);});
