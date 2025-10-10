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
function parseDateKeyParts(dateKey){
  if(!dateKey) return { year: state.year, month: state.month, day: 1 };
  const [yy, mm, dd] = dateKey.split('-');
  const year = parseInt(yy, 10) || state.year;
  const month = (parseInt(mm, 10) || (state.month+1)) - 1;
  const day = parseInt(dd, 10) || 1;
  return { year, month, day };
}

function cloneExerciseData(exercise){
  if(!exercise) return undefined;
  const sessions = Array.isArray(exercise.sessions) ? exercise.sessions.map(item=>({
    id: item?.id || '',
    type: item?.type || 'exercise',
    seconds: Number(item?.seconds)||0,
    startedAt: item?.startedAt || '',
    completedAt: item?.completedAt || ''
  })) : [];
  const copy = { ...exercise, sessions };
  if(!copy.updatedAt && exercise.dayTs) copy.updatedAt = exercise.dayTs;
  return copy;
}

function mergeExerciseData(left, right){
  const norm = (src)=>{
    if(!src) return null;
    const sessions = Array.isArray(src.sessions) ? src.sessions.map(item=>({
      id: typeof item?.id === 'string' ? item.id : '',
      type: item?.type || 'exercise',
      seconds: Number(item?.seconds)||0,
      startedAt: item?.startedAt || '',
      completedAt: item?.completedAt || ''
    })) : [];
    const updatedAt = src.updatedAt || src.dayTs || '1970';
    return { sessions, updatedAt };
  };
  const L = norm(left);
  const R = norm(right);
  if(!L) return R;
  if(!R) return L;
  const map = new Map();
  const keyOf = (item)=> item.id || `${item.type}|${item.startedAt}|${item.seconds}`;
  const put = (item)=>{
    const key = keyOf(item);
    const existing = map.get(key);
    if(!existing){
      map.set(key, { ...item, id: item.id || ('e'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)) });
    } else {
      const existingTime = existing.completedAt || existing.startedAt || '1970';
      const incomingTime = item.completedAt || item.startedAt || '1970';
      const preferIncoming = incomingTime > existingTime;
      if(preferIncoming){
        map.set(key, { ...item, id: item.id || existing.id || ('e'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)) });
      } else if(!existing.id && item.id){
        map.set(key, { ...item });
      }
    }
  };
  L.sessions.forEach(put);
  R.sessions.forEach(put);
  const sessions = [...map.values()];
  const updatedAt = (R.updatedAt||'1970') > (L.updatedAt||'1970') ? R.updatedAt : L.updatedAt;
  return { sessions, updatedAt };
}

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
    const dateObj = new Date(year, month, d);
    const dow = dateObj.getDay(); // 0:Sun 6:Sat
    if(dow===0 || dow===6) el.dataset.weekend='1';
    el.dataset.dow = String(dow);
    if(isMeditation()){
      const rec = monthData[dk] || {};
      const sessions = Array.isArray(rec?.sessions)? rec.sessions : [];
      const totalMin = sessions.reduce((a,b)=>a+b,0);
      const exerciseSessions = Array.isArray(rec?.exercise?.sessions) ? rec.exercise.sessions : [];
      const exerciseSeconds = exerciseSessions.reduce((sum,item)=> sum + (Number(item?.seconds)||0), 0);
      const exerciseLabel = exerciseSessions.length ? `EX ${exerciseSessions.length}回 / ${exerciseSeconds}秒` : '';
      el.dataset.sessions = String(sessions.length);
      el.dataset.exercise = String(exerciseSessions.length);
      if(isToday) el.setAttribute('data-today','true');
      const medSummaryHtml = sessions.length ? (totalMin+"<span class=\"med-min-unit\">分</span>") : '';
      const exerciseHtml = exerciseLabel ? `<div class="ex-summary">${exerciseLabel}</div>` : '';
      el.innerHTML = `<div class="d">${d}</div><div class="med-summary">${medSummaryHtml}</div>${exerciseHtml}`;
      const tooltipBase = [];
      if(sessions.length){ tooltipBase.push(`瞑想 ${sessions.length}回 合計${totalMin}分`); }
      if(exerciseSessions.length){ tooltipBase.push(`エクササイズ ${exerciseSessions.length}回 ${exerciseSeconds}秒`); }
      el.title = tooltipBase.length ? `${tooltipBase.join(' / ')} (クリックで選択)` : '未記録（クリックで選択）';
      const handleOpen = (event)=>{
        if(event) event.preventDefault();
        openMeditationChooser({
          dateKey: dk,
          anchor: el,
          meditationSessions: sessions,
          exerciseSessions,
          rawRecord: rec
        });
      };
      el.addEventListener('click', handleOpen);
      el.addEventListener('contextmenu', handleOpen);
    } else {
      const val = monthData[dk] || 0;
  const present = (typeof val==='object') ? (!!val && !val.__deleted && val.work===1) : (val===1);
      el.dataset.state = present ? '1' : '0';
      if(isToday) el.setAttribute('data-today','true');
  el.innerHTML = `<div class="d">${d}</div><div class="dot"></div>`;
      el.title = present ? '行った（クリックで解除）' : '未記録（クリックで「行った」に）';
      el.addEventListener('click', ()=>{
        const md = readMonth(state.uid, year, month);
        const curVal = md[dk];
        const curPresent = (typeof curVal==='object') ? (curVal.work===1 && !curVal.__deleted) : (curVal===1);
        if(curPresent){
          // 削除(tombstone)
          md[dk] = { __deleted:true, ts: nowISO() };
          el.dataset.state='0';
        } else {
          md[dk] = { work:1, dayTs: nowISO() };
          el.dataset.state='1';
        }
        writeMonth(state.uid, year, month, md);
        if(window.syncAfterNewWorkToggle) window.syncAfterNewWorkToggle(); // 重複呼びを削除
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
    const attended = countAttendanceDays(md, state.year, state.month);
    attendedForFinance = attended;
    const total = daysInMonth(state.year, state.month);
    const rate = total ? Math.round(attended*100/total) : 0;
    const longest = calcAttendanceLongestStreak(md, state.year, state.month);
    const current = calcAttendanceCurrentStreak(md, state.year, state.month);
    const unAttended = total - attended; // 未出席日数 (既に経過も含む)
    const today = new Date();
    const isCur = today.getFullYear()===state.year && today.getMonth()===state.month;
    const daysLeft = isCur ? (total - today.getDate()) : 0; // 今日以降の残り日数（今日除く）
    box.append(
      makeStat(`今月の出席日数: <b>${attended}</b> / ${total}日 (${rate}%)`),
      makeStat(`月末まで残り: <b>${daysLeft}</b> 日`),
      makeStat(`最長: <b>${longest}</b> 日`),
    );
  }
  renderFinanceStats(attendedForFinance);
}

// ===== Meditation vs Exercise chooser =====
let medChooserEl = null;
let medChooserCtx = { dateKey: null, anchor: null, meditationSessions: [], exerciseSessions: [], rawRecord: null, prevFocus: null };

function ensureMeditationChooser(){
  if(medChooserEl) return medChooserEl;
  const overlay = document.createElement('div');
  overlay.id = 'medChooserOverlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(15,23,42,0.55)',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '3500',
    padding: ' clamp(18px, 8vw, 32px) '
  });

  const dialog = document.createElement('div');
  dialog.className = 'med-chooser-dialog';
  Object.assign(dialog.style, {
    width: 'min(92vw, 360px)',
    display: 'grid',
    gap: '18px',
    background: 'var(--card, #0f172a)',
    color: '#e2e8f0',
    borderRadius: '16px',
    padding: '24px clamp(20px, 7vw, 32px)',
    boxShadow: '0 22px 48px rgba(15,23,42,0.55), 0 0 0 1px rgba(148,163,184,0.18)'
  });

  const heading = document.createElement('div');
  heading.style.display = 'grid';
  heading.style.gap = '6px';
  heading.innerHTML = `<div style="font-size:1.1rem;font-weight:800;letter-spacing:0.01em">記録を選択</div><div id="medChooserDate" style="opacity:0.75;font-weight:600;font-size:0.95rem"></div>`;

  const summary = document.createElement('div');
  summary.id = 'medChooserSummary';
  summary.style.display = 'grid';
  summary.style.gap = '4px';
  summary.style.fontSize = '0.92rem';
  summary.style.color = '#cbd5f5';

  const btnWrap = document.createElement('div');
  btnWrap.style.display = 'grid';
  btnWrap.style.gap = '12px';

  const btnExercise = document.createElement('button');
  btnExercise.type = 'button';
  btnExercise.dataset.action = 'exercise';
  btnExercise.textContent = 'エクササイズ';
  Object.assign(btnExercise.style, {
    padding: '14px 16px',
    borderRadius: '12px',
    border: '0',
    fontSize: '1rem',
    fontWeight: '700',
    background: 'linear-gradient(135deg,#f97316,#ef4444)',
    color: '#ffffff',
    textShadow: '0 1px 1px rgba(0,0,0,0.35)',
    cursor: 'pointer',
    boxShadow: '0 14px 28px rgba(239,68,68,0.28)',
    transition: 'transform 0.18s ease, box-shadow 0.18s ease'
  });

  const btnMeditation = document.createElement('button');
  btnMeditation.type = 'button';
  btnMeditation.dataset.action = 'meditation';
  btnMeditation.textContent = '瞑想';
  Object.assign(btnMeditation.style, {
    padding: '14px 16px',
    borderRadius: '12px',
    border: '0',
    fontSize: '1rem',
    fontWeight: '700',
    background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
    color: '#ffffff',
    textShadow: '0 1px 1px rgba(0,0,0,0.35)',
    cursor: 'pointer',
    boxShadow: '0 14px 28px rgba(99,102,241,0.26)',
    transition: 'transform 0.18s ease, box-shadow 0.18s ease'
  });

  const closeRow = document.createElement('div');
  closeRow.style.display = 'flex';
  closeRow.style.justifyContent = 'center';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'キャンセル';
  Object.assign(closeBtn.style, {
    border: '0',
    background: 'transparent',
    color: '#94a3b8',
    fontSize: '0.95rem',
    fontWeight: '600',
    cursor: 'pointer'
  });
  closeRow.appendChild(closeBtn);

  btnWrap.append(btnExercise, btnMeditation);
  dialog.append(btnWrap, heading, summary, closeRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const handleClose = ()=> closeMeditationChooser();
  closeBtn.addEventListener('click', handleClose);
  overlay.addEventListener('click', (ev)=>{ if(ev.target === overlay) handleClose(); });
  btnExercise.addEventListener('click', ()=>{
    const ctx = medChooserCtx;
    closeMeditationChooser();
    setTimeout(()=>{
      openExercisePanel({ dateKey: ctx.dateKey, anchor: ctx.anchor, record: ctx.rawRecord });
    }, 10);
  });
  btnMeditation.addEventListener('click', ()=>{
    const ctx = medChooserCtx;
    closeMeditationChooser();
    setTimeout(()=>{
      openMeditationEditor(ctx.dateKey, ctx.anchor, ctx.meditationSessions);
    }, 0);
  });

  const handleKey = (ev)=>{
    if(overlay.style.display !== 'flex') return;
    if(ev.key === 'Escape'){
      ev.stopPropagation();
      closeMeditationChooser();
    }
  };
  document.addEventListener('keydown', handleKey, true);

  overlay._close = handleClose;
  overlay._handleKey = handleKey;
  overlay._btnPrimary = btnExercise;
  overlay._summary = summary;
  overlay._dateLabel = heading.querySelector('#medChooserDate');
  medChooserEl = overlay;
  return medChooserEl;
}

