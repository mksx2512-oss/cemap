(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const DAY = 864e5, dayKey = (t = Date.now()) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;

/* ---------- data ---------- */
const topics = FRE1.topics.slice().sort((a, b) => a.id - b.id);
const questions = [], cards = [], secTitle = {};
topics.forEach(t => {
  t.sections.forEach(([id, title]) => secTitle[id] = title);
  t.items.forEach(it => {
    it.topic = t.id;
    if (it.k === 'c') { it.id = 'c' + hash(it.f); cards.push(it); }
    else { it.id = 'q' + hash(it.q); questions.push(it); }
  });
});
const qById = Object.fromEntries(questions.map(q => [q.id, q]));
const secName = id => id + ' ' + (secTitle[id] || '');

/* ---------- persistence ---------- */
const KEY = 'cemap-fre1-v1';
let S;
const blank = () => ({ q: {}, c: {}, days: {}, hist: [], theme: null, goal: 30, bm: {} });
try { S = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { S = blank(); }
let saveTimer; const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }, 150); };
const IV = [0, 0, 1, 3, 7, 16]; // days until due per Leitner box
const rec = (map, id) => map[id] || (map[id] = { box: 0, due: 0, ok: 0, no: 0, last: null });
function grade(map, id, good, easy) {
  const r = rec(map, id);
  if (good) { r.ok++; r.box = Math.min(5, r.box + (easy ? 2 : 1)); r.last = true; } else { r.no++; r.box = 1; r.last = false; }
  r.due = Date.now() + IV[r.box] * DAY;
  if (map === S.q || map === S.c) { const k = dayKey(); S.days[k] = (S.days[k] || 0) + 1; }
  save();
}
const isDue = r => r && r.box > 0 && r.due <= Date.now();
const streak = () => { let n = 0, t = Date.now(); if (!S.days[dayKey(t)]) t -= DAY; while (S.days[dayKey(t)]) { n++; t -= DAY; } return n; };

/* ---------- theme ---------- */
function applyTheme() { const t = S.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = t; }
applyTheme();
$('#aibtn').onclick = () => AI.settings(route);
$('#theme').onclick = () => { S.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); save(); };

/* ---------- routing ---------- */
const app = $('#app');
let cleanup = null, keyHandler = null;
const views = { tutor, home, build, cards: cardsBuild, ref, stats, quiz: () => Z ? (Z.fin ? renderResults(Z, false) : renderQuiz()) : home() };
function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  keyHandler = null;
  const v = (location.hash || '#home').slice(1);
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === v));
  (views[v] || home)();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
document.addEventListener('keydown', e => { if (keyHandler && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) keyHandler(e); });
const go = v => { if (location.hash === '#' + v) route(); else location.hash = v; };

/* ---------- stats helpers ---------- */
function topicStats(items) {
  let m = 0, l = 0, u = 0;
  items.forEach(q => { const r = S.q[q.id]; if (!r || !r.box) u++; else if (r.box >= 4) m++; else l++; });
  return { m, l, u, n: items.length };
}
const barHTML = s => `<div class="bar" title="${s.m} mastered · ${s.l} learning · ${s.u} unseen"><i class="m" style="width:${pct(s.m, s.n)}%"></i><i class="l" style="width:${pct(s.l, s.n)}%"></i></div>`;
function totals() {
  let ok = 0, no = 0; questions.forEach(q => { const r = S.q[q.id]; if (r) { ok += r.ok; no += r.no; } });
  return { ok, no, acc: pct(ok, ok + no) };
}

/* ---------- AI: grounding, chat, generation ---------- */
const STOP = new Set('the and for are but not you your with that this what which when where have has how why can does did from about into than then them they their there will would should could its was were been being any all one two out who whom give tell explain please'.split(' '));
const terms = s => [...new Set((s.toLowerCase().match(/[a-z0-9£%.]{3,}/g) || []).filter(w => !STOP.has(w)))];
const cardText = c => `[${c.s}] ${c.f}: ${c.b}${c.m ? ' (' + c.m + ')' : ''}`;
const qText = q => `[${q.s}] Q: ${q.q} Answer: ${q.a.map(i => q.o[i]).join('; ')}. ${q.e || ''}`;
/* Study notes from the app's own question bank and flashcards (not the book itself), for the AI to rely on. */
function notesFor(secs, query, cap = 40000) {
  const out = [], seen = new Set(), add = t => { if (!seen.has(t)) { seen.add(t); out.push(t); } };
  if (secs && secs.length) {
    cards.filter(c => secs.includes(c.s)).forEach(c => add('- ' + cardText(c)));
    questions.filter(q => !q.ai && secs.includes(q.s)).forEach(q => add('- ' + qText(q)));
  }
  const ts = query ? terms(query) : [];
  if (ts.length) {
    const sc = t => { const l = t.toLowerCase(); return ts.reduce((n, w) => n + (l.includes(w) ? 1 : 0), 0); };
    cards.map(c => [sc(cardText(c)), c]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 12).forEach(x => add('- ' + cardText(x[1])));
    questions.filter(q => !q.ai).map(q => [sc(qText(q)), q]).filter(x => x[0] > 1).sort((a, b) => b[0] - a[0]).slice(0, 10).forEach(x => add('- ' + qText(x[1])));
  }
  let s = ''; for (const l of out) { if (s.length + l.length > cap) break; s += l + '\n'; } return s;
}
const BASE = `You are a patient, accurate tutor helping a student prepare for the UK CeMAP exam module FRE1 (Financial Services, Regulation and Ethics: Industry, regulation and key parties; LIBF 2025/26 study text). Use UK spelling and plain English.
The STUDY NOTES below are condensed from the course material; treat them as the source of truth, including their figures (rates, allowances and thresholds change each year and exam answers follow the text). If you rely on anything not in the notes, say so and tell the student to confirm it in their study text. Never invent figures, dates or Act names; if unsure, say you are unsure. Stay on FRE1 and general study help.`;
const tutorSystem = notes => `${BASE}
Style: concise (under about 200 words unless asked for more), short paragraphs, **bold** the key terms, use "-" bullets where helpful, no tables or headings. When explaining, finish with a one-line memory hook if one would help. When quizzing, ask one question at a time and wait for the answer.

STUDY NOTES:
${notes || '(no matching notes found: answer carefully from general knowledge and flag that)'}`;

function md(src) {
  const lines = String(src).split('\n'); let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.trimEnd(), b = /^\s*[-*•]\s+(.*)/.exec(l), n = /^\s*\d+[.)]\s+(.*)/.exec(l);
    if (b || n) { const t = b ? 'ul' : 'ol'; if (list !== t) { close(); html += `<${t}>`; list = t; } html += `<li>${fmt((b || n)[1])}</li>`; }
    else if (!l.trim()) close();
    else { close(); html += `<p>${fmt(l.replace(/^#+\s*/, ''))}</p>`; }
  }
  close(); return html;
}
const aiSetupHTML = `<p>Switch on the AI tutor by adding your own Anthropic API key. It stays in this browser.</p><button class="b" data-setup>Add API key</button>`;

