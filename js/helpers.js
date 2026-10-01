/* Authoring helpers. Data files call these to describe topics, questions and flashcards.
   Q  : single-answer multiple choice   Q(section, question, correct, [wrong...], explanation)
   TF : true/false                      TF(section, statement, isTrue, explanation)
   MS : select all that apply           MS(section, question, [correct...], [wrong...], explanation)
   C  : flashcard                       C(section, front, back, memoryTip?)
   Options are shuffled at display time, so the correct answer is always written first. */
window.FRE1 = window.FRE1 || { topics: [] };
window.Q  = (s, q, a, w, e) => ({ k: 'q',  s, q, o: [a, ...w], a: [0], e });
window.TF = (s, q, t, e)    => ({ k: 'tf', s, q, o: ['True', 'False'], a: [t ? 0 : 1], e, noShuffle: true });
window.MS = (s, q, a, w, e) => ({ k: 'ms', s, q, o: [...a, ...w], a: a.map((_, i) => i), e });
window.C  = (s, f, b, m)    => ({ k: 'c',  s, f, b, m });
window.TOPIC = (meta, items) => window.FRE1.topics.push({ ...meta, items });
