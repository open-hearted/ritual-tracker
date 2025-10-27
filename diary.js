// diary.js - minimal month diary with Google Sign-In and server-proxied storage
// idToken and userProfile: persist idToken to localStorage for 24 hours so reloads keep the session
let idToken = null; // kept in memory as primary runtime copy
let userProfile = null;
const STORAGE_KEY = 'diary_google_auth_v1';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const state = { year: new Date().getFullYear(), month: new Date().getMonth(), selected: null, diaryData: {} };

const $ = (id)=> document.getElementById(id);

// If legacy mojibake appears in the DOM (injected by cached scripts or extensions), remove it.
const _MOJIBAKE_SAMPLE = 'è¤æ¨è±å­';
function removeMojibakeNodes(){
  try{
    // exact id
    const byId = document.getElementById('userInfo');
    if(byId && byId.textContent && byId.textContent.indexOf(_MOJIBAKE_SAMPLE)!==-1){ byId.remove(); console.log('[diary] removed mojibake #userInfo'); }
    // any element containing the string
    const all = document.querySelectorAll('body *');
    for(const el of all){
      if(el && el.childNodes && el.childNodes.length>0){
        const t = el.textContent || '';
        if(t.indexOf(_MOJIBAKE_SAMPLE)!==-1){ el.remove(); console.log('[diary] removed mojibake element', el); }
      }
    }
  }catch(e){ /* ignore */ }
}

// observe DOM additions and prune mojibake occurrences (in case another script injects later)
try{
  const mo = new MutationObserver((mutations)=>{ removeMojibakeNodes(); });
  mo.observe(document.documentElement || document, { childList:true, subtree:true });
  // also run once now
  removeMojibakeNodes();
}catch(e){ /* ignore */ }

