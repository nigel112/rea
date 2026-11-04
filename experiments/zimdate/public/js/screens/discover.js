/**
 * Discover: the DoubleTake-style stack plus the filterable grid.
 *
 * Behaviour worth knowing:
 *   - the stack is optimistic: the card advances immediately, and a failed like rolls back with a
 *     message. Waiting 400 ms per card makes the product feel broken.
 *   - passes are remembered for the session so the keyboard stays fast, and can be undone.
 *   - the grid shows *why* a profile is ranked where it is (rank.reasons), because the ranking is
 *     part of the product, not a secret.
 */
import { endpoints } from '../api.js';
import { esc, personCard, matchRing, skeletonGrid, emptyState, distanceLabel, debounce } from '../ui.js';
import { icon } from '../icons.js';

const state = {
  mode: 'stack',
  stack: [],
  index: 0,
  history: [],
  excluded: {},
  quota: null,
  filters: { minAge: 18, maxAge: 99, maxDistance: '', onlineOnly: false, hasPhoto: true, intent: '', verifiedOnly: false, minMatch: '' },
  gridPage: 0,
  loading: false,
  inbound: [],
};

export async function render(host, context) {
  const { store } = context;
  const me = store.getState().me;
  const answered = me?.answerCount ?? 0;

  host.innerHTML = `
    <div class="row row--between" style="margin-bottom:var(--sp-4)">
      <div>
        <h1 style="margin:0;font-size:var(--step-3)">Discover</h1>
        <p class="muted small" style="margin:.15rem 0 0">People who fit what you are looking for, ranked by real compatibility.</p>
      </div>
      <div class="row" style="gap:.5rem">
        <div class="row" role="group" aria-label="View mode" style="background:var(--surface-2);padding:4px;border-radius:999px">
          <button class="btn btn--sm" data-mode="stack" aria-pressed="true" style="box-shadow:none">Stack</button>
          <button class="btn btn--sm" data-mode="grid" aria-pressed="false" style="box-shadow:none;background:transparent">Grid</button>
        </div>
        <a class="btn btn--quiet btn--sm" href="#/likes">${icon('heart', { size: 15 })} Likes</a>
      </div>
    </div>

    <div id="low-answer-notice"></div>
    <section id="stack-pane" aria-label="One profile at a time"></section>
    <section id="grid-pane" aria-label="Browse profiles" hidden></section>
    <aside id="side-pane" style="margin-top:var(--sp-6)"></aside>`;

  if (answered < 10) {
    host.querySelector('#low-answer-notice').innerHTML = `
      <div class="notice notice--gold" style="margin-bottom:var(--sp-4)">
        ${icon('sparkle')}
        <div>
          <strong>Your scores are still thin.</strong> You have answered ${answered} question${answered === 1 ? '' : 's'}.
          Match percentages need shared answers — 15 or more makes them trustworthy.
          <div style="margin-top:.4rem"><a class="btn btn--sm btn--ghost" href="#/questions">Answer questions</a></div>
        </div>
      </div>`;
  }

  const stackPane = host.querySelector('#stack-pane');
  const gridPane = host.querySelector('#grid-pane');
  const sidePane = host.querySelector('#side-pane');

  host.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      host.querySelectorAll('[data-mode]').forEach((other) => {
        const active = other === button;
        other.setAttribute('aria-pressed', String(active));
        other.style.background = active ? 'var(--surface)' : 'transparent';
        other.style.boxShadow = active ? 'var(--shadow-xs)' : 'none';
      });
      stackPane.hidden = state.mode !== 'stack';
      gridPane.hidden = state.mode !== 'grid';
      if (state.mode === 'grid' && !gridPane.dataset.loaded) loadGrid(context, gridPane);
    });
  });

  await loadStack(context, stackPane, sidePane);
  installShortcuts(context, stackPane, sidePane);
}

/* ------------------------------------------------------------------ stack */

