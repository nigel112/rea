/**
 * Messages: match list + conversation.
 *
 * The conversation view is intentionally plain: bubbles, day markers, optimistic send with a
 * client id for idempotency, and an honest "read on open" model. No typing indicators, no read
 * receipts for free accounts — those are premium, and the UI says so once, quietly.
 */
import { endpoints } from '../api.js';
import { esc, avatar, toast, emptyState, timeAgo, clockTime, dayLabel, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';

export async function render(host, context) {
  const { params } = context;
  const matchId = params.matchId ?? null;

  host.innerHTML = `
    <div class="row row--between" style="margin-bottom:var(--sp-4)">
      <div>
        <h1 style="margin:0;font-size:var(--step-3)">Messages</h1>
        <p class="muted small" style="margin:.15rem 0 0">Messaging is free. Nobody pays to say hello here.</p>
      </div>
    </div>
    <div class="messenger">
      <aside class="card card--flat" style="min-width:0">
        <div class="card__head" style="padding:.75rem 1rem">${icon('users', { size: 17 })}<h2 style="font-size:.95rem">Your matches</h2></div>
        <div style="padding:.5rem" id="thread-list">${loadingRows()}</div>
      </aside>
      <section class="card" id="conversation" style="min-height:60vh"></section>
    </div>`;

  const listEl = host.querySelector('#thread-list');
  const conversationEl = host.querySelector('#conversation');

  let matches = [];
  try {
    const data = await endpoints.matches();
    matches = data.matches ?? [];
  } catch (error) {
    listEl.innerHTML = `<p class="small muted" style="padding:1rem">${esc(error.message)}</p>`;
    return;
  }

  paintList(listEl, matches, matchId);
  if (matches.length === 0) {
    conversationEl.innerHTML = emptyState({
      title: 'No matches yet',
      body: 'When you and someone else like each other, the conversation starts here. Discovery gets you there.',
      iconName: 'chat',
      action: '<a class="btn btn--primary" href="#/discover">Start discovering</a>',
    });
    return;
  }

  const active = matchId ? matches.find((match) => match.id === matchId) : null;
  if (!active) {
    conversationEl.innerHTML = emptyState({
      title: 'Pick a conversation',
      body: 'Choose someone from the list. Conversations are only between matched people.',
      iconName: 'chat',
    });
    return;
  }

  await openConversation(conversationEl, active, context);
}

function loadingRows() {
  return Array.from({ length: 5 }, () => '<div class="skeleton" style="height:58px;margin-bottom:6px"></div>').join('');
}

function paintList(listEl, matches, activeId) {
  listEl.innerHTML = matches
    .map((match) => {
      const profile = match.profile ?? { name: 'Unknown', photo: null };
      return `<a class="thread-item" href="#/matches/${encodeURIComponent(match.id)}" ${match.id === activeId ? 'aria-current="true"' : ''}>
        ${avatar(profile.photo, profile.name, 46)}
        <div class="thread-item__main">
          <div class="thread-item__name">
            ${esc(profile.name)}${profile.age ? `, ${profile.age}` : ''}
            ${profile.verified ? icon('shield', { size: 12 }) : ''}
          </div>
          <div class="thread-item__preview">${match.preview ? `${match.preview.fromMe ? 'You: ' : ''}${esc(match.preview.body)}` : '<em>You matched — say hello</em>'}</div>
        </div>
        <div class="thread-item__side">
          <span class="thread-item__time">${timeAgo(match.lastMessageAt ?? match.createdAt)}</span>
          ${match.unread > 0 ? `<span class="thread-item__unread">${match.unread}</span>` : ''}
        </div>
      </a>`;
    })
    .join('');
}

async function openConversation(container, match, context) {
  const profile = match.profile ?? { name: 'Match', photo: null, id: match.withUserId };
  let messages = [];
  try {
    const data = await endpoints.match(match.id);
    messages = data.messages ?? [];
    await endpoints.markRead(match.id);
    context.store.refreshMe();
  } catch (error) {
    container.innerHTML = `<div class="empty"><h3>Could not open this conversation</h3><p class="muted">${esc(error.message)}</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="chat">
      <header class="chat__head">
        <a href="#/profile/${encodeURIComponent(profile.id)}" aria-label="Open ${esc(profile.name)}'s profile">
          ${avatar(profile.photo, profile.name, 40)}
        </a>
        <div style="min-width:0;flex:1">
          <div class="row" style="gap:.35rem">
            <a href="#/profile/${encodeURIComponent(profile.id)}" style="color:inherit;text-decoration:none;font-weight:600">${esc(profile.name)}</a>
            ${profile.verified ? `<span class="chip chip--gold" style="padding:.05rem .4rem">${icon('shield', { size: 11 })}</span>` : ''}
            ${profile.online ? '<span class="chip chip--accent" style="padding:.05rem .45rem">Online</span>' : ''}
          </div>
          <div class="tiny faint">${match.match !== null ? `${match.match}% match` : 'Matched'}${profile.city ? ` · ${esc(profile.city)}` : ''}</div>
        </div>
        <button class="btn btn--ghost btn--sm" id="thread-menu" aria-label="Conversation options" aria-haspopup="menu">${icon('settings', { size: 16 })}</button>
      </header>
      <div class="chat__body" id="chat-body" tabindex="0" aria-live="polite" aria-label="Messages"></div>
      <form class="chat__foot" id="composer">
        <label class="sr-only" for="message-input">Message</label>
        <textarea class="textarea" id="message-input" rows="1" maxlength="2000" placeholder="Say something worth replying to…" style="min-height:44px;max-height:140px;resize:none"></textarea>
        <button class="btn btn--primary btn--icon" type="submit" aria-label="Send message">${icon('send', { size: 18 })}</button>
      </form>
    </div>`;

  const body = container.querySelector('#chat-body');
  const form = container.querySelector('#composer');
  const input = container.querySelector('#message-input');

  paintMessages(body, messages, profile);
  body.scrollTop = body.scrollHeight;

  // Grow the composer with content, cap it, and keep Enter = send / Shift+Enter = newline.
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(140, input.scrollHeight)}px`;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    input.value = '';
    input.style.height = 'auto';

    const localId = `local_${clientId}`;
    appendMessage(body, { id: localId, sender: 'me', body: text, createdAt: new Date().toISOString(), pending: true }, profile);

    try {
      const result = await endpoints.sendMessage(match.id, text, clientId);
      const pending = body.querySelector(`[data-msg="${CSS.escape(localId)}"]`);
      if (pending) pending.classList.remove('bubble--pending');
      if (result.idempotent) {
        // The server already had this message; remove the duplicate local bubble.
        pending?.remove();
      }
      context.store.refreshMe();
    } catch (error) {
      const pending = body.querySelector(`[data-msg="${CSS.escape(localId)}"]`);
      if (pending) {
        pending.classList.add('bubble--pending');
        pending.setAttribute('title', error.message);
      }
      toast(error.code === 'rate_limited' ? 'Slow down a little — try again in a few minutes.' : error.message, { kind: 'error' });
    }
  });

  container.querySelector('#thread-menu').addEventListener('click', () => openThreadMenu(context, match, profile));

  // Poll for new messages while this conversation is on screen and the tab is visible.
  const timer = setInterval(async () => {
    if (document.hidden || !document.body.contains(container) || !body.isConnected) {
      clearInterval(timer);
      return;
    }
    try {
      const data = await endpoints.messages(match.id);
      const rendered = [...body.querySelectorAll('[data-msg]')].map((node) => node.dataset.msg);
      const incoming = data.messages.filter((message) => !rendered.includes(message.id));
      for (const message of incoming) appendMessage(body, message, profile);
      if (incoming.length > 0) {
        body.scrollTop = body.scrollHeight;
        await endpoints.markRead(match.id);
      }
    } catch {
      // Transient failure: keep the timer, try again.
    }
  }, 8000);
}

function paintMessages(body, messages, profile) {
  body.innerHTML = '';
  let lastDay = null;
  for (const message of messages) {
    const label = dayLabel(message.createdAt);
    if (label !== lastDay) {
      const marker = document.createElement('div');
      marker.className = 'day-marker';
      marker.textContent = label;
      body.append(marker);
      lastDay = label;
    }
    appendMessage(body, message, profile);
  }
  if (messages.length === 0) {
    body.innerHTML = `<div class="empty" style="padding:var(--sp-5)">
      ${icon('heart', { size: 40, class: 'empty__icon' })}
      <h3 style="font-size:var(--step-1)">You matched with ${esc(profile.name.split(' ')[0])}</h3>
      <p class="small muted" style="max-width:34ch">Opening lines that mention something from their profile get replies. “Hi” rarely does.</p>
    </div>`;
  }
}

function appendMessage(body, message, profile) {
  const mine = message.sender === 'me';
  const bubble = document.createElement('div');
  bubble.className = `bubble ${mine ? 'bubble--me' : 'bubble--them'}${message.pending ? ' bubble--pending' : ''}`;
  bubble.dataset.msg = message.id;
  bubble.innerHTML = `${esc(message.body)}<span class="bubble__time">${clockTime(message.createdAt)}</span>`;
  body.append(bubble);
}

function openThreadMenu(context, match, profile) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `
    <div class="modal__body">
      <h3 style="margin-bottom:.3rem">Conversation options</h3>
      <p class="small muted">With ${esc(profile.name)}.</p>
      <div class="stack" style="margin-top:var(--sp-3)">
        <a class="btn btn--ghost btn--block" href="#/profile/${encodeURIComponent(profile.id)}">View profile</a>
        <button class="btn btn--ghost btn--block" data-act="unmatch" style="border-color:var(--danger);color:var(--danger)">Unmatch</button>
      </div>
      <p class="tiny faint" style="margin-top:.75rem">Unmatching closes the conversation for both of you. ${esc(profile.name.split(' ')[0])} is not notified — that is deliberate.</p>
    </div>
    <div class="modal__foot"><button class="btn btn--primary" data-close>Done</button></div>`;
  document.body.append(dialog);
  dialog.addEventListener('click', async (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) {
      dialog.close();
      return;
    }
    if (event.target.closest('[data-act="unmatch"]')) {
      dialog.close();
      const ok = await confirmDialog(
        'Unmatch?',
        `You and ${profile.name.split(' ')[0]} will lose this conversation and will not see each other in discovery.`,
        { okLabel: 'Unmatch', danger: true },
      );
      if (!ok) return;
      try {
        await endpoints.unmatch(match.id);
        toast('Unmatched.');
        context.store.refreshMe();
        location.hash = '#/matches';
      } catch (error) {
        toast(error.message, { kind: 'error' });
      }
    }
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}
