const SUPABASE_URL = 'https://jlkfvijgfrvoesazegnc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yfTwumo2INpAJIJRq7_WSA_ivenN96B';
const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
const ui = {
  login: document.getElementById('login-section'),
  main: document.getElementById('main-section'),
  status: document.getElementById('status'),
  form: document.getElementById('recurring-form'),
  title: document.getElementById('entry-title'),
  dates: document.getElementById('entry-dates'),
  weekdaysField: document.getElementById('weekdays-field'),
  datesField: document.getElementById('dates-field'),
  time: document.getElementById('entry-time'),
  today: document.getElementById('today-list'),
  all: document.getElementById('all-list'),
  signIn: document.getElementById('sign-in'),
  signOut: document.getElementById('sign-out')
};

let currentUser = null;
let payload = { data: {}, recurringRecords: [] };
let loadedUserId = null;
let loadPromise = null;
let loadPromiseUserId = null;
let isSaving = false;

function setStatus(message, kind = '') {
  ui.status.textContent = message;
  ui.status.className = `status${kind ? ` ${kind}` : ''}`;
}

function dateKeyFor(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthKeyFor(dateKey) {
  return dateKey.slice(0, 7);
}

function normalizePayload(raw) {
  const normalized = raw && typeof raw === 'object' && raw.data
    ? raw
    : { data: raw && typeof raw === 'object' ? raw : {} };
  if (!normalized.data || typeof normalized.data !== 'object') normalized.data = {};
  if (!Array.isArray(normalized.recurringRecords)) normalized.recurringRecords = [];
  return normalized;
}

function setAuthenticated(isAuthenticated) {
  document.body.dataset.auth = String(isAuthenticated);
  ui.login.style.display = isAuthenticated ? 'none' : 'block';
  ui.main.style.display = isAuthenticated ? 'block' : 'none';
  ui.signOut.style.display = isAuthenticated ? 'inline-block' : 'none';
}

async function loadPayload(userId) {
  setStatus('読み込み中...');
  const { data, error } = await supabaseClient
    .from('user_data')
    .select('payload')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (currentUser?.id !== userId) return;
  payload = normalizePayload(data?.payload);
  loadedUserId = userId;
  render();
  setStatus('');
}

function loadCurrentUserPayload() {
  const userId = currentUser?.id;
  if (!userId || loadedUserId === userId) return Promise.resolve();
  if (loadPromise && loadPromiseUserId === userId) return loadPromise;
  loadPromiseUserId = userId;
  loadPromise = loadPayload(userId).finally(() => {
    if (loadPromiseUserId === userId) {
      loadPromise = null;
      loadPromiseUserId = null;
    }
  });
  return loadPromise;
}

async function savePayload(successMessage) {
  if (isSaving) throw new Error('保存処理中です。');
  if (!currentUser) throw new Error('ログイン状態を確認できません。もう一度ログインしてください。');
  isSaving = true;
  setStatus('保存中...');
  try {
    const { data: existing, error: selectError } = await supabaseClient
      .from('user_data')
      .select('id')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (selectError) throw selectError;

    const result = existing
      ? await supabaseClient.from('user_data').update({ payload }).eq('id', existing.id)
      : await supabaseClient.from('user_data').insert({ user_id: currentUser.id, payload });
    if (result.error) throw result.error;
    render();
    setStatus(successMessage, 'success');
  } finally {
    isSaving = false;
  }
}

function weekdaySummary(days) {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return '毎日';
  return sorted.map(day => weekdays[day]).join('・');
}

function selectedScheduleMode() {
  return ui.form.querySelector('input[name="schedule-mode"]:checked')?.value || 'weekly';
}

function updateScheduleFields() {
  const useDates = selectedScheduleMode() === 'dates';
  ui.weekdaysField.hidden = useDates;
  ui.datesField.hidden = !useDates;
}

function parseSpecificDates(value) {
  const currentYear = new Date().getFullYear();
  const parts = value.split(/[,\n;]+/).map(part => part.trim()).filter(Boolean);
  const dates = [];
  for (const part of parts) {
    const match = part.match(/^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2}))$/);
    if (!match) return null;
    const year = Number(match[1] || currentYear);
    const month = Number(match[2] || match[4]);
    const day = Number(match[3] || match[5]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return [...new Set(dates)].sort();
}

