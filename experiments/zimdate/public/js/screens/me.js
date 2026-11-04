/**
 * My profile: edit everything the API allows, manage photos, and see profile strength.
 * Fields are grouped the way people actually think about themselves, not the way the table is
 * ordered — and every group saves independently so a failed field never discards the rest.
 */
import { endpoints } from '../api.js';
import { esc, toast, chips, emptyState } from '../ui.js';
import { icon } from '../icons.js';

const GROUPS = [
  {
    id: 'basics',
    title: 'Basics',
    fields: [
      { key: 'name', label: 'Name', type: 'text', maxlength: 60 },
      { key: 'headline', label: 'Headline', type: 'text', maxlength: 160, hint: 'One line that tells someone who you are.' },
      { key: 'bio', label: 'About you', type: 'textarea', maxlength: 5000 },
      { key: 'city', label: 'City', type: 'city' },
      { key: 'suburb', label: 'Suburb', type: 'text', maxlength: 60 },
      { key: 'occupation', label: 'Occupation', type: 'text', maxlength: 80 },
      { key: 'education', label: 'Education', type: 'select', options: ['High school', 'Diploma', 'Bachelor’s degree', 'Honours', 'Master’s degree', 'Doctorate', 'Trade certificate', 'Still studying'] },
      { key: 'heightCm', label: 'Height (cm)', type: 'number', min: 120, max: 220 },
    ],
  },
  {
    id: 'lifestyle',
    title: 'Lifestyle',
    fields: [
      { key: 'drinks', label: 'Drinking', type: 'select', options: ['Never', 'Socially', 'Most weekends', 'Rarely'] },
      { key: 'smokes', label: 'Smoking', type: 'select', options: ['Never', 'Occasionally', 'Daily', 'Quitting'] },
      { key: 'cannabis', label: 'Cannabis', type: 'select', options: ['Never', 'Occasionally', 'Regularly'] },
      { key: 'kids', label: 'Children', type: 'select', options: ['No children', 'Has children', 'Has children, wants more', 'No children, wants some'] },
      { key: 'pets', label: 'Pets', type: 'select', options: ['No pets', 'Dogs', 'Cats', 'Dogs and cats', 'Chickens'] },
      { key: 'religion', label: 'Religion', type: 'text', maxlength: 40 },
    ],
  },
];