async function loadStack(context, stackPane, sidePane) {
  stackPane.innerHTML = `<div class="skeleton" style="aspect-ratio:3/4;max-height:70vh;border-radius:30px"></div>`;
  try {
    const data = await endpoints.stack(30);
    state.stack = data.cards ?? [];
    state.inbound = data.inbound ?? [];
    state.excluded = data.excluded ?? {};
    state.quota = data.quota ?? null;
    state.index = 0;
    state.history = [];
    drawInbound(context, stackPane);
    drawStack(context, stackPane);
    drawSidePane(sidePane, data);
  } catch (error) {
    stackPane.innerHTML = emptyState({
      title: 'Could not load your stack',
      body: error.message,
      iconName: 'alert',
      action: '<button class="btn btn--primary" data-retry>Try again</button>',
    });
    stackPane.querySelector('[data-retry]')?.addEventListener('click', () => loadStack(context, stackPane, sidePane));
  }
}

function currentCard() {
  return state.stack[state.index] ?? null;
}

/**
 * The inbound lane. People who liked you are shown first and separately: suppressing their position
 * would be dishonest, but hiding them entirely makes a like impossible to reciprocate. Honest
 * middle: they get their own strip, labelled, with no ranking advantage.
 */
function drawInbound(context, stackPane) {
  let lane = stackPane.querySelector('#inbound-lane');
  if (!lane) {
    lane = document.createElement('div');
    lane.id = 'inbound-lane';
    stackPane.prepend(lane);
  }
  if (state.inbound.length === 0) {
    lane.innerHTML = '';
    return;
  }
  lane.innerHTML = `
    <div class="card card--flat" style="margin-bottom:var(--sp-4);border-color:var(--clay-300);background:linear-gradient(180deg,var(--clay-100),var(--surface) 70%)">
      <div class="card__body" style="padding:.9rem 1rem">
        <div class="row row--between" style="margin-bottom:.6rem">
          <strong class="small">${icon('heartFilled', { size: 15 })} ${state.inbound.length} ${state.inbound.length === 1 ? 'person has' : 'people have'} liked you</strong>
          <a class="tiny" href="#/likes">See all</a>
        </div>
        <div style="display:flex;gap:.6rem;overflow-x:auto;padding-bottom:2px">
          ${state.inbound
            .map(
              (card) => `<button class="inbound-chip" data-inbound="${esc(card.profile.id)}">
                <span class="inbound-chip__face">
                  ${card.profile.photos?.[0]?.url ? `<img src="${esc(card.profile.photos[0].url)}" alt="">` : ''}
                </span>
                <span class="inbound-chip__name">${esc(card.profile.name.split(' ')[0])}</span>
                ${card.match !== null ? `<span class="tiny faint">${card.match}%</span>` : ''}
              </button>`,
            )
            .join('')}
        </div>
      </div>
    </div>`;

  lane.querySelectorAll('[data-inbound]').forEach((button) => {
    button.addEventListener('click', () => {
      // Liking from the lane is the whole point of showing it: reciprocate in one tap.
      openInboundCard(context, stackPane, button.dataset.inbound);
    });
  });
}