function closeMeditationChooser(){
  if(!medChooserEl) return;
  medChooserEl.style.display = 'none';
  medChooserEl.removeAttribute('data-open');
  const prev = medChooserCtx.prevFocus;
  medChooserCtx = { dateKey: null, anchor: null, meditationSessions: [], exerciseSessions: [], rawRecord: null, prevFocus: null };
  if(prev && typeof prev.focus === 'function'){
    setTimeout(()=> prev.focus(), 0);
  }
}

function openMeditationChooser({ dateKey, anchor, meditationSessions, exerciseSessions, rawRecord }){
  const overlay = ensureMeditationChooser();
  medChooserCtx = {
    dateKey,
    anchor,
    meditationSessions: Array.isArray(meditationSessions)? meditationSessions : [],
    exerciseSessions: Array.isArray(exerciseSessions)? exerciseSessions : [],
    rawRecord: rawRecord || {},
    prevFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null
  };
  const { _summary, _dateLabel, _btnPrimary } = overlay;
  if(_dateLabel) _dateLabel.textContent = dateKey;
  if(_summary){
    const medCount = medChooserCtx.meditationSessions.length;
    const medTotal = medChooserCtx.meditationSessions.reduce((sum,v)=> sum+v, 0);
    const exCount = medChooserCtx.exerciseSessions.length;
    const exTotal = medChooserCtx.exerciseSessions.reduce((sum,v)=> sum + (Number(v?.seconds)||0), 0);
    const lines = [];
    lines.push(`瞑想: ${medCount}回 / ${medTotal}分`);
    lines.push(`エクササイズ: ${exCount}回 / ${exTotal}秒`);
    _summary.innerHTML = lines.map(l=> `<div>${l}</div>`).join('');
  }
  overlay.style.display = 'flex';
  overlay.setAttribute('data-open','1');
  setTimeout(()=>{ _btnPrimary?.focus(); }, 20);
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
  const v = monthObj[dk];
  let present = 0;
  if(typeof v === 'object') present = (v && !v.__deleted && v.work===1)?1:0;
  else present = (v===1)?1:0;
  days.push(present);
    }
  }
  let best=0, cur=0;
  for(const v of days){ cur = v ? cur+1 : 0; if(cur>best) best=cur; }
  return best;
}

