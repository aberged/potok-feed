import { html, nothing, render, type TemplateResult } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { createFeed, FEED_GROUP, type Feed, type FeedState } from './feed';
import type { PotokSubgroup } from './potok';

const chatIcon = html`
  <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z"
    />
  </svg>
`;

/** A screen with no stories: loading, nothing to show or a failure. */
const message = (title: string, hint?: string, action?: TemplateResult) => html`
  <div class="feed-card items-center justify-center gap-2 px-8 text-center text-base-content">
    <p class="text-lg font-semibold">${title}</p>
    ${hint ? html`<p class="max-w-sm text-sm opacity-70">${hint}</p>` : nothing}
    ${action ?? nothing}
  </div>
`;

const retryButton = (feed: Feed) => html`
  <button id="feed-retry" class="d-btn d-btn-primary d-btn-sm mt-3" @click=${() => void feed.retry()}>
    Pokušaj ponovo
  </button>
`;

const failureScreen = (feed: Feed, state: FeedState) => {
  switch (state.failure) {
    case 'no_feed':
      return message(
        `Ova grupa nema podgrupu ${FEED_GROUP}`,
        `Napravi podgrupu ${FEED_GROUP}, a svaka njena podgrupa je jedna vest.`,
      );
    case 'preview':
      return message('Pregled', 'Vesti se vide tek na stranici grupe.');
    default:
      return message('Vesti nisu učitane', undefined, retryButton(feed));
  }
};

const storyCard = (feed: Feed, story: PotokSubgroup) => html`
  <article class="feed-card text-base-content" data-story=${story.id}>
    <div class="feed-body">
      ${story.description_html
        ? html`<div class="rich-content mx-auto max-w-2xl px-5 py-6 text-[1.0625rem]">
            ${unsafeHTML(story.description_html)}
          </div>`
        : html`<div class="flex min-h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <h2 class="text-2xl font-semibold">${story.name}</h2>
            ${story.app_description ? html`<p class="max-w-sm opacity-70">${story.app_description}</p>` : nothing}
          </div>`}
    </div>
    <footer class="border-base-300 border-t">
      <div class="mx-auto flex max-w-2xl items-center gap-3 px-5 py-3">
        <img class="size-8 shrink-0 rounded-full object-cover" src=${story.picture_url} alt="" />
        <span class="min-w-0 flex-1 truncate text-sm font-medium">
          ${story.description_html ? story.name : nothing}
        </span>
        ${story.uses_api
          ? html`<button
              class="d-btn d-btn-primary d-btn-sm shrink-0"
              data-open
              @click=${() => void feed.open(story.id, 'description')}
            >
              Otvori
            </button>`
          : nothing}
        <button
          class="d-btn d-btn-sm shrink-0 ${story.uses_api ? 'd-btn-ghost' : 'd-btn-primary'}"
          data-chat
          @click=${() => void feed.open(story.id)}
        >
          ${chatIcon} Chat
        </button>
      </div>
    </footer>
  </article>
`;

const view = (feed: Feed, state: FeedState) => {
  if (!state.started) return message('Učitavam vesti…');
  if (state.stories.length === 0) {
    return state.failure ? failureScreen(feed, state) : message('Još nema vesti');
  }

  return html`
    ${state.stories.map((story) => storyCard(feed, story))}
    ${state.failure ? message('Sledeće vesti nisu učitane', undefined, retryButton(feed)) : nothing}
    ${state.openFailed
      ? html`<div class="d-toast d-toast-center d-toast-top">
          <div class="d-alert d-alert-error">Ova vest trenutno ne može da se otvori.</div>
        </div>`
      : nothing}
  `;
};

type Direction = 1 | -1;

// All cards are as high as the feed, so the position gives the story on screen.
const currentIndex = (root: HTMLElement) => Math.round(root.scrollTop / root.clientHeight);

/** The body of the card on screen, while its text can still scroll that way. */
function scrollableBody(root: HTMLElement, direction: Direction) {
  const card = root.querySelectorAll<HTMLElement>('.feed-card')[currentIndex(root)];
  const body = card?.querySelector<HTMLElement>('.feed-body');
  if (!body) return null;

  const room = direction > 0 ? body.scrollHeight - body.clientHeight - body.scrollTop : body.scrollTop;
  return room > 1 ? body : null;
}

const moveStory = (root: HTMLElement, direction: Direction) =>
  root.scrollBy({ top: direction * root.clientHeight, behavior: 'smooth' });

/** One key press: first through a long text, then to the next story. */
function step(root: HTMLElement, direction: Direction) {
  const body = scrollableBody(root, direction);

  if (body) body.scrollBy({ top: direction * body.clientHeight * 0.8, behavior: 'smooth' });
  else moveStory(root, direction);
}

// How long a wheel has to rest before it can move another story.
const WHEEL_REST_MS = 150;

/**
 * Mandatory snapping sends a wheel notch back where it came from, as it never
 * reaches half a card, so the wheel moves the stories itself. One turn of it
 * is one story, also with the long tail of events from a touchpad.
 */
function followWheel(root: HTMLElement) {
  let moved = false;
  let rest: number | undefined;

  root.addEventListener(
    'wheel',
    (event) => {
      // Ctrl + wheel is the browser's zoom.
      if (event.ctrlKey || event.deltaY === 0) return;

      const direction: Direction = event.deltaY > 0 ? 1 : -1;
      if (!moved && scrollableBody(root, direction)) return;

      event.preventDefault();
      clearTimeout(rest);
      rest = window.setTimeout(() => (moved = false), WHEEL_REST_MS);

      if (!moved) {
        moved = true;
        moveStory(root, direction);
      }
    },
    { passive: false },
  );
}

export function mountFeed(root: HTMLElement) {
  root.classList.add('feed');

  let jumpedTo: number | null = null;

  const feed = createFeed(window.potok, localStorage, (state) => {
    render(view(feed, state), root);

    // Back from a chat: straight to the story, with no animation through the others.
    if (state.startId !== null && jumpedTo !== state.startId) {
      jumpedTo = state.startId;

      const index = state.stories.findIndex((story) => story.id === state.startId);
      root.scrollTop = index * root.clientHeight;
    }
  });

  root.addEventListener('scroll', () => feed.reached(currentIndex(root)), { passive: true });

  followWheel(root);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      step(root, 1);
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      step(root, -1);
    }
  });

  void feed.start().then(() => feed.reached(0));
}
