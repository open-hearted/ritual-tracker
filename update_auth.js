const fs = require('fs');
let content = fs.readFileSync('meditation-cloud.js', 'utf8');

const authStart = content.indexOf('function parseJwtPayload');
const authEnd = content.indexOf('function setMsg(s)');

if (authStart > -1 && authEnd > -1) {
  const newAuthCode = \let idToken = null; // Backend API compatibility
let userProfile = null;
let currentUser = null;

function forceSignOut(message){
  idToken = null;
  userProfile = null;
  currentUser = null;
  try{ localStorage.removeItem(STORAGE_KEY); }catch{}
  updateUiForAuth(false);
  try{ const ed = medEditor; if(ed) ed.style.display='none'; }catch{}
  setMsg(message || 'ログインしてください');
}

function ensureAuthOrSignOut(){
  if(!currentUser){ setMsg('ログインしてください'); return false; }
  return true;
}

// Supabaseのセッションを復元・監視する
async function initSupabaseAuth(){
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (session) {
    currentUser = session.user;
    idToken = session.access_token; // fetchでAPI通信する互換用
    updateUiForAuth(true);
    med_loadAll().then(()=>{ try{ maybeOpenInitialDate(); }catch(e){} });
  } else {
    updateUiForAuth(false);
  }

  // ログイン・ログアウトの監視
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      idToken = session.access_token; // fetchでAPI通信する互換用
      updateUiForAuth(true);
      med_loadAll().then(()=>{ try{ maybeOpenInitialDate(); }catch(e){} });
    } else if (event === 'SIGNED_OUT') {
      forceSignOut('サインアウトしました');
    }
  });
}

function updateUiForAuth(isAuth){
  const calCard = document.querySelector('.card.cal-card');
  const loginBtn = supabaseLoginBtn;
  const so = signOutBtn;
  const ed = medEditor;
  const openMonthly = openMonthly;
  // Ensure page-level auth state is reflected so CSS can hide/show elements reliably
  try{ document.body.setAttribute('data-auth', isAuth ? 'true' : 'false'); }catch(e){}
  if(!isAuth){
    if(calCard) calCard.style.display='none';
    if(openMonthly) openMonthly.style.display='none';
    // Daily page shows the editor inline; ensure it stays hidden when signed out.
    if(ed && isDailyPage()) ed.style.display='none';
    if(loginBtn) loginBtn.style.display='inline-block'; // ボタンを表示
    if(so) so.style.display='none';
  }
  else {
    if(calCard) calCard.style.display='';
    if(openMonthly) openMonthly.style.display='';
    // Clear inline style so page CSS can take over.
    if(ed && isDailyPage()) ed.style.display='';
    if(loginBtn) loginBtn.style.display='none';
    if(so) so.style.display='inline-block';
  }
}

\;
  content = content.substring(0, authStart) + newAuthCode + content.substring(authEnd);
  
  // Replace the event listeners
  content = content.replace('tryRestore();', '');
  content = content.replace('initGSI();', 'initSupabaseAuth();');

  // Also replace the signOut logic that's wired to DOM
  const domLoadedMatch = content.indexOf('document.addEventListener(\\'DOMContentLoaded\\', (ev)=>{');
  if (domLoadedMatch > -1) {
    const signOutBtnOld = \const signOutBtn = signOutBtn;
  if(signOutBtn) signOutBtn.addEventListener('click', ()=>{ forceSignOut('サインアウト'); });\;
    const signOutBtnOld2 = \const signOutBtn = signOutBtn;
  if(signOutBtn) signOutBtn.addEventListener('click', ()=>{ forceSignOut('繧ｵ繧繝ｳ繧繧繝・'); });\; // with mojibake
  
    // We'll just do a more robust regex hook up for supabase auth
    const updatedHook = \
  const loginBtn = supabaseLoginBtn;
  if(loginBtn) loginBtn.addEventListener('click', () => { 
    supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } }); 
  });
  
  const signOutBtn = signOutBtn;
  if(signOutBtn) signOutBtn.addEventListener('click', () => { supabaseClient.auth.signOut(); });
\;
    // We'll just append it right after DOMContentLoaded event starts just to be safe
    content = content.replace('document.addEventListener(\\'DOMContentLoaded\\', (ev)=>{', 'document.addEventListener(\\'DOMContentLoaded\\', (ev)=>{' + updatedHook);
  }
  
  fs.writeFileSync('meditation-cloud.js', content, 'utf8');
  console.log('Successfully updated meditation-cloud.js auth logic.');
} else {
  console.log('Could not find auth bounds.');
}
