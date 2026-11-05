import { html, nothing, render, type TemplateResult } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import {
  createFeed,
  describeFilter,
  FEED_GROUP,
  lastDays,
  makeFilter,
  publishedOn,
  today,
  type DateFilter,
  type Feed,
  type FeedState,
  type Notice,
} from './feed';
import type { PotokSubgroup } from './potok';

/** The same six as on a message on the phone; the seventh button opens all of them. */
const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const SHORTCUTS: [label: string, days: number][] = [
  ['Danas', 1],
  ['7 dana', 7],
  ['30 dana', 30],
];

const NOTICES: Record<Notice, string> = {
  open: 'Ova vest trenutno ne može da se otvori.',
  react: 'Reakcija trenutno ne može da se sačuva.',
  share: 'Ova vest trenutno ne može da se podeli.',
};

const chatIcon = html`
  <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z"
    />
  </svg>
`;

const reactIcon = html`
  <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z"
    />
  </svg>
`;

const shareIcon = html`
  <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"
    />
  </svg>
`;

const calendarIcon = html`
  <svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
    />
  </svg>
`;

const closeIcon = html`
  <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
  </svg>
`;

const plusIcon = html`
  <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
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

/** A group nobody else was let into yet, shown to who wrote it. See FeedCreator. */
const isDraft = (story: PotokSubgroup) => !story.is_public && !story.inherits_members;

const commentsLabel = (story: PotokSubgroup) =>
  story.comment_count > 0 ? `Komentari: ${story.comment_count}` : 'Komentari';

/** As on a message: a tap adds the viewer's reaction or takes it back. */
const reactionPills = (feed: Feed, story: PotokSubgroup) =>
  story.reactions.length === 0
    ? nothing
    : html`<div class="mb-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]" data-reactions>
        ${story.reactions.map(
          (reaction) => html`<button
            class="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2 leading-none transition duration-150 enabled:active:scale-95 disabled:cursor-default ${reaction.mine
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-base-300 bg-base-100 text-base-content/70'}"
            aria-pressed=${reaction.mine}
            ?disabled=${!story.can_react}
            data-reaction=${reaction.emoji}
            @click=${() => void feed.react(story.id, reaction.emoji)}
          >
            <span class="text-base leading-none">${reaction.emoji}</span>
            <span class="text-xs font-semibold tabular-nums">${reaction.count}</span>
          </button>`,
        )}
      </div>`;

/** What stays in sight while a period is on: a tap changes it, the cross takes it off. */
const filterChip = (feed: Feed, filter: DateFilter) => html`
  <div class="bg-base-100 border-base-300 flex min-w-0 items-center rounded-full border text-sm shadow-md" data-filter-chip>
    <button class="flex min-w-0 items-center gap-1.5 py-1.5 pr-1 pl-3" aria-haspopup="dialog" @click=${() => feed.openFilter()}>
      ${calendarIcon}<span class="truncate">${describeFilter(filter)}</span>
    </button>
    <button
      class="hover:bg-base-200 mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full"
      aria-label="Prikaži sve vesti"
      data-filter-clear
      @click=${() => void feed.applyFilter(null)}
    >
      ${closeIcon}
    </button>
  </div>
`;

/** A link opened deep in the list, with more above what was loaded around its story. */
const newerChip = (feed: Feed, state: FeedState) => html`
  <button
    class="bg-base-100 border-base-300 shrink-0 rounded-full border px-3 py-1.5 text-sm shadow-md"
    data-newer
    @click=${() => void feed.applyFilter(state.filter)}
  >
    Novije vesti
  </button>