const tutorState = { msgs: [] };
function mountChat(el, st, o = {}) {
  let busy = false, ctl = null;
  if (!AI.ready()) { el.innerHTML = `<div class="chat-empty">${aiSetupHTML}</div>`; el.querySelector('[data-setup]').onclick = () => AI.settings(() => mountChat(el, st, o)); return; }
  el.innerHTML = `<div class="chat"><div class="msgs"></div><div class="chips"></div>
    <div class="row" style="align-items:flex-end;flex-wrap:nowrap"><textarea class="cin" rows="2" placeholder="${esc(o.placeholder || 'Ask anything about FRE1…')}"></textarea><button class="b csend">Send</button></div>
    <div class="mut sm" style="margin-top:6px">AI can make mistakes. Check important facts against your study text. <a href="#" class="cclear">Clear chat</a></div></div>`;
  const msgs = $('.msgs', el), cin = $('.cin', el), send = $('.csend', el), chips = $('.chips', el);
  const bubble = (role, text) => { const d = document.createElement('div'); d.className = 'bubble ' + role; d.innerHTML = role === 'user' ? fmt(text) : md(text); msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; };
  st.msgs.forEach(m => bubble(m.role, m.content));
  const drawChips = () => { chips.innerHTML = st.msgs.length ? '' : (o.chips || []).map(c => `<button class="chip">${esc(c)}</button>`).join(''); };
  drawChips();
  async function ask(text, label) {
    text = text.trim(); if (!text || busy) return;
    busy = true; send.textContent = 'Stop'; cin.value = ''; chips.innerHTML = '';
    st.msgs.push({ role: 'user', content: text }); bubble('user', label || text);
    const b = bubble('assistant', ''); b.innerHTML = '<span class="mut">Thinking…</span>';
    ctl = new AbortController();
    let hist = st.msgs.slice(-12); while (hist.length && hist[0].role !== 'user') hist.shift();
    const system = tutorSystem(notesFor(o.secs, text + ' ' + (o.seedText || '')));
    try {
      const full = await AI.stream({ system, messages: hist, max_tokens: 4000, effort: 'low', signal: ctl.signal, onText: (d, snap) => { b.innerHTML = md(snap); msgs.scrollTop = msgs.scrollHeight; } });
      st.msgs.push({ role: 'assistant', content: full }); b.innerHTML = md(full);
    } catch (e) {
      st.msgs.pop(); b.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`;
      if (e.code === 'auth' || e.code === 'no-key') AI.settings(() => mountChat(el, st, o));
    }
    busy = false; ctl = null; send.textContent = 'Send';
  }
  send.onclick = () => busy ? ctl && ctl.abort() : ask(cin.value);
  cin.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(cin.value); } e.stopPropagation(); });
  chips.onclick = e => { if (e.target.classList.contains('chip')) ask(e.target.textContent); };
  $('.cclear', el).onclick = e => { e.preventDefault(); if (!busy) { st.msgs.length = 0; mountChat(el, st, o); } };
  if (o.seed && !st.msgs.length) ask(o.seed, o.seedLabel);
}
function openModal(title, build) {
  const wrap = document.createElement('div'); wrap.className = 'modal';
  wrap.innerHTML = `<div class="sheet card tall"><div class="row spread"><h2 style="margin:0">${esc(title)}</h2><button class="b alt sm" data-x>Close</button></div><div class="mbody"></div></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.dataset.x !== undefined) close(); });
  build($('.mbody', wrap)); return close;
}
function askAbout(q, picked) {
  const L = 'ABCDEFGH', opts = q.o.map((o, i) => `${L[i]}) ${o}`).join('\n');
  const right = q.a.map(i => q.o[i]).join('; '), mine = picked && picked.length ? picked.map(i => q.o[i]).join('; ') : null;
  const seed = `I'm revising ${secName(q.s)}. Question: ${q.q}\n${q.k === 'tf' ? '' : opts + '\n'}Correct answer: ${right}\n${mine ? 'My answer: ' + mine + (mine === right ? ' (I got it right)' : ' (I got it wrong)') : 'I did not answer.'}\nExplain why the correct answer is right${mine && mine !== right ? ' and exactly why my choice is wrong' : ''}, then give me a short memory hook. Then offer to test me with a similar question.`;
  openModal('🤖 Ask about this question', el => mountChat(el, { msgs: [] }, { secs: [q.s], seed, seedLabel: 'Explain this question: ' + (q.q.length > 140 ? q.q.slice(0, 140) + '…' : q.q), seedText: q.q, placeholder: 'Ask a follow-up…', chips: ['Give me a similar question', 'Explain it more simply', 'What is the exam trap here?'] }));
}
async function streamInto(el, system, user, effort = 'medium') {
  if (!AI.ready()) { el.innerHTML = aiSetupHTML; el.querySelector('[data-setup]').onclick = () => AI.settings(() => streamInto(el, system, user, effort)); return; }
  el.innerHTML = '<span class="mut">Thinking…</span>';
  try { const full = await AI.stream({ system, messages: [{ role: 'user', content: user }], max_tokens: 4000, effort, onText: (d, snap) => { el.innerHTML = md(snap); } }); el.innerHTML = md(full); }
  catch (e) { el.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; }
}

/* AI-generated questions (kept in this browser, flagged "AI") */
const secTopic = {}; topics.forEach(t => t.sections.forEach(([id]) => secTopic[id] = t.id));
function addAIQ(r) {
  const id = 'q' + hash(r.q); if (qById[id]) return null;
  const q = { k: 'q', s: r.s, q: r.q, o: [r.c, ...r.w], a: [0], e: r.e, ai: true, topic: secTopic[r.s] || 1, id };
  questions.push(q); qById[id] = q; return q;
}
S.aiQ = S.aiQ || []; S.aiQ.forEach(addAIQ);
const GEN_SCHEMA = { type: 'object', additionalProperties: false, required: ['questions'], properties: { questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['section', 'question', 'correct', 'wrong', 'explanation'], properties: { section: { type: 'string' }, question: { type: 'string' }, correct: { type: 'string' }, wrong: { type: 'array', items: { type: 'string' } }, explanation: { type: 'string' } } } } } };
async function generateQuestions(secs, n, style, status) {
  let use = shuffle([...secs]).slice(0, 12);
  const notes = notesFor(use, '', 60000);
  const styles = { mixed: 'a mix of fact recall and short real-life scenarios', scenario: 'mostly short real-life client or firm scenarios that need the facts applied (as in a CeMAP exam)', numbers: 'mostly questions on figures, dates, thresholds, time limits and simple calculations drawn from the notes' };
  const system = `${BASE}\nYou write exam-style multiple-choice questions.`;
  const user = `Write ${n} NEW multiple-choice questions for FRE1, in ${styles[style] || styles.mixed}.
Rules:
- Base every question only on the STUDY NOTES. Use their figures exactly. Do not repeat or lightly reword any existing "Q:" in the notes.
- Each question tests a different point, with exactly one correct answer and exactly 3 plausible wrong answers of similar length (no "all of the above" or "none of the above").
- "section" must be one of these ids: ${use.join(', ')} (the section the question comes from).
- "explanation": 1-3 sentences saying why the answer is right and what trap the wrong answers set.
- Put the correct answer in "correct" and the wrong ones in "wrong".

STUDY NOTES:
${notes}`;
  status('Claude is writing your questions… (about 20–60 seconds)');
  const res = await AI.json({ system, user, schema: GEN_SCHEMA, effort: 'high', max_tokens: 14000 });
  const made = [];
  for (const r of (res.questions || [])) {
    const w = (r.wrong || []).map(x => String(x).trim()).filter(Boolean).slice(0, 3), c = String(r.correct || '').trim(), qt = String(r.question || '').trim();
    if (!qt || !c || w.length < 3 || new Set([c, ...w]).size < 4) continue;
    const s = use.includes(r.section) ? r.section : use[0], rec = { s, q: qt, c, w, e: String(r.explanation || '').trim() };
    const q = addAIQ(rec); if (q) { S.aiQ.push(rec); made.push(q); }
  }
  save(); return made;
}
function removeAIQ(q) {
  const i = questions.indexOf(q); if (i >= 0) questions.splice(i, 1); delete qById[q.id];
  S.aiQ = S.aiQ.filter(r => 'q' + hash(r.q) !== q.id); save();
}

