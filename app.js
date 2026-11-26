"use strict";
const CFG = window.APP_CONFIG || {};
const STATUSES = [
  {k:"work",   t:"В работе",        c:"--accent"},
  {k:"review", t:"На согласовании", c:"--warn"},
  {k:"pause",  t:"Пауза",           c:"--idle"},
  {k:"done",   t:"Сдан",            c:"--ok"},
];
const ST = Object.fromEntries(STATUSES.map(s => [s.k, s]));
const ROLES = {pending:"Ждёт подтверждения", designer:"Проектировщик", admin:"Администратор", blocked:"Заблокирован"};
const $ = id => document.getElementById(id);

const S = {
  sb:null, session:null, me:null,
  objects:new Map(), people:new Map(),
  filterMine:false, status:"", person:"", q:"",
  editing:null, loaded:false, channel:null, pendingTimer:null,
};

// ---------- утилиты ----------
function esc(s){return String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function today(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function fmtDate(s){if(!s)return"—";const[y,m,d]=s.split("-");return `${d}.${m}.${y}`}
function fmtDT(s){try{return new Date(s).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}catch{return""}}
function toast(t){const el=$("toast");el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2600)}
function notice(t){$("notice").textContent=t||"";$("notice").hidden=!t}
function show(id){for(const s of document.querySelectorAll(".screen")) s.hidden = s.id!==id}
function hue(id){let h=0;for(const c of String(id))h=(h*31+c.charCodeAt(0))>>>0;return h%360}
function initials(n){const p=String(n||"?").trim().split(/\s+/);return((p[0]||"?")[0]+(p[1]?p[1][0]:"")).toUpperCase()}
function avatarHTML(id,name){return `<span class="avatar" style="background:hsl(${hue(id)} 45% 42%)">${esc(initials(name))}</span>`}
function personName(id){const p=S.people.get(id);return (p&&(p.full_name||p.email))||"Сотрудник"}
function errText(e){
  const m=(e&&(e.message||e.error_description))||"";
  if(/Invalid login credentials/i.test(m)) return "Неверная почта или пароль.";
  if(/Email not confirmed/i.test(m)) return "Почта не подтверждена — откройте письмо от сервиса и нажмите ссылку.";
  if(/already registered/i.test(m)) return "Такая почта уже зарегистрирована — войдите.";
  if(/Password should be/i.test(m)) return "Пароль слишком короткий — минимум 6 символов.";
  if(/rate limit/i.test(m)) return "Слишком много попыток. Подождите минуту.";
  if(/row-level security|permission/i.test(m)) return "Нет прав на это действие.";
  if(/Failed to fetch|NetworkError/i.test(m)) return "Нет связи с сервером. Проверьте интернет.";
  return m || "Что-то пошло не так. Попробуйте ещё раз.";
}

$("brandAuth").textContent = $("brandApp").textContent = document.title = CFG.BUREAU_NAME || "Объекты бюро";
$("iStatus").innerHTML = STATUSES.map(s=>`<option value="${s.k}">${s.t}</option>`).join("");

// ---------- старт ----------
(function boot(){
  if(!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.supabase){ show("scrSetup"); return; }
  S.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  S.sb.auth.onAuthStateChange((event, session) => {
    if(event === "PASSWORD_RECOVERY"){ S.session=session; show("scrReset"); return; }
    if(event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT"){
      // не вызываем запросы прямо внутри колбэка — так советует supabase-js
      setTimeout(()=>onSession(session), 0);
    }
  });
})();

async function onSession(session){
  const same = S.session && session && S.session.user.id===session.user.id && S.me;
  S.session = session;
  if(!session){ teardown(); show("scrAuth"); return; }
  if(same && !$("scrApp").hidden) return;
  await loadMe();
}

async function loadMe(attempt){
  attempt = attempt || 0;
  const {data,error} = await S.sb.from("profiles").select("*").eq("id",S.session.user.id).maybeSingle();
  if(error){
    // сразу после перехода по ссылке из письма вход иногда ещё не успел примениться — пробуем снова
    if(attempt < 4){ setTimeout(()=>loadMe(attempt+1), 1500*(attempt+1)); return; }
    show("scrAuth"); showAuthErr(errText(error)); return;
  }
  S.me = data;
  clearInterval(S.pendingTimer);
  if(!data || data.role==="pending" || data.role==="blocked"){
    $("pendingText").textContent = data && data.role==="blocked"
      ? "Ваш доступ закрыт администратором."
      : "Руководитель должен подтвердить ваш доступ. Как только это произойдёт, страница откроется сама.";
    show("scrPending");
    if(!data || data.role==="pending") S.pendingTimer = setInterval(()=>loadMe(), 15000);
    return;
  }
  enterApp();
}

function teardown(){
  clearInterval(S.pendingTimer);
  if(S.channel){ S.sb.removeChannel(S.channel); S.channel=null; }
  S.me=null; S.objects.clear(); S.people.clear(); S.loaded=false;
}

// ---------- вход / регистрация ----------
let mode="login";
function setMode(m){
  mode=m;
  $("tabLogin").setAttribute("aria-pressed", m==="login");
  $("tabReg").setAttribute("aria-pressed", m==="reg");
  $("fName").hidden = m!=="reg";
  $("fPass").hidden = m==="forgot";
  $("aPass").autocomplete = m==="reg" ? "new-password" : "current-password";
  $("authBtn").textContent = m==="login" ? "Войти" : m==="reg" ? "Зарегистрироваться" : "Прислать ссылку";
  $("forgotBtn").textContent = m==="forgot" ? "← Назад ко входу" : "Забыли пароль?";
  $("authErr").hidden=true; $("authOk").hidden=true;
}
function showAuthErr(t){$("authErr").textContent=t;$("authErr").hidden=false;$("authOk").hidden=true}
function showAuthOk(t){$("authOk").textContent=t;$("authOk").hidden=false;$("authErr").hidden=true}
$("tabLogin").onclick=()=>setMode("login");
$("tabReg").onclick=()=>setMode("reg");
$("forgotBtn").onclick=()=>setMode(mode==="forgot"?"login":"forgot");

$("authForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const email=$("aEmail").value.trim(), pass=$("aPass").value, name=$("aName").value.trim();
  if(!/^\S+@\S+\.\S+$/.test(email)) return showAuthErr("Впишите почту.");
  if(mode!=="forgot" && pass.length<6) return showAuthErr("Пароль — минимум 6 символов.");
  if(mode==="reg" && name.length<2) return showAuthErr("Впишите имя и фамилию — их увидят коллеги.");
  const btn=$("authBtn"); btn.disabled=true;
  const redirect = location.origin + location.pathname;
  try{
    if(mode==="login"){
      const {error}=await S.sb.auth.signInWithPassword({email,password:pass});
      if(error) throw error;
    } else if(mode==="reg"){
      const {data,error}=await S.sb.auth.signUp({email,password:pass,options:{data:{full_name:name},emailRedirectTo:redirect}});
      if(error) throw error;
      if(!data.session) showAuthOk("Готово. Мы отправили письмо на "+email+" — откройте его и подтвердите почту, затем войдите.");
    } else {
      const {error}=await S.sb.auth.resetPasswordForEmail(email,{redirectTo:redirect});
      if(error) throw error;
      showAuthOk("Ссылка для смены пароля отправлена на "+email+".");
    }
  }catch(err){ showAuthErr(errText(err)); }
  finally{ btn.disabled=false; }
});

