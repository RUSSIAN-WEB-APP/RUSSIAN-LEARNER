/*
  Russian Learner
  Static web app + optional Supabase cloud sync.
  Everything in this file is browser-side by design.
*/

(() => {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const SUPABASE_READY = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase);
  const sb = SUPABASE_READY ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : null;

  const STORAGE = {
    data: 'russianLearnerDataV1',
    settings: 'russianLearnerSettingsV1',
    mode: 'russianLearnerModeV1'
  };

  // Russian-as-a-foreign-language lexical milestones. The A1-A2-B1-B2-C1
  // values are mapped from published RKI vocabulary minima; C2 is deliberately
  // presented only as an app estimate because a single vocabulary count cannot
  // certify CEFR C2 proficiency.
  const LEVELS = [
    { level: 'A1', words: 780 },
    { level: 'A2', words: 1300 },
    { level: 'B1', words: 2300 },
    { level: 'B2', words: 5000 },
    { level: 'C1', words: 9000 },
    { level: 'C2', words: 12000 }
  ];

  const DEFAULT_SETTINGS = { dailyGoal: 20 };
  let state = {
    mode: localStorage.getItem(STORAGE.mode) || (SUPABASE_READY ? 'cloud' : 'local'),
    user: null,
    vocabulary: [],
    events: [],
    settings: loadJSON(STORAGE.settings, DEFAULT_SETTINGS),
    reviewQueue: [],
    reviewIndex: 0,
    currentReview: null,
    currentRevealed: false,
    activeReviewExercise: 'flashcard'
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }

  function saveLocal() {
    localStorage.setItem(STORAGE.data, JSON.stringify({ vocabulary: state.vocabulary, events: state.events }));
    localStorage.setItem(STORAGE.settings, JSON.stringify(state.settings));
  }

  function loadLocal() {
    const data = loadJSON(STORAGE.data, { vocabulary: [], events: [] });
    state.vocabulary = Array.isArray(data.vocabulary) ? data.vocabulary : [];
    state.events = Array.isArray(data.events) ? data.events : [];
  }

  function toast(message, type = 'info') {
    const el = $('toast');
    el.textContent = message;
    el.dataset.type = type;
    el.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizeWord(s) {
    return String(s || '').trim().toLowerCase().replace(/[.,!?;:()\[\]{}«»"'“”]/g, '');
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) {
      toast('Speech synthesis is not available in this browser.', 'error');
      return;
    }
    const value = String(text || '').trim();
    if (!value) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(value);
    u.lang = 'ru-RU';
    u.rate = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const ru = voices.find(v => /^ru(-|_|$)/i.test(v.lang));
    if (ru) u.voice = ru;
    window.speechSynthesis.speak(u);
  }

  function getWordCount() {
    const tokens = new Set();
    state.vocabulary.filter(x => x.source_type === 'word').forEach(item => {
      const token = normalizeWord(item.russian);
      if (token) tokens.add(token);
    });
    return tokens.size;
  }

  function getLevelInfo(wordCount) {
    let current = { level: 'A0', words: 0 };
    let next = LEVELS[0];
    for (const item of LEVELS) {
      if (wordCount >= item.words) current = item;
      else { next = item; break; }
      next = null;
    }
    if (!next && current.level === 'C2') return { current, next: null, progress: 100 };
    const lower = current.words || 0;
    const upper = next ? next.words : current.words;
    const progress = next ? Math.min(100, Math.max(0, ((wordCount - lower) / (upper - lower)) * 100)) : 100;
    return { current, next, progress };
  }

  function isDue(item) {
    return !item.due_at || new Date(item.due_at).getTime() <= Date.now();
  }

  function masteryPercent(item) {
    const reps = Number(item.repetitions || 0);
    const ease = Number(item.ease || 2.5);
    const lapses = Number(item.lapses || 0);
    const raw = Math.min(100, reps * 14 + Math.max(0, ease - 2.3) * 15 - lapses * 8);
    return Math.max(0, Math.round(raw));
  }

  function mastered(item) {
    return masteryPercent(item) >= 75 && Number(item.repetitions || 0) >= 4;
  }

  function todayKey(d = new Date()) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
  }

  function formatDate(dateLike) {
    if (!dateLike) return '—';
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDue(item) {
    if (!item.due_at) return 'Now';
    const t = new Date(item.due_at).getTime();
    const diff = t - Date.now();
    if (diff <= 0) return 'Due now';
    const mins = Math.round(diff / 60000);
    if (mins < 60) return `in ${mins} min`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `in ${hrs}h`;
    return `in ${Math.round(hrs / 24)}d`;
  }

  function estimatedMasteryText(item) {
    const p = masteryPercent(item);
    if (p < 20) return 'New';
    if (p < 50) return 'Learning';
    if (p < 75) return 'Familiar';
    return 'Mastered';
  }

  async function bootstrap() {
    bindEvents();
    if (SUPABASE_READY && state.mode !== 'local') {
      try {
        const { data } = await sb.auth.getSession();
        state.user = data.session?.user || null;
        if (state.user) {
          state.mode = 'cloud';
          showApp();
          await loadCloudData();
        } else {
          showAuth();
        }
        sb.auth.onAuthStateChange(async (_event, session) => {
          state.user = session?.user || null;
          if (state.user) {
            state.mode = 'cloud';
            showApp();
            await loadCloudData();
          } else if (state.mode === 'cloud') {
            showAuth();
          }
        });
      } catch (err) {
        console.error(err);
        state.mode = 'local';
        loadLocal();
        showApp();
        toast('Cloud setup could not be loaded. Local mode is active.', 'error');
      }
    } else {
      state.mode = 'local';
      loadLocal();
      showApp();
    }
  }

  function bindEvents() {
    $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
    $$('[data-view-jump]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.viewJump)));

    $('tab-login').addEventListener('click', () => setAuthMode('login'));
    $('tab-signup').addEventListener('click', () => setAuthMode('signup'));
    $('tab-local').addEventListener('click', () => setAuthMode('local'));
    $('auth-form').addEventListener('submit', handleAuthSubmit);
    $('local-start').addEventListener('click', () => { state.mode = 'local'; localStorage.setItem(STORAGE.mode, 'local'); loadLocal(); showApp(); });
    $('logout').addEventListener('click', handleLogout);

    $('vocab-form').addEventListener('submit', handleAddVocabulary);
    $('v-clear').addEventListener('click', () => $('vocab-form').reset());
    $('search').addEventListener('input', renderVocabularyList);
    $('filter-category').addEventListener('change', renderVocabularyList);
    $('sort-vocab').addEventListener('change', renderVocabularyList);

    $('review-reveal').addEventListener('click', revealReview);
    $('review-speak').addEventListener('click', () => speak($('review-russian').textContent));
    $$('.grade').forEach(btn => btn.addEventListener('click', () => gradeReview(btn.dataset.grade)));
    $('new-phrase').addEventListener('click', renderGeneratedPhrase);
    $('phrase-speak').addEventListener('click', () => speak($('generated-phrase').textContent));
    $('export-data').addEventListener('click', exportData);
    $('import-data').addEventListener('change', importData);
    $('save-settings').addEventListener('click', saveSettings);
    $('test-voice').addEventListener('click', () => speak('Привет! Как дела? Я изучаю русский язык.'));
    $('clear-local').addEventListener('click', () => {
      if (confirm('Clear this browser\'s local cached data? Cloud data will not be deleted.')) {
        localStorage.removeItem(STORAGE.data);
        loadLocal();
        if (state.mode === 'local') renderAll();
        toast('Local cache cleared.', 'success');
      }
    });
    $('speak-current').addEventListener('click', () => {
      const text = state.currentReview?.russian || $('generated-phrase').textContent || '';
      speak(text);
    });
  }

  function setAuthMode(mode) {
    $$('.tab').forEach(x => x.classList.remove('active'));
    if (mode === 'local') {
      $('tab-local').classList.add('active');
      $('auth-form').classList.add('hidden');
      $('local-login').classList.remove('hidden');
      $('auth-message').textContent = 'Local mode is private to this browser.';
    } else {
      $(mode === 'login' ? 'tab-login' : 'tab-signup').classList.add('active');
      $('auth-form').classList.remove('hidden');
      $('local-login').classList.add('hidden');
      $('auth-submit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
      $('auth-form').dataset.mode = mode;
      $('password-label').querySelector('span').textContent = mode === 'login' ? 'Password' : 'Password (6+ characters)';
      $('auth-message').textContent = SUPABASE_READY ? '' : 'Cloud login is not configured yet. Use local mode or complete the Supabase setup in the README.';
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    if (!SUPABASE_READY) {
      toast('Supabase is not configured. Use local mode for now.', 'error');
      return;
    }
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const mode = $('auth-form').dataset.mode || 'login';
    $('auth-submit').disabled = true;
    try {
      const result = mode === 'login'
        ? await sb.auth.signInWithPassword({ email, password })
        : await sb.auth.signUp({ email, password });
      if (result.error) throw result.error;
      if (mode === 'signup' && !result.data.session) {
        $('auth-message').textContent = 'Account created. Check your email if confirmation is enabled, then sign in.';
      } else {
        toast('Signed in.', 'success');
      }
    } catch (err) {
      $('auth-message').textContent = err.message || 'Authentication failed.';
    } finally {
      $('auth-submit').disabled = false;
    }
  }

  async function handleLogout() {
    if (state.mode === 'cloud' && sb) await sb.auth.signOut();
    state.user = null;
    state.mode = SUPABASE_READY ? 'cloud' : 'local';
    showAuth();
  }

  function showAuth() {
    $('auth-screen').classList.remove('hidden');
    $('app').classList.add('hidden');
    if (!SUPABASE_READY) setAuthMode('local'); else setAuthMode('login');
  }

  function showApp() {
    $('auth-screen').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('user-label').textContent = state.mode === 'cloud' ? (state.user?.email || 'Cloud account') : 'Local mode';
    $('setting-goal').value = state.settings.dailyGoal || 20;
    renderAll();
  }

  function showView(view) {
    $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    $$('.view').forEach(v => v.classList.remove('active-view'));
    const target = $(`view-${view}`);
    if (target) target.classList.add('active-view');
    if (view === 'dashboard') renderDashboard();
    if (view === 'vocabulary') renderVocabularyList();
    if (view === 'review') startReviewIfNeeded();
    if (view === 'phrases') renderGeneratedPhrase();
    if (view === 'progress') renderProgress();
  }

  function renderAll() {
    renderDashboard();
    renderVocabularyList();
    renderProgress();
    renderLevelTable();
    renderGeneratedPhrase();
    updateReviewBadge();
  }

  function renderDashboard() {
    const total = state.vocabulary.length;
    const words = state.vocabulary.filter(x => x.source_type === 'word').length;
    const due = state.vocabulary.filter(isDue).length;
    const totalReviews = state.events.length;
    const correct = state.events.filter(e => e.correct).length;
    const accuracy = totalReviews ? Math.round(correct / totalReviews * 100) : 0;
    $('stat-total').textContent = total;
    $('stat-words').textContent = words;
    $('stat-due').textContent = due;
    $('stat-accuracy').textContent = `${accuracy}%`;
    $('today-due').textContent = due;
    const today = todayKey();
    $('today-completed').textContent = state.events.filter(e => todayKey(new Date(e.created_at)) === today).length;
    $('streak-count').textContent = calculateStreak();
    $('setting-goal').value = state.settings.dailyGoal || 20;

    const count = getWordCount();
    const level = getLevelInfo(count);
    $('level-pill').textContent = level.current.level;
    $('level-meter-fill').style.width = `${level.progress}%`;
    $('level-count').textContent = `${count.toLocaleString()} unique word entries`;
    $('level-next').textContent = level.next ? `${Math.max(0, level.next.words - count).toLocaleString()} to ${level.next.level}` : 'Top app milestone reached';

    const recent = [...state.vocabulary].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
    $('recent-list').innerHTML = recent.length ? recent.map(item => `
      <div class="recent-item"><div><strong>${escapeHTML(item.russian)}</strong><span>${escapeHTML(item.english || '—')}</span></div><div class="recent-right"><span class="chip">${escapeHTML(item.category)}</span><span class="muted tiny">${formatDate(item.created_at)}</span></div></div>`).join('') : '<div class="empty-inline">No vocabulary yet. Add your first Russian word above.</div>';
  }

  function renderVocabularyList() {
    const q = $('search').value.trim().toLowerCase();
    const category = $('filter-category').value;
    const sort = $('sort-vocab').value;
    let items = [...state.vocabulary].filter(item => {
      const hay = `${item.russian} ${item.english} ${item.category} ${item.notes}`.toLowerCase();
      return (!q || hay.includes(q)) && (!category || item.category === category);
    });
    if (sort === 'newest') items.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    if (sort === 'due') items.sort((a,b) => new Date(a.due_at || 0) - new Date(b.due_at || 0));
    if (sort === 'mastery') items.sort((a,b) => masteryPercent(b) - masteryPercent(a));
    if (sort === 'az') items.sort((a,b) => a.russian.localeCompare(b.russian, 'ru'));

    const cats = [...new Set(state.vocabulary.map(x => x.category).filter(Boolean))].sort();
    const current = $('filter-category').value;
    $('filter-category').innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option ${c === current ? 'selected' : ''}>${escapeHTML(c)}</option>`).join('');

    $('vocab-list').innerHTML = items.length ? items.map(item => `
      <div class="vocab-row" data-id="${item.id}">
        <div class="vocab-main"><button class="mini-speak" title="Pronounce" data-speak="${encodeURIComponent(item.russian)}">🔊</button><div><strong>${escapeHTML(item.russian)}</strong><span>${escapeHTML(item.english || 'No English meaning entered')}</span>${item.notes ? `<small>${escapeHTML(item.notes)}</small>` : ''}</div></div>
        <div class="vocab-meta"><span class="chip">${escapeHTML(item.category)}</span><span class="mastery ${estimatedMasteryText(item).toLowerCase()}">${estimatedMasteryText(item)}</span><span class="tiny muted">${formatDue(item)}</span><button class="delete-btn" title="Delete" data-delete="${item.id}">×</button></div>
      </div>`).join('') : '<div class="empty-inline">No matching vocabulary.</div>';

    $$('[data-speak]').forEach(btn => btn.addEventListener('click', () => speak(decodeURIComponent(btn.dataset.speak))));
    $$('[data-delete]').forEach(btn => btn.addEventListener('click', () => deleteVocabulary(btn.dataset.delete)));
  }

  async function handleAddVocabulary(e) {
    e.preventDefault();
    const russian = $('v-russian').value.trim();
    const english = $('v-english').value.trim();
    const category = $('v-category').value;
    const source_type = $('v-type').value;
    const notes = $('v-notes').value.trim();
    if (!russian) return;
    const duplicate = state.vocabulary.find(x => normalizeWord(x.russian) === normalizeWord(russian) && normalizeWord(x.english) === normalizeWord(english));
    if (duplicate) { toast('That vocabulary item is already saved.', 'error'); return; }
    const item = {
      id: uid(), user_id: state.user?.id || 'local', russian, english, category, source_type, notes,
      repetitions: 0, mastery: 0, ease: 2.5, interval_days: 0, due_at: new Date().toISOString(),
      last_review_at: null, lapses: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    };
    try {
      if (state.mode === 'cloud') {
        const payload = { ...item };
        delete payload.id;
        const { data, error } = await sb.from('vocabulary').insert(payload).select().single();
        if (error) throw error;
        state.vocabulary.unshift(data);
      } else {
        state.vocabulary.unshift(item);
        saveLocal();
      }
      $('vocab-form').reset();
      toast('Vocabulary saved.', 'success');
      renderAll();
      showView('vocabulary');
    } catch (err) {
      console.error(err);
      toast(`Could not save: ${err.message}`, 'error');
    }
  }

  async function deleteVocabulary(id) {
    const item = state.vocabulary.find(x => x.id === id);
    if (!item || !confirm(`Delete “${item.russian}”?`)) return;
    try {
      if (state.mode === 'cloud') {
        const { error } = await sb.from('vocabulary').delete().eq('id', id);
        if (error) throw error;
      }
      state.vocabulary = state.vocabulary.filter(x => x.id !== id);
      state.events = state.events.filter(e => e.vocabulary_id !== id);
      saveLocal();
      renderAll();
      toast('Vocabulary deleted.', 'success');
    } catch (err) { toast(`Could not delete: ${err.message}`, 'error'); }
  }

  function updateReviewBadge() {
    const due = state.vocabulary.filter(isDue).length;
    $('review-badge').textContent = due;
  }

  function startReviewIfNeeded() {
    const due = state.vocabulary.filter(isDue).sort((a,b) => new Date(a.due_at || 0) - new Date(b.due_at || 0));
    state.reviewQueue = due.slice(0, 50);
    state.reviewIndex = 0;
    if (!state.reviewQueue.length) {
      $('review-empty').classList.remove('hidden');
      $('review-card-wrap').classList.add('hidden');
      $('review-counter').textContent = '0 due';
      return;
    }
    $('review-empty').classList.add('hidden');
    $('review-card-wrap').classList.remove('hidden');
    loadCurrentReview();
  }

  function chooseExercise(item) {
    const m = masteryPercent(item);
    if (m < 30) return 'recognition';
    if (m < 65) return 'translation';
    if (m < 90) return 'recall';
    return 'phrase';
  }

  function loadCurrentReview() {
    const item = state.reviewQueue[state.reviewIndex];
    if (!item) { startReviewIfNeeded(); return; }
    state.currentReview = item;
    state.currentRevealed = false;
    state.activeReviewExercise = chooseExercise(item);
    $('review-russian').textContent = item.russian;
    $('review-category-label').textContent = item.category;
    $('review-type-label').textContent = state.activeReviewExercise === 'recognition' ? 'Recognition' : state.activeReviewExercise === 'translation' ? 'Translate' : state.activeReviewExercise === 'recall' ? 'Recall' : 'Phrase practice';
    $('review-prompt').textContent = state.activeReviewExercise === 'recognition' ? 'What does this mean?' : state.activeReviewExercise === 'translation' ? 'Translate the Russian into English.' : state.activeReviewExercise === 'recall' ? 'Say the meaning out loud, then reveal.' : 'Think of a sentence using this item, then reveal.';
    $('review-answer').textContent = item.english || item.notes || 'No English meaning saved for this item.';
    $('review-answer').classList.add('hidden');
    $('review-feedback').textContent = state.activeReviewExercise === 'phrase' ? buildPhraseForItem(item) : '';
    $('review-reveal').classList.remove('hidden');
    $('review-grading').classList.add('hidden');
    $('review-counter').textContent = `${state.reviewIndex + 1} / ${state.reviewQueue.length}`;
  }

  function revealReview() {
    state.currentRevealed = true;
    $('review-answer').classList.remove('hidden');
    $('review-reveal').classList.add('hidden');
    $('review-grading').classList.remove('hidden');
  }

  function buildPhraseForItem(item) {
    const words = state.vocabulary.filter(x => x.source_type === 'word' && x.id !== item.id);
    const other = words.find(x => masteryPercent(x) > 20) || words[0];
    if (!other) return 'Add another word and the app can combine your vocabulary in the Phrase Lab.';
    return `Practice: ${item.russian} • ${other.russian}`;
  }

  function scheduleNext(item, grade) {
    let reps = Number(item.repetitions || 0);
    let ease = Number(item.ease || 2.5);
    let interval = Number(item.interval_days || 0);
    let lapses = Number(item.lapses || 0);
    if (grade === 'again') {
      reps = 0;
      lapses += 1;
      interval = 10 / 1440; // 10 minutes
      ease = Math.max(1.3, ease - 0.20);
    } else if (grade === 'hard') {
      reps += 1;
      interval = Math.max(0.5, interval ? interval * 1.2 : 0.5);
      ease = Math.max(1.5, ease - 0.05);
    } else if (grade === 'good') {
      reps += 1;
      interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.max(4, interval * ease);
      ease = Math.min(3.2, ease + 0.02);
    } else {
      reps += 1;
      interval = reps === 1 ? 2 : reps === 2 ? 5 : Math.max(6, interval * (ease + 0.20));
      ease = Math.min(3.2, ease + 0.08);
    }
    interval = Math.min(interval, 120);
    const mastery = Math.min(100, Math.round(reps * 14 + Math.max(0, ease - 2.3) * 15 - lapses * 8));
    return { repetitions: reps, ease, interval_days: interval, mastery, lapses, due_at: new Date(Date.now() + interval * 86400000).toISOString(), last_review_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  }

  async function gradeReview(grade) {
    const item = state.currentReview;
    if (!item) return;
    const correct = grade !== 'again';
    const patch = scheduleNext(item, grade);
    try {
      if (state.mode === 'cloud') {
        const { error: updateError } = await sb.from('vocabulary').update(patch).eq('id', item.id);
        if (updateError) throw updateError;
        const event = { user_id: state.user.id, vocabulary_id: item.id, correct, grade, exercise_type: state.activeReviewExercise };
        const { data: eventRow, error: eventError } = await sb.from('review_events').insert(event).select().single();
        if (eventError) throw eventError;
        state.events.unshift(eventRow);
      } else {
        Object.assign(item, patch);
        state.events.unshift({ id: uid(), user_id: 'local', vocabulary_id: item.id, correct, grade, exercise_type: state.activeReviewExercise, created_at: new Date().toISOString() });
        saveLocal();
      }
      const stateItem = state.vocabulary.find(x => x.id === item.id);
      if (stateItem) Object.assign(stateItem, patch);
      state.reviewIndex += 1;
      updateReviewBadge();
      renderDashboard();
      if (state.reviewIndex >= state.reviewQueue.length) {
        $('review-empty').classList.remove('hidden');
        $('review-card-wrap').classList.add('hidden');
        $('review-counter').textContent = 'Session complete';
        toast('Review session complete!', 'success');
      } else {
        loadCurrentReview();
      }
    } catch (err) {
      console.error(err);
      toast(`Could not save review: ${err.message}`, 'error');
    }
  }

  function renderGeneratedPhrase() {
    const words = state.vocabulary.filter(x => x.source_type === 'word');
    const phrases = state.vocabulary.filter(x => x.source_type === 'phrase');
    if (phrases.length && Math.random() < 0.35) {
      const p = phrases[Math.floor(Math.random() * phrases.length)];
      $('generated-phrase').textContent = p.russian;
      $('generated-translation').textContent = p.english || '';
      return;
    }
    if (words.length < 2) {
      $('generated-phrase').textContent = 'Add at least two words to start generating phrases.';
      $('generated-translation').textContent = '';
      return;
    }
    const sorted = [...words].sort((a,b) => masteryPercent(a) - masteryPercent(b));
    const a = sorted[0];
    const b = sorted.find(x => x.id !== a.id) || sorted[1];
    const c = sorted.find(x => x.id !== a.id && x.id !== b.id);
    const mastery = Math.round((masteryPercent(a) + masteryPercent(b)) / 2);
    const candidates = [
      { ru: `Это ${a.russian}.`, en: `This is ${a.english || a.russian}.` },
      { ru: `Вот ${a.russian}.`, en: `Here is ${a.english || a.russian}.` },
      { ru: `Где ${a.russian}?`, en: `Where is ${a.english || a.russian}?` }
    ];
    if (mastery >= 45 && c) candidates.push({ ru: `Это ${a.russian} и ${b.russian}.`, en: `This is ${a.english || a.russian} and ${b.english || b.russian}.` });
    if (mastery >= 75 && c) candidates.push({ ru: `Сегодня ${b.russian} и ${c.russian}.`, en: `Today: ${b.english || b.russian} and ${c.english || c.russian}.` });
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    $('generated-phrase').textContent = pick.ru;
    $('generated-translation').textContent = pick.en;
  }

  function calculateStreak() {
    const days = new Set(state.events.map(e => todayKey(new Date(e.created_at))));
    let streak = 0;
    const d = new Date();
    while (days.has(todayKey(d))) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function renderProgress() {
    const total = state.events.length;
    const correct = state.events.filter(e => e.correct).length;
    $('progress-reviews').textContent = total;
    $('progress-correct').textContent = correct;
    $('progress-accuracy').textContent = `${total ? Math.round(correct / total * 100) : 0}%`;
    $('progress-mastered').textContent = state.vocabulary.filter(mastered).length;
    $('activity-list').innerHTML = state.events.slice(0, 20).map(e => {
      const item = state.vocabulary.find(v => v.id === e.vocabulary_id);
      return `<div class="activity-row"><span class="activity-icon">${e.correct ? '✓' : '↺'}</span><div><strong>${escapeHTML(item?.russian || 'Deleted item')}</strong><span>${escapeHTML(e.exercise_type)} · ${escapeHTML(e.grade)}</span></div><time>${formatDate(e.created_at)}</time></div>`;
    }).join('') || '<div class="empty-inline">Review activity will appear here.</div>';
  }

  function renderLevelTable() {
    const count = getWordCount();
    const current = getLevelInfo(count).current.level;
    $('level-table').innerHTML = LEVELS.map(item => {
      const done = count >= item.words;
      return `<div class="level-table-row"><strong>${item.level}</strong><span>${item.words.toLocaleString()} words</span><span class="${done ? 'done' : ''}">${done ? 'Reached' : `${Math.max(0, item.words - count).toLocaleString()} remaining`}</span>${item.level === current ? '<span class="current-dot">Current estimate</span>' : ''}</div>`;
    }).join('');
  }

  function saveSettings() {
    const goal = Math.max(1, Math.min(500, Number($('setting-goal').value) || 20));
    state.settings.dailyGoal = goal;
    saveLocal();
    toast('Settings saved.', 'success');
  }

  function exportData() {
    const payload = { app: 'Russian Learner', version: 1, exported_at: new Date().toISOString(), settings: state.settings, vocabulary: state.vocabulary, events: state.events };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `russian-learner-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importData(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.vocabulary)) throw new Error('Invalid backup file.');
      if (state.mode === 'cloud') {
        let insertedCount = 0;
        for (const raw of data.vocabulary) {
          const candidate = {
            user_id: state.user.id,
            russian: String(raw.russian || '').trim(),
            english: String(raw.english || '').trim(),
            category: raw.category || 'General',
            source_type: raw.source_type === 'phrase' ? 'phrase' : 'word',
            notes: raw.notes || '',
            repetitions: Number(raw.repetitions || 0),
            mastery: Number(raw.mastery || 0),
            ease: Number(raw.ease || 2.5),
            interval_days: Number(raw.interval_days || 0),
            due_at: raw.due_at || new Date().toISOString(),
            last_review_at: raw.last_review_at || null,
            lapses: Number(raw.lapses || 0)
          };
          if (!candidate.russian) continue;
          const { data: existing } = await sb.from('vocabulary')
            .select('id')
            .eq('user_id', state.user.id)
            .ilike('russian', candidate.russian)
            .ilike('english', candidate.english)
            .limit(1);
          if (existing && existing.length) continue;
          const { error } = await sb.from('vocabulary').insert(candidate);
          if (error) throw error;
          insertedCount += 1;
        }
        toast(`${insertedCount} vocabulary item(s) imported. Existing duplicates were skipped.`, 'success');
        await loadCloudData();
      } else {
        state.vocabulary = data.vocabulary;
        state.events = Array.isArray(data.events) ? data.events : [];
        state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
        saveLocal();
        renderAll();
        toast('Backup imported.', 'success');
      }
    } catch (err) { toast(`Import failed: ${err.message}`, 'error'); }
    e.target.value = '';
  }

  async function loadCloudData() {
    if (!sb || !state.user) return;
    const [vocabRes, eventRes] = await Promise.all([
      sb.from('vocabulary').select('*').order('created_at', { ascending: false }),
      sb.from('review_events').select('*').order('created_at', { ascending: false }).limit(1000)
    ]);
    if (vocabRes.error) throw vocabRes.error;
    if (eventRes.error) throw eventRes.error;
    state.vocabulary = vocabRes.data || [];
    state.events = eventRes.data || [];
    renderAll();
  }

  bootstrap().catch(err => {
    console.error(err);
    loadLocal();
    showApp();
    toast('The app started in local mode because cloud loading failed.', 'error');
  });
})();