export async function render(host, context) {
  const { store } = context;
  const me = store.getState().me;
  const meta = store.getState().meta;

  host.innerHTML = `
    <div class="row row--between" style="margin-bottom:var(--sp-4);align-items:flex-start">
      <div>
        <h1 style="margin:0;font-size:var(--step-3)">My profile</h1>
        <p class="muted small" style="margin:.15rem 0 0">${me.tier === 'free' ? 'Free plan' : me.tier === 'plus' ? 'ZimDate Plus' : 'ZimDate Gold'} · ${me.completeness}% complete</p>
      </div>
      <div class="row" style="gap:.5rem">
        <a class="btn btn--ghost btn--sm" href="#/plans">${icon('crown', { size: 15 })} Plans</a>
        <a class="btn btn--ghost btn--sm" href="#/settings">${icon('settings', { size: 15 })} Settings</a>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:minmax(0,1fr);gap:var(--sp-4)">
      <div class="card">
        <div class="card__head">${icon('camera', { size: 17 })}<h2>Photos</h2><span class="spacer"></span><span class="tiny faint" id="photo-count"></span></div>
        <div class="card__body">
          <div class="row" id="photos" style="gap:.6rem"></div>
          <label class="btn btn--ghost btn--sm" style="margin-top:.75rem;cursor:pointer">
            ${icon('plus', { size: 15 })} Add photo
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden id="photo-input">
          </label>
          <p class="tiny faint" style="margin-top:.4rem">Up to 8 photos, 1.5 MB each. Your first photo is what people see first.</p>
        </div>
      </div>

      <div class="card">
        <div class="card__head">${icon('user', { size: 17 })}<h2>Who you want to meet</h2></div>
        <div class="card__body" id="filters"></div>
      </div>

      ${GROUPS.map(
        (group) => `<div class="card">
          <div class="card__head">${icon('book', { size: 17 })}<h2>${esc(group.title)}</h2></div>
          <div class="card__body">
            <form data-group="${esc(group.id)}" novalidate>
              ${group.fields.map((field) => renderField(field, me, meta)).join('')}
              <div class="row" style="justify-content:flex-end"><button class="btn btn--primary btn--sm" type="submit">Save ${esc(group.title.toLowerCase())}</button></div>
            </form>
          </div>
        </div>`,
      ).join('')}

      <div class="card">
        <div class="card__head">${icon('sparkle', { size: 17 })}<h2>Profile strength</h2></div>
        <div class="card__body" id="strength"></div>
      </div>
    </div>`;

  paintPhotos(host.querySelector('#photos'), host.querySelector('#photo-count'), me, context);
  paintFilters(host.querySelector('#filters'), me, meta, context);
  paintStrength(host.querySelector('#strength'), me);
  wirePhotoUpload(host.querySelector('#photo-input'), context);

  host.querySelectorAll('form[data-group]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const group = GROUPS.find((candidate) => candidate.id === form.dataset.group);
      const patch = {};
      for (const field of group.fields) {
        const input = form.elements[field.key];
        if (!input) continue;
        let value = input.value;
        if (value === '') continue;
        if (field.type === 'number') value = Number(value);
        patch[field.key] = value;
      }
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      try {
        const result = await endpoints.updateMe(patch);
        store.applyMe({ ...(await endpoints.me()) });
        toast(`${group.title} saved.`, { kind: 'success' });
        const header = host.querySelector('p.muted.small');
        if (header) header.textContent = `${result.user.tier === 'free' ? 'Free plan' : result.user.tier === 'plus' ? 'ZimDate Plus' : 'ZimDate Gold'} · ${result.user.completeness}% complete`;
        paintStrength(host.querySelector('#strength'), result.user);
      } catch (error) {
        const message = error.fields ? Object.values(error.fields).join(' · ') : error.message;
        toast(message, { kind: 'error' });
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderField(field, me, meta) {
  const value = me[field.key] ?? '';
  const id = `f-${field.key}`;
  if (field.type === 'select') {
    return `<div class="field">
      <label for="${id}">${esc(field.label)}</label>
      <select class="select" id="${id}" name="${esc(field.key)}">
        <option value="">Not specified</option>
        ${field.options.map((option) => `<option value="${esc(option)}" ${option === value ? 'selected' : ''}>${esc(option)}</option>`).join('')}
      </select>
    </div>`;
  }
  if (field.type === 'city') {
    return `<div class="field">
      <label for="${id}">${esc(field.label)}</label>
      <select class="select" id="${id}" name="city">
        ${meta.cities.map((city) => `<option value="${esc(city.name)}" ${city.name === value ? 'selected' : ''}>${esc(city.name)}</option>`).join('')}
      </select>
    </div>`;
  }
  if (field.type === 'textarea') {
    return `<div class="field">
      <label for="${id}">${esc(field.label)}</label>
      <textarea class="textarea" id="${id}" name="${esc(field.key)}" maxlength="${field.maxlength ?? 2000}">${esc(value)}</textarea>
      ${field.hint ? `<span class="field__hint">${esc(field.hint)}</span>` : ''}
    </div>`;
  }
  return `<div class="field">
    <label for="${id}">${esc(field.label)}</label>
    <input class="input" id="${id}" name="${esc(field.key)}" type="${field.type}" value="${esc(value)}"
      ${field.maxlength ? `maxlength="${field.maxlength}"` : ''} ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''}>
    ${field.hint ? `<span class="field__hint">${esc(field.hint)}</span>` : ''}
  </div>`;
}

function paintPhotos(container, countEl, me, context) {
  const photos = me.photos ?? [];
  countEl.textContent = `${photos.length} of 8`;
  if (photos.length === 0) {
    container.innerHTML = `<div class="notice notice--gold" style="width:100%">${icon('camera', { size: 16 })}<div>Profiles without a photo get very few likes. Add one to appear in discovery.</div></div>`;
    return;
  }
  container.innerHTML = photos
    .map(
      (photo) => `<div style="position:relative">
        <div class="gallery__thumb" style="width:84px;height:84px;border-color:var(--line)" aria-hidden="true">
          <img src="${esc(photo.url)}" alt="" loading="lazy" decoding="async">
        </div>
        <button class="btn btn--icon btn--sm" data-remove="${esc(photo.id)}"
          style="position:absolute;top:-6px;right:-6px;width:26px;height:26px;background:var(--surface);border:1px solid var(--line)"
          aria-label="Remove photo">${icon('x', { size: 13 })}</button>
      </div>`,
    )
    .join('');

  container.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await endpoints.deletePhoto(button.dataset.remove);
        const me2 = await context.store.refreshMe();
        paintPhotos(container, countEl, context.store.getState().me, context);
        toast('Photo removed.');
      } catch (error) {
        button.disabled = false;
        toast(error.message, { kind: 'error' });
      }
    });
  });
}

