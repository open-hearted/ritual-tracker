// meditation-cloud.js
// Minimal, self-contained meditation page using Google ID token and server PUT/GET to store plaintext JSON.
const $ = id => document.getElementById(id);
const STATE = { year: new Date().getFullYear(), month: new Date().getMonth(), payload: {}, selected: null };
const STORAGE_KEY = 'med_cloud_google_auth_v1';
const TOKEN_TTL_MS = 24*60*60*1000;
const AUTH_EXP_SKEW_MS = 30*1000;

// ▼---- ここにSupabaseのURLとAPIキーをペーストしましょう ----▼
const SUPABASE_URL = 'https://jlkfvijgfrvoesazegnc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yfTwumo2INpAJIJRq7_WSA_ivenN96B';
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const IMAGE_STORAGE_BUCKET = 'ritual-images';
const IMAGE_SIGNED_URL_SECONDS = 60 * 60;
const imageSignedUrlCache = new Map();
const IMAGE_RECORD_CONFIGS = {
  mealImage: {
    kind: 'mealImage',
    type: '食事画像',
    category: 'meal',
    fileId: 'mealImageFile',
    cameraFileId: 'mealImageCameraFile',
    fileNameId: 'mealImageFileName',
    useTimeId: 'mealImageUseTime',
    noteId: null,
    successMessage: '食事画像を記録しました'
  },
  otherImage: {
    kind: 'otherImage',
    type: 'その他画像',
    category: 'other',
    fileId: 'otherImageFile',
    cameraFileId: 'otherImageCameraFile',
    fileNameId: 'otherImageFileName',
    useTimeId: 'otherImageUseTime',
    noteId: 'otherImageNote',
    successMessage: 'その他画像を記録しました'
  },
  expense: {
    kind: 'expense',
    type: '支出',
    category: 'expense',
    fileId: 'expenseFile',
    cameraFileId: 'expenseCameraFile',
    fileNameId: 'expenseFileName',
    useTimeId: null,
    noteId: null,
    successMessage: '支出を記録しました'
  }
};
// ▲-------------------------------------------------------▲

const EXPENSE_CATEGORIES = ['食費', '日用品', '交通費', '娯楽', 'その他'];
let pendingExpenseAnalysis = null; // { dataUrl, mimeType }
// カメラアプリへの切替中にOSがページを破棄する端末があるため、
// レシート撮影はページ内カメラ(getUserMedia)で行い、失敗時のみ capture input にフォールバックする
let expenseCapturedBlob = null;
let expenseCameraStream = null;

function getPageMode(){
  try{ return (document.body && document.body.getAttribute('data-page')) || ''; }catch(e){ return ''; }
}
function isDailyPage(){ return getPageMode() === 'daily'; }
function isMonthlyPage(){ return getPageMode() === 'monthly'; }

function isValidDateKey(s){
  if(!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s));
}

function todayDateKey(){
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function isoMatchesDateKey(iso, dateKey){
  if(!iso || !isValidDateKey(dateKey)) return false;
  try{
    const d = new Date(iso);
    if(isNaN(d)) return false;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return key === dateKey;
  }catch(e){ return false; }
}

function setStateMonthFromDateKey(dateKey){
  if(!isValidDateKey(dateKey)) return;
  const m = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  if(!Number.isFinite(y) || !Number.isFinite(mo) || mo < 0 || mo > 11) return;
  STATE.year = y;
  STATE.month = mo;
}

function getQueryDateKey(){
  try{
    const sp = new URLSearchParams(location.search || '');
    const d = sp.get('date');
    return isValidDateKey(d) ? d : null;
  }catch(e){
    return null;
  }
}

function updateMonthlyLink(dateKey){
  try{
    const a = $('openMonthly');
    if(!a) return;
    const dk = isValidDateKey(dateKey) ? dateKey : todayDateKey();
    a.setAttribute('href', `monthly.html?date=${encodeURIComponent(dk)}`);
  }catch(e){}
}

function maybeOpenInitialDate(){
  try{
    if(!currentUser) return;
    const q = getQueryDateKey();
    if(isMonthlyPage() && q){
      setStateMonthFromDateKey(q);
      try{ renderCalendar(); }catch(e){}
      // Monthly page should start with the modal closed.
      try{ closeEditor(); }catch(e){}
      // If a date is provided, just bring that cell into view (no modal open).
      try{
        setTimeout(()=>{
          const el = document.querySelector(`.cell[data-date="${q}"]`);
          if(el) el.scrollIntoView({ block:'center' });
        }, 60);
      }catch(e){}
      return;
    }
    if(isDailyPage()){
      const t = q ? q : todayDateKey();
      setStateMonthFromDateKey(t);
      updateMonthlyLink(t);
      openEditorFor(t);
      return;
    }
  }catch(e){}
}

function nowISO(){ return new Date().toISOString(); }

let idToken = null; let userProfile = null; let currentUser = null;

function forceSignOut(message){
  idToken = null;
  userProfile = null;
  currentUser = null;
  updateUiForAuth(false);
  try{ const ed = $('medEditor'); if(ed) ed.style.display='none'; }catch{}
  setMsg(message || 'ログインしてください');
}

function ensureAuthOrSignOut(){
  if(!currentUser){ setMsg('ログインしてください'); return false; }
  return true;
}

async function initSupabaseAuth() {
  if(!supabaseClient){
    setMsg('Supabase SDK の初期化に失敗しました');
    updateUiForAuth(false);
    return;
  }
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (session) {
    currentUser = session.user;
    idToken = null;
    updateUiForAuth(true);
    setMsg('Google認証済みです');
    try{ maybeOpenInitialDate(); }catch(e){}
  } else {
    updateUiForAuth(false);
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      idToken = null;
      updateUiForAuth(true);
      setMsg('Google認証済みです');
      try{ maybeOpenInitialDate(); }catch(e){}
    } else if (event === 'SIGNED_OUT') {
      forceSignOut('サインアウトしました');
    }
  });
}

function updateUiForAuth(isAuth){
  const calCard = document.querySelector('.card.cal-card');
  const loginBtn = $('supabaseLoginBtn');
  const so = $('signOutBtn');
  const ed = $('medEditor');
  const openMonthly = $('openMonthly');
  try{ document.body.setAttribute('data-auth', isAuth ? 'true' : 'false'); }catch(e){}
  if(!isAuth){
    if(calCard) calCard.style.display='none';
    if(openMonthly) openMonthly.style.display='none';
    if(ed && isDailyPage()) ed.style.display='none';
    if(loginBtn) loginBtn.style.display='inline-block';
    if(so) so.style.display='none';
  }
  else {
    if(calCard) calCard.style.display='';
    if(openMonthly) openMonthly.style.display='';
    if(ed && isDailyPage()) ed.style.display='';
    if(loginBtn) loginBtn.style.display='none';
    if(so) so.style.display='inline-block';
  }
}

function setMsg(s){ const m=$('msg'); if(m) m.textContent = s||''; }

