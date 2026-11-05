import type {
  PotokApi,
  PotokContentFormat,
  PotokData,
  PotokError,
  PotokGroupDescription,
  PotokGroupTab,
  PotokListedValue,
  PotokListOptions,
  PotokProfile,
  PotokSdk,
  PotokSubgroup,
  PotokSubgroupListOptions,
  PotokValue,
} from './potok';

// Dev stand-in for potok-ide's assets/js/potok_app_sdk.js: the same SDK
// (`window.potok`) and legacy shim (`#group-panel-description`.potok), with a
// local server in place of the page that replies like GroupLive.Show.AppApi.
// Values are kept in localStorage so they survive a reload.
//
// `?app=<id>` in the URL runs the app as the alternative description <id>
// (what `<meta name="potok-app">` tells the SDK); without it, as the default
// description. Every app's values share one store, as they do in the group.
//
// The groups `listSubgroups` returns are in localStorage as well, under
// `potok-dev:subgroups`: `{"<sub-group name>": PotokSubgroup[]}`. The app fills
// that key itself in dev; without the name the call answers `not_found`.

const VALUES_STORAGE_KEY = 'potok-dev:values';
const SUBGROUPS_STORAGE_KEY = 'potok-dev:subgroups';
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const DEFAULT_SUBGROUP_LIMIT = 20;
const MAX_SUBGROUP_LIMIT = 50;
const LEGACY_PAGE_SIZE = 200;
const LEGACY_MAX_ROWS = 5_000;

const devProfile: PotokProfile = {
  id: 1,
  username: 'dev-user',
  profile_picture_url: 'https://api.dicebear.com/9.x/thumbs/svg?seed=potok-dev',
  description: null,
  description_format: 'markdown',
  sharing: 'unique',
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  admin: true,
  roles: [],
};

const appParam = Number(new URLSearchParams(location.search).get('app'));
const ownDescriptionId = Number.isInteger(appParam) && appParam > 0 ? appParam : null;

const ownValue = (value: PotokValue) => value.description_id === ownDescriptionId;

// listener -> whether it gets the values of every app in the group.
const newValueListeners = new Map<(value: PotokValue) => void, boolean>();

function deliverNewValue(value: PotokValue) {
  const own = ownValue(value);

  newValueListeners.forEach((allApps, listener) => {
    if (!own && !allApps) return;

    try {
      listener(value);
    } catch (error) {
      console.error(error);
    }
  });

  if (own) window.dispatchEvent(new CustomEvent('phx:new_data_value', { detail: value }));
}

function createDescriptionHost(): HTMLElement {
  const existing = document.querySelector('#group-panel-description');
  if (existing instanceof HTMLElement) {
    return existing;
  }

  const host = document.createElement('div');
  host.id = 'group-panel-description';
  host.style.width = '100dvw';
  host.style.minHeight = '100dvh';
  host.style.overflowY = 'auto';
  host.innerHTML = document.body.innerHTML;
  while (document.body.children.length > 0) document.body.removeChild(document.body.children[0]);
  document.body.appendChild(host);

  return host;
}

function loadValues(): PotokListedValue[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(VALUES_STORAGE_KEY) || '[]');
    if (!Array.isArray(stored)) return [];

    // Values stored before apps had ids belong to the default description.
    return stored.map((row: PotokListedValue) => ({ ...row, description_id: row.description_id ?? null }));
  } catch {
    return [];
  }
}

function saveValues(values: PotokListedValue[]) {
  try {
    localStorage.setItem(VALUES_STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Storage full or blocked: the values live until the next reload.
  }
}

function loadSubgroups(): Record<string, PotokSubgroup[]> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SUBGROUPS_STORAGE_KEY) || '{}');
    return stored && typeof stored === 'object' ? (stored as Record<string, PotokSubgroup[]>) : {};
  } catch {
    return {};
  }
}

// Like Value.decode_data_value: `data` must be a JSON object; undefined means
// the server would reject it.
function decodeData(data: string): PotokData | null | undefined {
  const trimmed = data.trim();
  if (trimmed === '') return null;

  try {
    const decoded: unknown = JSON.parse(trimmed);
    if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
      return decoded as PotokData;
    }
  } catch {
    // Not JSON.
  }

  return undefined;
}

// Show.value_payload/1 carries no timestamps; listed values do.
function valuePayload(row: PotokListedValue): PotokValue {
  const { inserted_at: _insertedAt, updated_at: _updatedAt, ...value } = row;
  return value;
}

