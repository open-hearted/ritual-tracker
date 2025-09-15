// coworking-checkin.js
// (c) 2024 Takayuki Shimizukawa
// ===== State & Storage =====
const $ = (id) => document.getElementById(id);
const state = {
  uid: 'default', // 認証なし・固定ユーザー
  year: new Date().getFullYear(),
  month: new Date().getMonth(), // 0-11
};

// ページ毎のストレージ分離用プレフィックス (meditation.html は 'med', それ以外は 'cw')
const PAGE_PREFIX = (()=>{
  const p = (location.pathname||'').toLowerCase();
  if(p.includes('meditation')) return 'med';
  return 'cw';
})();
const LS_USERS_KEY = `${PAGE_PREFIX}_users_v1`; // map: uid -> { pinHash?: string, data: {...} }
const LS_FIN_KEY = `${PAGE_PREFIX}_finance_v1`; // { monthly:number, day:number, transit:number, other:number }

function isMeditation(){ return PAGE_PREFIX === 'med'; }

function getAllUsers(){
  try { return JSON.parse(localStorage.getItem(LS_USERS_KEY)) || {}; } catch { return {}; }
}
function setAllUsers(map){ localStorage.setItem(LS_USERS_KEY, JSON.stringify(map)); }
function getUser(uid){ return getAllUsers()[uid] || null; }

// finance helpers
function getFinance(){
  try { return JSON.parse(localStorage.getItem(LS_FIN_KEY)) || {}; } catch { return {}; }
}
function saveFinance(obj){ localStorage.setItem(LS_FIN_KEY, JSON.stringify(obj)); }
function ensureUser(uid){ const m = getAllUsers(); if(!m[uid]){ m[uid] = { data:{} }; setAllUsers(m); } return m[uid]; }

// not secure; just deter casual clicks
function simpleHash(s){
  let h = 0; for(let i=0;i<s.length;i++){ h = (h<<5) - h + s.charCodeAt(i); h |= 0; }
  return String(h >>> 0);
}

// Data shape: users[uid].data["YYYY-MM"]["YYYY-MM-DD"] = 0|1 (0: off, 1: went)
function getMonthKey(y,m){ return `${y}-${String(m+1).padStart(2,'0')}`; }
function getDateKey(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

function readMonth(uid, y, m){
  const u = getUser(uid); if(!u) return {};
  const mk = getMonthKey(y,m);
  return (u.data && u.data[mk]) ? u.data[mk] : {};
}
function writeMonth(uid, y, m, obj){
  const mapp = getAllUsers();
  mapp[uid] = mapp[uid] || { data:{} };
  mapp[uid].data = mapp[uid].data || {};
  const mk = getMonthKey(y,m);
  mapp[uid].data[mk] = obj;
  setAllUsers(mapp);
}

// ===== Login / Logout =====
// 認証は使わないため、ログイン/ログアウトは未使用

// ===== Calendar Build =====
const dowNames = ['月','火','水','木','金','土','日']; // Monday start

function renderDOW(){
  const row = $('dowRow'); row.innerHTML = '';
  for(const n of dowNames){
    const el = document.createElement('div');
    el.className = 'dow'; el.textContent = n; row.appendChild(el);
  }
}

function firstDowMonday(y,m){
  // JS getDay(): 0 Sunday..6 Saturday. We want Monday=0..Sunday=6
  const d = new Date(y,m,1).getDay();
  return (d + 6) % 7;
}

function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }

function renderCalendar(){
  const grid = $('calGrid'); grid.innerHTML='';
  const {year, month} = state;
  const mk = getMonthKey(year, month);
  $('monthLabel').textContent = `${year}年 ${month+1}月`;

  const monthData = state.uid ? readMonth(state.uid, year, month) : {};

  const startPad = firstDowMonday(year, month);
  const numDays = daysInMonth(year, month);

  // previous month padding (disabled cells)
  for(let i=0;i<startPad;i++){
    const pad = document.createElement('div');
    pad.className='cell disabled';
    pad.setAttribute('aria-hidden','true');
    grid.appendChild(pad);
  }

  const todayKey = getDateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  for(let d=1; d<=numDays; d++){
    const el = document.createElement('button');
    el.type = 'button'; el.className='cell';
    const dk = getDateKey(year, month, d);
    const isToday = dk === todayKey;
    if(isMeditation()){
      const rec = monthData[dk]; // {sessions:[minutes,...]}
      const sessions = Array.isArray(rec?.sessions)? rec.sessions : [];
      const totalMin = sessions.reduce((a,b)=>a+b,0);
      el.dataset.sessions = String(sessions.length);
      if(isToday) el.setAttribute('data-today','true');
      // meditation cell layout
  el.innerHTML = `<div class="d">${d}</div><div class="med-summary">${sessions.length ? (totalMin+'<span class="med-min-unit">分</span>') : ''}</div>`;
      el.title = sessions.length ? `瞑想 ${sessions.length}回 合計${totalMin}分 (クリックで編集 / 右クリックでクリア)` : '未記録（クリックで追加）';
      el.addEventListener('click', (ev)=>{
        openMeditationEditor(dk, el, sessions);
      });
      el.addEventListener('contextmenu', (e)=>{
        e.preventDefault();
        const recNow = readMonth(state.uid, year, month)[dk];
        if(!recNow) return;
        if(confirm('この日の瞑想記録をすべて削除しますか？')){
          const md = readMonth(state.uid, year, month);
          delete md[dk];
          writeMonth(state.uid, year, month, md);
          renderCalendar();
        }
      });
    } else {
      const val = monthData[dk] || 0;
      el.dataset.state = String(val);
      if(isToday) el.setAttribute('data-today','true');
      el.innerHTML = `<div class="d">${d}</div><div class="dot">${val ? '🏢' : ''}</div>`;
      el.title = val ? '行った（クリックで解除）' : '未記録（クリックで「行った」に）';
      el.addEventListener('click', ()=>{
        const current = el.dataset.state === '1' ? 1 : 0;
        const next = current ? 0 : 1;
        el.dataset.state = String(next);
        el.querySelector('.dot').textContent = next ? '🏢' : '';
        const md = readMonth(state.uid, year, month);
        md[dk] = next;
        writeMonth(state.uid, year, month, md);
  if(window.syncAfterNewWorkToggle) window.syncAfterNewWorkToggle();
  if(window.syncAfterNewWorkToggle) window.syncAfterNewWorkToggle();
        renderStats();
      });
    }
    grid.appendChild(el);
  }

  renderStats();
  adjustCalendarSize();
}