function renderDOW(){
  const row = $('dowRow');
  if(!row) return;
  row.innerHTML='';
  ['月','火','水','木','金','土','日'].forEach(n=>{ const d=document.createElement('div'); d.className='dow'; d.textContent=n; row.appendChild(d); });
}
function daysInMonth(y,m){ return new Date(y,m+1,0).getDate(); }
function getDateKey(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function getMonthKey(){ return `${STATE.year}-${String(STATE.month+1).padStart(2,'0')}`; }

function parseDateKeyLocal(dateKey){
  // dateKey: YYYY-MM-DD
  // Use local time to avoid off-by-one issues.
  try{ return new Date(`${dateKey}T00:00:00`); }catch(e){ return null; }
}

function getNthWeekdayOfMonth(date){
  // Returns 1..5 (or 0 if invalid)
  if(!(date instanceof Date) || Number.isNaN(date.getTime())) return 0;
  const day = date.getDate();
  if(!day) return 0;
  return Math.floor((day - 1) / 7) + 1;
}

function getRitualSchedule(){
  // schedule.js is expected to define window.RITUAL_SCHEDULE
  try{
    const s = window.RITUAL_SCHEDULE;
    if(!s || typeof s !== 'object') return null;
    return s;
  }catch(e){
    return null;
  }
}

function safeHttpUrl(raw){
  if(!raw) return null;
  const s = String(raw).trim();
  if(!s) return null;
  if(/^https?:\/\//i.test(s)) return s;
  return null;
}

function getGarbageScheduleMarks(dateKey){
  const schedule = getRitualSchedule();
  const rules = schedule && Array.isArray(schedule.garbage) ? schedule.garbage : [];
  if(!rules.length) return [];

  const date = parseDateKeyLocal(dateKey);
  if(!date) return [];
  const weekday = date.getDay();
  const nth = getNthWeekdayOfMonth(date);

  const out = [];
  for(const rule of rules){
    if(!rule || typeof rule !== 'object') continue;
    if(Number(rule.weekday) !== weekday) continue;

    const type = (rule.type || '').toString();
    if(type === 'weekly'){
      out.push(rule);
      continue;
    }
    if(type === 'nthWeekday'){
      const list = Array.isArray(rule.nth) ? rule.nth.map(n=>Number(n)).filter(n=>Number.isFinite(n) && n>0) : [];
      if(list.includes(nth)) out.push(rule);
      continue;
    }
  }

  return out;
}

function parseDateKeyAndHHMMToISO(dateKey, hhmm){
  if(!dateKey || !hhmm) return null;
  const m = String(hhmm).trim().match(/^([0-2]?\d):([0-5]\d)$/);
  if(!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if(hh > 23) return null;
  const d = parseDateKeyLocal(dateKey);
  if(!d || Number.isNaN(d.getTime())) return null;
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

function getAppointmentScheduleMarks(dateKey){
  const schedule = getRitualSchedule();
  const list = schedule && Array.isArray(schedule.appointments) ? schedule.appointments : [];
  if(!list.length) return [];
  return list
    .filter(it => it && typeof it === 'object' && String(it.date || '') === String(dateKey))
    .map(it => ({
      icon: (it.icon || '📌').toString(),
      time: (it.time || '').toString(),
      label: (it.label || '').toString(),
      short: (it.short || it.label || '').toString(),
      url: safeHttpUrl(it.url),
      calendarTime: (it.calendarTime !== false)
    }));
}

function getShiftForDateKey(dateKey){
  const schedule = getRitualSchedule();
  const shifts = schedule && Array.isArray(schedule.shifts) ? schedule.shifts : [];
  if(!shifts.length) return null;
  const date = parseDateKeyLocal(dateKey);
  if(!date) return null;
  const dow = date.getDay();
  for(const s of shifts){
    if(!s || typeof s !== 'object') continue;
    const weekdays = Array.isArray(s.weekdays) ? s.weekdays.map(n=>Number(n)) : [];
    if(!weekdays.includes(dow)) continue;
    return {
      label: (s.label || 'シフト').toString(),
      start: (s.start || '').toString(),
      end: (s.end || '').toString(),
      calendarColor: (s.calendarColor || '').toString()
    };
  }
  return null;
}

function renderCalendar(){ const grid=$('calGrid'); if(!grid) return; grid.innerHTML=''; const monthLabelEl=$('monthLabel'); if(monthLabelEl) monthLabelEl.textContent = `${STATE.year}年 ${STATE.month+1}月`; const startPad = (new Date(STATE.year, STATE.month,1).getDay()+6)%7; for(let i=0;i<startPad;i++){ const p=document.createElement('div'); p.className='cell disabled'; p.style.visibility='hidden'; grid.appendChild(p);} const days = daysInMonth(STATE.year, STATE.month); const monthData = (STATE.payload && STATE.payload.data && STATE.payload.data[getMonthKey()]) ? STATE.payload.data[getMonthKey()] : {}; const todayKey = getDateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()); for(let d=1; d<=days; d++){ const btn=document.createElement('button'); btn.type='button'; btn.className='cell'; const dk = getDateKey(STATE.year, STATE.month, d); btn.setAttribute('data-date', dk); const rec = monthData[dk] || {}; const sess = Array.isArray(rec.sessions)? rec.sessions : []; const ex = Array.isArray(rec.exercise?.sessions)? rec.exercise.sessions : []; const exp = Array.isArray(rec.expenses)? rec.expenses : []; if(sess.length || ex.length || exp.length) btn.setAttribute('data-has','1'); if(dk===todayKey) btn.classList.add('today'); btn.innerHTML = `<div class="d">${d}</div><div style="font-size:0.85em">${sess.length? sess.reduce((a,b)=>a+b,0)+'分':''}</div>`; btn.addEventListener('click', ()=>{ if(isMonthlyPage()){ location.href = 'index.html?date=' + dk; } else { openEditorFor(dk); } }); grid.appendChild(btn); } }

function openEditorFor(dateKey, opts){
  // save current editor state before switching dates
  try{ if(STATE.selected && STATE.selected !== dateKey) autoSaveEditor(); }catch(e){}
  STATE.selected = dateKey;
  const ed = $('medEditor');
  $('editDate').textContent = dateKey;
  updateMonthlyLink(dateKey);

  const paint = ()=>{
    const monthObj = STATE.payload.data && STATE.payload.data[getMonthKey()] ? STATE.payload.data[getMonthKey()] : {};
    const rec = monthObj[dateKey] || {};
    try{ const record = rec.record?.text || ''; const txt = $('medRecordText'); if(txt) txt.value = record; }catch(e){}
    try{ const diary = rec.diary?.text || ''; const txt = $('medDiaryText'); if(txt) txt.value = diary; }catch(e){}
    renderMedSessionList();
    renderWakeSleep();
    renderExerciseList();
    renderAllRecordsTimeline();
    // Repaint can fire when returning from the camera app (Supabase re-emits
    // SIGNED_IN on refocus) — never clear an in-progress receipt selection here.
    try{
      const hasPendingReceipt = !!pendingExpenseAnalysis || !!expenseCapturedBlob || !!getImageInputFile(getImageRecordConfig('expense'));
      if(!hasPendingReceipt){
        const expenseDateEl = $('expenseDate');
        if(expenseDateEl) expenseDateEl.value = dateKey;
      }
      updateExpenseFileLabel();
    }catch(e){}
    if(ed) ed.style.display='block';
  };

  if(opts && opts.skipLoad){
    paint();
    return;
  }

  // fetch latest payload from server before opening editor
  med_loadAll().then((ok)=>{
    if(ok === false) return; // auth ensures message if fail
    paint();
  }).catch(()=>{
    paint();
  });
}

let diaryAutosaveTimer = null;

function scheduleEditorAutosave(){
  try{ if(diaryAutosaveTimer) clearTimeout(diaryAutosaveTimer); }catch(e){}
  diaryAutosaveTimer = setTimeout(()=>{ try{ autoSaveEditor(); }catch(e){} }, 600);
}

function insertCurrentTimeIntoTextarea(ta){
  if(!ta) return;
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const start = (typeof ta.selectionStart === 'number') ? ta.selectionStart : ta.value.length;
  const end = (typeof ta.selectionEnd === 'number') ? ta.selectionEnd : start;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  ta.value = before + timeStr + after;
  const newPos = start + timeStr.length;
  ta.selectionStart = ta.selectionEnd = newPos;
  ta.focus();
}

function autoSaveEditor(){
  try{
    const dk = STATE.selected; if(!dk) return;
    const mk = getMonthKey(); STATE.payload.data = STATE.payload.data || {};
    STATE.payload.data[mk] = STATE.payload.data[mk] || {};
    const rec = STATE.payload.data[mk][dk] || {};
    const recordEl = $('medRecordText');
    const recordTxt = recordEl ? (recordEl.value || '') : '';
    if(recordTxt){ rec.record = { text: recordTxt, updatedAt: nowISO() }; }
    else { if(rec && rec.record) delete rec.record; }
    const diaryEl = $('medDiaryText');
    if(diaryEl){
      const diaryTxt = diaryEl.value || '';
      if(diaryTxt){ rec.diary = { text: diaryTxt, updatedAt: nowISO() }; }
      else { if(rec && rec.diary) delete rec.diary; }
    }
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

async function med_loadAll() {
  if(!ensureAuthOrSignOut()) return false;
  setMsg('読み込み中...');
  try {
    // 1. まず Supabase にデータがあるか確認（新しいメインの保存先）
    const { data: dbData, error } = await supabaseClient
      .from('user_data')
      .select('payload')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (dbData && dbData.payload) {
      const payload = dbData.payload;
      STATE.payload = payload.data ? payload : { data: payload };
      STATE.payload.data = STATE.payload.data || {};
      
      // ======== ここから追加 ========
      const mk = getMonthKey();
      const dk = STATE.selected || todayDateKey();
      if(STATE.payload.data[mk] && STATE.payload.data[mk][dk]) {
        console.log("Supabaseからロード成功:", STATE.payload.data[mk][dk]);
      } else {
        console.log("Supabaseのロードは成功したが、今日のデータは空です");
      }
      // ======== ここまで ========

      renderCalendar(); setMsg('');
      return true;
    }

    // 万が一データがない場合は、新規スタート（AWS引越しは後日対応）
    console.log("Supabaseにデータがないため、新規（空）で開始します。");
    STATE.payload = { data: {} };
    renderCalendar(); setMsg('');
    return true;
  }catch(e){
    console.error(e);
    setMsg('読み込み失敗');
    return false;
  }
}

async function med_saveAll() {
  if(!ensureAuthOrSignOut()) return false;
  try{
    setMsg('保存中...');
    pruneEmptyPayloadRecords(STATE.payload);
    if(!hasPayloadRecords(STATE.payload)){
      setMsg('');
      console.log('Skipped Supabase save because payload has no user records.');
      return false;
    }
    const mk = getMonthKey(); // ensure payload shape
    STATE.payload.__meta = STATE.payload.__meta || { version:0, updatedAt: nowISO() };
    STATE.payload.__meta.version = (STATE.payload.__meta.version||0) + 1;
    STATE.payload.__meta.updatedAt = nowISO();

    // Supabase上の自分の行を特定する
    const { data: existing, error: selErr } = await supabaseClient
      .from('user_data')
      .select('id')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (selErr) {
      alert('【確認用】データ取得エラー: ' + JSON.stringify(selErr));
    }

    let err;
    if (existing) {
      const { error } = await supabaseClient
        .from('user_data')
        .update({ payload: STATE.payload })
        .eq('id', existing.id);
      err = error;
    } else {
      const { error } = await supabaseClient
        .from('user_data')
        .insert({ user_id: currentUser.id, payload: STATE.payload });
      err = error;
    }

    if (err) {
      alert('【確認用】データ保存エラー: ' + JSON.stringify(err));
      console.warn('save failed', err);
      setMsg('保存失敗 (詳細をエラー表示しました)');
      return false;
    }

    setMsg('保存完了');
    renderCalendar();
    return true;
  }catch(e){
    alert('【確認用】予期せぬエラー: ' + String(e.message || e));
    console.error(e);
    setMsg('保存エラー');
    return false;
  }
}

function attachHandlers(){
  // Schedule links (garbage):
  // - Desktop: click marker opens link (and does NOT open editor)
  // - Touch: tap marker opens editor; long-press marker opens link
  // Use capture so we can control propagation before the cell's click handler.
  const calGrid = $('calGrid');
  if(calGrid){
    const isCoarse = (()=>{ try{ return window.matchMedia && window.matchMedia('(pointer: coarse)').matches; }catch(e){ return false; } })();
    let longPressTimer = null;
    let longPressFired = false;

    function clearLongPress(){
      if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer = null; }
    }

    calGrid.addEventListener('click', (ev)=>{
      try{
        const t = ev.target;
        const a = t && t.closest ? t.closest('a.cal-schedule-link') : null;
        if(!a) return;

        if(longPressFired){
          // A long-press already opened the link; suppress the click.
          ev.preventDefault();
          ev.stopPropagation();
          longPressFired = false;
          return;
        }

        if(isCoarse){
          // On touch: do NOT open external link on tap; allow editor to open.
          ev.preventDefault();
          return;
        }

        // On desktop: allow link navigation, but do NOT open editor.
        ev.stopPropagation();
      }catch(e){}
    }, true);

    // Long-press support (touch): press and hold on the marker to open the link.
    calGrid.addEventListener('pointerdown', (ev)=>{
      try{
        if(!isCoarse) return;
        const t = ev.target;
        const a = t && t.closest ? t.closest('a.cal-schedule-link') : null;
        if(!a) return;
        const url = a.getAttribute('href') || '';
        if(!safeHttpUrl(url)) return;

        clearLongPress();
        longPressFired = false;
        longPressTimer = setTimeout(()=>{
          try{
            longPressFired = true;
            // Prevent editor open when long-press fires.
            try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
            // Best-effort open with noopener/noreferrer.
            try{ window.open(url, '_blank', 'noopener,noreferrer'); }catch(e){}
          }catch(e){}
        }, 550);
      }catch(e){}
    }, true);
    calGrid.addEventListener('pointerup', ()=>{ try{ clearLongPress(); }catch(e){} }, true);
    calGrid.addEventListener('pointercancel', ()=>{ try{ clearLongPress(); }catch(e){} }, true);
    calGrid.addEventListener('pointermove', ()=>{ try{ clearLongPress(); }catch(e){} }, true);
  }

  const prevBtn = $('prevBtn');
  if(prevBtn) prevBtn.addEventListener('click', ()=>{ STATE.month--; if(STATE.month<0){ STATE.month=11; STATE.year--; } renderCalendar(); });
  const nextBtn = $('nextBtn');
  if(nextBtn) nextBtn.addEventListener('click', ()=>{ STATE.month++; if(STATE.month>11){ STATE.month=0; STATE.year++; } renderCalendar(); });
  const closeBtn = $('closeEditor');
  if(closeBtn) closeBtn.addEventListener('click', closeEditor);

  // auto-save long text fields while typing
  const recordEl = $('medRecordText');
  if(recordEl){
    recordEl.addEventListener('input', scheduleEditorAutosave);
  }
  const diaryEl = $('medDiaryText');
  if(diaryEl){
    diaryEl.addEventListener('input', scheduleEditorAutosave);
  }
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
      const recordTxt = $('medRecordText') ? ($('medRecordText').value || '') : '';
      if(recordTxt) rec.record = { text: recordTxt, updatedAt: nowISO() };
      else delete rec.record;
      const diaryEl = $('medDiaryText');
      if(diaryEl){
        const diaryTxt = diaryEl.value || '';
        if(diaryTxt) rec.diary = { text: diaryTxt, updatedAt: nowISO() };
        else delete rec.diary;
      }
      STATE.payload.data[mk][dk] = rec;
      closeEditor(); med_saveAll();
    });
  }

  const loginBtn = $('supabaseLoginBtn');
  if(loginBtn) loginBtn.addEventListener('click', () => { 
    supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } }); 
  });

  const signOutBtn = $('signOutBtn');
  if(signOutBtn) signOutBtn.addEventListener('click', ()=>{ supabaseClient.auth.signOut(); });

  // 記録に現在時刻を挿入するボタン
  const insertRecordTimeBtn = $('insertRecordTimeBtn');
  if(insertRecordTimeBtn){
    insertRecordTimeBtn.addEventListener('click', (ev)=>{
      try{
        ev.preventDefault(); ev.stopPropagation();
        insertCurrentTimeIntoTextarea($('medRecordText'));
        try{ autoSaveEditor(); }catch(e){ console.warn('autosave after record insert failed', e); }
      }catch(e){ console.warn('insertRecordTimeBtn handler error', e); }
    });
  }

  // 日記に現在時刻を挿入するボタン
  const insertTimeBtn = $('insertTimeBtn');
  if(insertTimeBtn){
    insertTimeBtn.addEventListener('click', (ev)=>{
      try{
        ev.preventDefault(); ev.stopPropagation();
        insertCurrentTimeIntoTextarea($('medDiaryText'));
        // autosave diary state
        try{ autoSaveEditor(); }catch(e){ console.warn('autosave after insert failed', e); }
      }catch(e){ console.warn('insertTimeBtn handler error', e); }
    });
  }

  // Daily page: clicking the date opens monthly view in a new tab
  const editDate = $('editDate');
  if(editDate && isDailyPage()){
    try{ editDate.style.cursor = 'pointer'; editDate.title = '月間を新しいタブで開く'; }catch(e){}
    editDate.addEventListener('click', (ev)=>{
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
      const dk = STATE.selected || todayDateKey();
      try{ window.open(`monthly.html?date=${encodeURIComponent(dk)}`, '_blank', 'noopener,noreferrer'); }catch(e){}
    });
  }
}