// Robust JWT payload parser that preserves UTF-8 characters (avoids mojibake)
function parseJwtPayload(token){
  try{
    const base64Url = token.split('.')[1] || '';
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    // atob gives a binary string; convert to bytes and decode as UTF-8
    const binary = atob(base64);
    const bytes = Uint8Array.from(Array.from(binary, c=>c.charCodeAt(0)));
    if(typeof TextDecoder !== 'undefined'){
      const json = new TextDecoder('utf-8').decode(bytes);
      return JSON.parse(json);
    } else {
      // fallback: percent-encode and decode
      const pct = Array.from(binary).map(c=>'%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('');
      return JSON.parse(decodeURIComponent(pct));
    }
  }catch(e){
    try{ return JSON.parse(atob(token.split('.')[1])); }catch{ return null; }
  }
}

async function initGSI(){
  // fetch public config (only google client id) from server
  try{
    const cfgRes = await fetch('/api/config');
    if(!cfgRes.ok){ $('gsiButtonContainer').textContent = 'GSI config error'; return; }
    const cfg = await cfgRes.json();
    const clientId = cfg.googleClientId || '';
    if(!clientId){ $('gsiButtonContainer').textContent = 'Google Client ID not set'; return; }
    // render Google Sign-In button
    if(window.google && google.accounts && google.accounts.id){
      google.accounts.id.initialize({ client_id: clientId, callback: handleCredentialResponse });
      google.accounts.id.renderButton($('gsiButtonContainer'), { theme: 'outline', size: 'large' });
      google.accounts.id.prompt();
    } else {
      $('gsiButtonContainer').textContent = 'Google sign-in not loaded';
    }
  }catch(e){
    console.error('initGSI error', e);
    $('gsiButtonContainer').textContent = 'GSI init error';
  }
}

function handleCredentialResponse(response){
  if(response && response.credential){
    idToken = response.credential;
    // decode minimal info from JWT payload without verifying here (server verifies later)
    try{
    const payload = parseJwtPayload(response.credential) || {};
    userProfile = { email: payload.email, name: payload.name };
    // userInfo display suppressed (do not write name to DOM to avoid mojibake)
  // hide the GSI button when signed in and show sign-out control
  const gsi = $('gsiButtonContainer'); if(gsi) gsi.style.display = 'none';
  const so = $('signOutBtn'); if(so) so.style.display = 'inline-block';
  // reveal diary UI for authenticated users
  try{ updateUiForAuth(true); }catch{}
      // persist token + profile with expiry so reloads keep session for 24h
      try{
        const rec = { idToken, userProfile, ts: Date.now() };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
      }catch(e){ console.warn('could not persist token', e); }
      loadMonth();
    }catch(e){
      console.warn('could not parse token payload');
    }
  }
}

// Show/hide diary UI based on authentication state
function updateUiForAuth(isAuth){
  const cal = $('calGrid');
  const diaryArea = $('diaryArea');
  const prev = $('prevBtn');
  const next = $('nextBtn');
  const today = $('todayBtn');
  const monthLabel = $('monthLabel');
  const saveBtn = $('saveBtn');
  if(!isAuth){
    if(cal) cal.style.display = 'none';
    if(diaryArea) diaryArea.style.display = 'none';
    if(prev) prev.style.display = 'none';
    if(next) next.style.display = 'none';
    if(today) today.style.display = 'none';
    if(monthLabel) monthLabel.style.display = 'none';
    if(saveBtn) saveBtn.disabled = true;
    setMsg('ログインが必要です。Googleでログインしてください。');
  } else {
    if(cal) cal.style.display = '';
    if(diaryArea) diaryArea.style.display = '';
    if(prev) prev.style.display = '';
    if(next) next.style.display = '';
    if(today) today.style.display = '';
    if(monthLabel) monthLabel.style.display = '';
    if(saveBtn) saveBtn.disabled = false;
    setMsg('');
  }
}

function prevMonth(){ state.month--; if(state.month<0){ state.month=11; state.year--; } renderCalendar(); loadMonth(); }
function nextMonth(){ state.month++; if(state.month>11){ state.month=0; state.year++; } renderCalendar(); loadMonth(); }

function getMonthKey(){ return `${state.year}-${String(state.month+1).padStart(2,'0')}`; }

async function loadMonth(){
  if(!idToken) { setMsg('ログインしてください'); return; }
  setMsg('読み込み中...');
  try{
    const res = await fetch('/api/diary-get', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ idToken, monthKey: getMonthKey() }) });
    if(!res.ok){ setMsg('読み込みに失敗しました'); return; }
    const json = await res.json();
    state.diaryData = json.data || {};
    renderCalendar();
    setMsg('読み込み完了');
  }catch(e){ console.error(e); setMsg('通信エラー'); }
}

async function saveDay(){
  if(!idToken) { setMsg('ログインしてください'); return; }
  const sel = state.selected; if(!sel) { setMsg('日付を選択してください'); return; }
  // write to month object and send entire month JSON to server
  const mk = getMonthKey();
  const monthObj = state.diaryData || {};
  monthObj[sel] = { text: $('diaryText').value || '' };
  setMsg('保存中...');
  try{
    const res = await fetch('/api/diary-put', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ idToken, monthKey: mk, data: monthObj }) });
    if(!res.ok){ setMsg('保存に失敗しました'); return; }
    const j = await res.json();
    if(j.ok){ state.diaryData = monthObj; renderCalendar(); setMsg('保存完了'); }
    else setMsg('保存失敗');
  }catch(e){ console.error(e); setMsg('通信エラー'); }
}

