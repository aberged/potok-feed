import type { PotokError, PotokGroupTab, PotokSdk, PotokSubgroup } from './potok';

/** The sub-group of the app's group whose sub-groups are the stories. */
export const FEED_GROUP = '.feed';

export const PAGE_SIZE = 20;

/** The next page loads when this many stories are left below the current one. */
export const LOAD_AHEAD = 5;

/** How far back a return from a chat looks for its story. */
export const MAX_RETURN_PAGES = 5;

/** How long the message about a story that would not open stays on screen. */
export const OPEN_FAILED_MS = 4_000;

/** The story the viewer left, for its chat or its app. Feed ends with the page and starts again on the way back. */
export const RETURN_KEY = 'feed:return';

export type Failure = 'no_feed' | 'preview' | 'failed';

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
  /** The story's chat or app could not be opened. */
  openFailed: boolean;
};

type FeedApi = Pick<PotokSdk, 'listSubgroups' | 'openGroup'>;
type FeedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type ListReply = Awaited<ReturnType<FeedApi['listSubgroups']>>;

function failureOf(reply: PotokError | null): Failure {
  if (reply?.error === 'not_found') return 'no_feed';
  if (reply?.error === 'preview') return 'preview';
  return 'failed';
}

export function createFeed(api: FeedApi, storage: FeedStorage, onChange: (state: FeedState) => void) {
  let state: FeedState = {
    stories: [],
    hasMore: false,
    loading: false,
    started: false,
    failure: null,
    startId: null,
    openFailed: false,
  };

  const update = (patch: Partial<FeedState>) => {
    state = { ...state, ...patch };
    onChange(state);
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

  return {
    get state() {
      return state;
    },

    start,

    /** Tells which story is on screen; loads ahead when it nears the end of the list. */
    reached(index: number) {
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
      update({ openFailed: false });
      storage.setItem(RETURN_KEY, String(id));

      const reply = await api.openGroup(id, { tab }).catch(() => null);

      if (!reply?.ok) {
        storage.removeItem(RETURN_KEY);
        update({ openFailed: true });
        setTimeout(() => update({ openFailed: false }), OPEN_FAILED_MS);
      }
    },
  };
}

export type Feed = ReturnType<typeof createFeed>;
