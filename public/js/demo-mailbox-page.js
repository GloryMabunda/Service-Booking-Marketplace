// The demo mailbox (docs/demo.md): shows the emails the demo "sent", from
// GET /api/demo/emails. Text goes in as text; only links to this same site
// become clickable, so an email can't send anyone elsewhere.
import { el } from '/js/format.js';

const loading = document.querySelector('#mailbox-loading');
const off = document.querySelector('#mailbox-off');
const empty = document.querySelector('#mailbox-empty');
const list = document.querySelector('#mailbox-list');

// Plain text with this site's links made clickable
function withLinks(text) {
  const body = el('div', 'small');
  body.style.whiteSpace = 'pre-wrap';
  body.style.wordBreak = 'break-word';
  const pattern = /https?:\/\/[^\s)<>"]+/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    body.append(document.createTextNode(text.slice(last, match.index)));
    let sameSite;
    try {
      sameSite = new URL(match[0]).origin === location.origin;
    } catch {
      sameSite = false;
    }
    if (sameSite) {
      const link = el('a', '', match[0]);
      link.href = match[0];
      body.append(link);
    } else {
      body.append(document.createTextNode(match[0]));
    }
    last = match.index + match[0].length;
  }
  body.append(document.createTextNode(text.slice(last)));
  return body;
}

function emailCard(email) {
  const card = el('article', 'card mbg-card-raised');
  const body = el('div', 'card-body');
  body.append(el('h2', 'h5 text-body mb-1', email.subject));
  const sent = new Date(email.sentAt).toLocaleString('en-ZA');
  body.append(el('p', 'small text-secondary mb-3', `To ${email.to} · ${sent}`));
  body.append(withLinks(email.text));
  card.append(body);
  return card;
}

async function load() {
  try {
    const res = await fetch('/api/demo/emails', { cache: 'no-store' });
    loading.hidden = true;
    if (res.status === 404) {
      off.hidden = false;
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { emails } = await res.json();
    empty.hidden = emails.length > 0;
    list.replaceChildren(...emails.map(emailCard));
  } catch {
    loading.hidden = true;
    off.textContent = "We couldn't load the demo mailbox.";
    off.hidden = false;
  }
}

load();
// New emails show up without reloading
setInterval(() => {
  if (!document.hidden && off.hidden) load();
}, 5000);