function scheduleSummary(entry) {
  if (Array.isArray(entry.dates)) {
    return `日付指定: ${entry.dates.map(date => {
      const [year, month, day] = date.split('-');
      return `${year}/${Number(month)}/${Number(day)}`;
    }).join('、')}`;
  }
  return weekdaySummary(entry.weekdays);
}

function todayEntries(date) {
  const dateKey = dateKeyFor(date);
  return payload.recurringRecords
    .filter(entry => entry.active !== false && (
      Array.isArray(entry.dates)
        ? entry.dates.includes(dateKey)
        : Array.isArray(entry.weekdays) && entry.weekdays.includes(date.getDay())
    ))
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}

function todayHasRecord(entryId, dateKey) {
  const day = payload.data?.[monthKeyFor(dateKey)]?.[dateKey];
  const sessions = Array.isArray(day?.exercise?.sessions) ? day.exercise.sessions : [];
  return sessions.some(session => session.recurringId === entryId);
}

function createEntryCard(entry, dateKey, isToday) {
  const card = document.createElement('article');
  card.className = 'entry';

  const copy = document.createElement('div');
  copy.className = 'entry-copy';
  const title = document.createElement('div');
  title.className = 'entry-title';
  title.textContent = entry.title;
  const meta = document.createElement('div');
  meta.className = 'entry-meta';
  meta.textContent = `${scheduleSummary(entry)}${entry.time ? ` ・ ${entry.time}` : ''}${entry.active === false ? ' ・ 一時停止中' : ''}`;
  copy.append(title, meta);
  card.append(copy);

  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  if (isToday) {
    const recordButton = document.createElement('button');
    recordButton.type = 'button';
    const alreadyRecorded = todayHasRecord(entry.id, dateKey);
    recordButton.textContent = alreadyRecorded ? '記録済み' : '記録する';
    recordButton.disabled = alreadyRecorded;
    recordButton.className = 'record-button';
    recordButton.addEventListener('click', () => addTodayRecord(entry, dateKey));
    actions.append(recordButton);
  } else {
    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.textContent = entry.active === false ? '再開' : '一時停止';
    toggleButton.addEventListener('click', () => toggleEntry(entry.id));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-button';
    deleteButton.textContent = '削除';
    deleteButton.addEventListener('click', () => deleteEntry(entry.id));
    actions.append(toggleButton, deleteButton);
  }
  card.append(actions);
  return card;
}

function renderList(container, entries, dateKey, isToday, emptyMessage) {
  container.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = emptyMessage;
    container.append(empty);
    return;
  }
  entries.forEach(entry => container.append(createEntryCard(entry, dateKey, isToday)));
}

function render() {
  const now = new Date();
  const dateKey = dateKeyFor(now);
  const heading = document.getElementById('today-heading');
  heading.textContent = `今日の予定（${now.getMonth() + 1}月${now.getDate()}日）`;
  const due = todayEntries(now);
  renderList(ui.today, due, dateKey, true, '今日は予定されている項目がありません。');
  renderList(ui.all, payload.recurringRecords, dateKey, false, '繰り返し項目はまだ登録されていません。');
}

async function addTodayRecord(entry, dateKey) {
  if (isSaving) return;
  if (todayHasRecord(entry.id, dateKey)) {
    render();
    return;
  }
  const previousPayload = JSON.parse(JSON.stringify(payload));
  const monthKey = monthKeyFor(dateKey);
  payload.data[monthKey] = payload.data[monthKey] || {};
  const day = payload.data[monthKey][dateKey] || {};
  day.exercise = day.exercise || { sessions: [], updatedAt: new Date().toISOString() };
  const sessions = Array.isArray(day.exercise.sessions) ? day.exercise.sessions.slice() : [];
  const now = new Date().toISOString();
  sessions.push({
    id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    type: entry.title,
    korean: '',
    seconds: 0,
    startedAt: now,
    completedAt: null,
    recurringId: entry.id
  });
  day.exercise.sessions = sessions;
  day.exercise.updatedAt = now;
  payload.data[monthKey][dateKey] = day;
  try {
    await savePayload(`${entry.title}を記録しました`);
  } catch (error) {
    payload = previousPayload;
    render();
    setStatus(`記録の保存に失敗しました: ${error.message || error}`, 'error');
  }
}

