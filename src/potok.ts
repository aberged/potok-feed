// Types for the API that potok-ide exposes to apps (potok-ide:
// assets/js/potok_app_sdk.js, server side in GroupLive.Show.AppApi).
//
// The app runs in a sandboxed iframe that has two APIs:
// - `potok` (legacy): `#group-panel-description`.potok, which the build
//   wrapper in vite.config.ts hands to the app code as a local `potok`;
// - `window.potok`: the newer SDK (insertValue, listValues, onNewValue, ...).
//
// A group has one app per description: the default one and each alternative
// description with "Uses API". Each app has its own data values; both APIs
// see only those of their own app unless asked for the group's (`scope`).

export type PotokContentFormat = "markdown" | "html";

export type PotokData = Record<string, unknown>;

/** Failed call; `message` is set (localized) only by server-side checks. */
export type PotokError = {
  ok: false;
  error:
    | "not_a_member"
    | "forbidden"
    | "rate_limited"
    | "invalid_value"
    | "invalid_description"
    | "invalid_group"
    | "unknown_method"
    /** The call came from an app that is no longer on screen. */
    | "stale_app"
    /** No such sub-group or group, or the viewer cannot see it. */
    | "not_found"
    | "preview"
    | "disconnected";
  message?: string;
};

/** A data value, as returned by insert and sent to new value listeners. */
export type PotokValue<T extends object = PotokData> = {
  id: number;
  content: string;
  /** The inserted JSON object. */
  data: T | null;
  content_format: PotokContentFormat;
  is_data: boolean;
  group_id: number;
  parent_id: number | null;
  creator_id: number;
  creator_username: string | null;
  /** The app the value belongs to: null for the default description's. */
  description_id: number | null;
};

/** A data value as listed; timestamps are ISO 8601 strings. */
export type PotokListedValue<T extends object = PotokData> = PotokValue<T> & {
  inserted_at: string;
  updated_at: string;
};

export type PotokListOptions = {
  /** Page size, at most 200 (the server's default is 50). */
  limit?: number;
  offset?: number;
  /** Only values with a greater id. */
  afterId?: number;
  /** Only values with a smaller id. */
  beforeId?: number;
  /** Key in `data` that must contain `searchValue` (case-insensitive). */
  searchField?: string;
  searchValue?: string;
  /** Key in `data` to order by; without it values come in insertion order. */
  orderBy?: string;
  orderDir?: "asc" | "desc";
  /** "group" adds the values of the group's other apps that the viewer can open. */
  scope?: "group";
};

export type PotokProfile = {
  id: number;
  username: string;
  profile_picture_url: string;
  description: string | null;
  description_format: PotokContentFormat;
  sharing: "unique" | "shared";
  inserted_at: string;
  updated_at: string;
  admin: boolean;
  /** Names of the roles the profile holds in the group. */
  roles: string[];
};

/** The app's own description; `id` is the group's. */
export type PotokGroupDescription = {
  id: number;
  /** null for the default description. */
  description_id: number | null;
  /** The default description's label (if set) or the alternative description's name. */
  name: string | null;
  description: string;
  description_format: PotokContentFormat;
};

/**
 * A direct sub-group of the app's group, or a group under one; timestamps are
 * ISO 8601 strings.
 */
export type PotokSubgroup = {
  id: number;
  name: string;
  /**
   * The description as sanitized HTML, safe to put in the page; a `rich-content`
   * element around it gives the styles of the group page. null for a group
   * without a description and for an app, whose description is its source code.
   */
  description_html: string | null;
  /** What an app says about itself in its meta tags, as plain text; null otherwise. */
  app_description: string | null;
  uses_api: boolean;
  picture_url: string;
  is_public: boolean;
  inherits_members: boolean;
  creator_id: number;
  inserted_at: string;
  /** When a closed group (private, not inheriting) last opened up; null if it never was closed. */
  published_at: string | null;
  /** When the newest chat value was posted. */
  last_value_at: string | null;
};

/** A direct sub-group of the app's group, with what it takes to edit it. */
export type PotokChild = PotokSubgroup & {
  /** The source: null when the viewer cannot edit the group, and for an app. */
  description: string | null;
  description_format: PotokContentFormat;
  can_edit: boolean;
  member_count: number;
  updated_at: string;
};

/** What an app may set on a sub-group. A field left out stays as it is. */
export type PotokChildAttrs = {
  name?: string;
  description?: string;
  descriptionFormat?: PotokContentFormat;
  isPublic?: boolean;
  inheritsMembers?: boolean;
  /** An image URL or a `data:` URL, at most 1,000,000 characters. */
  picture?: string;
};

/** The app's own group and what the viewer may do there. */
export type PotokOwnGroup = {
  id: number;
  name: string;
  is_public: boolean;
  inherits_members: boolean;
  /** null for a viewer who cannot see that group. */
  parent: { id: number; name: string; is_public: boolean; uses_api: boolean } | null;
  /** The viewer may keep the sub-groups: they hold `edit_group` here. */
  can_manage_children: boolean;
  /** They hold `create_subgroups` as well. */
  can_create_children: boolean;
  /** Any member can add a group here by hand, past the app. */
  everyone_creates_subgroups: boolean;
};

export type PotokGroupTab = "chat" | "description" | "settings";

