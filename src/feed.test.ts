import { describe, expect, it, vi } from 'vitest';
import {
  createFeed,
  FEED_GROUP,
  LOAD_AHEAD,
  MAX_RETURN_PAGES,
  OPEN_FAILED_MS,
  PAGE_SIZE,
  RETURN_KEY,
  type FeedState,
} from './feed';
import type { PotokError, PotokSdk, PotokSubgroup, PotokSubgroupListOptions } from './potok';

const story = (id: number): PotokSubgroup => ({
  id,
  name: `Vest ${id}`,
  description_html: `<p>${id}</p>`,
  app_description: null,
  uses_api: false,
  picture_url: `/avatar/group/${id}`,
  inserted_at: '2026-11-05T08:00:00Z',
  last_value_at: null,
});

/** A server with stories `count` down to 1, paged like `listSubgroups`. */
function server(count: number) {
  const stories = Array.from({ length: count }, (_, index) => story(count - index));

  return vi.fn(async (_name: string, options: PotokSubgroupListOptions = {}) => {
    const limit = options.limit ?? PAGE_SIZE;
    const rows = stories.filter((row) => options.beforeId === undefined || row.id < options.beforeId);

    return { ok: true as const, groups: rows.slice(0, limit), has_more: rows.length > limit };
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

function setup({
  listSubgroups = server(50),
  openGroup = vi.fn(async () => ({ ok: true as const })),
  storage = memoryStorage(),
}: {
  listSubgroups?: PotokSdk['listSubgroups'];
  openGroup?: PotokSdk['openGroup'];
  storage?: ReturnType<typeof memoryStorage>;
} = {}) {
  const changes: FeedState[] = [];
  const feed = createFeed({ listSubgroups, openGroup }, storage, (state) => changes.push(state));

  return { feed, listSubgroups, openGroup, storage, changes };
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
    expect(feed.state.openFailed).toBe(false);
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
      expect(feed.state.openFailed).toBe(true);

      vi.advanceTimersByTime(OPEN_FAILED_MS);
      expect(feed.state.openFailed).toBe(false);
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

  it('loads pages until it finds the story', async () => {
    const { feed, listSubgroups } = setup({ storage: memoryStorage({ [RETURN_KEY]: '25' }) });

    await feed.start();

    expect(feed.state.startId).toBe(25);
    expect(listSubgroups).toHaveBeenCalledTimes(2);
  });

  it('gives up after a few pages and opens on the newest', async () => {
    const { feed, listSubgroups, storage } = setup({
      listSubgroups: server(500),
      storage: memoryStorage({ [RETURN_KEY]: '1' }),
    });

    await feed.start();

    expect(feed.state.startId).toBeNull();
    expect(listSubgroups).toHaveBeenCalledTimes(MAX_RETURN_PAGES);
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
