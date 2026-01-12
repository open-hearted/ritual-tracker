// meditation-cloud.js
// Minimal, self-contained meditation page using Google ID token and server PUT/GET to store plaintext JSON.
const $ = id => document.getElementById(id);
const STATE = { year: new Date().getFullYear(), month: new Date().getMonth(), payload: {}, selected: null };
const STORAGE_KEY = 'med_cloud_google_auth_v1';
const TOKEN_TTL_MS = 24*60*60*1000;

function nowISO(){ return new Date().toISOString(); }

function parseJwtPayload(token){
  try{
    const base64Url = token.split('.')[1] || '';
    const base64 = base64Url.replace(/-/g,'+').replace(/_/g,'/');
    const bin = atob(base64);
    const bytes = Uint8Array.from(Array.from(bin, c=>c.charCodeAt(0)));
    if(typeof TextDecoder !== 'undefined') return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    const pct = Array.from(bin).map(c=>'%' + ('00'+c.charCodeAt(0).toString(16)).slice(-2)).join('');
    return JSON.parse(decodeURIComponent(pct));
  }catch(e){ try{ return JSON.parse(atob(token.split('.')[1]||'')); }catch{return null;} }
}

let idToken = null; let userProfile = null;

async function initGSI(){
  try{
    const cfg = await fetch('/api/config').then(r=>r.json()).catch(()=>({}));
    const clientId = cfg.googleClientId || '';
    if(!clientId){ setMsg('GSI not configured'); return; }
    if(window.google && google.accounts && google.accounts.id){
        google.accounts.id.initialize({ client_id: clientId, callback: handleCred });
        google.accounts.id.renderButton($('gsiButtonContainer'), { theme:'outline', size:'large' });
        // Only show the account chooser/prompt if we don't already have a restored idToken.
        // tryRestore() is called before initGSI() on load and will set `idToken` when a
        // valid token exists in localStorage and is within TOKEN_TTL_MS.
        if(!idToken){
          google.accounts.id.prompt();
        }
    } else setMsg('Google sign-in not loaded');
  }catch(e){ console.warn(e); setMsg('GSI init error'); }
}

function handleCred(resp){ if(resp && resp.credential){ idToken = resp.credential; const p = parseJwtPayload(idToken)||{}; userProfile = { email:p.email, name:p.name }; try{ localStorage.setItem(STORAGE_KEY, JSON.stringify({ idToken, userProfile, ts: Date.now() })); }catch{}; updateUiForAuth(true); med_loadAll(); }}

function tryRestore(){ try{ const raw = localStorage.getItem(STORAGE_KEY); if(!raw) return false; const rec = JSON.parse(raw); if(rec && rec.idToken && (Date.now()-rec.ts) < TOKEN_TTL_MS){ idToken = rec.idToken; const parsed = parseJwtPayload(idToken); userProfile = parsed? { email: parsed.email, name: parsed.name } : rec.userProfile; updateUiForAuth(true); med_loadAll(); return true; } }catch(e){ } try{ localStorage.removeItem(STORAGE_KEY);}catch{} return false; }

function updateUiForAuth(isAuth){
  const calCard = document.querySelector('.card.cal-card');
  const gsi = $('gsiButtonContainer');
  const so = $('signOutBtn');
  // Ensure page-level auth state is reflected so CSS can hide/show elements reliably
  try{ document.body.setAttribute('data-auth', isAuth ? 'true' : 'false'); }catch(e){}
  if(!isAuth){ if(calCard) calCard.style.display='none'; if(gsi) gsi.style.display='block'; if(so) so.style.display='none'; }
  else { if(calCard) calCard.style.display=''; if(gsi) gsi.style.display='none'; if(so) so.style.display='inline-block'; }
}


function setMsg(s){ const m=$('msg'); if(m) m.textContent = s||''; }

function renderDOW(){ const row = $('dowRow'); row.innerHTML=''; ['月','火','水','木','金','土','日'].forEach(n=>{ const d=document.createElement('div'); d.className='dow'; d.textContent=n; row.appendChild(d); }); }
function daysInMonth(y,m){ return new Date(y,m+1,0).getDate(); }
function getDateKey(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function getMonthKey(){ return `${STATE.year}-${String(STATE.month+1).padStart(2,'0')}`; }

function renderCalendar(){ const grid=$('calGrid'); grid.innerHTML=''; $('monthLabel').textContent = `${STATE.year}年 ${STATE.month+1}月`; const startPad = (new Date(STATE.year, STATE.month,1).getDay()+6)%7; for(let i=0;i<startPad;i++){ const p=document.createElement('div'); p.className='cell disabled'; p.style.visibility='hidden'; grid.appendChild(p);} const days = daysInMonth(STATE.year, STATE.month); const monthData = (STATE.payload && STATE.payload.data && STATE.payload.data[getMonthKey()]) ? STATE.payload.data[getMonthKey()] : {}; const todayKey = getDateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()); for(let d=1; d<=days; d++){ const btn=document.createElement('button'); btn.type='button'; btn.className='cell'; const dk = getDateKey(STATE.year, STATE.month, d); btn.setAttribute('data-date', dk); const rec = monthData[dk] || {}; const sess = Array.isArray(rec.sessions)? rec.sessions : []; const ex = Array.isArray(rec.exercise?.sessions)? rec.exercise.sessions : []; if(sess.length || ex.length) btn.setAttribute('data-has','1'); if(dk===todayKey) btn.classList.add('today'); btn.innerHTML = `<div class="d">${d}</div><div style="font-size:0.85em">${sess.length? sess.reduce((a,b)=>a+b,0)+'分':''}</div>`; btn.addEventListener('click', ()=> openEditorFor(dk)); grid.appendChild(btn); } }

function openEditorFor(dateKey){
  STATE.selected = dateKey;
  const ed = $('medEditor');
  $('editDate').textContent = dateKey;
  // fetch latest payload from server before opening editor
  med_loadAll().then(()=>{
    const monthObj = STATE.payload.data && STATE.payload.data[getMonthKey()] ? STATE.payload.data[getMonthKey()] : {};
    const rec = monthObj[dateKey] || {};
    // populate diary and session list
    try{ const diary = rec.diary?.text || ''; const txt = $('medDiaryText'); if(txt) txt.value = diary; }catch(e){}
    renderMedSessionList();
    renderWakeSleep();
    renderExerciseList();
    renderAllRecordsTimeline(); // 統一表示
    ed.style.display='block';
  }).catch(()=>{
    // fallback to local payload if GET fails
    const monthObj = STATE.payload.data && STATE.payload.data[getMonthKey()] ? STATE.payload.data[getMonthKey()] : {};
    const rec = monthObj[dateKey] || {};
    try{ const diary = rec.diary?.text || ''; const txt = $('medDiaryText'); if(txt) txt.value = diary; }catch(e){}
    renderMedSessionList();
    renderWakeSleep();
    renderExerciseList();
    renderAllRecordsTimeline(); // 統一表示
    ed.style.display='block';
  });
}