function renderStats(){
  const box = $('stats'); box.innerHTML = '';
  const md = readMonth(state.uid, state.year, state.month);
  const keys = Object.keys(md);
  let attendedForFinance = 0;
  if(isMeditation()){
    const dayKeys = keys.filter(k => Array.isArray(md[k]?.sessions) && md[k].sessions.length>0);
    const daysMeditated = dayKeys.length;
    const totalDays = daysInMonth(state.year, state.month);
    const streak = calcStreak(md);
    const totalMinutes = dayKeys.reduce((sum,k)=> sum + md[k].sessions.reduce((a,b)=>a+b,0), 0);
    const avgPerDay = daysMeditated? Math.round(totalMinutes/daysMeditated) : 0;
    box.append(
      makeStat(`瞑想日数: <b>${daysMeditated}</b> / ${totalDays}日`),
      makeStat(`連続日数: <b>${streak}</b> 日`),
      makeStat(`合計: <b>${totalMinutes}</b> 分`),
      makeStat(`1日平均: <b>${avgPerDay}</b> 分`),
    );
  } else {
    const attended = keys.filter(k => md[k] === 1).length;
    attendedForFinance = attended;
    const total = daysInMonth(state.year, state.month);
    const rate = total ? Math.round(attended*100/total) : 0;
    const streak = calcStreak(md);
    box.append(
      makeStat(`今月の出席日数: <b>${attended}</b> / ${total}日 (${rate}%)`),
      makeStat(`連続出席（今月内）: <b>${streak}</b> 日`),
    );
  }
  renderFinanceStats(attendedForFinance);
}

function makeStat(html){ const d=document.createElement('div'); d.className='stat'; d.innerHTML=html; return d; }

function calcStreak(monthObj){
  // count max consecutive 1s up to today within this calendar month order
  const days = [];
  const {year, month} = state;
  const total = daysInMonth(year, month);
  for(let d=1; d<=total; d++){
    const dk = getDateKey(year, month, d);
    if(isMeditation()){
      const rec = monthObj[dk];
      const ok = Array.isArray(rec?.sessions) && rec.sessions.length>0;
      days.push(ok?1:0);
    } else {
      days.push(monthObj[dk] === 1 ? 1 : 0);
    }
  }
  let best=0, cur=0;
  for(const v of days){ cur = v ? cur+1 : 0; if(cur>best) best=cur; }
  return best;
}

// ===== Meditation session editor (for meditation mode only) =====
let medEditorEl = null;
function ensureMedEditor(){
  if(medEditorEl || !isMeditation()) return medEditorEl;
  medEditorEl = document.createElement('div');
  medEditorEl.id = 'medEditor';
  medEditorEl.innerHTML = '<div class="med-head"><span id="medEditDate"></span><button id="medClose" title="閉じる">✕</button></div>'+
  '<div class="med-sessions" id="medSessions"></div>'+
  '<div class="med-timer" id="medTimerBox">'+
    '<input id="medTimerMin" type="number" min="0.1" step="0.5" value="10" title="カウントダウン分" />'+
    '<span id="medTimerDisplay">--:--</span>'+ 
    '<span class="med-startat">開始: <b id="medTimerStartedAt">--:--</b></span>'+ 
    '<button id="medTimerStart">開始</button>'+ 
    '<button id="medTimerPause" disabled>一時停止</button>'+ 
    '<button id="medTimerResume" disabled>再開</button>'+ 
    '<button id="medTimerCancel" disabled>中止</button>'+ 
    '<button id="medAlarmStop" disabled>消音</button>'+ 
  '</div>'+
  '<div class="med-add"><input id="medNewMin" type="number" min="1" placeholder="分" /><button id="medAddBtn">追加</button><button id="medClearDay" class="danger">日クリア</button></div>';
  document.body.appendChild(medEditorEl);
  medEditorEl.querySelector('#medClose').addEventListener('click', ()=> hideMedEditor());
  medEditorEl.querySelector('#medAddBtn').addEventListener('click', ()=> addMedSession());
  medEditorEl.querySelector('#medNewMin').addEventListener('keydown', e=>{ if(e.key==='Enter'){ addMedSession(); }});
  medEditorEl.querySelector('#medClearDay').addEventListener('click', ()=>{ clearMedDay(); });
  // Timer bindings
  medEditorEl.querySelector('#medTimerStart').addEventListener('click', startMedTimer);
  medEditorEl.querySelector('#medTimerPause').addEventListener('click', pauseMedTimer);
  medEditorEl.querySelector('#medTimerResume').addEventListener('click', resumeMedTimer);
  medEditorEl.querySelector('#medTimerCancel').addEventListener('click', cancelMedTimer);
  medEditorEl.querySelector('#medAlarmStop').addEventListener('click', stopAlarm);
  document.addEventListener('click', (e)=>{
    if(!medEditorEl) return;
    if(!medEditorEl.contains(e.target) && !e.target.closest('.cell')) hideMedEditor();
  });
  return medEditorEl;
}
let medEditTarget = { dateKey:null, anchor:null };
function openMeditationEditor(dateKey, anchorEl, sessions){
  ensureMedEditor();
  medEditTarget.dateKey = dateKey; medEditTarget.anchor = anchorEl;
  const box = medEditorEl;
  const r = anchorEl.getBoundingClientRect();
  box.style.display='block';
  // position (try below; fallback above)
  const topPreferred = r.bottom + 6;
  const left = Math.min(window.innerWidth - 220, Math.max(4, r.left));
  box.style.left = left + 'px';
  if(topPreferred + box.offsetHeight < window.innerHeight){
    box.style.top = topPreferred + 'px';
  } else {
    box.style.top = (r.top - box.offsetHeight - 6) + 'px';
  }
  box.querySelector('#medEditDate').textContent = dateKey;
  renderMedSessionList();
  const inp = box.querySelector('#medNewMin');
  inp.setAttribute('step','0.1');
  inp.focus();
  if(window.beginMeditationEdit) window.beginMeditationEdit();
}
function hideMedEditor(){ if(medEditorEl){ medEditorEl.style.display='none'; if(window.endMeditationEdit) window.endMeditationEdit(); } }
function readMedSessions(){
  const md = readMonth(state.uid, state.year, state.month);
  const rec = md[medEditTarget.dateKey];
  return Array.isArray(rec?.sessions)? rec.sessions : [];
}
function writeMedSessions(arr){
  const md = readMonth(state.uid, state.year, state.month);
  // preserve starts alignment if exists
  if(arr.length===0){
    md[medEditTarget.dateKey] = { __deleted:true, ts:new Date().toISOString() };
  } else {
    const existing = md[medEditTarget.dateKey] || {};
    let starts = Array.isArray(existing.starts) ? existing.starts.slice() : [];
    let ids = Array.isArray(existing.ids) ? existing.ids.slice() : [];
    // trim/extend starts to match sessions length
    if(starts.length > arr.length) starts = starts.slice(0, arr.length);
    if(starts.length < arr.length) starts = starts.concat(Array(arr.length - starts.length).fill(''));
    if(ids.length > arr.length) ids = ids.slice(0, arr.length);
    if(ids.length < arr.length){
      for(let i=ids.length;i<arr.length;i++){ ids.push('m'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)); }
    }
    md[medEditTarget.dateKey] = { sessions: arr, starts, ids, dayTs: new Date().toISOString() };
  }
  writeMonth(state.uid, state.year, state.month, md);
  if(window.syncAfterNewMeditationSession) window.syncAfterNewMeditationSession();
  renderCalendar(); // re-render calendar & stats
  renderMedSessionList();
}
function addMedSessionWithStart(min, startedAt){
  const md = readMonth(state.uid, state.year, state.month);
  const rec = md[medEditTarget.dateKey] || {};
  const sessions = Array.isArray(rec.sessions)? rec.sessions.slice(): [];
  const starts = Array.isArray(rec.starts)? rec.starts.slice(): [];
  const ids = Array.isArray(rec.ids)? rec.ids.slice(): [];
  const newId = 'm'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  sessions.push(min);
  starts.push(startedAt||'');
  ids.push(newId);
  md[medEditTarget.dateKey] = { sessions, starts, ids, dayTs:new Date().toISOString() };
  writeMonth(state.uid, state.year, state.month, md);
  if(window.syncAfterNewMeditationSession) window.syncAfterNewMeditationSession();
  renderCalendar();
  renderMedSessionList();
}
function renderMedSessionList(){
  if(!medEditorEl) return;
  const wrap = medEditorEl.querySelector('#medSessions');
  const sessions = readMedSessions();
  wrap.innerHTML = '';
  if(!sessions.length){ wrap.innerHTML = '<div class="empty">記録なし</div>'; return; }
  let total = 0;
  sessions.forEach((m,i)=>{ total += m; const row=document.createElement('div'); row.className='med-row'; row.innerHTML=`<span class="min">${m}分</span><span class="actions"><button data-edit="${i}" title="編集">✏</button><button data-del="${i}" title="削除">✕</button></span>`; wrap.appendChild(row); });
  const sum=document.createElement('div'); sum.className='med-total'; sum.textContent = `合計 ${total}分 / ${sessions.length}回`; wrap.appendChild(sum);
  wrap.querySelectorAll('button[data-edit]').forEach(b=> b.addEventListener('click', ()=>{
    const idx = parseInt(b.getAttribute('data-edit'),10);
    const cur = readMedSessions(); const curVal=cur[idx];
    const nvStr = prompt('新しい分数', curVal);
    if(nvStr===null) return; const nv=parseFloat(nvStr); if(!Number.isFinite(nv)||nv<=0){ alert('正の数'); return; }
  cur[idx]=nv; writeMedSessions(cur);
  }));
  wrap.querySelectorAll('button[data-del]').forEach(b=> b.addEventListener('click', ()=>{
    const idx = parseInt(b.getAttribute('data-del'),10);
  // delete both sessions and starts
  const md = readMonth(state.uid, state.year, state.month);
  const rec = md[medEditTarget.dateKey] || {};
  const sessions = Array.isArray(rec.sessions)? rec.sessions.slice(): [];
  const starts = Array.isArray(rec.starts)? rec.starts.slice(): [];
  sessions.splice(idx,1);
  if(starts.length>idx) starts.splice(idx,1);
  const ids = Array.isArray(rec.ids)? rec.ids.slice(): [];
  if(ids.length>idx) ids.splice(idx,1);
  md[medEditTarget.dateKey] = sessions.length? { sessions, starts, ids, dayTs:new Date().toISOString() } : { __deleted:true, ts:new Date().toISOString() };
  writeMonth(state.uid, state.year, state.month, md);
  if(window.syncAfterNewMeditationSession) window.syncAfterNewMeditationSession();
  renderCalendar(); renderMedSessionList();
  }));
}
function addMedSession(){
  const inp = medEditorEl.querySelector('#medNewMin');
  const v = parseFloat(inp.value); if(!Number.isFinite(v)||v<=0){ alert('正の数'); return; }
  addMedSessionWithStart(v, ''); inp.value=''; inp.focus();
}
function clearMedDay(){ writeMedSessions([]); hideMedEditor(); }