window.addEventListener('load', ()=>{
  try{ renderDOW(); }catch(e){}
  try{ renderCalendar(); }catch(e){}
  try{ attachHandlers(); }catch(e){}
  try{ updateMonthlyLink(todayDateKey()); }catch(e){}
  initSupabaseAuth();
});

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

    // シフト日は「セル色だけ」で分かるようにする
    const shift = getShiftForDateKey(dk);
    if(shift){
      btn.setAttribute('data-shift', '1');
      if(shift.calendarColor){
        btn.style.setProperty('--shift-bg', shift.calendarColor);
      }
    }else{
      btn.removeAttribute('data-shift');
      btn.style.removeProperty('--shift-bg');
    }

    btn.addEventListener('click', ()=> openEditorFor(dk));
    grid.appendChild(btn);
  }

  // fill markers after creating nodes
  Array.from(grid.querySelectorAll('.cell')).forEach(cell=>{
    const dk = cell.getAttribute('data-date'); if(!dk) return;
    const rec = monthData[dk] || {};
    const legacySess = Array.isArray(rec.sessions)? rec.sessions : [];
    const ex = Array.isArray(rec.exercise?.sessions)? rec.exercise.sessions : [];
    let hasPlank=false, hasWall=false, hasRecord=false, hasDiary=false;
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
    if(rec.record && rec.record.text) hasRecord = true;
    if(rec.diary && rec.diary.text) hasDiary = true;

    const activityMarkers = [];
    if(hasPlank) activityMarkers.push('<span class="cal-mark">P</span>');
    if(hasWall) activityMarkers.push('<span class="cal-mark">🪑</span>');
    if(medSeconds>0){
      const minutes = formatCompactPositiveNumber(medSeconds/60);
      if(minutes) activityMarkers.push(`<span class="cal-mark">瞑${minutes}分</span>`);
      else activityMarkers.push(`<span class="cal-mark">瞑</span>`);
    }
    if(hasRecord) activityMarkers.push('<span class="cal-mark">記</span>');
    if(hasDiary) activityMarkers.push('<span class="cal-mark">📝</span>');

    // Garbage schedule markers (from schedule.js). Do NOT affect data-has highlighting.
    const garbageRules = getGarbageScheduleMarks(dk);
    const scheduleMarkers = garbageRules.map(rule=>{
      const icon = (rule.icon || '🗑').toString();
      const text = (rule.short || rule.label || '').toString();
      const safeText = text.replace(/[&<>\"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[s]));
      const schedule = getRitualSchedule();
      const url = safeHttpUrl(rule.url) || safeHttpUrl(schedule && schedule.garbageInfoUrl);
      const label = `${icon}${safeText ? (safeText.length<=8 ? safeText : safeText.slice(0,8)+'…') : ''}`;
      if(url){
        const safeUrl = url.replace(/[\"<>]/g, '');
        return `<a class="cal-mark cal-schedule-link" href="${safeUrl}" target="_blank" rel="noreferrer" title="${safeText}">${label}</a>`;
      }
      return `<span class="cal-mark" title="${safeText}">${label}</span>`;
    });

    // Appointments (single-date events)
    const appts = getAppointmentScheduleMarks(dk);
    const apptMarkers = appts.map(it=>{
      const icon = (it && (it.icon === undefined || it.icon === null)) ? '📌' : (it.icon || '').toString();
      const time = (it.time || '').toString();
      const text = (it.short || it.label || '').toString();
      const safeText = text.replace(/[&<>\"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[s]));
      const timePart = (it.calendarTime && time) ? time.replace(/[^0-9:]/g,'') : '';
      const textPart = safeText || '';
      const showText = textPart && textPart !== icon;
      const label = `${icon}${timePart}${showText ? textPart : ''}`;
      if(it.url){
        const safeUrl = it.url.replace(/[\"<>]/g, '');
        return `<a class="cal-mark cal-schedule-link" href="${safeUrl}" target="_blank" rel="noreferrer" title="${time ? time + ' ' : ''}${safeText}">${label}</a>`;
      }
      return `<span class="cal-mark" title="${time ? time + ' ' : ''}${safeText}">${label}</span>`;
    });

    const wrap = cell.querySelector('.markers');
    if(wrap) wrap.innerHTML = [...activityMarkers, ...scheduleMarkers, ...apptMarkers].join(' ');
    if(activityMarkers.length) cell.setAttribute('data-has','1'); else cell.removeAttribute('data-has');
  });
};

// --- Lightweight med editor helpers for meditation-cloud ---
function getExistingDayRecord(dateKey){
  const mk = getMonthKey();
  const data = STATE.payload && STATE.payload.data;
  const month = data && data[mk];
  return month && month[dateKey] ? month[dateKey] : null;
}

function normalizeDayRecord(rec){
  if(!rec || typeof rec !== 'object') return null;
  if(!rec.times) rec.times = {};
  if(!Array.isArray(rec.sessions)) rec.sessions = [];
  if(!Array.isArray(rec.starts)) rec.starts = [];
  if(!Array.isArray(rec.ids)) rec.ids = [];
  return rec;
}

function getDayRecord(dateKey){
  const mk = getMonthKey();
  STATE.payload.data = STATE.payload.data || {};
  STATE.payload.data[mk] = STATE.payload.data[mk] || {};
  let rec = STATE.payload.data[mk][dateKey];
  if(!rec){
    rec = { sessions: [], starts: [], ids: [], times: {} };
    STATE.payload.data[mk][dateKey] = rec;
  }
  return normalizeDayRecord(rec);
}

function hasMeaningfulValue(value, key){
  if(key === '__meta' || key === 'updatedAt' || key === 'dayTs') return false;
  if(value == null) return false;
  if(typeof value === 'string') return value.trim().length > 0;
  if(typeof value === 'number' || typeof value === 'boolean') return true;
  if(Array.isArray(value)) return value.some(v => hasMeaningfulValue(v, key));
  if(typeof value === 'object'){
    return Object.keys(value).some(k => hasMeaningfulValue(value[k], k));
  }
  return false;
}

function isEmptyDayRecord(rec){
  if(!rec || typeof rec !== 'object') return true;
  return !Object.keys(rec).some(k => hasMeaningfulValue(rec[k], k));
}

function pruneEmptyPayloadRecords(payload){
  const data = payload && payload.data;
  if(!data || typeof data !== 'object') return;
  Object.keys(data).forEach(mk => {
    const month = data[mk];
    if(!month || typeof month !== 'object'){
      delete data[mk];
      return;
    }
    Object.keys(month).forEach(dk => {
      if(isEmptyDayRecord(month[dk])) delete month[dk];
    });
    if(!Object.keys(month).length) delete data[mk];
  });
}

function hasPayloadRecords(payload){
  const data = payload && payload.data;
  if(!data || typeof data !== 'object') return false;
  return Object.keys(data).some(mk => {
    const month = data[mk];
    return month && typeof month === 'object' && Object.keys(month).some(dk => !isEmptyDayRecord(month[dk]));
  });
}

// helper: attach behavior to inputs to avoid credential autofill/password UI on mobile
function attachNoCredentialBehavior(el){ if(!el) return; try{ el.setAttribute('autocomplete','off'); el.setAttribute('autocorrect','off'); el.setAttribute('autocapitalize','none'); el.setAttribute('spellcheck','false'); }catch(e){}
  const randName = ()=> 'nr_'+Date.now()+'_'+Math.random().toString(36).slice(2);
  const doRandomize = ()=>{ try{ el.setAttribute('name', randName()); el.setAttribute('autocomplete', 'nope'+Date.now()); }catch(e){} };
  el.addEventListener('focus', doRandomize);
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints>0);
  if(isTouch){ try{ el.readOnly = true; el.addEventListener('touchstart', function onTS(e){ el.readOnly = false; doRandomize(); el.focus(); setTimeout(()=>{ el.removeEventListener('touchstart', onTS); },300); }); }catch(e){} }
}

function confirmDelete(message){
  try{ return !!confirm(message || '削除しますか？'); }catch(e){ return true; }
}

function renderMedSessionList(){
  const wrap = $('medSessions'); if(!wrap) return; wrap.innerHTML=''; const dk = STATE.selected; if(!dk) return; const rec = getExistingDayRecord(dk) || {}; const sessions = Array.isArray(rec.sessions)? rec.sessions : []; const starts = Array.isArray(rec.starts)? rec.starts : []; const ids = Array.isArray(rec.ids)? rec.ids : [];
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

    try{
      const minutes = sessions[idx];
      const startIso = starts[idx] || '';
      const startTxt = startIso ? formatTimeShort(startIso) : '';
      const label = `${startTxt ? (startTxt + ' ') : ''}瞑想 ${minutes}分`;
      if(!confirmDelete(`${label} を削除しますか？`)) return;
    }catch(e){
      if(!confirmDelete('この瞑想記録を削除しますか？')) return;
    }

    sessions.splice(idx,1);
    if(starts.length>idx) starts.splice(idx,1);
    if(ids.length>idx) ids.splice(idx,1);
    rec.sessions = sessions; rec.starts = starts; rec.ids = ids; const mk = getMonthKey(); STATE.payload.data[mk][STATE.selected] = rec; renderMedSessionList(); renderWakeSleep(); med_saveAll();
  }));
  renderWakeSleep();
}

function formatTimeShort(iso){ if(!iso) return '--:--'; try{ const d = new Date(iso); if(isNaN(d)) return '--:--'; return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }catch{return '--:--';} }

function renderWakeSleep(){
  const dk = STATE.selected; if(!dk) return; const rec = getExistingDayRecord(dk) || {};
  // wake/sleep are arrays of ISO timestamps for multiple records
  const wakeArr = Array.isArray(rec.wake) ? rec.wake : [];
  const awakeArr = Array.isArray(rec.awake) ? rec.awake : [];
  const sleepArr = Array.isArray(rec.sleep) ? rec.sleep : [];
  const wEl = $('wakeTime'); const sEl = $('sleepTime');
  const latestWake = wakeArr.length ? wakeArr[wakeArr.length-1] : '';
  const latestAwake = awakeArr.length ? awakeArr[awakeArr.length-1] : '';
  const latestSleep = sleepArr.length ? sleepArr[sleepArr.length-1] : '';
  if(wEl) wEl.textContent = formatTimeShort(latestWake);
  if(sEl) sEl.textContent = formatTimeShort(latestSleep);

  // attach handlers for top buttons (起床 / 覚醒 / 就寝)
  ['wake','awake','sleep'].forEach(kind=>{
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
  rec.awake = Array.isArray(rec.awake) ? rec.awake : [];
  rec.sleep = Array.isArray(rec.sleep) ? rec.sleep : [];
  const iso = new Date().toISOString();
  if(kind === 'wake') rec.wake.push(iso);
  else if(kind === 'awake') rec.awake.push(iso);
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

  const kindLabel = (kind === 'wake') ? '🌅' : (kind === 'awake') ? '☀️' : (kind === 'sleep') ? '🌙' : '記録';
  if(!confirmDelete(`${kindLabel}の記録を削除しますか？`)) return;

  arr.splice(idx, 1);
  rec[kind] = arr; const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderWakeSleep(); renderAllRecordsTimeline(); med_saveAll();
}

function parseHHMMToISO(hhmm){ if(!hhmm || typeof hhmm !== 'string') return null; const m = hhmm.trim().match(/^([0-2]?\d):([0-5]\d)$/); if(!m) return null; const hh = parseInt(m[1],10); if(hh>23) return null; const mm = parseInt(m[2],10); const now = new Date(); now.setHours(hh, mm, 0, 0); return now.toISOString(); }

function getImageRecordConfig(kind){
  return IMAGE_RECORD_CONFIGS[kind] || null;
}

function getImageRecordKind(session){
  const kind = (session?.kind || '').toString().trim();
  if(getImageRecordConfig(kind)) return kind;
  if(!kind && toSafeImageDataUrl(session?.imageDataUrl)) return 'mealImage';
  return null;
}

function getImageStoragePath(session){
  const path = (session?.storagePath || '').toString().trim();
  return path || null;
}

function getImageStorageBucket(session){
  return (session?.storageBucket || IMAGE_STORAGE_BUCKET).toString().trim() || IMAGE_STORAGE_BUCKET;
}

function isImageRecordSession(session){
  return !!getImageRecordKind(session);
}

function formatExerciseRecordLabel(session){
  const jp = (session?.type || '').toString().trim();
  const ko = (session?.korean || '').toString().trim();
  const imageName = (session?.imageName || '').toString().trim();
  const imageKind = getImageRecordKind(session);
  const periodDay = Number(session?.periodDay);
  if(imageKind){
    const cfg = getImageRecordConfig(imageKind);
    const note = (session?.note || '').toString().trim();
    if(imageKind === 'otherImage') return note ? `${cfg.type} ${note}` : (imageName ? `${cfg.type} ${imageName}` : cfg.type);
    return imageName ? `${cfg.type} ${imageName}` : cfg.type;
  }
  if(Number.isFinite(periodDay) && periodDay > 0 && (jp === '生理' || jp.includes('生理') || !jp)) return `生理 ${periodDay}日目`;
  if(jp && ko && jp !== ko) return `${jp} ${ko}`;
  if(ko && !jp) return `韓国語 ${ko}`;
  return jp || ko || '';
}

function isMeditationExerciseSession(session){
  const type = (session?.type || '').toString().trim();
  const lower = type.toLowerCase();
  return type === '瞑想' || type.includes('瞑') || lower === 'meditation';
}

function formatCompactPositiveNumber(value){
  const num = Number(value);
  if(!Number.isFinite(num) || num <= 0) return '';
  const rounded = Math.round(num * 100) / 100;
  return String(rounded).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function formatExerciseDurationPart(session){
  const seconds = Number(session?.seconds);
  if(!(seconds > 0)) return '';
  if(isMeditationExerciseSession(session)){
    const minutes = formatCompactPositiveNumber(seconds / 60);
    return minutes ? ` ${minutes}分` : '';
  }
  const secondsText = formatCompactPositiveNumber(seconds);
  return secondsText ? ` ${secondsText}秒` : '';
}

function formatImageTimelineLabel(session){
  return (session?.note || '').toString().trim();
}

function editExerciseSessionTimeAt(idx){
  const dk = STATE.selected;
  if(!dk) return;
  const rec = getDayRecord(dk);
  const arr = Array.isArray(rec.exercise?.sessions) ? rec.exercise.sessions : [];
  const cur = arr[idx];
  if(!cur || !isImageRecordSession(cur)) return;

  const curVal = cur.startedAt ? new Date(cur.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
  const input = prompt('時刻を HH:MM で入力してください（空欄で時刻なし）', curVal);
  if(input === null) return;

  const trimmed = input.trim();
  if(trimmed){
    const iso = parseDateKeyAndHHMMToISO(dk, trimmed);
    if(!iso){ alert('HH:MM の形式で入力してください'); return; }
    arr[idx].startedAt = iso;
  }else{
    arr[idx].startedAt = null;
  }

  rec.exercise.sessions = arr;
  rec.exercise.updatedAt = nowISO();
  const mk = getMonthKey();
  STATE.payload.data[mk][dk] = rec;
  renderExerciseList();
  renderAllRecordsTimeline();
  med_saveAll();
}

// 全ての記録を時刻順に統一表示する関数
function renderAllRecordsTimeline(){
  const wrap = $('allRecordsTimeline');
  if(!wrap) return;
  wrap.innerHTML = '';
  
  const dk = STATE.selected;
  if(!dk) return;
  
  const rec = getExistingDayRecord(dk) || {};
  const allRecords = [];

  // 予定 (schedule.js)
  const appts = getAppointmentScheduleMarks(dk);
  appts.forEach((it, i)=>{
    const iso = parseDateKeyAndHHMMToISO(dk, it.time);
    allRecords.push({
      type: 'appointment',
      time: iso,
      label: `${(it.label || '').toString()}`,
      data: { index: i, appt: it }
    });
  });

  // シフト (schedule.js)
  const shift = getShiftForDateKey(dk);
  if(shift && shift.start){
    const iso = parseDateKeyAndHHMMToISO(dk, shift.start);
    const range = `${shift.start}${shift.end ? '-' + shift.end : ''}`;
    allRecords.push({
      type: 'shift',
      time: iso,
      label: `${shift.label} ${range}`,
      data: { shift }
    });
  }
  
  // 起床記録 (複数対応)
  const wakeArr = Array.isArray(rec.wake) ? rec.wake : [];
  wakeArr.forEach((iso, i) => {
    allRecords.push({ type: 'wake', time: iso, label: '起床', data: { index: i } });
  }); 

  // 覚醒記録 (複数対応)
  const awakeArr = Array.isArray(rec.awake) ? rec.awake : [];
  awakeArr.forEach((iso, i) => {
    allRecords.push({ type: 'awake', time: iso, label: '覚醒', data: { index: i } });
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
    const imageKind = getImageRecordKind(session);
    const secPart = formatExerciseDurationPart(session);
    const label = imageKind ? formatImageTimelineLabel(session) : `${formatExerciseRecordLabel(session)}${secPart}`;
    allRecords.push({
      type: imageKind || 'exercise',
      time: session && session.startedAt ? session.startedAt : null,
      label,
      data: { index: i, session }
    });
  });
  
  // 支出記録（レシート印字時刻があればそれを優先。撮影日とレシート日付が違う場合は時刻なし扱い）
  const expenseArr = Array.isArray(rec.expenses) ? rec.expenses : [];
  expenseArr.forEach((item, i) => {
    allRecords.push({
      type: 'expenseRecord',
      time: item?.occurredAt || (isoMatchesDateKey(item?.createdAt, dk) ? item.createdAt : null),
      label: `💴 ${formatExpenseRecordLabel(item)}`,
      data: { index: i, session: item }
    });
  });

  // 就寝記録 (複数対応)
  const sleepArr = Array.isArray(rec.sleep) ? rec.sleep : [];
  sleepArr.forEach((iso, i) => {
    allRecords.push({ type: 'sleep', time: iso, label: '就寝', data: { index: i } });
  });

  // 時刻順にソート（時刻なしは最後へ）
  allRecords.sort((a, b) => {
    const ta = a && a.time ? new Date(a.time).getTime() : Number.POSITIVE_INFINITY;
    const tb = b && b.time ? new Date(b.time).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
  
  // 表示
  allRecords.forEach(record => {
    const timeStr = record.time ? formatTimeShort(record.time) : '';
    const timePart = timeStr ? `${timeStr} ` : '';
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
    } else if(getImageRecordConfig(record.type) && record.data){
      buttons = `<div style="display:flex;gap:8px">
        <button data-img-time-edit="${record.data.index}" title="時刻変更">🕒</button>
        <button data-ex-del="${record.data.index}">✕</button>
      </div>`;
    } else if(record.type === 'exercise' && record.data){
      buttons = `<div style="display:flex;gap:8px">
        <button data-ex-edit="${record.data.index}">✏</button>
        <button data-ex-del="${record.data.index}">✕</button>
      </div>`;
    } else if((record.type === 'wake' || record.type === 'awake' || record.type === 'sleep') && record.data){
      const kind = record.type;
      buttons = `<div style="display:flex;gap:6px">
        <button data-${kind}-edit="${record.data.index}">✏</button>
        <button data-${kind}-del="${record.data.index}">✕</button>
      </div>`;
    } else if(record.type === 'expenseRecord' && record.data){
      buttons = `<div style="display:flex;gap:8px">
        <button data-expense-del="${record.data.index}">✕</button>
      </div>`;
    }

    const labelText = escapeHtml(record.label || '');
    const imageThumb = ((getImageRecordConfig(record.type) || record.type === 'expenseRecord') && record.data)
      ? renderImageThumbHtml(record.data.session)
      : '';

    row.innerHTML = `
      <div style="font-weight:700">${timePart}<span style="font-weight:400;margin-left:8px">${labelText}</span>${imageThumb}</div>
      ${buttons}
    `;
    
    wrap.appendChild(row);
  });

  hydrateImageSignedUrls(wrap);
  
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

      try{
        const minutes = sessions[idx];
        const startIso = starts[idx] || '';
        const startTxt = startIso ? formatTimeShort(startIso) : '';
        const label = `${startTxt ? (startTxt + ' ') : ''}瞑想 ${minutes}分`;
        if(!confirmDelete(`${label} を削除しますか？`)) return;
      }catch(e){
        if(!confirmDelete('この瞑想記録を削除しますか？')) return;
      }

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

  wrap.querySelectorAll('button[data-img-time-edit]').forEach(b => {
    b.addEventListener('click', (ev) => {
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
      const idx = parseInt(b.getAttribute('data-img-time-edit'), 10);
      editExerciseSessionTimeAt(idx);
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

  // 生理は「n日目」も編集できるようにする
  if((cur.type||'') === '生理' || Number.isFinite(Number(cur.periodDay))){
    const curDay = Number(cur.periodDay) > 0 ? String(Math.floor(Number(cur.periodDay))) : '1';
    const dayStr = prompt('生理 n日目（1以上）', curDay);
    if(dayStr === null) return;
    const day = Math.max(1, Math.floor(Number(dayStr)||0));
    if(!Number.isFinite(day) || day <= 0){ alert('n日目（1以上）を入力してください'); return; }
    cur.type = '生理';
    cur.periodDay = day;
  } else {
    // 生理以外はラベルを編集
    const curLabel = (cur.type || '').toString().trim();
    const newLabel = prompt('ラベルを入力してください', curLabel);
    if(newLabel === null) return;
    const trimmed = newLabel.trim();
    if(!trimmed){ alert('ラベルを入力してください'); return; }
    cur.type = trimmed;
  }

  // prompt for new start time
  const curVal = cur.startedAt ? new Date(cur.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
  const input = prompt('時刻を HH:MM で入力してください（24時間）', curVal);
  if(input === null) return;
  const iso = parseHHMMToISO(input);
  if(!iso){ alert('HH:MM の形式で入力してください'); return; }
  arr[idx].startedAt = iso;
  rec.exercise.sessions = arr; rec.exercise.updatedAt = nowISO(); const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderExerciseList(); renderAllRecordsTimeline(); med_saveAll();
    });
  });
  
  wrap.querySelectorAll('button[data-ex-del]').forEach(b => {
    b.addEventListener('click', async (ev) => {
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
      const idx = parseInt(b.getAttribute('data-ex-del'), 10);
      await deleteExerciseSessionAt(idx);
    });
  });

  wrap.querySelectorAll('button[data-expense-del]').forEach(b => {
    b.addEventListener('click', async (ev) => {
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
      const idx = parseInt(b.getAttribute('data-expense-del'), 10);
      await deleteExpenseRecordAt(idx);
    });
  });

  // 起床・覚醒・就寝 個別編集・削除リスナー
  ['wake','awake','sleep'].forEach(kind=>{
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

function addMedSessionWithStart(min, startedAt){
  // migrate meditation timer recording to the same shape as exercise (プランク)
  try{
    const seconds = Math.round(Number(min) * 60);
    addExerciseWithStart(seconds, '瞑想', startedAt || new Date().toISOString());
  }catch(e){ console.warn('addMedSessionWithStart wrapper failed', e); }
}

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

  // cleanup (5 minutes)
  const cStart = $('cleanupStart'); if(cStart) cStart.addEventListener('click', (ev)=>{ const btn = ev.currentTarget; if(btn.dataset.mode === 'alarm-stop'){ stopAlarm(btn); return; } startExerciseTimer('cleanup'); });
  const cRecord = $('cleanupRecord'); if(cRecord) cRecord.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); addCleanupRecord(); });
  // initialize displays/buttons
  setExerciseButtons('plank', {start:true,pause:false,resume:false,cancel:false}); updateExerciseDisplay('plank');
  setExerciseButtons('wall', {start:true,pause:false,resume:false,cancel:false}); updateExerciseDisplay('wall');
  setExerciseButtons('cleanup', {start:true,pause:false,resume:false,cancel:false}); updateExerciseDisplay('cleanup');
  // render existing exercises when editor opens
  renderExerciseList();
  // wire free add button
  const freeBtn = $('freeAdd'); if(freeBtn) freeBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); addFreeRecord(); });
  const freeTextBtn = $('freeTextAdd'); if(freeTextBtn) freeTextBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); addFreeTextRecord(); });
  const accomplishedBtn = $('accomplishedAdd'); if(accomplishedBtn) accomplishedBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); addAccomplishedRecord(); });
  const codingBtn = $('codingAdd'); if(codingBtn) codingBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); addCodingRecord(); });
  const mealImageBtn = $('mealImageAdd'); if(mealImageBtn) mealImageBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); addMealImageRecord(); });
  const mealImageFileEl = $('mealImageFile'); if(mealImageFileEl) mealImageFileEl.addEventListener('change', ()=> handleImageFileInputChange('mealImage', 'picker'));
  const mealImageCameraFileEl = $('mealImageCameraFile'); if(mealImageCameraFileEl) mealImageCameraFileEl.addEventListener('change', ()=> handleImageFileInputChange('mealImage', 'camera'));
  updateMealImageFileLabel();
  const otherImageBtn = $('otherImageAdd'); if(otherImageBtn) otherImageBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); addOtherImageRecord(); });
  const otherImageFileEl = $('otherImageFile'); if(otherImageFileEl) otherImageFileEl.addEventListener('change', ()=> handleImageFileInputChange('otherImage', 'picker'));
  const otherImageCameraFileEl = $('otherImageCameraFile'); if(otherImageCameraFileEl) otherImageCameraFileEl.addEventListener('change', ()=> handleImageFileInputChange('otherImage', 'camera'));
  updateOtherImageFileLabel();
  const expenseAnalyzeBtn = $('expenseAnalyze'); if(expenseAnalyzeBtn) expenseAnalyzeBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); analyzeExpenseReceipt(); });
  const expenseSaveBtn = $('expenseSave'); if(expenseSaveBtn) expenseSaveBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); saveExpenseRecord(); });
  const expenseFileEl = $('expenseFile'); if(expenseFileEl) expenseFileEl.addEventListener('change', ()=> handleImageFileInputChange('expense', 'picker'));
  const expenseCameraFileEl = $('expenseCameraFile'); if(expenseCameraFileEl) expenseCameraFileEl.addEventListener('change', ()=> handleImageFileInputChange('expense', 'camera'));
  const expenseCameraBtn = $('expenseCameraBtn'); if(expenseCameraBtn) expenseCameraBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); openExpenseCameraOverlay(); });
  const expenseCameraShutter = $('expenseCameraShutter'); if(expenseCameraShutter) expenseCameraShutter.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); captureExpensePhotoFromOverlay(); });
  const expenseCameraCancel = $('expenseCameraCancel'); if(expenseCameraCancel) expenseCameraCancel.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); closeExpenseCameraOverlay(); });
  const expenseCameraVideo = $('expenseCameraVideo'); if(expenseCameraVideo) expenseCameraVideo.addEventListener('click', (ev)=>{ tapToFocusExpenseCamera(ev); });
  updateExpenseFileLabel();
  const selfKindnessBtn = $('selfKindnessAdd'); if(selfKindnessBtn) selfKindnessBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); addSelfKindnessJournal(); });
  const tongueBtn = $('tongueAdd'); if(tongueBtn) tongueBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); addTongueRecord(); });
  const rohtoBtn = $('rohtoAdd'); if(rohtoBtn) rohtoBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); addRohtoRecord(); });

  const prevDayBtn = $('openPrevDay');
  if(prevDayBtn) prevDayBtn.addEventListener('click', (ev)=>{
    ev.preventDefault();
    if(STATE.selected) {
      const d = new Date(STATE.selected + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      const yy = d.getFullYear();
      const mm = String(d.getMonth()+1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      location.href = '?date=' + yy + '-' + mm + '-' + dd;
    }
  });

  const nextDayBtn = $('openNextDay');
  if(nextDayBtn) nextDayBtn.addEventListener('click', (ev)=>{
    ev.preventDefault();
    if(STATE.selected) {
      const d = new Date(STATE.selected + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      const yy = d.getFullYear();
      const mm = String(d.getMonth()+1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      location.href = '?date=' + yy + '-' + mm + '-' + dd;
    }
  });

  const todayBtn = $('openToday');
  if(todayBtn) todayBtn.addEventListener('click', (ev)=>{
    ev.preventDefault();
    location.href = '?';
  });

  // period record (生理 n日目)
  const periodBtn = $('periodAdd');
  if(periodBtn) periodBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); addPeriodRecord(); });
  // prevent mobile credential UI by randomizing name/autocomplete on focus
  const freeKorean = $('freeKorean');
  const freeText = $('freeText');
  const freeUseTime = $('freeUseTime');
  const freeTextUseTime = $('freeTextUseTime');
  const accomplished = $('accomplished');
  const codingText = $('codingText');
  const selfKindnessText = $('selfKindnessText');
  const otherImageNote = $('otherImageNote');
  const expenseStore = $('expenseStore');
  attachNoCredentialBehavior(freeKorean);
  attachNoCredentialBehavior(freeText);
  attachNoCredentialBehavior(accomplished);
  attachNoCredentialBehavior(codingText);
  attachNoCredentialBehavior(selfKindnessText);
  attachNoCredentialBehavior(otherImageNote);
  attachNoCredentialBehavior(expenseStore);
}); }catch(e){}

