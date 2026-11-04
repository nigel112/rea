/**
 * Likes: "who likes you".
 *
 * The count is always exact. The list is a premium view, and the page says so plainly instead of
 * manufacturing fake urgency. Free users see the shape of the people (city + initials) behind a blur
 * so the value proposition is honest: the people are real, the view is a paid convenience.
 */
import { endpoints } from '../api.js';
import { esc, avatar, emptyState, toast, matchRing } from '../ui.js';
import { icon } from '../icons.js';

export async function render(host, context) {
  const { store } = context;
  const me = store.getState().me;

  host.innerHTML = `
    <div class="row row--between" style="margin-bottom:var(--sp-4)">
      <div>
        <h1 style="margin:0;font-size:var(--step-3)">Likes</h1>
        <p class="muted small" style="margin:.15rem 0 0">People who liked you, and people you have liked.</p>
      </div>
      <a class="btn btn--ghost btn--sm" href="#/discover">${icon('compass', { size: 15 })} Discover</a>
    </div>
    <div id="likes-body">${'<div class="skeleton" style="height:140px;border-radius:22px"></div>'}</div>`;

  const body = host.querySelector('#likes-body');

  try {
    const data = await endpoints.likesYou();
    body.innerHTML = `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div class="card__body">
          <div class="row row--between" style="align-items:flex-start">
            <div>
              <div class="figure__value">${data.count}</div>
              <div class="figure__label">${data.count === 1 ? 'Person likes you' : 'People like you'}</div>
            </div>
            <span class="badge ${data.visible ? 'badge--moss' : 'badge--gold'}">${data.visible ? 'Unlocked' : 'Premium view'}</span>
          </div>
          ${!data.visible && data.count > 0 ? `<p class="small muted" style="margin-top:.6rem">${esc(data.hint ?? '')}</p>
            <div class="row" style="margin-top:.6rem"><a class="btn btn--primary btn--sm" href="#/plans">See who likes you</a></div>` : ''}
        </div>
      </div>

      ${data.count === 0
        ? emptyState({
            title: 'No likes yet',
            body: 'Likes arrive as people find you in discovery. A complete profile with three photos gets found far more often.',
            iconName: 'heart',
            action: '<a class="btn btn--primary" href="#/me">Complete my profile</a>',
          })
        : data.visible
          ? `<div class="grid grid--cards">${data.people.map(personCardLike).join('')}</div>`
          : `<div class="lock-overlay">
              <div class="lock-overlay__content grid grid--cards">
                ${(data.blurred ?? []).map((person) => `<div class="pcard">
                  <div class="pcard__media" style="display:grid;place-items:center">
                    <span style="font-family:var(--font-display);font-size:2.4rem;color:var(--ink-300)">${esc(person.initials)}</span>
                  </div>
                  <div class="pcard__body"><div class="pcard__headline">${esc(person.city ?? 'Zimbabwe')}</div></div>
                </div>`).join('')}
              </div>
              <div class="lock-overlay__panel">
                <div>
                  ${icon('lock', { size: 26 })}
                  <h2 style="margin:.4rem 0 .3rem;font-size:var(--step-1)">${data.count} ${data.count === 1 ? 'person' : 'people'} like you</h2>
                  <p class="small muted">See them all on ZimDate Plus — and message anyone you like, free.</p>
                  <a class="btn btn--primary btn--block" href="#/plans">See plans</a>
                </div>
              </div>
            </div>`}
    `;
  } catch (error) {
    body.innerHTML = emptyState({ title: 'Could not load likes', body: error.message, iconName: 'alert' });
  }

  // People you liked.
  const likedHost = document.createElement('section');
  likedHost.style.marginTop = 'var(--sp-6)';
  likedHost.innerHTML = `<h2 class="section__title">You liked</h2><div id="outgoing">${'<div class="skeleton" style="height:120px"></div>'}</div>`;
  host.append(likedHost);

  try {
    const grid = await endpoints.discover({ pageSize: 24 });
    // There is no dedicated "outgoing likes" endpoint; use the boosted/likesViewer flags the grid
    // already returns, filtered to people we liked.
    const liked = (grid.cards ?? []).filter((card) => card.likedByViewer);
    likedHost.querySelector('#outgoing').innerHTML = liked.length
      ? `<div class="grid grid--cards">${liked.map(personCardLike).join('')}</div>`
      : '<p class="small muted">You have not liked anyone in your current pool yet.</p>';
  } catch {
    likedHost.querySelector('#outgoing').innerHTML = '';
  }

  function personCardLike(person) {
    const photo = person.photo ?? (person.photoIds?.[0] ? `/api/photos/${person.photoIds[0]}` : null);
    return `<a class="pcard" href="#/profile/${encodeURIComponent(person.id)}">
      <div class="pcard__media">
        ${photo ? `<img src="${esc(photo)}" alt="${esc(person.name)}" loading="lazy" decoding="async">` : '<div class="skeleton" style="height:100%"></div>'}
        <div class="pcard__meta">
          <div class="pcard__name">${esc(person.name)}</div>
          <div class="pcard__sub">${esc(person.city ?? '')}${person.likedAt ? ` · liked ${new Date(person.likedAt).toLocaleDateString('en-ZW', { day: 'numeric', month: 'short' })}` : ''}</div>
        </div>
      </div>
      <div class="pcard__body">
        ${person.headline ? `<div class="pcard__headline">${esc(person.headline)}</div>` : ''}
        ${person.match != null ? `<div class="row" style="gap:.4rem">${matchRing(person.match, { size: 'sm' })}<span class="tiny faint">match</span></div>` : ''}
      </div>
    </a>`;
  }
}