function renderCalendar(){
  const grid = $('calGrid'); grid.innerHTML='';
  $('monthLabel').textContent = `${state.year}年 ${state.month+1}月`;
  const start = new Date(state.year, state.month, 1).getDay();
  const days = new Date(state.year, state.month+1,0).getDate();
  // pad for Sunday-start calendar
  for(let i=0;i<start;i++){ const p=document.createElement('div'); p.className='cell'; p.style.visibility='hidden'; grid.appendChild(p); }
  for(let d=1; d<=days; d++){
    const btn = document.createElement('button'); btn.type='button'; btn.className='cell';
    const dk = `${state.year}-${String(state.month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    // add a machine-readable date attribute so other scripts can target cells reliably
    btn.setAttribute('data-date', dk);
    const has = (state.diaryData && state.diaryData[dk] && state.diaryData[dk].text && state.diaryData[dk].text.length>0);
    if(has) btn.setAttribute('data-has','1');
    // mark today if this cell corresponds to today's date in the current viewed month
    const today = new Date();
    if(today.getFullYear() === state.year && today.getMonth() === state.month && today.getDate() === d){
      btn.classList.add('today');
    }
    btn.textContent = d;
    btn.addEventListener('click', ()=>{ state.selected = dk; $('selectedDate').textContent = dk; $('diaryText').value = (state.diaryData[dk] && state.diaryData[dk].text) || ''; });
    grid.appendChild(btn);
  }

}

// expose a helper for UI buttons to jump to today
window.jumpToToday = function(){
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const el = document.querySelector(`.cell[data-date="${key}"]`);
  if(el){ el.click(); el.scrollIntoView({ block:'nearest' }); }
  else {
    // not in view: change calendar to current month then select
    state.year = now.getFullYear(); state.month = now.getMonth(); renderCalendar();
    setTimeout(()=>{ const e2 = document.querySelector(`.cell[data-date="${key}"]`); if(e2){ e2.click(); e2.scrollIntoView({ block:'nearest' }); } }, 50);
  }

}

function setMsg(s){ $('msg').textContent = s; }

window.addEventListener('load', ()=>{
  // optionally let server-side inject GOOGLE_CLIENT_ID into page by setting window.GOOGLE_CLIENT_ID before script runs
  // fallback to env not available on client
  // hide authenticated UI by default until we confirm a restored token or successful sign-in
  try{ updateUiForAuth(false); }catch{}
  initGSI();
  // try to restore persisted token (if within TTL)
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const rec = JSON.parse(raw);
      if(rec && rec.idToken && rec.ts && (Date.now() - rec.ts) < TOKEN_TTL_MS){
        idToken = rec.idToken;
  // prefer decoding fresh profile from the token to avoid stored mojibake
  const parsed = parseJwtPayload(idToken);
  userProfile = parsed ? { email: parsed.email, name: parsed.name } : (rec.userProfile || null);
  // userInfo display suppressed (do not write name to DOM to avoid mojibake)
        // show sign-out and hide gsi button when restored
        const gsi = $('gsiButtonContainer'); if(gsi) gsi.style.display = 'none';
        const so = $('signOutBtn'); if(so) so.style.display = 'inline-block';
  // reveal diary UI and kick off loading the month automatically when token restored
  try{ updateUiForAuth(true); }catch{}
      // persist corrected userProfile back to storage to avoid mojibake on next load
      try{ rec.userProfile = userProfile; localStorage.setItem(STORAGE_KEY, JSON.stringify(rec)); }catch{}
      loadMonth();
      } else {
        // expired or malformed
        try{ localStorage.removeItem(STORAGE_KEY); }catch{}
      }
    }
  }catch(e){ console.warn('could not restore stored auth', e); }
  $('prevBtn').addEventListener('click', prevMonth);
  $('nextBtn').addEventListener('click', nextMonth);
  $('saveBtn').addEventListener('click', saveDay);
  const so = $('signOutBtn'); if(so) so.addEventListener('click', ()=>{ window.diarySignOut(); const g = $('gsiButtonContainer'); if(g) g.style.display='block'; so.style.display='none'; });
  renderCalendar();
});

// optional helper to sign out locally (clears persisted token)
window.diarySignOut = function(){ idToken = null; userProfile = null; try{ localStorage.removeItem(STORAGE_KEY);}catch{}; /* userInfo not displayed */ setMsg('サインアウトしました'); try{ updateUiForAuth(false); }catch{}; const g = $('gsiButtonContainer'); if(g) g.style.display='block'; const soBtn = $('signOutBtn'); if(soBtn) soBtn.style.display='none'; };