function addPeriodRecord(){
  try{
    if(!ensureAuthOrSignOut()) return;
    const dayEl = $('periodDay');
    const useTimeEl = $('periodUseTime');
    const day = Math.max(1, Math.floor(Number(dayEl?.value)||0));
    if(!Number.isFinite(day) || day <= 0){ alert('n日目（1以上）を入力してください'); return; }
    const useTime = !useTimeEl || !!useTimeEl.checked;
    const iso = useTime ? new Date().toISOString() : null;
    addFreeRecordWithOptionalTime({ seconds: 0, label: '生理', korean: '', startedAt: iso, periodDay: day });
  }catch(e){
    console.warn('addPeriodRecord failed', e);
    alert('記録に失敗しました');
  }
}

function addCleanupRecord(){
  try{
    const minEl = $('cleanupMin');
    const noteEl = $('cleanupText');
    const minValue = Number(minEl?.value) || 0;
    const min = minValue > 0 ? Math.floor(minValue) : 0;
    
    const note = (noteEl?.value || '').trim();
    
    // 分数が入力されている場合のみラベルに含める
    let label = '片付け';
    if(note) label += ` ${note}`;
    if(min > 0) label += ` ${min}分`;
    
    const curTime = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const timeInput = prompt('時刻を HH:MM で入力してください（24時間）', curTime);
    if(timeInput === null) return;
    const iso = parseHHMMToISO(timeInput);
    if(!iso){ alert('HH:MM の形式で入力してください'); return; }
    
    const seconds = 0;  // 秒数は記録しない（分数はラベルに含む）
    addExerciseWithStart(seconds, label, iso);
    
    // clear note field after successful record
    if(noteEl) noteEl.value = '';
  }catch(e){
    console.warn('addCleanupRecord failed', e);
    alert('記録に失敗しました');
  }
}