// ===== Timer (countdown with sound) =====
let medTimer = { id:null, running:false, endAt:0, remaining:0, startedAt:null };
let medAlarm = { ctx:null, osc:null, gain:null, on:false };
function fmtTime(ms){ const s=Math.ceil(ms/1000); const m=Math.floor(s/60); const ss=String(s%60).padStart(2,'0'); return `${m}:${ss}`; }
function updateTimerDisplay(){
  const el = medEditorEl?.querySelector('#medTimerDisplay');
  const st = medEditorEl?.querySelector('#medTimerStartedAt');
  if(!el) return;
  if(st){ st.textContent = medTimer.startedAt ? medTimer.startedAt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '--:--'; }
  if(medTimer.running){ el.textContent = fmtTime(Math.max(0, medTimer.endAt - Date.now())); }
  else { el.textContent = medTimer.remaining? fmtTime(medTimer.remaining) : '--:--'; }
}
function setTimerButtons({start,pause,resume,cancel}){
  const bS=medEditorEl?.querySelector('#medTimerStart'); if(bS) bS.disabled=!start;
  const bP=medEditorEl?.querySelector('#medTimerPause'); if(bP) bP.disabled=!pause;
  const bR=medEditorEl?.querySelector('#medTimerResume'); if(bR) bR.disabled=!resume;
  const bC=medEditorEl?.querySelector('#medTimerCancel'); if(bC) bC.disabled=!cancel;
  const bA=medEditorEl?.querySelector('#medAlarmStop'); if(bA) bA.disabled=!medAlarm.on;
}
function startAlarm(){
  try{
    if(medAlarm.on) return;
    const C = window.AudioContext || window.webkitAudioContext; if(!C) return; // no sound
    medAlarm.ctx = new C();
    medAlarm.osc = medAlarm.ctx.createOscillator();
    medAlarm.gain = medAlarm.ctx.createGain();
    medAlarm.osc.type = 'sawtooth';
    medAlarm.osc.frequency.value = 740;
    medAlarm.gain.gain.value = 0.06;
    medAlarm.osc.connect(medAlarm.gain).connect(medAlarm.ctx.destination);
    medAlarm.osc.start();
    medAlarm.on = true;
    // 断続的なON/OFF
    medAlarm._beepInt = setInterval(() => {
      if (!medAlarm.gain) return;
      // 0.4秒ON, 0.1秒OFF
      medAlarm.gain.gain.setValueAtTime(0.06, medAlarm.ctx.currentTime);
      setTimeout(() => {
        if (medAlarm.gain) medAlarm.gain.gain.setValueAtTime(0, medAlarm.ctx.currentTime);
      }, 400);
    }, 500);
    const bA = medEditorEl?.querySelector('#medAlarmStop'); if (bA) bA.disabled = false;
  } catch { }
  if (navigator.vibrate) try { navigator.vibrate([200, 150, 200, 150, 200]); } catch { }
}
function stopAlarm(){
  try {
    if (medAlarm._beepInt) { clearInterval(medAlarm._beepInt); medAlarm._beepInt = null; }
    if (medAlarm.osc) { medAlarm.osc.stop(); medAlarm.osc.disconnect(); }
    if (medAlarm.ctx) { medAlarm.ctx.close(); }
  } catch { }
  medAlarm = { ctx: null, osc: null, gain: null, on: false, _beepInt: null };
  const bA = medEditorEl?.querySelector('#medAlarmStop'); if (bA) bA.disabled = true;
}
function startMedTimer(){
  const min = parseFloat(medEditorEl.querySelector('#medTimerMin').value)||0;
  if(min<=0){ alert('分を入力してください'); return; }
  // Pre-flight reminders
  alert('イヤホンをつないでいませんか（有線）？\nイヤホンをつないでいませんか（ブルートゥース）？\n端末がミュートになっていないか確認してください。\n(画面上または本体の音量表示でミュート解除を目視確認してください)');
  // record start time
  medTimer.startedAt = new Date();
  medTimer.remaining = Math.round(min*60*1000);
  medTimer.endAt = Date.now() + medTimer.remaining;
  medTimer.running = true;
  setTimerButtons({start:false,pause:true,resume:false,cancel:true});
  updateTimerDisplay();
  if(medTimer.id) clearInterval(medTimer.id);
  medTimer.id = setInterval(()=>{
    const left = medTimer.endAt - Date.now();
    if(left<=0){
  clearInterval(medTimer.id); medTimer.id=null; medTimer.running=false; medTimer.remaining=0; updateTimerDisplay();
  startAlarm();
      // auto record minutes with start time
      addMedSessionWithStart(min, medTimer.startedAt.toISOString());
      setTimerButtons({start:true,pause:false,resume:false,cancel:false});
    } else { updateTimerDisplay(); }
  }, 250);
}
function pauseMedTimer(){ if(!medTimer.running) return; medTimer.running=false; medTimer.remaining = Math.max(0, medTimer.endAt - Date.now()); clearInterval(medTimer.id); medTimer.id=null; setTimerButtons({start:false,pause:false,resume:true,cancel:true}); updateTimerDisplay(); }
function resumeMedTimer(){ if(medTimer.running || !medTimer.remaining) return; medTimer.running=true; medTimer.endAt = Date.now() + medTimer.remaining; setTimerButtons({start:false,pause:true,resume:false,cancel:true}); if(medTimer.id) clearInterval(medTimer.id); medTimer.id=setInterval(()=>{ const left=medTimer.endAt-Date.now(); if(left<=0){ clearInterval(medTimer.id); medTimer.id=null; medTimer.running=false; medTimer.remaining=0; updateTimerDisplay(); startAlarm(); addMedSessionWithStart(parseFloat(medEditorEl.querySelector('#medTimerMin').value)||0, medTimer.startedAt?.toISOString()||''); setTimerButtons({start:true,pause:false,resume:false,cancel:false}); } else updateTimerDisplay(); },250); }
function cancelMedTimer(){ if(medTimer.id) clearInterval(medTimer.id); medTimer={id:null,running:false,endAt:0,remaining:0,startedAt:null}; setTimerButtons({start:true,pause:false,resume:false,cancel:false}); updateTimerDisplay(); }

