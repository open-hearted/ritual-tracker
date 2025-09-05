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
      renderStats();
    });
    grid.appendChild(el);
  }

  renderStats();
  adjustCalendarSize();
}

function renderStats(){
  const box = $('stats'); box.innerHTML = '';
  const md = readMonth(state.uid, state.year, state.month);
  const keys = Object.keys(md);
  const attended = keys.filter(k => md[k] === 1).length;
  const total = daysInMonth(state.year, state.month);
  const rate = total ? Math.round(attended*100/total) : 0;
  const streak = calcStreak(md);

  box.append(
    makeStat(`今月の出席日数: <b>${attended}</b> / ${total}日 (${rate}%)`),
    makeStat(`連続出席（今月内）: <b>${streak}</b> 日`),
  );
  renderFinanceStats(attended);
}

function makeStat(html){ const d=document.createElement('div'); d.className='stat'; d.innerHTML=html; return d; }

function calcStreak(monthObj){
  // count max consecutive 1s up to today within this calendar month order
  const days = [];
  const {year, month} = state;
  const total = daysInMonth(year, month);
  for(let d=1; d<=total; d++){
    const dk = getDateKey(year, month, d);
    days.push(monthObj[dk] === 1 ? 1 : 0);
  }
  let best=0, cur=0;
  for(const v of days){ cur = v ? cur+1 : 0; if(cur>best) best=cur; }
  return best;
}

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
function getS3Cfg(){ try{return JSON.parse(localStorage.getItem(LS_S3))||{};}catch{return{}} }
function saveS3Cfg(v){ localStorage.setItem(LS_S3, JSON.stringify(v)); }

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
    alert('S3へ保存しました');
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
    alert('S3から復元しました');
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