/* ---------- TUTOR ---------- */
function tutor() {
  app.innerHTML = `<h1>AI tutor</h1><p class="sub">Ask anything about FRE1. Answers are grounded in the notes from this app's question bank and flashcards.</p><div class="card" id="tchat"></div>`;
  mountChat($('#tchat'), tutorState, { secs: null, chips: ['Compare IVA, DRO and bankruptcy', 'Teach me the IHT taper relief table with a memory trick', 'What is the difference between prudential and conduct regulation?', 'Quiz me on Topic 7 one question at a time', 'Explain joint tenancy vs tenants in common with an example'] });
}

/* ---------- HOME ---------- */
function home() {
  const T = totals(), all = topicStats(questions), today = S.days[dayKey()] || 0;
  const dueQ = questions.filter(q => isDue(S.q[q.id])).length, dueC = cards.filter(c => isDue(S.c[c.id])).length;
  const missed = questions.filter(q => S.q[q.id] && S.q[q.id].last === false).length;
  app.innerHTML = `
  <h1>Pass FRE1</h1>
  <p class="sub">${questions.filter(q => !q.ai).length} questions${questions.some(q => q.ai) ? ` (+${questions.filter(q => q.ai).length} AI-written)` : ''} · ${cards.length} flashcards · every topic of the FRE1 study text. Questions you get wrong come back sooner (spaced repetition).</p>
  <div class="grid g4">
    <div class="card stat"><div class="n">${streak()}🔥</div><div class="l">day streak</div></div>
    <div class="card stat"><div class="n">${today}/${S.goal}</div><div class="l">answered today</div></div>
    <div class="card stat"><div class="n">${T.acc}%</div><div class="l">overall accuracy</div></div>
    <div class="card stat"><div class="n">${pct(all.m, all.n)}%</div><div class="l">mastered</div></div>
  </div>
  <h2>Start studying</h2>
  <div class="grid g2">
    <div class="card"><h3>Smart review</h3><p class="mut sm">20 questions picked for you: due for review, previously missed, then new. Best daily habit.${dueQ ? ` <b>${dueQ} due now.</b>` : ''}</p><button class="b" data-a="smart">Start</button></div>
    <div class="card"><h3>Mock exam</h3><p class="mut sm">Timed, no feedback until the end, mixed from every topic. Change the length in the quiz builder.</p><button class="b" data-a="mock">Start 50 questions</button></div>
    <div class="card"><h3>Missed questions</h3><p class="mut sm">Drill everything you last got wrong. ${missed} waiting.</p><button class="b" data-a="missed" ${missed ? '' : 'disabled'}>Drill ${missed}</button></div>
    <div class="card"><h3>Flashcards</h3><p class="mut sm">Key terms, numbers and dates, with memory tips.${dueC ? ` <b>${dueC} due now.</b>` : ''}</p><button class="b" data-a="cards">Open flashcards</button></div>
    <div class="card"><h3>🤖 AI tutor</h3><p class="mut sm">${AI.ready() ? 'Ask questions, get explanations and memory tricks, or be quizzed. Also in the quiz builder: AI-written practice questions.' : 'Add your own Anthropic API key to unlock explanations, AI-written practice questions, answer checking and a study coach.'}</p><button class="b" data-a="tutor">${AI.ready() ? 'Open tutor' : 'Set up AI'}</button></div>
  </div>
  <h2>Topics</h2>
  <div class="grid g2">${topics.map(t => { const its = questions.filter(q => q.topic === t.id), s = topicStats(its); return `
    <div class="card"><div class="row spread"><h3>Topic ${t.id}: ${esc(t.title)}</h3><span class="mut sm">${its.length} Qs</span></div>
    ${barHTML(s)}<div class="row spread" style="margin-top:10px"><span class="mut sm">${s.m} mastered · ${s.l} learning · ${s.u} new</span>
    <button class="b sm" data-t="${t.id}">Quiz this topic</button></div></div>`; }).join('')}</div>`;
  app.onclick = e => {
    const a = e.target.dataset.a, t = e.target.dataset.t;
    if (a === 'smart') startQuiz({ n: 20, mode: 'practice', pick: 'smart', secs: allSecs(), types: ['q', 'tf', 'ms'] });
    if (a === 'mock') startQuiz({ n: 50, mode: 'exam', pick: 'random', secs: allSecs(), types: ['q', 'tf', 'ms'], mins: 60 });
    if (a === 'missed') startQuiz({ n: 999, mode: 'practice', pick: 'missed', secs: allSecs(), types: ['q', 'tf', 'ms'] });
    if (a === 'cards') go('cards');
    if (a === 'tutor') AI.ready() ? go('tutor') : AI.settings(home);
    if (t) { sel = new Set(topics.find(x => x.id == t).sections.map(s => s[0])); go('build'); }
  };
}
const allSecs = () => new Set(topics.flatMap(t => t.sections.map(s => s[0])));

/* ---------- selector tree ---------- */
let sel = allSecs();
function treeHTML(counter) {
  return `<div class="tree">${topics.map(t => {
    const ids = t.sections.map(s => s[0]), on = ids.filter(i => sel.has(i)).length;
    return `<label class="tp"><input type="checkbox" data-topic="${t.id}" ${on === ids.length ? 'checked' : ''}> Topic ${t.id}: ${esc(t.title)} <span class="mut sm">(${counter(ids)})</span></label>
    <div class="secs">${t.sections.map(([id, title]) => `<label><input type="checkbox" data-sec="${id}" ${sel.has(id) ? 'checked' : ''}> ${esc(id + ' ' + title)} <span class="mut sm">(${counter([id])})</span></label>`).join('')}</div>`;
  }).join('')}</div>`;
}
function bindTree(root, refresh) {
  root.addEventListener('change', e => {
    const d = e.target.dataset;
    if (d.topic) topics.find(t => t.id == d.topic).sections.forEach(([id]) => e.target.checked ? sel.add(id) : sel.delete(id));
    if (d.sec) e.target.checked ? sel.add(d.sec) : sel.delete(d.sec);
    refresh();
  });
}

