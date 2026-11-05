/**
 * Shared rendering primitives: escaping, formatting, toasts, dialogs, and the components used by
 * more than one screen (match rings, profile cards, empty states).
 */
import { icon } from './icons.js';

/* ------------------------------------------------------------------ safety */

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Only allow http(s) image URLs we produced, plus data: URIs for locally generated art. */
export function safeImageUrl(url) {
  if (!url) return null;
  if (typeof url !== 'string') return null;
  if (url.startsWith('/api/photos/')) return url;
  if (url.startsWith('data:image/')) return url;
  return null;
}

/* -------------------------------------------------------------- formatting */

export function formatMatch(value) {
  if (value === null || value === undefined) return '—';
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function ringTone(value) {
  if (value === null || value === undefined) return 'none';
  if (value >= 80) return 'great';
  if (value >= 60) return 'good';
  if (value >= 40) return 'fair';
  return 'low';
}

export function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 365) return new Date(iso).toLocaleDateString('en-ZW', { day: 'numeric', month: 'short' });
  return new Date(iso).toLocaleDateString('en-ZW', { month: 'short', year: 'numeric' });
}

export function clockTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-ZW', { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const isSameDay = date.toDateString() === today.toDateString();
  if (isSameDay) return 'Today';
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-ZW', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function distanceLabel(km) {
  if (km === null || km === undefined) return '';
  if (km < 1) return 'Nearby';
  if (km > 1000) return `${Math.round(km / 100) * 100} km away`;
  return `${km} km away`;
}

export function initials(name) {
  return String(name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/* ------------------------------------------------------------------ toasts */

let toastHost = null;

export function toast(message, options = {}) {
  toastHost ??= document.getElementById('toasts');
  if (!toastHost) return;
  const kind = options.kind ?? 'info';
  const element = document.createElement('div');
  element.className = `toast${kind === 'error' ? ' toast--error' : kind === 'success' ? ' toast--success' : ''}`;
  const glyph = kind === 'error' ? 'alert' : kind === 'success' ? 'checkCircle' : 'info';
  element.innerHTML = `${icon(glyph, { size: 18 })}<span>${esc(message)}</span>`;
  toastHost.append(element);
  setTimeout(() => {
    element.style.transition = 'opacity 200ms, transform 200ms';
    element.style.opacity = '0';
    element.style.transform = 'translateY(6px)';
    setTimeout(() => element.remove(), 220);
  }, options.duration ?? 4200);
}

/* ----------------------------------------------------------------- dialogs */

/**
 * Promise-based confirm. Uses <dialog> so focus trapping and Esc come from the platform.
 * @returns {Promise<boolean>}
 */
export function confirmDialog(title, message, options = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.innerHTML = `
      <div class="modal__body">
        <h3 style="margin-bottom:.5rem">${esc(title)}</h3>
        <p class="muted" style="margin:0">${esc(message)}</p>
      </div>
      <div class="modal__foot">
        <button class="btn btn--ghost" data-act="cancel">${esc(options.cancelLabel ?? 'Cancel')}</button>
        <button class="btn ${options.danger ? 'btn--danger' : 'btn--primary'}" data-act="ok">${esc(options.okLabel ?? 'Confirm')}</button>
      </div>`;
    document.body.append(dialog);
    dialog.addEventListener('click', (event) => {
      const action = event.target.closest('[data-act]')?.dataset.act;
      if (!action) return;
      dialog.close();
      resolve(action === 'ok');
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      dialog.close();
      resolve(false);
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    dialog.querySelector('[data-act="ok"]')?.focus();
  });
}

/* -------------------------------------------------------------- components */

export function matchRing(value, options = {}) {
  const size = options.size ?? 'md';
  const tone = ringTone(value);
  const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value));
  const sizeClass = size === 'sm' ? ' ring--sm' : size === 'lg' ? ' ring--lg' : '';
  const label =
    value === null || value === undefined
      ? '<span class="ring__label" style="font-size:.7rem">—</span>'
      : `<span class="ring__label">${formatMatch(value).replace('%', '')}<small>match</small></span>`;
  return `<div class="ring ring--${tone}${sizeClass}" style="--pct:${pct}" role="img"
    aria-label="Match ${value === null ? 'not available' : formatMatch(value)}">${label}</div>`;
}

export function scoreFigures(friend, enemy) {
  return `
    <div class="score-figures">
      <div>
        <div class="figure__value">${friend === null ? '—' : formatMatch(friend)}</div>
        <div class="figure__label">Friend</div>
      </div>
      <div>
        <div class="figure__value">${enemy === null ? '—' : formatMatch(enemy)}</div>
        <div class="figure__label">Enemy</div>
      </div>
    </div>`;
}