`;

const topChips = (feed: Feed, state: FeedState) => {
  const newer = state.hasNewer && state.index === 0;
  if (!state.filter && !newer) return nothing;

  return html`<div class="fixed top-2 left-1/2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 gap-2">
    ${newer ? newerChip(feed, state) : nothing} ${state.filter ? filterChip(feed, state.filter) : nothing}
  </div>`;
};

const submitFilter = (feed: Feed, event: SubmitEvent) => {
  event.preventDefault();

  const form = new FormData(event.target as HTMLFormElement);
  void feed.applyFilter(makeFilter(form.get('from') as string, form.get('to') as string));
};

const filterSheet = (feed: Feed, filter: DateFilter | null) => html`
  <div
    class="fixed inset-0 z-30 flex items-end justify-center bg-black/30 sm:items-center"
    data-filter-sheet
    @click=${(event: Event) => {
      if (event.target === event.currentTarget) feed.closeFilter();
    }}
  >
    <form
      class="bg-base-100 text-base-content w-full max-w-md rounded-t-2xl p-5 shadow-xl sm:rounded-2xl"
      role="dialog"
      aria-label="Filter po datumu"
      @submit=${(event: SubmitEvent) => submitFilter(feed, event)}
    >
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Vesti po datumu</h2>
        <button
          type="button"
          class="d-btn d-btn-ghost d-btn-sm d-btn-square"
          aria-label="Zatvori"
          data-filter-close
          @click=${() => feed.closeFilter()}
        >
          ${closeIcon}
        </button>
      </div>
      <div class="mt-3 flex gap-2">
        ${SHORTCUTS.map(
          ([label, days]) => html`<button
            type="button"
            class="d-btn d-btn-sm flex-1"
            data-filter-days=${days}
            @click=${() => void feed.applyFilter(lastDays(days))}
          >
            ${label}
          </button>`,
        )}
      </div>
      <div class="mt-4 grid grid-cols-2 gap-3">
        <label class="min-w-0 text-sm">
          Od
          <input class="d-input d-input-sm mt-1 w-full" type="date" name="from" max=${today()} .value=${filter?.from ?? ''} />
        </label>
        <label class="min-w-0 text-sm">
          Do
          <input class="d-input d-input-sm mt-1 w-full" type="date" name="to" max=${today()} .value=${filter?.to ?? ''} />
        </label>
      </div>
      <div class="mt-5 flex justify-end gap-2">
        ${filter
          ? html`<button type="button" class="d-btn d-btn-ghost d-btn-sm" @click=${() => void feed.applyFilter(null)}>
              Prikaži sve
            </button>`
          : nothing}
        <button class="d-btn d-btn-primary d-btn-sm" data-filter-apply>Primeni</button>
      </div>
    </form>
  </div>
`;

const reactionTray = (feed: Feed, story: PotokSubgroup) => html`
  <div
    class="bg-base-100 border-base-300 absolute right-4 bottom-full z-10 mb-2 flex items-center gap-0.5 rounded-full border p-1 shadow-lg"
    role="group"
    aria-label="Dodaj reakciju"
    data-react
    data-reaction-tray
  >
    ${QUICK_EMOJI.map(
      (emoji) => html`<button
        class="hover:bg-base-200 inline-flex size-10 items-center justify-center rounded-full text-xl leading-none transition duration-150 active:scale-90"
        data-quick-reaction=${emoji}
        @click=${() => void feed.react(story.id, emoji)}
      >
        ${emoji}
      </button>`,
    )}
    <button
      class="hover:bg-base-200 text-base-content/65 inline-flex size-10 items-center justify-center rounded-full transition duration-150 active:scale-90"
      aria-label="Svi emodžiji"
      data-more-reactions
      @click=${() => void feed.pickReaction(story.id)}
    >
      ${plusIcon}
    </button>
  </div>
