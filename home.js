"use strict";
// Главная страница: сводка по бюро, карточки проектировщиков и ближайшие встречи.
// Подключается после app.js и meetings.js; перерисовывается вместе с ними.
window.renderHome = function(){
  if(!S.me) return;
  const box=$("homeBody"); if(!box) return;
  const t=today();
  const wk=new Date(t+"T00:00:00"); wk.setDate(wk.getDate()+7);
  const weekEnd=wk.getFullYear()+"-"+String(wk.getMonth()+1).padStart(2,"0")+"-"+String(wk.getDate()).padStart(2,"0");
  const objs=[...S.objects.values()];
  const meets=[...(S.meetings||new Map()).values()];
  const late=o=>o.due && o.due<t && o.status!=="done";
  const upcoming=meets.filter(m=>!m.done && m.date>=t).sort((a,b)=>(a.date+(a.time||"99")).localeCompare(b.date+(b.time||"99")));
  const kindT={meeting:"Встреча",visit:"Выезд",call:"Звонок"};

  // сводка
  const tile=(n,l,cls)=>`<div class="tile${cls?" "+cls:""}"><span class="n">${n}</span><span class="l">${l}</span></div>`;
  let html=`<div class="tiles">
    ${tile(objs.length,"Объектов всего")}
    ${tile(objs.filter(o=>o.status==="work").length,"В работе")}
    ${tile(objs.filter(o=>o.status==="review").length,"На согласовании")}
    ${tile(objs.filter(late).length,"Просрочено", objs.some(late)?"bad":"")}
    ${tile(meets.filter(m=>m.date===t && !m.done).length,"Встреч сегодня")}
    ${tile(upcoming.filter(m=>m.date<=weekEnd).length,"Встреч за 7 дней")}
  </div>`;

  // заявки (для администратора)
  const pend=[...S.people.values()].filter(p=>p.role==="pending").length;
  if(S.me.role==="admin" && pend) html+=`<div class="note homenote"><span>Новых заявок на доступ: <b>${pend}</b>.</span><button class="btn" data-hteam="1">Открыть «Команду»</button></div>`;

  // проектировщики
  const people=[...S.people.values()].filter(p=>p.role==="designer"||p.role==="admin")
    .sort((a,b)=>String(a.full_name||a.email).localeCompare(String(b.full_name||b.email),"ru"));
  html+=`<div class="sechead"><h2 class="sec">Проектировщики</h2><span class="muted small">${people.length} чел.</span></div>`;
  if(!people.length){ html+=`<div class="empty"><strong>Пока никого</strong><span>Отправьте коллегам ссылку и подтвердите их в «Команде».</span></div>`; }
  else{
    html+=`<div class="people">`+people.map(p=>{
      const my=objs.filter(o=>o.owner===p.id);
      const active=my.filter(o=>o.status!=="done").sort((a,b)=>(a.due||"9999").localeCompare(b.due||"9999"));
      const nextM=upcoming.find(m=>m.owner===p.id);
      const nm=p.full_name||p.email, me=p.id===S.me.id;
      const st=(n,l,cls)=>`<div class="pstat${cls?" "+cls:""}"><b>${n}</b><span>${l}</span></div>`;
      const lateN=my.filter(late).length;
      return `<article class="pcard">
        <div class="phead">${avatarHTML(p.id,nm)}<div class="pname"><b>${esc(nm)}${me?" (вы)":""}</b><span class="muted small">${p.role==="admin"?"Администратор":"Проектировщик"}</span></div></div>
        <div class="pstats">${st(my.length,"объектов")}${st(my.filter(o=>o.status==="work").length,"в работе")}${st(my.filter(o=>o.status==="review").length,"на согласов.")}${st(lateN,"просрочено",lateN?"bad":"")}</div>
        <div class="plist">${active.length ? active.slice(0,4).map(o=>{const s=ST[o.status]||ST.work;return `<button type="button" class="pobj" data-act="open" data-id="${esc(o.id)}"><span class="pill" style="background:var(${s.c}-soft);color:var(${s.c})">${s.t}</span><span class="pon">${esc(o.name)}</span><span class="mono${late(o)?" late":""}">${fmtDate(o.due)}</span></button>`;}).join("") + (active.length>4?`<span class="muted small">и ещё ${active.length-4}</span>`:"") : `<span class="muted small">Активных объектов нет.</span>`}</div>
        <div class="pnext">${nextM?`<span class="muted small">Ближайшая встреча:</span> <b>${esc(fmtDate(nextM.date))}${nextM.time?" "+esc(nextM.time):""}</b> · ${esc(nextM.title)}`:`<span class="muted small">Встреч не запланировано</span>`}</div>
        <button type="button" class="btn" data-hperson="${esc(p.id)}">Все объекты ${esc(nm.split(" ")[0])} →</button>
      </article>`;
    }).join("")+`</div>`;
  }

  // ближайшие встречи
  const soon=upcoming.filter(m=>m.date<=weekEnd).slice(0,8);
  html+=`<div class="sechead"><h2 class="sec">Встречи на 7 дней</h2><button class="link" data-hgo="meet">Все встречи →</button></div>`;
  html+= soon.length ? `<section class="list">`+soon.map(m=>{const nm=personName(m.owner);const o=m.object_id&&S.objects.get(m.object_id);
    return `<button type="button" class="hmeet" data-mopen="${esc(m.id)}"><span class="mono">${esc(fmtDate(m.date))} ${esc(m.time||"")}</span><span><b>${esc(m.title)}</b><span class="muted small"> · ${kindT[m.kind]||"Встреча"}${o?" · "+esc(o.name):""}</span></span><span class="who">${avatarHTML(m.owner,nm)}<span>${esc(nm)}</span></span></button>`;}).join("")+`</section>`
    : `<div class="empty"><strong>На ближайшую неделю встреч нет</strong></div>`;

  html+=`<div class="homego"><button class="btn primary" data-hgo="obj">Открыть все объекты →</button></div>`;
  box.innerHTML=html;
};

document.addEventListener("click",e=>{
  const pp=e.target.closest("[data-hperson]");
  if(pp){ S.person=pp.dataset.hperson; S.filterMine=false; $("fAll").setAttribute("aria-pressed","true"); $("fMine").setAttribute("aria-pressed","false"); goView("obj"); render(); window.scrollTo(0,0); return; }
  const g=e.target.closest("[data-hgo]");
  if(g){ if(g.dataset.hgo==="obj"){ S.person=""; } goView(g.dataset.hgo); render(); window.scrollTo(0,0); return; }
  if(e.target.closest("[data-hteam]")) $("teamBtn").click();
});
