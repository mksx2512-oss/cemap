# CeMAP FRE1 Trainer

An interactive quiz and revision app built from the **FRE1: Industry, regulation and key parties** study text
(Topics 1–8). No build step and no server: open `index.html` in a browser (or host the folder anywhere static).

## What's in it

- **807 questions** (single choice, true/false, select-all-that-apply), each with an explanation and a section reference.
- **191 flashcards** with memory tips, plus a searchable **Key facts** cheat sheet.
- **Smart review**: spaced repetition (Leitner boxes). Missed questions return sooner; mastered ones fade out.
- **Quiz builder**: pick any topics or sections, length, question types, and how to choose questions
  (smart mix, random, unseen, missed, due, bookmarked).
- **Practice mode** (instant feedback) and **Exam mode** (timer, question palette, flagging, review at the end).
- **Progress**: mastery by section, accuracy, weakest areas with one-click drills, daily goal and streak.
- **AI features (optional, bring your own Anthropic API key):**
  - **AI tutor**: chat about anything in FRE1, grounded in the notes from the question bank and flashcards; streams answers.
  - **Explain / ask AI** on any question, during practice or in the results review (it knows what you chose).
  - **AI-written practice questions** for the sections you tick, saved with an "AI" tag (removable if one looks wrong).
  - **Flashcard answer checking**: type what you remember and Claude marks it.
  - **Debrief my mistakes** after a quiz, and a **Study coach** plan on the Progress page.
- Bookmarks, dark mode, keyboard shortcuts (`1–5` choose, `Enter` check/next, space to flip cards), mobile friendly.
- Progress is saved in the browser (localStorage). Export/import a backup from the Progress page.

## Using the AI features

Click the 🤖 button, paste an Anthropic API key (from console.anthropic.com), pick a model, and press *Save & test*.
The key is stored only in your browser's localStorage and is sent only to api.anthropic.com. It is never included in the progress export.
You are billed by Anthropic for usage, so set a spend limit in the Console. Without a key the app works exactly as before.
AI answers can be wrong: the app tells Claude to rely on the in-app notes and to flag anything else, but always confirm important facts in your study text.

## Layout

```
index.html        page shell
css/style.css     styling
js/helpers.js     Q / TF / MS / C authoring helpers
js/ai.js          Anthropic SDK wrapper (streaming, structured output, settings dialog)
js/app.js         the app
vendor/           browser bundle of @anthropic-ai/sdk 0.132.0 (esbuild, no CDN needed)
data/topicN.js    one question bank per topic
```

## Adding or editing questions

Each `data/topicN.js` calls `TOPIC(meta, items)`. The correct answer is written first and options are shuffled at display time:

```js
Q('2.3.4', 'The IHT nil-rate band is:', '£325,000', ['£175,000', '£500,000', '£650,000'], 'Explanation shown after answering.')
TF('1.2', 'Equities have a fixed maturity date.', false, 'Explanation.')
MS('1.2', 'Which are money market instruments?', ['Commercial paper', 'T-bills'], ['Shares'], 'Explanation.')
C('2.3.4', 'IHT nil-rate band', '£325,000', 'optional memory tip')
```

Question progress is keyed by a hash of the question text, so reordering is safe; editing the wording resets progress for that one question.

## Note

Rates, allowances and thresholds (tax, benefits, etc.) follow the figures in the study text and change each year. Check your syllabus for the version you are sitting.
