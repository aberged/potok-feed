import type {
  PotokApi,
  PotokChild,
  PotokChildAttrs,
  PotokContentFormat,
  PotokData,
  PotokError,
  PotokGroupDescription,
  PotokGroupTab,
  PotokListedValue,
  PotokListOptions,
  PotokOwnGroup,
  PotokProfile,
  PotokSdk,
  PotokReaction,
  PotokSubgroup,
  PotokSubgroupListOptions,
  PotokSubgroupPage,
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
//
// The app's own sub-groups (`listChildren`, `createChild`, ...) are in
// `potok-dev:children`. `potok-dev:group` overrides fields of what `getGroup`
// answers, for a viewer with other rights or a group set up another way.

const VALUES_STORAGE_KEY = 'potok-dev:values';
const SUBGROUPS_STORAGE_KEY = 'potok-dev:subgroups';
const CHILDREN_STORAGE_KEY = 'potok-dev:children';
const GROUP_STORAGE_KEY = 'potok-dev:group';
const LINK_PARAM = 'at';
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const DEFAULT_SUBGROUP_LIMIT = 20;
const MAX_SUBGROUP_LIMIT = 50;
const LEGACY_PAGE_SIZE = 200;
const LEGACY_MAX_ROWS = 5_000;
const MAX_GROUP_NAME_LENGTH = 120;
const MAX_PICTURE_LENGTH = 1_000_000;
/** Who an inheriting sub-group holds besides the viewer. */
const DEV_INHERITED_MEMBERS = 4;

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

/** The period of `listSubgroups` and `listChildren`, or `invalid_date` for what is no moment. */
function inPeriod(
  options: PotokSubgroupListOptions,
): ((group: PotokSubgroup) => boolean) | { ok: false; error: 'invalid_date' } {
  const moment = (value: string | undefined) => (value === undefined ? undefined : Date.parse(value));
  const from = moment(options.from);
  const to = moment(options.to);

  if (Number.isNaN(from) || Number.isNaN(to)) return { ok: false, error: 'invalid_date' };

  return (group) => {
    const placed = Date.parse(group.published_at ?? group.inserted_at);
    return (from === undefined || placed >= from) && (to === undefined || placed < to);
  };
}

/** The answer to `aroundId`; null when the rows, newest first, do not hold that group. */
function aroundPage(rows: PotokSubgroup[], aroundId: number | undefined, limit: number): PotokSubgroupPage | null {
  const index = rows.findIndex((group) => group.id === aroundId);
  if (index < 0) return null;

  const first = Math.max(0, index - limit);
  const end = index + limit + 1;

  return { ok: true, groups: rows.slice(first, end), has_more: rows.length > end, has_newer: first > 0 };
}

function saveSubgroups(subgroups: Record<string, PotokSubgroup[]>) {
  localStorage.setItem(SUBGROUPS_STORAGE_KEY, JSON.stringify(subgroups));
}

function loadChildren(): PotokChild[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(CHILDREN_STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? (stored as PotokChild[]) : [];
  } catch {
    return [];
  }
}

function saveChildren(children: PotokChild[]) {
  try {
    localStorage.setItem(CHILDREN_STORAGE_KEY, JSON.stringify(children));
  } catch {
    // Storage full or blocked: the groups live until the next reload.
  }
}

function loadOwnGroup(): PotokOwnGroup {
  const group: PotokOwnGroup = {
    id: 1,
    name: 'dev-group',
    is_public: false,
    inherits_members: false,
    parent: null,
    can_manage_children: true,
    can_create_children: true,
    everyone_creates_subgroups: false,
  };

  try {
    const stored: unknown = JSON.parse(localStorage.getItem(GROUP_STORAGE_KEY) || '{}');
    return stored && typeof stored === 'object' ? { ...group, ...stored } : group;
  } catch {
    return group;
  }
}

// A rough stand-in for the server's sanitizer and markdown: comments and
// scripts go, and markdown stays plain text in paragraphs.
function devDescriptionHtml(description: string, format: PotokContentFormat): string | null {
  if (description.trim() === '') return null;

  if (format === 'html') {
    return description.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  }

  const text = description.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function devPicture(id: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="hsl(${(id * 47) % 360} 60% 55%)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const closed = (group: PotokSubgroup) => !group.is_public && !group.inherits_members;

const feedTime = (group: PotokSubgroup) => group.published_at ?? group.inserted_at;

// Social.list_visible_child_groups_newest_first: when it opened up, then id.
function compareFeedOrder(a: PotokSubgroup, b: PotokSubgroup): number {
  return feedTime(b).localeCompare(feedTime(a)) || b.id - a.id;
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

const timestamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

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
  const ownGroup = loadOwnGroup();
  let children = loadChildren();

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

  const forbidden: PotokError = {
    ok: false,
    error: 'forbidden',
    message: 'Your roles in this group do not allow that.',
  };

  const invalidGroup: PotokError = { ok: false, error: 'invalid_group', message: 'Could not save the group.' };

  const validAttrs = (attrs: PotokChildAttrs) =>
    (attrs.name === undefined || (attrs.name.trim() !== '' && attrs.name.length <= MAX_GROUP_NAME_LENGTH)) &&
    (attrs.picture === undefined || attrs.picture.length <= MAX_PICTURE_LENGTH);

  const applyAttrs = (child: PotokChild, attrs: PotokChildAttrs): PotokChild => {
    const description = attrs.description ?? child.description ?? '';
    const format = attrs.descriptionFormat ?? child.description_format;
    const inherits = attrs.inheritsMembers ?? child.inherits_members;

    return {
      ...child,
      name: attrs.name ?? child.name,
      description,
      description_format: format,
      description_html: devDescriptionHtml(description, format),
      is_public: attrs.isPublic ?? child.is_public,
      inherits_members: inherits,
      picture_url: attrs.picture === '' ? devPicture(child.id) : (attrs.picture ?? child.picture_url),
      member_count: inherits ? 1 + DEV_INHERITED_MEMBERS : child.member_count,
      updated_at: timestamp(),
    };
  };

  // The child, or the failure the server answers with.
  const editableChild = (id: number): PotokChild | PotokError => {
    if (!ownGroup.can_manage_children) return forbidden;

    const child = children.find((row) => row.id === id);
    if (!child) return { ok: false, error: 'not_found' };

    return child.can_edit ? child : forbidden;
  };

  const storeChild = (child: PotokChild) => {
    children = [...children.filter((row) => row.id !== child.id), child];
    saveChildren(children);
    return { ok: true as const, group: child };
  };

  return {
    insertValue(params: { data: string; content_format: PotokContentFormat }): { ok: true; value: PotokValue } | PotokError {
      const data = decodeData(params.data);
      if (data === undefined) {
        return { ok: false, error: 'invalid_value', message: 'Could not create value.' };
      }

      syncValues();
      const now = timestamp();
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
    ): PotokSubgroupPage | PotokError {
      const groups = loadSubgroups()[name];
      if (!groups) return { ok: false, error: 'not_found' };

      const limit = Math.min(nonNegativeInteger(options.limit) ?? DEFAULT_SUBGROUP_LIMIT, MAX_SUBGROUP_LIMIT);
      const beforeId = nonNegativeInteger(options.beforeId);
      const period = inPeriod(options);
      if (typeof period !== 'function') return period;

      const inOrder = groups.filter(period).sort((a, b) => b.id - a.id);
      const around = aroundPage(inOrder, nonNegativeInteger(options.aroundId), limit);
      if (around) return around;

      const rows = inOrder.filter((group) => beforeId === undefined || group.id < beforeId).slice(0, limit + 1);

      return { ok: true, groups: rows.slice(0, limit), has_more: rows.length > limit, has_newer: false };
    },

    openGroup(id: number, tab: PotokGroupTab | undefined): { ok: true } | PotokError {
      const known =
        id === ownGroup.parent?.id ||
        children.some((group) => group.id === id) ||
        Object.values(loadSubgroups()).some((groups) => groups.some((group) => group.id === id));
      if (!known) return { ok: false, error: 'not_found' };

      const path = tab === 'description' ? 'group_home' : tab === 'settings' ? 'edit_group' : 'values';
      console.info(`[potok-dev] openGroup: in potok the viewer goes to /groups/${id}/${path} and the app ends.`);
      return { ok: true };
    },

    toggleGroupReaction(id: number, emoji: string): { ok: true; reactions: PotokReaction[] } | PotokError {
      const subgroups = loadSubgroups();
      const group = Object.values(subgroups)
        .flat()
        .find((row) => row.id === id);
      if (!group) return { ok: false, error: 'not_found' };
      if (!group.can_react) return forbidden;

      const own = group.reactions.find((reaction) => reaction.emoji === emoji);

      if (!own) group.reactions.push({ emoji, count: 1, mine: true });
      else if (!own.mine) Object.assign(own, { count: own.count + 1, mine: true });
      else if (own.count > 1) Object.assign(own, { count: own.count - 1, mine: false });
      else group.reactions.splice(group.reactions.indexOf(own), 1);

      saveSubgroups(subgroups);
      return { ok: true, reactions: group.reactions };
    },

    pickEmoji(): { ok: true; emoji: string } | PotokError {
      const emoji = window.prompt('[potok-dev] pickEmoji: in potok this is its emoji picker.', '🎉');
      return emoji ? { ok: true, emoji } : { ok: false, error: 'cancelled' };
    },

    shareGroup(id: number, inApp: boolean | undefined): { ok: true } | PotokError {
      const known = Object.values(loadSubgroups()).some((groups) => groups.some((group) => group.id === id));
      if (!known) return { ok: false, error: 'not_found' };

      const link = inApp ? `/groups/${ownGroup.id}/group_home?at=${id}` : `/groups/${id}`;
      console.info(`[potok-dev] shareGroup: in potok the page offers to share ${link}.`);
      return { ok: true };
    },

    linkGroup(id: number): { ok: true } | PotokError {
      if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: 'invalid_group' };

      const url = new URL(location.href);
      url.searchParams.set(LINK_PARAM, String(id));
      history.replaceState(history.state, '', url);
      return { ok: true };
    },

    getLinkedGroup(): { ok: true; group_id: number | null } {
      return { ok: true, group_id: Number(new URLSearchParams(location.search).get(LINK_PARAM)) || null };
    },

    getGroup(): { ok: true; group: PotokOwnGroup } {
      return { ok: true, group: ownGroup };
    },

    listChildren(options: PotokSubgroupListOptions): PotokSubgroupPage | PotokError {
      if (!ownGroup.can_manage_children) return forbidden;

      const limit = Math.min(nonNegativeInteger(options.limit) ?? DEFAULT_SUBGROUP_LIMIT, MAX_SUBGROUP_LIMIT);
      const beforeId = nonNegativeInteger(options.beforeId);
      const period = inPeriod(options);
      if (typeof period !== 'function') return period;
      const before = children.find((group) => group.id === beforeId);

      const inOrder = [...children].sort(compareFeedOrder).filter(period);
      const around = aroundPage(inOrder, nonNegativeInteger(options.aroundId), limit);
      if (around) return around;

      const rows = inOrder
        .filter((group) => {
          if (beforeId === undefined) return true;
          return before ? compareFeedOrder(before, group) < 0 : group.id < beforeId;
        })
        .slice(0, limit + 1);

      return { ok: true, groups: rows.slice(0, limit), has_more: rows.length > limit, has_newer: false };
    },

    getChild(id: number): { ok: true; group: PotokChild } | PotokError {
      if (!ownGroup.can_manage_children) return forbidden;

      const child = children.find((row) => row.id === id);
      if (!child) return { ok: false, error: 'not_found' };

      return { ok: true, group: child.can_edit ? child : { ...child, description: null } };
    },

    createChild(attrs: PotokChildAttrs & { name: string }): { ok: true; group: PotokChild } | PotokError {
      if (!ownGroup.can_create_children) return forbidden;
      if (!validAttrs(attrs)) return invalidGroup;

      const id = children.reduce((max, row) => Math.max(max, row.id), 100) + 1;
      const now = timestamp();

      return storeChild(
        applyAttrs(
          {
            id,
            name: attrs.name,
            description_html: null,
            app_description: null,
            uses_api: false,
            picture_url: devPicture(id),
            is_public: false,
            inherits_members: false,
            creator_id: devProfile.id,
            inserted_at: now,
            published_at: null,
            last_value_at: null,
            comment_count: 0,
            reactions: [],
            can_react: true,
            description: '',
            description_format: 'markdown',
            can_edit: true,
            member_count: 1,
            updated_at: now,
          },
          attrs,
        ),
      );
    },

    updateChild(id: number, attrs: PotokChildAttrs): { ok: true; group: PotokChild } | PotokError {
      const child = editableChild(id);
      if ('ok' in child) return child;
      if (!validAttrs(attrs)) return invalidGroup;

      const updated = applyAttrs(child, attrs);
      const opened = closed(child) && !closed(updated);

      return storeChild({ ...updated, published_at: opened ? timestamp() : updated.published_at });
    },

    withdrawChild(id: number): { ok: true; group: PotokChild } | PotokError {
      const child = editableChild(id);
      if ('ok' in child) return child;

      return storeChild({
        ...child,
        is_public: false,
        inherits_members: false,
        published_at: null,
        member_count: 1,
        updated_at: timestamp(),
      });
    },

    previewDescription(
      description: string,
      format: PotokContentFormat | null,
    ): { ok: true; html: string | null } | PotokError {
      if (!ownGroup.can_manage_children) return forbidden;

      return { ok: true, html: devDescriptionHtml(description, format ?? 'markdown') };
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

    async toggleGroupReaction(id, emoji) {
      return server.toggleGroupReaction(id, emoji);
    },

    async pickEmoji() {
      return server.pickEmoji();
    },

    async shareGroup(id, options = {}) {
      return server.shareGroup(id, options.inApp);
    },

    async linkGroup(id) {
      return server.linkGroup(id);
    },

    async getLinkedGroup() {
      return server.getLinkedGroup();
    },

    async getGroup() {
      return server.getGroup();
    },

    async listChildren(options = {}) {
      return server.listChildren(options);
    },

    async getChild(id) {
      return server.getChild(id);
    },

    async createChild(attrs) {
      return server.createChild(attrs);
    },

    async updateChild(id, attrs) {
      return server.updateChild(id, attrs);
    },

    async withdrawChild(id) {
      return server.withdrawChild(id);
    },

    async previewDescription(description, options = {}) {
      return server.previewDescription(description, options.descriptionFormat ?? null);
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