function autoSaveEditor(){
  try{
    const dk = STATE.selected; if(!dk) return;
    const mk = getMonthKey(); STATE.payload.data = STATE.payload.data || {};
    STATE.payload.data[mk] = STATE.payload.data[mk] || {};
    const rec = STATE.payload.data[mk][dk] || {};
    const diaryEl = $('medDiaryText');
    const diaryTxt = diaryEl ? (diaryEl.value || '') : '';
    if(diaryTxt){ rec.diary = { text: diaryTxt, updatedAt: nowISO() }; }
    else { if(rec && rec.diary) delete rec.diary; }
    rec.dayTs = nowISO();
    STATE.payload.data[mk][dk] = rec;
    // fire save but don't block close
    try{ med_saveAll(); }catch(e){ console.warn('autosave failed', e); }
  }catch(e){ console.warn('autoSaveEditor error', e); }
}

function closeEditor(){
  // auto-save current diary text before hiding
  try{ autoSaveEditor(); }catch(e){}
  const ed = $('medEditor'); if(ed) ed.style.display='none';
}

async function med_loadAll(){ if(!idToken){ setMsg('ログインしてください'); return; } setMsg('読み込み中...'); try{ const res = await fetch('/api/meditation-get', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ idToken }) }); if(!res.ok){ const txt = await res.text().catch(()=>''); setMsg('読み込み失敗'); console.warn('med load failed', res.status, txt); return; } const j = await res.json(); // expected j.data or j
    const payload = j.data && Object.keys(j.data).length ? j.data : (j || {});
    // normalize: if payload has data field already, keep
    if(payload && payload.data){ STATE.payload = payload; } else { STATE.payload = { data: payload }; }
    // ensure structure
    STATE.payload.data = STATE.payload.data || {};
    renderCalendar(); setMsg('');
  }catch(e){ console.error(e); setMsg('読み込み失敗'); }
}

async function med_saveAll(){ if(!idToken){ setMsg('ログインしてください'); return; } try{ setMsg('保存中...'); const mk = getMonthKey(); // ensure payload shape
    STATE.payload.__meta = STATE.payload.__meta || { version:0, updatedAt: nowISO() };
    STATE.payload.__meta.version = (STATE.payload.__meta.version||0) + 1;
    STATE.payload.__meta.updatedAt = nowISO();
    const res = await fetch('/api/meditation-put', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ idToken, data: STATE.payload }) }); if(!res.ok){ const txt = await res.text().catch(()=>''); setMsg('保存失敗'); console.warn('save failed', res.status, txt); return; } const j = await res.json().catch(()=>({})); if(j && j.ok){ setMsg('保存完了'); renderCalendar(); } else { setMsg('保存失敗'); } }catch(e){ console.error(e); setMsg('保存エラー'); } }

function attachHandlers(){
  $('prevBtn').addEventListener('click', ()=>{ STATE.month--; if(STATE.month<0){ STATE.month=11; STATE.year--; } renderCalendar(); });
  $('nextBtn').addEventListener('click', ()=>{ STATE.month++; if(STATE.month>11){ STATE.month=0; STATE.year++; } renderCalendar(); });
  $('todayBtn').addEventListener('click', ()=>{ const n=new Date(); STATE.year=n.getFullYear(); STATE.month=n.getMonth(); renderCalendar(); setTimeout(()=>{ const key = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; const el = document.querySelector(`.cell[data-date="${key}"]`); if(el){ el.click(); el.scrollIntoView({block:'nearest'}); } },50); });
  $('closeEditor').addEventListener('click', closeEditor);
  const _saveBtn = $('saveEditor');
  if(_saveBtn){
    _saveBtn.addEventListener('click', ()=>{
      // write back (fallback if the button exists)
      const dk = STATE.selected;
      if(!dk){ closeEditor(); return; }
      const mk = getMonthKey();
      STATE.payload.data[mk] = STATE.payload.data[mk] || {};
      const rec = STATE.payload.data[mk][dk] || {};
      // sessions are stored by renderMedSessionList / add handler
      rec.sessions = Array.isArray(rec.sessions)? rec.sessions : [];
      rec.starts = Array.isArray(rec.starts)? rec.starts : [];
      rec.ids = Array.isArray(rec.ids)? rec.ids : [];
      rec.dayTs = nowISO();
      const diaryTxt = $('medDiaryText').value || '';
      if(diaryTxt) rec.diary = { text: diaryTxt, updatedAt: nowISO() };
      else delete rec.diary;
      STATE.payload.data[mk][dk] = rec;
      closeEditor(); med_saveAll();
    });
  }

  $('signOutBtn').addEventListener('click', ()=>{
    idToken = null; userProfile = null;
    try{ localStorage.removeItem(STORAGE_KEY); }catch{}
    updateUiForAuth(false);
    try{ const ed = $('medEditor'); if(ed) ed.style.display='none'; }catch{}
    setMsg('サインアウト');
  });

  // 日記に現在時刻を挿入するボタン
  const insertTimeBtn = $('insertTimeBtn');
  if(insertTimeBtn){
    insertTimeBtn.addEventListener('click', (ev)=>{
      try{
        ev.preventDefault(); ev.stopPropagation();
        const ta = $('medDiaryText'); if(!ta) return;
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
        // insert at cursor / replace selection
        const start = (typeof ta.selectionStart === 'number') ? ta.selectionStart : ta.value.length;
        const end = (typeof ta.selectionEnd === 'number') ? ta.selectionEnd : start;
        const before = ta.value.slice(0, start);
        const after = ta.value.slice(end);
        // if there's already a trailing space around insertion, avoid doubling
        const insertText = timeStr;
        ta.value = before + insertText + after;
        const newPos = start + insertText.length;
        ta.selectionStart = ta.selectionEnd = newPos;
        ta.focus();
        // autosave diary state
        try{ autoSaveEditor(); }catch(e){ console.warn('autosave after insert failed', e); }
      }catch(e){ console.warn('insertTimeBtn handler error', e); }
    });
  }
}

window.addEventListener('load', ()=>{ renderDOW(); renderCalendar(); attachHandlers(); tryRestore(); initGSI(); });