`;

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
      <div class="relative mx-auto max-w-2xl px-5 py-3">
        ${reactionPills(feed, story)}
        <div class="flex items-center gap-1">
          ${isDraft(story)
            ? html`<span class="min-w-0 flex-1"><span class="d-badge d-badge-warning d-badge-sm" data-draft>Nacrt</span></span>`
            : html`<span class="min-w-0 flex-1">
                <button
                  class="d-btn d-btn-ghost d-btn-sm -ml-2 max-w-full flex-nowrap gap-1.5 px-2 font-normal"
                  aria-label="Filter po datumu"
                  aria-haspopup="dialog"
                  data-filter
                  @click=${() => feed.openFilter()}
                >
                  ${calendarIcon}
                  <time
                    class="truncate opacity-70"
                    datetime=${story.published_at ?? story.inserted_at}
                    data-published
                  >
                    ${publishedOn(story)}
                  </time>
                </button>
              </span>`}
          ${story.can_react && !isDraft(story)
            ? html`<button
                class="d-btn d-btn-ghost d-btn-sm d-btn-square shrink-0"
                aria-label="Dodaj reakciju"
                aria-expanded=${feed.state.trayFor === story.id}
                data-react
                @click=${() => feed.toggleTray(story.id)}
              >
                ${reactIcon}
              </button>`
            : nothing}
          ${isDraft(story)
            ? nothing
            : html`<button
                class="d-btn d-btn-ghost d-btn-sm d-btn-square shrink-0"
                aria-label="Podeli"
                data-share
                @click=${() => void feed.share(story.id)}
              >
                ${shareIcon}
              </button>`}
          ${story.uses_api
            ? html`<button
                class="d-btn d-btn-primary d-btn-sm ml-1 shrink-0"
                data-open
                @click=${() => void feed.open(story.id, 'description')}
              >
                Otvori
              </button>`
            : nothing}
          <button
            class="d-btn d-btn-sm ml-1 shrink-0 ${story.uses_api ? 'd-btn-ghost' : 'd-btn-primary'}"
            aria-label=${commentsLabel(story)}
            data-comments
            @click=${() => void feed.open(story.id)}
          >
            ${chatIcon}
            <span class=${story.uses_api ? 'hidden min-[26rem]:inline' : ''}>Komentari</span>
            ${story.comment_count > 0
              ? html`<span class="tabular-nums" data-comment-count>${story.comment_count}</span>`
              : nothing}
          </button>
        </div>
        ${feed.state.trayFor === story.id ? reactionTray(feed, story) : nothing}
      </div>
    </footer>
  </article>
`;

const view = (feed: Feed, state: FeedState) => {
  if (!state.started) return message('Učitavam vesti…');
  if (state.stories.length === 0) {
    if (state.failure) return failureScreen(feed, state);
    if (!state.filter) return message('Još nema vesti');

    return html`
      ${message(
        'Nema vesti u tom periodu',
        describeFilter(state.filter),
        html`<button class="d-btn d-btn-primary d-btn-sm mt-3" data-filter-all @click=${() => void feed.applyFilter(null)}>
          Prikaži sve
        </button>`,
      )}
    `;
  }

  return html`
    ${topChips(feed, state)}
    ${state.filterOpen ? filterSheet(feed, state.filter) : nothing}
    ${state.stories.map((story) => storyCard(feed, story))}
    ${state.failure ? message('Sledeće vesti nisu učitane', undefined, retryButton(feed)) : nothing}
    ${state.notice
      ? html`<div class="d-toast d-toast-center d-toast-top" data-notice>
          <div class="d-alert d-alert-error">${NOTICES[state.notice]}</div>
        </div>`
      : nothing}
  `;
};

type Direction = 1 | -1;

const inFilterSheet = (event: Event) => (event.target as Element).closest?.('[data-filter-sheet]') != null;

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
      if (event.ctrlKey || event.deltaY === 0 || inFilterSheet(event)) return;

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
    root.classList.toggle('feed-with-chips', state.filter !== null || state.hasNewer);

    // Back from a chat: straight to the story, with no animation through the others.
    if (state.startId !== null && jumpedTo !== state.startId) {
      jumpedTo = state.startId;

      const index = state.stories.findIndex((story) => story.id === state.startId);
      root.scrollTop = index * root.clientHeight;
    }
  });

  root.addEventListener('scroll', () => feed.reached(currentIndex(root)), { passive: true });

  root.addEventListener('click', (event) => {
    if (!(event.target as Element).closest('[data-react]')) feed.closeTray();
  });

  followWheel(root);

  window.addEventListener('keydown', (event) => {
    // Arrows change the day in a date field.
    if (inFilterSheet(event)) return;

    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      step(root, 1);
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      step(root, -1);
    }
  });

  void feed.start().then(() => feed.reached(currentIndex(root)));
}
