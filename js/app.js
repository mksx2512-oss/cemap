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
$('#theme').onclick = () => { S.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); save(); };

/* ---------- routing ---------- */
const app = $('#app');
let cleanup = null, keyHandler = null;
const views = { home, build, cards: cardsBuild, ref, stats, quiz: () => Z ? (Z.fin ? renderResults(Z, false) : renderQuiz()) : home() };
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

/* ---------- HOME ---------- */
function home() {
  const T = totals(), all = topicStats(questions), today = S.days[dayKey()] || 0;
  const dueQ = questions.filter(q => isDue(S.q[q.id])).length, dueC = cards.filter(c => isDue(S.c[c.id])).length;
  const missed = questions.filter(q => S.q[q.id] && S.q[q.id].last === false).length;
  app.innerHTML = `
  <h1>Pass FRE1</h1>
  <p class="sub">${questions.length} questions · ${cards.length} flashcards · every topic of the FRE1 study text. Questions you get wrong come back sooner (spaced repetition).</p>
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
let bo = { n: 20, mode: 'practice', pick: 'smart', types: { q: 1, tf: 1, ms: 1 }, mins: 0 };
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
      <h3 style="margin-top:14px">Question types</h3>
      <label><input type="checkbox" data-ty="q"> Multiple choice</label><br><label><input type="checkbox" data-ty="tf"> True / false</label><br><label><input type="checkbox" data-ty="ms"> Select all that apply</label></div>
    <div class="card"><div id="avail" class="mut" style="margin-bottom:10px"></div><button class="b" id="go">Start quiz</button></div>
   </div></div>`;
  const refresh = () => {
    $('#tree').innerHTML = treeHTML(cnt);
    $$('#mode button').forEach(b => b.classList.toggle('on', b.dataset.v === bo.mode));
    $('#timeRow').style.display = bo.mode === 'exam' ? '' : 'none';
    $('#n').value = bo.n > 500 ? 500 : bo.n; $('#mins').value = bo.mins; $('#pick').value = bo.pick;
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
  app.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { bo.n = +b.dataset.n; refresh(); });
  $$('[data-ty]').forEach(c => c.onchange = () => { bo.types[c.dataset.ty] = c.checked ? 1 : 0; refresh(); });
  $('#go').onclick = () => startQuiz({ ...bo, secs: new Set(sel), types: Object.keys(bo.types).filter(k => bo.types[k]) });
  refresh();
}