/* ---------- QUIZ BUILDER ---------- */
let bo = { src: 'all', gen: 10, genStyle: 'mixed', n: 20, mode: 'practice', pick: 'smart', types: { q: 1, tf: 1, ms: 1 }, mins: 0 };
function build() {
  const cnt = ids => questions.filter(q => ids.includes(q.s)).length;
  app.innerHTML = `<h1>Build a quiz</h1><p class="sub">Choose what to test, how many questions, and how.</p>
  <div class="grid g2">
   <div class="card"><h3>Content</h3><div class="row" style="margin-bottom:6px"><button class="b alt sm" id="all">All</button><button class="b alt sm" id="none">None</button></div><div id="tree">${treeHTML(cnt)}</div></div>
   <div class="grid" style="align-content:start">
    <div class="card"><h3>Mode</h3><div class="seg" id="mode"><button data-v="practice">Practice (instant feedback)</button><button data-v="exam">Exam (timed)</button></div>
      <div id="timeRow" class="row" style="margin-top:10px">Time limit: <input type="number" id="mins" min="0" max="240" style="width:80px"> minutes (0 = none)</div></div>
    <div class="card"><h3>Questions</h3><div class="row"><input type="number" id="n" min="1" max="500" style="width:90px"> <button class="b alt sm" data-n="10">10</button><button class="b alt sm" data-n="25">25</button><button class="b alt sm" data-n="50">50</button><button class="b alt sm" data-n="999">All</button></div>
      <h3 style="margin-top:14px">Which questions first?</h3>
      <select id="pick"><option value="smart">Smart mix (due, missed, new)</option><option value="random">Random</option><option value="unseen">Unseen only</option><option value="missed">Previously missed</option><option value="due">Due for review</option><option value="bookmarked">Bookmarked</option></select>
      <h3 style="margin-top:14px">Source</h3>
      <select id="src"><option value="all">All questions</option><option value="bank">Official bank only</option><option value="ai">AI-written only</option></select>
      <h3 style="margin-top:14px">Question types</h3>
      <label><input type="checkbox" data-ty="q"> Multiple choice</label><br><label><input type="checkbox" data-ty="tf"> True / false</label><br><label><input type="checkbox" data-ty="ms"> Select all that apply</label></div>
    <div class="card"><div id="avail" class="mut" style="margin-bottom:10px"></div><button class="b" id="go">Start quiz</button></div>
    <div class="card"><h3>✨ AI-written practice questions</h3><p class="mut sm">Claude writes brand-new exam-style questions on the sections ticked on the left, then starts a practice quiz. They are saved with an <b>AI</b> tag; AI can slip up, so check answers against your text and remove any that look wrong.</p>
      <div class="row"><select id="gn"><option>5</option><option>10</option><option>15</option></select><select id="gs"><option value="mixed">Mixed</option><option value="scenario">Real-life scenarios</option><option value="numbers">Figures &amp; dates</option></select><button class="b" id="gen">Generate &amp; start</button></div><div id="genst" class="sm" style="margin-top:8px"></div></div>
   </div></div>`;
  const refresh = () => {
    $('#tree').innerHTML = treeHTML(cnt);
    $$('#mode button').forEach(b => b.classList.toggle('on', b.dataset.v === bo.mode));
    $('#timeRow').style.display = bo.mode === 'exam' ? '' : 'none';
    $('#n').value = bo.n > 500 ? 500 : bo.n; $('#mins').value = bo.mins; $('#pick').value = bo.pick; $('#src').value = bo.src; $('#gn').value = bo.gen; $('#gs').value = bo.genStyle;
    $$('[data-ty]').forEach(c => c.checked = !!bo.types[c.dataset.ty]);
    const n = poolFor({ ...bo, secs: sel, types: Object.keys(bo.types).filter(k => bo.types[k]) }).length;
    $('#avail').textContent = `${n} matching question${n === 1 ? '' : 's'}.`;
    $('#go').disabled = !n;
  };
  bindTree($('#tree'), refresh);
  $('#all').onclick = () => { sel = allSecs(); refresh(); };
  $('#none').onclick = () => { sel = new Set(); refresh(); };
  $('#mode').onclick = e => { if (e.target.dataset.v) { bo.mode = e.target.dataset.v; if (bo.mode === 'exam' && !bo.mins) bo.mins = Math.max(5, Math.round(bo.n * 1.2)); refresh(); } };
  $('#n').oninput = e => { bo.n = Math.max(1, +e.target.value || 1); refresh(); };
  $('#mins').oninput = e => { bo.mins = Math.max(0, +e.target.value || 0); };
  $('#pick').onchange = e => { bo.pick = e.target.value; refresh(); };
  $('#src').onchange = e => { bo.src = e.target.value; refresh(); };
  $('#gn').onchange = e => { bo.gen = +e.target.value; }; $('#gs').onchange = e => { bo.genStyle = e.target.value; };
  $('#gen').onclick = async () => {
    const st = $('#genst'); st.style.color = '';
    if (!AI.ready()) return AI.settings(() => { if (AI.ready()) $('#gen').click(); });
    if (!sel.size) { st.textContent = 'Tick at least one section first.'; return; }
    const btn = $('#gen'); btn.disabled = true;
    try {
      const made = await generateQuestions([...sel], bo.gen, bo.genStyle, t => st.textContent = t);
      if (!made.length) { st.style.color = 'var(--bad)'; st.textContent = 'No usable questions came back. Try again.'; btn.disabled = false; return; }
      startQuiz({ n: made.length, mode: 'practice', pick: 'random', secs: new Set(sel), types: ['q'], list: made });
    } catch (e) { st.style.color = 'var(--bad)'; st.textContent = e.message; btn.disabled = false; }
  };
  app.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { bo.n = +b.dataset.n; refresh(); });
  $$('[data-ty]').forEach(c => c.onchange = () => { bo.types[c.dataset.ty] = c.checked ? 1 : 0; refresh(); });
  $('#go').onclick = () => startQuiz({ ...bo, secs: new Set(sel), types: Object.keys(bo.types).filter(k => bo.types[k]) });
  refresh();
}

function poolFor(o) {
  return questions.filter(q => {
    if (!o.secs.has(q.s) || !o.types.includes(q.k)) return false;
    if (o.src === 'bank' && q.ai) return false;
    if (o.src === 'ai' && !q.ai) return false;
    const r = S.q[q.id];
    switch (o.pick) {
      case 'unseen': return !r || !r.box;
      case 'missed': return r && r.last === false;
      case 'due': return isDue(r);
      case 'bookmarked': return S.bm[q.id];
    }
    return true;
  });
}
function pickQuestions(o) {
  const pool = poolFor(o);
  if (o.pick === 'smart') {
    const w = q => { const r = S.q[q.id]; if (!r || !r.box) return 3; if (r.last === false) return 6; if (isDue(r)) return 4 + Math.min(3, (Date.now() - r.due) / DAY / 3); return r.box >= 5 ? .15 : .5; };
    return pool.map(q => ({ q, k: Math.pow(Math.random(), 1 / w(q)) })).sort((a, b) => b.k - a.k).slice(0, o.n).map(x => x.q);
  }
  return shuffle(pool).slice(0, o.n);
}

