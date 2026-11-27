"use strict";
// Подборы оборудования: с объектом или без (много подборов идёт без проекта).
// Подключается после app.js и meetings.js, использует их общие функции.
(function(){
const SST = {
  work:{t:"В работе",     c:"--accent"},
  sent:{t:"Отправлен",    c:"--warn"},
  won: {t:"Согласован",   c:"--ok"},
  lost:{t:"Отказ",        c:"--bad"},
};
S.selections=new Map(); S.sStatus=""; S.sQ=""; S.sEditing=null;
let selChannel=null, sDelArmed=false;

function canEditS(x){ return !x || x.owner===S.me.id || S.me.role==="admin"; }
function stPill(k){ const s=SST[k]||SST.work; return `<span class="pill" style="background:var(${s.c}-soft);color:var(${s.c})">${s.t}</span>`; }
function capTxt(v){ return (v===null||v===undefined||v==="") ? "" : String(+v).replace(".",",")+" кВт"; }
function safeLink(u){ return /^https:\/\//i.test(u||"") ? u : ""; }

async function loadSelections(){
  const {data,error}=await S.sb.from("selections").select("*");
  if(error){ notice(errText(error)); return; }
  S.selections=new Map(data.map(x=>[x.id,x]));
  renderSel(); refreshObjSel();
}
function subscribeSel(){
  if(selChannel) S.sb.removeChannel(selChannel);
  selChannel=S.sb.channel("selections")
    .on("postgres_changes",{event:"*",schema:"public",table:"selections"},p=>{
      if(p.eventType==="DELETE") S.selections.delete(p.old.id); else S.selections.set(p.new.id,p.new);
      renderSel(); refreshObjSel();
    }).subscribe();
}
document.addEventListener("visibilitychange",()=>{ if(!document.hidden && S.me && !$("scrApp").hidden) loadSelections(); });

// встраиваемся в общие функции
const _enter=enterApp;
enterApp=async function(){ await Promise.all([_enter(), loadSelections()]); subscribeSel(); };
const _teardown=teardown;
teardown=function(){ _teardown(); if(selChannel){ S.sb.removeChannel(selChannel); selChannel=null; } S.selections.clear(); };
const _render=render;
render=function(){ _render(); renderSel(); };
const _openObj=openObj;
openObj=function(id){ _openObj(id); refreshObjSel(); };

// ---------- список ----------
function renderSel(){
  if(!S.me) return;
  const q=S.sQ.trim().toLowerCase();
  const base=[...S.selections.values()].filter(x=>{
    if(S.filterMine && x.owner!==S.me.id) return false;
    if(q){ const o=x.object_id&&S.objects.get(x.object_id); if(![x.title,x.client,x.brand,x.system,x.note,o?o.name:"",personName(x.owner)].join(" ").toLowerCase().includes(q)) return false; }
    return true;
  });
  const inWork=base.filter(x=>x.status==="work").length;
  $("cSelBadge").textContent=inWork; $("cSelBadge").hidden=!inWork;
  const btn=(k,l,n)=>`<button data-sst="${k}" aria-pressed="${S.sStatus===k}">${l}${n!==undefined?` <span class="muted">${n}</span>`:""}</button>`;
  $("selFilter").innerHTML=btn("","Все",base.length)+Object.entries(SST).map(([k,s])=>btn(k,s.t,base.filter(x=>x.status===k).length)).join("");

  const list=base.filter(x=>!S.sStatus||x.status===S.sStatus).sort((a,b)=>{
    const aw=a.status==="work"?0:1, bw=b.status==="work"?0:1; if(aw!==bw) return aw-bw;
    return String(b.updated_at||"").localeCompare(String(a.updated_at||""));
  });
  const box=$("selList");
  if(!list.length){
    box.innerHTML=`<div class="empty"><strong>${base.length?"Ничего не найдено":"Подборов пока нет"}</strong><span>Подбор можно вести без проекта или привязать к объекту.</span><button class="btn primary" data-snew="1">+ Добавить подбор</button></div>`;
    return;
  }
  const t=today();
  box.innerHTML=list.map(x=>{
    const o=x.object_id&&S.objects.get(x.object_id), nm=personName(x.owner), can=canEditS(x), mine=x.owner===S.me.id;
    const late=x.due && x.due<t && x.status==="work";
    const tech=[x.system,x.brand,capTxt(x.capacity)].filter(Boolean).map(esc).join(" · ");
    const lk=safeLink(x.link);
    return `<div class="srow">
      <div><div class="st">${esc(x.title)}</div>
        <div class="ss"><span>${tech}</span>${x.client?`<span>· ${esc(x.client)}</span>`:""}${o?`<span>· объект: ${esc(o.name)}</span>`:`<span class="muted">· без объекта</span>`}${lk?`<a href="${esc(lk)}" target="_blank" rel="noopener">· файл ↗</a>`:""}<span>· ${avatarHTML(x.owner,nm)} ${esc(nm)}${mine?" (вы)":""}</span></div></div>
      <div class="sright">${stPill(x.status)}<span class="mono${late?" late":""}">${x.due?fmtDate(x.due):""}</span></div>
      <div><button class="icon" data-sopen="${esc(x.id)}" title="${can?"Изменить":"Открыть"}" aria-label="Открыть подбор ${esc(x.title)}">${can?"✎":"›"}</button></div>
    </div>`;
  }).join("");
}

// ---------- подборы в карточке объекта ----------
function refreshObjSel(){
  const w=$("objSelBox");
  if($("ovObj").hidden || !S.editing){ w.hidden=true; return; }
  w.hidden=false;
  const list=[...S.selections.values()].filter(x=>x.object_id===S.editing).sort((a,b)=>String(b.updated_at||"").localeCompare(String(a.updated_at||"")));
  $("objSelList").innerHTML = list.length ? list.map(x=>`<button type="button" class="item" data-sopen="${esc(x.id)}">
      <span>${stPill(x.status)}</span>
      <span><span class="mt">${esc(x.title)}</span> <span class="muted small">· ${esc([x.system,x.brand,capTxt(x.capacity)].filter(Boolean).join(" · "))}</span></span>
    </button>`).join("") : `<span class="muted small">Подборов по этому объекту пока нет.</span>`;
}

// ---------- форма ----------
function openSel(id, presetObj){
  const x=id?S.selections.get(id):null, can=canEditS(x);
  S.sEditing=x?x.id:null;
  $("selTitle").textContent=x?(can?"Подбор":"Подбор (только просмотр)"):"Новый подбор";
  const objs=[...S.objects.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name),"ru"));
  $("sObj").innerHTML=`<option value="">— без объекта —</option>`+objs.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("");
  $("sTitle").value=x?.title||""; $("sClient").value=x?.client||"";
  $("sObj").value=(x?x.object_id:presetObj)||"";
  $("sSys").value=x?.system||"VRF"; $("sBrand").value=x?.brand||"";
  $("sCap").value=(x&&x.capacity!==null&&x.capacity!==undefined)?x.capacity:"";
  $("sStatus").value=x?.status||"work"; $("sDue").value=x?.due||"";
  $("sLink").value=x?.link||""; $("sNote").value=x?.note||"";
  for(const f of ["sTitle","sClient","sObj","sSys","sBrand","sCap","sStatus","sDue","sLink","sNote"]) $(f).disabled=!can;
  $("sSave").hidden=!can; $("sDel").hidden=!(x&&can);
  sDelArmed=false; $("sDel").textContent="Удалить";
  $("selMeta").textContent=x?`Добавил(а): ${personName(x.owner)} · изменён ${fmtDT(x.updated_at)}`:"";
  $("selErr").hidden=true; $("ovSel").hidden=false;
  if(can) $("sTitle").focus();
}
function closeSel(){ $("ovSel").hidden=true; S.sEditing=null; }
$("sCancel").onclick=closeSel;
$("ovSel").addEventListener("click",e=>{ if(e.target===$("ovSel")) closeSel(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape" && !$("ovSel").hidden) closeSel(); });
$("addSelBtn").onclick=()=>openSel(null);
$("sq").oninput=e=>{ S.sQ=e.target.value; renderSel(); };

$("selForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const fail=t=>{ $("selErr").textContent=t; $("selErr").hidden=false; };
  const title=$("sTitle").value.trim();
  if(!title){ $("sTitle").focus(); return fail("Напишите, что подбираем."); }
  const capRaw=$("sCap").value.trim().replace(",",".");
  const cap=capRaw===""?null:Number(capRaw);
  if(capRaw!=="" && !isFinite(cap)){ $("sCap").focus(); return fail("Мощность — число в кВт, например 28 или 45,5."); }
  const link=$("sLink").value.trim();
  if(link && !/^https:\/\//i.test(link)){ $("sLink").focus(); return fail("Ссылка должна начинаться с https://"); }
  const row={title,client:$("sClient").value.trim(),object_id:$("sObj").value||null,system:$("sSys").value,brand:$("sBrand").value.trim(),capacity:cap,status:$("sStatus").value,due:$("sDue").value||null,link,note:$("sNote").value.trim()};
  $("sSave").disabled=true;
  try{
    const ed=S.sEditing;
    const q= ed ? S.sb.from("selections").update(row).eq("id",ed).select().single()
                : S.sb.from("selections").insert({...row,owner:S.me.id}).select().single();
    const {data,error}=await q; if(error) throw error;
    S.selections.set(data.id,data); renderSel();
    toast(ed?"Подбор сохранён":"Подбор добавлен"); closeSel();
  }catch(err){ fail(errText(err)); }
  finally{ $("sSave").disabled=false; }
});
$("sDel").onclick=async()=>{
  if(!sDelArmed){ sDelArmed=true; $("sDel").textContent="Точно удалить?"; return; }
  const id=S.sEditing; if(!id) return;
  $("sDel").disabled=true;
  const {error}=await S.sb.from("selections").delete().eq("id",id);
  $("sDel").disabled=false;
  if(error){ $("selErr").textContent=errText(error); $("selErr").hidden=false; return; }
  S.selections.delete(id); renderSel(); toast("Подбор удалён"); closeSel();
};

document.addEventListener("click",e=>{
  const f=e.target.closest("[data-sst]");
  if(f){ S.sStatus=f.dataset.sst; renderSel(); return; }
  if(e.target.closest("[data-snew]")){ openSel(null); return; }
  const nobj=e.target.closest("[data-snewobj]");
  if(nobj){ const oid=S.editing; closeObj(); openSel(null, oid); return; }
  const op=e.target.closest("[data-sopen]");
  if(op){ if(!$("ovObj").hidden) closeObj(); openSel(op.dataset.sopen); }
});
})();
