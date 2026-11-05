import type { PotokError, PotokGroupTab, PotokSdk, PotokSubgroup } from './potok';

/** The sub-group of the app's group whose sub-groups are the stories. */
export const FEED_GROUP = '.feed';

export const PAGE_SIZE = 20;

/** The next page loads when this many stories are left below the current one. */
export const LOAD_AHEAD = 5;

/** How far back a return from a chat looks for its story. */
export const MAX_RETURN_PAGES = 5;

/** How long the message about something that failed stays on screen. */
export const NOTICE_MS = 4_000;

/** The story the viewer left, for its chat or its app. Feed ends with the page and starts again on the way back. */
export const RETURN_KEY = 'feed:return';

const PUBLICATION_DATE = new Intl.DateTimeFormat('sr-Latn', { day: 'numeric', month: 'short', year: 'numeric' });

export type Failure = 'no_feed' | 'preview' | 'failed';

/** What the viewer tried and could not do. */
export type Notice = 'open' | 'react' | 'share';

export type FeedState = {
  stories: PotokSubgroup[];
  hasMore: boolean;
  /** A page is on its way. */
  loading: boolean;
  /** Set once the first load is over, also when it failed. */
  started: boolean;
  failure: Failure | null;
  /** The story to open on: the one the viewer came back to, or null for the newest. */
  startId: number | null;
  notice: Notice | null;
  /** The story whose row of emoji is open. */
  trayFor: number | null;
};

type FeedApi = Pick<PotokSdk, 'listSubgroups' | 'openGroup' | 'toggleGroupReaction' | 'pickEmoji' | 'shareGroup'>;
type FeedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type ListReply = Awaited<ReturnType<FeedApi['listSubgroups']>>;

function failureOf(reply: PotokError | null): Failure {
  if (reply?.error === 'not_found') return 'no_feed';
  if (reply?.error === 'preview') return 'preview';
  return 'failed';
}

/** When the story came out: a closed group counts from when it opened up. */
export const publishedOn = (story: Pick<PotokSubgroup, 'published_at' | 'inserted_at'>) =>
  PUBLICATION_DATE.format(new Date(story.published_at ?? story.inserted_at));

export function createFeed(api: FeedApi, storage: FeedStorage, onChange: (state: FeedState) => void) {
  let state: FeedState = {
    stories: [],
    hasMore: false,
    loading: false,
    started: false,
    failure: null,
    startId: null,
    notice: null,
    trayFor: null,
  };

  const update = (patch: Partial<FeedState>) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const notify = (notice: Notice) => {
    update({ notice });

    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => update({ notice: null }), NOTICE_MS);
  };

  const fetchPage = async (): Promise<boolean> => {
    const last = state.stories.at(-1);

    // Calls reject when the page does not answer in time.
    const reply: ListReply | null = await api
      .listSubgroups(FEED_GROUP, { limit: PAGE_SIZE, beforeId: last?.id })
      .catch(() => null);

    if (!reply?.ok) {
      update({ failure: failureOf(reply) });
      return false;
    }

    update({ stories: [...state.stories, ...reply.groups], hasMore: reply.has_more });
    return true;
  };

  const hasStory = (id: number) => state.stories.some((story) => story.id === id);

  const start = async () => {
    const returnId = Number(storage.getItem(RETURN_KEY)) || null;
    update({ loading: true, failure: null });

    let pages = 0;
    let loaded = false;

    do {
      loaded = await fetchPage();
      pages += 1;
    } while (loaded && returnId !== null && !hasStory(returnId) && state.hasMore && pages < MAX_RETURN_PAGES);

    // A failed load keeps the key, so that trying again still finds the story.
    if (loaded) storage.removeItem(RETURN_KEY);

    const startId = returnId !== null && hasStory(returnId) ? returnId : null;
    update({ loading: false, started: true, startId });
  };

  const loadMore = async () => {
    if (state.loading || !state.hasMore || state.failure) return;

    update({ loading: true });
    await fetchPage();
    update({ loading: false });
  };

  // A reaction is a switch on the server, so a second tap while the first is on
  // its way would take it back.
  const reacting = new Set<number>();

  const react = async (id: number, emoji: string) => {
    if (reacting.has(id)) return;

    reacting.add(id);
    update({ trayFor: null });

    const reply = await api.toggleGroupReaction(id, emoji).catch(() => null);
    reacting.delete(id);

    if (reply?.ok) {
      const { reactions } = reply;
      update({ stories: state.stories.map((story) => (story.id === id ? { ...story, reactions } : story)) });
    } else {
      notify('react');
    }
  };

  return {
    get state() {
      return state;
    },

    start,

    /** Tells which story is on screen; loads ahead when it nears the end of the list. */
    reached(index: number) {
      if (state.trayFor !== null && state.stories[index]?.id !== state.trayFor) update({ trayFor: null });
      if (index >= state.stories.length - 1 - LOAD_AHEAD) void loadMore();
    },

    /** After a failure: the first load again, or the page that failed. */
    retry() {
      if (state.stories.length === 0) return start();

      update({ failure: null });
      return loadMore();
    },

    /** Leaves for the story's chat or, for a story that is an app, its description. */
    async open(id: number, tab: PotokGroupTab = 'chat') {
      update({ notice: null });
      storage.setItem(RETURN_KEY, String(id));

      const reply = await api.openGroup(id, { tab }).catch(() => null);

      if (!reply?.ok) {
        storage.removeItem(RETURN_KEY);
        notify('open');
      }
    },

    /** Opens the row of emoji under a story, or closes the one that is open. */
    toggleTray(id: number) {
      update({ trayFor: state.trayFor === id ? null : id });
    },

    closeTray() {
      if (state.trayFor !== null) update({ trayFor: null });
    },

    react,

    /** The whole set of emoji, from Potok's own picker. Closing it is no failure. */
    async pickReaction(id: number) {
      update({ trayFor: null });

      const reply = await api.pickEmoji().catch(() => null);

      if (reply?.ok) await react(id, reply.emoji);
      else if (reply?.error !== 'cancelled') notify('react');
    },

    async share(id: number) {
      const reply = await api.shareGroup(id).catch(() => null);

      if (!reply?.ok) notify('share');
    },
  };
}

export type Feed = ReturnType<typeof createFeed>;
