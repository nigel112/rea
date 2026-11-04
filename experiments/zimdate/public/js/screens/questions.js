/**
 * Questions: the engine of the whole product.
 *
 * The answer editor enforces the three-part contract (answer / acceptable answers / importance)
 * and explains the arithmetic as you go, including the two mistakes everyone makes:
 *   - not accepting your own answer (quietly lowers every future match)
 *   - marking everything mandatory (dilutes your own score)
 */
import { endpoints } from '../api.js';
import { esc, toast, chips } from '../ui.js';
import { icon } from '../icons.js';

const state = {
  category: 'values',
  answered: new Map(),
  open: null,
  draft: null,
};

export async function render(host, context) {
  const { store } = context;
  const meta = store.getState().meta;

  host.innerHTML = `
    <div class="row row--between" style="margin-bottom:var(--sp-4);align-items:flex-start">
      <div>
        <h1 style="margin:0;font-size:var(--step-3)">Questions</h1>
        <p class="muted small" style="margin:.15rem 0 0">Every answer sharpens your match percentages. There is no "right" answer.</p>
      </div>
      <div class="card card--flat" style="min-width:170px">
        <div class="card__body" style="padding:.75rem 1rem">
          <div class="row row--between small" style="margin-bottom:.35rem">
            <span class="muted">Answered</span><strong id="answered-count">…</strong>
          </div>
          <div class="progress"><div class="progress__bar" id="answered-bar" style="width:0%"></div></div>
          <div class="tiny faint" style="margin-top:.35rem">15+ unlocks reliable scores</div>
        </div>
      </div>
    </div>

    <div class="qq">
      <nav class="cat-list" aria-label="Question categories" id="cats"></nav>
      <div>
        <div id="cat-head"></div>
        <div id="question-list" class="stack"></div>
      </div>
    </div>`;

  const cats = host.querySelector('#cats');
  const list = host.querySelector('#question-list');
  const head = host.querySelector('#cat-head');
  const countEl = host.querySelector('#answered-count');
  const barEl = host.querySelector('#answered-bar');

  function paintCats() {
    cats.innerHTML = meta.categories
      .map((category) => {
        const total = meta.questions.filter((question) => question.category === category).length;
        const done = meta.questions.filter((question) => question.category === category && state.answered.has(question.id)).length;
        return `<button class="cat-item" data-cat="${esc(category)}" aria-current="${state.category === category}">
          <span>${categoryLabel(category)}</span>
          <span class="cat-item__count">${done}/${total}</span>
        </button>`;
      })
      .join('') +
      `<button class="cat-item" data-cat="__all" aria-current="${state.category === '__all'}">
        <span>All questions</span><span class="cat-item__count">${state.answered.size}/${meta.questions.length}</span>
      </button>`;
    cats.querySelectorAll('[data-cat]').forEach((button) => {
      button.addEventListener('click', () => {
        state.category = button.dataset.cat;
        state.open = null;
        paintCats();
        paintList();
      });
    });
  }

  function paintProgress() {
    countEl.textContent = `${state.answered.size} / ${meta.questions.length}`;
    barEl.style.width = `${Math.round((state.answered.size / meta.questions.length) * 100)}%`;
  }

  function paintList() {
    const questions = meta.questions.filter((question) => state.category === '__all' || question.category === state.category);
    const done = questions.filter((question) => state.answered.has(question.id)).length;
    head.innerHTML = `
      <div class="row row--between" style="margin-bottom:var(--sp-3)">
        <h2 style="margin:0;font-size:var(--step-2)">${state.category === '__all' ? 'All questions' : categoryLabel(state.category)}</h2>
        <span class="small faint">${done} of ${questions.length} answered</span>
      </div>`;

    list.innerHTML = questions
      .map((question) => {
        const answer = state.answered.get(question.id);
        const open = state.open === question.id;
        return `
        <div data-q="${esc(question.id)}">
          <button class="qrow" aria-expanded="${open}" data-toggle="${esc(question.id)}">
            <span class="qrow__state">${answer ? `<span class="badge badge--moss">${icon('check', { size: 12 })} ${esc(importanceShort(answer.importance))}</span>` : `<span class="badge">Unanswered</span>`}</span>
            <span class="qrow__text">${esc(question.text)}</span>
            ${icon('chevronDown', { size: 18 })}
          </button>
          <div class="answer-editor" ${open ? '' : 'hidden'} data-editor="${esc(question.id)}"></div>
        </div>`;
      })
      .join('');

    list.querySelectorAll('[data-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.toggle;
        state.open = state.open === id ? null : id;
        paintList();
        if (state.open) {
          const editor = list.querySelector(`[data-editor="${CSS.escape(state.open)}"]`);
          editor?.querySelector('input, button')?.focus();
        }
      });
    });

    if (state.open) {
      const question = meta.questions.find((candidate) => candidate.id === state.open);
      const container = list.querySelector(`[data-editor="${CSS.escape(state.open)}"]`);
      if (question && container) paintEditor(container, question, context);
    }
  }

  function paintEditor(container, question, context) {
    const existing = state.answered.get(question.id);
    const draft = state.draft?.questionId === question.id
      ? state.draft
      : {
          questionId: question.id,
          answer: existing?.answer ?? '',
          accept: new Set(existing ? existing.accept : []),
          importance: existing?.importance ?? 'somewhat',
          explanation: existing?.explanation ?? '',
          visibility: existing?.visibility ?? 'public',
        };
    state.draft = draft;

    container.innerHTML = `
      <div class="stack">
        <div>
          <span class="label">Your answer</span>
          <div class="opt-grid" style="margin-top:.4rem">
            ${question.options
              .map(
                (option) => `<label class="opt">
                  <input type="radio" name="answer-${esc(question.id)}" value="${esc(option.id)}" ${draft.answer === option.id ? 'checked' : ''}>
                  <span>${esc(option.label)}</span>
                </label>`,
              )
              .join('')}
          </div>
        </div>

        <div>
          <span class="label">Which answers would you accept from a partner?</span>
          <p class="tiny faint" style="margin:.2rem 0 .4rem">This is what actually drives your match % — not your own answer.</p>
          <div class="opt-grid">
            ${question.options
              .map(
                (option) => `<label class="opt">
                  <input type="checkbox" name="accept-${esc(question.id)}" value="${esc(option.id)}" ${draft.accept.has(option.id) ? 'checked' : ''}>
                  <span>${esc(option.label)}</span>
                </label>`,
              )
              .join('')}
          </div>
          <div id="accept-warning-${esc(question.id)}"></div>
        </div>

        <div>
          <span class="label">How important is this to you?</span>
          <div class="importance" style="margin-top:.4rem" role="group" aria-label="Importance">
            ${context.store
              .getState()
              .meta.importanceLevels.map(
                (level) => `<button class="imp-btn" type="button" data-imp="${level.key}" aria-pressed="${draft.importance === level.key}">
                  ${esc(level.label)}<small>${level.points} pts</small>
                </button>`,
              )
              .join('')}
          </div>
        </div>

        <label class="field" style="margin:0">
          <span class="label">Explain your answer <span class="faint">(optional)</span></span>
          <textarea class="textarea" name="explanation" maxlength="1000" placeholder="Anything a match should know about this answer?">${esc(draft.explanation)}</textarea>
        </label>

        <div class="row row--between">
          <label class="switch"><input type="checkbox" name="private" ${draft.visibility === 'private' ? 'checked' : ''}> Keep this answer private</label>
          <div class="row" style="gap:.5rem">
            ${existing ? `<button class="btn btn--ghost btn--sm" data-delete>${icon('trash', { size: 15 })} Remove</button>` : ''}
            <button class="btn btn--primary" data-save>${existing ? 'Update answer' : 'Save answer'}</button>
          </div>
        </div>
        <p class="tiny faint">Private answers still count towards your score — they are simply never shown.</p>
      </div>`;

    const warningSlot = container.querySelector(`#accept-warning-${CSS.escape(question.id)}`);
    const refreshWarning = () => {
      const selected = [...container.querySelectorAll(`input[name="accept-${CSS.escape(question.id)}"]:checked`)].map((box) => box.value);
      const messages = [];
      if (draft.answer && !selected.includes(draft.answer)) {
        messages.push('You did not accept your own answer. That will lower every match on this question — usually by accident.');
      }
      if (selected.length === question.options.length) {
        messages.push('You accept everything, so this question cannot help you discriminate. Consider marking it less important.');
      }
      warningSlot.innerHTML = messages
        .map((message) => `<div class="notice notice--clay" style="margin-top:.4rem">${icon('alert', { size: 15 })}<span>${esc(message)}</span></div>`)
        .join('');
    };

    container.querySelectorAll('input[type=radio]').forEach((input) => {
      input.addEventListener('change', () => {
        draft.answer = input.value;
        refreshWarning();
      });
    });
    container.querySelectorAll('input[type=checkbox][name^="accept-"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) draft.accept.add(input.value);
        else draft.accept.delete(input.value);
        refreshWarning();
      });
    });
    container.querySelectorAll('[data-imp]').forEach((button) => {
      button.addEventListener('click', () => {
        draft.importance = button.dataset.imp;
        container.querySelectorAll('[data-imp]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      });
    });
    container.querySelector('[name=explanation]').addEventListener('input', (event) => {
      draft.explanation = event.target.value;
    });
    container.querySelector('[name=private]').addEventListener('change', (event) => {
      draft.visibility = event.target.checked ? 'private' : 'public';
    });

    container.querySelector('[data-delete]')?.addEventListener('click', async () => {
      const ok = await context.store.getState() && window.confirm('Remove this answer? Your match percentages will be recalculated without it.');
      if (!ok) return;
      try {
        const result = await endpoints.deleteAnswer(question.id);
        state.answered.delete(question.id);
        state.draft = null;
        state.open = null;
        paintCats();
        paintProgress();
        paintList();
        await context.store.refreshMe();
        toast(`Answer removed. ${result.answeredCount} questions answered.`);
      } catch (error) {
        toast(error.message, { kind: 'error' });
      }
    });

    container.querySelector('[data-save]').addEventListener('click', async () => {
      if (!draft.answer) {
        toast('Pick your answer first.', { kind: 'error' });
        return;
      }
      if (draft.accept.size === 0) {
        toast('Choose at least one answer you would accept.', { kind: 'error' });
        return;
      }
      const button = container.querySelector('[data-save]');
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        const payload = {
          questionId: question.id,
          answer: draft.answer,
          accept: [...draft.accept],
          importance: draft.importance,
          explanation: draft.explanation,
          visibility: draft.visibility,
        };
        const result = await endpoints.saveAnswer(payload);
        state.answered.set(question.id, payload);
        state.draft = null;
        paintCats();
        paintProgress();
        // Auto-advance to the next unanswered question in this category.
        const questions = context.store.getState().meta.questions.filter(
          (candidate) => state.category === '__all' || candidate.category === state.category,
        );
        const nextUnanswered = questions.find((candidate) => !state.answered.has(candidate.id));
        state.open = nextUnanswered?.id ?? null;
        paintList();
        await context.store.refreshMe();
        if (result.warnings?.length) toast(result.warnings[0], { kind: 'error', duration: 6000 });
        else toast(`Saved. ${result.answeredCount} question${result.answeredCount === 1 ? '' : 's'} answered.`, { kind: 'success' });
      } catch (error) {
        toast(error.message, { kind: 'error' });
        button.disabled = false;
        button.textContent = 'Save answer';
      }
    });

    refreshWarning();
  }

  // Initial data.
  try {
    const mine = await endpoints.myAnswers();
    for (const answer of mine.answers) state.answered.set(answer.question_id, { ...answer, accept: answer.accept ?? [] });
    // Start on a category that still has gaps.
    const firstGap = meta.categories.find((category) =>
      meta.questions.some((question) => question.category === category && !state.answered.has(question.id)),
    );
    if (firstGap && state.answered.size > 0) state.category = firstGap;
  } catch (error) {
    toast(error.message, { kind: 'error' });
  }

  paintCats();
  paintProgress();
  paintList();
}

function categoryLabel(category) {
  return (
    {
      values: 'Values',
      lifestyle: 'Lifestyle',
      love: 'Love & dating',
      culture: 'Culture',
      family: 'Family',
      faith: 'Faith',
      money: 'Money',
      fun: 'Fun',
    }[category] ?? category
  );
}

function importanceShort(importance) {
  return { irrelevant: 'Irrelevant', little: 'A little', somewhat: 'Somewhat', very: 'Very', mandatory: 'Mandatory' }[importance] ?? importance;
}
