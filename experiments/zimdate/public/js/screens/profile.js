/**
 * Profile detail. The score breakdown is the point of this page: every shared question is shown
 * with both answers, whether each side accepts the other, and how much weight it carried.
 * Private answers are rendered as "private" rather than omitted, so the arithmetic stays checkable.
 */
import { endpoints } from '../api.js';
import { esc, matchRing, scoreFigures, chips, toast, confirmDialog, distanceLabel } from '../ui.js';
import { icon } from '../icons.js';

export async function render(host, context) {
  const { params, store } = context;
  const isSelf = store.getState().me?.id === params.userId;

  host.innerHTML = `<div class="skeleton" style="height:340px;border-radius:30px"></div>`;

  let data;
  try {
    data = await endpoints.profile(params.userId);
  } catch (error) {
    host.innerHTML = `<div class="empty">${icon('alert', { size: 52, class: 'empty__icon' })}
      <h2>Profile unavailable</h2><p class="muted">${esc(error.message)}</p>
      <a class="btn btn--primary" href="#/discover">Back to discovery</a></div>`;
    return;
  }

  if (isSelf) {
    location.hash = '#/me';
    return;
  }

  const profile = data.profile;
  const score = data.score;
  const state = data.state;
  const photos = profile.photos ?? [];
  const hero = photos[0]?.url;

  host.innerHTML = `
    <div class="row" style="margin-bottom:var(--sp-4)">
      <a class="btn btn--ghost btn--sm" href="#/discover">${icon('arrowLeft', { size: 15 })} Back</a>
      <span class="small faint">Viewing ${esc(profile.name)}${profile.answerCount ? ` · ${profile.answerCount} answers` : ''}</span>
    </div>

    <div class="profile-hero">
      <div>
        <div class="gallery">
          <div class="gallery__main">
            ${hero ? `<img src="${esc(hero)}" alt="${esc(profile.name)}" id="hero-img" decoding="async">` : '<div class="skeleton" style="height:100%"></div>'}
          </div>
          ${photos.length > 1 ? `<div class="gallery__thumbs" role="group" aria-label="Photos">
            ${photos.map((photo, index) => `<button class="gallery__thumb" data-photo="${esc(photo.url)}" aria-current="${index === 0}" aria-label="Photo ${index + 1}">
              <img src="${esc(photo.url)}" alt="" loading="lazy" decoding="async">
            </button>`).join('')}
          </div>` : ''}
        </div>
      </div>

      <div>
        <div class="profile-header">
          <div style="flex:1;min-width:0">
            <h1>${esc(profile.name)}${profile.age ? `, ${profile.age}` : ''}</h1>
            <div class="profile-meta">
              ${profile.verified ? `<span class="chip chip--gold">${icon('shield', { size: 13 })} Verified</span>` : ''}
              <span>${icon('mapPin', { size: 14 })}${esc(profile.city)}${profile.suburb ? `, ${esc(profile.suburb)}` : ''}</span>
              ${profile.distanceKm != null ? `<span>${esc(distanceLabel(profile.distanceKm))}</span>` : ''}
              <span>${icon('briefcase', { size: 14 })}${esc(profile.occupation || 'Not specified')}</span>
            </div>
          </div>
        </div>

        ${profile.headline ? `<p style="font-family:var(--font-display);font-size:var(--step-1);margin-top:var(--sp-3)">“${esc(profile.headline)}”</p>` : ''}

        <div class="card" style="margin-top:var(--sp-4)">
          <div class="card__body">
            ${renderScoreBlock(score, profile)}
          </div>
        </div>

        <div class="row" style="margin-top:var(--sp-4);gap:.5rem" id="actions">
          ${state.matched
            ? `<a class="btn btn--primary" href="#/matches/${encodeURIComponent(state.matchId)}">${icon('chat', { size: 16 })} Message ${esc(profile.name.split(' ')[0])}</a>`
            : state.liked
              ? `<button class="btn btn--quiet" disabled>${icon('heartFilled', { size: 16 })} You liked them</button>`
              : `<button class="btn btn--primary" data-like>${icon('heart', { size: 16 })} Like</button>`}
          ${state.likesYou && !state.matched ? `<span class="chip chip--clay">${icon('heartFilled', { size: 12 })} They liked you</span>` : ''}
          <button class="btn btn--ghost" data-pass>${icon('x', { size: 16 })} Pass</button>
          <button class="btn btn--ghost btn--sm" data-report>${icon('flag', { size: 15 })} Report</button>
          <button class="btn btn--ghost btn--sm" data-block>${icon('ban', { size: 15 })} Block</button>
        </div>
      </div>
    </div>

    <section class="section">
      <h2 class="section__title">About</h2>
      <p style="max-width:68ch">${esc(profile.bio || 'This person has not written a bio yet.')}</p>
    </section>

    ${profile.prompts?.length ? `<section class="section">
      <h2 class="section__title">In their words</h2>
      ${profile.prompts.map((prompt) => `<div class="prompt-box">
        <div class="prompt-box__q">${esc(prompt.prompt)}</div>
        <div class="prompt-box__a">${esc(prompt.answer)}</div>
      </div>`).join('')}
    </section>` : ''}

    <section class="section">
      <h2 class="section__title">Essentials</h2>
      <div class="essentials">
        ${essential('Height', profile.heightCm ? `${profile.heightCm} cm` : null)}
        ${essential('Education', profile.education)}
        ${essential('Religion', profile.religion)}
        ${essential('Languages', (profile.languages ?? []).join(', '))}
        ${essential('Drinks', profile.drinks)}
        ${essential('Smokes', profile.smokes)}
        ${essential('Cannabis', profile.cannabis)}
        ${essential('Children', profile.kids)}
        ${essential('Pets', profile.pets)}
        ${essential('Looking for', intentLabel(profile.intent))}
      </div>
    </section>

    ${profile.interests?.length ? `<section class="section">
      <h2 class="section__title">Interests</h2>
      <div class="row">${chips(profile.interests, 30)}</div>
    </section>` : ''}

    <section class="section">
      <div class="row row--between">
        <h2 class="section__title" style="margin:0">Compatibility breakdown</h2>
        <span class="small faint">${score.ok === false ? '' : `${score.shared} shared answers`}</span>
      </div>
      <div id="breakdown" style="margin-top:var(--sp-3)"></div>
    </section>

    <section class="section">
      <h2 class="section__title">Their answers</h2>
      <p class="small muted" style="margin-bottom:var(--sp-3)">Answers marked private still count towards your score, but their content is hidden.</p>
      <div class="stack" id="answers"></div>
    </section>`;

  // Gallery switching.
  host.querySelectorAll('[data-photo]').forEach((button) => {
    button.addEventListener('click', () => {
      host.querySelector('#hero-img')?.setAttribute('src', button.dataset.photo);
      host.querySelectorAll('[data-photo]').forEach((other) => other.setAttribute('aria-current', String(other === button)));
    });
  });

  renderBreakdown(host.querySelector('#breakdown'), score);
  renderAnswers(host.querySelector('#answers'), data.answers);

  // Actions.
  host.querySelector('[data-like]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await endpoints.like(profile.id);
      if (result.matched) {
        toast(`It's a match with ${profile.name.split(' ')[0]}!`, { kind: 'success' });
        location.hash = `#/matches/${result.match.id}`;
      } else {
        button.outerHTML = `<button class="btn btn--quiet" disabled>${icon('heartFilled', { size: 16 })} You liked them</button>`;
        toast('Like sent.');
      }
      store.refreshMe();
    } catch (error) {
      button.disabled = false;
      toast(error.message, { kind: 'error' });
    }
  });

  host.querySelector('[data-pass]')?.addEventListener('click', async () => {
    try {
      await endpoints.pass(profile.id);
      toast('Passed. You can undo this from discovery.');
      location.hash = '#/discover';
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  });

  host.querySelector('[data-block]')?.addEventListener('click', async () => {
    const ok = await confirmDialog(
      `Block ${profile.name}?`,
      'You will not see each other anywhere on ZimDate. Any match and conversation between you will be closed. This cannot be undone from their side.',
      { okLabel: 'Block', danger: true },
    );
    if (!ok) return;
    try {
      await endpoints.block(profile.id);
      toast('Blocked.', { kind: 'success' });
      store.refreshMe();
      location.hash = '#/discover';
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  });

  host.querySelector('[data-report]')?.addEventListener('click', () => openReportDialog(context, profile));
}

function renderScoreBlock(score, profile) {
  if (!score.ok) {
    return `<div class="row" style="gap:var(--sp-4);align-items:flex-start">
      ${matchRing(null, { size: 'lg' })}
      <div style="flex:1">
        <h2 style="margin:0 0 .3rem;font-size:var(--step-1)">No score yet</h2>
        <p class="small muted" style="margin:0">${esc(score.message ?? 'You have not answered any of the same questions.')}</p>
        <a class="btn btn--sm btn--ghost" href="#/questions" style="margin-top:.6rem">Answer questions</a>
      </div>
    </div>`;
  }
  return `<div class="score-panel">
    ${matchRing(score.match, { size: 'lg' })}
    <div>
      <div class="row row--between" style="align-items:flex-start">
        <div>
          <h2 style="margin:0;font-size:var(--step-1)">${score.match >= 80 ? 'A very strong match' : score.match >= 60 ? 'A solid match' : score.match >= 40 ? 'Some real differences' : 'Mostly different'}</h2>
          <p class="small muted" style="margin:.2rem 0 0">${esc(score.display.detail)}</p>
        </div>
        ${scoreFigures(score.friend, score.enemy)}
      </div>
      <div class="progress" style="margin-top:var(--sp-3)"><div class="progress__bar" style="width:${Math.round(score.coverage * 100)}%"></div></div>
      <p class="tiny faint" style="margin:.4rem 0 0">
        ${score.basis === 'one_sided'
          ? 'Only one of you has weighted your shared answers, so the score reflects one side only.'
          : 'Both sides carry weight, so this number reflects mutual satisfaction.'}
        ${score.confidence === 'low' ? ' Treat it as provisional until you share more answers.' : ''}
      </p>
    </div>
  </div>`;
}

function renderBreakdown(container, score) {
  if (!score.ok) {
    container.innerHTML = `<div class="notice">${icon('info', { size: 16 })}<div>Once you have answered questions that ${'they'} have also answered, the full arithmetic appears here.</div></div>`;
    return;
  }
  const labels = {
    aligned: 'You agree and each accept the other',
    different_but_acceptable: 'Different, but both acceptable',
    rejected_by_me: 'You would not accept their answer',
    rejected_by_them: 'They would not accept your answer',
    rejected_both: 'Neither would accept the other',
  };
  const dots = {
    aligned: 'aligned',
    different_but_acceptable: 'different',
    rejected_by_me: 'rejected_me',
    rejected_by_them: 'rejected_them',
    rejected_both: 'rejected_both',
  };

  const byCategory = new Map();
  for (const entry of score.breakdown) {
    const key = entry.category ?? 'other';
    const list = byCategory.get(key) ?? [];
    list.push(entry);
    byCategory.set(key, list);
  }

  container.innerHTML = `
    <details class="card card--flat" open>
      <summary style="padding:.9rem 1.1rem;cursor:pointer;font-weight:600;font-size:.9rem">
        How this was calculated — ${esc(score.explain?.formula ?? '')}
      </summary>
      <div class="card__body" style="padding-top:0">
        <p class="small muted">${esc(score.explain?.note ?? '')}</p>
        ${[...byCategory.entries()]
          .map(
            ([category, entries]) => `
          <h3 style="margin:var(--sp-4) 0 .3rem;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint)">${esc(category)}</h3>
          ${entries
            .map(
              (entry) => `<div class="verdict">
                <div class="verdict__q">${esc(entry.text ?? entry.questionId)}</div>
                <div class="verdict__row">
                  <span class="verdict__dot dot--${dots[entry.verdict] ?? 'different'}"></span>
                  <span>${esc(labels[entry.verdict] ?? entry.verdict)}</span>
                </div>
                <div class="verdict__row" style="margin-top:.15rem">
                  <span class="chip chip--outline">You: ${esc(optionLabel(entry.options, entry.mine))}</span>
                  <span class="chip chip--outline">Them: ${entry.theirs === null ? 'Private' : esc(optionLabel(entry.options, entry.theirs))}</span>
                  <span class="tiny faint">weight ${esc(String(entry.myImportance))} / ${esc(String(entry.theirImportance))}</span>
                </div>
              </div>`,
            )
            .join('')}`,
          )
          .join('')}
      </div>
    </details>`;
}

function optionLabel(options, value) {
  if (!options || value === null || value === undefined) return '—';
  if (Array.isArray(options)) {
    const index = value.charCodeAt(0) - 97;
    const option = options[index];
    return typeof option === 'string' ? option : option?.label ?? String(value);
  }
  return String(value);
}

function renderAnswers(container, answers) {
  if (!answers?.length) {
    container.innerHTML = `<div class="notice">${icon('info', { size: 16 })}<div>They have not answered any questions yet.</div></div>`;
    return;
  }
  container.innerHTML = answers
    .slice(0, 40)
    .map((answer) => {
      const question = { options: answer.options };
      return `<div class="card card--flat">
        <div class="card__body" style="padding:.85rem 1rem">
          <div class="row row--between" style="align-items:flex-start">
            <strong class="small" style="flex:1">${esc(answer.text)}</strong>
            <span class="badge">${esc(answer.importance)}</span>
          </div>
          <div class="row" style="margin-top:.35rem">
            <span class="chip chip--clay">${esc(optionLabel(answer.options, answer.answer))}</span>
            ${answer.visibility === 'private' ? `<span class="chip">${icon('lock', { size: 11 })} Private</span>` : ''}
            ${answer.explanation ? `<span class="small muted">“${esc(answer.explanation)}”</span>` : ''}
          </div>
        </div>
      </div>`;
    })
    .join('');
}

function essential(label, value) {
  if (!value) return '';
  return `<div class="essential">
    <div>
      <div class="essential__label">${esc(label)}</div>
      <div class="essential__value">${esc(value)}</div>
    </div>
  </div>`;
}

function intentLabel(intent) {
  return (
    {
      'long-term': 'A long-term relationship',
      'short-term': 'Something short-term',
      friends: 'Friends first',
      'figuring-it-out': 'Still figuring it out',
    }[intent] ?? 'Open to anything'
  );
}

function openReportDialog(context, profile) {
  const reasons = context.store.getState().meta.reportReasons;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `
    <form method="dialog">
      <div class="modal__body">
        <h2 style="margin-bottom:.3rem">Report ${esc(profile.name)}</h2>
        <p class="small muted">Reports go to the Trust &amp; Safety queue. This person is not told who reported them.</p>
        <div class="field">
          <label for="report-reason">Reason</label>
          <select class="select" id="report-reason" required>
            ${reasons.map((reason) => `<option value="${esc(reason)}">${esc(reasonLabel(reason))}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="report-details">What happened? <span class="faint">(optional)</span></label>
          <textarea class="textarea" id="report-details" maxlength="2000" placeholder="Details help the review."></textarea>
        </div>
      </div>
      <div class="modal__foot">
        <button class="btn btn--ghost" value="cancel" formnovalidate>Cancel</button>
        <button class="btn btn--danger" value="submit">Send report</button>
      </div>
    </form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', async () => {
    const submitted = dialog.returnValue === 'submit';
    dialog.remove();
    if (!submitted) return;
    try {
      const reason = dialog.querySelector('#report-reason').value;
      const details = dialog.querySelector('#report-details').value;
      await endpoints.report(profile.id, reason, details);
      toast('Report sent. Thank you — the safety team will review it.', { kind: 'success' });
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  });
  dialog.showModal();
}

function reasonLabel(reason) {
  return {
    fake_profile: 'Fake profile / catfishing',
    harassment: 'Harassment or abuse',
    spam: 'Spam or advertising',
    inappropriate_photos: 'Inappropriate photos',
    underage: 'Appears to be under 18',
    scam: 'Scam or asking for money',
    offline_behaviour: 'Something that happened offline',
    other: 'Something else',
  }[reason] ?? reason;
}