// ===== Export / Import / Clear =====
function doExport(){
  const users = getAllUsers();
  const data = users[state.uid] || { data:{} };
  const payload = { ...data, finance: getFinance() };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${PAGE_PREFIX}-data-${state.uid}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function doImport(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const obj = JSON.parse(reader.result);
      const users = getAllUsers();
      const existing = users[state.uid] || { data:{} };
      existing.data = { ...(existing.data||{}), ...(obj.data||{}) };
      if(obj.pinHash) existing.pinHash = obj.pinHash;
      users[state.uid] = existing; setAllUsers(users);
      if(obj.finance) saveFinance(obj.finance);
      renderAll(); renderFinanceInputs();
      alert('インポート完了');
    } catch(e){ alert('JSON の読み込みに失敗しました'); }
  };
  reader.readAsText(file);
}

function clearThisMonth(){
  
  if(!confirm('この月の記録をクリアします。よろしいですか？')) return;
  writeMonth(state.uid, state.year, state.month, {});
  if(window.syncAfterNewMeditationSession) window.syncAfterNewMeditationSession();
  renderAll();
}

// ===== Render Root =====
function renderAll(){
  try{
    renderDOW();
    renderCalendar();
    const dbg=$('debug'); if(dbg) dbg.textContent='';
  }catch(e){ const dbg=$('debug'); if(dbg) dbg.textContent='Render error: '+(e.message||e); }
}

// ===== Events =====
// 安全なイベント登録ヘルパー (要素が無ければ無視)
function on(id, ev, handler){ const el=$(id); if(el) el.addEventListener(ev, handler); }

on('prevBtn','click', ()=>{ state.month--; if(state.month<0){ state.month=11; state.year--; } renderCalendar(); });
on('nextBtn','click', ()=>{ state.month++; if(state.month>11){ state.month=0; state.year++; } renderCalendar(); });
on('exportBtn','click', doExport);
on('saveFinance','click', ()=>{
  const fee = $('feeMonthly');
  if(!fee) return; // meditation 等 finance 無しページ
  const fin = {
    monthly: parseInt(fee.value||'0',10)||0,
    day: parseInt(($('priceDay')?.value)||'0',10)||0,
    transit: parseInt(($('costTransit')?.value)||'0',10)||0,
    other: parseInt(($('otherPer')?.value)||'0',10)||0,
  };
  saveFinance(fin);
  renderFinanceStats();
  if(window.syncAfterFinanceSave) window.syncAfterFinanceSave();
});
on('importFile','change', (e)=>{ const f=e.target.files && e.target.files[0]; if(f) doImport(f); });
on('clearMonthBtn','click', clearThisMonth);

// init (run after DOM ready)
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', ()=>{ renderAll(); adjustCalendarSize(); });
} else { renderAll(); adjustCalendarSize(); }

// ===== Responsive calendar height fit =====
function adjustCalendarSize(){
  try{
    const container = document.querySelector('.container.compact');
    const calGrid = $('calGrid');
    if(!container || !calGrid) return;
    const headerH = document.querySelector('.top-bar')?.offsetHeight || 0;
    const financeH = document.getElementById('financeCard')?.offsetHeight || 0;
    // weeks = number of row buttons groups
    const cells = calGrid.querySelectorAll('.cell').length;
    if(!cells) return;
    const weeks = Math.ceil(cells / 7);
    const dowRowH = $('dowRow').offsetHeight || 0;
  const available = window.innerHeight - headerH - financeH - 60; // reserved space
  const gap = 3;
  const per = Math.floor((available - dowRowH - (weeks*gap)) / weeks);
  const minTarget = Math.max(32, Math.min(56, per));
  document.documentElement.style.setProperty('--cell-min', minTarget + 'px');
  }catch(e){ /* ignore */ }
}
window.addEventListener('resize', ()=>{ clearTimeout(window.__cw_resize); window.__cw_resize=setTimeout(adjustCalendarSize,120); });

// ===== Finance rendering =====
function renderFinanceInputs(){
  // ページに finance 入力が無い場合 (meditation.html など) はスキップ
  const fee = $('feeMonthly');
  if(!fee) return;
  const f = getFinance();
  fee.value = f.monthly ?? '';
  const pd = $('priceDay'); if(pd) pd.value = f.day ?? '';
  const ct = $('costTransit'); if(ct) ct.value = f.transit ?? '';
  const ot = $('otherPer'); if(ot) ot.value = f.other ?? '';
}

