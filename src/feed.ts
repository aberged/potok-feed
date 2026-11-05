import type { PotokError, PotokGroupTab, PotokSdk, PotokSubgroup } from './potok';

/** The sub-group of the app's group whose sub-groups are the stories. */
export const FEED_GROUP = '.feed';

export const PAGE_SIZE = 20;

/** The next page loads when this many stories are left below the current one. */
export const LOAD_AHEAD = 5;

/** How long the message about something that failed stays on screen. */
export const NOTICE_MS = 4_000;

/** The story the viewer left, for its chat or its app. Feed ends with the page and starts again on the way back. */
export const RETURN_KEY = 'feed:return';

/** The period that was on, so that the way back from a chat finds the same list. */
export const RETURN_FILTER_KEY = 'feed:return-filter';

const PUBLICATION_DATE = new Intl.DateTimeFormat('sr-Latn', { day: 'numeric', month: 'short', year: 'numeric' });

export type Failure = 'no_feed' | 'preview' | 'failed';

/** A period of publication, in the viewer's days as `yyyy-mm-dd`. An empty end is open. */
export type DateFilter = { from: string | null; to: string | null };

/** What the viewer tried and could not do. */
export type Notice = 'open' | 'react' | 'share';

export type FeedState = {
  stories: PotokSubgroup[];
  hasMore: boolean;
  /** Stories newer than the first one here exist: the feed opened deep in the list. */
  hasNewer: boolean;
  /** The story on screen, by its place in `stories`. */
  index: number;
  /** A page is on its way. */
  loading: boolean;
  /** Set once the first load is over, also when it failed. */
  started: boolean;
  failure: Failure | null;
  /** The story to open on: the one the viewer came back to or a link led to, or null for the newest. */
  startId: number | null;
  notice: Notice | null;
  /** The story whose row of emoji is open. */
  trayFor: number | null;
  /** The period on, or null for all stories. */
  filter: DateFilter | null;
  filterOpen: boolean;
};

type FeedApi = Pick<
  PotokSdk,
  'listSubgroups' | 'openGroup' | 'toggleGroupReaction' | 'pickEmoji' | 'shareGroup' | 'linkGroup' | 'getLinkedGroup'
>;
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

const dayStart = (day: string, plusDays = 0) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date + plusDays);
};

/** A local day as a date input writes it, which `toISOString` would move to UTC. */
const dayOf = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

/** What the two fields of the form give: nothing, one end, or both in any order. */
export function makeFilter(from: string | null, to: string | null): DateFilter | null {
  if (!from && !to) return null;
  if (from && to && from > to) return { from: to, to: from };

  return { from: from || null, to: to || null };
}

/** The last `count` days, today among them. */
export function lastDays(count: number, now = new Date()): DateFilter {
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - count + 1);
  return { from: dayOf(first), to: dayOf(now) };
}

export const today = (now = new Date()) => dayOf(now);

/**
 * The moments the server compares with: the start of the first day and the start
 * of the day after the last, as only Feed knows where its viewer's days begin.
 */
export function filterMoments(filter: DateFilter | null) {
  return {
    from: filter?.from ? dayStart(filter.from).toISOString() : undefined,
    to: filter?.to ? dayStart(filter.to, 1).toISOString() : undefined,
  };
}

export function describeFilter({ from, to }: DateFilter) {
  const day = (value: string) => PUBLICATION_DATE.format(dayStart(value));

  if (from && to) return from === to ? day(from) : `${day(from)} – ${day(to)}`;
  return from ? `od ${day(from)}` : `do ${day(to as string)}`;
}

function savedFilter(storage: FeedStorage): DateFilter | null {
  try {
    const { from, to } = JSON.parse(storage.getItem(RETURN_FILTER_KEY) ?? '{}');
    return makeFilter(from ?? null, to ?? null);
  } catch {
    return null;
  }
}

export function createFeed(api: FeedApi, storage: FeedStorage, onChange: (state: FeedState) => void) {
  let state: FeedState = {
    stories: [],
    hasMore: false,
    hasNewer: false,
    index: 0,
    loading: false,
    started: false,
    failure: null,
    startId: null,
    notice: null,
    trayFor: null,
    filter: null,
    filterOpen: false,
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

  // Counts the changes of the period, as a page on its way belongs to the old one.
  let period = 0;

  const fetchPage = async (aroundId?: number): Promise<boolean> => {
    const asked = period;
    const last = state.stories.at(-1);

    // Calls reject when the page does not answer in time.
    const reply: ListReply | null = await api
      .listSubgroups(FEED_GROUP, { limit: PAGE_SIZE, beforeId: last?.id, aroundId, ...filterMoments(state.filter) })
      .catch(() => null);

    if (asked !== period) return false;

    if (!reply?.ok) {
      update({ failure: failureOf(reply) });
      return false;
    }

    update({
      stories: [...state.stories, ...reply.groups],
      hasMore: reply.has_more,
      hasNewer: state.hasNewer || reply.has_newer,
    });
    return true;
  };

  const hasStory = (id: number) => state.stories.some((story) => story.id === id);

  const forgetReturn = () => {
    storage.removeItem(RETURN_KEY);
    storage.removeItem(RETURN_FILTER_KEY);
  };

  const start = async () => {
    const returnId = Number(storage.getItem(RETURN_KEY)) || null;
    update({ loading: true, failure: null, filter: savedFilter(storage) ?? state.filter });

    const linked = await api.getLinkedGroup().catch(() => null);
    const targetId = returnId ?? (linked?.ok ? linked.group_id : null);
    const loaded = await fetchPage(targetId ?? undefined);

    // A failed load keeps the key, so that trying again still finds the story.
    if (loaded) forgetReturn();

    const startId = targetId !== null && hasStory(targetId) ? targetId : null;
    update({ loading: false, started: true, startId });
  };

  const loadMore = async () => {
    if (state.loading || !state.hasMore || state.failure) return;

    const asked = period;

    update({ loading: true });
    await fetchPage();
    if (asked === period) update({ loading: false });
  };

  const applyFilter = async (filter: DateFilter | null) => {
    period += 1;
    const asked = period;

    update({
      filter,
      filterOpen: false,
      stories: [],
      hasMore: false,
      hasNewer: false,
      index: 0,
      failure: null,
      loading: true,
      started: false,
      startId: null,
      trayFor: null,
    });

    await fetchPage();
    if (asked === period) update({ loading: false, started: true });
  };

  // The story the address of the page holds.
  let linkedId: number | null = null;

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

    /** Tells which story is on screen: the address follows it, and more load near the end. */
    reached(index: number) {
      const story = state.stories[index];

      if (index !== state.index) update({ index });
      if (state.trayFor !== null && story?.id !== state.trayFor) update({ trayFor: null });

      if (story && story.id !== linkedId) {
        linkedId = story.id;
        void api.linkGroup(story.id).catch(() => null);
      }

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
      if (state.filter) storage.setItem(RETURN_FILTER_KEY, JSON.stringify(state.filter));

      const reply = await api.openGroup(id, { tab }).catch(() => null);

      if (!reply?.ok) {
        forgetReturn();
        notify('open');
      }
    },

    applyFilter,

    openFilter() {
      update({ filterOpen: true, trayFor: null });
    },

    closeFilter() {
      update({ filterOpen: false });
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
      const reply = await api.shareGroup(id, { inApp: true }).catch(() => null);

      if (!reply?.ok) notify('share');
    },
  };
}

export type Feed = ReturnType<typeof createFeed>;
