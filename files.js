"use strict";
// Файлы объектов: DWG, DXF, PDF в Supabase Storage (бакет files, до 50 МБ на файл).
// Подключается после app.js; показывает раздел «Файлы» в карточке объекта.
(function(){
const MAX = 50*1024*1024;
const OK_EXT = ["dwg","dxf","pdf"];
S.files=new Map(); let fileChannel=null; const armed=new Set();

function ext(n){ const m=/\.([a-z0-9]+)$/i.exec(n||""); return m?m[1].toLowerCase():""; }
function sizeTxt(b){ if(!b && b!==0) return ""; if(b<1024*1024) return Math.max(1,Math.round(b/1024))+" КБ"; return (b/1024/1024).toFixed(1).replace(".",",")+" МБ"; }
function canDel(f){ return f.owner===S.me.id || S.me.role==="admin"; }
function uid(){ return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2)); }

async function loadFiles(){
  const {data,error}=await S.sb.from("attachments").select("*");
  if(error){ notice(errText(error)); return; }
  S.files=new Map(data.map(f=>[f.id,f]));
  refreshObjFiles();
}
function subscribeFiles(){
  if(fileChannel) S.sb.removeChannel(fileChannel);
  fileChannel=S.sb.channel("attachments")
    .on("postgres_changes",{event:"*",schema:"public",table:"attachments"},p=>{
      if(p.eventType==="DELETE") S.files.delete(p.old.id); else S.files.set(p.new.id,p.new);
      refreshObjFiles();
    }).subscribe();
}
document.addEventListener("visibilitychange",()=>{ if(!document.hidden && S.me && !$("scrApp").hidden) loadFiles(); });

const _enter=enterApp;
enterApp=async function(){ await Promise.all([_enter(), loadFiles()]); subscribeFiles(); };
const _teardown=teardown;
teardown=function(){ _teardown(); if(fileChannel){ S.sb.removeChannel(fileChannel); fileChannel=null; } S.files.clear(); };
const _openObj=openObj;
openObj=function(id){ _openObj(id); armed.clear(); $("fileProg").hidden=true; refreshObjFiles(); };

function refreshObjFiles(){
  const w=$("objFileBox");
  if($("ovObj").hidden || !S.editing){ w.hidden=true; return; }
  w.hidden=false;
  const list=[...S.files.values()].filter(f=>f.object_id===S.editing).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  $("objFileList").innerHTML = list.length ? list.map(f=>{
    const e=ext(f.name), nm=personName(f.owner);
    return `<div class="fitem">
      <span class="ftype ${e==="pdf"?"pdf":"dwg"}">${esc((e||"файл").toUpperCase())}</span>
      <button type="button" class="fname" data-fopen="${esc(f.id)}" title="Открыть / скачать">${esc(f.name)}</button>
      <span class="muted small fmeta">${sizeTxt(f.size)} · ${esc(nm)} · ${esc(fmtDate(String(f.created_at).slice(0,10)))}</span>
      ${canDel(f)?`<button type="button" class="icon fdel" data-fdel="${esc(f.id)}" title="Удалить файл" aria-label="Удалить файл ${esc(f.name)}">${armed.has(f.id)?"Удалить?":"✕"}</button>`:"<span></span>"}
    </div>`;
  }).join("") : `<span class="muted small">Файлов пока нет. Можно прикрепить DWG, DXF или PDF до 50 МБ.</span>`;
}

function prog(t){ const p=$("fileProg"); p.textContent=t||""; p.hidden=!t; }

async function uploadFiles(fileList){
  const objId=S.editing; if(!objId) return;
  const files=[...fileList];
  for(const [i,file] of files.entries()){
    const e=ext(file.name);
    if(!OK_EXT.includes(e)){ toast(`«${file.name}»: можно только DWG, DXF или PDF`); continue; }
    if(file.size>MAX){ toast(`«${file.name}» больше 50 МБ — не загружен`); continue; }
    prog(`Загружаю ${i+1} из ${files.length}: ${file.name}…`);
    const path=`${objId}/${uid()}.${e}`;
    const up=await S.sb.storage.from("files").upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});
    if(up.error){ prog(""); toast(`Не загрузился «${file.name}»: ${errText(up.error)}`); continue; }
    const {data,error}=await S.sb.from("attachments").insert({object_id:objId,owner:S.me.id,name:file.name,path,size:file.size}).select().single();
    if(error){ await S.sb.storage.from("files").remove([path]); prog(""); toast(`Не сохранился «${file.name}»: ${errText(error)}`); continue; }
    S.files.set(data.id,data); refreshObjFiles();
  }
  prog(""); $("fileInput").value="";
}

async function openFile(id){
  const f=S.files.get(id); if(!f) return;
  const isPdf=ext(f.name)==="pdf";
  const win=window.open("","_blank");
  const {data,error}=await S.sb.storage.from("files").createSignedUrl(f.path,300, isPdf?undefined:{download:f.name});
  if(error){ if(win) win.close(); toast("Не открылся файл: "+errText(error)); return; }
  if(win) win.location.href=data.signedUrl; else location.href=data.signedUrl;
}

async function deleteFile(id){
  const f=S.files.get(id); if(!f) return;
  if(!armed.has(id)){ armed.add(id); refreshObjFiles(); return; }
  armed.delete(id);
  const rm=await S.sb.storage.from("files").remove([f.path]);
  if(rm.error){ toast("Не удалился файл: "+errText(rm.error)); refreshObjFiles(); return; }
  const {error}=await S.sb.from("attachments").delete().eq("id",id);
  if(error){ toast("Не удалилась запись о файле: "+errText(error)); return; }
  S.files.delete(id); refreshObjFiles(); toast("Файл удалён");
}

$("fileInput").addEventListener("change",e=>{ if(e.target.files && e.target.files.length) uploadFiles(e.target.files); });
document.addEventListener("click",e=>{
  const o=e.target.closest("[data-fopen]"); if(o){ openFile(o.dataset.fopen); return; }
  const d=e.target.closest("[data-fdel]"); if(d){ deleteFile(d.dataset.fdel); }
});
})();
