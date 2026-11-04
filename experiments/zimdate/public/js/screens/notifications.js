/** Notifications: derived from real rows (likes, matches, messages, moderation). No invented events. */
import { endpoints } from '../api.js';
import { esc, emptyState, timeAgo, toast } from '../ui.js';
import { icon } from '../icons.js';

const META = {
  like: { icon: 'heart', label: 'liked you', tone: 'chip--clay' },
  match: { icon: 'users', label: 'You matched', tone: 'chip--accent' },
  message: { icon: 'chat', label: 'New message', tone: 'chip' },
  boost: { icon: 'bolt', label: 'Boost', tone: 'chip--gold' },
  system: { icon: 'info', label: 'ZimDate', tone: 'chip' },
  moderation: { icon: 'shield', label: 'Trust & Safety', tone: 'chip' },
  profile_view: { icon: 'eye', label: 'Viewed your profile', tone: 'chip' },
};

export async function render(host, context) {
  const { store } = context;

  host.innerHTML = `
    <div class="row row--between" style="margin-bottom:var(--sp-4)">
      <div>
        <h1 style="margin:0;font-size:var(--step-3)">Notifications</h1>
        <p class="muted small" style="margin:.15rem 0 0">Likes, matches, messages and moderation.</p>
      </div>
      <button class="btn btn--ghost btn--sm" id="mark-read">${icon('check', { size: 15 })} Mark all read</button>
    </div>
    <div id="list">${'<div class="skeleton" style="height:70px;margin-bottom:8px;border-radius:14px"></div>'.repeat(4)}</div>`;

  const list = host.querySelector('#list');

  async function paint() {
    try {
      const data = await endpoints.notifications();
      const items = data.notifications ?? [];
      if (items.length === 0) {
        list.innerHTML = emptyState({
          title: 'Nothing yet',
          body: 'Likes, matches and messages will appear here.',
          iconName: 'info',
        });
        return;
      }
      list.innerHTML = items
        .map((item) => {
          const meta = META[item.kind] ?? META.system;
          const href = linkFor(item);
          const title = titleFor(item);
          return `<${href ? 'a href="' + esc(href) + '"' : 'div'} class="card card--flat" style="display:block;margin-bottom:.5rem;text-decoration:none;color:inherit;${item.read ? 'opacity:.72' : ''}">
            <div class="card__body" style="padding:.85rem 1rem">
              <div class="row" style="gap:.75rem;align-items:flex-start">
                <span class="chip ${meta.tone}" style="flex:none">${icon(meta.icon, { size: 14 })}</span>
                <div style="flex:1;min-width:0">
                  <div class="row row--between" style="gap:.5rem">
                    <strong class="small">${esc(title)}</strong>
                    <span class="tiny faint" style="flex:none">${timeAgo(item.createdAt)}</span>
                  </div>
                  ${item.kind === 'message' && item.payload.preview ? `<p class="small muted" style="margin:.15rem 0 0">“${esc(item.payload.preview)}”</p>` : ''}
                  ${item.kind === 'system' && item.payload.body ? `<p class="small muted" style="margin:.15rem 0 0">${esc(item.payload.body)}</p>` : ''}
                  ${!item.read ? '<span class="badge badge--clay" style="margin-top:.35rem">New</span>' : ''}
                </div>
              </div>
            </div>
          </${href ? 'a' : 'div'}>`;
        })
        .join('');
    } catch (error) {
      list.innerHTML = emptyState({ title: 'Could not load notifications', body: error.message, iconName: 'alert' });
    }
  }

  host.querySelector('#mark-read').addEventListener('click', async () => {
    try {
      await endpoints.readNotifications();
      await store.refreshMe();
      await paint();
      toast('All caught up.');
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  });

  await paint();
}

function titleFor(item) {
  const payload = item.payload ?? {};
  switch (item.kind) {
    case 'like':
      return payload.super
        ? `${payload.fromName ?? 'Someone'} sent you a super like`
        : `${payload.fromName ?? 'Someone'} liked you`;
    case 'match':
      return 'You have a new match';
    case 'message':
      return `${payload.fromName ?? 'Someone'} sent you a message`;
    case 'moderation':
      return payload.title ?? 'Trust & Safety update';
    case 'boost':
      return 'Your boost is running';
    case 'system':
      return payload.title ?? 'ZimDate';
    default:
      return 'Notification';
  }
}

function linkFor(item) {
  const payload = item.payload ?? {};
  if (item.kind === 'like' && payload.from) return `#/profile/${payload.from}`;
  if (item.kind === 'match' && payload.matchId) return `#/matches/${payload.matchId}`;
  if (item.kind === 'message' && payload.matchId) return `#/matches/${payload.matchId}`;
  if (item.kind === 'boost') return '#/plans';
  if (item.kind === 'moderation') return '#/settings';
  return null;
}