/**
 * Empty / denied / error states.
 *
 * `headingLevel` matters more than it looks: an empty state can be a block inside a page (h2) or
 * the entire page — a 404, a permission wall (h1). Getting it wrong leaves a screen with no
 * top-level heading at all, which is invisible on screen and very loud in a screen reader.
 */
export function emptyState({ title, body, iconName = 'heart', action = '', headingLevel = 2 }) {
  const Heading = headingLevel === 1 ? 'h1' : headingLevel === 3 ? 'h3' : 'h2';
  return `<div class="empty">
    ${icon(iconName, { size: 56, class: 'empty__icon' })}
    <${Heading}>${esc(title)}</${Heading}>
    <p class="muted">${esc(body)}</p>
    ${action}
  </div>`;
}

export function skeletonGrid(count = 8) {
  return `<div class="grid grid--cards">${Array.from({ length: count }, () => '<div class="skeleton skeleton--card"></div>').join('')}</div>`;
}

export function spinner(label = 'Loading…') {
  return `<div class="empty" role="status" aria-live="polite">
    <div class="skeleton" style="width:44px;height:44px;border-radius:50%"></div>
    <p class="muted small">${esc(label)}</p>
  </div>`;
}

/**
 * A person card. `card` is the shape returned by /api/stack and /api/discover.
 */
export function personCard(card, options = {}) {
  const profile = card.profile;
  const photo = safeImageUrl(profile.photos?.[0]?.url);
  const flags = [];
  if (profile.verified) flags.push(`<span class="pill-flag pill-flag--gold">${icon('shield', { size: 11 })} Verified</span>`);
  if (card.likesViewer) flags.push(`<span class="pill-flag pill-flag--like">${icon('heartFilled', { size: 11 })} Likes you</span>`);
  if (card.boosted) flags.push(`<span class="pill-flag">${icon('bolt', { size: 11 })} Boosted</span>`);

  const subtitle = [profile.age ? `${profile.age}` : null, profile.city]
    .filter(Boolean)
    .join(' · ');

  return `<a class="pcard" href="#/profile/${encodeURIComponent(profile.id)}" aria-label="${esc(profile.name)}, ${esc(subtitle)}">
    <div class="pcard__media">
      ${photo ? `<img src="${esc(photo)}" alt="${esc(profile.name)}" loading="lazy" decoding="async">` : `<div class="skeleton" style="height:100%"></div>`}
      <div class="pcard__ring">${matchRing(card.match, { size: 'sm' })}</div>
      ${flags.length ? `<div class="pcard__flags">${flags.join('')}</div>` : ''}
      <div class="pcard__meta">
        <div class="pcard__name">${esc(profile.name)}</div>
        <div class="pcard__sub">${esc(subtitle)}${profile.distanceKm != null ? ` · ${esc(distanceLabel(profile.distanceKm))}` : ''}</div>
      </div>
    </div>
    <div class="pcard__body">
      <div class="pcard__headline">${esc(profile.headline || 'No headline yet')}</div>
      <div class="tiny faint">${esc(card.scoreNote ?? '')}</div>
    </div>
  </a>`;
}

export function avatar(url, name, size = 46) {
  const safe = safeImageUrl(url);
  const style = `width:${size}px;height:${size}px`;
  if (safe) {
    return `<span class="thread-item__avatar" style="${style}"><img src="${esc(safe)}" alt="" loading="lazy" decoding="async"></span>`;
  }
  return `<span class="thread-item__avatar" style="${style};display:grid;place-items:center;font-size:${Math.round(size * 0.32)}px;font-weight:700;color:var(--ink-500);background:var(--cream-200)">${esc(initials(name))}</span>`;
}

/** Render a list of chips, capped. */
export function chips(items, limit = 8, className = 'chip') {
  const list = (items ?? []).slice(0, limit);
  const extra = (items ?? []).length - list.length;
  return (
    list.map((item) => `<span class="${className}">${esc(item)}</span>`).join('') +
    (extra > 0 ? `<span class="${className}">+${extra} more</span>` : '')
  );
}

/* ------------------------------------------------------------ small helpers */

export function debounce(fn, wait = 220) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

export function focusMain() {
  const main = document.getElementById('main');
  if (main) {
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }
}

export function setTitle(title) {
  document.title = title ? `${title} · ZimDate` : 'ZimDate — serious dating, built for Zimbabwe';
}
