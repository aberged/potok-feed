import { describe, expect, it, vi } from 'vitest';
import {
  createFeed,
  describeFilter,
  FEED_GROUP,
  filterMoments,
  lastDays,
  LOAD_AHEAD,
  makeFilter,
  NOTICE_MS,
  PAGE_SIZE,
  publishedOn,
  RETURN_FILTER_KEY,
  RETURN_KEY,
  today,
  type FeedState,
} from './feed';
import type { PotokError, PotokProfile, PotokSdk, PotokSubgroup, PotokSubgroupListOptions } from './potok';

const story = (id: number): PotokSubgroup => ({
  id,
  name: `Vest ${id}`,
  description_html: `<p>${id}</p>`,
  app_description: null,
  uses_api: false,
  picture_url: `/avatar/group/${id}`,
  is_public: true,
  inherits_members: true,
  creator_id: 1,
  inserted_at: '2026-11-05T08:00:00Z',
  published_at: null,
  last_value_at: null,
  comment_count: 0,
  reactions: [],
  can_react: true,
});

/** A server with stories `count` down to 1, paged like `listSubgroups`. */
function server(count: number) {
  const stories = Array.from({ length: count }, (_, index) => story(count - index));

  return vi.fn(async (_name: string, options: PotokSubgroupListOptions = {}) => {
    const limit = options.limit ?? PAGE_SIZE;
    const index = stories.findIndex((row) => row.id === options.aroundId);

    if (index >= 0) {
      const first = Math.max(0, index - limit);
      const end = index + limit + 1;

      return {
        ok: true as const,
        groups: stories.slice(first, end),
        has_more: stories.length > end,
        has_newer: first > 0,
      };
    }

    const rows = stories.filter((row) => options.beforeId === undefined || row.id < options.beforeId);

    return { ok: true as const, groups: rows.slice(0, limit), has_more: rows.length > limit, has_newer: false };
  });
}

const failing = (error: PotokError['error']) => async () => ({ ok: false as const, error });