// ===== Exercise timers (プランク / 空気椅子 / 片付け) =====
const exerciseTimers = {
  plank: { id:null, running:false, endAt:0, remaining:0, startedAt:null, totalSeconds:0, label:'' },
  wall: { id:null, running:false, endAt:0, remaining:0, startedAt:null, totalSeconds:0, label:'' },
  cleanup: { id:null, running:false, endAt:0, remaining:0, startedAt:null, totalSeconds:0, label:'' }
};

const EXERCISE_CFG = {
  plank: { prefix: 'plank', label: 'プランク', sec: ()=> Math.max(1, Math.floor(Number($('plankSec')?.value)||0)) },
  wall: { prefix: 'wall', label: '空気椅子', sec: ()=> Math.max(1, Math.floor(Number($('wallSec')?.value)||0)) },
  cleanup: { prefix: 'cleanup', label: '片付け', sec: ()=> 5*60, noteId: 'cleanupText' }
};

function getExerciseCfg(key){ return EXERCISE_CFG[key] || null; }

function fmtTimeMS(ms){ const s = Math.ceil(ms/1000); const m = Math.floor(s/60); const ss = String(s%60).padStart(2,'0'); return `${m}:${ss}`; }

function updateExerciseDisplay(key){ const t = exerciseTimers[key]; const cfg = getExerciseCfg(key); if(!t || !cfg) return; const disp = $(cfg.prefix + 'Display'); if(!disp) return; if(t.running){ disp.textContent = fmtTimeMS(Math.max(0, t.endAt - Date.now())); } else { disp.textContent = t.remaining ? fmtTimeMS(t.remaining) : '--:--'; } }

function setExerciseButtons(key, {start,pause,resume,cancel}){
  const cfg = getExerciseCfg(key); if(!cfg) return; const prefix = cfg.prefix;
  const bS = $(prefix+'Start'); if(bS) bS.disabled = !start;
  const bP = $(prefix+'Pause'); if(bP) bP.disabled = !pause;
  const bR = $(prefix+'Resume'); if(bR) bR.disabled = !resume;
  const bC = $(prefix+'Cancel'); if(bC) bC.disabled = !cancel;
}

function startExerciseTimer(key){
  const cfg = getExerciseCfg(key); if(!cfg) return;
  const sec = Number(cfg.sec?.()) || 0;
  if(sec <= 0) return;
  const t = exerciseTimers[key];
  const note = cfg.noteId ? (String($(cfg.noteId)?.value || '').trim()) : '';
  t.label = cfg.label + (note ? `：${note}` : '');
  t.totalSeconds = sec;
  t.startedAt = new Date().toISOString();
  t.remaining = sec*1000;
  t.endAt = Date.now() + t.remaining;
  t.running = true;
  setExerciseButtons(key, {start:false,pause:true,resume:false,cancel:true}); updateExerciseDisplay(key);
  if(t.id) clearInterval(t.id);
  t.id = setInterval(()=>{
  const left = t.endAt - Date.now(); if(left<=0){ clearInterval(t.id); t.id = null; t.running=false; t.remaining=0; updateExerciseDisplay(key); // record on completion
    addExerciseWithStart(t.totalSeconds || sec, t.label || cfg.label, t.startedAt);
    // play alarm and make the start button act as 消音
    const startBtn = $(cfg.prefix+'Start'); startAlarm(startBtn); if(startBtn) setExerciseButtons(key, {start:true,pause:false,resume:false,cancel:false});
    } else updateExerciseDisplay(key);
  }, 200);
}

function pauseExerciseTimer(key){ const t = exerciseTimers[key]; if(!t.running) return; t.running=false; t.remaining = Math.max(0, t.endAt - Date.now()); if(t.id) clearInterval(t.id); t.id = null; setExerciseButtons(key, {start:false,pause:false,resume:true,cancel:true}); updateExerciseDisplay(key); }

function cancelExerciseTimer(key){ const t = exerciseTimers[key]; if(t?.id) clearInterval(t.id); exerciseTimers[key] = { id:null, running:false, endAt:0, remaining:0, startedAt:null, totalSeconds:0, label:'' }; setExerciseButtons(key, {start:true,pause:false,resume:false,cancel:false}); updateExerciseDisplay(key); }

function addExerciseWithStart(seconds, kind, startedAt){ try{ const dk = STATE.selected; if(!dk) return; const rec = getDayRecord(dk); rec.exercise = rec.exercise || { sessions: [], updatedAt: nowISO() };
    const sessions = Array.isArray(rec.exercise.sessions) ? rec.exercise.sessions.slice() : [];
    const item = { id: 'e'+Date.now().toString(36)+Math.random().toString(36).slice(2,7), type: kind||'exercise', seconds: Number(seconds)||0, startedAt: startedAt || new Date().toISOString(), completedAt: new Date((new Date(startedAt||new Date())).getTime() + (Number(seconds)||0)*1000).toISOString() };
    sessions.push(item); rec.exercise.sessions = sessions; rec.exercise.updatedAt = nowISO(); const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderExerciseList(); renderAllRecordsTimeline(); med_saveAll(); setMsg(`${kind} を記録しました`); }catch(e){ console.warn('addExerciseWithStart failed', e); } }

function renderExerciseList(){ const wrap = $('exerciseList'); if(!wrap) return; wrap.innerHTML = ''; const dk = STATE.selected; if(!dk) return; const rec = getExistingDayRecord(dk) || {}; const sessions = Array.isArray(rec.exercise?.sessions) ? rec.exercise.sessions : []; if(!sessions.length){ wrap.innerHTML = ''; return; }
  
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
    const secPart = formatExerciseDurationPart(it);
    const label = `${formatExerciseRecordLabel(it)}${secPart}`;
    const isImageRecord = isImageRecordSession(it);
    const imageThumb = isImageRecord ? renderImageThumbHtml(it) : '';
    const buttons = isImageRecord
      ? `<div style="display:flex;gap:8px"><button data-ex-del='${idx}'>✕</button></div>`
      : `<div style="display:flex;gap:8px"><button data-ex-edit='${idx}'>✏</button><button data-ex-del='${idx}'>✕</button></div>`;
    row.setAttribute('data-ex-idx', String(idx));
    row.innerHTML = `<div style="font-weight:700">${startTxt} <span style="font-weight:400;margin-left:8px">${escapeHtml(label)}</span>${imageThumb}</div>` + buttons;
    wrap.appendChild(row);
  });
  hydrateImageSignedUrls(wrap);
  // attach handlers
  wrap.querySelectorAll('button[data-ex-edit]').forEach(b=> b.addEventListener('click', (ev)=>{ try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
    const idx = parseInt(b.getAttribute('data-ex-edit'),10);
    const dk = STATE.selected; if(!dk) return;
    const rec = getDayRecord(dk);
    const arr = Array.isArray(rec.exercise?.sessions) ? rec.exercise.sessions : [];
    const cur = arr[idx]; if(!cur) return;

    // 生理は「n日目」を編集
    if((cur.type||'') === '生理' || Number.isFinite(Number(cur.periodDay))){
      const curDay = Number(cur.periodDay) > 0 ? String(Math.floor(Number(cur.periodDay))) : '1';
      const dayStr = prompt('生理 n日目（1以上）', curDay);
      if(dayStr === null) return;
      const day = Math.max(1, Math.floor(Number(dayStr)||0));
      if(!Number.isFinite(day) || day <= 0){ alert('n日目（1以上）を入力してください'); return; }
      cur.type = '生理';
      cur.periodDay = day;
    } else {
      // 生理以外はラベルを編集
      const curLabel = (cur.type || '').toString().trim();
      const newLabel = prompt('ラベルを入力してください', curLabel);
      if(newLabel === null) return;
      const trimmed = newLabel.trim();
      if(!trimmed){ alert('ラベルを入力してください'); return; }
      cur.type = trimmed;
    }

    // 時刻を編集
    const curVal = cur.startedAt ? new Date(cur.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    const input = prompt('時刻を HH:MM で入力してください（24時間）', curVal);
    if(input === null) return;
    const iso = parseHHMMToISO(input);
    if(!iso){ alert('HH:MM の形式で入力してください'); return; }
    arr[idx].startedAt = iso; rec.exercise.sessions = arr; rec.exercise.updatedAt = nowISO(); const mk = getMonthKey(); STATE.payload.data[mk][dk] = rec; renderExerciseList(); renderAllRecordsTimeline(); med_saveAll(); }));
  wrap.querySelectorAll('button[data-ex-del]').forEach(b=> b.addEventListener('click', async (ev)=>{
    try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
    const idx = parseInt(b.getAttribute('data-ex-del'),10);
    await deleteExerciseSessionAt(idx);
  }));
}

// Inline editing removed: edits are now handled via prompt dialogs to simplify UI.