function renderFinanceStats(attendedOverride){
  // finance UI が存在しなければ何もしない
  if(!$('feeMonthly')) return;
  const f = getFinance();
  const monthly = Number(f.monthly)||0;
  const perVisit = (Number(f.day)||0) + (Number(f.transit)||0) + (Number(f.other)||0);
  const attended = (typeof attendedOverride==='number') ? attendedOverride : (()=>{
    const md = readMonth(state.uid, state.year, state.month);
    return Object.values(md).filter(v=>v===1).length;
  })();
  const be = perVisit>0 ? Math.ceil(monthly / perVisit) : 0;
  const remaining = Math.max(0, be - attended);
  const eff = attended>0 ? Math.round(monthly/attended) : monthly;
  const delta = attended*perVisit - monthly; // +なら日割より損、-なら得

  const box = $('financeStats');
  if(box){
    box.innerHTML = '';
    box.append(
      makeStat(`想定1回コスト: <b>${perVisit.toLocaleString()}円</b>`),
      makeStat(`損益分岐の回数: <b>${be}</b> 回 / 今月の出席: <b>${attended}</b> 回`),
      makeStat(`分岐まで残り: <b>${remaining}</b> 回`),
      makeStat(`現在の実質1回単価(月額/出席): <b>${eff.toLocaleString()}円</b>`),
      makeStat(`${delta>=0?'日割より割高':'日割より割安'}: <b>${Math.abs(delta).toLocaleString()}円</b>`),
    );
  }

  // inline finance chips inside global stats row
  const globalStats = $('stats');
  if(globalStats && $('feeMonthly')){ // finance が有るページのみチップ表示
    // 既存 finance チップ除去
    [...globalStats.querySelectorAll('.fin-chip')].forEach(n=>n.remove());
    const mkChip = (label, valHtml)=>{ const c=document.createElement('div'); c.className='fin-chip'; c.innerHTML=`${label}: <b>${valHtml}</b>`; return c; };
    globalStats.append(
      mkChip('出席', `${attended}`),
      mkChip('分岐', be?`${be}`:'-'),
      mkChip('残り', remaining),
      mkChip('1回実質', eff?`${eff.toLocaleString()}円`:'-'),
      mkChip(delta>=0?'損差':'現損', `${Math.abs(delta).toLocaleString()}円`)
    );
  }
}

renderFinanceInputs();
renderFinanceStats();

/* ===== Optional Cloud Sync (Supabase + E2E crypto) =====
 * 無効化要求により以下の Supabase 関連コードをコメントアウトしています。
 * 再度有効化する場合はこのブロックを復元してください。
 *
const LS_CLOUD = 'cw_cloud_cfg_v1';
function getCloud(){ try{return JSON.parse(localStorage.getItem(LS_CLOUD))||{};}catch{return{}} }
function saveCloud(cfg){ localStorage.setItem(LS_CLOUD, JSON.stringify(cfg)); }
function renderCloudInputs(){ ... }
...（省略）...
renderCloudInputs();
autoCloudRestoreIfConfigured();
*/

// ===== S3 Sync via Vercel API (password-gated, presigned URL) =====
const LS_S3 = `${PAGE_PREFIX}_s3_cfg_v1`;
const LS_S3_GLOBAL = 'global_s3_cfg_v1';
function getS3Cfg(){
  // prefix優先 -> global -> 既知の他プレフィックス (med/cw) をフォールバック
  try{ const direct = JSON.parse(localStorage.getItem(LS_S3)||'null'); if(direct && Object.keys(direct).length) return direct; }catch{}
  try{ const global = JSON.parse(localStorage.getItem(LS_S3_GLOBAL)||'null'); if(global && Object.keys(global).length) return global; }catch{}
  try{
    const altKey = PAGE_PREFIX==='med' ? 'cw_s3_cfg_v1' : 'med_s3_cfg_v1';
    const alt = JSON.parse(localStorage.getItem(altKey)||'null'); if(alt && Object.keys(alt).length) return alt;
  }catch{}
  return {};
}
function saveS3Cfg(v){
  localStorage.setItem(LS_S3, JSON.stringify(v));
  try{ localStorage.setItem(LS_S3_GLOBAL, JSON.stringify(v)); }catch{}
}

function renderS3Inputs(){
  const c=getS3Cfg();
  $('s3DocId').value=c.docId||'';
  $('s3Passphrase').value=c.passphrase||'';
  $('s3Password').value=c.password||'';
  $('s3AutoRestore').checked=!!c.auto;
}

$('s3Push').addEventListener('click', async()=>{
  try{
    const docId=$('s3DocId').value.trim();
    const pass=$('s3Passphrase').value; // E2E
    const appPw=$('s3Password').value; // API password (server checks against ENV)
    if(!docId||!pass||!appPw){ alert('ドキュメントID/パスフレーズ/APP_PASSWORD を入力'); return; }
    // payload = local data + finance
    const users = getAllUsers();
    const data = users[state.uid] || { data:{} };
    const payload = { ...data, finance: getFinance() };
    const enc = await encryptJSON(payload, pass);
    // ask server for presigned PUT
    const r = await fetch('/api/sign-put', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ password: appPw, key: `${docId}.json.enc`, contentType:'application/octet-stream' }) });
    if(!r.ok){ const t=await r.text(); throw new Error('署名取得失敗: '+t); }
    const { url } = await r.json();
    const put = await fetch(url, { method:'PUT', body: enc, headers:{'content-type':'application/octet-stream'} });
    if(!put.ok) throw new Error('S3アップロード失敗');
  const keep = $('s3AutoRestore').checked; if(keep) saveS3Cfg({docId,passphrase:pass,password:appPw,auto:true});
  setSyncStatus('push完了');
  }catch(e){ alert(e.message||e); }
});

$('s3Pull').addEventListener('click', async()=>{
  try{
    const docId=$('s3DocId').value.trim();
    const pass=$('s3Passphrase').value;
    const appPw=$('s3Password').value;
    if(!docId||!pass||!appPw){ alert('ドキュメントID/パスフレーズ/APP_PASSWORD を入力'); return; }
    const r = await fetch(`/api/sign-get?key=${encodeURIComponent(docId+'.json.enc')}&password=${encodeURIComponent(appPw)}`);
    if(!r.ok){ const t=await r.text(); throw new Error('署名取得失敗: '+t); }
    const { url } = await r.json();
    const res = await fetch(url); if(!res.ok) throw new Error('S3ダウンロード失敗');
    const buf = await res.arrayBuffer();
    const obj = await decryptJSON(buf, pass);
    // merge
    const users = getAllUsers();
    const existing = users[state.uid] || { data:{} };
    existing.data = { ...(existing.data||{}), ...(obj.data||{}) };
    if(obj.pinHash) existing.pinHash = obj.pinHash;
    users[state.uid] = existing; setAllUsers(users);
    if(obj.finance) saveFinance(obj.finance);
    renderAll(); renderFinanceInputs(); renderFinanceStats();
  const keep = $('s3AutoRestore').checked; if(keep) saveS3Cfg({docId,passphrase:pass,password:appPw,auto:true});
  setSyncStatus('pull完了');
  }catch(e){ alert(e.message||e); }
});

function autoS3RestoreIfConfigured(){
  const c=getS3Cfg();
  if(c.auto && c.docId && c.passphrase && c.password){
    // silent pull
    $('s3DocId').value=c.docId; $('s3Passphrase').value=c.passphrase; $('s3Password').value=c.password; $('s3AutoRestore').checked=true;
    $('s3Pull').click();
  }
}