async function persistEntryChange(successMessage, previousPayload) {
  try {
    await savePayload(successMessage);
  } catch (error) {
    payload = previousPayload;
    render();
    setStatus(`保存に失敗しました: ${error.message || error}`, 'error');
  }
}

function toggleEntry(entryId) {
  if (isSaving) return;
  const previousPayload = JSON.parse(JSON.stringify(payload));
  const entry = payload.recurringRecords.find(item => item.id === entryId);
  if (!entry) return;
  entry.active = entry.active === false;
  persistEntryChange(entry.active ? '項目を再開しました' : '項目を一時停止しました', previousPayload);
}

function deleteEntry(entryId) {
  if (isSaving) return;
  const entry = payload.recurringRecords.find(item => item.id === entryId);
  if (!entry || !window.confirm(`「${entry.title}」を削除しますか？`)) return;
  const previousPayload = JSON.parse(JSON.stringify(payload));
  payload.recurringRecords = payload.recurringRecords.filter(item => item.id !== entryId);
  persistEntryChange('項目を削除しました', previousPayload);
}

ui.form.addEventListener('submit', async event => {
  event.preventDefault();
  if (isSaving) return;
  const title = ui.title.value.trim();
  if (!title) {
    setStatus('記録する内容を入力してください。', 'error');
    return;
  }
  const scheduleMode = selectedScheduleMode();
  const entry = {
    id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    title,
    time: ui.time.value || '',
    active: true,
    createdAt: new Date().toISOString()
  };
  if (scheduleMode === 'dates') {
    const dates = parseSpecificDates(ui.dates.value);
    if (!dates?.length) {
      setStatus('日付を 11/18 または YYYY-MM-DD 形式で入力してください。複数の日付はカンマ区切りです。', 'error');
      return;
    }
    entry.dates = dates;
  } else {
    const selectedDays = [...ui.form.querySelectorAll('input[name="weekday"]:checked')]
      .map(input => Number(input.value))
      .filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
    if (!selectedDays.length) {
      setStatus('曜日を1つ以上選択してください。', 'error');
      return;
    }
    entry.weekdays = selectedDays;
  }
  const previousPayload = JSON.parse(JSON.stringify(payload));
  payload.recurringRecords.push(entry);
  try {
    await savePayload('繰り返し項目を登録しました');
    ui.form.reset();
    ui.form.querySelectorAll('input[name="weekday"]').forEach(input => { input.checked = true; });
    updateScheduleFields();
  } catch (error) {
    payload = previousPayload;
    render();
    setStatus(`登録に失敗しました: ${error.message || error}`, 'error');
  }
});

ui.form.querySelectorAll('input[name="schedule-mode"]').forEach(input => {
  input.addEventListener('change', updateScheduleFields);
});
updateScheduleFields();

ui.signIn.addEventListener('click', async () => {
  if (!supabaseClient) {
    setStatus('Supabaseに接続できません。ページを再読み込みしてください。', 'error');
    return;
  }
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${window.location.pathname}` }
    });
    if (error) setStatus(`ログインに失敗しました: ${error.message}`, 'error');
  } catch (error) {
    setStatus(`ログインに失敗しました: ${error.message || error}`, 'error');
  }
});

ui.signOut.addEventListener('click', async () => {
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) setStatus(`サインアウトに失敗しました: ${error.message}`, 'error');
  } catch (error) {
    setStatus(`サインアウトに失敗しました: ${error.message || error}`, 'error');
  }
});

if (!supabaseClient) {
  setAuthenticated(false);
  setStatus('Supabaseに接続できません。ページを再読み込みしてください。', 'error');
} else {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      loadedUserId = null;
      payload = { data: {}, recurringRecords: [] };
      setAuthenticated(false);
      return;
    }
    if (session?.user) {
      currentUser = session.user;
      setAuthenticated(true);
      window.setTimeout(() => {
        loadCurrentUserPayload().catch(error => {
          setStatus(`データの読み込みに失敗しました: ${error.message || error}`, 'error');
        });
      }, 0);
    }
  });

  supabaseClient.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    if (data.session?.user) {
      currentUser = data.session.user;
      setAuthenticated(true);
      return loadCurrentUserPayload();
    }
    setAuthenticated(false);
  }).catch(error => {
    setAuthenticated(false);
    setStatus(`ログイン状態を確認できません: ${error.message || error}`, 'error');
  });
}
