/**
 * Plans: the monetisation surface, with the simulated nature of checkout stated plainly.
 * The comparison table is generated from the same TIERS object the API enforces, so the page
 * cannot drift from the product rules.
 */
import { endpoints } from '../api.js';
import { esc, toast } from '../ui.js';
import { icon } from '../icons.js';

export async function render(host, context) {
  const { store } = context;
  const me = store.getState().me;
  const tiers = store.getState().meta.tiers;

  host.innerHTML = `
    <div class="center" style="max-width:60ch;margin-inline:auto;margin-bottom:var(--sp-6)">
      <h1 style="font-size:var(--step-3)">Plans</h1>
      <p class="muted">Messaging is free on every plan, forever. Paid plans unlock volume, visibility and a little extra information — never the ability to speak to someone who does not want to hear from you.</p>
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
      ${Object.values(tiers)
        .map((tier) => {
          const current = me.tier === tier.id;
          const featured = tier.id === 'plus';
          return `<div class="card plan-card" data-plan="${esc(tier.id)}" style="${featured ? 'border-color:var(--clay-500);box-shadow:var(--shadow)' : ''}">
            <div class="card__body">
              <div class="row row--between">
                <h2 style="margin:0;font-size:var(--step-2)">${esc(tier.name.replace('ZimDate ', ''))}</h2>
                ${current ? '<span class="badge badge--moss">Current</span>' : featured ? '<span class="badge badge--clay">Most popular</span>' : ''}
              </div>
              <p style="font-family:var(--font-display);font-size:var(--step-4);margin:.5rem 0 0">
                ${tier.priceUsd === 0 ? 'Free' : `$${tier.priceUsd}`}<span class="small muted" style="font-family:var(--font-body)">${tier.priceUsd === 0 ? '' : ' / month'}</span>
              </p>
              <p class="tiny faint" style="margin:.2rem 0 var(--sp-4)">${tier.priceUsd === 0 ? 'Everything you need to date seriously.' : `About ZWG ${(tier.priceUsd * 26).toLocaleString('en-ZW')} at today’s rate. EcoCash accepted where available.`}</p>
              <ul style="list-style:none;padding:0;margin:0 0 var(--sp-4);display:grid;gap:.45rem">
                ${featureList(tier)
                  .map((item) => `<li class="row" style="gap:.5rem;font-size:.88rem">${icon('checkCircle', { size: 16 })}<span>${esc(item)}</span></li>`)
                  .join('')}
              </ul>
              ${current
                ? `<button class="btn btn--ghost btn--block" disabled>Your plan</button>`
                : tier.id === 'free'
                  ? `<button class="btn btn--ghost btn--block" data-tier="free">Cancel subscription</button>`
                  : `<button class="btn ${featured ? 'btn--primary' : 'btn--ghost'} btn--block" data-tier="${esc(tier.id)}">Choose ${esc(tier.name.replace('ZimDate ', ''))}</button>`}
            </div>
          </div>`;
        })
        .join('')}
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));margin-top:var(--sp-5)">
      <div class="card card--flat">
        <div class="card__body">
          <h2 style="font-size:var(--step-1)">${icon('bolt', { size: 17 })} Boosts</h2>
          <p class="small muted">30 minutes of a real ranking lift in the stacks of people you could match with — as much as being recently active, and never enough to outrank a much better match. It changes where you appear, not what your match percentage says. Costs ${store.getState().meta.boost.cost} ZimCoins, or use a boost credit.</p>
          <div class="row row--between" style="margin-top:.6rem">
            <span class="chip chip--gold">${me.boostsLeft} credit${me.boostsLeft === 1 ? '' : 's'} · ${me.coins} coins</span>
            <button class="btn btn--sm btn--primary" id="boost">Start a boost</button>
          </div>
        </div>
      </div>
      <div class="card card--flat">
        <div class="card__body">
          <h2 style="font-size:var(--step-1)">${icon('info', { size: 17 })} Honest billing</h2>
          <p class="small muted" style="margin-bottom:0">Checkout in this build is simulated: no card is charged, no payment processor is contacted, and the API response says so. Plans last 30 days and drop back to Free automatically.</p>
        </div>
      </div>
    </div>`;

  host.querySelectorAll('[data-tier]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await endpoints.checkout(button.dataset.tier);
        await store.refreshMe();
        toast(result.note ?? 'Plan updated.', { kind: 'success', duration: 6000 });
        const { render } = context;
        const module = await import('./plans.js');
        await module.render(host, context);
      } catch (error) {
        button.disabled = false;
        toast(error.message, { kind: 'error' });
      }
    });
  });

  host.querySelector('#boost').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await endpoints.boost();
      await store.refreshMe();
      toast(`Boost active until ${new Date(result.expiresAt).toLocaleTimeString('en-ZW', { hour: '2-digit', minute: '2-digit' })}.`, { kind: 'success' });
    } catch (error) {
      toast(error.code === 'insufficient_coins' ? 'You need 20 ZimCoins for a boost.' : error.message, { kind: 'error' });
    } finally {
      button.disabled = false;
    }
  });
}

function featureList(tier) {
  const base = ['Free messaging with every match', '60 compatibility questions', 'Auditable match breakdown'];
  if (tier.id === 'free') return [...base, '25 likes per day', 'Undo your last pass'];
  if (tier.id === 'plus') return [...base, '100 likes per day', 'See everyone who likes you', 'See who viewed your profile', 'Read receipts'];
  return [...base, 'Unlimited likes', 'Everything in Plus', 'Priority in discovery', 'Advanced filters', 'First access to new features'];
}
