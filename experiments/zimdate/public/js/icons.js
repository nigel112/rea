/** Inline SVG icons. Stroke-based, 24×24, currentColor — one visual language everywhere. */
const paths = {
  heart: '<path d="M20.8 8.6a5.1 5.1 0 0 0-8.8-2.4 5.1 5.1 0 0 0-8.8 2.4c0 5 8.8 11.1 8.8 11.1s8.8-6.1 8.8-11.1Z"/>',
  heartFilled: '<path d="M20.8 8.6a5.1 5.1 0 0 0-8.8-2.4 5.1 5.1 0 0 0-8.8 2.4c0 5 8.8 11.1 8.8 11.1s8.8-6.1 8.8-11.1Z" fill="currentColor"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  star: '<path d="m12 3 2.7 5.9 6.3.8-4.6 4.4 1.2 6.3L12 17.3 6.4 20.4l1.2-6.3L3 9.7l6.3-.8L12 3Z"/>',
  starFilled: '<path d="m12 3 2.7 5.9 6.3.8-4.6 4.4 1.2 6.3L12 17.3 6.4 20.4l1.2-6.3L3 9.7l6.3-.8L12 3Z" fill="currentColor"/>',
  flame: '<path d="M12 3s5 4.2 5 8.5a5 5 0 0 1-10 0C7 9 9 7 9 7s.5 2.5 2 2.5S12 7 12 3Z"/><path d="M12 21a4 4 0 0 0 4-4c0-2-2-4-4-6-2 2-4 4-4 6a4 4 0 0 0 4 4Z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.8A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0"/><path d="M16 5.3a3.5 3.5 0 0 1 0 6.8M17.5 21a6.5 6.5 0 0 0-2-4.7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  mapPin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrowRight: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  arrowLeft: '<path d="M20 12H4M10 18l-6-6 6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  shield: '<path d="M12 3 20 6v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.9 5.9A9.4 9.4 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-3.4 4.1M6.3 7.4A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 3.6-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  send: '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-8-8-4L21 3Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  flag: '<path d="M4 21V4M4 4h11l-1.5 3.5L15 11H4"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2V5Z"/><path d="M8 3v18"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  graduation: '<path d="m2 9 10-5 10 5-10 5L2 9Z"/><path d="M6 11.5V17c0 1.5 3 3 6 3s6-1.5 6-3v-5.5"/>',
  ruller: '<path d="M4 15 15 4l5 5L9 20l-5-5Z"/><path d="m8 11 2 2M11 8l2 2M14 5l2 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
  filter: '<path d="M3 5h18M6 12h12M10 19h4"/>',
  gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 13h18"/><path d="M12 8S9 3 6.5 4.5 8 8 12 8ZM12 8s3-5 5.5-3.5S16 8 12 8Z"/>',
};

/**
 * @param {keyof typeof paths} name
 * @param {{size?: number, class?: string, label?: string}} [options]
 */
export function icon(name, options = {}) {
  const path = paths[name] ?? paths.info;
  const size = options.size ?? 20;
  const className = options.class ? ` class="${options.class}"` : '';
  const label = options.label
    ? ` role="img" aria-label="${escapeAttr(options.label)}"`
    : ' aria-hidden="true"';
  return `<svg${className} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"${label}>${path}</svg>`;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export const brandMark = `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
  <path d="M32 50s-15-9.4-15-19.7A8.7 8.7 0 0 1 32 23a8.7 8.7 0 0 1 15 7.3C47 40.6 32 50 32 50Z" fill="currentColor" opacity="0.92"/>
  <circle cx="47" cy="15" r="5.5" fill="#d9a227"/>
</svg>`;