renderS3Inputs();
autoS3RestoreIfConfigured();

// ===== Encryption Helpers (AES-GCM, E2E) =====
// 以前の encryptJSON / decryptJSON が存在しない環境向けの軽量実装
// フォーマット: {v:1, alg:'AES-GCM', salt:base64, iv:base64, cipher:base64}
async function encryptJSON(obj, passphrase){
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(obj));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);
  const cipherBuf = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data);
  const payload = {
    v:1, alg:'AES-GCM',
    salt: b64FromBuf(salt),
    iv: b64FromBuf(iv),
    cipher: b64FromBuf(new Uint8Array(cipherBuf))
  };
  return new TextEncoder().encode(JSON.stringify(payload)).buffer;
}
async function decryptJSON(buf, passphrase){
  try{
    const txt = new TextDecoder().decode(buf);
    const obj = JSON.parse(txt);
    if(obj && obj.v===1 && obj.alg==='AES-GCM'){
      const salt = bufFromB64(obj.salt);
      const iv = bufFromB64(obj.iv);
      const cipher = bufFromB64(obj.cipher);
      const key = await deriveAesKey(passphrase, new Uint8Array(salt));
      const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:new Uint8Array(iv)}, key, cipher);
      return JSON.parse(new TextDecoder().decode(plain));
    }
    // プレーン JSON だった場合はそのまま返す
    return obj;
  }catch(e){ console.warn('[crypto] decrypt error', e); throw e; }
}
async function deriveAesKey(pass, salt){
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pass), {name:'PBKDF2'}, false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:120000, hash:'SHA-256'}, keyMaterial, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
function b64FromBuf(u8){ let s=''; for(let i=0;i<u8.length;i++) s+=String.fromCharCode(u8[i]); return btoa(s); }
function bufFromB64(b64){ const bin=atob(b64); const len=bin.length; const u8=new Uint8Array(len); for(let i=0;i<len;i++) u8[i]=bin.charCodeAt(i); return u8.buffer; }

// Auto save config & possibly start sync upon changes
['s3DocId','s3Passphrase','s3Password','s3AutoRestore'].forEach(id=>{
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener('input', ()=>{ persistS3ConfigAndMaybeStart(); });
  el.addEventListener('change', ()=>{ persistS3ConfigAndMaybeStart(); });
});

function persistS3ConfigAndMaybeStart(){
  const cfg = {
    docId: $('s3DocId').value.trim(),
    passphrase: $('s3Passphrase').value,
    password: $('s3Password').value,
    auto: $('s3AutoRestore').checked
  };
  saveS3Cfg(cfg);
  if(cfg.auto && cfg.docId && cfg.passphrase && cfg.password){
    restartAutoSync();
  }
}

// ===== Auto Sync (cross-device) =====
// 前提: ユーザーが S3 同期設定(docId/passphrase/password + 自動)を有効化していること。
// 方式:
//  1. 起動時に即座に pull。
//  2. 90秒ごとに pull。
//  3. ローカル変更(writeMonth/saveFinance/meditation session add/edit/delete)で markDirty() → 3秒デバウンス push。
//  4. 競合: per day マージ。work(0/1) は OR。meditation.sessions は分数+開始時刻ペアでユニーク統合(最大3件想定のため軽量)。finance は updatedAt 比較。
//  5. メタ: payload.__meta = { updatedAt: ISO, version: n }
//  6. 失敗時は次周期までリトライ。push 中の競合は最新 remote pull 後再push。

let __autoSync = {
  pollingMs: 90000,
  /* pushDebounceMs: 3000,  // 廃止 */
  dirty: false,
  pushing: false,
  timerPoll: null,
  /* timerPush: null, */
  lastRemoteVersion: 0,
  inited: false,
  mode: 'manual-new-only', // 新規入力完了時のみ同期
  editing: false,
  pendingPull: false
};

// 高速ポーリング拡張: 署名URLとETagキャッシュ
let __fastPull = {
  intervalMs: 1000,
  lastSignTime: 0,
  signTTL: 5000, // 5秒までは同じ presigned GET URL を再利用
  cachedGetUrl: null,
  lastETag: null,
  inFastLoop: false
};

function setSyncStatus(msg){
  const el = document.getElementById('syncStatus');
  if(el) el.textContent = msg;
}

function nowISO(){ return new Date().toISOString(); }

function buildPayload(){
  const users = getAllUsers();
  const data = users[state.uid] || { data:{} };
  const payload = { ...data, finance: getFinance() };
  if(!payload.__meta) payload.__meta = { version:0, updatedAt: nowISO() };
  return payload;
}

function bumpMeta(payload){
  if(!payload.__meta) payload.__meta = { version:0, updatedAt: nowISO() };
  payload.__meta.version = (payload.__meta.version||0)+1;
  payload.__meta.updatedAt = nowISO();
  return payload;
}

