// diary.js - minimal month diary with Google Sign-In and server-proxied storage
let idToken = null; // kept in memory only
let userProfile = null;
const state = { year: new Date().getFullYear(), month: new Date().getMonth(), selected: null, diaryData: {} };

const $ = (id)=> document.getElementById(id);

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
      const payload = JSON.parse(atob(response.credential.split('.')[1]));
      userProfile = { email: payload.email, name: payload.name };
      $('userInfo').textContent = userProfile.name || userProfile.email;
      loadMonth();
    }catch(e){
      console.warn('could not parse token payload');
    }
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
  initGSI();
  $('prevBtn').addEventListener('click', prevMonth);
  $('nextBtn').addEventListener('click', nextMonth);
  $('saveBtn').addEventListener('click', saveDay);
  renderCalendar();
});