function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escapeAttr(s){ return escapeHtml(s).replace(/'/g,'&#39;'); }

function renderImagePreviewButton(src, altText){
  const safeSrc = escapeAttr(src);
  const safeAlt = escapeAttr(altText || '画像');
  return `<button type="button" data-image-preview-src="${safeSrc}" data-image-preview-alt="${safeAlt}" style="margin-left:8px;display:inline-flex;align-items:center;padding:0;border:0;background:transparent;box-shadow:none;min-width:0;min-height:0;cursor:pointer"><img src="${safeSrc}" alt="${safeAlt}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;border:1px solid rgba(255,255,255,0.18)"></button>`;
}

function ensureImagePreviewOverlay(){
  let overlay = $('imagePreviewOverlay');
  if(overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'imagePreviewOverlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '5000';
  overlay.style.display = 'none';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '16px';
  overlay.style.background = 'rgba(0,0,0,0.82)';
  overlay.style.boxSizing = 'border-box';

  overlay.innerHTML = `
    <div data-image-preview-panel style="position:relative;display:flex;align-items:center;justify-content:center;max-width:100%;max-height:100%">
      <button id="imagePreviewClose" type="button" aria-label="閉じる" style="position:absolute;right:0;top:-48px;border:1px solid rgba(255,255,255,0.32);background:rgba(15,23,42,0.96);color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">閉じる</button>
      <img id="imagePreviewImg" alt="画像" style="display:block;max-width:calc(100vw - 32px);max-height:calc(100vh - 96px);object-fit:contain;border-radius:8px;background:rgba(255,255,255,0.04)" />
    </div>
  `;

  overlay.addEventListener('click', (ev)=>{
    try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
    const panel = ev.target && ev.target.closest ? ev.target.closest('[data-image-preview-panel]') : null;
    if(!panel || ev.target?.id === 'imagePreviewClose') closeImagePreview();
  });

  document.body.appendChild(overlay);
  return overlay;
}

function openImagePreview(src, altText){
  if(!src) return;
  const overlay = ensureImagePreviewOverlay();
  const img = $('imagePreviewImg');
  if(img){
    img.src = src;
    img.alt = altText || '画像';
  }
  overlay.style.display = 'flex';
}

function closeImagePreview(){
  const overlay = $('imagePreviewOverlay');
  if(!overlay) return;
  overlay.style.display = 'none';
  const img = $('imagePreviewImg');
  if(img) img.removeAttribute('src');
}

try{
  document.addEventListener('click', (ev)=>{
    const trigger = ev.target && ev.target.closest ? ev.target.closest('[data-image-preview-src]') : null;
    if(!trigger) return;
    ev.preventDefault();
    ev.stopPropagation();
    openImagePreview(trigger.getAttribute('data-image-preview-src') || '', trigger.getAttribute('data-image-preview-alt') || '画像');
  }, true);
  document.addEventListener('keydown', (ev)=>{
    if(ev.key === 'Escape') closeImagePreview();
  });
}catch(e){}

function toSafeImageDataUrl(value){
  if(typeof value !== 'string') return null;
  const s = value.trim();
  if(!/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(s)) return null;
  return s;
}

function getCachedImageSignedUrl(bucket, path){
  const key = `${bucket}:${path}`;
  const cached = imageSignedUrlCache.get(key);
  if(cached && cached.url && cached.expiresAt > Date.now() + 60 * 1000) return cached.url;
  return null;
}

async function getImageSignedUrl(bucket, path){
  if(!supabaseClient) throw new Error('Supabase SDK is not available');
  const safeBucket = bucket || IMAGE_STORAGE_BUCKET;
  const safePath = (path || '').toString().trim();
  if(!safePath) throw new Error('storagePath is empty');

  const key = `${safeBucket}:${safePath}`;
  const cached = imageSignedUrlCache.get(key);
  if(cached && cached.url && cached.expiresAt > Date.now() + 60 * 1000) return cached.url;
  if(cached && cached.promise) return cached.promise;

  const promise = supabaseClient.storage
    .from(safeBucket)
    .createSignedUrl(safePath, IMAGE_SIGNED_URL_SECONDS)
    .then(({ data, error })=>{
      if(error) throw error;
      const signedUrl = data && data.signedUrl ? data.signedUrl : '';
      if(!signedUrl) throw new Error('signed URL is empty');
      imageSignedUrlCache.set(key, {
        url: signedUrl,
        expiresAt: Date.now() + IMAGE_SIGNED_URL_SECONDS * 1000
      });
      return signedUrl;
    })
    .catch(err=>{
      imageSignedUrlCache.delete(key);
      throw err;
    });

  imageSignedUrlCache.set(key, { promise, expiresAt: 0 });
  return promise;
}

function renderImageThumbHtml(session){
  const cfg = getImageRecordConfig(getImageRecordKind(session));
  const altText = cfg ? cfg.type : '画像';
  const legacyUrl = toSafeImageDataUrl(session?.imageDataUrl);
  if(legacyUrl){
    return renderImagePreviewButton(legacyUrl, altText);
  }

  const storagePath = getImageStoragePath(session);
  if(!storagePath) return '';
  const bucket = getImageStorageBucket(session);
  const cachedUrl = getCachedImageSignedUrl(bucket, storagePath);
  if(cachedUrl){
    return renderImagePreviewButton(cachedUrl, altText);
  }

  return `<span data-image-path="${escapeAttr(storagePath)}" data-image-bucket="${escapeAttr(bucket)}" style="margin-left:8px;display:inline-flex;align-items:center;min-height:36px;color:rgba(226,232,240,0.72);font-size:12px">画像を読み込み中...</span>`;
}

function hydrateImageSignedUrls(root){
  if(!root) return;
  const nodes = Array.from(root.querySelectorAll('[data-image-path]'));
  nodes.forEach(node=>{
    const path = node.getAttribute('data-image-path') || '';
    const bucket = node.getAttribute('data-image-bucket') || IMAGE_STORAGE_BUCKET;
    getImageSignedUrl(bucket, path).then(url=>{
      if(!node.isConnected) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-image-preview-src', url);
      btn.setAttribute('data-image-preview-alt', '画像');
      btn.style.marginLeft = '0';
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.padding = '0';
      btn.style.border = '0';
      btn.style.background = 'transparent';
      btn.style.boxShadow = 'none';
      btn.style.minWidth = '0';
      btn.style.minHeight = '0';
      btn.style.cursor = 'pointer';
      const img = document.createElement('img');
      img.src = url;
      img.alt = '画像';
      img.style.width = '36px';
      img.style.height = '36px';
      img.style.borderRadius = '6px';
      img.style.objectFit = 'cover';
      img.style.border = '1px solid rgba(255,255,255,0.18)';
      btn.appendChild(img);
      node.textContent = '';
      node.appendChild(btn);
    }).catch(err=>{
      console.warn('image signed URL failed', { bucket, path, error: err });
      if(node.isConnected) node.textContent = '画像を表示できません';
    });
  });
}

function dataUrlApproxBytes(dataUrl){
  if(typeof dataUrl !== 'string') return 0;
  const idx = dataUrl.indexOf(',');
  if(idx < 0) return 0;
  const b64 = dataUrl.slice(idx + 1);
  return Math.floor((b64.length * 3) / 4);
}

function fileToDataUrl(file){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = ()=> resolve(String(r.result || ''));
    r.onerror = ()=> reject(new Error('file read failed'));
    r.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=> resolve(img);
    img.onerror = ()=> reject(new Error('invalid image'));
    img.src = dataUrl;
  });
}

async function compressImageForRecord(file){
  const source = await fileToDataUrl(file);
  const img = await loadImageFromDataUrl(source);

  const maxSide = 1280;
  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if(!w || !h) return null;

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if(!ctx) return null;
  ctx.drawImage(img, 0, 0, outW, outH);

  const targetBytes = 360 * 1024;
  let quality = 0.84;
  let out = canvas.toDataURL('image/jpeg', quality);
  while(dataUrlApproxBytes(out) > targetBytes && quality > 0.42){
    quality -= 0.08;
    out = canvas.toDataURL('image/jpeg', quality);
  }
  if(dataUrlApproxBytes(out) > 900 * 1024) return null;
  return out;
}

function canvasToJpegBlob(canvas, quality){
  return new Promise((resolve)=> canvas.toBlob(blob=> resolve(blob), 'image/jpeg', quality));
}

async function compressImageBlobForRecord(file){
  const source = await fileToDataUrl(file);
  const img = await loadImageFromDataUrl(source);

  const maxSide = 1280;
  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if(!w || !h) return null;

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if(!ctx) return null;
  ctx.drawImage(img, 0, 0, outW, outH);

  const targetBytes = 360 * 1024;
  let quality = 0.84;
  let blob = await canvasToJpegBlob(canvas, quality);
  while(blob && blob.size > targetBytes && quality > 0.42){
    quality -= 0.08;
    blob = await canvasToJpegBlob(canvas, quality);
  }
  if(!blob || blob.size > 900 * 1024) return null;
  return blob;
}

function compactIsoForFileName(iso){
  return String(iso || nowISO()).replace(/[-:.]/g, '').replace(/\.\d+Z$/, 'Z');
}

function randomStorageId(){
  try{ if(window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID(); }catch(e){}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function buildImageStoragePath(kind, dateKey, createdAt){
  const cfg = getImageRecordConfig(kind);
  if(!cfg) throw new Error('Invalid image kind');
  if(!currentUser || !currentUser.id) throw new Error('User is not authenticated');
  if(!isValidDateKey(dateKey)) throw new Error('Invalid selected date');
  const parts = dateKey.split('-');
  const stamp = compactIsoForFileName(createdAt || nowISO());
  return `${currentUser.id}/${cfg.category}/${parts[0]}/${parts[1]}/${parts[2]}/${stamp}-${randomStorageId()}.jpg`;
}

async function uploadImageBlob(blob, kind, dateKey, createdAt){
  if(!supabaseClient) throw new Error('Supabase SDK is not available');
  const storagePath = buildImageStoragePath(kind, dateKey, createdAt);
  const { error } = await supabaseClient.storage
    .from(IMAGE_STORAGE_BUCKET)
    .upload(storagePath, blob, {
      contentType: 'image/jpeg',
      cacheControl: '3600',
      upsert: false
    });
  if(error) throw error;
  return { storageBucket: IMAGE_STORAGE_BUCKET, storagePath };
}

async function removeImageStorageObject(session){
  const storagePath = getImageStoragePath(session);
  if(!storagePath) return true;
  const storageBucket = getImageStorageBucket(session);
  const { error } = await supabaseClient.storage.from(storageBucket).remove([storagePath]);
  if(error) throw error;
  imageSignedUrlCache.delete(`${storageBucket}:${storagePath}`);
  return true;
}

function createRecordId(prefix){
  return `${prefix || 'e'}${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;
}

function addExerciseSessionToPayload(dateKey, item){
  const rec = getDayRecord(dateKey);
  rec.exercise = rec.exercise || { sessions: [], updatedAt: nowISO() };
  const sessions = Array.isArray(rec.exercise.sessions) ? rec.exercise.sessions.slice() : [];
  sessions.push(item);
  rec.exercise.sessions = sessions;
  rec.exercise.updatedAt = nowISO();
  const mk = getMonthKey();
  STATE.payload.data[mk][dateKey] = rec;
}

function removeExerciseSessionById(dateKey, id){
  const rec = getDayRecord(dateKey);
  const sessions = Array.isArray(rec.exercise?.sessions) ? rec.exercise.sessions.slice() : [];
  const idx = sessions.findIndex(it => it && it.id === id);
  if(idx < 0) return null;
  const removed = sessions.splice(idx, 1)[0];
  rec.exercise.sessions = sessions;
  rec.exercise.updatedAt = nowISO();
  const mk = getMonthKey();
  STATE.payload.data[mk][dateKey] = rec;
  return { removed, index: idx };
}

function removeExerciseSessionAt(dateKey, idx){
  const rec = getDayRecord(dateKey);
  const sessions = Array.isArray(rec.exercise?.sessions) ? rec.exercise.sessions.slice() : [];
  if(!Number.isInteger(idx) || idx < 0 || idx >= sessions.length) return null;
  const removed = sessions.splice(idx, 1)[0];
  rec.exercise.sessions = sessions;
  rec.exercise.updatedAt = nowISO();
  const mk = getMonthKey();
  STATE.payload.data[mk][dateKey] = rec;
  return { removed, index: idx };
}

function restoreExerciseSessionAt(dateKey, item, idx){
  if(!item) return;
  const rec = getDayRecord(dateKey);
  const sessions = Array.isArray(rec.exercise?.sessions) ? rec.exercise.sessions.slice() : [];
  const insertAt = Math.max(0, Math.min(Number.isInteger(idx) ? idx : sessions.length, sessions.length));
  sessions.splice(insertAt, 0, item);
  rec.exercise.sessions = sessions;
  rec.exercise.updatedAt = nowISO();
  const mk = getMonthKey();
  STATE.payload.data[mk][dateKey] = rec;
}

function renderExerciseViews(){
  renderExerciseList();
  renderAllRecordsTimeline();
}

// Expense records can target a different month than the currently displayed one
// (the receipt's date decides where they live), so derive the month bucket from
// the dateKey instead of STATE-based getMonthKey().
function monthKeyFromDateKey(dateKey){ return String(dateKey).slice(0, 7); }

function getDayRecordByDateKey(dateKey){
  const mk = monthKeyFromDateKey(dateKey);
  STATE.payload.data = STATE.payload.data || {};
  STATE.payload.data[mk] = STATE.payload.data[mk] || {};
  let rec = STATE.payload.data[mk][dateKey];
  if(!rec){
    rec = { sessions: [], starts: [], ids: [], times: {} };
    STATE.payload.data[mk][dateKey] = rec;
  }
  return normalizeDayRecord(rec);
}

function addExpenseRecordToPayload(dateKey, item){
  const rec = getDayRecordByDateKey(dateKey);
  const arr = Array.isArray(rec.expenses) ? rec.expenses.slice() : [];
  arr.push(item);
  rec.expenses = arr;
  STATE.payload.data[monthKeyFromDateKey(dateKey)][dateKey] = rec;
}

function removeExpenseRecordById(dateKey, id){
  const rec = getDayRecordByDateKey(dateKey);
  const arr = Array.isArray(rec.expenses) ? rec.expenses.slice() : [];
  const idx = arr.findIndex(it => it && it.id === id);
  if(idx < 0) return null;
  const removed = arr.splice(idx, 1)[0];
  rec.expenses = arr;
  STATE.payload.data[monthKeyFromDateKey(dateKey)][dateKey] = rec;
  return { removed, index: idx };
}

function removeExpenseRecordAt(dateKey, idx){
  const rec = getDayRecordByDateKey(dateKey);
  const arr = Array.isArray(rec.expenses) ? rec.expenses.slice() : [];
  if(!Number.isInteger(idx) || idx < 0 || idx >= arr.length) return null;
  const removed = arr.splice(idx, 1)[0];
  rec.expenses = arr;
  STATE.payload.data[monthKeyFromDateKey(dateKey)][dateKey] = rec;
  return { removed, index: idx };
}

function restoreExpenseRecordAt(dateKey, item, idx){
  if(!item) return;
  const rec = getDayRecordByDateKey(dateKey);
  const arr = Array.isArray(rec.expenses) ? rec.expenses.slice() : [];
  const insertAt = Math.max(0, Math.min(Number.isInteger(idx) ? idx : arr.length, arr.length));
  arr.splice(insertAt, 0, item);
  rec.expenses = arr;
  STATE.payload.data[monthKeyFromDateKey(dateKey)][dateKey] = rec;
}

function getImageInputFile(cfg){
  if(!cfg) return null;
  const pickerEl = $(cfg.fileId);
  const cameraEl = cfg.cameraFileId ? $(cfg.cameraFileId) : null;
  const pickerFile = pickerEl && pickerEl.files ? pickerEl.files[0] : null;
  const cameraFile = cameraEl && cameraEl.files ? cameraEl.files[0] : null;
  return cameraFile || pickerFile || null;
}

function clearImageInputs(cfg){
  if(!cfg) return;
  const pickerEl = $(cfg.fileId);
  const cameraEl = cfg.cameraFileId ? $(cfg.cameraFileId) : null;
  if(pickerEl) pickerEl.value = '';
  if(cameraEl) cameraEl.value = '';
}

function handleImageFileInputChange(kind, source){
  const cfg = getImageRecordConfig(kind);
  if(!cfg) return;
  if(source === 'picker' && cfg.cameraFileId){
    const cameraEl = $(cfg.cameraFileId);
    if(cameraEl) cameraEl.value = '';
  }else if(source === 'camera'){
    const pickerEl = $(cfg.fileId);
    if(pickerEl) pickerEl.value = '';
  }
  if(kind === 'expense' && getImageInputFile(cfg)){
    expenseCapturedBlob = null;
    pendingExpenseAnalysis = null;
  }
  updateImageFileLabel(kind);
}

async function deleteExerciseSessionAt(idx){
  const dk = STATE.selected;
  if(!dk) return;
  const rec = getDayRecord(dk);
  const arr = Array.isArray(rec.exercise?.sessions) ? rec.exercise.sessions : [];
  const item = arr[idx];
  if(!item) return;

  try{
    const secPart = formatExerciseDurationPart(item);
    const label = `${formatExerciseRecordLabel(item)}${secPart}`.trim() || '記録';
    if(!confirmDelete(`${label} を削除しますか？`)) return;
  }catch(e){
    if(!confirmDelete('この記録を削除しますか？')) return;
  }

  const removedInfo = removeExerciseSessionAt(dk, idx);
  if(!removedInfo) return;
  renderExerciseViews();

  const saved = await med_saveAll();
  if(!saved){
    restoreExerciseSessionAt(dk, removedInfo.removed, removedInfo.index);
    renderExerciseViews();
    alert('記録削除の保存に失敗したため、削除を取り消しました');
    return;
  }

  if(getImageStoragePath(removedInfo.removed)){
    try{
      await removeImageStorageObject(removedInfo.removed);
    }catch(e){
      console.warn('Image storage delete failed; payload deletion was kept', {
        storagePath: getImageStoragePath(removedInfo.removed),
        error: e
      });
      alert('記録は削除しましたが、Storage上の画像削除に失敗しました。storagePathをconsoleに残しました。');
    }
  }
}

function updateImageFileLabel(kind){
  const cfg = getImageRecordConfig(kind);
  if(!cfg) return;
  const label = $(cfg.fileNameId);
  if(!label) return;
  if(kind === 'expense' && expenseCapturedBlob){ label.textContent = '撮影済みの写真'; return; }
  const file = getImageInputFile(cfg);
  label.textContent = file && file.name ? file.name : (kind === 'expense' ? 'レシート画像を選択' : '画像を選択');
}

function updateMealImageFileLabel(){ updateImageFileLabel('mealImage'); }
function updateOtherImageFileLabel(){ updateImageFileLabel('otherImage'); }
function updateExpenseFileLabel(){ updateImageFileLabel('expense'); }

function createImageSession(kind, { createdAt, startedAt, storageInfo, imageName, note }){
  const cfg = getImageRecordConfig(kind);
  if(!cfg) throw new Error('Invalid image kind');
  const item = {
    id: createRecordId('e'),
    type: cfg.type,
    kind,
    seconds: 0,
    startedAt: startedAt || null,
    createdAt,
    completedAt: null,
    storageBucket: storageInfo.storageBucket,
    storagePath: storageInfo.storagePath
  };
  const trimmedName = (imageName || '').toString().trim();
  if(trimmedName) item.imageName = trimmedName.slice(0, 80);
  const trimmedNote = (note || '').toString().trim();
  if(trimmedNote) item.note = trimmedNote.slice(0, 120);
  return item;
}

// handle free-add row (label + optional seconds)
function addFreeRecord(){ try{
  const koreanEl = $('freeKorean');
  const useTimeEl = $('freeUseTime');
  if(!koreanEl) return;

  const korean = (koreanEl.value||'').trim();
  if(!korean){ alert('韓国語の内容を入力してください'); return; }

  const useTime = !useTimeEl || !!useTimeEl.checked;
  const iso = useTime ? new Date().toISOString() : null;

  // Store as an exercise-like free record, with additional fields.
  // Keep `type` for display, and add optional `korean`.
  addFreeRecordWithOptionalTime({
    seconds: 0,
    label: '韓国語',
    korean,
    startedAt: iso
  });

  // clear inputs
  koreanEl.value = '';
}catch(e){ console.warn('addFreeRecord failed', e); alert('記録に失敗しました'); }}

function addFreeTextRecord(){ try{
  const textEl = $('freeText');
  const useTimeEl = $('freeTextUseTime');
  if(!textEl) return;

  const text = (textEl.value || '').trim();
  if(!text){ alert('内容を入力してください'); return; }

  const useTime = !useTimeEl || !!useTimeEl.checked;
  const iso = useTime ? new Date().toISOString() : null;

  // Store as an exercise-like free record.
  // Use `type` as the display label and leave `korean` empty.
  addFreeRecordWithOptionalTime({
    seconds: 0,
    label: text,
    korean: '',
    startedAt: iso
  });

  textEl.value = '';
}catch(e){ console.warn('addFreeTextRecord failed', e); alert('記録に失敗しました'); }}

function addAccomplishedRecord(){ try{
  const textEl = $('accomplished');
  const useTimeEl = $('accomplishedUseTime');
  if(!textEl) return;

  const text = (textEl.value || '').trim();
  if(!text){ alert('内容を入力してください'); return; }

  const useTime = !useTimeEl || !!useTimeEl.checked;
  const iso = useTime ? new Date().toISOString() : null;

  // Store as an exercise-like record.
  // Use `type` as the display label.
  addFreeRecordWithOptionalTime({
    seconds: 0,
    label: 'Accomplished ' + text,
    korean: '',
    startedAt: iso
  });

  textEl.value = '';
}catch(e){ console.warn('addAccomplishedRecord failed', e); alert('記録に失敗しました'); }}

function addCodingRecord(){ try{
  const textEl = $('codingText');
  const useTimeEl = $('codingUseTime');
  if(!textEl) return;

  const text = (textEl.value || '').trim();
  if(!text){ alert('内容を入力してください'); return; }

  const useTime = !useTimeEl || !!useTimeEl.checked;
  const iso = useTime ? new Date().toISOString() : null;

  addFreeRecordWithOptionalTime({
    seconds: 0,
    label: 'コーディング',
    korean: text,
    startedAt: iso
  });

  textEl.value = '';
}catch(e){ console.warn('addCodingRecord failed', e); alert('記録に失敗しました'); }}

async function addImageRecord(kind){
  const cfg = getImageRecordConfig(kind);
  if(!cfg) return;
  let uploadedSession = null;
  let targetDateKey = null;
  try{
    if(!ensureAuthOrSignOut()) return;
    targetDateKey = STATE.selected;
    if(!isValidDateKey(targetDateKey)){ alert('記録する日付を選択してください'); return; }
    const useTimeEl = $(cfg.useTimeId);
    const noteEl = cfg.noteId ? $(cfg.noteId) : null;
    const file = getImageInputFile(cfg);
    if(!file){ alert('画像を選択してください'); return; }
    if(file.type && !/^image\//i.test(file.type)){ alert('画像ファイルを選択してください'); return; }

    setMsg('画像を圧縮中...');
    const imageBlob = await compressImageBlobForRecord(file);
    if(!imageBlob){
      setMsg('');
      alert('画像サイズが大きすぎます。別の画像を選択してください');
      return;
    }

    const createdAt = nowISO();
    setMsg('画像をアップロード中...');
    const storageInfo = await uploadImageBlob(imageBlob, kind, targetDateKey, createdAt);

    const useTime = !useTimeEl || !!useTimeEl.checked;
    uploadedSession = createImageSession(kind, {
      createdAt,
      startedAt: useTime ? createdAt : null,
      storageInfo,
      imageName: file.name || '',
      note: noteEl ? noteEl.value : ''
    });

    addExerciseSessionToPayload(targetDateKey, uploadedSession);
    renderExerciseViews();

    const saved = await med_saveAll();
    if(!saved){
      removeExerciseSessionById(targetDateKey, uploadedSession.id);
      renderExerciseViews();
      try{
        await removeImageStorageObject(uploadedSession);
        alert('画像の記録保存に失敗したため、アップロード済み画像を削除しました');
      }catch(cleanupErr){
        console.warn('Image cleanup failed after payload save failure', {
          storagePath: uploadedSession.storagePath,
          error: cleanupErr
        });
        alert('画像の記録保存に失敗し、Storage上の孤立画像削除にも失敗しました。storagePathをconsoleに残しました。');
      }
      setMsg('画像の記録保存に失敗しました');
      return;
    }

    clearImageInputs(cfg);
    updateImageFileLabel(kind);
    if(noteEl) noteEl.value = '';
    setMsg(cfg.successMessage);
  }catch(e){
    console.warn('addImageRecord failed', { kind, error: e });
    setMsg('');
    if(uploadedSession && uploadedSession.storagePath){
      try{
        removeExerciseSessionById(targetDateKey, uploadedSession.id);
        renderExerciseViews();
      }catch(localErr){
        console.warn('Image local rollback failed after unexpected add failure', localErr);
      }
      try{
        await removeImageStorageObject(uploadedSession);
      }catch(cleanupErr){
        console.warn('Image cleanup failed after unexpected add failure', {
          storagePath: uploadedSession.storagePath,
          error: cleanupErr
        });
      }
    }
    alert('画像アップロードまたは記録に失敗しました。payloadは変更していません。');
  }
}

async function addMealImageRecord(){ return addImageRecord('mealImage'); }
async function addOtherImageRecord(){ return addImageRecord('otherImage'); }

function dataUrlToBlob(dataUrl){
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if(!match) return null;
  const mimeType = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

async function getSupabaseAccessToken(){
  if(!supabaseClient) return null;
  try{
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session ? session.access_token : null;
  }catch(e){ return null; }
}

async function openExpenseCameraOverlay(){
  const overlay = $('expenseCameraOverlay');
  const video = $('expenseCameraVideo');
  if(!overlay || !video || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    const fallback = $('expenseCameraFile');
    if(fallback) fallback.click();
    return;
  }
  try{
    expenseCameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 4096 },
        height: { ideal: 2160 }
      },
      audio: false
    });
    // 近接文字（レシート）はオートフォーカス必須。対応端末では連続AFを明示する
    try{
      const track = expenseCameraStream.getVideoTracks()[0];
      if(track && track.applyConstraints) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    }catch(e){}
    video.srcObject = expenseCameraStream;
    overlay.style.display = 'flex';
    try{ await video.play(); }catch(e){}
  }catch(e){
    // 非同期処理後の input.click() はユーザー操作扱いにならずブロックされることが
    // あるため、ここではフォールバック起動せず理由を明示する
    console.warn('getUserMedia failed', e);
    closeExpenseCameraOverlay();
    const reason = e && e.name === 'NotAllowedError'
      ? 'カメラの使用が許可されていません。Chromeのサイト設定でカメラを「許可」にしてください。'
      : `カメラを起動できませんでした（${e && e.name ? e.name : 'エラー'}）。`;
    alert(`${reason}\n「レシート画像を選択」から画像を選ぶこともできます。`);
  }
}

function showExpenseFocusRing(clientX, clientY){
  const overlay = $('expenseCameraOverlay');
  if(!overlay) return;
  let ring = $('expenseFocusRing');
  if(!ring){
    ring = document.createElement('div');
    ring.id = 'expenseFocusRing';
    ring.style.position = 'fixed';
    ring.style.width = '64px';
    ring.style.height = '64px';
    ring.style.border = '2px solid #fbbf24';
    ring.style.borderRadius = '50%';
    ring.style.pointerEvents = 'none';
    ring.style.zIndex = '10000';
    ring.style.transition = 'opacity 0.6s ease';
    overlay.appendChild(ring);
  }
  ring.style.left = (clientX - 32) + 'px';
  ring.style.top = (clientY - 32) + 'px';
  ring.style.opacity = '1';
  setTimeout(()=>{ try{ ring.style.opacity = '0'; }catch(e){} }, 700);
}

async function tapToFocusExpenseCamera(ev){
  const video = $('expenseCameraVideo');
  const track = expenseCameraStream ? expenseCameraStream.getVideoTracks()[0] : null;
  if(!video || !track || !video.videoWidth) return;
  const rect = video.getBoundingClientRect();
  if(!rect.width || !rect.height) return;
  showExpenseFocusRing(ev.clientX, ev.clientY);

  // object-fit:cover による切り抜きを補正して、映像フレーム内の正規化座標(0..1)へ変換
  const scale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const dispW = video.videoWidth * scale;
  const dispH = video.videoHeight * scale;
  const offsetX = (dispW - rect.width) / 2;
  const offsetY = (dispH - rect.height) / 2;
  const x = Math.min(1, Math.max(0, ((ev.clientX - rect.left) + offsetX) / dispW));
  const y = Math.min(1, Math.max(0, ((ev.clientY - rect.top) + offsetY) / dispH));

  if(!track.applyConstraints) return;
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  const focusModes = Array.isArray(caps.focusMode) ? caps.focusMode : [];
  const constraint = {};
  if('pointsOfInterest' in caps) constraint.pointsOfInterest = [{ x, y }];
  if(focusModes.includes('single-shot')) constraint.focusMode = 'single-shot';
  else if(focusModes.includes('continuous')) constraint.focusMode = 'continuous';
  if(!Object.keys(constraint).length) return;
  try{
    await track.applyConstraints({ advanced: [constraint] });
    // single-shot でピントを合わせた後は連続AFに戻す（対応端末のみ）
    if(constraint.focusMode === 'single-shot' && focusModes.includes('continuous')){
      setTimeout(()=>{ try{ track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); }catch(e){} }, 3000);
    }
  }catch(e){
    console.warn('tap-to-focus failed', e);
  }
}

function closeExpenseCameraOverlay(){
  const overlay = $('expenseCameraOverlay');
  const video = $('expenseCameraVideo');
  if(video) video.srcObject = null;
  if(expenseCameraStream){
    try{ expenseCameraStream.getTracks().forEach(t=> t.stop()); }catch(e){}
    expenseCameraStream = null;
  }
  if(overlay) overlay.style.display = 'none';
}

async function captureExpensePhotoFromOverlay(){
  const video = $('expenseCameraVideo');
  if(!video || !video.videoWidth){ alert('カメラ映像を取得できませんでした'); return; }
  let blob = null;
  // ImageCapture.takePhoto() はAF・露出調整済みのフル解像度写真を返すため優先する
  try{
    const track = expenseCameraStream ? expenseCameraStream.getVideoTracks()[0] : null;
    if(track && typeof window.ImageCapture === 'function'){
      blob = await new ImageCapture(track).takePhoto();
    }
  }catch(e){
    console.warn('takePhoto failed; falling back to canvas grab', e);
    blob = null;
  }
  if(!blob){
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if(!ctx){ alert('画像の生成に失敗しました'); return; }
    ctx.drawImage(video, 0, 0);
    blob = await canvasToJpegBlob(canvas, 0.9);
  }
  closeExpenseCameraOverlay();
  if(!blob){ alert('撮影に失敗しました'); return; }
  expenseCapturedBlob = blob;
  pendingExpenseAnalysis = null;
  clearImageInputs(getImageRecordConfig('expense'));
  updateExpenseFileLabel();
  setMsg('撮影しました。「AIで解析」を押してください');
}

function resetExpenseForm(){
  const cfg = getImageRecordConfig('expense');
  clearImageInputs(cfg);
  expenseCapturedBlob = null;
  updateExpenseFileLabel();
  pendingExpenseAnalysis = null;
  const storeEl = $('expenseStore'); if(storeEl) storeEl.value = '';
  const dateEl = $('expenseDate'); if(dateEl) dateEl.value = isValidDateKey(STATE.selected) ? STATE.selected : '';
  const timeEl = $('expenseTime'); if(timeEl) timeEl.value = '';
  const totalEl = $('expenseTotal'); if(totalEl) totalEl.value = '';
  const categoryEl = $('expenseCategory'); if(categoryEl) categoryEl.value = '';
}

async function analyzeExpenseReceipt(){
  const cfg = getImageRecordConfig('expense');
  try{
    if(!ensureAuthOrSignOut()) return;
    const targetDateKey = STATE.selected;
    if(!isValidDateKey(targetDateKey)){ alert('記録する日付を選択してください'); return; }
    const file = expenseCapturedBlob || getImageInputFile(cfg);
    if(!file){ alert('レシートを撮影するか、画像を選択してください'); return; }
    if(file.type && !/^image\//i.test(file.type)){ alert('画像ファイルを選択してください'); return; }

    setMsg('画像を圧縮中...');
    const dataUrl = await compressImageForRecord(file);
    if(!dataUrl){
      setMsg('');
      alert('画像サイズが大きすぎます。別の画像を選択してください');
      return;
    }
    const mimeMatch = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if(!mimeMatch){ setMsg(''); alert('画像の読み込みに失敗しました'); return; }
    const mimeType = mimeMatch[1];
    const imageBase64 = mimeMatch[2];
    pendingExpenseAnalysis = { dataUrl, mimeType };

    const accessToken = await getSupabaseAccessToken();
    if(!accessToken){ setMsg(''); alert('ログインし直してください'); return; }

    setMsg('AIで解析中...');
    const res = await fetch('/api/receipt-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ imageBase64, mimeType })
    });
    const json = await res.json().catch(()=>null);
    if(!res.ok || !json || !json.ok){
      setMsg('');
      alert('AI解析に失敗しました。フォームに手動で入力してください');
      return;
    }

    const data = json.data || {};
    const storeEl = $('expenseStore'); if(storeEl) storeEl.value = data.store || '';
    const dateEl = $('expenseDate'); if(dateEl) dateEl.value = data.date || targetDateKey;
    const timeEl = $('expenseTime'); if(timeEl) timeEl.value = data.time || '';
    const totalEl = $('expenseTotal'); if(totalEl) totalEl.value = (data.total !== null && data.total !== undefined) ? data.total : '';
    const categoryEl = $('expenseCategory'); if(categoryEl) categoryEl.value = EXPENSE_CATEGORIES.includes(data.category) ? data.category : '';
    setMsg('解析結果を確認して保存してください');
  }catch(e){
    console.warn('analyzeExpenseReceipt failed', e);
    setMsg('');
    alert('AI解析でエラーが発生しました');
  }
}

async function saveExpenseRecord(){
  const cfg = getImageRecordConfig('expense');
  let uploadedRecord = null;
  let targetDateKey = null;
  try{
    if(!ensureAuthOrSignOut()) return;

    const file = expenseCapturedBlob || getImageInputFile(cfg);
    if(!file && !pendingExpenseAnalysis){ alert('レシートを撮影するか、画像を選択してください'); return; }

    const storeEl = $('expenseStore');
    const dateEl = $('expenseDate');
    const timeEl = $('expenseTime');
    const totalEl = $('expenseTotal');
    const categoryEl = $('expenseCategory');
    const store = storeEl ? (storeEl.value || '').trim() : '';
    const dateVal = dateEl ? (dateEl.value || '').trim() : '';
    const timeVal = timeEl ? (timeEl.value || '').trim() : '';
    const totalVal = totalEl ? (totalEl.value || '').trim() : '';
    const category = categoryEl ? (categoryEl.value || '').trim() : '';

    // レシートの日付の日に記録する（未入力なら表示中の日）
    targetDateKey = isValidDateKey(dateVal) ? dateVal : STATE.selected;
    if(!isValidDateKey(targetDateKey)){ alert('記録する日付を選択してください'); return; }

    let imageBlob = pendingExpenseAnalysis && pendingExpenseAnalysis.dataUrl
      ? dataUrlToBlob(pendingExpenseAnalysis.dataUrl)
      : null;
    if(!imageBlob && file){
      setMsg('画像を圧縮中...');
      imageBlob = await compressImageBlobForRecord(file);
    }
    if(!imageBlob){
      setMsg('');
      alert('画像サイズが大きすぎます。別の画像を選択してください');
      return;
    }

    const createdAt = nowISO();
    setMsg('画像をアップロード中...');
    const storageInfo = await uploadImageBlob(imageBlob, 'expense', targetDateKey, createdAt);

    uploadedRecord = {
      id: createRecordId('exp'),
      kind: 'expense',
      source: 'receipt',
      store: store || null,
      date: dateVal || null,
      time: timeVal || null,
      occurredAt: timeVal ? parseDateKeyAndHHMMToISO(targetDateKey, timeVal) : null,
      total: totalVal !== '' && Number.isFinite(Number(totalVal)) ? Number(totalVal) : null,
      category: EXPENSE_CATEGORIES.includes(category) ? category : null,
      items: [],
      storageBucket: storageInfo.storageBucket,
      storagePath: storageInfo.storagePath,
      createdAt,
      updatedAt: createdAt
    };

    addExpenseRecordToPayload(targetDateKey, uploadedRecord);
    renderAllRecordsTimeline();

    const saved = await med_saveAll();
    if(!saved){
      removeExpenseRecordById(targetDateKey, uploadedRecord.id);
      renderAllRecordsTimeline();
      try{
        await removeImageStorageObject(uploadedRecord);
        alert('支出記録の保存に失敗したため、アップロード済み画像を削除しました');
      }catch(cleanupErr){
        console.warn('Expense image cleanup failed after payload save failure', {
          storagePath: uploadedRecord.storagePath,
          error: cleanupErr
        });
        alert('支出記録の保存に失敗し、Storage上の孤立画像削除にも失敗しました。storagePathをconsoleに残しました。');
      }
      setMsg('支出記録の保存に失敗しました');
      return;
    }

    resetExpenseForm();
    setMsg(targetDateKey === STATE.selected ? cfg.successMessage : `支出を ${targetDateKey} に記録しました`);
  }catch(e){
    console.warn('saveExpenseRecord failed', e);
    setMsg('');
    if(uploadedRecord && uploadedRecord.storagePath){
      try{
        removeExpenseRecordById(targetDateKey, uploadedRecord.id);
        renderAllRecordsTimeline();
      }catch(localErr){
        console.warn('Expense local rollback failed after unexpected save failure', localErr);
      }
      try{
        await removeImageStorageObject(uploadedRecord);
      }catch(cleanupErr){
        console.warn('Expense image cleanup failed after unexpected save failure', {
          storagePath: uploadedRecord.storagePath,
          error: cleanupErr
        });
      }
    }
    alert('支出の保存に失敗しました。payloadは変更していません。');
  }
}

async function deleteExpenseRecordAt(idx){
  const dk = STATE.selected;
  if(!dk) return;
  const rec = getDayRecordByDateKey(dk);
  const arr = Array.isArray(rec.expenses) ? rec.expenses : [];
  const item = arr[idx];
  if(!item) return;

  const label = item.store || '支出記録';
  if(!confirmDelete(`${label} を削除しますか？`)) return;

  const removedInfo = removeExpenseRecordAt(dk, idx);
  if(!removedInfo) return;
  renderAllRecordsTimeline();

  const saved = await med_saveAll();
  if(!saved){
    restoreExpenseRecordAt(dk, removedInfo.removed, removedInfo.index);
    renderAllRecordsTimeline();
    alert('記録削除の保存に失敗したため、削除を取り消しました');
    return;
  }

  if(getImageStoragePath(removedInfo.removed)){
    try{
      await removeImageStorageObject(removedInfo.removed);
    }catch(e){
      console.warn('Expense image storage delete failed; payload deletion was kept', {
        storagePath: getImageStoragePath(removedInfo.removed),
        error: e
      });
      alert('記録は削除しましたが、Storage上の画像削除に失敗しました。storagePathをconsoleに残しました。');
    }
  }
}

function formatExpenseRecordLabel(item){
  const parts = [];
  if(item.store) parts.push(item.store);
  if(item.category) parts.push(`[${item.category}]`);
  if(item.total !== null && item.total !== undefined) parts.push(`¥${Number(item.total).toLocaleString('ja-JP')}`);
  return parts.join(' ') || 'レシート';
}

function addSelfKindnessJournal(){ try{
  const textEl = $('selfKindnessText');
  const useTimeEl = $('selfKindnessUseTime');
  if(!textEl) return;

  const text = (textEl.value || '').trim();
  if(!text){ alert('内容を入力してください'); return; }

  const useTime = !useTimeEl || !!useTimeEl.checked;
  const iso = useTime ? new Date().toISOString() : null;

  addFreeRecordWithOptionalTime({
    seconds: 0,
    label: 'self-kindness journal',
    korean: text,
    startedAt: iso
  });

  textEl.value = '';
}catch(e){ console.warn('addSelfKindnessJournal failed', e); alert('記録に失敗しました'); }}

function addTongueRecord(){ try{
  const useTimeEl = $('tongueUseTime');
  const useTime = !useTimeEl || !!useTimeEl.checked;
  const iso = useTime ? new Date().toISOString() : null;

  addFreeRecordWithOptionalTime({
    seconds: 0,
    label: '舌',
    korean: '',
    startedAt: iso
  });
}catch(e){ console.warn('addTongueRecord failed', e); alert('記録に失敗しました'); }}

function addRohtoRecord(){ try{
  const useTimeEl = $('rohtoUseTime');
  const useTime = !useTimeEl || !!useTimeEl.checked;
  const iso = useTime ? new Date().toISOString() : null;

  addFreeRecordWithOptionalTime({
    seconds: 0,
    label: 'ロートV5',
    korean: '',
    startedAt: iso
  });
}catch(e){ console.warn('addRohtoRecord failed', e); alert('記録に失敗しました'); }}

function addFreeRecordWithOptionalTime({ seconds, label, korean, startedAt, periodDay, imageDataUrl, imageName, kind }){
  try{
    const dk = STATE.selected;
    if(!dk) return;
    const rec = getDayRecord(dk);
    rec.exercise = rec.exercise || { sessions: [], updatedAt: nowISO() };
    const sessions = Array.isArray(rec.exercise.sessions) ? rec.exercise.sessions.slice() : [];

    const item = {
      id: 'e'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
      type: (label || korean || 'record'),
      korean: korean || '',
      seconds: Number(seconds)||0,
      startedAt: startedAt || null,
      completedAt: null
    };

    const safeImage = toSafeImageDataUrl(imageDataUrl);
    if(safeImage){
      item.imageDataUrl = safeImage;
      item.kind = kind || 'mealImage';
      if(imageName) item.imageName = String(imageName).slice(0, 80);
      if(!item.type || item.type === 'record') item.type = '食事画像';
    }

    // optional metadata
    if(Number.isFinite(Number(periodDay))){
      item.periodDay = Math.max(1, Math.floor(Number(periodDay)));
      item.type = '生理';
    }

    sessions.push(item);
    rec.exercise.sessions = sessions;
    rec.exercise.updatedAt = nowISO();
    const mk = getMonthKey();
    STATE.payload.data[mk][dk] = rec;
    renderExerciseList();
    renderAllRecordsTimeline();
    med_saveAll();
    setMsg('記録しました');
  }catch(e){
    console.warn('addFreeRecordWithOptionalTime failed', e);
  }
}
