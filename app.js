/* Russian Learner 2.0
   A free static/PWA language-learning engine built around user-supplied Russian vocabulary.
   No paid AI/API is required. Speech uses browser Web Speech APIs when available.
*/
(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SUPABASE_KEY = CFG.SUPABASE_PUBLISHABLE_KEY || CFG.SUPABASE_ANON_KEY || '';
  const hasCloud = Boolean(CFG.SUPABASE_URL && SUPABASE_KEY && window.supabase);
  const cloud = hasCloud ? window.supabase.createClient(CFG.SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
  }) : null;

  const LS_KEY = 'russianLearner2';
  const SESSION_KEY = 'russianLearner2_session';
  const DEFAULT_STATE = {
    mode: 'local',
    profile: { id: null, email: '', display_name: 'Russian Learner', avatar: 'RU' },
    settings: { dailyGoal: 20, voiceRate: 0.88, voiceName: '', theme: 'light', learningMode: 'balanced' },
    vocabulary: [],
    events: [],
    mistakes: [],
    concepts: {},
    stats: { xp: 0, gems: 100, streak: 0, lastActive: null, daily: {} },
    questSeed: null,
    bookmarks: []
  };
  let state = loadState();
  let route = 'home';
  let reviewSession = null;
  let flashSession = null;
  let phraseDifficulty = 2;
  let storySession = null;
  let speechRecognizer = null;
  let speechListening = false;
  let currentSpeakTarget = '';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const now = () => new Date();
  const isoNow = () => new Date().toISOString();
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[ё]/g,'е').replace(/[^\p{L}\p{N}\s-]/gu,'').replace(/\s+/g,' ').trim();
  const tokenize = s => norm(s).split(/\s+/).filter(Boolean);
  const rand = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
  const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);
  const clamp = (n,a,b) => Math.max(a, Math.min(b,n));
  const daysFromNow = d => new Date(Date.now() + d * 86400000).toISOString();
  const dayKey = (d = now()) => d.toISOString().slice(0,10);
  const startDay = d => new Date(`${dayKey(d)}T00:00:00`);

  function defaultState() { return clone(DEFAULT_STATE); }
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? mergeState(defaultState(), JSON.parse(raw)) : defaultState();
    } catch { return defaultState(); }
  }
  function mergeState(base, incoming) {
    for (const k of Object.keys(base)) if (incoming && incoming[k] !== undefined) base[k] = incoming[k];
    return base;
  }
  function saveLocal() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

  function toast(message) {
    const host = $('#toast-stack'); if (!host) return;
    const node = document.createElement('div'); node.className = 'toast'; node.textContent = message; host.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  function speak(text, opts = {}) {
    if (!('speechSynthesis' in window)) { toast('Speech synthesis is not available in this browser.'); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = opts.lang || 'ru-RU';
    u.rate = opts.rate || Number(state.settings.voiceRate || 0.88);
    u.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name === state.settings.voiceName) || voices.find(v => v.lang?.toLowerCase().startsWith('ru'));
    if (preferred) u.voice = preferred;
    window.speechSynthesis.speak(u);
  }

  function setupSpeechRecognition() {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) return null;
    const r = new R();
    r.lang = 'ru-RU'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 3;
    r.onstart = () => { speechListening = true; render(); };
    r.onend = () => { speechListening = false; render(); };
    r.onerror = (e) => { speechListening = false; render(); toast(`Speech recognition: ${e.error || 'unavailable'}`); };
    r.onresult = (e) => {
      const text = [...e.results].map(x => x[0]?.transcript || '').join(' ').trim();
      if (route === 'speak') setSpeakTranscript(text);
      else if (reviewSession?.item) reviewSession.lastSpeech = text;
      render();
    };
    return r;
  }
  speechRecognizer = setupSpeechRecognition();

  function canSpeak() { return Boolean(speechRecognizer); }

  function setSpeakTranscript(text) {
    window.__speakTranscript = text;
    const out = $('#speak-transcript'); if (out) out.textContent = text || 'Your speech will appear here.';
  }

  function getUser() { return cloud ? cloud.auth.getUser().then(r => r.data.user || null).catch(() => null) : Promise.resolve(null); }

  async function boot() {
    if (cloud) {
      cloud.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          state.mode = 'cloud'; state.profile.id = session.user.id; state.profile.email = session.user.email || '';
          await loadCloud();
          saveLocal();
        } else if (!state.profile.id) state.mode = 'local';
        render();
      });
      try {
        const { data } = await cloud.auth.getSession();
        if (data.session?.user) {
          state.mode = 'cloud'; state.profile.id = data.session.user.id; state.profile.email = data.session.user.email || '';
          await loadCloud();
        }
      } catch {}
    }
    buildVoices();
    render();
  }

  function buildVoices() {
    if (!('speechSynthesis' in window)) return;
    const populate = () => {
      const select = $('#voice-select'); if (!select) return;
      const voices = window.speechSynthesis.getVoices().filter(v => v.lang?.toLowerCase().startsWith('ru'));
      select.innerHTML = '<option value="">Automatic Russian voice</option>' + voices.map(v => `<option ${v.name === state.settings.voiceName ? 'selected' : ''} value="${esc(v.name)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('');
    };
    populate(); window.speechSynthesis.onvoiceschanged = populate;
  }

  async function loadCloud() {
    if (!cloud || !state.profile.id) return;
    try {
      const [{ data: words }, { data: events }, { data: mistakes }, { data: profile }] = await Promise.all([
        cloud.from('vocabulary').select('*').order('created_at', { ascending: true }),
        cloud.from('review_events').select('*').order('created_at', { ascending: false }).limit(5000),
        cloud.from('user_mistakes').select('*').order('created_at', { ascending: false }).limit(3000),
        cloud.from('profiles').select('*').eq('id', state.profile.id).maybeSingle()
      ]);
      if (words) state.vocabulary = words.map(normalizeWord);
      if (events) state.events = events;
      if (mistakes) state.mistakes = mistakes;
      if (profile) state.profile = { ...state.profile, ...profile };
      rebuildStatsFromEvents();
      saveLocal();
    } catch (e) { toast('Cloud sync could not load; local data remains available.'); }
  }

  function normalizeWord(w) {
    return {
      id: w.id || uid(), user_id: w.user_id || state.profile.id || null,
      russian: w.russian || '', english: w.english || '', category: w.category || 'General',
      source_type: w.source_type || w.type || 'word', notes: w.notes || '',
      repetitions: Number(w.repetitions || 0), mastery: Number(w.mastery || 0), ease: Number(w.ease || 2.5),
      interval_days: Number(w.interval_days || 0), due_at: w.due_at || isoNow(), last_review_at: w.last_review_at || null,
      lapses: Number(w.lapses || 0), grammar: w.grammar || '', example_sentence: w.example_sentence || '',
      tags: w.tags || [], created_at: w.created_at || isoNow(), updated_at: w.updated_at || isoNow()
    };
  }

  function rebuildStatsFromEvents() {
    const daily = {};
    let correct = 0, total = 0;
    for (const e of state.events) {
      const d = (e.created_at || isoNow()).slice(0,10); daily[d] = daily[d] || { xp:0, reviews:0, correct:0 };
      daily[d].reviews++; if (e.correct) { correct++; daily[d].correct++; } total++;
      daily[d].xp += Number(e.xp || 0);
    }
    state.stats.daily = { ...state.stats.daily, ...daily };
    state.stats.xp = Object.values(daily).reduce((s,d) => s + Number(d.xp || 0), 0) || state.stats.xp || 0;
    const activeDays = Object.keys(state.stats.daily).sort();
    let streak = 0, cursor = new Date();
    const today = dayKey();
    if (!activeDays.includes(today)) cursor.setDate(cursor.getDate()-1);
    while (activeDays.includes(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate()-1); }
    state.stats.streak = streak;
    state.stats.accuracy = total ? Math.round((correct/total)*100) : 0;
  }

  function dayStats(key = dayKey()) { return state.stats.daily[key] || { xp:0, reviews:0, correct:0 }; }
  function addDailyXp(amount) {
    const d = dayStats(); d.xp += amount; state.stats.daily[dayKey()] = d; state.stats.xp += amount; state.stats.lastActive = isoNow();
    // streak is based on activity; a positive XP action counts.
    rebuildStreak();
  }
  function rebuildStreak() {
    const days = Object.keys(state.stats.daily).filter(k => state.stats.daily[k].xp > 0).sort();
    let cur = new Date(); let s = 0;
    if (!days.includes(dayKey(cur))) cur.setDate(cur.getDate()-1);
    while (days.includes(dayKey(cur))) { s++; cur.setDate(cur.getDate()-1); }
    state.stats.streak = s;
  }

  async function cloudUpsertWord(word) {
    if (!cloud || !state.profile.id) return true;
    const payload = { ...word, user_id: state.profile.id, id: word.id };
    delete payload.tags; // keep compatibility with the original schema; tags are local unless added by newer SQL.
    const { error } = await cloud.from('vocabulary').upsert(payload, { onConflict: 'id' });
    return !error;
  }
  async function cloudDeleteWord(id) { if (cloud && state.profile.id) await cloud.from('vocabulary').delete().eq('id', id); }
  async function cloudReview(event) { if (cloud && state.profile.id) await cloud.from('review_events').insert({ ...event, user_id: state.profile.id }); }
  async function cloudMistake(m) { if (cloud && state.profile.id) await cloud.from('user_mistakes').insert({ ...m, user_id: state.profile.id }); }
  async function cloudSaveProfile() { if (cloud && state.profile.id) await cloud.from('profiles').upsert({ id: state.profile.id, display_name: state.profile.display_name, avatar: state.profile.avatar }); }

  function newWord(data) {
    const existing = state.vocabulary.find(v => norm(v.russian) === norm(data.russian) && norm(v.english) === norm(data.english));
    if (existing) throw new Error('That vocabulary item already exists.');
    const word = normalizeWord({
      id: uid(), user_id: state.profile.id, russian: data.russian.trim(), english: data.english.trim(),
      category: data.category.trim() || 'General', source_type: data.type, notes: data.notes.trim(),
      repetitions:0, mastery:0, ease:2.5, interval_days:0, due_at:isoNow(), lapses:0,
      grammar:'', example_sentence:'', tags:[]
    });
    state.vocabulary.push(word); saveLocal(); cloudUpsertWord(word); return word;
  }
  async function updateWord(word) { state.vocabulary = state.vocabulary.map(v => v.id === word.id ? word : v); saveLocal(); await cloudUpsertWord(word); }

  function levelFromScore(score) {
    if (score < 10) return ['A1', 'Early beginner'];
    if (score < 30) return ['A1', 'Beginner'];
    if (score < 60) return ['A2', 'Elementary'];
    if (score < 80) return ['B1', 'Intermediate'];
    if (score < 100) return ['B1', 'Upper intermediate'];
    if (score < 115) return ['B2', 'Upper intermediate'];
    if (score < 130) return ['B2', 'Upper intermediate'];
    return ['C1/C2', 'Advanced'];
  }
  function vocabularyCount() { return new Set(state.vocabulary.flatMap(v => tokenize(v.russian))).size; }
  function scoreEstimate() {
    const words = vocabularyCount();
    const mastered = state.vocabulary.filter(v => v.mastery >= 80).length;
    const accuracy = Number(state.stats.accuracy || 0);
    const grammarMastery = Object.values(state.concepts).length ? Object.values(state.concepts).reduce((a,b) => a+b,0)/Object.values(state.concepts).length : 0;
    const score = clamp(Math.round(Math.min(160, words/18 + mastered/4 + accuracy/8 + grammarMastery/6)),0,160);
    return score;
  }
  function dueWords() { const t = Date.now(); return state.vocabulary.filter(v => !v.due_at || new Date(v.due_at).getTime() <= t).sort((a,b) => new Date(a.due_at)-new Date(b.due_at)); }
  function masteryLabel(m) { return m >= 90 ? 'Mastered' : m >= 70 ? 'Strong' : m >= 40 ? 'Learning' : 'New'; }
  function masteryClass(m) { return m >= 90 ? 'green' : m >= 70 ? 'blue' : m < 40 ? 'orange' : ''; }
  function topicUnits() {
    const map = new Map();
    for (const v of state.vocabulary) {
      const key = v.category || 'General';
      if (!map.has(key)) map.set(key, []); map.get(key).push(v);
    }
    return [...map.entries()].map(([name, words], i) => ({ id:`u-${i}`, name, words, icon:['🌱','🏠','🍽️','✈️','🎓','💼','❤️','🗣️'][i%8] }));
  }

  const GRAMMAR = [
    {id:'cases', name:'Russian cases', desc:'Case forms for common nouns and prepositions', trigger:['case','noun','дом','книга','университет']},
    {id:'gender', name:'Noun gender', desc:'Masculine, feminine and neuter agreement', trigger:['gender','noun']},
    {id:'present', name:'Present tense', desc:'Common present-tense verb patterns', trigger:['verb','present']},
    {id:'past', name:'Past tense', desc:'Past forms and agreement', trigger:['past','вчера']},
    {id:'future', name:'Future', desc:'Simple and compound future', trigger:['future','завтра']},
    {id:'aspect', name:'Verb aspect', desc:'Perfective vs imperfective meaning', trigger:['aspect','verb']},
    {id:'motion', name:'Verbs of motion', desc:'идти, ехать and recurring motion', trigger:['motion','ехать','идти']},
    {id:'pronouns', name:'Pronouns', desc:'Core personal and possessive pronouns', trigger:['pronoun','я','ты','мой']}
  ];

  function conceptsForWord(v) {
    const out = [];
    const r = norm(v.russian);
    if (/\b(я|ты|он|она|мы|вы|они)\b/.test(r)) out.push('pronouns');
    if (v.source_type === 'word') out.push('gender');
    if (/[оеёиыэаюя]$/.test(r)) out.push('cases');
    if (/^(ид|ех|ход|хот|мож|буд|быть)/.test(r)) out.push('present','aspect');
    if (v.category.toLowerCase().includes('travel') || /вокзал|аэропорт|ехать|идти/.test(r)) out.push('motion');
    return [...new Set(out)];
  }

  function generatePhrase(words, difficulty = 1) {
    const pool = words.filter(Boolean);
    if (!pool.length) return 'Добавьте слова, чтобы я мог составлять упражнения.';
    const by = s => pool.find(v => new RegExp(`\\b${s}\\b`, 'i').test(norm(v.russian)));
    const я = by('я'); const хочу = by('хочу') || by('хотеть'); const есть = by('есть'); const дом = by('дом'); const сегодня = by('сегодня');
    const choices = [];
    if (я && хочу && есть) choices.push(`${я.russian} ${хочу.russian} ${есть.russian}.`);
    if (я && хочу && дом) choices.push(`${я.russian} ${хочу.russian} ${dom.russian}.`);
    if (сегодня && я && дом) choices.push(`${сегодня.russian} ${я.russian} ${dom.russian}.`);
    if (pool.length >= 4) {
      const p = shuffle(pool).slice(0, clamp(difficulty+2,3,7));
      choices.push(p.map(x=>x.russian).join(' ') + '.');
    }
    if (!choices.length) return shuffle(pool).slice(0, clamp(difficulty+2,2,6)).map(x=>x.russian).join(' ') + '.';
    return rand(choices);
  }

  const CHALLENGE_TYPES = ['choice','translation','typing','listening','wordbank','fill','speaking'];
  function chooseChallenge(item, idx, session) {
    const m = item?.mastery || 0;
    const due = item && new Date(item.due_at).getTime() <= Date.now();
    const weakSpeak = !canSpeak() ? false : (item?.speakFails || 0) > 0;
    let pool;
    if (weakSpeak) pool = ['speaking','listening','typing'];
    else if (m < 25) pool = ['choice','listening','wordbank','typing'];
    else if (m < 60) pool = ['translation','wordbank','fill','listening'];
    else if (m < 85) pool = ['translation','typing','fill','speaking'];
    else pool = ['typing','speaking','translation','listening'];
    if (!due) pool = pool.filter(x => x !== 'typing' || m > 40);
    return pool[idx % pool.length] || CHALLENGE_TYPES[idx % CHALLENGE_TYPES.length];
  }

  function buildReviewQueue({limit=10, mode='adaptive'} = {}) {
    const due = dueWords(); const fresh = state.vocabulary.filter(v => v.repetitions === 0); const weak = [...state.vocabulary].sort((a,b) => a.mastery-b.mastery);
    let pool = mode === 'review' ? [...due, ...weak] : [...due, ...fresh, ...weak];
    const seen = new Set(); pool = pool.filter(v => !seen.has(v.id) && seen.add(v.id));
    const result=[];
    // prioritize due and mistakes, but inject known items for variety
    const mistakes = new Set(state.mistakes.slice(0,80).map(m=>m.vocabulary_id));
    pool.sort((a,b) => (Number(mistakes.has(b.id))-Number(mistakes.has(a.id))) + (Number(new Date(a.due_at).getTime() < Date.now())-Number(new Date(b.due_at).getTime() < Date.now()))*1.5 + (a.mastery-b.mastery)/100);
    for (const x of shuffle(pool.slice(0, Math.max(limit*2, 20)))) if (result.length<limit && !result.some(y=>y.id===x.id)) result.push(x);
    return result;
  }

  function startReview(mode='adaptive', limit=10) {
    const queue = buildReviewQueue({limit,mode});
    if (!queue.length) { toast('Add some Russian vocabulary first.'); route='vocabulary'; render(); return; }
    reviewSession = { queue, index:0, item:null, type:null, answered:false, correct:false, lastSpeech:'' };
    nextReviewItem();
  }
  function nextReviewItem() {
    if (!reviewSession) return;
    if (reviewSession.index >= reviewSession.queue.length) { finishSession(); return; }
    reviewSession.item = reviewSession.queue[reviewSession.index];
    reviewSession.type = chooseChallenge(reviewSession.item, reviewSession.index, reviewSession);
    reviewSession.answered = false; reviewSession.correct = false; reviewSession.lastSpeech='';
    route='review'; render();
  }
  function finishSession() {
    const xp = reviewSession.queue.length * 5;
    addDailyXp(xp); saveLocal();
    toast(`Session complete! +${xp} XP`);
    reviewSession = null; route='home'; render();
  }

  function wrongAnswer(word, grade, exerciseType, supplied='') {
    const penalty = grade === 'Again' ? 18 : 8;
    word.mastery = clamp(word.mastery - penalty, 0, 100);
    word.lapses += 1; word.ease = clamp(word.ease - .15, 1.3, 3.0); word.interval_days = 0; word.due_at = new Date(Date.now() + (grade === 'Again' ? 10*60000 : 6*3600000)).toISOString(); word.last_review_at = isoNow();
    const ev = { id:uid(), vocabulary_id:word.id, correct:false, grade, exercise_type:exerciseType, created_at:isoNow(), xp:1 };
    state.events.unshift(ev); state.events = state.events.slice(0,5000); const d=dayStats(); d.reviews += 1; state.stats.daily[dayKey()] = d;
    const m = { id:uid(), vocabulary_id:word.id, error_type:exerciseType, supplied_answer:supplied, created_at:isoNow() }; state.mistakes.unshift(m); state.mistakes = state.mistakes.slice(0,3000);
    cloudReview(ev); cloudMistake(m); updateWord(word); saveLocal();
  }
  function correctAnswer(word, grade, exerciseType) {
    const factor = grade === 'Easy' ? 1.35 : grade === 'Hard' ? .85 : 1;
    word.repetitions += 1; word.last_review_at = isoNow(); word.ease = clamp(word.ease + (grade==='Easy'?.08: grade==='Hard'?-.02:.03),1.3,3.1);
    const base = word.interval_days || 0;
    const next = word.repetitions === 1 ? 0.03 : word.repetitions === 2 ? 1 : Math.max(1, base * word.ease * factor);
    word.interval_days = clamp(next, 0.02, 90); word.due_at = daysFromNow(word.interval_days); word.mastery = clamp(word.mastery + (grade==='Easy'?14: grade==='Good'?10:6), 0,100);
    const ev = { id:uid(), vocabulary_id:word.id, correct:true, grade, exercise_type:exerciseType, created_at:isoNow(), xp:grade==='Easy'?7:5 };
    state.events.unshift(ev); state.events=state.events.slice(0,5000); const d=dayStats(); d.reviews += 1; d.correct += 1; d.xp += ev.xp; state.stats.daily[dayKey()] = d; state.stats.xp += ev.xp; state.stats.lastActive=isoNow(); rebuildStreak(); rebuildAccuracy();
    state.conceptsForWord = state.conceptsForWord || {};
    conceptsForWord(word).forEach(c => { state.concepts[c] = clamp((state.concepts[c]||0) + 4,0,100); });
    cloudReview(ev); updateWord(word); saveLocal();
  }
  function rebuildAccuracy() { let t=0,c=0; for(const e of state.events){t++; if(e.correct)c++;} state.stats.accuracy=t?Math.round(c/t*100):0; }

  function answerReview(result, supplied='') {
    if (!reviewSession || reviewSession.answered) return;
    const item = reviewSession.item; reviewSession.answered = true; reviewSession.correct = result;
    if (result) correctAnswer(item, 'Good', reviewSession.type); else wrongAnswer(item, 'Again', reviewSession.type, supplied);
    render();
  }
  function gradeReview(grade) {
    if (!reviewSession?.item || !reviewSession.answered) return;
    if (reviewSession.correct) correctAnswer(reviewSession.item, grade, reviewSession.type);
    // If already wrong, apply the grade as a scheduling retry.
    else wrongAnswer(reviewSession.item, grade, reviewSession.type, reviewSession.lastSpeech || '');
    reviewSession.index++; reviewSession.answered=false; nextReviewItem();
  }

  function choiceOptions(item) {
    const others = shuffle(state.vocabulary.filter(v=>v.id!==item.id && v.english)).slice(0,3).map(v=>v.english);
    return shuffle([item.english, ...others]);
  }
  function russianOptions(item) {
    const others = shuffle(state.vocabulary.filter(v=>v.id!==item.id && v.russian)).slice(0,3).map(v=>v.russian);
    return shuffle([item.russian, ...others]);
  }
  function buildWordBankAnswer(item) {
    const tokens = tokenize(item.english || item.russian);
    const distractors = shuffle(state.vocabulary.flatMap(v=> tokenize(v.russian))).filter(x=>!tokens.includes(x)).slice(0,Math.max(2,4-tokens.length));
    return shuffle([...tokens, ...distractors]);
  }
  function renderChoiceExercise(item) {
    const options = choiceOptions(item);
    return `<div class="prompt">What does <strong>${esc(item.russian)}</strong> mean?<small><button class="text-btn" data-speak="${esc(item.russian)}">🔊 Hear it</button></small></div><div class="choices">${options.map(x=>`<button class="choice" data-choice="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
  }
  function renderTranslation(item) {
    return `<div class="prompt">Translate into English<small>Use the meaning you entered.</small><button class="text-btn" data-speak="${esc(item.russian)}">🔊 ${esc(item.russian)}</button></div><div class="answer-row"><input class="exercise-input" id="exercise-input" autocomplete="off" placeholder="Type the English meaning"><button class="primary-btn" data-check-input>Check</button></div>`;
  }
  function renderTyping(item) {
    return `<div class="prompt">Translate into Russian<small>${esc(item.english)}</small></div><div class="answer-row"><input class="exercise-input" id="exercise-input" autocomplete="off" placeholder="Type Russian"><button class="primary-btn" data-check-input>Check</button></div>`;
  }
  function renderListening(item) {
    const opts = russianOptions(item);
    setTimeout(()=>speak(item.russian),80);
    return `<div class="prompt">What did you hear?<small>Listen, then choose the Russian.</small><button class="primary-btn" data-speak="${esc(item.russian)}">▶ Play again</button></div><div class="choices">${opts.map(x=>`<button class="choice" data-choice="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
  }
  function renderWordBank(item) {
    const bank = buildWordBankAnswer(item);
    return `<div class="prompt">Build the Russian answer<small>${esc(item.english)}</small></div><div id="wordbank-slots" class="answer-row" style="min-height:50px;flex-wrap:wrap"></div><div class="choices" style="margin-top:14px;grid-template-columns:repeat(2,1fr)">${bank.map(x=>`<button class="choice bank-token" data-token="${esc(x)}">${esc(x)}</button>`).join('')}</div><button class="primary-btn full" style="margin-top:12px" id="check-bank">Check</button>`;
  }
  function renderFill(item) {
    const words = tokenize(item.russian); const blank = words.length>1 ? rand(words) : item.russian;
    const prompt = item.russian.replace(new RegExp(`\\b${blank}\\b`,'i'),'_____');
    return `<div class="prompt">Complete the sentence<small>${esc(item.english)}</small></div><div class="card" style="font-size:22px;text-align:center;margin-bottom:12px">${esc(prompt)}</div><div class="answer-row"><input class="exercise-input" id="exercise-input" placeholder="Missing word"><button class="primary-btn" data-check-input>Check</button></div><div class="tiny muted" style="margin-top:8px">Tip: this exercise uses a phrase from your own vocabulary.</div>`;
  }
  function renderSpeaking(item) {
    currentSpeakTarget = item.russian;
    if (!canSpeak()) return `<div class="warning">Speaking practice requires a browser with Web Speech Recognition. Chrome or Edge on a desktop is the easiest free option. You can still use the self-check below.</div><div class="prompt">Say this aloud:<small>${esc(item.russian)}</small></div><button class="primary-btn full" data-speak="${esc(item.russian)}">🔊 Hear model pronunciation</button>`;
    return `<div class="prompt">Say this in Russian<small>${esc(item.english)}</small></div><button class="mic-btn ${speechListening?'listening':''}" id="mic-btn">${speechListening?'■':'🎤'}</button><div class="transcript" id="review-transcript">${esc(reviewSession?.lastSpeech || 'Tap the microphone and speak.')}</div><div class="tiny muted">The browser's speech recognizer will return a transcript. We compare it with your target locally.</div><button class="primary-btn full" data-check-speech>Check speaking</button>`;
  }

  function renderReview() {
    if (!reviewSession) { return `<div class="page-head"><div><h1>Review</h1><p>Your due and weak items are prioritized automatically.</p></div><button class="primary-btn" data-start="review">Start review</button></div><div class="card empty"><strong>${dueWords().length} items are due now.</strong><p>Start a 10-item adaptive session. The engine will mix exercise types based on mastery.</p></div>`; }
    const item = reviewSession.item; const type = reviewSession.type; const pct = Math.round(reviewSession.index/reviewSession.queue.length*100);
    let body='';
    if(type==='choice') body=renderChoiceExercise(item);
    if(type==='translation') body=renderTranslation(item);
    if(type==='typing') body=renderTyping(item);
    if(type==='listening') body=renderListening(item);
    if(type==='wordbank') body=renderWordBank(item);
    if(type==='fill') body=renderFill(item);
    if(type==='speaking') body=renderSpeaking(item);
    const feedback = reviewSession.answered ? `<div class="feedback ${reviewSession.correct?'good':'bad'}">${reviewSession.correct?'✅ Correct!':'❌ Not quite.'} ${reviewSession.correct?'Review the word once more if you want.':'The answer is: <strong>'+esc(item.russian)+'</strong> — '+esc(item.english)}</div>` : '';
    const nextControls = reviewSession.answered ? `<div class="exercise-footer"><span class="tiny muted">${reviewSession.correct?'Rate the memory strength':'Retry scheduling'}</span><div class="review-grade"><button class="grade-btn grade-again" data-grade="Again">Again</button><button class="grade-btn grade-hard" data-grade="Hard">Hard</button><button class="grade-btn grade-good" data-grade="Good">Good</button><button class="grade-btn grade-easy" data-grade="Easy">Easy</button></div></div>` : '';
    return `<div class="exercise"><div class="exercise-head"><div><span class="tag green">Adaptive review</span><span class="tag">${reviewSession.index+1} / ${reviewSession.queue.length}</span></div><button class="secondary-btn" data-route="home">Exit</button></div><div class="exercise-progress"><div style="width:${pct}%"></div></div><div class="exercise-card"><div class="exercise-meta"><span class="tag blue">${esc(masteryLabel(item.mastery))}</span><span class="tag">${esc(item.category)}</span><span class="tag">${esc(type)}</span></div>${body}${feedback}${nextControls}</div></div>`;
  }

  function renderHome() {
    const score=scoreEstimate(); const [lvl,desc]=levelFromScore(score); const d=dayStats(); const due=dueWords(); const units=topicUnits();
    const goals=[
      {label:'Finish 1 lesson', done:d.reviews>0},
      {label:`Complete ${Math.max(10,state.settings.dailyGoal)} XP`, done:d.xp>=state.settings.dailyGoal},
      {label:'Practice one weak word', done:state.events.some(e=>!e.correct && e.created_at?.startsWith(dayKey()))}
    ];
    return `<div class="hero"><div><span class="tag green">Personal Russian course</span><h1>Continue your Russian journey.</h1><p>Your lessons are generated from the words and phrases you enter. The engine prioritizes due reviews, weak concepts and progressively harder tasks.</p><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px"><button class="primary-btn" data-start="learn">▶ Start lesson</button><button class="secondary-btn" data-start="review">↻ Review ${due.length}</button></div></div><div class="score-ring" style="--score:${Math.min(100,score/1.6)}%"><div class="score-inner"><strong>${score}</strong><span>Russian Score</span><small>${lvl}</small></div></div></div>
      <div class="cards"><div class="card"><span class="muted">🔥 Streak</span><div class="stat-number">${state.stats.streak} days</div><span class="tiny muted">Keep today's activity alive.</span></div><div class="card"><span class="muted">📚 Vocabulary</span><div class="stat-number">${vocabularyCount()}</div><span class="tiny muted">${state.vocabulary.length} saved entries</span></div><div class="card"><span class="muted">🎯 Due now</span><div class="stat-number">${due.length}</div><span class="tiny muted">Spaced review queue</span></div></div>
      <div class="section-title"><h2>Today's quests</h2><span class="tag">${d.xp} XP today</span></div><div class="cards">${goals.map((g,i)=>`<div class="card"><div style="display:flex;justify-content:space-between;gap:12px"><strong>${g.label}</strong><span>${g.done?'✅':'⬜'}</span></div><div class="progress-track"><div class="progress-fill" style="width:${g.done?'100':'20'}%"></div></div><p class="tiny muted">${i===0?'Practice':i===1?'XP':'Fix a weak point'}</p></div>`).join('')}</div>
      <div class="section-title"><h2>Your path</h2><button class="text-btn" data-route="vocabulary">Manage vocabulary</button></div>${units.length?`<div class="path">${units.slice(0,8).map((u,i)=>renderUnit(u,i)).join('')}</div>`:`<div class="card empty"><h3>Start by adding Russian</h3><p>Add at least 8–10 words or phrases and the app will turn them into a personal course path.</p><button class="primary-btn" data-open="word-modal">+ Add vocabulary</button></div>`}`;
  }
  function renderUnit(u,i) { const avg=u.words.reduce((a,b)=>a+b.mastery,0)/Math.max(1,u.words.length); return `<div class="unit"><div class="unit-badge">${u.icon}</div><div><h3>${i+1}. ${esc(u.name)}</h3><p>${u.words.length} items · ${Math.round(avg)}% mastery</p><div class="progress-track"><div class="progress-fill" style="width:${avg}%"></div></div></div><button class="primary-btn" data-unit="${esc(u.name)}">Practice</button></div>`; }

  function renderLearn() {
    const units=topicUnits();
    if(!units.length) return `<div class="page-head"><div><h1>Learn</h1><p>Your personal course path.</p></div></div><div class="card empty"><h3>No course material yet</h3><p>Add Russian vocabulary, then this screen becomes your personalized course.</p><button class="primary-btn" data-open="word-modal">Add vocabulary</button></div>`;
    const due=dueWords(); const recommended=units.find(u=>u.words.some(v=>due.includes(v))) || units[0];
    return `<div class="page-head"><div><h1>Learn</h1><p>Follow a structured path built from your categories. New items, reviews and skill practice are mixed automatically.</p></div><button class="primary-btn" data-start="learn">Start recommended</button></div><div class="callout"><strong>Recommended next:</strong> ${esc(recommended.name)}. The engine will blend due reviews with new material and varied exercise types.</div><div class="section-title"><h2>Course path</h2><span class="tag">${units.length} units</span></div><div class="path">${units.map((u,i)=>renderUnit(u,i)).join('')}</div>`;
  }


  function startFlashcards(limit=12) {
    const pool=shuffle(state.vocabulary).slice(0,Math.min(limit,state.vocabulary.length));
    if(!pool.length){toast('Add vocabulary first.');route='vocabulary';render();return;}
    flashSession={queue:pool,index:0,flipped:false}; route='flashcards'; render();
  }
  function renderFlashcards(){
    if(!flashSession) return `<div class="page-head"><div><h1>Flashcards</h1><p>Quick active-recall practice from your saved vocabulary.</p></div><button class="primary-btn" data-start-flashcards>Start flashcards</button></div><div class="card empty">Tap a card to reveal the meaning, then rate how well you remembered it.</div>`;
    if(flashSession.index>=flashSession.queue.length){ const done=flashSession.queue.length; flashSession=null; addDailyXp(done*3); saveLocal(); toast(`Flashcard deck complete! +${done*3} XP`); route='home'; return renderHome(); }
    const item=flashSession.queue[flashSession.index]; const front=flashSession.flipped?item.english:item.russian;
    return `<div class="exercise"><div class="exercise-head"><div><span class="tag green">Flashcards</span><span class="tag">${flashSession.index+1} / ${flashSession.queue.length}</span></div><button class="secondary-btn" data-route="home">Exit</button></div><div class="exercise-progress"><div style="width:${Math.round(flashSession.index/flashSession.queue.length*100)}%"></div></div><div class="flashcard" id="flashcard"><div><div class="word">${esc(front)}</div><div class="meaning">${flashSession.flipped?`<button class="text-btn" data-speak="${esc(item.russian)}">🔊 ${esc(item.russian)}</button>`:'Tap to reveal'}</div><div class="tiny muted" style="margin-top:16px">${esc(item.category)} · ${Math.round(item.mastery)}% mastery</div></div></div>${flashSession.flipped?`<div class="review-grade" style="margin-top:14px"><button class="grade-btn grade-again" data-flash-grade="Again">Again</button><button class="grade-btn grade-hard" data-flash-grade="Hard">Hard</button><button class="grade-btn grade-good" data-flash-grade="Good">Good</button><button class="grade-btn grade-easy" data-flash-grade="Easy">Easy</button></div>`:'<div class="card" style="margin-top:14px;text-align:center">Reveal the meaning, then rate how well you remembered it.</div>'}</div>`;
  }

  function renderPhrases(){
    if(!state.vocabulary.length) return `<div class="page-head"><div><h1>Phrase Lab</h1><p>Turn your own saved vocabulary into progressively richer Russian phrases.</p></div></div><div class="card empty"><h3>Add words first</h3><p>Then the app will combine them into safe practice sentences and reuse them in review.</p></div>`;
    const phrase=generatePhrase(shuffle(state.vocabulary),phraseDifficulty); const level=phraseDifficulty<=2?'A1/A2':phraseDifficulty<=4?'A2/B1':'B1/B2';
    return `<div class="page-head"><div><h1>Phrase Lab</h1><p>Your vocabulary is the content source. Increase difficulty as your mastery grows.</p></div><button class="primary-btn" data-new-phrase>Generate another</button></div><div class="hero"><div><span class="tag green">${level} practice</span><div class="prompt" style="text-align:left;margin:24px 0 10px">${esc(phrase)}</div><button class="text-btn" data-speak="${esc(phrase)}">🔊 Listen</button><p class="muted">This generator favors words you already entered. It is intentionally conservative when no grammar engine/API is available.</p></div><div><label><strong>Difficulty</strong><input id="phrase-difficulty" type="range" min="1" max="6" value="${phraseDifficulty}" style="width:100%;margin-top:20px"></label><p class="tiny muted">${phraseDifficulty<=2?'Short combinations':phraseDifficulty<=4?'Longer combinations and context':'More words and less scaffolding'}</p><div class="card"><strong>Use this as a lesson</strong><p class="tiny muted">Save any new useful phrase in Vocabulary so it becomes part of future reviews.</p><button class="secondary-btn" id="save-generated-phrase">Save phrase</button></div></div></div>`;
  }
  function renderVocabulary() {
    const q=window.__vocabQuery||''; const cat=window.__vocabCat||'All'; const cats=['All',...new Set(state.vocabulary.map(v=>v.category))];
    const rows=state.vocabulary.filter(v => (cat==='All'||v.category===cat) && (!q || norm(v.russian).includes(norm(q)) || norm(v.english).includes(norm(q)))).sort((a,b)=>a.russian.localeCompare(b.russian));
    return `<div class="page-head"><div><h1>Vocabulary</h1><p>Your source of truth. Every course, review and phrase activity grows from here.</p></div><button class="primary-btn" data-open="word-modal">+ Add vocabulary</button></div><div class="toolbar"><input id="vocab-search" placeholder="Search Russian or English" value="${esc(q)}"><select id="vocab-cat">${cats.map(x=>`<option ${x===cat?'selected':''}>${esc(x)}</option>`).join('')}</select><button class="secondary-btn" data-export>Export backup</button><label class="secondary-btn" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">Import <input type="file" id="import-file" accept="application/json" hidden></label></div><div class="table-wrap">${rows.length?`<table class="table"><thead><tr><th>Russian</th><th>English</th><th>Topic</th><th>Mastery</th><th>Review</th><th></th></tr></thead><tbody>${rows.map(v=>`<tr><td><strong>${esc(v.russian)}</strong><button class="text-btn" data-speak="${esc(v.russian)}">🔊</button>${v.notes?`<div class="tiny muted">${esc(v.notes)}</div>`:''}</td><td>${esc(v.english)}</td><td><span class="tag">${esc(v.category)}</span></td><td><span class="tag ${masteryClass(v.mastery)}">${Math.round(v.mastery)}% · ${masteryLabel(v.mastery)}</span></td><td>${new Date(v.due_at).getTime()<=Date.now()?'<span class="tag orange">Due</span>':new Date(v.due_at).toLocaleDateString()}</td><td><button class="danger-btn" data-delete-word="${v.id}">Delete</button></td></tr>`).join('')}</tbody></table>`:`<div class="empty">No vocabulary matches your filter.</div>`}</div>`;
  }

  const STORY_BANK = [
    {title:'Мой день', level:'A1', template:(w)=>`Сегодня мой день начинается рано. ${pickText(w,'Я')}. Потом я учусь и читаю. Вечером я отдыхаю дома.`, questions:['When does the day begin?','What does the learner do later?']},
    {title:'В университете', level:'A2', template:(w)=>`Я иду в университет. Там у меня есть новый урок. После урока я говорю с другом и спрашиваю, где находится библиотека. Потом мы идём домой.`, questions:['Where does the learner go?','What does the learner ask?']},
    {title:'В поездке', level:'A2-B1', template:(w)=>`Я еду в другой город. На вокзале я проверяю билет и спрашиваю, где мой поезд. Потом я встречаю нового человека и немного говорю по-русски.`, questions:['What does the learner check?','Who does the learner meet?']},
    {title:'Мои планы', level:'B1', template:(w)=>`На этой неделе у меня много планов. Я хочу закончить работу, встретиться с друзьями и больше говорить по-русски. Если у меня будет время, я посмотрю фильм и запишу новые слова.`, questions:['What does the learner want to do more?','What will happen if there is time?']}
  ];
  function pickText(words, prefer){ const v=words.find(x=>norm(x.russian)===norm(prefer)); return v?.russian || prefer; }
  function buildStory() {
    const words=state.vocabulary; return { ...rand(STORY_BANK), text: rand(STORY_BANK).template(words) };
  }
  function renderStories() {
    if(!state.vocabulary.length) return `<div class="page-head"><div><h1>Read & Listen</h1><p>Read short original Russian passages and answer comprehension questions.</p></div></div><div class="card empty">Add vocabulary to unlock personalized reading.</div>`;
    const story = storySession?.story || buildStory(); if(!storySession) storySession={story, step:0, answers:[]};
    return `<div class="page-head"><div><h1>Read & Listen</h1><p>Short original passages built for practice. Tap play, read, then answer questions.</p></div><button class="secondary-btn" data-new-story>New text</button></div><div class="story"><div class="exercise-meta"><span class="tag green">${story.level}</span><span class="tag">${esc(story.title)}</span><button class="text-btn" data-speak="${esc(story.text)}">🔊 Listen</button></div><div class="story-text">${esc(story.text)}</div><div class="question-card"><strong>Comprehension check</strong><p>${esc(story.questions[storySession.step % story.questions.length])}</p><div class="answer-row"><input id="story-answer" class="exercise-input" placeholder="Answer in English or simple Russian"></div><div style="margin-top:10px"><button class="primary-btn" id="story-check">Check understanding</button></div><div id="story-feedback"></div></div></div>`;
  }
  function checkStory() {
    const input=$('#story-answer'); const text=norm(input?.value||''); const story=storySession.story; const question=story.questions[storySession.step%story.questions.length];
    // Lightweight comprehension grading: keyword match plus non-empty answer. It is intentionally transparent and doesn't claim semantic perfection.
    const keywords=question.toLowerCase().includes('when')?['morning','early'] : question.toLowerCase().includes('where')?['university','университет'] : question.toLowerCase().includes('what')?['lesson','библиотека','билет','film','русски'] : ['university'];
    const ok=text.length>2 && keywords.some(k=>text.includes(norm(k)));
    $('#story-feedback').innerHTML=`<div class="feedback ${ok?'good':'bad'}">${ok?'✅ Looks good.':'🟠 Keep going.'} The app checks a small set of key concepts; this is a practice aid, not a formal reading exam.</div>`;
    if(ok){addDailyXp(5); storySession.step++; saveLocal();}
  }

  function renderSpeak() {
    const prompt = buildSpeakPrompt();
    return `<div class="page-head"><div><h1>Speak</h1><p>Free speaking practice using the browser's free Speech Recognition when your browser supports it. Speech recognition is not available in every browser.</p></div><span class="tag ${canSpeak()?'green':'orange'}">${canSpeak()?'Mic available':'Use self-check mode'}</span></div><div class="cards"><div class="card"><span class="muted">🎯 Prompt</span><h2>${esc(prompt)}</h2><button class="text-btn" data-speak="${esc(prompt)}">🔊 Hear model</button></div><div class="card"><span class="muted">🧠 Your target vocabulary</span><p>${shuffle(state.vocabulary).slice(0,6).map(v=>`<span class="tag">${esc(v.russian)}</span>`).join(' ')}</p></div></div><div class="card speak-box"><button class="mic-btn ${speechListening?'listening':''}" id="free-mic">${speechListening?'■':'🎤'}</button><div class="transcript" id="speak-transcript">${esc(window.__speakTranscript || 'Tap the microphone and answer.')}</div><div class="tiny muted">Free browser recognition may use an online recognition service depending on the browser. It is not guaranteed offline.</div><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="primary-btn" id="speak-grade">I finished speaking</button><button class="secondary-btn" id="speak-clear">Clear</button></div></div><div class="callout"><strong>How free speech works:</strong> this app uses the browser Web Speech API. Text-to-speech is broadly available; speech recognition has limited browser availability, so Chrome/Edge is the recommended desktop path.</div>`;
  }
  function buildSpeakPrompt() {
    const pool=shuffle(state.vocabulary); const a=pool[0], b=pool[1];
    if(a && b) return `Say a sentence using “${a.russian}” and “${b.russian}”.`;
    return a ? `Say a sentence using “${a.russian}”.` : 'Add vocabulary first, then I will give you speaking prompts.';
  }

  function renderProgress() {
    const score=scoreEstimate(), [lvl,desc]=levelFromScore(score); const max=Math.max(1,state.vocabulary.length); const mastered=state.vocabulary.filter(v=>v.mastery>=80).length;
    const last7=[]; for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);last7.push(dayKey(d));}
    const bars=last7.map(k=>`<div class="bar"><div style="height:${Math.max(4,Math.min(100,(dayStats(k).xp/Math.max(1,state.settings.dailyGoal))*100))}%"></div><small>${k.slice(5)}</small></div>`).join('');
    return `<div class="page-head"><div><h1>Progress</h1><p>${lvl} · ${desc}. Your score is an adaptive estimate, not an official CEFR test.</p></div></div><div class="cards"><div class="card"><span class="muted">Russian Score</span><div class="stat-number">${score}/160</div><div class="progress-track"><div class="progress-fill" style="width:${score/1.6}%"></div></div></div><div class="card"><span class="muted">Mastered items</span><div class="stat-number">${mastered}</div><span class="tiny muted">of ${max}</span></div><div class="card"><span class="muted">Accuracy</span><div class="stat-number">${state.stats.accuracy||0}%</div><span class="tiny muted">Across recorded answers</span></div></div><div class="charts"><div class="card"><h3>XP · last 7 days</h3><div class="bar-chart">${bars}</div></div><div class="card"><h3>Skill health</h3>${GRAMMAR.map(g=>{const m=Math.round(state.concepts[g.id]||0);return `<div style="margin:12px 0"><div style="display:flex;justify-content:space-between"><span>${esc(g.name)}</span><strong>${m}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${m}%"></div></div></div>`}).join('')}</div></div>`;
  }

  function achievements() {
    const xp=state.stats.xp, words=state.vocabulary.length, streak=state.stats.streak, mastered=state.vocabulary.filter(v=>v.mastery>=80).length;
    return [
      ['🌱','First word',words>=1],['📚','10 words',words>=10],['🔥','7 day streak',streak>=7],['💯','100 XP',xp>=100],['🏆','10 mastered',mastered>=10],['🎯','90% accuracy',Number(state.stats.accuracy)>=90],['🗣️','First speaking session',state.events.some(e=>e.exercise_type==='speaking')],['📖','First reading check',Boolean(localStorage.getItem('rl2_story_done'))]
    ];
  }
  function renderAchievements(){ return `<div class="page-head"><div><h1>Achievements</h1><p>Small milestones keep a long study journey visible.</p></div></div><div class="milestones">${achievements().map(([icon,name,on])=>`<div class="achievement ${on?'':'locked'}"><div class="achievement-icon">${icon}</div><div><strong>${esc(name)}</strong><div class="tiny muted">${on?'Unlocked':'Locked'}</div></div></div>`).join('')}</div>`; }

  function renderLeaderboard() {
    return `<div class="page-head"><div><h1>League</h1><p>A simple weekly XP board. Your private learning remains yours; only the display name and XP are shown.</p></div></div><div class="leader-grid"><div class="card"><h3>This week</h3><div class="leader-row"><span class="rank">1</span><div><strong>You</strong><div class="tiny muted">Your current profile</div></div><strong>${weekXP()} XP</strong></div><div class="leader-row"><span class="rank">2</span><div><strong>Goal</strong><div class="tiny muted">Beat your personal best</div></div><strong>${Math.max(weekXP(),1)+25} XP</strong></div><div class="leader-row"><span class="rank">3</span><div><strong>Next milestone</strong><div class="tiny muted">Keep studying</div></div><strong>${Math.max(weekXP(),1)+50} XP</strong></div></div><div class="card"><h3>Social-ready mode</h3><p class="muted">A full friend system needs a public profile + friendship table. The database schema included in this upgrade prepares the account layer, but this free release keeps the leaderboard personal so you don't need to expose your identity before you choose to.</p><button class="secondary-btn" data-route="settings">Profile settings</button></div></div>`;
  }
  function weekXP(){let total=0;for(let i=0;i<7;i++){const d=new Date();d.setDate(d.getDate()-i);total+=dayStats(dayKey(d)).xp||0;}return total;}

  function renderSettings(){return `<div class="page-head"><div><h1>Settings</h1><p>Control the free learning experience.</p></div></div><div class="cards"><div class="card"><h3>Account</h3><p class="muted">${state.mode==='cloud'?'Cloud sync enabled':'Local mode — data stays on this browser.'}</p><button class="outline-btn" id="open-auth">${state.mode==='cloud'?'Account':'Sign in / create account'}</button>${state.mode==='cloud'?'<button class="danger-btn" id="sign-out" style="margin-left:8px">Sign out</button>':''}</div><div class="card"><h3>Daily goal</h3><p><strong>${state.settings.dailyGoal} XP</strong></p><input id="daily-goal" type="range" min="10" max="100" step="5" value="${state.settings.dailyGoal}" style="width:100%"><div class="tiny muted">Adjust how much XP you aim to earn each day.</div></div><div class="card"><h3>Russian voice</h3><select id="voice-select" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:10px"></select><div style="margin-top:10px"><label class="tiny muted">Speech rate<input id="voice-rate" type="range" min="0.6" max="1.1" step="0.05" value="${state.settings.voiceRate}" style="width:100%"></label></div></div><div class="card"><h3>Backup</h3><p class="muted">Keep a local JSON backup before major changes.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="secondary-btn" data-export>Export</button><button class="secondary-btn" id="clear-local">Clear local cache</button></div></div></div><div class="callout"><strong>Free-tool note:</strong> there is no paid AI key in this release. Phrase generation, adaptive scheduling, reading questions and speech practice use local JavaScript and browser speech APIs. Browser speech recognition is limited in support and may process audio through a service depending on browser configuration.</div>`;}

  function renderRoute(){
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.route===route));
    $('#top-title').textContent = ({home:'Home',learn:'Learn',review:'Review',flashcards:'Flashcards',phrases:'Phrase Lab',speak:'Speak',stories:'Read & Listen',vocabulary:'Vocabulary',leaderboard:'League',achievements:'Achievements',progress:'Progress',settings:'Settings'})[route] || 'Russian Learner';
    if(route==='home') $('#view').innerHTML=renderHome();
    else if(route==='flashcards') $('#view').innerHTML=renderFlashcards();
    else if(route==='phrases') $('#view').innerHTML=renderPhrases();
    else if(route==='learn') $('#view').innerHTML=renderLearn();
    else if(route==='review') $('#view').innerHTML=renderReview();
    else if(route==='speak') $('#view').innerHTML=renderSpeak();
    else if(route==='stories') $('#view').innerHTML=renderStories();
    else if(route==='vocabulary') $('#view').innerHTML=renderVocabulary();
    else if(route==='leaderboard') $('#view').innerHTML=renderLeaderboard();
    else if(route==='achievements') $('#view').innerHTML=renderAchievements();
    else if(route==='progress') $('#view').innerHTML=renderProgress();
    else if(route==='settings') { $('#view').innerHTML=renderSettings(); setTimeout(buildVoices,0); }
  }
  function updateHeader(){
    $('#top-streak').textContent=state.stats.streak||0; $('#side-streak').textContent=state.stats.streak||0; $('#top-xp').textContent=dayStats().xp||0; $('#side-xp').textContent=dayStats().xp||0; $('#top-gems').textContent=state.stats.gems||0;
    $('#profile-btn').textContent=(state.profile.avatar||state.profile.display_name||'RU').slice(0,2).toUpperCase();
  }
  function render(){ updateHeader(); renderRoute(); }

  function navigate(to){ route=to; if(to!=='review') reviewSession=null; if(to!=='flashcards') flashSession=null; if(to!=='stories') storySession=null; render(); window.scrollTo({top:0,behavior:'smooth'}); }

  function exportBackup(){ const blob=new Blob([JSON.stringify({version:2,exported_at:isoNow(),state},null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`russian-learner-${dayKey()}.json`;a.click();URL.revokeObjectURL(a.href); }
  function importBackup(file){ const reader=new FileReader(); reader.onload=()=>{try{const data=JSON.parse(reader.result); if(data.state){state=mergeState(defaultState(),data.state);saveLocal();render();toast('Backup imported.');}else throw new Error();}catch{toast('That backup file is not valid.');}}; reader.readAsText(file); }

  async function doAuth(mode='signin'){
    if(!cloud){toast('Cloud login is not configured yet. Local mode is available.');return;}
    $('#auth-title').textContent=mode==='signup'?'Create your account':'Welcome back'; $('#auth-subtitle').textContent=mode==='signup'?'Your progress will sync across devices.':'Sign in to sync your progress.'; $('#auth-confirm-wrap').classList.toggle('hidden',mode!=='signup'); $('#auth-password-label').textContent=mode==='signup'?'Password (6+ characters)':'Password'; $('#auth-password').autocomplete=mode==='signup'?'new-password':'current-password'; $('#auth-submit').textContent=mode==='signup'?'Create account':'Sign in'; $('#auth-modal').dataset.mode=mode; openModal('auth-modal'); }
  async function submitAuth(e){ e.preventDefault(); if(!cloud){closeModal('auth-modal');return;} const mode=$('#auth-modal').dataset.mode||'signin'; const email=$('#auth-email').value.trim(); const password=$('#auth-password').value; const confirm=$('#auth-confirm')?.value||''; if(mode==='signup'&&password!==confirm){toast('Passwords do not match.');return;} $('#auth-submit').disabled=true;
    try{
      if(mode==='signup'){
        const {data,error}=await cloud.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}}); if(error) throw error; if(data.user){toast('Account created. Check your email if confirmation is enabled.');closeModal('auth-modal');}
      } else { const {data,error}=await cloud.auth.signInWithPassword({email,password}); if(error) throw error; if(data.user){state.mode='cloud';state.profile.id=data.user.id;state.profile.email=data.user.email||email;await loadCloud();saveLocal();closeModal('auth-modal');toast('Signed in.');render();} }
    } catch(err){toast(err.message||'Authentication failed.');} finally {$('#auth-submit').disabled=false;}
  }
  async function signOut(){ if(cloud) await cloud.auth.signOut(); state.mode='local';state.profile.id=null;state.profile.email='';saveLocal();toast('Signed out. Local mode remains available.');render(); }

  function openModal(id){const m=$(`#${id}`);if(m){m.classList.add('open');m.setAttribute('aria-hidden','false');}}
  function closeModal(id){const m=$(`#${id}`);if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');}}

  document.addEventListener('click', async (e) => {
    const nav=e.target.closest('[data-route]'); if(nav){navigate(nav.dataset.route);return;}
    const start=e.target.closest('[data-start]'); if(start){if(start.dataset.start==='review') startReview('review',10); else startReview('adaptive',10);return;}
    if(e.target.closest('[data-start-flashcards]')){startFlashcards(12);return;}
    if(e.target.closest('[data-new-phrase]')){route='phrases';render();return;}
    if(e.target.closest('[data-check-input]')){const input=$('#exercise-input');if(input&&reviewSession&&!reviewSession.answered){const v=input.value.trim();const item=reviewSession.item;let correct=false;if(reviewSession.type==='translation')correct=norm(v)===norm(item.english);else if(reviewSession.type==='typing')correct=norm(v)===norm(item.russian);else if(reviewSession.type==='fill')correct=norm(v)===norm(item.russian)||norm(item.russian).includes(norm(v));answerReview(correct,v);}return;}
    if(e.target.closest('[data-check-speech]')){if(reviewSession&&!reviewSession.answered){const v=norm(reviewSession.lastSpeech||'');const target=norm(reviewSession.item.russian);answerReview(v===target||v.includes(target),v);}return;}
    const open=e.target.closest('[data-open]'); if(open){openModal(open.dataset.open);return;}
    const close=e.target.closest('[data-close]'); if(close){closeModal(close.dataset.close);return;}
    const sp=e.target.closest('[data-speak]'); if(sp){speak(sp.dataset.speak);return;}
    if(e.target.id==='menu-btn'){$('#sidebar').classList.toggle('open');return;}
    if(e.target.id==='auth-side-btn'||e.target.id==='profile-auth'||e.target.id==='open-auth'){doAuth('signin');return;}
    if(e.target.id==='profile-btn'){openModal('profile-modal');return;}
    if(e.target.id==='profile-settings'){closeModal('profile-modal');navigate('settings');return;}
    if(e.target.id==='auth-local'){closeModal('auth-modal');state.mode='local';saveLocal();toast('Using local mode.');return;}
    if(e.target.id==='auth-switch'){const current=$('#auth-modal').dataset.mode||'signin';doAuth(current==='signin'?'signup':'signin');return;}
    if(e.target.id==='sign-out'){await signOut();return;}
    if(e.target.id==='mic-btn' || e.target.id==='free-mic'){ if(!speechRecognizer){toast('Speech recognition is unavailable in this browser.');return;} if(speechListening){try{speechRecognizer.stop();}catch{}} else {try{speechRecognizer.start();}catch{}} return; }
    if(e.target.id==='speak-clear'){setSpeakTranscript('');return;}
    if(e.target.id==='speak-grade'){ const t=norm(window.__speakTranscript||''); addDailyXp(t.length>3?8:2); state.stats.daily[dayKey()].reviews++; if(t.length>3) state.stats.daily[dayKey()].correct++; saveLocal(); toast(t.length>3?'Speaking logged! +8 XP':'Keep practicing. +2 XP'); return; }
    if(e.target.id==='flashcard'){if(flashSession){flashSession.flipped=!flashSession.flipped;render();}return;}
    if(e.target.closest('[data-flash-grade]')){const g=e.target.closest('[data-flash-grade]').dataset.flashGrade;const item=flashSession.queue[flashSession.index];if(g==='Again')wrongAnswer(item,g,'flashcard');else correctAnswer(item,g,'flashcard');flashSession.index++;flashSession.flipped=false;render();return;}
    if(e.target.matches('[data-choice]')){
      if(!reviewSession||reviewSession.answered)return; const item=reviewSession.item; const val=e.target.dataset.choice; const correct=reviewSession.type==='choice'?norm(val)===norm(item.english):norm(val)===norm(item.russian); $$('.choice').forEach(b=>{if(norm(b.dataset.choice)===norm(item.english)||norm(b.dataset.choice)===norm(item.russian)){} }); e.target.classList.add(correct?'correct':'wrong'); answerReview(correct,val);return;
    }
    if(e.target.id==='check-bank'){ const slots=$$('#wordbank-slots .tag').map(x=>x.textContent.trim()).join(' '); const correct=norm(slots)===norm(reviewSession.item.russian); answerReview(correct,slots); return; }
    if(e.target.closest('.bank-token')){ const b=e.target.closest('.bank-token'); const host=$('#wordbank-slots'); if(host){const span=document.createElement('span');span.className='tag blue';span.textContent=b.dataset.token;host.appendChild(span);b.disabled=true;} return; }
    if(e.target.id==='exercise-input' && e.type==='click')return;
    if(e.target.closest('.exercise-card') && (e.target.tagName==='BUTTON') && e.target.id==='exercise-input')return;
    if(e.target.id==='story-check'){checkStory();localStorage.setItem('rl2_story_done','1');return;}
    if(e.target.id==='story-answer')return;
    if(e.target.id==='save-generated-phrase'){const hero=$('#view .hero');const p=hero?.querySelector('.prompt')?.textContent?.trim();if(p){try{newWord({russian:p,english:'Practice phrase',category:'Generated phrases',type:'phrase',notes:'Generated from my saved vocabulary.'});toast('Phrase saved.');}catch(err){toast(err.message);}}return;}
    if(e.target.closest('[data-grade]')){gradeReview(e.target.closest('[data-grade]').dataset.grade);return;}
    if(e.target.matches('[data-delete-word]')){const id=e.target.dataset.deleteWord; if(confirm('Delete this vocabulary item?')){state.vocabulary=state.vocabulary.filter(v=>v.id!==id);state.events=state.events.filter(x=>x.vocabulary_id!==id);state.mistakes=state.mistakes.filter(x=>x.vocabulary_id!==id);saveLocal();cloudDeleteWord(id);render();toast('Deleted.');}return;}
    if(e.target.matches('[data-export]')){exportBackup();return;}
    if(e.target.id==='clear-local'){if(confirm('Clear only this browser copy? Cloud data will remain.')){localStorage.removeItem(LS_KEY);state=defaultState();render();toast('Local cache cleared.');}return;}
    if(e.target.matches('[data-new-story]')){storySession=null;render();return;}
    if(e.target.matches('[data-unit]')){const topic=e.target.dataset.unit;const q=state.vocabulary.filter(v=>v.category===topic);if(q.length){reviewSession={queue:q.slice(0,10),index:0};nextReviewItem();}return;}
    if(e.target.matches('[data-speak]')) return;
  });

  document.addEventListener('input', (e)=>{
    if(e.target.id==='vocab-search'){window.__vocabQuery=e.target.value;render();setTimeout(()=>$('#vocab-search')?.focus(),0);}
    if(e.target.id==='daily-goal'){state.settings.dailyGoal=Number(e.target.value);saveLocal();render();}
    if(e.target.id==='voice-rate'){state.settings.voiceRate=Number(e.target.value);saveLocal();}
    if(e.target.id==='phrase-difficulty'){phraseDifficulty=Number(e.target.value);render();}
    if(e.target.id==='vocab-cat'){window.__vocabCat=e.target.value;render();}
  });
  document.addEventListener('change',(e)=>{
    if(e.target.id==='import-file'&&e.target.files?.[0])importBackup(e.target.files[0]);
    if(e.target.id==='voice-select'){state.settings.voiceName=e.target.value;saveLocal();}
  });
  document.addEventListener('keydown',(e)=>{
    if(e.key==='Enter' && route==='review' && reviewSession && !reviewSession.answered){ const input=$('#exercise-input'); if(input){ const v=input.value.trim(); let correct=false; const item=reviewSession.item; if(reviewSession.type==='translation') correct=norm(v)===norm(item.english); else if(reviewSession.type==='typing') correct=norm(v)===norm(item.russian); else if(reviewSession.type==='fill') correct=norm(v)===norm(item.russian).split(' ')[0] || norm(item.russian).includes(norm(v)); else if(reviewSession.type==='speaking') { const transcript=norm(reviewSession.lastSpeech||v);correct=transcript.includes(norm(item.russian)); } answerReview(correct,v); } }
  });

  $('#word-form').addEventListener('submit',(e)=>{e.preventDefault();try{newWord({russian:$('#word-russian').value,english:$('#word-english').value,category:$('#word-category').value,type:$('#word-type').value,notes:$('#word-notes').value});closeModal('word-modal');e.target.reset();$('#word-category').value='General';toast('Vocabulary added.');render();}catch(err){toast(err.message);}});
  $('#auth-form').addEventListener('submit',submitAuth);

  // Route bootstrap from URL hash if present.
  const hash=location.hash.replace('#/',''); if(hash) route=hash;
  boot();
})();