function mergePayload(localP, remoteP){
  if(!localP) return remoteP;
  if(!remoteP) return localP;
  const result = { ...localP };
  // finance: choose newer updatedAt if present
  if(remoteP.finance){
    if(!localP.finance) result.finance = remoteP.finance;
    else {
      const lu = localP.finance.__updatedAt || localP.__meta?.updatedAt || '1970';
      const ru = remoteP.finance.__updatedAt || remoteP.__meta?.updatedAt || '1970';
      result.finance = (ru > lu) ? remoteP.finance : localP.finance;
    }
  }
  // data: month maps
  result.data = result.data || {};
  const lData = localP.data || {};
  const rData = remoteP.data || {};
  const months = new Set([...Object.keys(lData), ...Object.keys(rData)]);
  for(const mk of months){
    const lMonth = lData[mk] || {};
    const rMonth = rData[mk] || {};
    const days = new Set([...Object.keys(lMonth), ...Object.keys(rMonth)]);
    const mergedMonth = {};
    for(const dk of days){
      const lVal = lMonth[dk];
      const rVal = rMonth[dk];
      if(lVal==null) { mergedMonth[dk]=rVal; continue; }
      if(rVal==null) { mergedMonth[dk]=lVal; continue; }
      // meditation style object or simple 0/1
      if(typeof lVal === 'object' || typeof rVal === 'object'){
        // tombstone precedence
        const lDel = lVal && lVal.__deleted;
        const rDel = rVal && rVal.__deleted;
        if(lDel || rDel){
          if(lDel && rDel){
            const lt = lVal.ts || '1970';
            const rt = rVal.ts || '1970';
            mergedMonth[dk] = rt > lt ? rVal : lVal;
            continue;
          }
          // 片方 tombstone, 片方 sessions: tombstone ts と dayTs を比較
          const delObj = lDel ? lVal : rVal;
          const liveObj = lDel ? rVal : lVal;
          const delTs = delObj.ts || '1970';
          const liveTs = liveObj.dayTs || '1970';
          if(liveTs > delTs){
            // 再追加が tombstone より新しいので復活（liveObj を採用）
            mergedMonth[dk] = liveObj;
          } else {
            mergedMonth[dk] = delObj; // tombstone 優先
          }
          continue;
        }
        const lSess = Array.isArray(lVal?.sessions)? lVal.sessions:[];
        const rSess = Array.isArray(rVal?.sessions)? rVal.sessions:[];
        const lStarts = Array.isArray(lVal?.starts)? lVal.starts:[];
        const rStarts = Array.isArray(rVal?.starts)? rVal.starts:[];
        const lIds = Array.isArray(lVal?.ids)? lVal.ids:[];
        const rIds = Array.isArray(rVal?.ids)? rVal.ids:[];
        const combined = [];
        const fp = (m,s)=>`${Math.round(m*100)/100}|${s}`;
        for(let i=0;i<lSess.length;i++){ const m=lSess[i]; const s=lStarts[i]||''; const fid='v_'+fp(m,s); combined.push({m, s, id:lIds[i]||fid}); }
        for(let i=0;i<rSess.length;i++){ const m=rSess[i]; const s=rStarts[i]||''; const fid='v_'+fp(m,s); combined.push({m, s, id:rIds[i]||fid}); }
        // collapse by fingerprint first, prefer real 'm' generated ids over synthetic 'v_' ids
        const byFp = new Map();
        combined.forEach(o=>{
          const f = fp(o.m,o.s);
            const cur = byFp.get(f);
            if(!cur) byFp.set(f,o);
            else {
              // choose one with real id (starts with 'm')
              const curReal = /^m[0-9a-z]/.test(cur.id);
              const oReal = /^m[0-9a-z]/.test(o.id);
              if(oReal && !curReal) byFp.set(f,o);
            }
        });
        const uniq = [...byFp.values()].slice(0, 48);
        mergedMonth[dk] = { sessions: uniq.map(o=>o.m), starts: uniq.map(o=>o.s), ids: uniq.map(o=>o.id), dayTs: (lVal.dayTs||rVal.dayTs||new Date().toISOString()) };
      } else {
        // numeric OR (presence)
        mergedMonth[dk] = (lVal || rVal) ? 1 : 0;
      }
    }
    // prune empty days for meditation object if sessions empty
    Object.keys(mergedMonth).forEach(dk=>{
      const v = mergedMonth[dk];
      if(v && v.__deleted){ return; }
      if(v && typeof v==='object' && Array.isArray(v.sessions) && v.sessions.length===0) delete mergedMonth[dk];
    });
    result.data[mk] = mergedMonth;
  }
  // meta: choose newer updatedAt
  const lu = localP.__meta?.updatedAt || '1970';
  const ru = remoteP.__meta?.updatedAt || '1970';
  result.__meta = (ru>lu) ? remoteP.__meta : localP.__meta;
  return result;
}

async function autoPull(){
  const cfg = getS3Cfg();
  if(!cfg.auto || !cfg.docId || !cfg.passphrase || !cfg.password) return;
  if(__autoSync.editing){
    __autoSync.pendingPull = true;
    setSyncStatus('editing - skip pull');
    return;
  }
  try{
    // 署名URLキャッシュ利用
    let useUrl = __fastPull.cachedGetUrl;
    const now = Date.now();
    if(!useUrl || (now - __fastPull.lastSignTime) > __fastPull.signTTL){
      const r = await fetch(`/api/sign-get?key=${encodeURIComponent(cfg.docId+'.json.enc')}&password=${encodeURIComponent(cfg.password)}`);
      if(r.status===401){ console.warn('[sync] pull unauthorized (APP_PASSWORD mismatch?)'); setSyncStatus('401 Unauthorized (APP_PASSWORD?)'); return; }
      if(!r.ok){
        const txt = await r.text().catch(()=> '');
        if(txt.includes('S3_BUCKET not set')){ console.warn('[sync] server missing S3_BUCKET env'); setSyncStatus('Server missing S3_BUCKET env var'); }
        else { console.warn('[sync] pull non-200', r.status, txt); setSyncStatus('pull failed '+r.status); }
        return;
      }
      const { url } = await r.json();
      __fastPull.cachedGetUrl = url; __fastPull.lastSignTime = now; useUrl = url;
    }

    // 条件付き取得 (If-None-Match) 対応: presigned URL で 304 が得られない場合もあるが、S3 は ETag 比較には HEAD を推奨。ここでは GET して ETag 同じなら decode スキップ。
    const res = await fetch(useUrl, { cache:'no-store' });
    if(!res.ok){ return; }
    const etag = res.headers.get('ETag');
    if(etag && etag === __fastPull.lastETag){
      // 変更無し: ステータス更新のみ最小化
      setSyncStatus('idle (v'+__autoSync.lastRemoteVersion+')');
      return;
    }
    if(etag) __fastPull.lastETag = etag;
    setSyncStatus('pulling...');
    const buf = await res.arrayBuffer();
    const remote = await decryptJSON(buf, cfg.passphrase);
    if(!remote.__meta){ remote.__meta = { version:0, updatedAt: nowISO() }; }
    // decide merge
    const users = getAllUsers();
    const existing = users[state.uid] || { data:{} };
    const localPayload = { ...existing, finance: getFinance(), __meta: existing.__meta || { version:0, updatedAt: nowISO() } };
    const merged = mergePayload(localPayload, remote);
    // if merged differs (simple stringify compare)
    if(JSON.stringify(merged.data) !== JSON.stringify(localPayload.data) || JSON.stringify(merged.finance) !== JSON.stringify(localPayload.finance)){
      users[state.uid] = { data: merged.data, pinHash: localPayload.pinHash, __meta: merged.__meta };
      setAllUsers(users);
      if(merged.finance) saveFinance(merged.finance);
      renderAll(); renderFinanceInputs(); renderFinanceStats();
      console.info('[sync] pulled & merged');
      setSyncStatus('pulled & merged v'+(remote.__meta.version||0));
    }
    __autoSync.lastRemoteVersion = remote.__meta.version || 0;
    setSyncStatus('idle (v'+__autoSync.lastRemoteVersion+')');
  }catch(e){ console.warn('[sync] pull error', e); }
}

async function autoPush(){
  if(!__autoSync.dirty || __autoSync.pushing) return;
  const cfg = getS3Cfg();
  if(!cfg.auto || !cfg.docId || !cfg.passphrase || !cfg.password) return;
  try{
    __autoSync.pushing = true;
    let safety = 3; // 最大3連続 (バースト追加想定)
    while(__autoSync.dirty && safety>0){
      __autoSync.dirty = false;
      setSyncStatus('pushing...');
      const users = getAllUsers();
      const existing = users[state.uid] || { data:{} };
      const payload = { ...existing, finance: getFinance(), __meta: existing.__meta || { version:0, updatedAt: nowISO() } };
      bumpMeta(payload);
      users[state.uid] = { ...existing, data: payload.data, pinHash: existing.pinHash, __meta: payload.__meta };
      setAllUsers(users);
      if(payload.finance){ payload.finance.__updatedAt = payload.__meta.updatedAt; }
      const enc = await encryptJSON(payload, cfg.passphrase);
      const sign = await fetch('/api/sign-put', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ password: cfg.password, key: `${cfg.docId}.json.enc`, contentType:'application/octet-stream' }) });
      if(sign.status===401){ console.warn('[sync] push unauthorized (APP_PASSWORD mismatch?)'); setSyncStatus('401 Unauthorized (push)'); __autoSync.dirty=true; break; }
      if(!sign.ok){
        const txt = await sign.text().catch(()=> '');
        if(txt.includes('S3_BUCKET not set')){ console.warn('[sync] server missing S3_BUCKET env (push)'); setSyncStatus('Server missing S3_BUCKET env var'); }
        else { console.warn('[sync] sign-put failed', sign.status, txt); setSyncStatus('sign-put failed '+sign.status); }
        __autoSync.dirty=true; break;
      }
      const { url } = await sign.json();
      const put = await fetch(url, { method:'PUT', body: enc, headers:{'content-type':'application/octet-stream'} });
      if(!put.ok){ console.warn('[sync] S3 PUT failed', put.status); __autoSync.dirty=true; break; }
      console.info('[sync] pushed v'+payload.__meta.version);
      setSyncStatus('pushed v'+payload.__meta.version+' (verifying)');
      try{
        const oldETag = __fastPull.lastETag; __fastPull.lastETag = null; await autoPull(); if(!__fastPull.lastETag) __fastPull.lastETag = oldETag;
      }catch(e){ console.warn('[sync] immediate verify pull failed', e); }
      safety--;
    }
  }catch(e){ console.warn('[sync] push error', e); __autoSync.dirty=true; }
  finally { __autoSync.pushing=false; }
}