$("resetForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const p=$("rPass").value;
  if(p.length<6){$("resetErr").textContent="Минимум 6 символов.";$("resetErr").hidden=false;return}
  const {error}=await S.sb.auth.updateUser({password:p});
  if(error){$("resetErr").textContent=errText(error);$("resetErr").hidden=false;return}
  toast("Пароль сохранён");
  history.replaceState(null,"",location.pathname);
  loadMe();
});

async function logout(){ await S.sb.auth.signOut(); }
$("logoutBtn").onclick=logout;
$("pendingLogout").onclick=logout;

// ---------- приложение ----------
async function enterApp(){
  show("scrApp");
  $("meAv").outerHTML = `<span id="meAv">${avatarHTML(S.me.id,S.me.full_name||S.me.email)}</span>`;
  $("meName").textContent = S.me.full_name || S.me.email;
  $("cellTeam").hidden = S.me.role!=="admin";
  await Promise.all([loadPeople(), loadObjects()]);
  subscribe();
}

async function loadPeople(){
  const {data,error}=await S.sb.from("profiles").select("id,full_name,email,role,created_at").order("created_at");
  if(error){ notice(errText(error)); return; }
  S.people = new Map(data.map(p=>[p.id,p]));
  const me=S.people.get(S.me.id);
  if(me && me.role!==S.me.role){ S.me=me; if(me.role!=="admin"&&me.role!=="designer"){ loadMe(); return; } $("cellTeam").hidden=me.role!=="admin"; }
  render(); if(!$("ovTeam").hidden) renderTeam();
}