/* ---------- QUIZ SESSION ---------- */
let Z = null, timerId = null;
function startQuiz(o) {
  const qs = o.list || pickQuestions(o);
  if (!qs.length) { alert('No matching questions for those settings.'); return go('build'); }
  Z = { o, mode: o.mode, i: 0, start: Date.now(), limit: o.mode === 'exam' && o.mins ? o.mins * 60 : 0,
    items: qs.map(q => ({ q, order: q.noShuffle ? q.o.map((_, i) => i) : shuffle(q.o.map((_, i) => i)), picked: [], done: false, ok: null, flag: false })) };
  go('quiz');
}
function renderQuiz() {
  if (!Z) return go('home');
  if (cleanup) { cleanup(); cleanup = null; }
  const it = Z.items[Z.i], q = it.q, exam = Z.mode === 'exam', need = q.a.length;
  const letters = 'ABCDEFGH';
  $$('#nav a').forEach(a => a.classList.remove('on'));
  const reveal = it.done && !exam;
  const optHTML = it.order.map((oi, pos) => {
    let cls = '', dis = '';
    if (reveal) { dis = 'disabled'; if (q.a.includes(oi)) cls = 'right'; else if (it.picked.includes(oi)) cls = 'wrong'; }
    else if (it.picked.includes(oi)) cls = 'sel';
    return `<button class="opt ${cls}" data-o="${oi}" ${dis}><span class="k">${q.k === 'tf' ? (oi ? 'F' : 'T') : letters[pos]}</span><span>${fmt(q.o[oi])}</span></button>`;
  }).join('');
  const answered = Z.items.filter(x => x.picked.length).length;
  app.innerHTML = `
  <div class="row spread"><span class="mut">Question ${Z.i + 1} of ${Z.items.length} · ${answered} answered</span>
   <span class="row">${Z.limit ? '<span class="timer" id="timer"></span>' : ''}<button class="b alt sm" id="quit">Quit</button></span></div>
  <div class="bar" style="margin:8px 0 14px"><i class="m" style="width:${pct(Z.i + (it.done ? 1 : 0), Z.items.length)}%"></i></div>
  <div class="card">
   <div class="row spread"><span><span class="tag">Topic ${q.topic}</span><span class="tag">${esc(secName(q.s))}</span>${q.ai ? '<span class="tag ai">AI-written</span>' : ''}</span>
     <button class="b alt sm" id="bm">${S.bm[q.id] ? '★ Bookmarked' : '☆ Bookmark'}</button></div>
   <div class="qtext">${fmt(q.q)}</div>
   ${q.k === 'ms' ? `<div class="mut sm">Select all that apply (${need} correct)</div>` : ''}
   ${optHTML}
   ${q.k === 'ms' && !it.done && !exam ? `<button class="b" id="check" ${it.picked.length ? '' : 'disabled'}>Check answer</button>` : ''}
   ${reveal ? `<div class="fb ${it.ok ? 'ok' : 'bad'}"><div class="h">${it.ok ? '✓ Correct' : '✗ Not quite'}</div>${fmt(q.e || '')}</div>
   <div class="row" style="margin-top:10px"><button class="b alt sm" id="askai">🤖 Explain / ask AI</button>${q.ai ? '<button class="b alt sm" id="rmai">Remove this AI question</button>' : ''}</div>` : ''}
  </div>
  ${exam ? `<div class="pal">${Z.items.map((x, j) => `<button data-j="${j}" class="${x.picked.length ? 'ans' : ''} ${j === Z.i ? 'cur' : ''} ${x.flag ? 'flag' : ''}">${j + 1}</button>`).join('')}</div>` : ''}
  <div class="row spread" style="margin-top:14px">
   <span class="row">${exam ? `<button class="b alt" id="prev" ${Z.i ? '' : 'disabled'}>← Prev</button><button class="b alt" id="flag">${it.flag ? '⚑ Unflag' : '⚐ Flag'}</button>` : ''}</span>
   <span class="row">${exam ? `<button class="b alt" id="next" ${Z.i < Z.items.length - 1 ? '' : 'disabled'}>Next →</button><button class="b" id="finish">Finish exam</button>`
     : `<button class="b" id="next" ${it.done ? '' : 'disabled'}>${Z.i < Z.items.length - 1 ? 'Next →' : 'See results'}</button>`}</span>
  </div>
  <p class="mut sm">Keys: 1–${q.o.length} choose · Enter ${exam ? 'next' : 'check / next'}${exam ? ' · ← → move · F flag' : ''}</p>`;

  const pick = oi => {
    if (it.done && !exam) return;
    if (q.k === 'ms') it.picked = it.picked.includes(oi) ? it.picked.filter(x => x !== oi) : [...it.picked, oi];
    else it.picked = [oi];
    if (!exam && q.k !== 'ms') return finishQ(it);
    renderQuiz();
  };
  const next = () => { if (Z.i < Z.items.length - 1) { Z.i++; renderQuiz(); } else if (!exam && it.done) finishQuiz(); };
  const check = () => { if (q.k === 'ms' && it.picked.length && !it.done && !exam) finishQ(it); };
  app.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.o !== undefined) pick(+b.dataset.o);
    else if (b.dataset.j !== undefined) { Z.i = +b.dataset.j; renderQuiz(); }
    else if (b.id === 'next') next();
    else if (b.id === 'prev') { Z.i--; renderQuiz(); }
    else if (b.id === 'check') check();
    else if (b.id === 'askai') askAbout(q, it.picked.map(i => i));
    else if (b.id === 'rmai') { if (confirm('Remove this AI-written question from your bank?')) { removeAIQ(q); Z.items.splice(Z.i, 1); if (!Z.items.length) { Z = null; go('build'); } else { Z.i = Math.min(Z.i, Z.items.length - 1); renderQuiz(); } } }
    else if (b.id === 'flag') { it.flag = !it.flag; renderQuiz(); }
    else if (b.id === 'bm') { S.bm[q.id] ? delete S.bm[q.id] : S.bm[q.id] = 1; save(); renderQuiz(); }
    else if (b.id === 'quit') { if (confirm('Quit this quiz? Answers in a practice quiz are already saved.')) { stopTimer(); Z = null; go('home'); } }
    else if (b.id === 'finish') { const un = Z.items.filter(x => !x.picked.length).length; if (!un || confirm(`${un} question${un > 1 ? 's are' : ' is'} unanswered. Finish anyway?`)) finishQuiz(); }
  };
  keyHandler = e => {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= it.order.length) pick(it.order[n - 1]);
    else if (e.key === 'Enter') { if (q.k === 'ms' && !it.done && !exam) check(); else if (exam || it.done) next(); }
    else if (exam && e.key === 'ArrowRight') next();
    else if (exam && e.key === 'ArrowLeft' && Z.i) { Z.i--; renderQuiz(); }
    else if (exam && e.key.toLowerCase() === 'f') { it.flag = !it.flag; renderQuiz(); }
  };
  if (Z.limit) { startTimer(); }
}
function startTimer() {
  stopTimer();
  const tick = () => {
    const left = Z.limit - Math.floor((Date.now() - Z.start) / 1000), el = $('#timer');
    if (left <= 0) { stopTimer(); return finishQuiz(); }
    if (el) { el.textContent = '⏱ ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); el.classList.toggle('low', left < 120); }
  };
  tick(); timerId = setInterval(tick, 1000);
  cleanup = stopTimer;
}
function stopTimer() { clearInterval(timerId); timerId = null; }
const isRight = it => it.picked.length === it.q.a.length && it.q.a.every(a => it.picked.includes(a));
function finishQ(it) { it.done = true; it.ok = isRight(it); grade(S.q, it.q.id, it.ok); renderQuiz(); }
function finishQuiz() {
  stopTimer(); if (!Z) return;
  const exam = Z.mode === 'exam';
  Z.items.forEach(it => { if (!it.done) { it.done = true; it.ok = isRight(it); if (exam && it.picked.length) grade(S.q, it.q.id, it.ok); else if (exam) grade(S.q, it.q.id, false); } });
  const R = Z; R.secs = Math.round((Date.now() - R.start) / 1000);
  const c = R.items.filter(i => i.ok).length;
  S.hist.push({ t: Date.now(), mode: R.mode, n: R.items.length, c, secs: R.secs }); S.hist = S.hist.slice(-100); save();
  renderResults(R, false);
}
function renderResults(R, wrongOnly) {
  Z = R; Z.fin = true; keyHandler = null; app.onclick = null;
  const n = R.items.length, c = R.items.filter(i => i.ok).length, p = pct(c, n);
  const byTopic = topics.map(t => { const its = R.items.filter(i => i.q.topic === t.id); return its.length ? { t, n: its.length, c: its.filter(i => i.ok).length } : null; }).filter(Boolean);
  const list = R.items.filter(i => !wrongOnly || !i.ok);
  const msg = p >= 80 ? 'Excellent — keep it fresh with regular review.' : p >= 60 ? 'Getting there. Review the misses below, then retry them.' : 'Plenty to learn from here. Read the explanations, then retry the missed ones.';
  app.innerHTML = `<h1>Results</h1>
  <div class="card row" style="gap:24px"><div class="ring" style="--p:${p}"><span>${p}%</span></div>
   <div><div style="font-size:22px;font-weight:700">${c} / ${n} correct</div><div class="mut">${Math.floor(R.secs / 60)}m ${R.secs % 60}s · ${R.mode === 'exam' ? 'exam' : 'practice'}</div><div>${msg}</div></div></div>
  ${byTopic.length > 1 ? `<h2>By topic</h2><div class="card">${byTopic.map(x => `<div class="row spread"><span>Topic ${x.t.id}: ${esc(x.t.title)}</span><span>${x.c}/${x.n}</span></div><div class="bar" style="margin:4px 0 10px"><i class="m" style="width:${pct(x.c, x.n)}%"></i></div>`).join('')}</div>` : ''}
  <div class="row" style="margin:16px 0"><button class="b" id="retry" ${c < n ? '' : 'disabled'}>Retry missed (${n - c})</button><button class="b alt" id="again">New quiz</button><button class="b alt" id="toggle">${wrongOnly ? 'Show all answers' : 'Show only missed'}</button>${c < n ? '<button class="b alt" id="debrief">🤖 Debrief my mistakes</button>' : ''}</div>
  <div class="card" id="dbox" style="display:none;margin-bottom:12px"></div>
  <h2>Review</h2>${list.map(it => { const q = it.q; return `<div class="card" style="margin-bottom:10px"><div class="row spread"><span><span class="tag">${esc(secName(q.s))}</span></span><span><b style="color:var(--${it.ok ? 'ok' : 'bad'})">${it.ok ? '✓' : (it.picked.length ? '✗' : '– skipped')}</b> <button class="b alt sm" data-ask="${R.items.indexOf(it)}">🤖 Ask AI</button></span></div>
   <div class="qtext">${fmt(q.q)}</div>
   ${q.o.map((o, oi) => { const right = q.a.includes(oi), mine = it.picked.includes(oi); return `<div class="opt ${right ? 'right' : mine ? 'wrong' : ''}" style="cursor:default;margin:4px 0;padding:8px 12px"><span class="k">${right ? '✓' : mine ? '✗' : ''}</span><span>${fmt(o)}${mine ? ' <i class="mut sm">(your answer)</i>' : ''}</span></div>`; }).join('')}
   <div class="fb ${it.ok ? 'ok' : 'bad'}">${fmt(q.e || '')}</div></div>`; }).join('') || '<p class="mut">Nothing to show.</p>'}`;
  $('#retry').onclick = () => { const miss = R.items.filter(i => !i.ok).map(i => i.q);
    Z = { o: R.o, mode: 'practice', i: 0, start: Date.now(), limit: 0, items: miss.map(q => ({ q, order: q.noShuffle ? q.o.map((_, i) => i) : shuffle(q.o.map((_, i) => i)), picked: [], done: false, ok: null, flag: false })) }; renderQuiz(); };
  $('#again').onclick = () => { Z = null; go('build'); };
  $('#toggle').onclick = () => renderResults(R, !wrongOnly);
  app.onclick = e => { const i = e.target.dataset.ask; if (i !== undefined) { const it = R.items[+i]; askAbout(it.q, it.picked); } };
  const db = $('#debrief');
  if (db) db.onclick = () => {
    const box = $('#dbox'); box.style.display = ''; box.scrollIntoView({ block: 'nearest' });
    const miss = R.items.filter(i => !i.ok).slice(0, 25).map(i => `- [${secName(i.q.s)}] ${i.q.q} | Correct: ${i.q.a.map(x => i.q.o[x]).join('; ')} | I chose: ${i.picked.length ? i.picked.map(x => i.q.o[x]).join('; ') : 'nothing'}`).join('\n');
    streamInto(box, `${BASE}\nYou are a study coach. Be encouraging and specific. Format: short paragraphs and "-" bullets, **bold** key terms, no tables or headings.\n\nSTUDY NOTES:\n${notesFor([...new Set(R.items.filter(i => !i.ok).map(i => i.q.s))], '', 20000)}`, `I just did a quiz (${c}/${n}). Here are the questions I missed:\n${miss}\n\nFind the 2-3 themes behind my mistakes (e.g. mixing up similar terms or figures), tell me exactly what to remember for each with a memory trick, and say which sections to revise next.`);
  };
  window.scrollTo(0, 0);
}

/* ---------- FLASHCARDS ---------- */
let co = { pick: 'smart', n: 30 };
function cardsBuild() {
  const cnt = ids => cards.filter(c => ids.includes(c.s)).length;
  app.innerHTML = `<h1>Flashcards</h1><p class="sub">Say the answer out loud (or write it) <i>before</i> flipping — recalling is what builds memory. Cards you miss return sooner.</p>
  <div class="grid g2"><div class="card"><div class="row" style="margin-bottom:6px"><button class="b alt sm" id="all">All</button><button class="b alt sm" id="none">None</button></div><div id="tree">${treeHTML(cnt)}</div></div>
  <div class="card" style="align-self:start"><h3>Which cards?</h3><select id="pick"><option value="smart">Due first, then new</option><option value="due">Due only</option><option value="new">New only</option><option value="all">All, shuffled</option><option value="hard">Cards I find hard</option></select>
   <h3 style="margin-top:14px">How many?</h3><input type="number" id="n" min="1" max="999" style="width:90px"><div id="avail" class="mut" style="margin:12px 0"></div><button class="b" id="go">Start</button></div></div>`;
  const pool = () => cards.filter(c => { if (!sel.has(c.s)) return false; const r = S.c[c.id]; return co.pick === 'due' ? isDue(r) : co.pick === 'new' ? !r || !r.box : co.pick === 'hard' ? r && r.no > 0 && r.box < 4 : true; });
  const refresh = () => { $('#tree').innerHTML = treeHTML(cnt); $('#pick').value = co.pick; $('#n').value = co.n; const n = pool().length; $('#avail').textContent = `${n} matching card${n === 1 ? '' : 's'}.`; $('#go').disabled = !n; };
  bindTree($('#tree'), refresh);
  $('#all').onclick = () => { sel = allSecs(); refresh(); }; $('#none').onclick = () => { sel = new Set(); refresh(); };
  $('#pick').onchange = e => { co.pick = e.target.value; refresh(); };
  $('#n').oninput = e => { co.n = Math.max(1, +e.target.value || 1); };
  $('#go').onclick = () => {
    let p = pool();
    if (co.pick === 'smart') { const due = shuffle(p.filter(c => isDue(S.c[c.id]))), nw = shuffle(p.filter(c => !S.c[c.id] || !S.c[c.id].box)), rest = shuffle(p.filter(c => !due.includes(c) && !nw.includes(c))); p = [...due, ...nw, ...rest]; }
    else p = shuffle(p);
    runCards(p.slice(0, co.n));
  };
  refresh();
}
function runCards(queue) {
  let flipped = false, total = queue.length, done = 0, again = 0, typed = '', verdict = null;
  const show = () => {
    if (!queue.length) {
      app.innerHTML = `<h1>Session complete 🎉</h1><div class="card"><p>You reviewed ${total} card${total === 1 ? '' : 's'} (${again} needed another look).</p><div class="row"><button class="b" id="r">Back to flashcards</button><button class="b alt" id="h">Home</button></div></div>`;
      $('#r').onclick = () => go('cards'); $('#h').onclick = () => go('home'); keyHandler = null; app.onclick = null; return;
    }
    const c = queue[0];
    app.innerHTML = `<div class="row spread"><span class="mut">${done} / ${total} done · ${queue.length} left</span><button class="b alt sm" id="q">End session</button></div>
    <div class="bar" style="margin:8px 0 14px"><i class="m" style="width:${pct(done, total)}%"></i></div>
    <div class="card fcard" id="fc"><div><div class="tag">${esc(secName(c.s))}</div>${flipped ? `<div class="back">${fmt(c.b)}</div>${c.m ? `<div class="tip">💡 ${fmt(c.m)}</div>` : ''}` : `<div style="margin-top:10px">${fmt(c.f)}</div><div class="mut sm" style="margin-top:18px">Tap or press Space to reveal</div>`}</div></div>
    ${!flipped && AI.ready() ? `<div class="card" style="margin-top:12px"><textarea id="ans" rows="2" style="width:100%" placeholder="Optional: type what you remember, then let AI check it">${esc(typed)}</textarea><div class="row" style="margin-top:8px"><button class="b sm" id="chk">🤖 Check my answer</button><span id="chkst" class="sm"></span></div></div>` : ''}
    ${flipped && verdict ? `<div class="fb ${verdict.verdict === 'correct' ? 'ok' : 'bad'}" style="margin-top:12px"><div class="h">${verdict.verdict === 'correct' ? '✓ Correct' : verdict.verdict === 'partly' ? '◐ Partly right' : '✗ Not quite'}</div>${fmt(verdict.feedback)}<div class="mut sm" style="margin-top:6px">Your answer: ${esc(typed)}</div></div>` : ''}
    ${flipped ? `<div class="row" style="margin-top:14px;justify-content:center"><button class="b bad" data-g="0">Again (1)</button><button class="b" data-g="1">Got it (2)</button><button class="b ok" data-g="2">Easy (3)</button></div>` : ''}`;
    const flip = () => { flipped = true; show(); };
    const rate = g => {
      const c = queue.shift(); flipped = false; typed = ''; verdict = null;
      if (g === 0) { again++; grade(S.c, c.id, false); queue.splice(Math.min(queue.length, 3), 0, c); }
      else { grade(S.c, c.id, true, g === 2); done++; }
      show();
    };
    $('#fc').onclick = () => { if (!flipped) flip(); };
    $('#q').onclick = () => go('cards');
    app.onclick = async e => {
      const g = e.target.dataset.g; if (g !== undefined) return rate(+g);
      if (e.target.id === 'chk') {
        typed = $('#ans').value.trim(); const st = $('#chkst'); if (!typed) { st.textContent = 'Type something first.'; return; }
        e.target.disabled = true; st.style.color = ''; st.textContent = 'Checking…';
        try {
          verdict = await AI.json({ system: `${BASE}\nYou mark a student's recalled answer to a flashcard. Compare it with the official answer. "correct" = the key facts are all there (wording may differ); "partly" = some key facts missing or one wrong; "incorrect" = mostly wrong. Feedback: 1-3 friendly sentences naming exactly what was right and what was missing or wrong.`, user: `Flashcard front: ${c.f}\nOfficial answer: ${c.b}\nStudent's answer: ${typed}`, schema: { type: 'object', additionalProperties: false, required: ['verdict', 'feedback'], properties: { verdict: { type: 'string', enum: ['correct', 'partly', 'incorrect'] }, feedback: { type: 'string' } } }, effort: 'low', max_tokens: 1500 });
          flipped = true; show();
        } catch (err) { st.style.color = 'var(--bad)'; st.textContent = err.message; e.target.disabled = false; }
      }
    };
    keyHandler = e => { if (!flipped && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); flip(); } else if (flipped && '123'.includes(e.key) && e.key) rate(+e.key - 1); };
  };
  show();
}