export type PotokSubgroupListOptions = {
  /** Page size, at most 50 (the server's default is 20). */
  limit?: number;
  /** The id of the last group of the previous page. */
  beforeId?: number;
};

/** `window.potok`. Calls reject if the page does not answer within 10s. */
export type PotokSdk = {
  insertValue<T extends object = PotokData>(
    data: T | string,
    options?: { contentFormat?: PotokContentFormat },
  ): Promise<{ ok: true; value: PotokValue<T> } | PotokError>;
  listValues<T extends object = PotokData>(
    options?: PotokListOptions,
  ): Promise<{ ok: true; values: PotokListedValue<T>[]; has_more: boolean } | PotokError>;
  updateDescription(
    description: string,
    options?: { descriptionFormat?: PotokContentFormat },
  ): Promise<{ ok: true; group: PotokGroupDescription } | PotokError>;
  getDescription(): Promise<{ ok: true; group: PotokGroupDescription } | PotokError>;
  getCurrentProfile(): Promise<PotokProfile | null>;
  /**
   * The groups under this group's direct sub-group called exactly `name`,
   * newest first, as far as the viewer can see them. Of several sub-groups
   * with one name the oldest counts.
   */
  listSubgroups(
    name: string,
    options?: PotokSubgroupListOptions,
  ): Promise<{ ok: true; groups: PotokSubgroup[]; has_more: boolean } | PotokError>;
  /**
   * Takes the viewer to this group's parent, a direct sub-group or a group
   * `listSubgroups` can return: to its chat, with `tab: "description"` to its
   * description, where a group that is an app runs, or with `tab: "settings"` to
   * its settings. The app ends with the page.
   */
  openGroup(id: number, options?: { tab?: PotokGroupTab }): Promise<{ ok: true } | PotokError>;
  getGroup(): Promise<{ ok: true; group: PotokOwnGroup } | PotokError>;
  /**
   * The direct sub-groups, in the order of `listSubgroups`. This and the calls
   * below act in the viewer's name, so they need `can_manage_children`.
   */
  listChildren(
    options?: PotokSubgroupListOptions,
  ): Promise<{ ok: true; groups: PotokSubgroup[]; has_more: boolean } | PotokError>;
  getChild(id: number): Promise<{ ok: true; group: PotokChild } | PotokError>;
  /** Needs `can_create_children`. Without `isPublic` or `inheritsMembers` only the viewer sees the group. */
  createChild(attrs: PotokChildAttrs & { name: string }): Promise<{ ok: true; group: PotokChild } | PotokError>;
  /** A closed group that opens up moves to the top of the order. */
  updateChild(id: number, attrs: PotokChildAttrs): Promise<{ ok: true; group: PotokChild } | PotokError>;
  /** Closes the group again, and its inherited members leave. Direct members and the viewer stay. */
  withdrawChild(id: number): Promise<{ ok: true; group: PotokChild } | PotokError>;
  /** The text as a feed will show it, sanitized on the server; counts as a write for the rate limit. */
  previewDescription(
    description: string,
    options?: { descriptionFormat?: PotokContentFormat },
  ): Promise<{ ok: true; html: string | null } | PotokError>;
  /**
   * Gets every new value of this app, also the viewer's own; with
   * `{scope: "group"}` also those of the group's other apps. Returns a
   * function that removes the listener.
   */
  onNewValue<T extends object = PotokData>(
    listener: (value: PotokValue<T>) => void,
    options?: { scope?: "group" },
  ): () => void;
};

/** Legacy API (`#group-panel-description`.potok). */
export type PotokApi = {
  readonly el: HTMLElement;
  abortController: AbortController;
  /** `{signal}` of `abortController`; set by the build wrapper and by installDevPotok. */
  eventListenerOptions: AddEventListenerOptions;
  /** `content` is a JSON object as a string; anything but a string is sent as "". */
  insertGroupValue<T extends object = PotokData>(
    content: string,
    options?: { contentFormat?: PotokContentFormat },
  ): Promise<{ ok: true; value: PotokValue<T> } | PotokError>;
  updateGroupDescription(
    description: string,
    options?: { descriptionFormat?: PotokContentFormat },
  ): Promise<{ ok: true; group: PotokGroupDescription } | PotokError>;
  getGroupDescription(): Promise<{
    description: string;
    descriptionFormat: PotokContentFormat;
  }>;
  /** With `limit`: one page (at most 200 values). */
  getGroupDataValues<T extends object = PotokData>(
    options: PotokListOptions & { limit: number },
  ): Promise<{ ok: true; values: PotokListedValue<T>[]; has_more: boolean } | PotokError>;
  /** Without `limit`: every value (fetched in pages of 200, up to 5000). */
  getGroupDataValues<T extends object = PotokData>(
    options?: Omit<PotokListOptions, "limit" | "offset">,
  ): Promise<{ ok: true; values: PotokListedValue<T>[] } | PotokError>;
  getCurrentProfile(): Promise<PotokProfile | null>;
  /** Replaces the previous callback; it receives a `phx:new_data_value` event. */
  setNewValueCallback<T extends object = PotokData>(
    callback: (event: CustomEvent<PotokValue<T>>) => void,
  ): void;
};

declare global {
  const potok: PotokApi;

  interface Window {
    potok: PotokSdk;
  }
}

export {};
