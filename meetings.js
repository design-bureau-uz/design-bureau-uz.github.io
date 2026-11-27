"use strict";
// Встречи, выезды и звонки: привязаны к объекту или отдельно.
// Подключается после app.js и использует его общие функции (S, $, esc, today, render…).
(function(){
const KINDS = {
  meeting:{t:"Встреча",         c:"--accent"},
  visit:  {t:"Выезд на объект", c:"--warn"},
  call:   {t:"Звонок",          c:"--idle"},
};
S.meetings = new Map(); S.view = "obj"; S.mPeriod = "up"; S.mEditing = null;
let meetChannel = null, mDelArmed = false;

function canEditM(m){ return !m || m.owner===S.me.id || S.me.role==="admin"; }
function objName(id){ const o=id&&S.objects.get(id); return o?o.name:""; }
function dayLabel(ds){
  const t=today(), d=new Date(ds+"T00:00:00");
  const tm=new Date(t+"T00:00:00"), diff=Math.round((d-tm)/86400000);
  const long=d.toLocaleDateString("ru-RU",{weekday:"long",day:"numeric",month:"long"});
  if(diff===0) return "Сегодня · "+long;
  if(diff===1) return "Завтра · "+long;
  if(diff===-1) return "Вчера · "+long;
  return long + (d.getFullYear()!==tm.getFullYear()?" "+d.getFullYear():"");
}
function kindPill(k){ const x=KINDS[k]||KINDS.meeting; return `<span class="pill" style="background:var(${x.c}-soft);color:var(${x.c})">${x.t}</span>`; }

// ---------- загрузка и живое обновление ----------
async function loadMeetings(){
  const {data,error}=await S.sb.from("meetings").select("*");
  if(error){ notice(errText(error)); return; }
  S.meetings=new Map(data.map(m=>[m.id,m]));
  renderMeetings(); refreshObjMeetings();
}
function subscribeMeetings(){
  if(meetChannel) S.sb.removeChannel(meetChannel);
  meetChannel=S.sb.channel("meetings")
    .on("postgres_changes",{event:"*",schema:"public",table:"meetings"},p=>{
      if(p.eventType==="DELETE") S.meetings.delete(p.old.id); else S.meetings.set(p.new.id,p.new);
      renderMeetings(); refreshObjMeetings();
    }).subscribe();
}
document.addEventListener("visibilitychange",()=>{ if(!document.hidden && S.me && !$("scrApp").hidden) loadMeetings(); });

// ---------- встраиваемся в основные функции app.js ----------
const _enterApp=enterApp;
enterApp=async function(){ setView(S.view); await Promise.all([_enterApp(), loadMeetings()]); subscribeMeetings(); };
const _teardown=teardown;
teardown=function(){ _teardown(); if(meetChannel){ S.sb.removeChannel(meetChannel); meetChannel=null; } S.meetings.clear(); };
const _render=render;
render=function(){ _render(); renderMeetings(); };
const _openObj=openObj;
openObj=function(id){ _openObj(id); refreshObjMeetings(); };

// ---------- страницы: Главная / Объекты / Встречи (адрес #objects, #meetings) ----------
const VIEWS={home:["viewHome","tabHome",""], obj:["viewObj","tabObj","objects"], meet:["viewMeet","tabMeet","meetings"]};
function viewFromHash(){ const h=location.hash.slice(1); return h==="objects"?"obj":h==="meetings"?"meet":"home"; }
function setView(v){
  if(!VIEWS[v]) v="home";
  S.view=v;
  for(const k in VIEWS){ $(VIEWS[k][0]).hidden = k!==v; $(VIEWS[k][1]).setAttribute("aria-pressed", k===v); }
  $("segMine").hidden = v==="home";
}
window.goView=function(v){
  setView(v);
  const h=VIEWS[S.view][2];
  if(location.hash.slice(1)!==h) history.pushState(null,"", h ? "#"+h : location.pathname+location.search);
};
S.view=viewFromHash();
window.addEventListener("popstate",()=>setView(viewFromHash()));
$("tabHome").onclick=()=>goView("home");
$("tabObj").onclick=()=>goView("obj");
$("tabMeet").onclick=()=>goView("meet");

// ---------- список встреч ----------
function renderMeetings(){
  if(!S.me) return;
  if(window.renderHome) window.renderHome();
  const t=today();
  const mineOk=m=>!S.filterMine || m.owner===S.me.id;
  const all=[...S.meetings.values()].filter(mineOk);
  const todayCnt=all.filter(m=>m.date===t && !m.done).length;
  $("cMeetBadge").textContent=todayCnt; $("cMeetBadge").hidden=!todayCnt;

  const p=S.mPeriod;
  const list=all.filter(m=> p==="all" ? true : p==="up" ? (!m.done && m.date>=t) : (m.date<t || m.done))
    .sort((a,b)=>{ const k=(a.date+(a.time||"99")).localeCompare(b.date+(b.time||"99")); return p==="up"?k:-k; });
  const box=$("meetList");
  if(!list.length){
    const msg = p==="up" ? "Нет предстоящих встреч" : p==="past" ? "Прошедших встреч нет" : "Встреч пока нет";
    box.innerHTML=`<div class="empty"><strong>${msg}</strong><span>Встречу можно добавить отдельно или из карточки объекта.</span><button class="btn primary" data-mnew="1">+ Добавить встречу</button></div>`;
    return;
  }
  let html="", cur="";
  for(const m of list){
    if(m.date!==cur){ cur=m.date; html+=`<div class="mday${m.date===t?" today":""}">${esc(dayLabel(m.date))}</div>`; }
    const can=canEditM(m), on=objName(m.object_id), nm=personName(m.owner), mine=m.owner===S.me.id;
    const missed=!m.done && m.date<t;
    html+=`<div class="mrow${m.done?" done":""}">
      <div class="mono">${esc(m.time||"—")}</div>
      <div><div class="mt">${esc(m.title)}</div>
        <div class="msub">${kindPill(m.kind)}${on?`<span>${esc(on)}</span>`:""}${m.place?`<span>· ${esc(m.place)}</span>`:""}<span>· ${avatarHTML(m.owner,nm)} ${esc(nm)}${mine?" (вы)":""}</span>${missed?`<span class="late">· не отмечена</span>`:""}</div></div>
      <div>${can?`<input type="checkbox" class="mcheck" data-mdone="${esc(m.id)}" ${m.done?"checked":""} title="Проведена" aria-label="Встреча проведена: ${esc(m.title)}">`:""}</div>
      <div><button class="icon" data-mopen="${esc(m.id)}" title="${can?"Изменить":"Открыть"}" aria-label="Открыть встречу ${esc(m.title)}">${can?"✎":"›"}</button></div>
    </div>`;
  }
  box.innerHTML=html;
}

// ---------- встречи внутри карточки объекта ----------
function refreshObjMeetings(){
  const boxW=$("objMeetBox");
  if($("ovObj").hidden || !S.editing){ boxW.hidden=true; return; }
  boxW.hidden=false;
  const list=[...S.meetings.values()].filter(m=>m.object_id===S.editing).sort((a,b)=>(b.date+(b.time||"")).localeCompare(a.date+(a.time||"")));
  $("objMeetList").innerHTML = list.length ? list.map(m=>`<button type="button" class="item" data-mopen="${esc(m.id)}">
      <span class="mono">${fmtDate(m.date)}${m.time?" "+esc(m.time):""}</span>
      <span><span class="mt">${esc(m.title)}</span> <span class="muted small">· ${(KINDS[m.kind]||KINDS.meeting).t}${m.done?" · проведена":""}</span></span>
    </button>`).join("") : `<span class="muted small">Встреч по этому объекту пока нет.</span>`;
}

// ---------- форма встречи ----------
function openMeet(id, presetObj){
  const m=id?S.meetings.get(id):null, can=canEditM(m);
  S.mEditing=m?m.id:null;
  $("meetTitle").textContent=m?(can?"Встреча":"Встреча (только просмотр)"):"Новая встреча";
  const objs=[...S.objects.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name),"ru"));
  $("mObj").innerHTML=`<option value="">— без объекта —</option>`+objs.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("");
  $("mKind").value=m?.kind||"meeting";
  $("mObj").value=(m?m.object_id:presetObj)||"";
  $("mTitle").value=m?.title||""; $("mDate").value=m?.date||today(); $("mTime").value=m?.time||"";
  $("mPlace").value=m?.place||""; $("mNote").value=m?.note||""; $("mDone").checked=!!m?.done;
  for(const f of ["mKind","mObj","mTitle","mDate","mTime","mPlace","mNote","mDone"]) $(f).disabled=!can;
  $("mSave").hidden=!can; $("mDel").hidden=!(m&&can);
  mDelArmed=false; $("mDel").textContent="Удалить";
  $("meetMeta").textContent=m?`Добавил(а): ${personName(m.owner)} · изменено ${fmtDT(m.updated_at)}`:"";
  $("meetErr").hidden=true; $("ovMeet").hidden=false;
  if(can) $("mTitle").focus();
}
function closeMeet(){ $("ovMeet").hidden=true; S.mEditing=null; }
$("mCancel").onclick=closeMeet;
$("ovMeet").addEventListener("click",e=>{ if(e.target===$("ovMeet")) closeMeet(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape" && !$("ovMeet").hidden) closeMeet(); });
$("addMeetBtn").onclick=()=>openMeet(null);

$("meetForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const title=$("mTitle").value.trim(), date=$("mDate").value;
  const fail=t=>{ $("meetErr").textContent=t; $("meetErr").hidden=false; };
  if(!title){ $("mTitle").focus(); return fail("Напишите, о чём встреча."); }
  if(!date){ $("mDate").focus(); return fail("Укажите дату."); }
  const row={kind:$("mKind").value,object_id:$("mObj").value||null,title,date,time:$("mTime").value||"",place:$("mPlace").value.trim(),note:$("mNote").value.trim(),done:$("mDone").checked};
  $("mSave").disabled=true;
  try{
    const ed=S.mEditing;
    const q= ed ? S.sb.from("meetings").update(row).eq("id",ed).select().single()
                : S.sb.from("meetings").insert({...row,owner:S.me.id}).select().single();
    const {data,error}=await q; if(error) throw error;
    S.meetings.set(data.id,data); renderMeetings();
    toast(ed?"Встреча сохранена":"Встреча добавлена"); closeMeet();
  }catch(err){ fail(errText(err)); }
  finally{ $("mSave").disabled=false; }
});
$("mDel").onclick=async()=>{
  if(!mDelArmed){ mDelArmed=true; $("mDel").textContent="Точно удалить?"; return; }
  const id=S.mEditing; if(!id) return;
  $("mDel").disabled=true;
  const {error}=await S.sb.from("meetings").delete().eq("id",id);
  $("mDel").disabled=false;
  if(error){ $("meetErr").textContent=errText(error); $("meetErr").hidden=false; return; }
  S.meetings.delete(id); renderMeetings(); toast("Встреча удалена"); closeMeet();
};

// ---------- клики и галочки ----------
document.addEventListener("click",e=>{
  const per=e.target.closest("[data-period]");
  if(per){ S.mPeriod=per.dataset.period; for(const b of document.querySelectorAll("[data-period]")) b.setAttribute("aria-pressed", b===per); renderMeetings(); return; }
  if(e.target.closest("[data-mnew]")){ openMeet(null); return; }
  const nobj=e.target.closest("[data-mnewobj]");
  if(nobj){ const oid=S.editing; closeObj(); openMeet(null, oid); return; }
  const op=e.target.closest("[data-mopen]");
  if(op){ if(!$("ovObj").hidden) closeObj(); openMeet(op.dataset.mopen); }
});
document.addEventListener("change",async e=>{
  const c=e.target.closest("[data-mdone]"); if(!c) return;
  const id=c.dataset.mdone, done=c.checked;
  c.disabled=true;
  const {data,error}=await S.sb.from("meetings").update({done}).eq("id",id).select().single();
  c.disabled=false;
  if(error){ c.checked=!done; toast(errText(error)); return; }
  S.meetings.set(data.id,data); renderMeetings(); toast(done?"Отмечено: проведена":"Отметка снята");
});
})();