async function loadObjects(){
  const {data,error}=await S.sb.from("objects").select("*");
  S.loaded=true;
  if(error){ notice(errText(error)); render(); return; }
  S.objects = new Map(data.map(o=>[o.id,o]));
  notice(""); render();
}

function subscribe(){
  if(S.channel) S.sb.removeChannel(S.channel);
  S.channel = S.sb.channel("bureau")
    .on("postgres_changes",{event:"*",schema:"public",table:"objects"},p=>{
      if(p.eventType==="DELETE"){ S.objects.delete(p.old.id); }
      else { S.objects.set(p.new.id,p.new); }
      render();
    })
    .on("postgres_changes",{event:"*",schema:"public",table:"profiles"},()=>loadPeople())
    .subscribe(status=>{
      if(status==="CHANNEL_ERROR"||status==="TIMED_OUT") notice("Живое обновление не подключилось — изменения коллег появятся после обновления страницы.");
      if(status==="SUBSCRIBED" && $("notice").textContent.startsWith("Живое")) notice("");
    });
}
// при возврате во вкладку/приложение — подтянуть свежие данные
document.addEventListener("visibilitychange",()=>{ if(!document.hidden && S.me && !$("scrApp").hidden){ loadObjects(); } });

function filtered(){
  const q=S.q.trim().toLowerCase();
  return [...S.objects.values()].filter(o=>{
    if(S.filterMine && o.owner!==S.me.id) return false;
    if(S.person && o.owner!==S.person) return false;
    if(q && ![o.name,o.address,o.client,o.note,personName(o.owner)].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}

function render(){
  if(!S.me) return;
  const all=[...S.objects.values()], t=today();
  const owners=[...new Set(all.map(o=>o.owner))];
  $("cTotal").textContent=all.length;
  $("cPeople").textContent=[...S.people.values()].filter(p=>p.role==="designer"||p.role==="admin").length;
  $("cLate").textContent=all.filter(o=>o.due&&o.due<t&&o.status!=="done").length;
  const pend=[...S.people.values()].filter(p=>p.role==="pending").length;
  $("cPendingBadge").textContent = pend ? `· ${pend} новых` : "";

  const sel=$("fPerson"), cur=S.person;
  const ppl=[...S.people.values()].filter(p=>owners.includes(p.id)||p.role==="designer"||p.role==="admin");
  sel.innerHTML=`<option value="">Все проектировщики</option>`+ppl.map(p=>`<option value="${esc(p.id)}">${esc(p.full_name||p.email)}</option>`).join("");
  sel.value = ppl.some(p=>p.id===cur)?cur:"";

  const base=filtered();
  const sumBtn=(k,l,n,c)=>`<button class="sum" data-s="${k}" aria-pressed="${S.status===k}"><span class="n">${n}</span><span class="l">${c?`<i class="dot" style="background:var(${c})"></i>`:""}${l}</span></button>`;
  $("summary").innerHTML=sumBtn("","Всего",base.length)+STATUSES.map(s=>sumBtn(s.k,s.t,base.filter(o=>o.status===s.k).length,s.c)).join("");

  const rows=$("rows");
  if(!S.loaded) return;
  if(!all.length){
    rows.innerHTML=`<div class="empty"><strong>Пока ни одного объекта</strong><span>Нажмите «+ Объект», впишите название, систему и срок. Коллеги увидят его сразу.</span><button class="btn primary" data-act="add">+ Добавить первый объект</button></div>`;
    return;
  }
  const shown=base.filter(o=>!S.status||o.status===S.status).sort((a,b)=>{
    const ad=a.status==="done",bd=b.status==="done"; if(ad!==bd) return ad?1:-1;
    return (a.due||"9999").localeCompare(b.due||"9999")||String(a.name).localeCompare(String(b.name),"ru");
  });
  if(!shown.length){ rows.innerHTML=`<div class="empty"><strong>Ничего не найдено</strong><span>Сбросьте фильтры или поиск.</span></div>`; return; }
  const isAdmin=S.me.role==="admin";
  rows.innerHTML=shown.map(o=>{
    const s=ST[o.status]||ST.work, late=o.due&&o.due<t&&o.status!=="done", mine=o.owner===S.me.id;
    const nm=personName(o.owner);
    return `<div class="row">
      <div><div class="name">${esc(o.name)}</div><div class="addr">${esc([o.address,o.client].filter(Boolean).join(" · "))}</div></div>
      <div class="small"><span class="lbl">Система:</span>${esc(o.system||"—")}</div>
      <div class="small"><span class="lbl">Стадия:</span>${esc(o.stage||"—")}</div>
      <div class="c-status"><span class="pill" style="background:var(${s.c}-soft);color:var(${s.c})">${s.t}</span></div>
      <div class="mono ${late?"late":""}"><span class="lbl">Срок:</span>${fmtDate(o.due)}${late?" · просрочен":""}</div>
      <div class="who">${avatarHTML(o.owner,nm)}<span>${esc(nm)}${mine?" (вы)":""}</span></div>
      <div class="c-act"><button class="icon" title="${mine||isAdmin?"Изменить":"Открыть"}" aria-label="Открыть ${esc(o.name)}" data-act="open" data-id="${esc(o.id)}">${mine||isAdmin?"✎":"›"}</button></div>
    </div>`;
  }).join("");
}

document.addEventListener("click",e=>{
  const sb=e.target.closest(".sum"); if(sb){S.status=sb.dataset.s;render();return}
  const a=e.target.closest("[data-act]"); if(!a) return;
  if(a.dataset.act==="add") openObj(null);
  if(a.dataset.act==="open") openObj(a.dataset.id);
});
$("fAll").onclick=()=>{S.filterMine=false;$("fAll").setAttribute("aria-pressed","true");$("fMine").setAttribute("aria-pressed","false");render()};
$("fMine").onclick=()=>{S.filterMine=true;$("fMine").setAttribute("aria-pressed","true");$("fAll").setAttribute("aria-pressed","false");render()};
$("q").oninput=e=>{S.q=e.target.value;render()};
$("fPerson").onchange=e=>{S.person=e.target.value;render()};
$("addBtn").onclick=()=>openObj(null);

// ---------- карточка объекта ----------
let delArmed=false;
const FIELDS=["iName","iAddr","iClient","iSys","iStage","iStatus","iDue","iNote"];
function openObj(id){
  const o=id?S.objects.get(id):null;
  const can=!o || o.owner===S.me.id || S.me.role==="admin";
  S.editing=o?o.id:null;
  $("objTitle").textContent=o?(can?"Объект":"Объект (только просмотр)"):"Новый объект";
  $("iName").value=o?.name||""; $("iAddr").value=o?.address||""; $("iClient").value=o?.client||"";
  $("iSys").value=o?.system||"VRF"; $("iStage").value=o?.stage||"Стадия П";
  $("iStatus").value=o?.status||"work"; $("iDue").value=o?.due||""; $("iNote").value=o?.note||"";
  for(const f of FIELDS) $(f).disabled=!can;
  $("objSave").hidden=!can; $("delBtn").hidden=!(o&&can);
  delArmed=false; $("delBtn").textContent="Удалить";
  $("objMeta").textContent=o?`Проектировщик: ${personName(o.owner)} · создан ${fmtDT(o.created_at)} · изменён ${fmtDT(o.updated_at)}`:"";
  $("objErr").hidden=true; $("ovObj").hidden=false;
  if(can) $("iName").focus();
}
function closeObj(){$("ovObj").hidden=true;S.editing=null}
$("objCancel").onclick=closeObj;
$("ovObj").addEventListener("click",e=>{if(e.target===$("ovObj"))closeObj()});
$("ovTeam").addEventListener("click",e=>{if(e.target===$("ovTeam"))$("ovTeam").hidden=true});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(!$("ovObj").hidden)closeObj();else $("ovTeam").hidden=true}});