function poolFor(o) {
  return questions.filter(q => {
    if (!o.secs.has(q.s) || !o.types.includes(q.k)) return false;
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
  const qs = pickQuestions(o);
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
   <div class="row spread"><span><span class="tag">Topic ${q.topic}</span><span class="tag">${esc(secName(q.s))}</span></span>
     <button class="b alt sm" id="bm">${S.bm[q.id] ? '★ Bookmarked' : '☆ Bookmark'}</button></div>
   <div class="qtext">${fmt(q.q)}</div>
   ${q.k === 'ms' ? `<div class="mut sm">Select all that apply (${need} correct)</div>` : ''}
   ${optHTML}
   ${q.k === 'ms' && !it.done && !exam ? `<button class="b" id="check" ${it.picked.length ? '' : 'disabled'}>Check answer</button>` : ''}
   ${reveal ? `<div class="fb ${it.ok ? 'ok' : 'bad'}"><div class="h">${it.ok ? '✓ Correct' : '✗ Not quite'}</div>${fmt(q.e || '')}</div>` : ''}
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
  <div class="row" style="margin:16px 0"><button class="b" id="retry" ${c < n ? '' : 'disabled'}>Retry missed (${n - c})</button><button class="b alt" id="again">New quiz</button><button class="b alt" id="toggle">${wrongOnly ? 'Show all answers' : 'Show only missed'}</button></div>
  <h2>Review</h2>${list.map(it => { const q = it.q; return `<div class="card" style="margin-bottom:10px"><div class="row spread"><span><span class="tag">${esc(secName(q.s))}</span></span><b style="color:var(--${it.ok ? 'ok' : 'bad'})">${it.ok ? '✓' : (it.picked.length ? '✗' : '– skipped')}</b></div>
   <div class="qtext">${fmt(q.q)}</div>
   ${q.o.map((o, oi) => { const right = q.a.includes(oi), mine = it.picked.includes(oi); return `<div class="opt ${right ? 'right' : mine ? 'wrong' : ''}" style="cursor:default;margin:4px 0;padding:8px 12px"><span class="k">${right ? '✓' : mine ? '✗' : ''}</span><span>${fmt(o)}${mine ? ' <i class="mut sm">(your answer)</i>' : ''}</span></div>`; }).join('')}
   <div class="fb ${it.ok ? 'ok' : 'bad'}">${fmt(q.e || '')}</div></div>`; }).join('') || '<p class="mut">Nothing to show.</p>'}`;
  $('#retry').onclick = () => { const miss = R.items.filter(i => !i.ok).map(i => i.q);
    Z = { o: R.o, mode: 'practice', i: 0, start: Date.now(), limit: 0, items: miss.map(q => ({ q, order: q.noShuffle ? q.o.map((_, i) => i) : shuffle(q.o.map((_, i) => i)), picked: [], done: false, ok: null, flag: false })) }; renderQuiz(); };
  $('#again').onclick = () => { Z = null; go('build'); };
  $('#toggle').onclick = () => renderResults(R, !wrongOnly);
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
  let flipped = false, total = queue.length, done = 0, again = 0;
  const show = () => {
    if (!queue.length) {
      app.innerHTML = `<h1>Session complete 🎉</h1><div class="card"><p>You reviewed ${total} card${total === 1 ? '' : 's'} (${again} needed another look).</p><div class="row"><button class="b" id="r">Back to flashcards</button><button class="b alt" id="h">Home</button></div></div>`;
      $('#r').onclick = () => go('cards'); $('#h').onclick = () => go('home'); keyHandler = null; app.onclick = null; return;
    }
    const c = queue[0];
    app.innerHTML = `<div class="row spread"><span class="mut">${done} / ${total} done · ${queue.length} left</span><button class="b alt sm" id="q">End session</button></div>
    <div class="bar" style="margin:8px 0 14px"><i class="m" style="width:${pct(done, total)}%"></i></div>
    <div class="card fcard" id="fc"><div><div class="tag">${esc(secName(c.s))}</div>${flipped ? `<div class="back">${fmt(c.b)}</div>${c.m ? `<div class="tip">💡 ${fmt(c.m)}</div>` : ''}` : `<div style="margin-top:10px">${fmt(c.f)}</div><div class="mut sm" style="margin-top:18px">Tap or press Space to reveal</div>`}</div></div>
    ${flipped ? `<div class="row" style="margin-top:14px;justify-content:center"><button class="b bad" data-g="0">Again (1)</button><button class="b" data-g="1">Got it (2)</button><button class="b ok" data-g="2">Easy (3)</button></div>` : ''}`;
    const flip = () => { flipped = true; show(); };
    const rate = g => {
      const c = queue.shift(); flipped = false;
      if (g === 0) { again++; grade(S.c, c.id, false); queue.splice(Math.min(queue.length, 3), 0, c); }
      else { grade(S.c, c.id, true, g === 2); done++; }
      show();
    };
    $('#fc').onclick = () => { if (!flipped) flip(); };
    $('#q').onclick = () => go('cards');
    app.onclick = e => { const g = e.target.dataset.g; if (g !== undefined) rate(+g); };
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
  <div class="card"><h3>Last 14 days (answers per day)</h3><div class="row" style="align-items:flex-end;gap:6px;height:90px">${last14.map(d => `<div title="${d.k}: ${d.n}" style="flex:1;background:${d.n ? 'var(--pri)' : 'var(--line)'};height:${Math.max(4, 100 * d.n / mx)}%;border-radius:4px"></div>`).join('')}</div></div>
  ${weak.length ? `<h2>Weakest areas</h2><div class="card">${weak.map(w => `<div class="row spread" style="margin:4px 0"><span>${esc(w.id + ' ' + w.title)} <span class="mut sm">${w.acc}% accuracy</span></span><button class="b sm" data-d="${w.id}">Drill</button></div>`).join('')}</div>` : ''}
  <h2>By section</h2>${rows.map(r => `<div class="card" style="margin-bottom:12px"><h3>Topic ${r.t.id}: ${esc(r.t.title)}</h3><table><tr><th>Section</th><th>Qs</th><th>Accuracy</th><th style="width:30%">Mastery</th><th></th></tr>${r.secs.map(x => `<tr><td>${esc(x.id + ' ' + x.title)}</td><td>${x.qs}</td><td>${x.acc === null ? '–' : x.acc + '%'}</td><td>${barHTML(x.s)}</td><td><button class="b alt sm" data-d="${x.id}">Quiz</button></td></tr>`).join('')}</table></div>`).join('')}
  <h2>Recent quizzes</h2><div class="card">${S.hist.slice(-8).reverse().map(h => `<div class="row spread"><span>${new Date(h.t).toLocaleString()} · ${h.mode}</span><b>${h.c}/${h.n} (${pct(h.c, h.n)}%)</b></div>`).join('') || '<span class="mut">No quizzes yet.</span>'}</div>
  <h2>Settings & data</h2><div class="card"><div class="row">Daily goal: <input type="number" id="goal" min="5" max="500" value="${S.goal}" style="width:80px"> answers</div>
   <div class="row" style="margin-top:12px"><button class="b alt" id="exp">Export progress</button><label class="b alt" style="cursor:pointer">Import<input type="file" id="imp" accept=".json" hidden></label><button class="b alt" id="reset">Reset everything</button></div>
   <p class="mut sm">Progress is stored in this browser only. Export a backup now and then.</p></div>`;
  app.onclick = e => { const d = e.target.dataset.d; if (d) { sel = new Set([d]); bo.n = 20; bo.pick = 'random'; startQuiz({ ...bo, mode: 'practice', pick: 'random', secs: sel, types: ['q', 'tf', 'ms'], n: 20 }); } };
  $('#goal').onchange = e => { S.goal = Math.max(5, +e.target.value || 30); save(); };
  $('#exp').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' })); a.download = 'fre1-progress.json'; a.click(); };
  $('#imp').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { S = Object.assign(blank(), JSON.parse(t)); save(); alert('Imported.'); route(); } catch (x) { alert('That file could not be read.'); } }); };
  $('#reset').onclick = () => { if (confirm('Erase all progress?')) { S = blank(); try { localStorage.removeItem(KEY); } catch (x) {} route(); } };
}

if (location.hash === '#quiz') location.hash = '#home';
route();
})();