/* ---------- KEY FACTS ---------- */
function ref() {
  app.innerHTML = `<h1>Key facts</h1><p class="sub">Every flashcard as a searchable cheat sheet. Skim a section just before quizzing it.</p>
  <input type="text" id="s" placeholder="Search terms, numbers, acts…"><div id="out"></div>`;
  const draw = () => {
    const term = $('#s').value.toLowerCase().trim();
    $('#out').innerHTML = topics.map(t => {
      const secs = t.sections.map(([id, title]) => {
        const cs = cards.filter(c => c.s === id && (!term || (c.f + ' ' + c.b + ' ' + (c.m || '')).toLowerCase().includes(term)));
        return cs.length ? `<h3 style="margin-top:14px">${esc(id + ' ' + title)}</h3>${cs.map(c => `<div class="fact"><b>${fmt(c.f)}</b>${fmt(c.b)}${c.m ? `<div class="sm" style="color:var(--warn)">💡 ${fmt(c.m)}</div>` : ''}</div>`).join('')}` : '';
      }).join('');
      return secs ? `<h2>Topic ${t.id}: ${esc(t.title)}</h2><div class="card">${secs}</div>` : '';
    }).join('') || '<p class="mut">No matches.</p>';
  };
  $('#s').oninput = draw; draw();
}