function openInboundCard(context, stackPane, userId) {
  const card = state.inbound.find((entry) => entry.profile.id === userId);
  if (!card) return;
  const profile = card.profile;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `
    <div class="modal__body" style="padding:0">
      <div style="aspect-ratio:4/3;background:var(--cream-200);overflow:hidden">
        ${profile.photos?.[0]?.url ? `<img src="${esc(profile.photos[0].url)}" alt="" style="width:100%;height:100%;object-fit:cover">` : ''}
      </div>
      <div style="padding:var(--sp-5)">
        <div class="row row--between">
          <h3 style="margin:0">${esc(profile.name)}${profile.age ? `, ${profile.age}` : ''}</h3>
          ${card.match !== null ? `<span class="badge badge--clay">${card.match}% match</span>` : ''}
        </div>
        <p class="small muted" style="margin:.4rem 0 0">${esc(profile.city)}${profile.headline ? ` · ${esc(profile.headline)}` : ''}</p>
        <p class="tiny faint" style="margin:.4rem 0 0">${esc(card.scoreNote ?? '')}</p>
        <div class="row" style="margin-top:var(--sp-4)">
          <button class="btn btn--primary" data-like>${icon('heart', { size: 16 })} Like back</button>
          <a class="btn btn--ghost" href="#/profile/${encodeURIComponent(profile.id)}">Full profile</a>
        </div>
      </div>
    </div>
    <div class="modal__foot"><button class="btn btn--ghost" data-close>Close</button></div>`;
  document.body.append(dialog);
  dialog.addEventListener('click', async (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) {
      dialog.close();
      return;
    }
    if (event.target.closest('[data-like]')) {
      const button = event.target.closest('[data-like]');
      button.disabled = true;
      try {
        const result = await endpoints.like(profile.id);
        dialog.close();
        state.inbound = state.inbound.filter((entry) => entry.profile.id !== profile.id);
        drawInbound(context, stackPane);
        context.store.refreshMe();
        if (result.matched) context.toast(`It's a match with ${profile.name.split(' ')[0]}!`, { kind: 'success', duration: 6000 });
        else context.toast('Like sent.');
      } catch (error) {
        button.disabled = false;
        context.toast(error.message, { kind: 'error' });
      }
    }
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}

function drawStack(context, stackPane) {
  const card = currentCard();
  if (!card) {
    stackPane.innerHTML = renderOutOfCards(state.excluded);
    stackPane.querySelector('[data-reload]')?.addEventListener('click', () => loadStack(context, stackPane, stackPane.parentElement.querySelector('#side-pane')));
    return;
  }

  const profile = card.profile;
  const photo = profile.photos?.[0]?.url;
  const sharedTeaser = card.match !== null && card.confidence !== 'low';

  stackPane.innerHTML = `
    <div class="stack-view">
      <div>
        <article class="stack-card" aria-live="polite">
          <div class="stack-card__media">
            ${photo ? `<img src="${esc(photo)}" alt="${esc(profile.name)}" decoding="async">` : '<div class="skeleton" style="height:100%"></div>'}
            <div class="stack-card__score">${matchRing(card.match, { size: 'lg' })}</div>
            <div class="stack-card__info">
              <h2 class="stack-card__name">${esc(profile.name)}${profile.age ? `, ${profile.age}` : ''}</h2>
              <div class="stack-card__meta">
                ${profile.verified ? `<span class="chip chip--gold" style="background:rgba(217,162,39,.2);color:#fff">${icon('shield', { size: 12 })} Verified</span>` : ''}
                <span>${esc(profile.city)}${profile.distanceKm != null ? ` · ${esc(distanceLabel(profile.distanceKm))}` : ''}</span>
                <span>·</span>
                <span>${esc(intentLabel(profile.intent))}</span>
              </div>
              ${profile.headline ? `<p class="stack-card__headline">${esc(profile.headline)}</p>` : ''}
              <div class="row" style="gap:.4rem;margin-top:.6rem">
                ${(profile.interests ?? []).slice(0, 3).map((interest) => `<span class="chip" style="background:rgba(255,255,255,.16);color:#fff">${esc(interest)}</span>`).join('')}
              </div>
            </div>
          </div>
        </article>

        <div class="stack-actions">
          <button class="act act--pass" data-action="pass" title="Pass (←)" aria-label="Pass on ${esc(profile.name)}">${icon('x')}</button>
          <button class="act act--super" data-action="super" title="Super like (costs ${context.store.getState().meta.boost.cost ? 5 : 5} ZimCoins)" aria-label="Super like ${esc(profile.name)}">${icon('star')}</button>
          <button class="act act--like" data-action="like" title="Like (→)" aria-label="Like ${esc(profile.name)}">${icon('heartFilled')}</button>
          <button class="act act--info" data-action="undo" title="Undo last pass (u)" aria-label="Undo last action">${icon('arrowLeft')}</button>
        </div>
        <p class="center tiny faint">${card.scoreNote ?? ''}${sharedTeaser ? ' · tap the card for the breakdown' : ''}</p>
      </div>

      <aside style="display:grid;gap:var(--sp-4)">
        <div class="card">
          <div class="card__head">${icon('info', { size: 17 })}<h2>Why this person</h2></div>
          <div class="card__body stack">
            ${(card.rank?.reasons ?? []).map((reason) => `<div class="row" style="gap:.4rem">${icon('checkCircle', { size: 15 })}<span class="small">${esc(reason)}</span></div>`).join('') || '<span class="small muted">Not enough signal yet — answer more questions.</span>'}
            <hr class="divider" style="margin:.4rem 0">
            <dl class="kv">
              <dt>Match</dt><dd>${card.match === null ? '—' : `${card.match}%`}</dd>
              <dt>Friend</dt><dd>${card.friend === null ? '—' : `${card.friend}%`}</dd>
              <dt>Enemy</dt><dd>${card.enemy === null ? '—' : `${card.enemy}%`}</dd>
              <dt>Shared answers</dt><dd>${card.shared}</dd>
              <dt>Confidence</dt><dd>${esc(card.confidence)}</dd>
            </dl>
          </div>
        </div>
        <a class="btn btn--ghost btn--block" href="#/profile/${encodeURIComponent(profile.id)}">Open full profile</a>
        <div class="card card--flat">
          <div class="card__body">
            <div class="small"><strong>${state.quota?.remaining ?? '∞'}</strong> likes left today</div>
            <div class="progress" style="margin-top:.4rem"><div class="progress__bar" style="width:${quotaPct(state.quota)}%"></div></div>
            ${state.quota?.unlimited ? '<div class="tiny faint" style="margin-top:.3rem">Unlimited on your plan.</div>' : `<div class="tiny faint" style="margin-top:.3rem">Resets ${new Date(state.quota?.resetsAt ?? Date.now()).toLocaleTimeString('en-ZW', { hour: '2-digit', minute: '2-digit' })}</div>`}
          </div>
        </div>
      </aside>
    </div>`;

  stackPane.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => act(context, button.dataset.action, stackPane));
  });
}