// `data ->> field` in Postgres, with a missing field as ''.
function dataText(row: PotokListedValue, field: string): string {
  const item = row.data?.[field];
  if (item == null) return '';
  return typeof item === 'object' ? JSON.stringify(item) : String(item);
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

// Social.maybe_order_data_value_field: insertion order by default; by a
// `data` field case-insensitively, and numerically first for "number".
function compareRows(orderBy: string | undefined, orderDir: string | undefined) {
  const dir = orderDir === 'desc' ? -1 : 1;

  return (a: PotokListedValue, b: PotokListedValue) => {
    if (orderBy) {
      const aText = dataText(a, orderBy);
      const bText = dataText(b, orderBy);

      if (orderBy === 'number') {
        // Non-numbers sort like NULL: last when ascending, first when descending.
        const numeric = (text: string) => (/^-?[0-9]+(\.[0-9]+)?$/.test(text) ? Number(text) : Infinity);
        const aNumber = numeric(aText);
        const bNumber = numeric(bText);
        if (aNumber !== bNumber) return (aNumber < bNumber ? -1 : 1) * dir;
      }

      const aLower = aText.toLowerCase();
      const bLower = bText.toLowerCase();
      if (aLower !== bLower) return (aLower < bLower ? -1 : 1) * dir;
    }

    return (a.id - b.id) * dir;
  };
}

type DevServer = ReturnType<typeof createServer>;

function createServer(el: HTMLElement) {
  const values = loadValues();

  // A tab with another `?app` writes to the same store; its values are taken
  // in before every call, so that neither tab overwrites the other's.
  const syncValues = () => {
    const known = new Set(values.map((row) => row.id));
    values.push(...loadValues().filter((row) => !known.has(row.id)));
  };

  // In potok the group description is the app's HTML.
  let description = el.innerHTML;
  let descriptionFormat: PotokContentFormat = 'html';

  const group = (): PotokGroupDescription => ({
    id: 1,
    description_id: ownDescriptionId,
    name: ownDescriptionId === null ? null : `alt-${ownDescriptionId}`,
    description,
    description_format: descriptionFormat,
  });

  return {
    insertValue(params: { data: string; content_format: PotokContentFormat }): { ok: true; value: PotokValue } | PotokError {
      const data = decodeData(params.data);
      if (data === undefined) {
        return { ok: false, error: 'invalid_value', message: 'Could not create value.' };
      }

      syncValues();
      const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      const row: PotokListedValue = {
        id: values.reduce((max, v) => Math.max(max, v.id), 0) + 1,
        content: 'data:',
        data,
        content_format: params.content_format,
        is_data: true,
        group_id: 1,
        parent_id: null,
        creator_id: devProfile.id,
        creator_username: devProfile.username,
        description_id: ownDescriptionId,
        inserted_at: now,
        updated_at: now,
      };
      values.push(row);
      saveValues(values);

      const value = valuePayload(row);
      // The server broadcasts every new value, also to the viewer who sent it.
      setTimeout(() => deliverNewValue(value));
      return { ok: true, value };
    },

    listValues(options: PotokListOptions): { ok: true; values: PotokListedValue[]; has_more: boolean } {
      const limit = Math.max(1, Math.min(nonNegativeInteger(options.limit) ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
      const offset = nonNegativeInteger(options.offset) ?? 0;
      const afterId = nonNegativeInteger(options.afterId);
      const beforeId = nonNegativeInteger(options.beforeId);
      const searchField = options.searchField?.trim();
      const searchValue = options.searchValue?.trim().toLowerCase();

      syncValues();
      // "group": every app's values (in dev the viewer can open them all).
      const rows = values
        .filter((row) => options.scope === 'group' || ownValue(row))
        .filter((row) => afterId === undefined || row.id > afterId)
        .filter((row) => beforeId === undefined || row.id < beforeId)
        .filter((row) => !searchField || !searchValue || dataText(row, searchField).toLowerCase().includes(searchValue))
        .sort(compareRows(options.orderBy?.trim(), options.orderDir))
        .slice(offset, offset + limit + 1);

      return { ok: true, values: rows.slice(0, limit), has_more: rows.length > limit };
    },

    updateDescription(params: {
      description: string;
      description_format: PotokContentFormat | null;
    }): { ok: true; group: PotokGroupDescription } {
      description = params.description;
      descriptionFormat = params.description_format ?? descriptionFormat;
      console.info('[potok-dev] Description updated; in potok the app restarts with the new HTML.');

      return { ok: true, group: group() };
    },

    getDescription(): { ok: true; group: PotokGroupDescription } {
      return { ok: true, group: group() };
    },

    currentProfile(): { ok: true; profile: PotokProfile } {
      return { ok: true, profile: devProfile };
    },

    listSubgroups(
      name: string,
      options: PotokSubgroupListOptions,
    ): { ok: true; groups: PotokSubgroup[]; has_more: boolean } | PotokError {
      const groups = loadSubgroups()[name];
      if (!groups) return { ok: false, error: 'not_found' };

      const limit = Math.min(nonNegativeInteger(options.limit) ?? DEFAULT_SUBGROUP_LIMIT, MAX_SUBGROUP_LIMIT);
      const beforeId = nonNegativeInteger(options.beforeId);

      const rows = groups
        .filter((group) => beforeId === undefined || group.id < beforeId)
        .sort((a, b) => b.id - a.id)
        .slice(0, limit + 1);

      return { ok: true, groups: rows.slice(0, limit), has_more: rows.length > limit };
    },

    openGroup(id: number, tab: PotokGroupTab | undefined): { ok: true } | PotokError {
      const known = Object.values(loadSubgroups()).some((groups) => groups.some((group) => group.id === id));
      if (!known) return { ok: false, error: 'not_found' };

      const path = tab === 'description' ? 'group_home' : 'values';
      console.info(`[potok-dev] openGroup: in potok the viewer goes to /groups/${id}/${path} and the app ends.`);
      return { ok: true };
    },
  };
}

function createSdk(server: DevServer): PotokSdk {
  return {
    async insertValue<T extends object = PotokData>(
      data: T | string,
      options: { contentFormat?: PotokContentFormat } = {},
    ) {
      const reply = server.insertValue({
        data: typeof data === 'string' ? data : JSON.stringify(data ?? {}),
        content_format: options.contentFormat || 'markdown',
      });
      return reply as { ok: true; value: PotokValue<T> } | PotokError;
    },

    async listValues<T extends object = PotokData>(options: PotokListOptions = {}) {
      return server.listValues(options) as { ok: true; values: PotokListedValue<T>[]; has_more: boolean };
    },

    async updateDescription(description, options = {}) {
      return server.updateDescription({
        description: typeof description === 'string' ? description : '',
        description_format: options.descriptionFormat || null,
      });
    },

    async getDescription() {
      return server.getDescription();
    },

    async getCurrentProfile() {
      const reply = server.currentProfile();
      return reply.ok ? reply.profile : null;
    },

    async listSubgroups(name, options = {}) {
      return server.listSubgroups(name, options);
    },

    async openGroup(id, options = {}) {
      return server.openGroup(id, options.tab);
    },

    onNewValue(listener, options = {}) {
      if (typeof listener !== 'function') return () => {};

      const added = listener as (value: PotokValue) => void;
      newValueListeners.set(added, options.scope === 'group');
      return () => newValueListeners.delete(added);
    },
  };
}

function createLegacy(sdk: PotokSdk, abortController: AbortController): PotokApi {
  let legacyCallback: ((value: PotokValue) => void) | null = null;

  // Before the sandbox, `getGroupDataValues()` without a limit returned every
  // row; the legacy wrapper pages through the capped API to keep that contract.
  const legacyListAll = async (options: PotokListOptions) => {
    const values: PotokListedValue[] = [];
    let offset = 0;

    while (values.length < LEGACY_MAX_ROWS) {
      const reply = await sdk.listValues({ ...options, limit: LEGACY_PAGE_SIZE, offset });
      if (!reply.ok) return reply;

      values.push(...reply.values);
      if (!reply.has_more) break;
      offset += reply.values.length;
    }

    return { ok: true as const, values };
  };

  return {
    get el() {
      return document.getElementById('group-panel-description')!;
    },

    abortController,

    eventListenerOptions: { signal: abortController.signal },

    insertGroupValue<T extends object = PotokData>(
      content: string,
      options: { contentFormat?: PotokContentFormat } = {},
    ) {
      return sdk.insertValue<T>(typeof content === 'string' ? content : '', options);
    },

    updateGroupDescription: (description, options = {}) => sdk.updateDescription(description, options),

    async getGroupDescription() {
      const reply = await sdk.getDescription();
      const group = reply.ok ? reply.group : null;

      return {
        description: group?.description || '',
        descriptionFormat: group?.description_format || 'html',
      };
    },

    getGroupDataValues: ((options: PotokListOptions = {}) =>
      options.limit == null ? legacyListAll(options) : sdk.listValues(options)) as PotokApi['getGroupDataValues'],

    getCurrentProfile: () => sdk.getCurrentProfile(),

    setNewValueCallback<T extends object = PotokData>(fn: (event: CustomEvent<PotokValue<T>>) => void) {
      if (typeof fn !== 'function') return;

      // The old callback received the `phx:new_data_value` event itself.
      if (legacyCallback) newValueListeners.delete(legacyCallback);
      legacyCallback = (value) => fn(new CustomEvent('phx:new_data_value', { detail: value as PotokValue<T> }));
      newValueListeners.set(legacyCallback, false);
    },
  };
}

export function installDevPotok(): PotokApi {
  const current = (globalThis as { potok?: PotokApi }).potok;
  if (current) {
    return current;
  }

  const abortController = new AbortController();
  const host = createDescriptionHost();
  const sdk = createSdk(createServer(host));
  const legacy = createLegacy(sdk, abortController);

  (host as HTMLElement & { potok?: PotokApi }).potok = legacy;

  // Without the build wrapper `potok` in app code is `window.potok` as well,
  // so in dev it carries both APIs (they share only getCurrentProfile).
  Object.defineProperty(globalThis, 'potok', {
    configurable: true,
    value: { ...sdk, ...legacy },
  });

  return legacy;
}
