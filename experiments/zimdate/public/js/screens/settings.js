/** Settings: account, safety, data, admin entry, and the project's honesty notice. */
import { endpoints } from '../api.js';
import * as store from '../store.js';
import { esc, toast, confirmDialog, emptyState } from '../ui.js';
import { icon } from '../icons.js';

export async function render(host, context) {
  const { store } = context;
  const me = store.getState().me;

  host.innerHTML = `
    <h1 style="font-size:var(--step-3)">Settings</h1>
    <p class="muted small" style="margin-top:-.6rem;margin-bottom:var(--sp-4)">Signed in as ${esc(me.email)}</p>

    <div class="grid" style="grid-template-columns:minmax(0,1fr);gap:var(--sp-4)">
      <div class="card">
        <div class="card__head">${icon('shield', { size: 17 })}<h2>Verification</h2></div>
        <div class="card__body">
          <div class="row row--between">
            <div>
              <div class="row" style="gap:.4rem">
                <strong>${me.verified ? 'Verified profile' : 'Not verified'}</strong>
                ${me.verified ? `<span class="badge badge--moss">${icon('check', { size: 11 })} Verified</span>` : ''}
              </div>
              <p class="small muted" style="margin:.3rem 0 0;max-width:52ch">
                Verification is a self-service flag in this build. A production system would check a
                photo against a live selfie and store only the verdict — never the selfie.
              </p>
            </div>
            ${me.verified ? '' : '<button class="btn btn--primary btn--sm" id="verify">Mark me verified</button>'}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head">${icon('users', { size: 17 })}<h2>Safety</h2></div>
        <div class="card__body stack">
          <div class="row row--between">
            <div><strong class="small">Blocked people</strong><p class="tiny faint" style="margin:0">Blocked people cannot see you or contact you.</p></div>
            <span class="chip" id="blocked-count">…</span>
          </div>
          <div class="row row--between">
            <div><strong class="small">Who viewed you</strong><p class="tiny faint" style="margin:0">Profile views are recorded so you can see interest.</p></div>
            <button class="btn btn--ghost btn--sm" id="views">Show</button>
          </div>
          <div class="notice">${icon('info', { size: 16 })}<div>Reports go to a human review queue. You can report or block anyone from their profile.</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card__head">${icon('settings', { size: 17 })}<h2>Account</h2></div>
        <div class="card__body stack">
          <div class="row row--between">
            <div><strong class="small">Plan</strong><p class="tiny faint" style="margin:0">${me.tier === 'free' ? 'Free' : me.tier === 'plus' ? 'Plus' : 'Gold'}${me.tierUntil ? ` until ${new Date(me.tierUntil).toLocaleDateString('en-ZW')}` : ''}</p></div>
            <a class="btn btn--ghost btn--sm" href="#/plans">Manage</a>
          </div>
          <div class="row row--between">
            <div><strong class="small">ZimCoins</strong><p class="tiny faint" style="margin:0">Used for super likes and boosts.</p></div>
            <span class="chip chip--gold">${me.coins}</span>
          </div>
          ${me.isAdmin ? `<div class="row row--between"><div><strong class="small">Trust &amp; Safety</strong><p class="tiny faint" style="margin:0">You have moderator access.</p></div><a class="btn btn--sm btn--ghost" href="#/admin">Open</a></div>` : ''}
          <hr class="divider" style="margin:.5rem 0">
          <div class="row row--between">
            <div><strong class="small">Log out</strong><p class="tiny faint" style="margin:0">Ends this session on this device.</p></div>
            <button class="btn btn--ghost btn--sm" id="logout">${icon('logout', { size: 15 })} Log out</button>
          </div>
          <div class="row row--between">
            <div><strong class="small" style="color:var(--danger)">Delete my account</strong><p class="tiny faint" style="margin:0">Removes your profile, answers, matches and messages.</p></div>
            <button class="btn btn--danger btn--sm" id="delete">Delete</button>
          </div>
        </div>
      </div>

      <div class="card card--flat">
        <div class="card__body">
          <h3 style="font-size:var(--step-1)">About this build</h3>
          <p class="small muted">
            ZimDate is an original, clean-room implementation of a questionnaire-driven dating
            product, built as a study in this repository. It is not affiliated with OkCupid and
            contains no code, copy, or data from it. The reverse-engineering notes live in
            <code class="mono">experiments/zimdate/REVERSE_ENGINEERING.md</code>.
          </p>
          <p class="tiny faint" style="margin:0">Version 1.0.0 · MIT</p>
        </div>
      </div>
    </div>`;

  host.querySelector('#verify')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await endpoints.verifyMe();
      await store.refreshMe();
      toast(
        result.alreadyVerified
          ? 'You are already verified.'
          : 'Verified. In a production build this is a liveness check against a live selfie.',
        { kind: 'success', duration: 6000 },
      );
      button.textContent = 'Verified';
    } catch (error) {
      button.disabled = false;
      toast(error.message, { kind: 'error' });
    }
  });

  host.querySelector('#views')?.addEventListener('click', async () => {
    try {
      const data = await endpoints.views();
      if (!data.visible) {
        toast(`${data.count} people viewed your profile. ${data.hint}`, { duration: 6000 });
        return;
      }
      toast(`${data.count} people viewed your profile: ${data.viewers.slice(0, 5).map((viewer) => viewer.name).join(', ')}`, { duration: 7000 });
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  });

  host.querySelector('#logout').addEventListener('click', async () => {
    try {
      await endpoints.logout();
      store.applyMe({ user: null });
      location.hash = '#/welcome';
      location.reload();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  });

  host.querySelector('#delete').addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Delete your account?',
      'This removes your profile, photos, answers, likes, matches and messages. It cannot be undone.',
      { okLabel: 'Delete everything', danger: true },
    );
    if (!ok) return;
    const second = await confirmDialog(
      'Last check',
      'Are you completely sure? There is no recovery and no export afterwards.',
      { okLabel: 'Yes, delete', danger: true },
    );
    if (!second) return;
    toast('Account deletion is disabled in this demo build so the seeded world stays intact.', { kind: 'error', duration: 6000 });
  });
}