// Override renderCalendar to show compact markers in calendar cells:
// P = プランク, 🪑 = 空気椅子, 瞑## = 瞑想合計分, 📝 = 日記
// This override populates a small markers line under the day number so calendar
// indicates which kinds of records exist without showing seconds.
renderCalendar = function(){
  const grid = $('calGrid'); if(!grid) return;
  grid.innerHTML = '';
  $('monthLabel').textContent = `${STATE.year}年 ${STATE.month+1}月`;
  const startPad = (new Date(STATE.year, STATE.month,1).getDay()+6)%7;
  for(let i=0;i<startPad;i++){ const p=document.createElement('div'); p.className='cell disabled'; p.style.visibility='hidden'; grid.appendChild(p); }
  const days = daysInMonth(STATE.year, STATE.month);
  const monthData = (STATE.payload && STATE.payload.data && STATE.payload.data[getMonthKey()]) ? STATE.payload.data[getMonthKey()] : {};
  const todayKey = getDateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  for(let d=1; d<=days; d++){
    const btn = document.createElement('button'); btn.type='button'; btn.className='cell';
    const dk = getDateKey(STATE.year, STATE.month, d);
    btn.setAttribute('data-date', dk);
    btn.innerHTML = `<div class="d">${d}</div><div class="markers" style="font-size:0.85em"></div>`;
    if(dk===todayKey) btn.classList.add('today');
    btn.addEventListener('click', ()=> openEditorFor(dk));
    grid.appendChild(btn);
  }

  // fill markers after creating nodes
  Array.from(grid.querySelectorAll('.cell')).forEach(cell=>{
    const dk = cell.getAttribute('data-date'); if(!dk) return;
    const rec = monthData[dk] || {};
    const legacySess = Array.isArray(rec.sessions)? rec.sessions : [];
    const ex = Array.isArray(rec.exercise?.sessions)? rec.exercise.sessions : [];
    let hasPlank=false, hasWall=false, hasDiary=false;
    // accumulate meditation seconds (legacy sessions stored as minutes)
    let medSeconds = 0;
    if(legacySess.length) medSeconds += legacySess.reduce((a,b)=>a + (Number(b||0)*60), 0);
    if(Array.isArray(ex) && ex.length){
      ex.forEach(it=>{
        const t = (it.type||'').toString(); const tl = t.toLowerCase();
        if(t==='プランク' || tl==='plank') hasPlank = true;
        if(t==='空気椅子' || tl==='wall' || tl==='chair') hasWall = true;
        if(t==='瞑想' || tl.includes('瞑') || tl==='meditation'){
          medSeconds += Number(it.seconds)||0;
        }
      });
    }
    if(rec.diary && rec.diary.text) hasDiary = true;
    const markers = [];
    if(hasPlank) markers.push('<span class="cal-mark">P</span>');
    if(hasWall) markers.push('<span class="cal-mark">🪑</span>');
    if(medSeconds>0){
      const minutes = Math.floor(medSeconds/60);
      if(minutes>0) markers.push(`<span class="cal-mark">瞑${minutes}</span>`);
      else markers.push(`<span class="cal-mark">瞑</span>`);
    }
    if(hasDiary) markers.push('<span class="cal-mark">📝</span>');
    const wrap = cell.querySelector('.markers'); if(wrap) wrap.innerHTML = markers.join(' ');
    if(markers.length) cell.setAttribute('data-has','1'); else cell.removeAttribute('data-has');
  });
};

// --- Lightweight med editor helpers for meditation-cloud ---
function getDayRecord(dateKey){
  const mk = getMonthKey();
  STATE.payload.data = STATE.payload.data || {};
  STATE.payload.data[mk] = STATE.payload.data[mk] || {};
  let rec = STATE.payload.data[mk][dateKey];
  if(!rec){
    rec = { sessions: [], starts: [], ids: [], times: {} };
    STATE.payload.data[mk][dateKey] = rec;
  } else {
    if(!rec.times) rec.times = {};
    if(!Array.isArray(rec.sessions)) rec.sessions = [];
    if(!Array.isArray(rec.starts)) rec.starts = [];
    if(!Array.isArray(rec.ids)) rec.ids = [];
  }
  return rec;
}

// helper: attach behavior to inputs to avoid credential autofill/password UI on mobile
function attachNoCredentialBehavior(el){ if(!el) return; try{ el.setAttribute('autocomplete','off'); el.setAttribute('autocorrect','off'); el.setAttribute('autocapitalize','none'); el.setAttribute('spellcheck','false'); }catch(e){}
  const randName = ()=> 'nr_'+Date.now()+'_'+Math.random().toString(36).slice(2);
  const doRandomize = ()=>{ try{ el.setAttribute('name', randName()); el.setAttribute('autocomplete', 'nope'+Date.now()); }catch(e){} };
  el.addEventListener('focus', doRandomize);
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints>0);
  if(isTouch){ try{ el.readOnly = true; el.addEventListener('touchstart', function onTS(e){ el.readOnly = false; doRandomize(); el.focus(); setTimeout(()=>{ el.removeEventListener('touchstart', onTS); },300); }); }catch(e){} }
}