function markDirtyImmediate(){
  // すぐ push する（新規入力完了時のみ呼ばれる想定）
  __autoSync.dirty = true;
  autoPush();
}

// 既存 writeMonth/saveFinance は多くの編集で呼ばれ復活問題の一因。フックをかけず、
// 新規入力完了箇所（例: meditation セッション追加完了 / 出席トグル / finance 保存ボタン押下時）から明示的に markDirtyImmediate を呼ぶ。

function installAutoSyncHooks(){
  if(__autoSync.inited) return;
  __autoSync.inited = true;
  // 手動モード: 既存関数を書き換えない。必要箇所から sync trigger を呼ぶ。
}

// 旧データ重複 (L*/R* 仮ID由来 / m|s 同一) を日単位で除去
function cleanupLegacyMeditationDuplicates(){
  try{
    const users = getAllUsers();
    const u = users[state.uid]; if(!u||!u.data) return;
    let changed = false;
    for(const monthKey of Object.keys(u.data)){
      const month = u.data[monthKey]; if(!month||typeof month!== 'object') continue;
      for(const dayKey of Object.keys(month)){
        const rec = month[dayKey];
        if(!rec || rec.__deleted) continue;
        if(!Array.isArray(rec.sessions)) continue;
        const sess = rec.sessions; const starts = Array.isArray(rec.starts)? rec.starts:[]; const ids = Array.isArray(rec.ids)? rec.ids:[];
        const fp = (m,s)=> (Math.round(m*100)/100)+'|'+s;
        const map = new Map();
        const newSess=[]; const newStarts=[]; const newIds=[];
        for(let i=0;i<sess.length;i++){
          const m = sess[i]; const s = starts[i]||''; const id = ids[i];
          const f = fp(m,s);
          const cur = map.get(f);
          const real = id && /^m[0-9a-z]/.test(id);
          if(!cur){
            map.set(f,{m,s,id: real? id : ('m'+Date.now().toString(36)+Math.random().toString(36).slice(2,7))});
          } else {
            if(real && !/^m[0-9a-z]/.test(cur.id)) map.set(f,{m,s,id});
          }
        }
        for(const v of map.values()){ newSess.push(v.m); newStarts.push(v.s); newIds.push(v.id); }
        if(newSess.length !== sess.length){
          rec.sessions = newSess; rec.starts = newStarts; rec.ids = newIds; rec.dayTs = new Date().toISOString(); changed = true;
        }
      }
    }
    if(changed){
      users[state.uid] = u; setAllUsers(users); renderAll();
      // 後で push されるよう dirty マーク
      if(window.markDirtyImmediate) markDirtyImmediate();
    }
  }catch(e){ console.warn('[cleanup] failed', e); }
}

// 初回ロード時一度だけクリーンアップ（重複が見つかった場合再pushされる）
setTimeout(()=>{ cleanupLegacyMeditationDuplicates(); }, 500);

// 明示トリガ用ヘルパ（後で既存コードの追加ポイントから使用）
window.syncAfterNewMeditationSession = ()=>{ markDirtyImmediate(); };
window.syncAfterNewWorkToggle = ()=>{ markDirtyImmediate(); };
window.syncAfterFinanceSave = ()=>{ markDirtyImmediate(); };
// ---- Editing soft-lock for meditation editor ----
window.beginMeditationEdit = ()=>{
  if(!__autoSync.editing){
    __autoSync.editing = true;
    setSyncStatus('editing (pull paused)');
  }
  resetEditIdleTimer();
};
window.endMeditationEdit = (force)=>{
  if(!__autoSync.editing) return;
  __autoSync.editing = false;
  const need = __autoSync.pendingPull; __autoSync.pendingPull=false;
  setSyncStatus('edit done');
  if(need || force){ setTimeout(()=> autoPull(), 150); }
};
function resetEditIdleTimer(){
  clearTimeout(window.__medEditIdleTimer);
  window.__medEditIdleTimer = setTimeout(()=>{ window.endMeditationEdit(); }, 8000);
}

function startAutoSync(){
  const cfg = getS3Cfg();
  if(!cfg.auto || !cfg.docId || !cfg.passphrase || !cfg.password){
    const miss=[];
    if(!cfg.auto) miss.push('auto=false');
    if(!cfg.docId) miss.push('docId');
    if(!cfg.passphrase) miss.push('passphrase');
    if(!cfg.password) miss.push('APP_PASSWORD');
    console.info('[sync] auto sync disabled or incomplete config -> missing:', miss.join(','));
    setSyncStatus('config incomplete: '+miss.join(', '));
    return;
  }
  installAutoSyncHooks();
  console.info('[sync] start: attempting initial pull');
  setSyncStatus('initial pull...');
  autoPull().then(()=>{
    // 初回pullだけで remote が空の場合、ローカルを push するため dirty をセット
  setTimeout(()=>{ markDirtyImmediate(); }, 1200);
  });
  // 通常ポーリング停止し高速ループ開始
  if(!__fastPull.inFastLoop){
    __fastPull.inFastLoop = true;
    const loop = async()=>{
      try{ await autoPull(); }catch(e){ /* swallow */ }
      if(__fastPull.inFastLoop) setTimeout(loop, __fastPull.intervalMs);
    };
    loop();
    console.info('[sync] fast polling started ('+__fastPull.intervalMs+'ms)');
    setSyncStatus('fast polling '+__fastPull.intervalMs+'ms');
  }
}

function stopAutoSync(){
  __fastPull.inFastLoop = false;
  console.info('[sync] auto sync stopped');
}

function restartAutoSync(){
  stopAutoSync();
  __autoSync.inited=false; // allow hooks again (idempotent safety)
  startAutoSync();
}

// Start after DOM load & potential auto restore
setTimeout(startAutoSync, 1500);

// Manual debug helpers
window.forcePull = autoPull;
window.forcePush = ()=>{ markDirty(); autoPush(); };