// ---- Attendance helper logic (presence & streak) ----
function isAttendancePresent(v){
  if(typeof v === 'object') return !!v && !v.__deleted && v.work===1;
  return v === 1;
}
function countAttendanceDays(monthObj, year, month){
  let cnt = 0;
  const total = daysInMonth(year, month);
  for(let d=1; d<=total; d++){
    const dk = getDateKey(year, month, d);
    if(isAttendancePresent(monthObj[dk])) cnt++;
  }
  return cnt;
}
function calcAttendanceLongestStreak(monthObj, year, month){
  let best=0, cur=0;
  const total = daysInMonth(year, month);
  for(let d=1; d<=total; d++){
    const dk = getDateKey(year, month, d);
    if(isAttendancePresent(monthObj[dk])){ cur++; if(cur>best) best=cur; } else cur=0;
  }
  return best;
}
function calcAttendanceCurrentStreak(monthObj, year, month){
  let cur=0;
  const today = new Date();
  const isCurrentMonth = today.getFullYear()===year && today.getMonth()===month;
  const lastDay = isCurrentMonth ? today.getDate() : daysInMonth(year, month);
  for(let d=lastDay; d>=1; d--){
    const dk = getDateKey(year, month, d);
    if(isAttendancePresent(monthObj[dk])) cur++; else break;
  }
  return cur;
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
    // 既定値を30分へ
    '<input id="medTimerMin" type="number" min="0.01" step="0.01" value="30" title="カウントダウン分" />'+
    '<span id="medTimerDisplay">--:--</span>'+
    '<span class="med-startat">開始: <b id="medTimerStartedAt">--:--</b></span>'+
    '<button id="medTimerStart">開始</button>'+
    '<button id="medTimerPause" disabled>一時停止</button>'+
    '<button id="medTimerResume" disabled>再開</button>'+
    '<button id="medTimerCancel" disabled>中止</button>'+
  '</div>'+
  '<div class="med-add"><input id="medNewMin" type="number" min="1" placeholder="分" /><button id="medAddBtn">追加</button><button id="medClearDay" class="danger">日クリア</button></div>';
  document.body.appendChild(medEditorEl);
  medEditorEl.querySelector('#medClose').addEventListener('click', ()=> hideMedEditor());
  medEditorEl.querySelector('#medAddBtn').addEventListener('click', ()=> addMedSession());
  medEditorEl.querySelector('#medNewMin').addEventListener('keydown', e=>{ if(e.key==='Enter'){ addMedSession(); }});
  medEditorEl.querySelector('#medClearDay').addEventListener('click', ()=>{ clearMedDay(); });
  // Timer bindings
  medEditorEl.querySelector('#medTimerStart').addEventListener('click', handleMedTimerStartButton);
  medEditorEl.querySelector('#medTimerPause').addEventListener('click', pauseMedTimer);
  medEditorEl.querySelector('#medTimerResume').addEventListener('click', resumeMedTimer);
  medEditorEl.querySelector('#medTimerCancel').addEventListener('click', cancelMedTimer);
  document.addEventListener('click', (e)=>{
    if(!medEditorEl) return;
    if(!medEditorEl.contains(e.target) && !e.target.closest('.cell')) hideMedEditor();
  });
  resetStartButtonMode();
  return medEditorEl;
}
let medEditTarget = { dateKey:null, anchor:null };
function openMeditationEditor(dateKey, anchorEl, sessions){
  ensureMedEditor();
  medEditTarget.dateKey = dateKey; medEditTarget.anchor = anchorEl;
  const box = medEditorEl;

  const isMobile = window.matchMedia('(max-width: 640px)').matches;
  if (isMobile) {
    Object.assign(box.style, {
      display: 'flex',
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      width: '100vw',
      height: '100vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      padding: '24px clamp(18px, 6vw, 28px) calc(24px + env(safe-area-inset-bottom))',
      borderRadius: '0',
      border: '0',
      boxShadow: 'none',
      overflow: 'auto',
      zIndex: '2000',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: '18px',
      justifyContent: 'flex-start',
      background: 'var(--card, #0b1220)'
    });
    box.scrollTop = 0;
  } else {
    Object.assign(box.style, {
      display: 'block',
      position: 'absolute',
      maxWidth: '96vw',
      maxHeight: 'calc(100vh - 16px)',
      width: '',
      height: '',
      right: '',
      bottom: '',
      padding: '',
      borderRadius: '',
      border: '',
      boxShadow: '',
      overflow: 'auto',
      zIndex: '2000',
      flexDirection: '',
      alignItems: '',
      gap: '',
      justifyContent: '',
      background: ''
    });

    // 表示してサイズを測れるようにする＋ビューポート内に収まる上限を付与
    box.style.display='block';
    box.style.maxWidth = '96vw';
    box.style.maxHeight = 'calc(100vh - 16px)';
    box.style.overflow = 'auto';

    const r = anchorEl.getBoundingClientRect();
    const margin = 8;
    const bw = box.offsetWidth || 240;
    const bh = box.offsetHeight || 200;

    // 横位置: 左端/右端をクランプ
    let left = Math.max(margin, Math.min(r.left, window.innerWidth - bw - margin));
    // 縦位置: 下に出す→はみ出すなら上→それでも無理なら中央寄せ（上下クランプ）
    let top = r.bottom + 6;
    if (top + bh > window.innerHeight - margin) {
      const aboveTop = r.top - bh - 6;
      if (aboveTop >= margin) {
        top = aboveTop; // 上に出す
      } else {
        // ビューポート中央寄せ（上下クランプ）
        top = Math.max(margin, Math.min(window.innerHeight - bh - margin, r.top + (r.height/2) - (bh/2)));
      }
    }

    box.style.left = Math.round(left) + 'px';
    box.style.top  = Math.round(top)  + 'px';
  }

  const medHead = box.querySelector('.med-head');
  if (medHead) {
    if (isMobile) {
      Object.assign(medHead.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '0'
      });
    } else {
      medHead.removeAttribute('style');
    }
  }

  const medTimerBox = box.querySelector('#medTimerBox');
  if (medTimerBox) {
    if (isMobile) {
      Object.assign(medTimerBox.style, {
        display: 'grid',
        gap: '10px',
        padding: '16px',
        borderRadius: '16px',
        background: 'rgba(15,23,42,0.78)',
        boxShadow: '0 0 0 1px rgba(148,163,184,0.18)'
      });
    } else {
      medTimerBox.removeAttribute('style');
    }
  }

  const medSessionsEl = box.querySelector('#medSessions');
  if (medSessionsEl) {
    if (isMobile) {
      Object.assign(medSessionsEl.style, {
        flex: '1',
        minHeight: '0',
        overflow: 'auto',
        padding: '14px 12px',
        borderRadius: '16px',
        background: 'rgba(15,23,42,0.6)',
        boxShadow: 'inset 0 0 0 1px rgba(148,163,184,0.12)',
        display: 'grid',
        gap: '10px',
        gridTemplateColumns: '1fr'
      });
    } else {
      medSessionsEl.removeAttribute('style');
    }
  }

  const medAddRow = box.querySelector('.med-add');
  if (medAddRow) {
    if (isMobile) {
      Object.assign(medAddRow.style, {
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) auto auto',
        gap: '10px',
        alignItems: 'center'
      });
    } else {
      medAddRow.removeAttribute('style');
    }
  }

  box.querySelector('#medEditDate').textContent = dateKey;
  renderMedSessionList();
  const inp = box.querySelector('#medNewMin');
  inp.setAttribute('step','0.1');
  setTimeout(()=>{ box.querySelector('#medTimerStart')?.focus(); }, 0);
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
  const existing = md[medEditTarget.dateKey] || {};
  const exerciseCopy = cloneExerciseData(existing.exercise);
  // preserve starts alignment if exists
  if(arr.length===0){
    const hasExercise = Array.isArray(exerciseCopy?.sessions) && exerciseCopy.sessions.length>0;
    if(hasExercise){
      const obj = {
        sessions: [],
        starts: [],
        ids: [],
        dayTs: new Date().toISOString(),
        replace: true
      };
      if(exerciseCopy) obj.exercise = exerciseCopy;
      md[medEditTarget.dateKey] = obj;
    } else {
      md[medEditTarget.dateKey] = { __deleted:true, ts:new Date().toISOString() };
    }
  } else {
    let starts = Array.isArray(existing.starts) ? existing.starts.slice() : [];
    let ids = Array.isArray(existing.ids) ? existing.ids.slice() : [];
    // trim/extend starts to match sessions length
    if(starts.length > arr.length) starts = starts.slice(0, arr.length);
    if(starts.length < arr.length) starts = starts.concat(Array(arr.length - starts.length).fill(''));
    if(ids.length > arr.length) ids = ids.slice(0, arr.length);
    if(ids.length < arr.length){
      for(let i=ids.length;i<arr.length;i++){ ids.push('m'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)); }
    }
    const oldLen = Array.isArray(existing.sessions) ? existing.sessions.length : 0;
    const obj = {
      sessions: arr,
      starts,
      ids,
      dayTs: new Date().toISOString()
    };
    if(exerciseCopy) obj.exercise = exerciseCopy;
    if(arr.length < oldLen){ obj.replace = true; } // 減少編集は置換扱い
    md[medEditTarget.dateKey] = obj;
  }
  writeMonth(state.uid, state.year, state.month, md);
  if(window.syncAfterNewMeditationSession) window.syncAfterNewMeditationSession();
  renderCalendar(); // re-render calendar & stats
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
  const exerciseCopy = cloneExerciseData(rec.exercise);
  const obj = { sessions, starts, ids, dayTs:new Date().toISOString() };
  if(exerciseCopy) obj.exercise = exerciseCopy;
  md[medEditTarget.dateKey] = obj;
  writeMonth(state.uid, state.year, state.month, md);
  if(window.syncAfterNewMeditationSession) window.syncAfterNewMeditationSession();
  renderCalendar();
  renderMedSessionList();
}
function renderMedSessionList(){
  if(!medEditorEl) return;
  const wrap = medEditorEl.querySelector('#medSessions');
  const timerDisplay = medEditorEl.querySelector('#medTimerDisplay');
  if(timerDisplay){
    const timerStyle = window.getComputedStyle(timerDisplay);
    const basePx = parseFloat(timerStyle.fontSize) || 0;
    if(basePx){
      wrap.style.fontSize = `${Math.round(basePx * 1.45)}px`;
      wrap.style.lineHeight = '1.36';
    } else {
      wrap.style.fontSize = 'clamp(2.6rem, 7vw, 4.8rem)';
      wrap.style.lineHeight = '1.36';
    }
  } else {
    wrap.style.fontSize = 'clamp(2.6rem, 7vw, 4.8rem)';
    wrap.style.lineHeight = '1.36';
  }
  wrap.style.gap = '18px';
  const md = readMonth(state.uid, state.year, state.month);
  const rec = md[medEditTarget.dateKey] || {};
  const sessions = Array.isArray(rec.sessions)? rec.sessions : [];
  const starts = Array.isArray(rec.starts)? rec.starts : [];
  wrap.innerHTML = '';
  if(!sessions.length){ wrap.innerHTML = '<div class="empty">記録なし</div>'; return; }
  sessions.forEach((m,i)=>{
    const startIso = starts[i] || '';
    const startTxt = startIso ? new Date(startIso).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '--:--';
    const row=document.createElement('div');
    row.className='med-row';
    row.style.display='grid';
    row.style.gridTemplateColumns='1fr';
    row.style.alignItems='center';
    row.innerHTML=`
      <div class="entry" style="display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:1.12em;letter-spacing:0.025em;">
        <span class="time" style="font-size:1em;">${startTxt}</span>
        <span class="min" style="font-size:1em;">${m}分</span>
      </div>
      <span class="actions" style="grid-column:1 / -1; display:flex; justify-content:flex-end; gap:12px; font-size:0.5em;">
        <button data-edit="${i}" title="編集">✏</button>
        <button data-del="${i}" title="削除">✕</button>
      </span>`;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('button[data-edit]').forEach(b=> b.addEventListener('click', ()=>{
    const idx = parseInt(b.getAttribute('data-edit'),10);
    const cur = readMedSessions(); const curVal=cur[idx];
    const nvStr = prompt('新しい分数', curVal);
    if(nvStr===null) return; const nv=parseFloat(nvStr); if(!Number.isFinite(nv)||nv<=0){ alert('正の数'); return; }
    const next = cur.slice(); next[idx]=nv;
    writeMedSessions(next);
  }));
  wrap.querySelectorAll('button[data-del]').forEach(b=> b.addEventListener('click', ()=>{
    const idx = parseInt(b.getAttribute('data-del'),10);
    // delete both sessions and starts
    const md = readMonth(state.uid, state.year, state.month);
    const rec = md[medEditTarget.dateKey] || {};
    const sessions = Array.isArray(rec.sessions)? rec.sessions.slice(): [];
    const starts = Array.isArray(rec.starts)? rec.starts.slice(): [];
    const ids = Array.isArray(rec.ids)? rec.ids.slice(): [];
    const oldLen = sessions.length;
    sessions.splice(idx,1);
    if(starts.length>idx) starts.splice(idx,1);
    if(ids.length>idx) ids.splice(idx,1);
    const exerciseCopy = cloneExerciseData(rec.exercise);
    if(sessions.length){
      const obj = { sessions, starts, ids, dayTs: new Date().toISOString(), replace: true };
      if(exerciseCopy) obj.exercise = exerciseCopy;
      md[medEditTarget.dateKey] = obj;
    } else {
      const hasExercise = Array.isArray(exerciseCopy?.sessions) && exerciseCopy.sessions.length>0;
      if(hasExercise){
        const obj = { sessions: [], starts: [], ids: [], dayTs: new Date().toISOString(), replace: true };
        obj.exercise = exerciseCopy;
        md[medEditTarget.dateKey] = obj;
      } else {
        md[medEditTarget.dateKey] = { __deleted:true, ts: new Date().toISOString() };
      }
    }
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

// ===== Exercise session panel =====
const EXERCISE_TYPES = [
  { type:'plank', label:'プランク', icon:'🧘', defaultSeconds:30 },
  { type:'wall-sit', label:'空気椅子', icon:'🪑', defaultSeconds:30 }
];

let exercisePanelEl = null;
let exerciseCtx = { dateKey: null, anchor: null };
const exerciseTimers = {};

function ensureExercisePanel(){
  if(exercisePanelEl) return exercisePanelEl;
  const overlay = document.createElement('div');
  overlay.id = 'exerciseOverlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(15,23,42,0.58)',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '3600',
    padding: 'clamp(18px, 8vw, 32px)'
  });

  const dialog = document.createElement('div');
  dialog.className = 'exercise-dialog';
  Object.assign(dialog.style, {
    width: 'min(96vw, 420px)',
    maxHeight: '92vh',
    overflow: 'auto',
    display: 'grid',
    gap: '20px',
    background: 'var(--card, #0f172a)',
    color: '#e2e8f0',
    borderRadius: '18px',
    padding: '26px clamp(22px,7vw,34px)',
    boxShadow: '0 24px 48px rgba(15,23,42,0.55), 0 0 0 1px rgba(148,163,184,0.18)'
  });

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.gap = '12px';

  const titleBox = document.createElement('div');
  titleBox.innerHTML = `<div style="font-size:1.05rem;font-weight:800">エクササイズ記録</div><div id="exerciseDateLabel" style="font-size:0.92rem;opacity:0.7;"></div>`;
  header.appendChild(titleBox);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '閉じる';
  Object.assign(closeBtn.style, {
    border: '1px solid rgba(148,163,184,0.35)',
    borderRadius: '10px',
    padding: '6px 12px',
    background: 'transparent',
    color: '#cbd5f5',
    fontWeight: '600',
    cursor: 'pointer'
  });
  header.appendChild(closeBtn);

  const cardsWrap = document.createElement('div');
  cardsWrap.style.display = 'grid';
  cardsWrap.style.gap = '16px';

  EXERCISE_TYPES.forEach(def=> cardsWrap.appendChild(buildExerciseCard(def)) );

  const logBox = document.createElement('div');
  logBox.innerHTML = `<div style="font-weight:700;font-size:0.95rem">今日の記録</div><div id="exerciseLog" style="display:grid;gap:10px;margin-top:10px"></div>`;

  dialog.append(header, cardsWrap, logBox);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  closeBtn.addEventListener('click', ()=> closeExercisePanel());
  overlay.addEventListener('click', (ev)=>{ if(ev.target === overlay) closeExercisePanel(); });
  document.addEventListener('keydown', (ev)=>{
    if(overlay.style.display !== 'flex') return;
    if(ev.key === 'Escape'){ ev.stopPropagation(); closeExercisePanel(); }
  }, true);

  overlay._dateLabel = titleBox.querySelector('#exerciseDateLabel');
  overlay._log = logBox.querySelector('#exerciseLog');
  exercisePanelEl = overlay;
  return exercisePanelEl;
}

function buildExerciseCard(def){
  const card = document.createElement('div');
  card.className = 'exercise-card';
  Object.assign(card.style, {
    borderRadius: '14px',
    border: '1px solid rgba(148,163,184,0.22)',
    padding: '16px',
    background: 'rgba(30,41,59,0.6)',
    display: 'grid',
    gap: '10px'
  });
  card.dataset.type = def.type;

  const head = document.createElement('div');
  Object.assign(head.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px'
  });

  const title = document.createElement('div');
  Object.assign(title.style, {
    fontWeight: '700',
    fontSize: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  });
  title.textContent = `${def.icon} ${def.label}`;

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '5';
  input.step = '5';
  input.value = String(def.defaultSeconds);
  input.dataset.role = `seconds-${def.type}`;
  input.classList.add('exercise-seconds-input');
  Object.assign(input.style, {
    width: '4.2ch',
    borderRadius: '8px',
    border: '1px solid rgba(148,163,184,0.28)',
    background: 'rgba(15,23,42,0.7)',
    color: '#e2e8f0',
    padding: '6px 8px',
    fontWeight: '600',
    fontSize: '0.95rem',
    textAlign: 'right',
    appearance: 'textfield'
  });
  input.style.MozAppearance = 'textfield';
  input.style.WebkitAppearance = 'none';

  head.append(title, input);

  const display = document.createElement('div');
  display.dataset.role = `display-${def.type}`;
  Object.assign(display.style, {
    fontFamily: 'var(--mono, "Roboto Mono", "SFMono-Regular", monospace)',
    fontSize: 'clamp(2.4rem, 6vw, 3.4rem)',
    fontWeight: '700',
    letterSpacing: '0.04em',
    flex: '1',
    minWidth: 0
  });
  display.innerHTML = formatSeconds(def.defaultSeconds);

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.dataset.role = `start-${def.type}`;
  startBtn.textContent = '開始';
  Object.assign(startBtn.style, {
    flex: '0 0 auto',
    borderRadius: '10px',
    border: '0',
    background: 'linear-gradient(135deg,#22d3ee,#6366f1)',
    color: '#0f172a',
    fontWeight: '700',
    padding: '10px 18px',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  });

  const timerRow = document.createElement('div');
  Object.assign(timerRow.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    justifyContent: 'space-between'
  });
  timerRow.append(display, startBtn);

  card.append(head, timerRow);

  exerciseTimers[def.type] = {
    type: def.type,
    defaultSeconds: def.defaultSeconds,
    running: false,
    timerId: null,
    remainingMs: def.defaultSeconds * 1000,
    startedAt: null,
    finishedAt: null,
    endAt: 0,
    displayEl: display,
    inputEl: input,
    startBtn,
    alarmOn: false,
    alarmCtx: null,
    alarmOsc: null,
    alarmGain: null,
    alarmInterval: null
  };

  startBtn.addEventListener('click', ()=> handleExerciseStartClick(def.type));

  return card;
}

function openExercisePanel({ dateKey, anchor }){
  const overlay = ensureExercisePanel();
  exerciseCtx = { dateKey, anchor: anchor || null };
  if(overlay._dateLabel) overlay._dateLabel.textContent = dateKey;
  overlay.style.display = 'flex';
  overlay.setAttribute('data-open','1');
  resetAllExerciseTimers();
  renderExerciseLog();
  setTimeout(()=>{
    const firstStart = overlay.querySelector('button[data-role^="start-"]');
    firstStart?.focus();
  }, 20);
}

function closeExercisePanel(){
  if(!exercisePanelEl) return;
  exercisePanelEl.style.display = 'none';
  exercisePanelEl.removeAttribute('data-open');
  const prevAnchor = exerciseCtx.anchor;
  resetAllExerciseTimers();
  if(prevAnchor && typeof prevAnchor.focus === 'function'){
    setTimeout(()=>{
      try{ prevAnchor.focus(); }catch{}
    }, 0);
  }
  exerciseCtx = { dateKey: null, anchor: null };
}

function resetAllExerciseTimers(){
  Object.values(exerciseTimers).forEach(state=>{
    if(state.timerId){ clearInterval(state.timerId); state.timerId=null; }
    if(state.alarmOn) stopExerciseAlarm(state.type, { update:false });
    state.running = false;
    const baseSeconds = Number(state.inputEl?.value) || state.defaultSeconds;
    state.remainingMs = baseSeconds * 1000;
    state.startedAt = null;
    state.finishedAt = null;
    state.endAt = 0;
    updateExerciseTimerUI(state.type);
  });
}

function handleExerciseStartClick(type){
  const state = exerciseTimers[type];
  if(!state) return;
  if(state.alarmOn){
    const hadFinished = !!state.finishedAt;
    stopExerciseAlarm(type);
    if(!hadFinished){
      state.finishedAt = new Date();
      updateExerciseTimerUI(type);
    }
    return;
  }
  if(state.running){
    cancelExerciseTimer(type);
    return;
  }
  startExerciseTimer(type);
}

function startExerciseAlarm(type){
  const state = exerciseTimers[type];
  if(!state) return;
  stopExerciseAlarm(type, { update:false });
  state.alarmOn = true;
  try{
    const C = window.AudioContext || window.webkitAudioContext;
    if(C){
      state.alarmCtx = new C();
      state.alarmOsc = state.alarmCtx.createOscillator();
      state.alarmGain = state.alarmCtx.createGain();
      state.alarmOsc.type = 'square';
      state.alarmOsc.frequency.value = 820;
      state.alarmGain.gain.value = 0.08;
      state.alarmOsc.connect(state.alarmGain).connect(state.alarmCtx.destination);
      state.alarmOsc.start();
      state.alarmInterval = setInterval(()=>{
        if(!state.alarmGain || !state.alarmCtx) return;
        try{
          const t = state.alarmCtx.currentTime;
          state.alarmGain.gain.setValueAtTime(0.08, t);
          state.alarmGain.gain.setValueAtTime(0.0, t + 0.25);
        }catch{}
      }, 450);
    }
  }catch(e){ console.warn('[exercise] alarm failed', e); }
  if(typeof navigator !== 'undefined' && navigator.vibrate){
    try { navigator.vibrate([200, 120, 200]); } catch {}
  }
  updateExerciseTimerUI(type);
}

function stopExerciseAlarm(type, opts){
  const state = exerciseTimers[type];
  if(!state) return;
  if(state.alarmInterval){ clearInterval(state.alarmInterval); state.alarmInterval=null; }
  try{ state.alarmOsc?.stop?.(); }catch{}
  try{ state.alarmGain?.disconnect?.(); }catch{}
  try{ state.alarmCtx?.close?.(); }catch{}
  state.alarmCtx = null;
  state.alarmOsc = null;
  state.alarmGain = null;
  state.alarmOn = false;
  if(typeof navigator !== 'undefined' && navigator.vibrate){
    try { navigator.vibrate(0); } catch {}
  }
  if(opts?.update !== false) updateExerciseTimerUI(type);
}

function startExerciseTimer(type){
  const state = exerciseTimers[type];
  if(!state || state.running) return;
  stopExerciseAlarm(type, { update:false });
  const seconds = Number(state.inputEl?.value)||state.defaultSeconds;
  if(!Number.isFinite(seconds) || seconds<=0){
    alert('正の秒数を入力してください');
    state.inputEl?.focus();
    return;
  }
  state.remainingMs = seconds*1000;
  state.startedAt = new Date();
  state.finishedAt = null;
  state.endAt = Date.now() + state.remainingMs;
  state.running = true;
  state.seconds = seconds;
  if(state.timerId) clearInterval(state.timerId);
  state.timerId = setInterval(()=> tickExerciseTimer(type), 200);
  updateExerciseTimerUI(type);
}

function tickExerciseTimer(type){
  const state = exerciseTimers[type];
  if(!state || !state.running) return;
  const left = state.endAt - Date.now();
  if(left <= 0){
    finishExerciseTimer(type);
  } else {
    state.remainingMs = left;
    updateExerciseTimerUI(type);
  }
}

function finishExerciseTimer(type){
  const state = exerciseTimers[type];
  if(!state) return;
  if(state.timerId){ clearInterval(state.timerId); state.timerId=null; }
  const startedAt = state.startedAt ? new Date(state.startedAt) : new Date();
  state.running = false;
  state.remainingMs = 0;
  state.finishedAt = new Date();
  updateExerciseTimerUI(type);
  recordExerciseSession({
    type,
    seconds: state.seconds || Number(state.inputEl?.value)||state.defaultSeconds,
    startedAt: startedAt.toISOString(),
    completedAt: state.finishedAt.toISOString()
  });
  startExerciseAlarm(type);
}

function cancelExerciseTimer(type){
  const state = exerciseTimers[type];
  if(!state) return;
  if(state.timerId){ clearInterval(state.timerId); state.timerId=null; }
  stopExerciseAlarm(type, { update:false });
  state.running = false;
  const baseSeconds = Number(state.inputEl?.value) || state.defaultSeconds;
  state.remainingMs = baseSeconds * 1000;
  state.startedAt = null;
  state.finishedAt = null;
  state.endAt = 0;
  updateExerciseTimerUI(type);
}

function updateExerciseTimerUI(type){
  const state = exerciseTimers[type];
  if(!state) return;
  let displaySeconds;
  if(state.running){
    displaySeconds = Math.ceil(Math.max(0, state.remainingMs)/1000);
  } else if(state.alarmOn){
    displaySeconds = 0;
  } else {
    displaySeconds = Math.max(0, Math.round(Number(state.inputEl?.value) || state.defaultSeconds));
  }
  if(state.displayEl) state.displayEl.innerHTML = formatSeconds(displaySeconds);
  if(state.startBtn){
    state.startBtn.disabled = false;
    state.startBtn.textContent = '開始';
    state.startBtn.style.background = 'linear-gradient(135deg,#22d3ee,#6366f1)';
    state.startBtn.style.color = '#0f172a';
    state.startBtn.style.boxShadow = '';

    if(state.running){
      state.startBtn.textContent = 'リセット';
      state.startBtn.style.background = 'linear-gradient(135deg, rgba(94,234,212,0.95), rgba(45,212,191,0.9))';
      state.startBtn.style.boxShadow = '0 0 0 2px rgba(16,185,129,0.25)';
    }

    if(state.alarmOn){
      state.startBtn.textContent = '消音';
      state.startBtn.style.background = 'linear-gradient(135deg, rgba(248,113,113,0.95), rgba(185,28,28,0.92))';
      state.startBtn.style.color = '#fff';
      state.startBtn.style.boxShadow = '0 0 0 2px rgba(248,113,113,0.35)';
    }
  }
  if(state.inputEl) state.inputEl.disabled = state.running || state.alarmOn;
}

function recordExerciseSession(session){
  if(!exerciseCtx.dateKey) return;
  const list = readExerciseSessions(exerciseCtx.dateKey);
  const newId = 'e'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  list.push({
    id: session.id || newId,
    type: session.type,
    seconds: Number(session.seconds)||0,
    startedAt: session.startedAt || new Date().toISOString(),
    completedAt: session.completedAt || new Date().toISOString()
  });
  writeExerciseSessions(exerciseCtx.dateKey, list);
  renderExerciseLog();
}

function deleteExerciseSession(id){
  if(!exerciseCtx.dateKey) return;
  const list = readExerciseSessions(exerciseCtx.dateKey).filter(item=> item.id !== id);
  writeExerciseSessions(exerciseCtx.dateKey, list);
  renderExerciseLog();
}

function readExerciseSessions(dateKey){
  const { year, month } = parseDateKeyParts(dateKey);
  const md = readMonth(state.uid, year, month);
  const rec = md[dateKey];
  const items = Array.isArray(rec?.exercise?.sessions) ? rec.exercise.sessions : [];
  return items.map(item=>({
    id: typeof item?.id === 'string' ? item.id : 'e'+Math.random().toString(36).slice(2,7),
    type: item?.type || 'plank',
    seconds: Number(item?.seconds)||0,
    startedAt: item?.startedAt || '',
    completedAt: item?.completedAt || ''
  }));
}

function writeExerciseSessions(dateKey, sessions){
  const { year, month } = parseDateKeyParts(dateKey);
  const md = readMonth(state.uid, year, month);
  const existing = md[dateKey] || {};
  const medSessions = Array.isArray(existing.sessions) ? existing.sessions.slice() : [];
  const starts = Array.isArray(existing.starts) ? existing.starts.slice() : [];
  const ids = Array.isArray(existing.ids) ? existing.ids.slice() : [];
  const nowIso = new Date().toISOString();
  const normalized = sessions.map(item=>({
    id: typeof item?.id === 'string' ? item.id : 'e'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
    type: item?.type || 'plank',
    seconds: Number(item?.seconds)||0,
    startedAt: item?.startedAt || nowIso,
    completedAt: item?.completedAt || nowIso
  }));

  const hasMeditation = medSessions.length > 0;
  if(normalized.length === 0 && !hasMeditation){
    md[dateKey] = { __deleted:true, ts: nowIso };
  } else {
    const next = { ...existing };
    if(hasMeditation){
      next.sessions = medSessions;
      next.starts = starts;
      next.ids = ids;
    } else {
      next.sessions = Array.isArray(next.sessions) ? next.sessions : [];
      next.starts = Array.isArray(next.starts) ? next.starts : [];
      next.ids = Array.isArray(next.ids) ? next.ids : [];
    }
    delete next.__deleted;
    if(normalized.length){
      next.exercise = { sessions: normalized, updatedAt: nowIso };
    } else {
      delete next.exercise;
    }
    next.dayTs = nowIso;
    md[dateKey] = next;
  }
  writeMonth(state.uid, year, month, md);
  renderCalendar();
  if(window.syncAfterExerciseUpdate) window.syncAfterExerciseUpdate();
}

function renderExerciseLog(){
  if(!exercisePanelEl) return;
  const wrap = exercisePanelEl._log;
  if(!wrap || !exerciseCtx.dateKey){
    if(wrap) wrap.innerHTML = '<div class="empty">記録なし</div>';
    return;
  }
  const list = readExerciseSessions(exerciseCtx.dateKey).sort((a,b)=>{
    const aTime = a.completedAt || a.startedAt;
    const bTime = b.completedAt || b.startedAt;
    return (bTime||'').localeCompare(aTime||'');
  });
  if(!list.length){
    wrap.innerHTML = '<div class="empty">記録なし</div>';
    return;
  }
  wrap.innerHTML = '';
  list.forEach(item=>{
    const row = document.createElement('div');
    row.className = 'exercise-row';
    Object.assign(row.style, {
      borderRadius: '10px',
      border: '1px solid rgba(148,163,184,0.24)',
      padding: '10px 12px',
      display: 'grid',
      gap: '4px',
      background: 'rgba(30,41,59,0.55)'
    });
    const timeText = item.startedAt ? formatTime(item.startedAt) : '--:--';
    const typeDef = EXERCISE_TYPES.find(def=> def.type===item.type);
    const label = typeDef ? `${typeDef.icon} ${typeDef.label}` : item.type;
    row.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-weight:700">${label}</span><span style="font-size:0.85rem;opacity:0.7">${timeText}</span></div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-size:0.95rem;font-weight:700">${item.seconds}秒</span><button type="button" data-del="${item.id}" style="border:0;border-radius:8px;padding:6px 10px;background:rgba(248,113,113,0.18);color:#fca5a5;font-weight:700;cursor:pointer">削除</button></div>`;
    row.querySelector('button[data-del]')?.addEventListener('click', ()=> deleteExerciseSession(item.id));
    wrap.appendChild(row);
  });
}

function formatSeconds(totalSeconds){
  const sec = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(sec/60);
  const s = sec % 60;
  if(m>0){ return `${m}:${String(s).padStart(2,'0')}`; }
  return `${s}<span style="font-size:0.5em; display:inline-block; margin-left:0.08em; line-height:1; transform-origin:left bottom;">秒</span>`;
}

function formatTime(value){
  if(!value) return '--:--';
  try{
    const date = (value instanceof Date) ? value : new Date(value);
    if(Number.isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  }catch{ return '--:--'; }
}

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
}

function resetStartButtonMode(){
  const btn = medEditorEl?.querySelector('#medTimerStart');
  if(!btn) return;
  btn.textContent = '開始';
  btn.dataset.mode = 'start';
  btn.classList.remove('alarm-stop');
  btn.style.background = '';
  btn.style.color = '';
  btn.style.boxShadow = '';
}
function switchStartButtonToAlarmStop(){
  const btn = medEditorEl?.querySelector('#medTimerStart');
  if(!btn) return;
  btn.textContent = '消音';
  btn.dataset.mode = 'alarm-stop';
  btn.classList.add('alarm-stop');
  btn.style.background = 'linear-gradient(135deg, rgba(248,113,113,0.95), rgba(185,28,28,0.92))';
  btn.style.color = '#fff';
  btn.style.boxShadow = '0 0 0 2px rgba(248,113,113,0.35)';
}
function handleMedTimerStartButton(ev){
  const btn = ev.currentTarget;
  if(btn.dataset.mode === 'alarm-stop'){ stopAlarm(); return; }
  startMedTimer();
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
  } catch { }
  if (navigator.vibrate) try { navigator.vibrate([200, 150, 200, 150, 200]); } catch { }
  switchStartButtonToAlarmStop();
}
function stopAlarm(){
  try {
    if (medAlarm._beepInt) { clearInterval(medAlarm._beepInt); medAlarm._beepInt = null; }
    if (medAlarm.osc) { medAlarm.osc.stop(); medAlarm.osc.disconnect(); }
    if (medAlarm.ctx) { medAlarm.ctx.close(); }
  } catch { }
  medAlarm = { ctx: null, osc: null, gain: null, on: false, _beepInt: null };
  resetStartButtonMode();
  setTimerButtons({start:true,pause:false,resume:false,cancel:false});
}
function startMedTimer(){
  resetStartButtonMode();
  const min = parseFloat(medEditorEl.querySelector('#medTimerMin').value)||0;
  if(min<=0){ alert('分を入力してください'); return; }
  showMedAlert([
    'イヤホンが刺さっていないですか？',
    'BLUETOOTHイヤホンに繋がっていないですか？',
    '<span style="color:#38bdf8;font-weight:800;">メディア</span>音量が十分か目視確認して下さい'
  ]);
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
function cancelMedTimer(){ if(medTimer.id) clearInterval(medTimer.id); medTimer={id:null,running:false,endAt:0,remaining:0,startedAt:null}; resetStartButtonMode(); setTimerButtons({start:true,pause:false,resume:false,cancel:false}); updateTimerDisplay(); }

// clearThisMonth 機能削除 (UI 簡略化)

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
// clearMonthBtn 削除に伴いイベント未登録

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
    return countAttendanceDays(md, state.year, state.month);
  })();
  const be = perVisit>0 ? Math.ceil(monthly / perVisit) : 0;
  const remaining = Math.max(0, be - attended);
  const eff = attended>0 ? Math.round(monthly/attended) : monthly;
  // 1回あたりの差額（実質1回単価 − 想定1回コスト）
  const diffPerVisit = eff - perVisit;

  const box = $('financeStats');
  if(box){
    box.innerHTML = '';
    box.append(
      makeStat(`想定1回コスト: <b>${perVisit.toLocaleString()}円</b>`),
      makeStat(`損益分岐の回数: <b>${be}</b> 回 / 今月の出席: <b>${attended}</b> 回`),
      makeStat(`分岐まで残り: <b>${remaining}</b> 回`),
      makeStat(`現在の実質1回単価(月額/出席): <b>${eff.toLocaleString()}円</b>`),
      // 実質1回単価と比較（例: 1463-539 = 924円 割高）
      makeStat(`${diffPerVisit>=0?'日割りより割高':'日割りより割安'}: <b>${Math.abs(diffPerVisit).toLocaleString()}円</b>`),
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
      mkChip('収支分岐まで', remaining),
      mkChip('1回実質', eff?`${eff.toLocaleString()}円`:'-'),
      mkChip(diffPerVisit>=0?'割高':'割安', `${Math.abs(diffPerVisit).toLocaleString()}円`)
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
// ページ固有 S3 設定 (他ページと docId を共有しない: グローバル/フォールバック廃止)
const LS_S3 = `${PAGE_PREFIX}_s3_cfg_iso_v1`;
function getS3Cfg(){
  try{ return JSON.parse(localStorage.getItem(LS_S3)||'null') || {}; }catch{ return {}; }
}
function saveS3Cfg(v){
  localStorage.setItem(LS_S3, JSON.stringify(v));
}

// 互換: 過去の共有キーを「削除」ではなく「移行」
const OLD_S3_KEYS = ['global_s3_cfg_v1','med_s3_cfg_v1','cw_s3_cfg_v1'];
function migrateOldS3CfgOnce(){
  try{
    if(localStorage.getItem(LS_S3)) return; // 既に新キーがある
    for(const k of OLD_S3_KEYS){
      const v = localStorage.getItem(k);
      if(v){
        localStorage.setItem(LS_S3, v);
        OLD_S3_KEYS.forEach(key=>{ try{ localStorage.removeItem(key); }catch{} });
        console.info('[sync] migrated S3 config from', k);
        break;
      }
    }
  }catch{}
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
    if(!docId || docId.length<6 || !/[A-Za-z0-9]$/.test(docId)) return alert('docId が短すぎるか未確定です');
    const pass=$('s3Passphrase').value;
    const appPw=$('s3Password').value;
    if(!docId||!pass||!appPw){ alert('ドキュメントID/パスフレーズ/APP_PASSWORD を入力'); return; }
    const keep = $('s3AutoRestore').checked; if(keep) saveS3Cfg({docId,passphrase:pass,password:appPw,auto:true});
    // メタ管理付きの統一 autoPush を利用
    markDirtyImmediate();
    setSyncStatus('manual push queued');
    // 手動プッシュはユーザー操作なので auto フラグに関係なく強制実行する
    await autoPush(true);
  }catch(e){ alert(e.message||e); }
});

$('s3Pull').addEventListener('click', async()=>{
  try{
    const docId=$('s3DocId').value.trim();
    if(!docId || docId.length<6 || !/[A-Za-z0-9]$/.test(docId)) return alert('docId が短すぎるか未確定です');
    const pass=$('s3Passphrase').value;
    const appPw=$('s3Password').value;
    if(!docId||!pass||!appPw){ alert('ドキュメントID/パスフレーズ/APP_PASSWORD を入力'); return; }
    const keep = $('s3AutoRestore').checked; if(keep) saveS3Cfg({docId,passphrase:pass,password:appPw,auto:true});
    // __fastPull がまだ宣言前 (autoRestore の即時 click) なら次tickに遅延
    if(typeof __fastPull === 'undefined'){
      setTimeout(()=>{
        if(typeof __fastPull !== 'undefined'){
          __fastPull.lastETag = null;
          setSyncStatus('manual pull');
          autoPull();
        }
      },0);
      return;
    }
    __fastPull.lastETag = null; // 強制 fresh pull
    setSyncStatus('manual pull');
    await autoPull();
  }catch(e){ alert(e.message||e); }
});

function autoS3RestoreIfConfigured(){
  const c=getS3Cfg();
  if(c.auto && c.docId && c.passphrase && c.password){
    // silent pull
    $('s3DocId').value=c.docId; $('s3Passphrase').value=c.passphrase; $('s3Password').value=c.password; $('s3AutoRestore').checked=true;
    // __fastPull 定義完了後に確実に走るよう次tickへ
    setTimeout(()=>{ const btn=$('s3Pull'); if(btn) btn.click(); },0);
  }
}

migrateOldS3CfgOnce(); // 追加: 旧S3設定を一度だけ移行
renderS3Inputs();
autoS3RestoreIfConfigured();

// ===== Encryption Helpers (AES-GCM, E2E) =====
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
  // 自動開始条件強化: docId 最低長さ / 末尾ハイフン等で未確定とみなす / 許可された文字種のみ
  const docOk = cfg.docId && cfg.docId.length >= 6 && /[A-Za-z0-9]$/.test(cfg.docId) && /^[A-Za-z0-9._-]+$/.test(cfg.docId);
  if(cfg.auto && docOk && cfg.passphrase && cfg.password){
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
  try{ console.info('[sync status]', msg); }catch(e){}
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
        const isMed = v => v && typeof v==='object' && (Array.isArray(v.sessions) || Array.isArray(v.starts) || Array.isArray(v.ids));
        const isAttendanceObj = v => v && typeof v==='object' && !isMed(v) && (v.work!==undefined || v.__deleted);
        if(isMed(lVal) || isMed(rVal)){
          // --- Meditation merge ---
          const lDel = lVal && lVal.__deleted;
          const rDel = rVal && rVal.__deleted;
          if(lDel || rDel){
            if(lDel && rDel){
              const lt = lVal.ts || '1970';
              const rt = rVal.ts || '1970';
              mergedMonth[dk] = rt > lt ? rVal : lVal;
              continue;
            }
            const delObj = lDel ? lVal : rVal;
            const liveObj = lDel ? rVal : lVal;
            const delTs = delObj.ts || '1970';
            const liveTs = liveObj.dayTs || '1970';
            mergedMonth[dk] = (liveTs > delTs) ? liveObj : delObj;
            continue;
          }
          // 置換フラグがあれば新しい方を全面採用（削除・短縮などの編集を優先反映）
          const lRep = !!lVal.replace;
          const rRep = !!rVal.replace;
          if(lRep || rRep){
            const lTs = lVal.dayTs || '1970';
            const rTs = rVal.dayTs || '1970';
            mergedMonth[dk] = (rTs > lTs) ? rVal : lVal;
            continue;
          }
          // --- 従来の追加統合（ユニオン） ---
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
          const byFp = new Map();
          combined.forEach(o=>{
            const f = fp(o.m,o.s);
            const cur = byFp.get(f);
            if(!cur) byFp.set(f,o); else {
              const curReal = /^m[0-9a]/.test(cur.id);
              const oReal = /^m[0-9a]/.test(o.id);
              if(oReal && !curReal) byFp.set(f,o);
            }
          });
          const uniq = [...byFp.values()].slice(0,48);
          const mergedObj = { sessions: uniq.map(o=>o.m), starts: uniq.map(o=>o.s), ids: uniq.map(o=>o.id), dayTs: (lVal.dayTs||rVal.dayTs||new Date().toISOString()) };
          const mergedExercise = mergeExerciseData(lVal.exercise, rVal.exercise);
          if(mergedExercise && Array.isArray(mergedExercise.sessions) && mergedExercise.sessions.length){
            mergedObj.exercise = mergedExercise;
          }
          mergedMonth[dk] = mergedObj;
        } else if(isAttendanceObj(lVal) || isAttendanceObj(rVal)){
          // --- Attendance object merge ---
          const norm = v => {
            if(!v) return { work:0, dayTs:'1970' };
            if(typeof v==='number') return { work: v?1:0, dayTs:'1970' };
            return v;
          };
          const L = norm(lVal); const R = norm(rVal);
          const lDel = !!L.__deleted; const rDel = !!R.__deleted;
          if(lDel || rDel){
            if(lDel && rDel){
              const lt=L.ts||'1970'; const rt=R.ts||'1970';
              mergedMonth[dk] = rt>lt ? R : L;
            } else {
              const delObj = lDel? L : R; const liveObj = lDel? R : L;
              const delTs = delObj.ts||'1970'; const liveTs = liveObj.dayTs||'1970';
              mergedMonth[dk] = (liveTs>delTs)? liveObj : delObj;
            }
          } else {
            const lTs=L.dayTs||'1970'; const rTs=R.dayTs||'1970';
            if(L.work===1 && R.work===1){ mergedMonth[dk] = rTs>lTs ? R : L; }
            else if(L.work===1 || R.work===1){ mergedMonth[dk] = L.work===1? L : R; }
            else { mergedMonth[dk] = rTs>lTs ? R : L; }
          }
        } else {
          // どちらも object だが attendance/meditation 指標が無い → そのまま上書き優先 (後勝ち)
          mergedMonth[dk] = rVal || lVal;
        }
      } else {
        // attendance legacy numeric -> wrap
        const wrap = v=> (v===1) ? { work:1, dayTs: '1970' } : (v===0? { work:0, dayTs:'1970' } : v);
        const lObj = wrap(lVal);
        const rObj = wrap(rVal);
        const lDel = lObj && lObj.__deleted;
        const rDel = rObj && rObj.__deleted;
        if(lDel || rDel){
          if(lDel && rDel){
            const lt = lObj.ts || '1970';
            const rt = rObj.ts || '1970';
            mergedMonth[dk] = rt>lt ? rObj : lObj;
          } else {
            const delObj = lDel ? lObj : rObj;
            const liveObj = lDel ? rObj : lObj;
            const delTs = delObj.ts || '1970';
            const liveTs = liveObj.dayTs || '1970';
            mergedMonth[dk] = (liveTs>delTs) ? liveObj : delObj;
          }
        } else {
          // 両方 live: dayTs 新しい方 / どちらか work=1 優先
          const lTs = lObj.dayTs || '1970';
          const rTs = rObj.dayTs || '1970';
          if(lObj.work===1 && rObj.work===1){
            mergedMonth[dk] = (rTs>lTs)? rObj : lObj;
          } else if(lObj.work===1 || rObj.work===1){
            mergedMonth[dk] = lObj.work===1 ? lObj : rObj;
          } else {
            mergedMonth[dk] = (rTs>lTs)? rObj : lObj; // 両方0
          }
        }
      }
    }
    // prune empty days for meditation object if sessions empty
    Object.keys(mergedMonth).forEach(dk=>{
      const v = mergedMonth[dk];
      if(v && v.__deleted){ return; }
      if(v && typeof v==='object'){
        const hasMeditation = Array.isArray(v.sessions) && v.sessions.length>0;
        const hasExercise = Array.isArray(v.exercise?.sessions) && v.exercise.sessions.length>0;
        if(!hasMeditation && !hasExercise){
          delete mergedMonth[dk];
        } else if(!hasMeditation){
          v.sessions = Array.isArray(v.sessions)? v.sessions : [];
          v.starts = Array.isArray(v.starts)? v.starts : [];
          v.ids = Array.isArray(v.ids)? v.ids : [];
        }
      }
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
  const r = await fetch('/api/sign-get', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ key: cfg.docId + '.json.enc', password: cfg.password }) });
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
  }catch(e){
    console.warn('[sync] pull error', e);
    setSyncStatus('pull error: '+(e && (e.message||e))); // 画面にも表示
  }
}

async function autoPush(force){
  // force === true の場合は auto フラグに関係なく実行
  if(!__autoSync.dirty || __autoSync.pushing) {
    if(!force) return;
  }
  const cfg = getS3Cfg();
  if(!force && (!cfg.auto || !cfg.docId || !cfg.passphrase || !cfg.password)) return;
  if(force && (!cfg.docId || !cfg.passphrase || !cfg.password)){
    // 必須設定が足りない場合はユーザーに通知し早期終了
    setSyncStatus('config incomplete (docId/passphrase/password)');
    return;
  }
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
      // まずサーバ側直接 upload API を試みる（クライアントに presigned URL を渡さずに済む）
      try{
        const b64 = b64FromBuf(new Uint8Array(enc));
        const up = await fetch('/api/put-object', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ password: cfg.password, key: `${cfg.docId}.json.enc`, contentType:'application/octet-stream', data: b64 }) });
        if(!up.ok){
          // サーバ側アップロードが未対応、あるいはエラー → フォールバック
          console.warn('[sync] server-side put-object failed', up.status);
          // fallthrough to presign flow below
        } else {
          // success
          console.info('[sync] server-side pushed v'+payload.__meta.version);
          setSyncStatus('pushed v'+payload.__meta.version+' (server)');
          try{ const oldETag = __fastPull.lastETag; __fastPull.lastETag = null; await autoPull(); if(!__fastPull.lastETag) __fastPull.lastETag = oldETag; }catch(e){ console.warn('[sync] immediate verify pull failed', e); }
          safety--; continue; // next loop
        }
      }catch(e){ console.warn('[sync] server-side put attempt error', e); }

      // fallback: presigned URL flow (既存)
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
  }catch(e){
    console.warn('[sync] push error', e);
    __autoSync.dirty=true;
    setSyncStatus('push error: '+(e && (e.message||e))); // 画面にも表示
  }
  finally { __autoSync.pushing=false; }
}

function markDirtyImmediate(){
  // すぐ push する（新規入力完了時のみ呼ばれる想定）
  __autoSync.dirty = true;
  autoPush();
}

// 既存 writeMonth/saveFinance は多くの編集で呼ば復活問題の一因。フックをかけず、
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
        const sess = rec.sessions; const starts = Array.isArray(rec.starts)? rec.starts:[]; const ids = Array.isArray(rec.ids)? rec.ids: [];
        const fp = (m,s)=> (Math.round(m*100)/100)+'|'+s;
        const map = new Map();
        const newSess=[]; const newStarts=[]; const newIds=[];
        for(let i=0;i<sess.length;i++){
          const m = sess[i]; const s = starts[i]||''; const id = ids[i];
          const f = fp(m,s);
          const cur = map.get(f);
          const real = id && /^m[0-9a]/.test(id);
          if(!cur){
            map.set(f,{m,s,id: real ? id : ('m'+Date.now().toString(36)+Math.random().toString(36).slice(2,7))});
          } else {
            if(real && !/^m[0-9a]/.test(cur.id)) map.set(f,{m,s,id});
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
window.syncAfterExerciseUpdate = ()=>{ markDirtyImmediate(); };
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
// 修正: 未定義の markDirty を呼ばない
window.forcePush = ()=>{ markDirtyImmediate(); };

if (typeof window.openMeditationEditor !== 'function') {
  window.openMeditationEditor = function(dateKey, cellEl, sessions){
    try{
      let host = document.getElementById('medEditor');
      if(!host){
        host = document.createElement('div');
        host.id = 'medEditor';
        document.body.appendChild(host);
      }
      window.medEditorEl = host;

      const [y,m,d] = dateKey.split('-').map((v,i)=> i===1? (parseInt(v,10)-1) : parseInt(v,10));
      const month = readMonth(state.uid, y, m);
      const base = normalizeMeditationRecord(month[dateKey]);
      const list = base.sessions.slice();
      const starts = base.starts.slice();
      const ids = Array.isArray(base.ids) ? base.ids.slice(0, list.length) : [];
      while(ids.length < list.length) ids.push('');

      const isMobile = window.matchMedia('(max-width: 600px)').matches;
      host.classList.toggle('mobile-fullscreen', isMobile);
      host.style.position = 'fixed';
      host.style.zIndex = '2000';
      host.style.background = 'var(--card, #111)';
      host.style.display = isMobile ? 'flex' : 'block';
      if(isMobile){
        host.style.top = '0';
        host.style.left = '0';
        host.style.right = '0';
        host.style.bottom = '0';
        host.style.width = '100vw';
        host.style.height = '100vh';
        host.style.maxWidth = '100vw';
        host.style.maxHeight = '100vh';
        host.style.border = '0';
        host.style.borderRadius = '0';
        host.style.padding = '18px clamp(16px, 4vw, 24px) calc(18px + env(safe-area-inset-bottom))';
        host.style.boxShadow = 'none';
        host.style.flexDirection = 'column';
        host.style.gap = '12px';
        host.style.overflow = 'hidden';
      } else {
        host.style.top = '';
        host.style.left = '';
        host.style.width = '';
        host.style.height = '';
        host.style.maxWidth = 'min(96vw, 380px)';
        host.style.maxHeight = '';
        host.style.border = '1px solid rgba(148,163,184,.25)';
        host.style.borderRadius = '12px';
        host.style.padding = '12px';
        host.style.boxShadow = '0 12px 32px rgba(0,0,0,.5)';
        host.style.flexDirection = '';
        host.style.gap = '';
        host.style.overflow = 'auto';
        host.style.right = '12px';
        host.style.bottom = '12px';
      }

      host.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="font-weight:800">${y}年 ${m+1}月 ${d}日</div>
          <button id="medClose" class="btn" style="padding:6px 10px;">閉じる</button>
        </div>
        <div class="sep" style="height:1px;background:rgba(148,163,184,.18);margin:${isMobile?'0':'10px 0'}"></div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:${isMobile?'0':'8px'}">
          <input id="medNewMin" type="number" placeholder="分" inputmode="numeric" style="flex:1;padding:8px 10px;border-radius:10px;border:1px solid rgba(148,163,184,.25);background:#0b1220;color:#e5e7eb;">
          <button id="medAdd" class="btn primary" style="padding:8px 12px">追加</button>
          <span title="リファクタリング中" style="font-size:20px;line-height:1;">🛠️</span>
          <button id="medTimerStart" style="position:absolute;left:-9999px;top:-9999px">リファクタリング中</button>
        </div>
        <div id="medSessList" style="display:grid;gap:6px;${isMobile?'flex:1;overflow:auto;':''}max-height:${isMobile?'none':'160px'};overflow:${isMobile?'auto':'auto'}"></div>
      `;

      host.querySelector('#medClose').addEventListener('click', ()=>{
        host.style.display='none';
        host.classList.remove('mobile-fullscreen');
      });

      const listEl = host.querySelector('#medSessList');
      if(listEl){
        listEl.innerHTML = '';
        if(!list.length){
          listEl.innerHTML = '<div class="empty">記録なし</div>';
        } else {
          let total = 0;
          list.forEach((m,i)=>{ total += m; const row=document.createElement('div'); row.className='med-row'; row.innerHTML=`<span class="min">${m}分</span><span class="actions"><button data-edit="${i}" title="編集">✏</button><button data-del="${i}" title="削除">✕</button></span>`; listEl.appendChild(row); });
          const sum=document.createElement('div'); sum.className='med-total'; sum.textContent = `合計 ${total}分 / ${list.length}回`; listEl.appendChild(sum);
          listEl.querySelectorAll('button[data-edit]').forEach(b=> b.addEventListener('click', ()=>{ 
            const idx = parseInt(b.getAttribute('data-edit'),10);
            const cur = readMedSessions(); const curVal=cur[idx];
            const nvStr = prompt('新しい分数', curVal);
            if(nvStr===null) return; const nv=parseFloat(nvStr); if(!Number.isFinite(nv)||nv<=0){ alert('正の数'); return; }
            const next = cur.slice(); next[idx]=nv;
            writeMedSessions(next);
          }));
          listEl.querySelectorAll('button[data-del]').forEach(b=> b.addEventListener('click', ()=>{ 
            const idx = parseInt(b.getAttribute('data-del'),10);
            // delete both sessions and starts
            const md = readMonth(state.uid, state.year, state.month);
            const rec = md[medEditTarget.dateKey] || {};
            const sessions = Array.isArray(rec.sessions)? rec.sessions.slice(): [];
            const starts = Array.isArray(rec.starts)? rec.starts.slice(): [];
            const ids = Array.isArray(rec.ids)? rec.ids.slice(): [];
            const oldLen = sessions.length;
            sessions.splice(idx,1);
            if(starts.length>idx) starts.splice(idx,1);
            if(ids.length>idx) ids.splice(idx,1);
            if(sessions.length){
              const obj = { sessions, starts, ids, dayTs: new Date().toISOString() };
              obj.replace = true; // セッション削除は置換扱い
              md[medEditTarget.dateKey] = obj;
            } else {
              md[medEditTarget.dateKey] = { __deleted:true, ts: new Date().toISOString() };
            }
            writeMonth(state.uid, state.year, state.month, md);
            if(window.syncAfterNewMeditationSession) window.syncAfterNewMeditationSession();
            renderCalendar(); renderMedSessionList();
          }));
        }
      }

      const inp = host.querySelector('#medNewMin');
      inp.setAttribute('step','0.1');
      inp.focus();
    }catch(e){
      console.warn('[med-editor] failed:', e);
    }
  };
}

if(typeof window.openExercisePanel !== 'function'){
  window.openExercisePanel = (opts)=> openExercisePanel(opts || {});
}

function showMedAlert(message){
  const existing = document.getElementById('medAlertOverlay');
  const applyMessage = (target, content)=>{
    if(!target) return;
    if(Array.isArray(content)){
      target.innerHTML = content.map(line=>`<div>${line}</div>`).join('');
    } else if(content instanceof HTMLElement){
      target.innerHTML = '';
      target.appendChild(content);
    } else {
      target.innerHTML = content ?? '';
    }
  };

  if(existing){
    const msg = existing.querySelector('#medAlertMessage');
    applyMessage(msg, message);
    existing.style.display = 'flex';
    existing.querySelector('button')?.focus();
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'medAlertOverlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(15,23,42,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '4000'
  });

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'alertdialog');
  Object.assign(dialog.style, {
    minWidth: '220px',
    maxWidth: '90vw',
    borderRadius: '14px',
    padding: '22px 24px 18px',
    background: 'var(--card,#0f172a)',
    color: '#e2e8f0',
    boxShadow: '0 18px 40px rgba(15,23,42,0.45), 0 0 0 1px rgba(148,163,184,0.18)',
    display: 'grid',
    gap: '18px',
    textAlign: 'center'
  });

  const msgEl = document.createElement('div');
  msgEl.id = 'medAlertMessage';
  Object.assign(msgEl.style, { fontWeight: '700', fontSize: '1.05rem', letterSpacing: '0.01em' });
  applyMessage(msgEl, message);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'OK';
  Object.assign(btn.style, {
    padding: '10px 14px',
    borderRadius: '10px',
    border: '0',
    background: 'linear-gradient(135deg,#38bdf8,#a855f7)',
    color: '#fff',
    fontWeight: '700',
    cursor: 'pointer'
  });

  let keyHandler;
  const close = ()=>{
    overlay.remove();
    if(keyHandler) window.removeEventListener('keydown', keyHandler, true);
  };

  keyHandler = (ev)=>{ if(ev.key === 'Escape'){ close(); } };
  window.addEventListener('keydown', keyHandler, true);

  btn.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    close();
  });
  overlay.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    if(ev.target === overlay) close();
  });

  dialog.append(msgEl, btn);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  setTimeout(()=> btn.focus(), 0);
}