$("objForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const name=$("iName").value.trim();
  if(!name){$("objErr").textContent="Впишите название объекта.";$("objErr").hidden=false;$("iName").focus();return}
  const row={name,address:$("iAddr").value.trim(),client:$("iClient").value.trim(),system:$("iSys").value,stage:$("iStage").value,status:$("iStatus").value,due:$("iDue").value||null,note:$("iNote").value.trim()};
  $("objSave").disabled=true;
  try{
    const q = S.editing
      ? S.sb.from("objects").update(row).eq("id",S.editing).select().single()
      : S.sb.from("objects").insert({...row,owner:S.me.id}).select().single();
    const {data,error}=await q; if(error) throw error;
    S.objects.set(data.id,data); render();
    toast(S.editing?"Изменения сохранены":"Объект добавлен"); closeObj();
  }catch(err){$("objErr").textContent=errText(err);$("objErr").hidden=false}
  finally{$("objSave").disabled=false}
});
$("delBtn").onclick=async()=>{
  if(!delArmed){delArmed=true;$("delBtn").textContent="Точно удалить?";return}
  const id=S.editing; if(!id) return;
  $("delBtn").disabled=true;
  const {error}=await S.sb.from("objects").delete().eq("id",id);
  $("delBtn").disabled=false;
  if(error){$("objErr").textContent=errText(error);$("objErr").hidden=false;return}
  S.objects.delete(id); render(); toast("Объект удалён"); closeObj();
};

