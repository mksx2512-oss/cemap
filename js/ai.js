/* Thin wrapper around the Anthropic SDK (vendor/anthropic-sdk.js) for use directly in the browser.
   The student's own API key is kept in this browser's localStorage and is only ever sent to api.anthropic.com. */
(() => {
'use strict';
const CFG_KEY = 'cemap-fre1-ai';
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5: best quality (recommended)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5: faster, cheaper' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5: fastest, cheapest' },
];
let cfg = { key: '', model: MODELS[0].id };
try { cfg = Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) {}
if (!MODELS.some(m => m.id === cfg.model)) cfg.model = MODELS[0].id;
const persist = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} };

let client = null, clientKey = '';
function getClient() {
  if (!cfg.key) throw new AIError('no-key', 'Add your Anthropic API key first (🤖 button at the top).');
  if (!window.Anthropic) throw new AIError('no-sdk', 'The AI library failed to load. Check your connection and reload.');
  if (!client || clientKey !== cfg.key) {
    // Safe here: the key belongs to the person using this browser and never goes anywhere except Anthropic.
    client = new window.Anthropic({ apiKey: cfg.key, dangerouslyAllowBrowser: true });
    clientKey = cfg.key;
  }
  return client;
}

class AIError extends Error { constructor(code, message) { super(message); this.code = code; } }

function friendly(e) {
  if (e instanceof AIError) return e;
  const A = window.Anthropic || {};
  if (A.AuthenticationError && e instanceof A.AuthenticationError) return new AIError('auth', 'Anthropic rejected the API key. Check it in the 🤖 settings.');
  if (A.PermissionDeniedError && e instanceof A.PermissionDeniedError) return new AIError('perm', 'This API key is not allowed to use that model.');
  if (A.NotFoundError && e instanceof A.NotFoundError) return new AIError('notfound', 'That model is not available to your account. Pick another in the 🤖 settings.');
  if (A.RateLimitError && e instanceof A.RateLimitError) return new AIError('rate', 'Rate limit reached. Wait a moment and try again.');
  if (A.APIConnectionError && e instanceof A.APIConnectionError) return new AIError('net', 'Could not reach Anthropic. Check your internet connection.');
  if (A.APIUserAbortError && e instanceof A.APIUserAbortError) return new AIError('abort', 'Stopped.');
  if (e && e.name === 'AbortError') return new AIError('abort', 'Stopped.');
  if (A.APIError && e instanceof A.APIError) {
    const m = (e.error && e.error.error && e.error.error.message) || e.message;
    return new AIError('api', 'Anthropic API error' + (e.status ? ' (' + e.status + ')' : '') + ': ' + m);
  }
  return new AIError('unknown', (e && e.message) || 'Something went wrong.');
}

const textOf = msg => msg.content.filter(b => b.type === 'text').map(b => b.text).join('');

/* Stream a reply. onText(delta, fullSoFar) is called as text arrives. Resolves with the full text. */
async function stream({ system, messages, max_tokens = 4000, effort = 'low', onText, signal }) {
  try {
    const s = getClient().messages.stream({
      model: cfg.model, max_tokens, system, messages, output_config: { effort },
    }, { signal });
    if (onText) s.on('text', (d, snap) => onText(d, snap));
    const msg = await s.finalMessage();
    if (msg.stop_reason === 'refusal') throw new AIError('refusal', 'Claude declined to answer that one. Try rephrasing it as a study question.');
    const t = textOf(msg);
    if (msg.stop_reason === 'max_tokens') return t + '\n\n(reply was cut off: ask me to continue)';
    return t;
  } catch (e) { throw friendly(e); }
}

/* Ask for JSON that matches `schema` (structured outputs). Resolves with the parsed object. */
async function json({ system, user, schema, max_tokens = 12000, effort = 'medium', signal }) {
  try {
    const s = getClient().messages.stream({
      model: cfg.model, max_tokens, system, messages: [{ role: 'user', content: user }],
      output_config: { effort, format: { type: 'json_schema', schema } },
    }, { signal });
    const msg = await s.finalMessage();
    if (msg.stop_reason === 'refusal') throw new AIError('refusal', 'Claude declined that request.');
    const raw = textOf(msg).trim();
    try { return JSON.parse(raw); } catch (e) {
      const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
      if (a >= 0 && b > a) return JSON.parse(raw.slice(a, b + 1));
      throw new AIError('parse', 'The AI reply could not be read. Try again.');
    }
  } catch (e) { throw friendly(e); }
}

/* Settings dialog */
function settings(onDone) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="sheet card" role="dialog" aria-label="AI settings">
    <div class="row spread"><h2 style="margin:0">🤖 AI settings</h2><button class="b alt sm" data-x>Close</button></div>
    <p class="mut sm">AI features call Claude directly from this page using <b>your own</b> Anthropic API key. The key is saved only in this browser and sent only to api.anthropic.com. Usage is billed to your Anthropic account, so set a monthly spend limit in the Anthropic Console. Don't enter it on a shared computer.</p>
    <label class="sm mut">API key (<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">get one</a>)</label>
    <input type="password" id="aik" placeholder="sk-ant-..." autocomplete="off" value="${cfg.key.replace(/"/g, '')}">
    <label class="sm mut" style="margin-top:10px;display:block">Model</label>
    <select id="aim" style="width:100%">${MODELS.map(m => `<option value="${m.id}" ${m.id === cfg.model ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
    <div class="row" style="margin-top:14px"><button class="b" data-save>Save &amp; test</button><button class="b alt" data-rm>Remove key</button></div>
    <div id="aistat" class="sm" style="margin-top:10px"></div></div>`;
  document.body.appendChild(wrap);
  const $ = s => wrap.querySelector(s), close = () => { wrap.remove(); onDone && onDone(); };
  wrap.addEventListener('click', async e => {
    if (e.target === wrap || e.target.dataset.x !== undefined) return close();
    if (e.target.dataset.rm !== undefined) { cfg.key = ''; persist(); $('#aik').value = ''; $('#aistat').textContent = 'Key removed from this browser.'; return; }
    if (e.target.dataset.save !== undefined) {
      cfg.key = $('#aik').value.trim(); cfg.model = $('#aim').value; persist();
      const st = $('#aistat'); st.style.color = ''; st.textContent = 'Testing…';
      try {
        const r = await stream({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], max_tokens: 200, effort: 'low' });
        st.style.color = 'var(--ok)'; st.textContent = '✓ Connected (' + cfg.model + ')' + (r ? '' : '');
      } catch (err) { st.style.color = 'var(--bad)'; st.textContent = '✗ ' + err.message; }
    }
  });
}

window.AI = {
  MODELS, stream, json, settings, AIError,
  ready: () => !!cfg.key,
  model: () => cfg.model,
};
})();
