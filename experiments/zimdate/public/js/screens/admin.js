/**
 * Trust & Safety console.
 *
 * Deliberately blunt: a queue, a reason, an action, an audit trail. It shows the *pool* health
 * (how many people the filters exclude, and why) because that number explains almost every
 * "the app is empty" complaint, and it states its own limitations instead of implying omniscience.
 */
import { endpoints } from '../api.js';
import { esc, emptyState, toast, timeAgo, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';

export async function render(host, context) {
  const { store } = context;
  if (!store.getState().me?.isAdmin) {
    host.innerHTML = emptyState({
      title: 'Admins only',
      body: 'This area is for the Trust & Safety team.',
      iconName: 'shield',
      action: '<a class="btn btn--primary" href="#/discover">Back to discovery</a>',
      // A permission wall replaces the whole page, so it owns the page-level heading.
      headingLevel: 1,
    });
    return;
  }

  host.innerHTML = `
    <header class="row row--between" style="margin-bottom:var(--sp-4);align-items:flex-start">
      <div>
        <p class="eyebrow">Admin</p>
        <h1 style="margin:0;font-size:var(--step-3)">Trust &amp; Safety</h1>
        <p class="muted small" style="margin:.15rem 0 0">Reports, pool health and the moderation log.</p>
      </div>
      <button class="btn btn--ghost btn--sm" id="refresh">${icon('compass', { size: 15 })} Refresh</button>
    </header>
    <div id="stats"><div class="skeleton" style="height:180px;border-radius:22px"></div></div>
    <section class="section">
      <div class="row row--between">
        <h2 class="section__title" style="margin:0">Report queue</h2>
        <div class="row" role="group" aria-label="Filter by status" style="gap:.3rem">
          <button class="btn btn--sm btn--ghost" data-status="open" aria-pressed="true">Open</button>
          <button class="btn btn--sm btn--ghost" data-status="reviewing" aria-pressed="false">Reviewing</button>
          <button class="btn btn--sm btn--ghost" data-status="" aria-pressed="false">All</button>
        </div>
      </div>
      <div id="reports" style="margin-top:var(--sp-3)"></div>
    </section>
    <section class="section">
      <h2 class="section__title">Audit log</h2>
      <div id="audit"></div>
    </section>`;

  let status = 'open';

  async function loadStats() {
    const slot = host.querySelector('#stats');
    try {
      const data = await endpoints.adminStats();
      const pool = data.pool;
      const maxBucket = Math.max(1, ...Object.values(pool.buckets));
      slot.innerHTML = `
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
          <div class="card">
            <div class="card__head">${icon('users', { size: 17 })}<h2>Platform</h2></div>
            <div class="card__body">
              <dl class="kv">
                <dt>Profiles</dt><dd>${data.counts.users}</dd>
                <dt>Suspended</dt><dd>${data.counts.banned}</dd>
                <dt>Answers</dt><dd>${data.counts.answers}</dd>
                <dt>Likes</dt><dd>${data.counts.likes}</dd>
                <dt>Live matches</dt><dd>${data.counts.matches}</dd>
                <dt>Messages</dt><dd>${data.counts.messages}</dd>
                <dt>Open reports</dt><dd>${data.counts.openReports} / ${data.counts.reports}</dd>
                <dt>Uptime</dt><dd>${Math.round(data.uptimeSeconds / 60)} min</dd>
              </dl>
            </div>
          </div>
          <div class="card">
            <div class="card__head">${icon('compass', { size: 17 })}<h2>Your pool</h2></div>
            <div class="card__body">
              <p class="small muted">${pool.poolSize} eligible profiles · ${pool.scoredSize} scored · average match ${pool.avgMatch === null ? '—' : `${pool.avgMatch}%`}</p>
              <div class="stack" style="gap:.4rem;margin-top:.6rem">
                ${Object.entries(pool.buckets)
                  .map(
                    ([bucket, count]) => `<div class="row" style="gap:.6rem">
                      <span class="tiny faint" style="width:64px">${esc(bucket)}</span>
                      <div class="progress" style="flex:1"><div class="progress__bar" style="width:${Math.round((count / maxBucket) * 100)}%"></div></div>
                      <span class="tiny" style="width:28px;text-align:right">${count}</span>
                    </div>`,
                  )
                  .join('')}
              </div>
              <hr class="divider">
              <div class="small muted">Filtered out:</div>
              <div class="row" style="margin-top:.3rem">${Object.entries(pool.excluded).map(([reason, count]) => `<span class="chip chip--outline">${esc(reason.replace(/_/g, ' '))}: ${count}</span>`).join('') || '<span class="tiny faint">Nobody</span>'}</div>
            </div>
          </div>
          <div class="card">
            <div class="card__head">${icon('info', { size: 17 })}<h2>Known limitations</h2></div>
            <div class="card__body stack">
              ${data.limitations.map((limitation) => `<div class="notice">${icon('alert', { size: 15 })}<div>${esc(limitation)}</div></div>`).join('')}
              <div class="notice notice--gold">${icon('info', { size: 15 })}<div>Likes per day: ${data.counters.likes} this process · messages: ${data.counters.messages} · signups: ${data.counters.signups}.</div></div>
            </div>
          </div>
        </div>`;
    } catch (error) {
      slot.innerHTML = `<div class="notice notice--clay">${icon('alert')}<div>${esc(error.message)}</div></div>`;
    }
  }

  async function loadReports() {
    const slot = host.querySelector('#reports');
    slot.innerHTML = '<div class="skeleton" style="height:90px;border-radius:14px"></div>';
    try {
      const data = await endpoints.adminReports(status || undefined);
      if (data.reports.length === 0) {
        slot.innerHTML = emptyState({ title: 'Queue is clear', body: 'No reports with that status.', iconName: 'shield' });
        return;
      }
      slot.innerHTML = `<div class="card card--flat"><div class="card__body" style="padding:0;overflow-x:auto">
        <table class="table">
          <thead><tr><th>Reported</th><th>Reason</th><th>By</th><th>When</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            ${data.reports
              .map(
                (report) => `<tr>
                  <td><a href="#/profile/${encodeURIComponent(report.target.id)}">${esc(report.target.name)}</a><div class="tiny faint">${esc(report.target.id)}</div></td>
                  <td>${esc(report.reason.replace(/_/g, ' '))}${report.details ? `<div class="tiny faint" style="max-width:28ch">${esc(report.details)}</div>` : ''}</td>
                  <td class="small">${esc(report.reporter.name)}</td>
                  <td class="small">${timeAgo(report.createdAt)}</td>
                  <td><span class="badge ${report.status === 'open' ? 'badge--clay' : report.status === 'actioned' ? 'badge--moss' : ''}">${esc(report.status)}</span></td>
                  <td>
                    ${report.status === 'open' || report.status === 'reviewing'
                      ? `<div class="row" style="gap:.3rem">
                          <button class="btn btn--sm btn--ghost" data-resolve="${esc(report.id)}" data-action="dismiss">Dismiss</button>
                          <button class="btn btn--sm btn--quiet" data-resolve="${esc(report.id)}" data-action="warn">Warn</button>
                          <button class="btn btn--sm btn--danger" data-resolve="${esc(report.id)}" data-action="ban">Ban</button>
                        </div>`
                      : `<span class="tiny faint">${esc(report.action ?? '—')}</span>`}
                  </td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div></div>`;

      slot.querySelectorAll('[data-resolve]').forEach((button) => {
        button.addEventListener('click', async () => {
          const action = button.dataset.action;
          const reportId = button.dataset.resolve;
          if (action === 'ban') {
            const ok = await confirmDialog('Ban this user?', 'They will be signed out and removed from discovery. The action is logged.', {
              okLabel: 'Ban',
              danger: true,
            });
            if (!ok) return;
          }
          button.disabled = true;
          try {
            await endpoints.adminResolve(reportId, action);
            toast(`Report resolved: ${action}.`, { kind: 'success' });
            await loadReports();
            await loadAudit();
            await loadStats();
          } catch (error) {
            button.disabled = false;
            toast(error.message, { kind: 'error' });
          }
        });
      });
    } catch (error) {
      slot.innerHTML = `<div class="notice notice--clay">${icon('alert')}<div>${esc(error.message)}</div></div>`;
    }
  }

  async function loadAudit() {
    const slot = host.querySelector('#audit');
    try {
      const data = await endpoints.adminAudit();
      if (data.entries.length === 0) {
        slot.innerHTML = '<p class="small muted">No moderation actions yet.</p>';
        return;
      }
      slot.innerHTML = `<div class="card card--flat"><div class="card__body" style="padding:0;overflow-x:auto">
        <table class="table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Notes</th></tr></thead>
          <tbody>
            ${data.entries
              .map(
                (entry) => `<tr>
                  <td class="small">${timeAgo(entry.created_at)}</td>
                  <td class="small">${esc(entry.actor_name ?? 'system')}</td>
                  <td><span class="badge ${entry.action === 'ban' ? 'badge--danger' : entry.action === 'dismiss' ? '' : 'badge--moss'}">${esc(entry.action)}</span></td>
                  <td class="tiny mono">${esc(entry.target_type)} · ${esc(entry.target_id).slice(0, 16)}</td>
                  <td class="small muted">${esc(entry.notes ?? '')}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div></div>`;
    } catch (error) {
      slot.innerHTML = `<div class="notice notice--clay">${icon('alert')}<div>${esc(error.message)}</div></div>`;
    }
  }

  host.querySelectorAll('[data-status]').forEach((button) => {
    button.addEventListener('click', () => {
      status = button.dataset.status;
      host.querySelectorAll('[data-status]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      loadReports();
    });
  });

  host.querySelector('#refresh').addEventListener('click', () => {
    loadStats();
    loadReports();
    loadAudit();
  });

  await Promise.all([loadStats(), loadReports(), loadAudit()]);
}