// ---------- выгрузка в Excel (CSV) ----------
$("csvBtn").onclick=()=>{
  const list=filtered().filter(o=>!S.status||o.status===S.status);
  const cell=v=>{const s=String(v??"");return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
  const head=["Объект","Адрес","Заказчик","Система","Стадия","Статус","Срок","Проектировщик","Заметка","Изменён"];
  const lines=[head.join(";")].concat(list.map(o=>[o.name,o.address,o.client,o.system,o.stage,(ST[o.status]||ST.work).t,fmtDate(o.due),personName(o.owner),o.note,fmtDT(o.updated_at)].map(cell).join(";")));
  const blob=new Blob(["﻿"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`объекты_${today()}.csv`;
  document.body.append(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
};

// ---------- команда ----------
$("teamBtn").onclick=()=>{renderTeam();$("ovTeam").hidden=false};
$("teamClose").onclick=()=>$("ovTeam").hidden=true;
function renderTeam(){
  const ppl=[...S.people.values()].sort((a,b)=>(a.role==="pending"?0:1)-(b.role==="pending"?0:1)||String(a.full_name).localeCompare(String(b.full_name),"ru"));
  const cnt=id=>[...S.objects.values()].filter(o=>o.owner===id).length;
  $("teamList").innerHTML=ppl.map(p=>`<div class="member">
    ${avatarHTML(p.id,p.full_name||p.email)}
    <div><div class="nm">${esc(p.full_name||"Без имени")}${p.role==="pending"?'<span class="tag">новый</span>':""}</div><div class="em">${esc(p.email)} · объектов: ${cnt(p.id)}</div></div>
    <select data-uid="${esc(p.id)}" aria-label="Роль: ${esc(p.full_name||p.email)}" ${p.id===S.me.id?"disabled":""}>
      ${Object.entries(ROLES).map(([k,v])=>`<option value="${k}" ${p.role===k?"selected":""}>${v}</option>`).join("")}
    </select></div>`).join("") || `<p class="muted">Пока никого.</p>`;
}
$("teamList").addEventListener("change",async e=>{
  const s=e.target.closest("select[data-uid]"); if(!s) return;
  s.disabled=true;
  const {error}=await S.sb.rpc("set_role",{target:s.dataset.uid,new_role:s.value});
  s.disabled=false;
  if(error){toast(errText(error));renderTeam();return}
  toast("Роль изменена"); loadPeople();
});

// ---------- установка как приложение ----------
if("serviceWorker" in navigator && location.protocol==="https:"){
  navigator.serviceWorker.register("sw.js").catch(()=>{});
}
