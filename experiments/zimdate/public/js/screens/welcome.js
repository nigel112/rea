/**
 * Welcome: sign in / sign up.
 *
 * Signup is deliberately three short steps (who you are → who you want → credentials) because the
 * 18+ gate and the orientation pair must both be explicit, and because a single 12-field form is
 * where dating-app funnels go to die.
 */
import { endpoints } from '../api.js';
import { navigate } from '../router.js';
import { esc, toast } from '../ui.js';
import { icon, brandMark } from '../icons.js';

const DEMO = { email: 'demo@zimdate.test', password: 'ZimDate2026!' };

export async function render(host, context) {
  const { store } = context;
  const meta = store.getState().meta;
  host.innerHTML = `
    <div class="auth">
      <aside class="auth__brandside">
        <div>
          <div class="brand" style="color:var(--cream-50);font-size:1.5rem">
            <span class="brand__mark" style="width:30px;height:30px">${brandMark}</span>
            <span>Zim<em style="color:var(--gold-300)">Date</em></span>
          </div>
          <h1 class="auth__quote" style="margin-top:2.5rem">Stop guessing.<br>Start with 60 real questions.</h1>
          <p class="auth__sub">Most dating apps show you a face and hope. ZimDate shows you the arithmetic:
          exactly why you match, what you disagree on, and how confident the number is.</p>
        </div>
        <div>
          <div class="auth__stats">
            <div class="auth__stat"><b>60</b><span>Questions</span></div>
            <div class="auth__stat"><b>3</b><span>Honest scores</span></div>
            <div class="auth__stat"><b>0</b><span>Paid messages</span></div>
          </div>
          <p class="tiny" style="margin-top:1.5rem;color:rgba(253,250,245,.5)">
            A clean-room study of the questionnaire-driven dating category. Not affiliated with OkCupid.
          </p>
        </div>
      </aside>

      <section class="auth__formside">
        <div class="auth__panel">
          <div class="auth__tabs" role="tablist" aria-label="Sign in or sign up">
            <button class="auth__tab" role="tab" id="tab-login" aria-selected="true" aria-controls="pane-login">Sign in</button>
            <button class="auth__tab" role="tab" id="tab-signup" aria-selected="false" aria-controls="pane-signup">Join ZimDate</button>
          </div>
          <div id="pane-login" role="tabpanel" aria-labelledby="tab-login"></div>
          <div id="pane-signup" role="tabpanel" aria-labelledby="tab-signup" hidden></div>
        </div>
      </section>
    </div>`;

  const tabs = host.querySelectorAll('.auth__tab');
  const panes = { login: host.querySelector('#pane-login'), signup: host.querySelector('#pane-signup') };
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const which = tab.id === 'tab-login' ? 'login' : 'signup';
      tabs.forEach((other) => other.setAttribute('aria-selected', String(other === tab)));
      panes.login.hidden = which !== 'login';
      panes.signup.hidden = which !== 'signup';
      panes[which].querySelector('input, select, button')?.focus();
    });
  });

  renderLogin(panes.login, context);
  renderSignup(panes.signup, context, meta);
}

/* ------------------------------------------------------------------ login */