function quotaPct(quota) {
  if (!quota) return 0;
  if (quota.unlimited) return 12;
  if (!quota.limit) return 0;
  return Math.max(2, Math.round((quota.remaining / quota.limit) * 100));
}

function intentLabel(intent) {
  return (
    {
      'long-term': 'Long-term',
      'short-term': 'Short-term',
      friends: 'Friends first',
      'figuring-it-out': 'Figuring it out',
    }[intent] ?? 'Open to anything'
  );
}

function renderOutOfCards(excluded) {
  const reasons = Object.entries(excluded ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const reasonLabels = {
    age_range: 'outside an age range',
    distance: 'too far away',
    orientation: 'not a mutual match on who you are looking for',
    blocked: 'blocked',
    blocked_by: 'not available to you',
    banned: 'unavailable',
  };
  return `<div class="empty">
    ${icon('compass', { size: 56, class: 'empty__icon' })}
    <h3>That is everyone for now</h3>
    <p class="muted">You have seen every profile that fits your filters. New people join daily — widen a filter, or come back tomorrow.</p>
    ${reasons.length ? `<div class="chips row" style="justify-content:center">${reasons.map(([reason, count]) => `<span class="chip chip--outline">${count} ${esc(reasonLabels[reason] ?? reason)}</span>`).join('')}</div>` : ''}
    <div class="row" style="justify-content:center;margin-top:.5rem">
      <a class="btn btn--ghost" href="#/questions">Answer more questions</a>
      <button class="btn btn--primary" data-reload>Refresh</button>
    </div>
  </div>`;
}

async function act(context, action, stackPane) {
  const card = currentCard();
  if (!card) return;
  const profile = card.profile;

  if (action === 'undo') {
    const last = state.history.pop();
    if (!last) {
      context.toast('Nothing to undo yet.');
      return;
    }
    try {
      // Undo has to reverse the *action*, not just the pointer. A pass is deleted on the server;
      // a like cannot be un-liked (the other person may already have seen it), so we say so
      // instead of silently pretending the card came back.
      if (last.action === 'pass') {
        await endpoints.undoPass(last.userId);
      } else {
        context.toast('A like cannot be undone — the other person may already have seen it.', { duration: 5000 });
      }
      state.index = Math.max(0, state.index - 1);
      drawStack(context, stackPane);
      drawInbound(context, stackPane);
      if (last.action === 'pass') context.toast('Pass undone.');
    } catch (error) {
      // Restore the history entry: a failed undo must stay undoable.
      state.history.push(last);
      context.toast(error.message, { kind: 'error' });
    }
    return;
  }

  // Optimistic advance.
  const previousIndex = state.index;
  state.history.push({ action: action === 'pass' ? 'pass' : 'like', userId: profile.id });
  state.index += 1;
  drawStack(context, stackPane);

  try {
    if (action === 'pass') {
      await endpoints.pass(profile.id);
    } else {
      const result = await endpoints.like(profile.id, action === 'super');
      if (result.matched) {
        context.toast(`It's a match with ${profile.name.split(' ')[0]}! Open Messages to say hello.`, { kind: 'success', duration: 6000 });
        context.store.refreshMe();
      } else if (action === 'super') {
        context.toast(`Super like sent to ${profile.name.split(' ')[0]}.`, { kind: 'success' });
      }
    }
    if (state.quota && !state.quota.unlimited) {
      state.quota.used += 1;
      state.quota.remaining = Math.max(0, state.quota.remaining - 1);
    }
  } catch (error) {
    // Roll back to the exact card that failed.
    state.index = previousIndex;
    state.history.pop();
    drawStack(context, stackPane);
    if (error.code === 'like_quota_exhausted') {
      context.toast('You are out of likes for today. Plus gives you 100 a day.', { kind: 'error', duration: 6000 });
    } else if (error.code === 'insufficient_coins') {
      context.toast('You need 5 ZimCoins for a super like.', { kind: 'error' });
    } else {
      context.toast(error.message, { kind: 'error' });
    }
  }
}

function installShortcuts(context, stackPane, sidePane) {
  const handler = (event) => {
    if (window.location.hash.replace('#', '').split('?')[0] !== '/discover') return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (state.mode !== 'stack') return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      act(context, 'pass', stackPane);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      act(context, 'like', stackPane);
    } else if (event.key.toLowerCase() === 'u') {
      event.preventDefault();
      act(context, 'undo', stackPane);
    }
  };
  document.addEventListener('keydown', handler);
  // Screen modules are re-rendered on navigation; drop the listener when the DOM is replaced.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(stackPane)) {
      document.removeEventListener('keydown', handler);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function drawSidePane(sidePane, data) {
  if (!sidePane) return;
  const excluded = Object.entries(data.excluded ?? {}).filter(([, count]) => count > 0);
  sidePane.innerHTML = excluded.length
    ? `<details class="card card--flat"><summary style="padding:.85rem 1rem;cursor:pointer;font-size:.85rem;font-weight:600">
         ${data.total} people in your stack · ${excluded.reduce((sum, [, count]) => sum + count, 0)} filtered out
       </summary>
       <div class="card__body" style="padding-top:0">
         <p class="tiny muted" style="margin-bottom:.5rem">Filters are mutual: your ranges apply to them, and theirs apply to you.</p>
         <div class="row">${excluded.map(([reason, count]) => `<span class="chip chip--outline">${esc(reason.replace(/_/g, ' '))}: ${count}</span>`).join('')}</div>
       </div></details>`
    : '';
}

/* ------------------------------------------------------------------- grid */

async function loadGrid(context, gridPane) {
  gridPane.dataset.loaded = '1';
  gridPane.innerHTML = `
    <div class="card card--flat" style="margin-bottom:var(--sp-4)">
      <div class="card__body">
        <div class="row row--between" style="margin-bottom:.6rem">
          <strong class="small">${icon('filter', { size: 15 })} Filters</strong>
          <span class="tiny faint" id="grid-count"></span>
        </div>
        <div class="filter-row">
          <label class="field" style="margin:0">
            <span class="field__hint">Age range</span>
            <div class="row" style="gap:.4rem">
              <input class="input" type="number" min="18" max="99" name="minAge" value="${state.filters.minAge}" aria-label="Minimum age" style="width:80px">
              <span class="faint">–</span>
              <input class="input" type="number" min="18" max="99" name="maxAge" value="${state.filters.maxAge}" aria-label="Maximum age" style="width:80px">
            </div>
          </label>
          <label class="field" style="margin:0">
            <span class="field__hint">Maximum distance (km)</span>
            <input class="input" type="number" min="1" name="maxDistance" value="${esc(state.filters.maxDistance)}" placeholder="Any">
          </label>
          <label class="field" style="margin:0">
            <span class="field__hint">Looking for</span>
            <select class="select" name="intent">
              <option value="">Anything</option>
              <option value="long-term">Long-term</option>
              <option value="short-term">Short-term</option>
              <option value="friends">Friends first</option>
              <option value="figuring-it-out">Figuring it out</option>
            </select>
          </label>
          <label class="field" style="margin:0">
            <span class="field__hint">Minimum match</span>
            <select class="select" name="minMatch">
              <option value="">Any</option>
              <option value="40">40%+</option>
              <option value="60">60%+</option>
              <option value="80">80%+</option>
            </select>
          </label>
        </div>
        <div class="row" style="margin-top:.75rem;gap:1rem">
          <label class="switch"><input type="checkbox" name="hasPhoto" ${state.filters.hasPhoto ? 'checked' : ''}> Has a photo</label>
          <label class="switch"><input type="checkbox" name="onlineOnly" ${state.filters.onlineOnly ? 'checked' : ''}> Active today</label>
          <label class="switch"><input type="checkbox" name="verifiedOnly" ${state.filters.verifiedOnly ? 'checked' : ''}> Verified only</label>
        </div>
      </div>
    </div>
    <div id="grid-results">${skeletonGrid(8)}</div>`;

  const form = gridPane.querySelector('.card');
  gridPane.querySelector('[name=intent]').value = state.filters.intent;
  gridPane.querySelector('[name=minMatch]').value = state.filters.minMatch;

  const refresh = debounce(async (page = 0) => {
    const results = gridPane.querySelector('#grid-results');
    results.innerHTML = skeletonGrid(8);
    const params = {
      minAge: state.filters.minAge,
      maxAge: state.filters.maxAge,
      maxDistance: state.filters.maxDistance,
      intent: state.filters.intent,
      minMatch: state.filters.minMatch,
      hasPhoto: state.filters.hasPhoto ? 'true' : '',
      onlineOnly: state.filters.onlineOnly ? 'true' : '',
      verifiedOnly: state.filters.verifiedOnly ? 'true' : '',
      page,
      pageSize: 24,
    };
    try {
      const data = await endpoints.discover(params);
      const countEl = gridPane.querySelector('#grid-count');
      if (countEl) countEl.textContent = `${data.total} profile${data.total === 1 ? '' : 's'} match these filters`;
      if (data.cards.length === 0) {
        results.innerHTML = emptyState({
          title: 'No one matches those filters',
          body: 'Widen the age range or distance. Your filters are applied in both directions, so a narrow range shrinks the pool quickly.',
          iconName: 'search',
        });
        return;
      }
      results.innerHTML = `
        <div class="grid grid--cards">${data.cards.map((card) => personCard(card)).join('')}</div>
        ${data.pages > 1 ? `<div class="row" style="justify-content:center;margin-top:var(--sp-5)">
          <button class="btn btn--ghost" data-page="${page - 1}" ${page <= 0 ? 'disabled' : ''}>${icon('arrowLeft', { size: 15 })} Previous</button>
          <span class="small muted">Page ${page + 1} of ${data.pages}</span>
          <button class="btn btn--ghost" data-page="${page + 1}" ${page + 1 >= data.pages ? 'disabled' : ''}>Next ${icon('arrowRight', { size: 15 })}</button>
        </div>` : ''}`;
      results.querySelectorAll('[data-page]').forEach((button) => {
        button.addEventListener('click', () => refresh(Number(button.dataset.page)));
      });
    } catch (error) {
      results.innerHTML = emptyState({ title: 'Could not load profiles', body: error.message, iconName: 'alert' });
    }
  }, 180);

  form.addEventListener('input', (event) => {
    const field = event.target;
    if (!field.name) return;
    if (field.type === 'checkbox') state.filters[field.name] = field.checked;
    else if (field.type === 'number') state.filters[field.name] = field.value === '' ? '' : Number(field.value);
    else state.filters[field.name] = field.value;
    refresh(0);
  });

  refresh(0);
}