function memoryStorage(items: Record<string, string> = {}) {
  const map = new Map(Object.entries(items));

  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const reacted = [{ emoji: '👍', count: 3, mine: true }];

const profile = { id: 1, username: 'ana' } as PotokProfile;

function setup({
  listSubgroups = server(50),
  openGroup = vi.fn(async () => ({ ok: true as const })),
  toggleGroupReaction = vi.fn(async () => ({ ok: true as const, reactions: reacted })),
  pickEmoji = vi.fn(async () => ({ ok: true as const, emoji: '🎉' })),
  shareGroup = vi.fn(async () => ({ ok: true as const })),
  linkGroup = vi.fn(async () => ({ ok: true as const })),
  getLinkedGroup = vi.fn(async () => ({ ok: true as const, group_id: null as number | null })),
  getCurrentProfile = vi.fn(async () => profile as PotokProfile | null),
  openLogin = vi.fn(async () => ({ ok: true as const })),
  storage = memoryStorage(),
}: {
  listSubgroups?: PotokSdk['listSubgroups'];
  openGroup?: PotokSdk['openGroup'];
  toggleGroupReaction?: PotokSdk['toggleGroupReaction'];
  pickEmoji?: PotokSdk['pickEmoji'];
  shareGroup?: PotokSdk['shareGroup'];
  linkGroup?: PotokSdk['linkGroup'];
  getLinkedGroup?: PotokSdk['getLinkedGroup'];
  getCurrentProfile?: PotokSdk['getCurrentProfile'];
  openLogin?: PotokSdk['openLogin'];
  storage?: ReturnType<typeof memoryStorage>;
} = {}) {
  const changes: FeedState[] = [];
  const feed = createFeed(
    {
      listSubgroups,
      openGroup,
      toggleGroupReaction,
      pickEmoji,
      shareGroup,
      linkGroup,
      getLinkedGroup,
      getCurrentProfile,
      openLogin,
    },
    storage,
    (state) => changes.push(state),
  );

  return {
    feed,
    listSubgroups,
    openGroup,
    toggleGroupReaction,
    pickEmoji,
    shareGroup,
    linkGroup,
    getLinkedGroup,
    getCurrentProfile,
    openLogin,
    storage,
    changes,
  };
}

describe('the first load', () => {
  it('asks for the first page of the feed group', async () => {
    const { feed, listSubgroups } = setup();

    await feed.start();

    expect(listSubgroups).toHaveBeenCalledTimes(1);
    expect(listSubgroups).toHaveBeenCalledWith(FEED_GROUP, { limit: PAGE_SIZE, beforeId: undefined });
    expect(feed.state.stories.map((row) => row.id).slice(0, 2)).toEqual([50, 49]);
    expect(feed.state).toMatchObject({ hasMore: true, started: true, loading: false, failure: null, startId: null });
  });

  it('reports a group without the feed sub-group', async () => {
    const { feed } = setup({ listSubgroups: failing('not_found') });

    await feed.start();

    expect(feed.state).toMatchObject({ started: true, failure: 'no_feed' });
  });

  it('reports the preview of the edit form', async () => {
    const { feed } = setup({ listSubgroups: failing('preview') });

    await feed.start();

    expect(feed.state.failure).toBe('preview');
  });

  it('treats a call with no answer as a failure and can try again', async () => {
    const working = server(3);
    const listSubgroups = vi.fn().mockRejectedValueOnce(new Error('timed out')).mockImplementation(working);
    const { feed } = setup({ listSubgroups });

    await feed.start();
    expect(feed.state.failure).toBe('failed');

    await feed.retry();
    expect(feed.state).toMatchObject({ failure: null, started: true });
    expect(feed.state.stories).toHaveLength(3);
  });
});

describe('loading ahead', () => {
  it('waits until few stories are left, then asks after the last one', async () => {
    const { feed, listSubgroups } = setup();
    await feed.start();

    feed.reached(PAGE_SIZE - 2 - LOAD_AHEAD);
    expect(listSubgroups).toHaveBeenCalledTimes(1);

    feed.reached(PAGE_SIZE - 1 - LOAD_AHEAD);
    await vi.waitFor(() => expect(feed.state.stories).toHaveLength(PAGE_SIZE * 2));

    expect(listSubgroups).toHaveBeenLastCalledWith(FEED_GROUP, { limit: PAGE_SIZE, beforeId: 31 });
  });

  it('asks once however often the position changes', async () => {
    const { feed, listSubgroups } = setup();
    await feed.start();

    feed.reached(18);
    feed.reached(19);
    await vi.waitFor(() => expect(feed.state.loading).toBe(false));

    expect(listSubgroups).toHaveBeenCalledTimes(2);
  });

  it('stops at the end of the list', async () => {
    const { feed, listSubgroups } = setup({ listSubgroups: server(3) });
    await feed.start();

    feed.reached(2);

    expect(listSubgroups).toHaveBeenCalledTimes(1);
  });

  it('keeps the stories after a failed page and retries only when asked', async () => {
    const working = server(30);
    const listSubgroups = vi
      .fn()
      .mockImplementationOnce(working)
      .mockResolvedValueOnce({ ok: false, error: 'disconnected' })
      .mockImplementation(working);
    const { feed } = setup({ listSubgroups });
    await feed.start();

    feed.reached(19);
    await vi.waitFor(() => expect(feed.state.failure).toBe('failed'));
    expect(feed.state.stories).toHaveLength(PAGE_SIZE);

    feed.reached(19);
    expect(listSubgroups).toHaveBeenCalledTimes(2);

    await feed.retry();
    expect(feed.state.failure).toBeNull();
    expect(feed.state.stories).toHaveLength(30);
  });
});

describe('leaving a story and coming back', () => {
  it('remembers the story, then asks for its chat', async () => {
    const { feed, openGroup, storage } = setup();

    await feed.open(7);

    expect(openGroup).toHaveBeenCalledWith(7, { tab: 'chat' });
    expect(storage.getItem(RETURN_KEY)).toBe('7');
    expect(feed.state.notice).toBeNull();
  });

  it('opens a story that is an app on its description', async () => {
    const { feed, openGroup, storage } = setup();

    await feed.open(7, 'description');

    expect(openGroup).toHaveBeenCalledWith(7, { tab: 'description' });
    expect(storage.getItem(RETURN_KEY)).toBe('7');
  });

  it('forgets the story when it cannot be opened, and says so for a while', async () => {
    vi.useFakeTimers();

    try {
      const { feed, storage } = setup({ openGroup: failing('not_found') });

      await feed.open(7);

      expect(storage.getItem(RETURN_KEY)).toBeNull();
      expect(feed.state.notice).toBe('open');

      vi.advanceTimersByTime(NOTICE_MS);
      expect(feed.state.notice).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens on the story of the first page, once', async () => {
    const { feed, storage, listSubgroups } = setup({ storage: memoryStorage({ [RETURN_KEY]: '45' }) });

    await feed.start();

    expect(feed.state.startId).toBe(45);
    expect(storage.getItem(RETURN_KEY)).toBeNull();
    expect(listSubgroups).toHaveBeenCalledTimes(1);
  });

  it('asks around the story, however far down it lies', async () => {
    const { feed, listSubgroups, storage } = setup({ storage: memoryStorage({ [RETURN_KEY]: '12' }) });

    await feed.start();

    expect(listSubgroups).toHaveBeenCalledTimes(1);
    expect(listSubgroups).toHaveBeenCalledWith(FEED_GROUP, expect.objectContaining({ aroundId: 12 }));
    expect(feed.state.startId).toBe(12);
    expect(storage.getItem(RETURN_KEY)).toBeNull();
  });

  it('opens on the newest when the story is gone', async () => {
    const { feed } = setup({ listSubgroups: server(5), storage: memoryStorage({ [RETURN_KEY]: '9' }) });

    await feed.start();

    expect(feed.state.startId).toBeNull();
  });

  it('keeps the story for a retry after a failed load', async () => {
    const { feed, storage } = setup({
      listSubgroups: failing('disconnected'),
      storage: memoryStorage({ [RETURN_KEY]: '9' }),
    });

    await feed.start();

    expect(storage.getItem(RETURN_KEY)).toBe('9');
  });
});

describe('the date of a story', () => {
  it('is when it was made', () => {
    expect(publishedOn({ inserted_at: '2026-11-05T12:00:00Z', published_at: null })).toBe('5. nov 2026.');
  });

  it('is when it opened up, for a story that stayed closed for a while', () => {
    expect(publishedOn({ inserted_at: '2026-11-05T12:00:00Z', published_at: '2026-12-24T12:00:00Z' })).toBe(
      '24. dec 2026.',
    );
  });
});

describe('reacting to a story', () => {
  it('shows what the server answers, on that story alone', async () => {
    const { feed, toggleGroupReaction } = setup();
    await feed.start();

    await feed.react(50, '👍');

    expect(toggleGroupReaction).toHaveBeenCalledWith(50, '👍');
    expect(feed.state.stories[0].reactions).toEqual(reacted);
    expect(feed.state.stories[1].reactions).toEqual([]);
  });

  it('does not take a reaction back with a second tap while the first is on its way', async () => {
    const { feed, toggleGroupReaction } = setup();
    await feed.start();

    await Promise.all([feed.react(50, '👍'), feed.react(50, '👍')]);

    expect(toggleGroupReaction).toHaveBeenCalledTimes(1);
  });

  it('can react to two stories at once, and again afterwards', async () => {
    const { feed, toggleGroupReaction } = setup();
    await feed.start();

    await Promise.all([feed.react(50, '👍'), feed.react(49, '👍')]);
    await feed.react(50, '❤️');

    expect(toggleGroupReaction).toHaveBeenCalledTimes(3);
  });

  it('says so when it fails, and keeps the reactions', async () => {
    vi.useFakeTimers();

    try {
      const { feed } = setup({ toggleGroupReaction: failing('forbidden') });
      await feed.start();

      await feed.react(50, '👍');

      expect(feed.state.notice).toBe('react');
      expect(feed.state.stories[0].reactions).toEqual([]);

      vi.advanceTimersByTime(NOTICE_MS);
      expect(feed.state.notice).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a call with no answer as a failure', async () => {
    const { feed } = setup({ toggleGroupReaction: () => Promise.reject(new Error('timed out')) });
    await feed.start();

    await feed.react(50, '👍');

    expect(feed.state.notice).toBe('react');
  });

  it('reacts with what was chosen in the picker', async () => {
    const { feed, toggleGroupReaction } = setup();
    await feed.start();

    await feed.pickReaction(50);

    expect(toggleGroupReaction).toHaveBeenCalledWith(50, '🎉');
  });

  it('takes a closed picker for no answer, not for a failure', async () => {
    const { feed, toggleGroupReaction } = setup({ pickEmoji: failing('cancelled') });
    await feed.start();

    await feed.pickReaction(50);

    expect(toggleGroupReaction).not.toHaveBeenCalled();
    expect(feed.state.notice).toBeNull();
  });

  it('says so when the picker cannot open', async () => {
    const { feed } = setup({ pickEmoji: failing('forbidden') });
    await feed.start();

    await feed.pickReaction(50);

    expect(feed.state.notice).toBe('react');
  });
});

describe('the row of emoji', () => {
  it('opens and closes on its button, and only one is open', async () => {
    const { feed } = setup();
    await feed.start();

    feed.toggleTray(50);
    expect(feed.state.trayFor).toBe(50);

    feed.toggleTray(49);
    expect(feed.state.trayFor).toBe(49);

    feed.toggleTray(49);
    expect(feed.state.trayFor).toBeNull();
  });

  it('closes when a reaction is chosen and when the picker takes over', async () => {
    const { feed } = setup();
    await feed.start();

    feed.toggleTray(50);
    await feed.react(50, '👍');
    expect(feed.state.trayFor).toBeNull();

    feed.toggleTray(50);
    await feed.pickReaction(50);
    expect(feed.state.trayFor).toBeNull();
  });

  it('stays with its story and closes when another comes on screen', async () => {
    const { feed } = setup();
    await feed.start();

    feed.toggleTray(50);
    feed.reached(0);
    expect(feed.state.trayFor).toBe(50);

    feed.reached(1);
    expect(feed.state.trayFor).toBeNull();
  });
});

describe('sharing a story', () => {
  it('asks the page to do it', async () => {
    const { feed, shareGroup } = setup();
    await feed.start();

    await feed.share(50);

    expect(shareGroup).toHaveBeenCalledWith(50, { inApp: true });
    expect(feed.state.notice).toBeNull();
  });

  it('says so when it cannot', async () => {
    const { feed } = setup({ shareGroup: failing('not_found') });
    await feed.start();

    await feed.share(50);

    expect(feed.state.notice).toBe('share');
  });
});

describe('a period of publication', () => {
  const noon = new Date(2026, 10, 5, 12);

  it('takes what the form gives', () => {
    expect(makeFilter('', '')).toBeNull();
    expect(makeFilter('2026-11-01', '')).toEqual({ from: '2026-11-01', to: null });
    expect(makeFilter('', '2026-11-05')).toEqual({ from: null, to: '2026-11-05' });
  });

  it('turns around dates given the wrong way', () => {
    expect(makeFilter('2026-11-05', '2026-11-01')).toEqual({ from: '2026-11-01', to: '2026-11-05' });
  });

  it('counts today among the last days', () => {
    expect(lastDays(1, noon)).toEqual({ from: '2026-11-05', to: '2026-11-05' });
    expect(lastDays(7, noon)).toEqual({ from: '2026-10-30', to: '2026-11-05' });
  });

  it('knows today in the viewer\'s days, late in the evening too', () => {
    expect(today(new Date(2026, 10, 5, 23, 59))).toBe('2026-11-05');
  });

  it('runs from the start of the first day to the start of the day after the last', () => {
    expect(filterMoments({ from: '2026-11-01', to: '2026-11-05' })).toEqual({
      from: new Date(2026, 10, 1).toISOString(),
      to: new Date(2026, 10, 6).toISOString(),
    });
  });

  it('crosses the end of a month', () => {
    expect(filterMoments({ from: null, to: '2026-10-31' }).to).toBe(new Date(2026, 10, 1).toISOString());
  });

  it('leaves an open end out, and asks for nothing without a period', () => {
    expect(filterMoments({ from: '2026-11-01', to: null }).to).toBeUndefined();
    expect(filterMoments(null)).toEqual({ from: undefined, to: undefined });
  });

  it('reads well', () => {
    expect(describeFilter({ from: '2026-11-05', to: '2026-11-05' })).toBe('5. nov 2026.');
    expect(describeFilter({ from: '2026-11-01', to: '2026-11-05' })).toBe('1. nov 2026. – 5. nov 2026.');
    expect(describeFilter({ from: '2026-11-01', to: null })).toBe('od 1. nov 2026.');
    expect(describeFilter({ from: null, to: '2026-11-05' })).toBe('do 5. nov 2026.');
  });
});

describe('filtering by date', () => {
  const period = { from: '2026-11-01', to: '2026-11-05' };

  it('starts over with the period, on the first page', async () => {
    const { feed, listSubgroups } = setup();
    await feed.start();

    await feed.applyFilter(period);

    expect(listSubgroups).toHaveBeenLastCalledWith(FEED_GROUP, {
      limit: PAGE_SIZE,
      beforeId: undefined,
      ...filterMoments(period),
    });
    expect(feed.state.filter).toEqual(period);
    expect(feed.state.stories).toHaveLength(PAGE_SIZE);
    expect(feed.state.started).toBe(true);
    expect(feed.state.loading).toBe(false);
  });

  it('sends the period with the next pages too', async () => {
    const { feed, listSubgroups } = setup();
    await feed.start();
    await feed.applyFilter(period);

    feed.reached(PAGE_SIZE - 1);
    await vi.waitFor(() => expect(feed.state.stories).toHaveLength(PAGE_SIZE * 2));

    expect(listSubgroups).toHaveBeenLastCalledWith(FEED_GROUP, {
      limit: PAGE_SIZE,
      beforeId: 31,
      ...filterMoments(period),
    });
  });

  it('goes back to all stories', async () => {
    const { feed, listSubgroups } = setup();
    await feed.start();
    await feed.applyFilter(period);

    await feed.applyFilter(null);

    expect(feed.state.filter).toBeNull();
    expect(listSubgroups).toHaveBeenLastCalledWith(FEED_GROUP, {
      limit: PAGE_SIZE,
      beforeId: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it('drops a page of the old period that arrives late', async () => {
    let answerOld: (reply: { ok: true; groups: PotokSubgroup[]; has_more: boolean }) => void = () => {};

    const listSubgroups = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)))
      .mockResolvedValue({ ok: true, groups: [story(3)], has_more: false });

    const { feed } = setup({ listSubgroups });

    void feed.start();
    await vi.waitFor(() => expect(listSubgroups).toHaveBeenCalledTimes(1));

    await feed.applyFilter(period);
    answerOld({ ok: true, groups: [story(50), story(49)], has_more: true });
    await new Promise((resolve) => setTimeout(resolve));

    expect(feed.state.stories.map((row) => row.id)).toEqual([3]);
    expect(feed.state.hasMore).toBe(false);
  });

  it('keeps the period through a chat, and only then', async () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    await first.feed.start();
    await first.feed.applyFilter(period);

    await first.feed.open(40);
    expect(JSON.parse(storage.getItem(RETURN_FILTER_KEY) as string)).toEqual(period);

    const back = setup({ storage });
    await back.feed.start();

    expect(back.feed.state.filter).toEqual(period);
    expect(back.listSubgroups).toHaveBeenCalledWith(FEED_GROUP, expect.objectContaining(filterMoments(period)));
    expect(storage.getItem(RETURN_FILTER_KEY)).toBeNull();

    const fresh = setup({ storage });
    await fresh.feed.start();
    expect(fresh.feed.state.filter).toBeNull();
  });

  it('forgets the period when the story could not be opened', async () => {
    const storage = memoryStorage();
    const { feed } = setup({ storage, openGroup: failing('not_found') });
    await feed.start();
    await feed.applyFilter(period);

    await feed.open(40);

    expect(storage.getItem(RETURN_FILTER_KEY)).toBeNull();
    expect(feed.state.filter).toEqual(period);
  });

  it('survives something unreadable in the storage', async () => {
    const { feed } = setup({ storage: memoryStorage({ [RETURN_FILTER_KEY]: 'not json' }) });

    await feed.start();

    expect(feed.state.filter).toBeNull();
    expect(feed.state.stories).toHaveLength(PAGE_SIZE);
  });

  it('keeps the period when trying again after a failure', async () => {
    const listSubgroups = vi.fn(server(50));
    const { feed } = setup({ listSubgroups });
    await feed.start();

    listSubgroups.mockImplementationOnce(failing('disconnected'));
    await feed.applyFilter(period);
    expect(feed.state.failure).toBe('failed');

    await feed.retry();

    expect(feed.state.filter).toEqual(period);
    expect(feed.state.failure).toBeNull();
    expect(listSubgroups).toHaveBeenLastCalledWith(FEED_GROUP, expect.objectContaining(filterMoments(period)));
  });

  it('closes the form when a period is chosen', async () => {
    const { feed } = setup();
    await feed.start();

    feed.openFilter();
    expect(feed.state.filterOpen).toBe(true);

    await feed.applyFilter(period);
    expect(feed.state.filterOpen).toBe(false);
  });
});

describe('a link to a story', () => {
  const linkedTo = (id: number) => vi.fn(async () => ({ ok: true as const, group_id: id }));

  it('opens the feed on that story, with its neighbours around it', async () => {
    const { feed } = setup({ getLinkedGroup: linkedTo(30) });

    await feed.start();

    expect(feed.state.startId).toBe(30);
    expect(feed.state.stories.map((row) => row.id)).toContain(30);
    expect(feed.state.stories[0].id).toBe(50);
    expect(feed.state.hasNewer).toBe(false);
  });

  it('says when there are newer stories above what came', async () => {
    const { feed } = setup({ getLinkedGroup: linkedTo(10) });

    await feed.start();

    expect(feed.state.stories[0].id).toBe(30);
    expect(feed.state.hasNewer).toBe(true);
    expect(feed.state.hasMore).toBe(false);
  });

  it('goes on to older stories from the end of what came', async () => {
    const { feed, listSubgroups } = setup({ getLinkedGroup: linkedTo(40) });
    await feed.start();

    expect(feed.state.stories.at(-1)?.id).toBe(20);

    feed.reached(feed.state.stories.length - 1);
    await vi.waitFor(() => expect(feed.state.loading).toBe(false));

    expect(listSubgroups).toHaveBeenLastCalledWith(FEED_GROUP, expect.objectContaining({ beforeId: 20 }));
    expect(feed.state.stories.at(-1)?.id).toBe(1);
  });

  it('opens on the newest when the viewer cannot see that story', async () => {
    const { feed } = setup({ getLinkedGroup: linkedTo(999) });

    await feed.start();

    expect(feed.state.startId).toBeNull();
    expect(feed.state.stories[0].id).toBe(50);
  });

  it('prefers the story the viewer came back to', async () => {
    const { feed, listSubgroups } = setup({
      getLinkedGroup: linkedTo(30),
      storage: memoryStorage({ [RETURN_KEY]: '12' }),
    });

    await feed.start();

    expect(listSubgroups).toHaveBeenCalledWith(FEED_GROUP, expect.objectContaining({ aroundId: 12 }));
    expect(feed.state.startId).toBe(12);
  });

  it('works when the address cannot be read', async () => {
    const { feed } = setup({ getLinkedGroup: () => Promise.reject(new Error('timed out')) });

    await feed.start();

    expect(feed.state.stories).toHaveLength(PAGE_SIZE);
    expect(feed.state.started).toBe(true);
  });

  it('goes back to the newest with the period that is on', async () => {
    const { feed, listSubgroups } = setup({ getLinkedGroup: linkedTo(10) });
    await feed.start();

    await feed.applyFilter(feed.state.filter);

    expect(feed.state.hasNewer).toBe(false);
    expect(feed.state.stories[0].id).toBe(50);
    expect(listSubgroups).toHaveBeenLastCalledWith(FEED_GROUP, expect.objectContaining({ aroundId: undefined }));
  });
});

describe('the address of the page', () => {
  it('follows the story on screen', async () => {
    const linkGroup = vi.fn(async (_id: number) => ({ ok: true as const }));
    const { feed } = setup({ linkGroup });
    await feed.start();

    feed.reached(0);
    feed.reached(3);

    expect(linkGroup.mock.calls.map(([id]) => id)).toEqual([50, 47]);
    expect(feed.state.index).toBe(3);
  });

  it('is written once per story, however often the position is told', async () => {
    const { feed, linkGroup } = setup();
    await feed.start();

    feed.reached(2);
    feed.reached(2);
    feed.reached(2);

    expect(linkGroup).toHaveBeenCalledTimes(1);
  });

  it('does not stop the feed when it cannot be written', async () => {
    const { feed } = setup({ linkGroup: () => Promise.reject(new Error('timed out')) });
    await feed.start();

    expect(() => feed.reached(1)).not.toThrow();
  });

  it('waits for a story to be there', async () => {
    const { feed, linkGroup } = setup();

    feed.reached(0);

    expect(linkGroup).not.toHaveBeenCalled();
  });
});

describe('a guest', () => {
  it('is someone with no profile, and only that', async () => {
    const guest = setup({ getCurrentProfile: vi.fn(async () => null) });
    await guest.feed.start();
    expect(guest.feed.state.guest).toBe(true);

    const member = setup();
    await member.feed.start();
    expect(member.feed.state.guest).toBe(false);

    const unknown = setup({ getCurrentProfile: vi.fn(async () => Promise.reject(new Error('timeout'))) });
    await unknown.feed.start();
    expect(unknown.feed.state.guest).toBe(false);
    expect(unknown.feed.state.stories).toHaveLength(PAGE_SIZE);
  });

  it('logs in and comes back to the same story', async () => {
    const { feed, openLogin, openGroup, storage } = setup({ getCurrentProfile: vi.fn(async () => null) });
    await feed.start();
    await feed.applyFilter(makeFilter('2026-11-01', '2026-11-05'));

    await feed.login(7);

    expect(openLogin).toHaveBeenCalledTimes(1);
    expect(openGroup).not.toHaveBeenCalled();
    expect(storage.getItem(RETURN_KEY)).toBe('7');
    expect(JSON.parse(storage.getItem(RETURN_FILTER_KEY) ?? '{}')).toEqual({ from: '2026-11-01', to: '2026-11-05' });
  });

  it('forgets the story when the log-in cannot open, and says so', async () => {
    const { feed, storage } = setup({
      getCurrentProfile: vi.fn(async () => null),
      openLogin: failing('unavailable'),
    });

    await feed.login(7);

    expect(storage.getItem(RETURN_KEY)).toBeNull();
    expect(feed.state.notice).toBe('login');
  });
});