function renderLogin(pane, context) {
  pane.innerHTML = `
    <h2 style="font-size:var(--step-3);margin-bottom:.25rem">Welcome back</h2>
    <p class="muted small" style="margin-bottom:1.5rem">Your matches, messages and answers are where you left them.</p>
    <form novalidate>
      <div class="field">
        <label for="login-email">Email</label>
        <input class="input" id="login-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com">
      </div>
      <div class="field">
        <label for="login-password">Password</label>
        <input class="input" id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="••••••••">
      </div>
      <p class="field__error" id="login-error" hidden></p>
      <button class="btn btn--primary btn--block btn--lg" type="submit">Sign in</button>
    </form>
    <div class="demo-box">
      <strong>Demo account</strong> — sign in to explore a fully populated profile:
      <br><code>${esc(DEMO.email)}</code> / <code>${esc(DEMO.password)}</code>
      <div style="margin-top:.6rem"><button class="btn btn--quiet btn--sm" id="fill-demo">Fill demo credentials</button></div>
    </div>`;

  const form = pane.querySelector('form');
  const errorEl = pane.querySelector('#login-error');
  // `form.name` is the form's own name attribute, not a field named "name": always address
  // fields through `form.elements`, which is the only reliable name lookup on a form.
  const fields = form.elements;
  pane.querySelector('#fill-demo').addEventListener('click', () => {
    fields.email.value = DEMO.email;
    fields.password.value = DEMO.password;
    fields.password.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type=submit]');
    errorEl.hidden = true;
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const result = await endpoints.login(fields.email.value.trim(), fields.password.value);
      context.store.applyMe(result);
      toast(`Welcome back, ${result.user.name.split(' ')[0]}.`, { kind: 'success' });
      const destination = context.store.getState().redirectAfterAuth || '#/discover';
      context.store.getState().redirectAfterAuth = null;
      navigate(destination.replace(/^#/, ''), { replace: true });
    } catch (error) {
      errorEl.hidden = false;
      errorEl.textContent = error.message;
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });
}

/* ----------------------------------------------------------------- signup */

function renderSignup(pane, context, meta) {
  const cities = meta.cities.map((city) => `<option value="${esc(city.name)}">${esc(city.name)}</option>`).join('');
  pane.innerHTML = `
    <h2 style="font-size:var(--step-3);margin-bottom:.25rem">Join ZimDate</h2>
    <p class="muted small" style="margin-bottom:1rem">Three short steps. You must be 18 or older.</p>
    <div class="stepper" aria-hidden="true">
      <span class="stepper__dot stepper__dot--done"></span><span class="stepper__dot"></span><span class="stepper__dot"></span>
    </div>
    <form novalidate>
      <fieldset style="border:0;padding:0;margin:0" data-step="0">
        <legend class="label" style="margin-bottom:.6rem">About you</legend>
        <div class="field">
          <label for="su-name">First name</label>
          <input class="input" id="su-name" name="name" autocomplete="given-name" required maxlength="60" placeholder="e.g. Tariro">
        </div>
        <div class="field">
          <label for="su-birth">Date of birth</label>
          <input class="input" id="su-birth" name="birthDate" type="date" required max="${new Date(Date.now() - 18 * 365.25 * 86400000).toISOString().slice(0, 10)}" min="1900-01-01">
          <span class="field__hint">You must be 18 or older. We show your age, never your birth date.</span>
        </div>
        <div class="field">
          <label for="su-gender">I am a…</label>
          <select class="select" id="su-gender" name="gender" required>
            <option value="">Choose…</option>
            <option value="woman">Woman</option>
            <option value="man">Man</option>
            <option value="nonbinary">Non-binary</option>
          </select>
        </div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn--primary" type="button" data-next>Continue ${icon('arrowRight', { size: 15 })}</button></div>
      </fieldset>

      <fieldset style="border:0;padding:0;margin:0" data-step="1" hidden>
        <legend class="label" style="margin-bottom:.6rem">Who you would like to meet</legend>
        <div class="field">
          <span class="label">Show me</span>
          <div class="opt-grid">
            <label class="opt"><input type="checkbox" name="lookingFor" value="woman"> Women</label>
            <label class="opt"><input type="checkbox" name="lookingFor" value="man"> Men</label>
            <label class="opt"><input type="checkbox" name="lookingFor" value="nonbinary"> Non-binary people</label>
          </div>
          <span class="field__hint">Both people must be open to each other, so this works in both directions.</span>
        </div>
        <div class="field">
          <label for="su-intent">I am looking for</label>
          <select class="select" id="su-intent" name="intent">
            <option value="long-term">A long-term relationship</option>
            <option value="short-term">Something short-term</option>
            <option value="friends">Friends first</option>
            <option value="figuring-it-out">Still figuring it out</option>
          </select>
        </div>
        <div class="field">
          <label for="su-city">City</label>
          <select class="select" id="su-city" name="city" required>${cities}</select>
        </div>
        <div class="row" style="justify-content:space-between">
          <button class="btn btn--ghost" type="button" data-back>${icon('arrowLeft', { size: 15 })} Back</button>
          <button class="btn btn--primary" type="button" data-next>Continue ${icon('arrowRight', { size: 15 })}</button>
        </div>
      </fieldset>

      <fieldset style="border:0;padding:0;margin:0" data-step="2" hidden>
        <legend class="label" style="margin-bottom:.6rem">Create your account</legend>
        <div class="field">
          <label for="su-email">Email</label>
          <input class="input" id="su-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com">
        </div>
        <div class="field">
          <label for="su-password">Password</label>
          <input class="input" id="su-password" name="password" type="password" autocomplete="new-password" required minlength="8" placeholder="At least 8 characters">
          <span class="field__hint">Stored as a salted scrypt hash. We never see it in plain text.</span>
        </div>
        <p class="field__error" id="signup-error" hidden></p>
        <div class="row" style="justify-content:space-between;margin-top:.5rem">
          <button class="btn btn--ghost" type="button" data-back>${icon('arrowLeft', { size: 15 })} Back</button>
          <button class="btn btn--primary btn--lg" type="submit">Create account</button>
        </div>
      </fieldset>
    </form>`;

  const form = pane.querySelector('form');
  const fields = form.elements;
  const steps = [...pane.querySelectorAll('[data-step]')];
  const dots = [...pane.querySelectorAll('.stepper__dot')];
  const errorEl = pane.querySelector('#signup-error');
  let step = 0;

  function show(next) {
    step = Math.max(0, Math.min(steps.length - 1, next));
    steps.forEach((element, index) => {
      element.hidden = index !== step;
    });
    dots.forEach((dot, index) => dot.classList.toggle('stepper__dot--done', index <= step));
    steps[step].querySelector('input, select, button')?.focus();
  }

  function validateStep(index) {
    if (index === 0) {
      if (!fields.name.value.trim() || fields.name.value.trim().length < 2) return 'Please enter your first name.';
      if (!fields.birthDate.value) return 'Please enter your date of birth.';
      const age = (Date.now() - new Date(fields.birthDate.value).getTime()) / (365.25 * 86400000);
      if (age < 18) return 'You must be 18 or older to join ZimDate.';
      if (age > 110) return 'Please check your date of birth.';
      if (!fields.gender.value) return 'Please tell us how you identify.';
    }
    if (index === 1) {
      if ([...fields.lookingFor].filter((box) => box.checked).length === 0) return 'Choose at least one group you would like to meet.';
      if (!fields.city.value) return 'Choose your city.';
    }
    return null;
  }

  pane.querySelectorAll('[data-next]').forEach((button) => {
    button.addEventListener('click', () => {
      const problem = validateStep(step);
      if (problem) {
        toast(problem, { kind: 'error' });
        return;
      }
      show(step + 1);
    });
  });
  pane.querySelectorAll('[data-back]').forEach((button) => {
    button.addEventListener('click', () => show(step - 1));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const problem = validateStep(0) ?? validateStep(1);
    if (problem) {
      toast(problem, { kind: 'error' });
      return;
    }
    if (!fields.email.value.trim()) {
      errorEl.hidden = false;
      errorEl.textContent = 'Please enter your email.';
      return;
    }
    if (fields.password.value.length < 8) {
      errorEl.hidden = false;
      errorEl.textContent = 'Use at least 8 characters for your password.';
      return;
    }

    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    submit.textContent = 'Creating…';
    errorEl.hidden = true;

    try {
      const result = await endpoints.signup({
        name: fields.name.value.trim(),
        birthDate: fields.birthDate.value,
        gender: fields.gender.value,
        lookingFor: [...fields.lookingFor].filter((box) => box.checked).map((box) => box.value),
        intent: fields.intent.value,
        city: fields.city.value,
        email: fields.email.value.trim(),
        password: fields.password.value,
      });
      context.store.applyMe(result);
      toast('Welcome to ZimDate. Answer a few questions to unlock your match percentages.', { kind: 'success' });
      navigate('/questions');
    } catch (error) {
      errorEl.hidden = false;
      const fields = error.fields ? Object.entries(error.fields).map(([key, message]) => `${key}: ${message}`) : [];
      errorEl.textContent = fields.length ? fields.join(' · ') : error.message;
      submit.disabled = false;
      submit.textContent = 'Create account';
    }
  });

  show(0);
}