function paintFilters(container, me, meta, context) {
  const filters = me.interestsFilter ?? { minAge: 18, maxAge: 99, maxDistanceKm: 60 };
  container.innerHTML = `
    <form id="filter-form">
      <div class="row" style="gap:1rem;align-items:flex-start">
        <div class="field" style="flex:1;min-width:120px">
          <label for="min-age">Minimum age</label>
          <input class="input" id="min-age" name="minAge" type="number" min="18" max="99" value="${filters.minAge}">
        </div>
        <div class="field" style="flex:1;min-width:120px">
          <label for="max-age">Maximum age</label>
          <input class="input" id="max-age" name="maxAge" type="number" min="18" max="99" value="${filters.maxAge}">
        </div>
      </div>
      <div class="field">
        <label for="distance">Maximum distance</label>
        <select class="select" id="distance" name="maxDistanceKm">
          ${[10, 25, 50, 100, 250, 1000, 20000].map((km) => `<option value="${km}" ${Number(filters.maxDistanceKm) === km ? 'selected' : ''}>${km >= 20000 ? 'Anywhere in the world' : `${km} km`}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <span class="label">Show me</span>
        <div class="opt-grid">
          ${meta.genders.map((gender) => `<label class="opt"><input type="checkbox" name="lookingFor" value="${gender}" ${me.lookingFor?.includes(gender) ? 'checked' : ''}> ${gender === 'woman' ? 'Women' : gender === 'man' ? 'Men' : 'Non-binary people'}</label>`).join('')}
        </div>
      </div>
      <div class="field">
        <label for="intent">I am looking for</label>
        <select class="select" id="intent" name="intent">
          ${meta.intents.map((intent) => `<option value="${intent}" ${me.intent === intent ? 'selected' : ''}>${intentLabel(intent)}</option>`).join('')}
        </select>
      </div>
      <div class="row" style="justify-content:flex-end"><button class="btn btn--primary btn--sm" type="submit">Save preferences</button></div>
    </form>`;

  container.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    // `form.intent` works today but `form.elements` is the documented, collision-proof lookup.
    const fields = form.elements;
    const patch = {
      minAge: Number(fields.minAge.value),
      maxAge: Number(fields.maxAge.value),
      maxDistanceKm: Number(fields.maxDistanceKm.value),
      intent: fields.intent.value,
      lookingFor: [...fields.lookingFor].filter((box) => box.checked).map((box) => box.value),
    };
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await endpoints.updateMe(patch);
      await context.store.refreshMe();
      toast('Preferences saved.', { kind: 'success' });
    } catch (error) {
      toast(error.fields ? Object.values(error.fields).join(' · ') : error.message, { kind: 'error' });
    } finally {
      button.disabled = false;
    }
  });
}

function paintStrength(container, me) {
  const photos = me.photos?.length ?? 0;
  const checks = [
    { label: 'At least one photo', done: photos > 0, weight: 25, href: '#/me' },
    { label: 'Three or more photos', done: photos >= 3, weight: 15, href: '#/me' },
    { label: 'A headline', done: Boolean(me.headline), weight: 10, href: '#/me' },
    { label: 'About you (140+ characters)', done: (me.bio ?? '').length >= 140, weight: 20, href: '#/me' },
    { label: 'At least 15 answered questions', done: (me.answerCount ?? 0) >= 15, weight: 25, href: '#/questions' },
    { label: 'Verified', done: me.verified, weight: 5, href: '#/settings' },
  ];
  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.filter((check) => check.done).reduce((sum, check) => sum + check.weight, 0);
  const pct = Math.round((earned / total) * 100);

  container.innerHTML = `
    <div class="row row--between">
      <strong style="font-family:var(--font-display);font-size:var(--step-2)">${pct}%</strong>
      <span class="small muted">${earned} / ${total} points</span>
    </div>
    <div class="progress" style="margin:.5rem 0 .9rem"><div class="progress__bar" style="width:${pct}%"></div></div>
    <div class="stack" style="gap:.5rem">
      ${checks
        .map(
          (check) => `<div class="row row--between" style="gap:.5rem">
            <span class="row small" style="gap:.45rem">
              ${check.done ? icon('checkCircle', { size: 16 }) : icon('plus', { size: 16 })}
              <span style="${check.done ? 'color:var(--text-soft)' : ''}">${esc(check.label)}</span>
            </span>
            ${check.done ? '<span class="tiny faint">done</span>' : `<a class="btn btn--ghost btn--sm" href="${check.href}">Fix</a>`}
          </div>`,
        )
        .join('')}
    </div>`;
}

function wirePhotoUpload(input, context) {
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      toast('That image is over 1.5 MB. Try a smaller one.', { kind: 'error' });
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await endpoints.uploadPhoto(reader.result);
        await context.store.refreshMe();
        toast('Photo added.', { kind: 'success' });
        // Re-render this screen so the grid reflects reality.
        const host = document.getElementById('view');
        const { render } = await import('./me.js');
        await render(host, context);
      } catch (error) {
        toast(error.message, { kind: 'error' });
      } finally {
        input.value = '';
      }
    };
    reader.onerror = () => toast('Could not read that file.', { kind: 'error' });
    reader.readAsDataURL(file);
  });
}

function intentLabel(intent) {
  return {
    'long-term': 'A long-term relationship',
    'short-term': 'Something short-term',
    friends: 'Friends first',
    'figuring-it-out': 'Still figuring it out',
  }[intent] ?? intent;
}