function renderMedSessionList(){
  const wrap = $('medSessions'); if(!wrap) return; wrap.innerHTML=''; const dk = STATE.selected; if(!dk) return; const rec = getDayRecord(dk); const sessions = Array.isArray(rec.sessions)? rec.sessions : []; const starts = Array.isArray(rec.starts)? rec.starts : []; const ids = Array.isArray(rec.ids)? rec.ids : [];
  if(!sessions.length){ wrap.innerHTML = ''; renderWakeSleep(); return; }
  
  // Create array of session objects with original indices for sorting
  const sessionData = sessions.map((m, i) => ({
    minutes: m,
    startIso: starts[i] || '',
    id: ids[i] || '',
    originalIndex: i
  }));
  
  // Sort by start time (earliest first)
  sessionData.sort((a, b) => {
    if (!a.startIso && !b.startIso) return 0;
    if (!a.startIso) return 1;
    if (!b.startIso) return -1;
    return new Date(a.startIso) - new Date(b.startIso);
  });
  
  sessionData.forEach((item, displayIndex)=>{
    const m = item.minutes;
    const startIso = item.startIso;
    const originalIndex = item.originalIndex;
    const startTxt = startIso ? new Date(startIso).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '--:--';
    const row = document.createElement('div');
  row.className='med-row';
  row.style.display='flex'; row.style.justifyContent='space-between'; row.style.alignItems='center'; row.style.padding='6px'; row.style.borderRadius='0'; row.style.background='transparent'; row.style.color='#ffffff';
  row.setAttribute('data-med-idx', String(originalIndex));
  row.innerHTML = `<div style="font-weight:700">${startTxt} <span style="font-weight:400;margin-left:8px">瞑想 ${m}分</span></div>` +
                    `<div style="display:flex;gap:8px"><button data-edit="${originalIndex}">✏</button><button data-del="${originalIndex}">✕</button></div>`;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('button[data-edit]').forEach(b=> b.addEventListener('click', (ev)=>{
    try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
    const idx = parseInt(b.getAttribute('data-edit'),10);
    // prompt-based edit: minutes then optional start time
    const dk = STATE.selected; if(!dk) return;
    const rec = getDayRecord(dk);
    const cur = rec.sessions || [];
    const starts = Array.isArray(rec.starts)? rec.starts.slice() : [];
    const curVal = cur[idx];
    const nvStr = prompt('新しい分数', curVal);
    if(nvStr === null) return;
    const nv = parseFloat(nvStr);
    if(!Number.isFinite(nv) || nv<=0){ alert('正の数を入力してください'); return; }
    cur[idx] = nv;
    const curStartIso = starts[idx] || '';
    const curStartVal = curStartIso ? new Date(curStartIso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    const timeInput = prompt('時刻を HH:MM で入力してください（24時間）', curStartVal);
    if(timeInput !== null){ const iso = parseHHMMToISO(timeInput); if(!iso){ alert('HH:MM の形式で入力してください'); } else { starts[idx] = iso; } }
    rec.sessions = cur; rec.starts = starts; const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderMedSessionList(); renderWakeSleep(); med_saveAll();
  }));
  wrap.querySelectorAll('button[data-del]').forEach(b=> b.addEventListener('click', (ev)=>{
    try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
    const idx = parseInt(b.getAttribute('data-del'),10);
    const rec = getDayRecord(STATE.selected);
    const sessions = Array.isArray(rec.sessions)? rec.sessions.slice(): [];
    const starts = Array.isArray(rec.starts)? rec.starts.slice(): [];
    const ids = Array.isArray(rec.ids)? rec.ids.slice(): [];
    sessions.splice(idx,1);
    if(starts.length>idx) starts.splice(idx,1);
    if(ids.length>idx) ids.splice(idx,1);
    rec.sessions = sessions; rec.starts = starts; rec.ids = ids; const mk = getMonthKey(); STATE.payload.data[mk][STATE.selected] = rec; renderMedSessionList(); renderWakeSleep(); med_saveAll();
  }));
  renderWakeSleep();
}

function formatTimeShort(iso){ if(!iso) return '--:--'; try{ const d = new Date(iso); if(isNaN(d)) return '--:--'; return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }catch{return '--:--';} }

function renderWakeSleep(){
  const dk = STATE.selected; if(!dk) return; const rec = getDayRecord(dk);
  // wake/sleep are arrays of ISO timestamps for multiple records
  const wakeArr = Array.isArray(rec.wake) ? rec.wake : [];
  const sleepArr = Array.isArray(rec.sleep) ? rec.sleep : [];
  const wEl = $('wakeTime'); const sEl = $('sleepTime');
  const latestWake = wakeArr.length ? wakeArr[wakeArr.length-1] : '';
  const latestSleep = sleepArr.length ? sleepArr[sleepArr.length-1] : '';
  if(wEl) wEl.textContent = formatTimeShort(latestWake);
  if(sEl) sEl.textContent = formatTimeShort(latestSleep);

  // attach handlers for top buttons (起床 / 就寝)
  ['wake','sleep'].forEach(kind=>{
    const buttons = document.querySelectorAll(`button[data-kind="${kind}"]`);
    buttons.forEach(b=>{ b.removeEventListener('click', timeBtnHandler); b.addEventListener('click', timeBtnHandler); });
  });
}

function timeBtnHandler(ev){
  const btn = ev.currentTarget; const kind = btn.getAttribute('data-kind'); const action = btn.getAttribute('data-action'); if(!kind || !action) return;
  if(action === 'record'){ setTimeNow(kind); }
  // top-level buttons shouldn't call edit/delete anymore; per-item edit/delete handled in timeline
}

function setTimeNow(kind){
  const dk = STATE.selected; if(!dk) return; const rec = getDayRecord(dk);
  // ensure arrays exist
  rec.wake = Array.isArray(rec.wake) ? rec.wake : [];
  rec.sleep = Array.isArray(rec.sleep) ? rec.sleep : [];
  const iso = new Date().toISOString();
  if(kind === 'wake') rec.wake.push(iso);
  else if(kind === 'sleep') rec.sleep.push(iso);
  const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec;
  renderWakeSleep(); renderAllRecordsTimeline(); med_saveAll();
}

// Edit a specific wake/sleep record at index. If idx omitted, edit last entry.
function editTimePrompt(kind, idx){
  const dk = STATE.selected; if(!dk) return; const rec = getDayRecord(dk);
  const arr = Array.isArray(rec[kind]) ? rec[kind] : [];
  if(arr.length === 0) return;
  const i = (typeof idx === 'number') ? idx : arr.length - 1;
  const cur = arr[i] || '';
  const curVal = cur ? new Date(cur).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
  const input = prompt('時刻を HH:MM で入力してください（24時間）', curVal); if(input===null) return;
  const iso = parseHHMMToISO(input); if(!iso){ alert('HH:MM の形式で入力してください'); return; }
  arr[i] = iso;
  rec[kind] = arr; const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderWakeSleep(); renderAllRecordsTimeline(); med_saveAll();
}

// Delete a specific wake/sleep record at index
function deleteTimeAt(kind, idx){
  const dk = STATE.selected; if(!dk) return; const rec = getDayRecord(dk);
  const arr = Array.isArray(rec[kind]) ? rec[kind].slice() : [];
  if(typeof idx !== 'number' || idx < 0 || idx >= arr.length) return;
  arr.splice(idx, 1);
  rec[kind] = arr; const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderWakeSleep(); renderAllRecordsTimeline(); med_saveAll();
}

function parseHHMMToISO(hhmm){ if(!hhmm || typeof hhmm !== 'string') return null; const m = hhmm.trim().match(/^([0-2]?\d):([0-5]\d)$/); if(!m) return null; const hh = parseInt(m[1],10); if(hh>23) return null; const mm = parseInt(m[2],10); const now = new Date(); now.setHours(hh, mm, 0, 0); return now.toISOString(); }

// 全ての記録を時刻順に統一表示する関数
function renderAllRecordsTimeline(){
  const wrap = $('allRecordsTimeline');
  if(!wrap) return;
  wrap.innerHTML = '';
  
  const dk = STATE.selected;
  if(!dk) return;
  
  const rec = getDayRecord(dk);
  const allRecords = [];
  
  // 起床記録 (複数対応)
  const wakeArr = Array.isArray(rec.wake) ? rec.wake : [];
  wakeArr.forEach((iso, i) => {
    allRecords.push({ type: 'wake', time: iso, label: '起床', data: { index: i } });
  });
  
  // 瞑想記録
  const sessions = Array.isArray(rec.sessions) ? rec.sessions : [];
  const starts = Array.isArray(rec.starts) ? rec.starts : [];
  const ids = Array.isArray(rec.ids) ? rec.ids : [];
  sessions.forEach((minutes, i) => {
    const startTime = starts[i];
    if(startTime){
      allRecords.push({
        type: 'meditation',
        time: startTime,
        label: `瞑想 ${minutes}分`,
        data: { index: i, minutes }
      });
    }
  });
  
  // エクササイズ記録
  const exerciseSessions = Array.isArray(rec.exercise?.sessions) ? rec.exercise.sessions : [];
  exerciseSessions.forEach((session, i) => {
    if(session.startedAt){
      const secPart = (Number(session.seconds) > 0) ? ` ${session.seconds}秒` : '';
      allRecords.push({
        type: 'exercise',
        time: session.startedAt,
        label: `${session.type}${secPart}`,
        data: { index: i, session }
      });
    }
  });
  
  // 就寝記録 (複数対応)
  const sleepArr = Array.isArray(rec.sleep) ? rec.sleep : [];
  sleepArr.forEach((iso, i) => {
    allRecords.push({ type: 'sleep', time: iso, label: '就寝', data: { index: i } });
  });
  
  // 時刻順にソート
  allRecords.sort((a, b) => {
    return new Date(a.time) - new Date(b.time);
  });
  
  // 表示
  allRecords.forEach(record => {
    const timeStr = record.time ? formatTimeShort(record.time) : '--:--';
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.padding = '6px';
    row.style.marginBottom = '4px';
    row.style.borderRadius = '0';
    row.style.background = 'transparent';
    row.style.color = '#ffffff';
    
    let buttons = '';
    if(record.type === 'meditation' && record.data){
      buttons = `<div style="display:flex;gap:8px">
        <button data-med-edit="${record.data.index}">✏</button>
        <button data-med-del="${record.data.index}">✕</button>
      </div>`;
    } else if(record.type === 'exercise' && record.data){
      buttons = `<div style="display:flex;gap:8px">
        <button data-ex-edit="${record.data.index}">✏</button>
        <button data-ex-del="${record.data.index}">✕</button>
      </div>`;
    } else if((record.type === 'wake' || record.type === 'sleep') && record.data){
      const kind = record.type;
      buttons = `<div style="display:flex;gap:6px">
        <button data-${kind}-edit="${record.data.index}">✏</button>
        <button data-${kind}-del="${record.data.index}">✕</button>
      </div>`;
    }

    row.innerHTML = `
      <div style="font-weight:700">${timeStr} <span style="font-weight:400;margin-left:8px">${record.label}</span></div>
      ${buttons}
    `;
    
    wrap.appendChild(row);
  });
  
  // イベントリスナーを追加
  wrap.querySelectorAll('button[data-med-edit]').forEach(b => {
    b.addEventListener('click', (ev) => {
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
      const idx = parseInt(b.getAttribute('data-med-edit'), 10);
      // prompt-based edit for meditation in timeline: minutes then start time
      const dk = STATE.selected; if(!dk) return;
      const rec = getDayRecord(dk);
      const sessions = Array.isArray(rec.sessions)? rec.sessions.slice() : [];
      const starts = Array.isArray(rec.starts)? rec.starts.slice() : [];
      const curVal = sessions[idx];
      const nvStr = prompt('新しい分数', curVal);
      if(nvStr === null) return;
      const nv = parseFloat(nvStr);
      if(!Number.isFinite(nv) || nv<=0){ alert('正の数を入力してください'); return; }
      sessions[idx] = nv;
      const curStartIso = starts[idx] || '';
      const curStartVal = curStartIso ? new Date(curStartIso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
      const timeInput = prompt('時刻を HH:MM で入力してください（24時間）', curStartVal);
      if(timeInput !== null){ const iso = parseHHMMToISO(timeInput); if(!iso){ alert('HH:MM の形式で入力してください'); } else { starts[idx] = iso; } }
      rec.sessions = sessions; rec.starts = starts; const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderMedSessionList(); renderWakeSleep(); renderAllRecordsTimeline(); med_saveAll();
    });
  });
  
  wrap.querySelectorAll('button[data-med-del]').forEach(b => {
    b.addEventListener('click', (ev) => {
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
      const idx = parseInt(b.getAttribute('data-med-del'), 10);
      const rec = getDayRecord(STATE.selected);
      const sessions = Array.isArray(rec.sessions) ? rec.sessions.slice() : [];
      const starts = Array.isArray(rec.starts) ? rec.starts.slice() : [];
      const ids = Array.isArray(rec.ids) ? rec.ids.slice() : [];
      sessions.splice(idx, 1);
      if(starts.length > idx) starts.splice(idx, 1);
      if(ids.length > idx) ids.splice(idx, 1);
      rec.sessions = sessions;
      rec.starts = starts;
      rec.ids = ids;
      const mk = getMonthKey();
      STATE.payload.data[mk][STATE.selected] = rec;
      renderMedSessionList();
      renderWakeSleep();
      renderAllRecordsTimeline();
      med_saveAll();
    });
  });
  
  wrap.querySelectorAll('button[data-ex-edit]').forEach(b => {
    b.addEventListener('click', (ev) => {
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
      const idx = parseInt(b.getAttribute('data-ex-edit'), 10);
      // If exerciseList row exists (detailed list visible), open inline editor, else prompt for HH:MM to edit start time
      const dk = STATE.selected; if(!dk) return;
      const rec = getDayRecord(dk);
      const arr = Array.isArray(rec.exercise?.sessions) ? rec.exercise.sessions : [];
      const cur = arr[idx]; if(!cur) return;
  // prompt for new start time (统一プロンプト方式)
  const curVal = cur.startedAt ? new Date(cur.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
  const input = prompt('時刻を HH:MM で入力してください（24時間）', curVal);
  if(input === null) return;
  const iso = parseHHMMToISO(input);
  if(!iso){ alert('HH:MM の形式で入力してください'); return; }
  arr[idx].startedAt = iso; rec.exercise.sessions = arr; rec.exercise.updatedAt = nowISO(); const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderExerciseList(); renderAllRecordsTimeline(); med_saveAll();
    });
  });
  
  wrap.querySelectorAll('button[data-ex-del]').forEach(b => {
    b.addEventListener('click', (ev) => {
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
      const idx = parseInt(b.getAttribute('data-ex-del'), 10);
      const dk = STATE.selected;
      if(!dk) return;
      const rec = getDayRecord(dk);
      const arr = Array.isArray(rec.exercise?.sessions) ? rec.exercise.sessions.slice() : [];
      arr.splice(idx, 1);
      rec.exercise.sessions = arr;
      rec.exercise.updatedAt = nowISO();
      const mk = getMonthKey();
      STATE.payload.data[mk][dk] = rec;
      renderExerciseList();
      renderAllRecordsTimeline();
      med_saveAll();
    });
  });
  
  // 起床・就寝 個別編集・削除リスナー
  ['wake','sleep'].forEach(kind=>{
    wrap.querySelectorAll(`button[data-${kind}-edit]`).forEach(b=>{
      b.addEventListener('click', (ev)=>{
        try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
        const idx = parseInt(b.getAttribute(`data-${kind}-edit`), 10);
        editTimePrompt(kind, idx);
      });
    });
    wrap.querySelectorAll(`button[data-${kind}-del]`).forEach(b=>{
      b.addEventListener('click', (ev)=>{
        try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
        const idx = parseInt(b.getAttribute(`data-${kind}-del`), 10);
        deleteTimeAt(kind, idx);
      });
    });
  });

  // 起床・就寝ボタンのイベントリスナー
  wrap.querySelectorAll('button[data-kind]').forEach(b => {
    b.removeEventListener('click', timeBtnHandler);
    b.addEventListener('click', timeBtnHandler);
  });
}

// addMedSession and clearMedDay removed per user request. Timer and addMedSessionWithStart remain.

// note: medAddBtn and medClearDay removed from UI by user request; handlers intentionally omitted

// ===== Timer (countdown) for meditation-cloud (lightweight) =====
let medTimer = { id: null, running: false, endAt: 0, remaining: 0, startedAt: null };
let medAlarm = { ctx: null, osc: null, gain: null, on: false, _beepInt: null };

function fmtTime(ms){ const s = Math.ceil(ms/1000); const m = Math.floor(s/60); const ss = String(s%60).padStart(2,'0'); return `${m}:${ss}`; }

function updateTimerDisplay(){ const el = $('medTimerDisplay'); const st = $('medTimerStartedAt'); if(!el) return; if(st){ st.textContent = medTimer.startedAt ? new Date(medTimer.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '--:--'; } if(medTimer.running){ el.textContent = fmtTime(Math.max(0, medTimer.endAt - Date.now())); } else { el.textContent = medTimer.remaining? fmtTime(medTimer.remaining) : '--:--'; } }

function setTimerButtons({start,pause,resume,cancel}){ const bS = $('medTimerStart'); if(bS) bS.disabled = !start; const bP = $('medTimerPause'); if(bP) bP.disabled = !pause; const bR = $('medTimerResume'); if(bR) bR.disabled = !resume; const bC = $('medTimerCancel'); if(bC) bC.disabled = !cancel; }

function switchButtonToAlarmStop(btn){ if(!btn) return; btn.textContent = '消音'; btn.dataset.mode = 'alarm-stop'; btn.classList.add('alarm-stop'); btn.style.background = 'linear-gradient(135deg, rgba(248,113,113,0.95), rgba(185,28,28,0.92))'; btn.style.color = '#fff'; btn.style.boxShadow = '0 0 0 2px rgba(248,113,113,0.35)'; }

function resetButtonMode(btn){ if(!btn) return; btn.textContent = '開始'; btn.dataset.mode = 'start'; btn.classList.remove('alarm-stop'); btn.style.background = ''; btn.style.color = ''; btn.style.boxShadow = ''; }

function resetStartButtonMode(){ resetButtonMode($('medTimerStart')); }
function switchStartButtonToAlarmStop(){ switchButtonToAlarmStop($('medTimerStart')); }

function startAlarm(targetButton){ try{ if(medAlarm.on) return; const C = window.AudioContext || window.webkitAudioContext; if(!C) return; medAlarm.ctx = new C(); medAlarm.osc = medAlarm.ctx.createOscillator(); medAlarm.gain = medAlarm.ctx.createGain(); medAlarm.osc.type = 'sawtooth'; medAlarm.osc.frequency.value = 740; medAlarm.gain.gain.value = 0.06; medAlarm.osc.connect(medAlarm.gain).connect(medAlarm.ctx.destination); medAlarm.osc.start(); medAlarm.on = true; medAlarm._beepInt = setInterval(()=>{ if(!medAlarm.gain) return; medAlarm.gain.gain.setValueAtTime(0.06, medAlarm.ctx.currentTime); setTimeout(()=>{ if(medAlarm.gain) medAlarm.gain.gain.setValueAtTime(0, medAlarm.ctx.currentTime); },400); },500); }catch(e){} if(navigator.vibrate) try{ navigator.vibrate([200,150,200]); }catch(e){} if(targetButton) switchButtonToAlarmStop(targetButton); else switchStartButtonToAlarmStop(); }

function stopAlarm(targetButton){ try{ if(medAlarm._beepInt){ clearInterval(medAlarm._beepInt); medAlarm._beepInt = null; } if(medAlarm.osc){ medAlarm.osc.stop(); medAlarm.osc.disconnect(); } if(medAlarm.ctx){ medAlarm.ctx.close(); } }catch(e){} medAlarm = { ctx:null, osc:null, gain:null, on:false, _beepInt:null }; if(targetButton) resetButtonMode(targetButton); else resetStartButtonMode(); setTimerButtons({start:true,pause:false,resume:false,cancel:false}); }

function addMedSessionWithStart(min, startedAt){ const dk = STATE.selected; if(!dk) return; const rec = getDayRecord(dk); rec.sessions = Array.isArray(rec.sessions)? rec.sessions.slice() : []; rec.starts = Array.isArray(rec.starts)? rec.starts.slice() : []; rec.ids = Array.isArray(rec.ids)? rec.ids.slice() : []; rec.sessions.push(min); rec.starts.push(startedAt || new Date().toISOString()); rec.ids.push('m'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)); const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderMedSessionList(); renderAllRecordsTimeline(); med_saveAll(); }
function addMedSessionWithStart(min, startedAt){
  // migrate meditation timer recording to the same shape as exercise (プランク)
  try{
    const seconds = Math.round(Number(min) * 60);
    addExerciseWithStart(seconds, '瞑想', startedAt || new Date().toISOString());
  }catch(e){ console.warn('addMedSessionWithStart wrapper failed', e); }
}

function startMedTimer(){ _hideMedClearButton(); resetStartButtonMode(); const min = parseFloat($('medTimerMin')?.value)||0; if(min<=0){ alert('分を入力してください'); return; } medTimer.startedAt = new Date().toISOString(); medTimer.remaining = Math.round(min*60*1000); medTimer.endAt = Date.now() + medTimer.remaining; medTimer.running = true; setTimerButtons({start:false,pause:true,resume:false,cancel:true}); updateTimerDisplay(); if(medTimer.id) clearInterval(medTimer.id); medTimer.id = setInterval(()=>{ const left = medTimer.endAt - Date.now(); if(left<=0){ clearInterval(medTimer.id); medTimer.id = null; medTimer.running = false; medTimer.remaining = 0; updateTimerDisplay(); startAlarm(); addMedSessionWithStart(min, medTimer.startedAt); setTimerButtons({start:true,pause:false,resume:false,cancel:false}); } else updateTimerDisplay(); },250); }

function startMedTimer(){
  _hideMedClearButton();
  const btn = $('medTimerStart'); resetButtonMode(btn); const min = parseFloat($('medTimerMin')?.value)||0; if(min<=0){ alert('分を入力してください'); return; }
  medTimer.startedAt = new Date().toISOString(); medTimer.remaining = Math.round(min*60*1000); medTimer.endAt = Date.now() + medTimer.remaining; medTimer.running = true;
  // single-button mode: show '一時停止' while running
  if(btn){ btn.textContent = '一時停止'; btn.dataset.mode = 'running'; }
  updateTimerDisplay(); if(medTimer.id) clearInterval(medTimer.id); medTimer.id = setInterval(()=>{ const left = medTimer.endAt - Date.now(); if(left<=0){ clearInterval(medTimer.id); medTimer.id = null; medTimer.running = false; medTimer.remaining = 0; updateTimerDisplay(); // record and start alarm on this button
        addMedSessionWithStart(min, medTimer.startedAt); const b = $('medTimerStart'); startAlarm(b); } else updateTimerDisplay(); },250);
}

function pauseMedTimer(){ const btn = $('medTimerStart'); if(!medTimer.running) return; medTimer.running = false; medTimer.remaining = Math.max(0, medTimer.endAt - Date.now()); if(medTimer.id) clearInterval(medTimer.id); medTimer.id = null; if(btn){ btn.textContent = '再開'; btn.dataset.mode = 'paused'; } updateTimerDisplay(); }
// When paused, show the clear button so user can choose to discard the paused session
function _showMedClearButton(){ const cb = $('medTimerClear'); if(cb) cb.style.display = ''; }
function _hideMedClearButton(){ const cb = $('medTimerClear'); if(cb) cb.style.display = 'none'; }

function resumeMedTimer(){ const btn = $('medTimerStart'); if(medTimer.running || !medTimer.remaining) return; medTimer.running = true; medTimer.endAt = Date.now() + medTimer.remaining; if(btn){ btn.textContent = '一時停止'; btn.dataset.mode = 'running'; } if(medTimer.id) clearInterval(medTimer.id); medTimer.id = setInterval(()=>{ const left = medTimer.endAt - Date.now(); if(left<=0){ clearInterval(medTimer.id); medTimer.id = null; medTimer.running = false; medTimer.remaining = 0; updateTimerDisplay(); addMedSessionWithStart(parseFloat($('medTimerMin')?.value)||0, medTimer.startedAt); const b = $('medTimerStart'); startAlarm(b); } else updateTimerDisplay(); },250); }
// hide clear button when resuming
function resumeMedTimerAndHide(){ _hideMedClearButton(); resumeMedTimer(); }

function cancelMedTimer(){ if(medTimer.id) clearInterval(medTimer.id); medTimer = { id:null, running:false, endAt:0, remaining:0, startedAt:null }; const btn = $('medTimerStart'); resetButtonMode(btn); _hideMedClearButton(); updateTimerDisplay(); }

// wire timer controls into attachHandlers
try{ document.addEventListener('DOMContentLoaded', ()=>{
    const btn = $('medTimerStart');
    if(btn) btn.addEventListener('click', (ev)=>{
      const b = ev.currentTarget;
      // if alarm is sounding on this button, stop it
      if(b.dataset.mode === 'alarm-stop'){ stopAlarm(b); return; }
      // if timer is running -> pause, if paused -> resume, if idle -> start
      if(medTimer.running){ pauseMedTimer(); _showMedClearButton(); }
      else if(medTimer.remaining){ resumeMedTimerAndHide(); }
      else { startMedTimer(); _hideMedClearButton(); }
    });
    // wire clear button (confirmation then cancel)
    const clearBtn = $('medTimerClear');
    if(clearBtn) clearBtn.addEventListener('click', (ev)=>{
      try{ if(!confirm('本当にクリアしますか？ 瞑想の進行中の記録を破棄します。')) return; }catch(e){ /* ignore */ }
      cancelMedTimer(); _hideMedClearButton();
    });
    // initialize button state
    const b = $('medTimerStart'); resetButtonMode(b); updateTimerDisplay();
  }); }catch(e){}

// wire exercise timer buttons
try{ document.addEventListener('DOMContentLoaded', ()=>{
  // plank
  const pStart = $('plankStart'); if(pStart) pStart.addEventListener('click', (ev)=>{ const btn = ev.currentTarget; if(btn.dataset.mode === 'alarm-stop'){ stopAlarm(btn); return; } startExerciseTimer('plank'); });
  
  // wall
  const wStart = $('wallStart'); if(wStart) wStart.addEventListener('click', (ev)=>{ const btn = ev.currentTarget; if(btn.dataset.mode === 'alarm-stop'){ stopAlarm(btn); return; } startExerciseTimer('wall'); });
  // initialize displays/buttons
  setExerciseButtons('plank', {start:true,pause:false,resume:false,cancel:false}); updateExerciseDisplay('plank');
  setExerciseButtons('wall', {start:true,pause:false,resume:false,cancel:false}); updateExerciseDisplay('wall');
  // render existing exercises when editor opens
  renderExerciseList();
  // wire free add button
  const freeBtn = $('freeAdd'); if(freeBtn) freeBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); addFreeRecord(); });
  // prevent mobile credential UI by randomizing name/autocomplete on focus
  const freeLabel = $('freeLabel'); const freeSec = $('freeSec');
  attachNoCredentialBehavior(freeLabel); attachNoCredentialBehavior(freeSec);
}); }catch(e){}

// ===== Exercise timers (プランク / 空気椅子) =====
const exerciseTimers = {
  plank: { id:null, running:false, endAt:0, remaining:0, startedAt:null },
  wall: { id:null, running:false, endAt:0, remaining:0, startedAt:null }
};

function fmtTimeMS(ms){ const s = Math.ceil(ms/1000); const m = Math.floor(s/60); const ss = String(s%60).padStart(2,'0'); return `${m}:${ss}`; }

function updateExerciseDisplay(key){ const t = exerciseTimers[key]; const disp = $(key === 'plank' ? 'plankDisplay' : 'wallDisplay'); if(!disp) return; if(t.running){ disp.textContent = fmtTimeMS(Math.max(0, t.endAt - Date.now())); } else { disp.textContent = t.remaining ? fmtTimeMS(t.remaining) : '--:--'; } }

function setExerciseButtons(key, {start,pause,resume,cancel}){
  const prefix = key === 'plank' ? 'plank' : 'wall';
  const bS = $(prefix+'Start'); if(bS) bS.disabled = !start;
  const bP = $(prefix+'Pause'); if(bP) bP.disabled = !pause;
  const bR = $(prefix+'Resume'); if(bR) bR.disabled = !resume;
  const bC = $(prefix+'Cancel'); if(bC) bC.disabled = !cancel;
}

function startExerciseTimer(key){
  const prefix = key === 'plank' ? 'plank' : 'wall';
  const input = $(prefix+'Sec'); if(!input) return; const sec = Math.max(1, Math.floor(Number(input.value)||0));
  const t = exerciseTimers[key]; t.startedAt = new Date().toISOString(); t.remaining = sec*1000; t.endAt = Date.now() + t.remaining; t.running = true;
  setExerciseButtons(key, {start:false,pause:true,resume:false,cancel:true}); updateExerciseDisplay(key);
  if(t.id) clearInterval(t.id);
  t.id = setInterval(()=>{
  const left = t.endAt - Date.now(); if(left<=0){ clearInterval(t.id); t.id = null; t.running=false; t.remaining=0; updateExerciseDisplay(key); // record on completion
    addExerciseWithStart(sec, key === 'plank' ? 'プランク' : '空気椅子', t.startedAt);
    // play alarm and make the start button act as 消音
    const startBtn = $(prefix+'Start'); startAlarm(startBtn); if(startBtn) setExerciseButtons(key, {start:true,pause:false,resume:false,cancel:false});
    } else updateExerciseDisplay(key);
  }, 200);
}

function pauseExerciseTimer(key){ const t = exerciseTimers[key]; if(!t.running) return; t.running=false; t.remaining = Math.max(0, t.endAt - Date.now()); if(t.id) clearInterval(t.id); t.id = null; setExerciseButtons(key, {start:false,pause:false,resume:true,cancel:true}); updateExerciseDisplay(key); }

function resumeExerciseTimer(key){ const t = exerciseTimers[key]; if(t.running || !t.remaining) return; t.running = true; t.endAt = Date.now() + t.remaining; setExerciseButtons(key, {start:false,pause:true,resume:false,cancel:true}); if(t.id) clearInterval(t.id); t.id = setInterval(()=>{ const left = t.endAt - Date.now(); if(left<=0){ clearInterval(t.id); t.id=null; t.running=false; t.remaining=0; updateExerciseDisplay(key); addExerciseWithStart(Math.round((Number($(key==='plank'?'plankSec':'wallSec').value)||1)), key==='plank'?'プランク':'空気椅子', t.startedAt); setExerciseButtons(key, {start:true,pause:false,resume:false,cancel:false}); } else updateExerciseDisplay(key); },200); }

function cancelExerciseTimer(key){ const t = exerciseTimers[key]; if(t.id) clearInterval(t.id); exerciseTimers[key] = { id:null, running:false, endAt:0, remaining:0, startedAt:null }; setExerciseButtons(key, {start:true,pause:false,resume:false,cancel:false}); updateExerciseDisplay(key); }

function addExerciseWithStart(seconds, kind, startedAt){ try{ const dk = STATE.selected; if(!dk) return; const rec = getDayRecord(dk); rec.exercise = rec.exercise || { sessions: [], updatedAt: nowISO() };
    const sessions = Array.isArray(rec.exercise.sessions) ? rec.exercise.sessions.slice() : [];
    const item = { id: 'e'+Date.now().toString(36)+Math.random().toString(36).slice(2,7), type: kind||'exercise', seconds: Number(seconds)||0, startedAt: startedAt || new Date().toISOString(), completedAt: new Date((new Date(startedAt||new Date())).getTime() + (Number(seconds)||0)*1000).toISOString() };
    sessions.push(item); rec.exercise.sessions = sessions; rec.exercise.updatedAt = nowISO(); const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderExerciseList(); renderAllRecordsTimeline(); med_saveAll(); setMsg(`${kind} を記録しました`); }catch(e){ console.warn('addExerciseWithStart failed', e); } }

function renderExerciseList(){ const wrap = $('exerciseList'); if(!wrap) return; wrap.innerHTML = ''; const dk = STATE.selected; if(!dk) return; const rec = getDayRecord(dk); const sessions = Array.isArray(rec.exercise?.sessions) ? rec.exercise.sessions : []; if(!sessions.length){ wrap.innerHTML = ''; return; }
  
  // Create array with original indices for sorting
  const sessionData = sessions.map((it, idx) => ({
    session: it,
    originalIndex: idx
  }));
  
  // Sort by start time (earliest first)
  sessionData.sort((a, b) => {
    if (!a.session.startedAt && !b.session.startedAt) return 0;
    if (!a.session.startedAt) return 1;
    if (!b.session.startedAt) return -1;
    return new Date(a.session.startedAt) - new Date(b.session.startedAt);
  });
  
  sessionData.forEach((item)=>{
  const it = item.session;
  const idx = item.originalIndex;
  const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.alignItems='center'; row.style.padding='6px'; row.style.borderRadius='0'; row.style.background='transparent'; row.style.color='#ffffff'; row.style.marginBottom='4px';
    const startTxt = it.startedAt ? formatTimeShort(it.startedAt) : '--:--';
    const secPart = (Number(it.seconds) > 0) ? (` ${it.seconds}秒`) : '';
    row.setAttribute('data-ex-idx', String(idx));
    row.innerHTML = `<div style="font-weight:700">${startTxt} <span style="font-weight:400;margin-left:8px">${it.type}${secPart}</span></div>` +
                    `<div style="display:flex;gap:8px"><button data-ex-edit='${idx}'>✏</button><button data-ex-del='${idx}'>✕</button></div>`;
    wrap.appendChild(row);
  });
  // attach handlers
  wrap.querySelectorAll('button[data-ex-edit]').forEach(b=> b.addEventListener('click', (ev)=>{ try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
    const idx = parseInt(b.getAttribute('data-ex-edit'),10);
    const dk = STATE.selected; if(!dk) return;
    const rec = getDayRecord(dk);
    const arr = Array.isArray(rec.exercise?.sessions) ? rec.exercise.sessions : [];
    const cur = arr[idx]; if(!cur) return;
    const curVal = cur.startedAt ? new Date(cur.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    const input = prompt('時刻を HH:MM で入力してください（24時間）', curVal);
    if(input === null) return;
    const iso = parseHHMMToISO(input);
    if(!iso){ alert('HH:MM の形式で入力してください'); return; }
    arr[idx].startedAt = iso; rec.exercise.sessions = arr; rec.exercise.updatedAt = nowISO(); const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderExerciseList(); renderAllRecordsTimeline(); med_saveAll(); }));
  wrap.querySelectorAll('button[data-ex-del]').forEach(b=> b.addEventListener('click', (ev)=>{
    try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
    const idx = parseInt(b.getAttribute('data-ex-del'),10); const dk = STATE.selected; if(!dk) return; const rec = getDayRecord(dk); const arr = Array.isArray(rec.exercise?.sessions)? rec.exercise.sessions.slice() : []; arr.splice(idx,1); rec.exercise.sessions = arr; rec.exercise.updatedAt = nowISO(); const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderExerciseList(); med_saveAll();
  }));
}

// Inline editing removed: edits are now handled via prompt dialogs to simplify UI.

function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// handle free-add row (label + optional seconds)
function addFreeRecord(){ try{
  const labelEl = $('freeLabel'); const secEl = $('freeSec'); if(!labelEl) return; const label = (labelEl.value||'').trim(); if(!label){ alert('記録内容を入力してください'); return; }
  const sec = Math.max(0, Math.floor(Number(secEl?.value)||0));
  // record with current time
  addExerciseWithStart(sec, label, new Date().toISOString());
  // clear inputs
  labelEl.value = '';
  if(secEl) secEl.value = '0';
  // re-render list handled by addExerciseWithStart
}catch(e){ console.warn('addFreeRecord failed', e); alert('記録に失敗しました'); }}