/* ---------- PROGRESS ---------- */
function stats() {
  const rows = topics.map(t => {
    const secs = t.sections.map(([id, title]) => {
      const qs = questions.filter(q => q.s === id), s = topicStats(qs);
      let ok = 0, no = 0; qs.forEach(q => { const r = S.q[q.id]; if (r) { ok += r.ok; no += r.no; } });
      return { id, title, qs: qs.length, s, ok, no, acc: ok + no ? pct(ok, ok + no) : null };
    });
    return { t, secs };
  });
  const weak = rows.flatMap(r => r.secs).filter(x => x.ok + x.no >= 3 && x.acc < 75).sort((a, b) => a.acc - b.acc).slice(0, 6);
  const last14 = Array.from({ length: 14 }, (_, i) => { const k = dayKey(Date.now() - (13 - i) * DAY); return { k, n: S.days[k] || 0 }; }), mx = Math.max(10, ...last14.map(d => d.n));
  app.innerHTML = `<h1>Progress</h1>
  <div class="card" style="margin-bottom:12px"><div class="row spread"><h3 style="margin:0">🤖 Study coach</h3><button class="b sm" id="coach">Get my study plan</button></div><div id="coachout" class="coachout mut sm">Claude reads your accuracy by section and recent quizzes and tells you what to do next.</div></div>
  <div class="card"><h3>Last 14 days (answers per day)</h3><div class="row" style="align-items:flex-end;gap:6px;height:90px">${last14.map(d => `<div title="${d.k}: ${d.n}" style="flex:1;background:${d.n ? 'var(--pri)' : 'var(--line)'};height:${Math.max(4, 100 * d.n / mx)}%;border-radius:4px"></div>`).join('')}</div></div>
  ${weak.length ? `<h2>Weakest areas</h2><div class="card">${weak.map(w => `<div class="row spread" style="margin:4px 0"><span>${esc(w.id + ' ' + w.title)} <span class="mut sm">${w.acc}% accuracy</span></span><button class="b sm" data-d="${w.id}">Drill</button></div>`).join('')}</div>` : ''}
  <h2>By section</h2>${rows.map(r => `<div class="card" style="margin-bottom:12px"><h3>Topic ${r.t.id}: ${esc(r.t.title)}</h3><table><tr><th>Section</th><th>Qs</th><th>Accuracy</th><th style="width:30%">Mastery</th><th></th></tr>${r.secs.map(x => `<tr><td>${esc(x.id + ' ' + x.title)}</td><td>${x.qs}</td><td>${x.acc === null ? '–' : x.acc + '%'}</td><td>${barHTML(x.s)}</td><td><button class="b alt sm" data-d="${x.id}">Quiz</button></td></tr>`).join('')}</table></div>`).join('')}
  <h2>Recent quizzes</h2><div class="card">${S.hist.slice(-8).reverse().map(h => `<div class="row spread"><span>${new Date(h.t).toLocaleString()} · ${h.mode}</span><b>${h.c}/${h.n} (${pct(h.c, h.n)}%)</b></div>`).join('') || '<span class="mut">No quizzes yet.</span>'}</div>
  <h2>Settings & data</h2><div class="card"><div class="row">Daily goal: <input type="number" id="goal" min="5" max="500" value="${S.goal}" style="width:80px"> answers</div>
   <div class="row" style="margin-top:12px"><button class="b alt" id="exp">Export progress</button><label class="b alt" style="cursor:pointer">Import<input type="file" id="imp" accept=".json" hidden></label><button class="b alt" id="reset">Reset everything</button></div>
   <p class="mut sm">Progress is stored in this browser only. Export a backup now and then.</p></div>`;
  app.onclick = e => { const d = e.target.dataset.d; if (d) { sel = new Set([d]); bo.n = 20; bo.pick = 'random'; startQuiz({ ...bo, mode: 'practice', pick: 'random', secs: sel, types: ['q', 'tf', 'ms'], n: 20 }); } };
  $('#coach').onclick = () => {
    const lines = rows.flatMap(r => r.secs).filter(x => x.ok + x.no > 0).map(x => `- ${x.id} ${x.title}: ${x.ok + x.no} answers, ${x.acc}% correct, ${x.s.m}/${x.qs} questions mastered`);
    const untouched = rows.flatMap(r => r.secs).filter(x => x.ok + x.no === 0).map(x => `${x.id} ${x.title}`);
    if (!lines.length) { $('#coachout').innerHTML = '<span class="mut">Answer some questions first so there is something to coach.</span>'; return; }
    const recent = S.hist.slice(-6).map(h => `${h.mode} ${h.c}/${h.n}`).join(', ') || 'none';
    streamInto($('#coachout'), `${BASE}\nYou are a study coach for a student sitting FRE1. Give a practical plan: the 3 highest-priority sections (use their ids), what exactly to do for each (this app has: quizzes by section, flashcards, a key facts sheet, an AI tutor and AI-written questions), and a simple 7-day rhythm. Be specific, encouraging and brief (under 250 words). Format: short paragraphs and "-" bullets, **bold** key terms, no tables or headings.`, `My progress by section:\n${lines.join('\n')}\n\nNot started yet: ${untouched.join('; ') || 'nothing'}\nRecent quizzes: ${recent}\nStreak: ${streak()} days. Daily goal: ${S.goal} answers.\nQuestions still marked as missed: ${questions.filter(q => S.q[q.id] && S.q[q.id].last === false).length}.`);
  };
  $('#goal').onchange = e => { S.goal = Math.max(5, +e.target.value || 30); save(); };
  $('#exp').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' })); a.download = 'fre1-progress.json'; a.click(); };
  $('#imp').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { S = Object.assign(blank(), JSON.parse(t)); save(); alert('Imported.'); route(); } catch (x) { alert('That file could not be read.'); } }); };
  $('#reset').onclick = () => { if (confirm('Erase all progress?')) { S = blank(); try { localStorage.removeItem(KEY); } catch (x) {} route(); } };
}

if (location.hash === '#quiz') location.hash = '#home';
route();
})();
