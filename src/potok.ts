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
//
// Values can also live in collections, under rules the app's editors keep in
// its config (`getConfig`, `saveConfig`): who writes, who reads everything and
// who only their own. Those come only through the calls that name a
// collection, and never through `onNewValue`.

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
    /** `createPlace`: a name, kind, place or pin it does not take. */
    | "invalid_place"
    /** `showGroup` from inside what `showGroup` opened. */
    | "unavailable"
    | "invalid_emoji"
    | "invalid_date"
    /** The viewer closed the picker of `pickEmoji`. */
    | "cancelled"
    | "unknown_method"
    /** The call came from an app that is no longer on screen. */
    | "stale_app"
    /** No such sub-group or group, or the viewer cannot see it. */
    | "not_found"
    | "preview"
    | "disconnected"
    /** Collections: the rule takes no more values (closed, or past its deadline). */
    | "closed"
    /** `once`: this person has a value there already. */
    | "already_answered"
    /** The scores are out, so the value no longer changes. */
    | "released"
    | "too_large"
    | "invalid_collection"
    /** `saveConfig`: rules that cannot hold; `reason` says which. */
    | "invalid_rules"
    | "invalid_files"
    | "files_missing"
    | "files_exposed"
    /** Someone else saved in between; `current` is what is there now. */
    | "conflict"
    | "no_config"
    | "not_scored"
    | "invalid_summary"
    /** `match` was not an object of at most 4 KB as JSON. */
    | "invalid_match"
    /** `aggregateValues`: a bad key, path or too many fields. */
    | "invalid_aggregate"
    /** A count or sum took over 5 seconds; a map's view took over 4. */
    | "timeout";
  message?: string;
  reason?: string;
  current?: unknown;
  /** `createChildren`: the position of the child that failed; nothing was saved. */
  index?: number;
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

/** What Potok adds to a value of a quiz, as far as the viewer may see it. */
export type PotokManaged = {
  score?: number;
  max?: number;
  /** Answers waiting for an editor. */
  pending?: number;
  items: Record<
    string,
    {
      ok?: boolean | null;
      points?: number | null;
      /** An editor gave these points. */
      graded?: boolean;
      feedback?: string;
      /** The right answers, once released, when the editors show them. */
      expected?: Record<string, unknown>;
    }
  >;
};

/**
 * A value of a collection. `creator_id` and `creator_username` are null on
 * someone else's anonymous value. Timestamps are ISO 8601 strings.
 */
export type PotokCollectionValue<T extends object = PotokData> = Omit<
  PotokListedValue<T>,
  "creator_id" | "creator_username"
> & {
  creator_id: number | null;
  creator_username: string | null;
  collection: string;
  /** Written while its collection was anonymous. */
  anonymous: boolean;
  /** Counts its changes; pass it to `updateValue`. */
  revision: number;
  managed: PotokManaged | null;
};

export type PotokListOptions = {
  /** Page size, at most 200 (the server's default is 50). */
  limit?: number;
  /** Counts on from the cursor, if there is one. */
  offset?: number;
  /** The values right after this id; `has_more` then means newer ones beyond. */
  afterId?: number;
  /** The values right before this id; `has_more` then means older ones beyond. */
  beforeId?: number;
  /** Key in `data` that must contain `searchValue` (case-insensitive). */
  searchField?: string;
  searchValue?: string;
  /** Only values whose data contains this: `{status: "open"}`. JSON types count: `{n: 5}` does not find `"5"`. */
  match?: PotokData;
  /** Adds `total`, the count of what the filters keep. */
  total?: boolean;
  /** Key in `data` to order by; then the cursors only narrow by id. Without it, the order they were written in. */
  orderBy?: string;
  /** "desc" for the newest first. */
  orderDir?: "asc" | "desc";
  /** "group" adds the values of the group's other apps that the viewer can open. */
  scope?: "group";
};

/** A page of a collection: by id, at most 100 values, right next to a cursor. */
export type PotokCollectionListOptions = {
  collection: string;
  limit?: number;
  offset?: number;
  afterId?: number;
  beforeId?: number;
  /** "desc" for the newest first. */
  orderDir?: "asc" | "desc";
  /** Only the viewer's own values. */
  mine?: boolean;
  /** Adds `total`, the count of what the filters keep. */
  total?: boolean;
  /** Only values whose data contains this (full readers only). */
  match?: PotokData;
};

/** Role keys: "everyone", "admin" or a custom role's UUID (`listRoles`). */
export type PotokRoleKey = string;

/** A rule of a collection, as the editors write it and Potok keeps it. */
export type PotokRule = {
  write?: PotokRoleKey[];
  read?: PotokRoleKey[];
  summary?: PotokRoleKey[];
  once?: boolean;
  edit_own?: boolean;
  anonymous?: boolean;
  public?: boolean;
  open?: boolean;
  /** ISO 8601 with a zone. */
  closes_at?: string | null;
  /** The path to the map of answers in each value. */
  under?: string[] | null;
  uploads?: Record<
    string,
    {
      target: "private" | "public";
      max_files?: number;
      max_bytes?: number;
      types?: ("document" | "presentation" | "spreadsheet" | "drawing" | "pdf" | "image" | "video" | "audio")[];
    }
  >;
  score?: {
    release?: "immediate" | "manual";
    released?: boolean;
    show?: { missed?: boolean; correct?: boolean; points?: boolean };
  } | null;
};

/** One check of a quiz's key, by question. */
export type PotokScoreCheck = { points: number } & (
  | { eq: unknown }
  | { set: unknown[] }
  | { text: string[]; others_wrong?: boolean }
  | { rows: Record<string, unknown> }
  | { row_sets: Record<string, unknown[]> }
  | { manual: true }
) & { ok?: string; bad?: string };

/** The app's config data: what the app keeps, and the parts Potok reads. */
export type PotokConfigData = PotokData & {
  rules?: Record<string, PotokRule>;
  /** Only editors read it. */
  secret?: PotokData & { score?: Record<string, Record<string, PotokScoreCheck>> };
  /** The groups that keep the app's files; written by Potok. */
  files?: { public?: number; private?: number };
};

export type PotokConfig = {
  id: number;
  revision: number;
  data: PotokConfigData;
  updated_at: string;
};

/** What the viewer may do in a collection. */
export type PotokCaps = {
  ruled: boolean;
  write: boolean;
  write_block: "closed" | "role" | "blocked" | "members_only" | "not_permitted" | null;
  read: "all" | "own";
  summary: boolean;
  edit_own: boolean;
  manage: boolean;
  open: boolean;
  once: boolean;
  anonymous: boolean;
  public: boolean;
  released: boolean;
  /** This person has a value there already. */
  written: boolean;
  /** The viewer gets a push for each new value. */
  notify: boolean;
};

export type PotokConfigReply = {
  ok: true;
  config: PotokConfig | null;
  caps: Record<string, PotokCaps>;
  /** The viewer edits the app. */
  manage: boolean;
  /** They may make its file groups too. */
  can_create_groups: boolean;
  /** For editors: whether the file groups stand. */
  files: { public: "ok" | "missing" | "exposed"; private: "ok" | "missing" | "exposed" } | null;
  /** The roles an alternative description is limited to; [] for all. */
  visible_role_keys: PotokRoleKey[];
  viewer: { signed_in: boolean; member: boolean; profile_id: number | null; username: string | null };
};

export type PotokRole = { key: PotokRoleKey; name: string; builtin: boolean };

export type PotokSummary = {
  total: number;
  keys: Record<
    string,
    {
      answered: number;
      /** `row` is null for a plain answer, the row's key in a grid. */
      rows: { row: string | null; answered: number; other: number; buckets: { value: string; count: number }[] }[];
    }
  >;
  score: {
    count: number;
    average: number | null;
    median: number | null;
    min: number | null;
    max: number | null;
    distribution: { score: number; count: number }[];
    items: Record<string, { ok?: number; bad?: number; pending?: number }>;
  } | null;
};

/** What `aggregateValues` adds up. Keys are 1 to 64 bytes. */
export type PotokAggregateOptions = {
  /** Up to 5 keys holding numbers: JSON numbers or plain decimal strings ("12", "-3.5"). */
  fields?: string[];
  /** A key to group by; its value as text, cut to 200 characters. */
  groupBy?: string;
  /** Path of up to 3 keys to the object the keys are read in; the top of `data` by default. */
  under?: string[];
  match?: PotokData;
  searchField?: string;
  searchValue?: string;
  scope?: "group";
  /** A collection, for those who read all of it; read at its rule's `under` by default. */
  collection?: string;
};

/** `count` values held a number; `sum` is 0 and the rest null when none did. */
export type PotokFieldStats = {
  count: number;
  sum: number;
  avg: number | null;
  min: number | null;
  max: number | null;
};

export type PotokAggregate = {
  total: number;
  fields: Record<string, PotokFieldStats>;
  /** With `groupBy`: the 50 biggest groups first; `value` is null for values without one. */
  buckets: { value: string | null; count: number; fields: Record<string, PotokFieldStats> }[] | null;
  /** The groups past the 50 biggest, or null. */
  other: { buckets: number; count: number } | null;
};

/** A file sent from the frame; put `{file}` into the value. */
export type PotokUploadedFile = {
  file: number;
  name: string;
  size: number;
  type: string;
  /** Only for a picture of the app: an address anyone who sees the app opens. */
  url?: string;
};

/** A change in the app's collections the viewer may see. */
export type PotokValueChange<T extends object = PotokData> =
  | { event: "created" | "updated"; collection: string; value: PotokCollectionValue<T> }
  | { event: "deleted"; collection: string; id: number }
  | { event: "cleared"; collection: string | null }
  | { event: "regraded"; collection: string }
  | { event: "config"; collection: "config"; id: number; revision: number };

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

/** One emoji on a group, whoever used it. */
export type PotokReaction = {
  emoji: string;
  count: number;
  /** The viewer is among them. */
  mine: boolean;
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
  /** The messages in its chat. A thread is a group of its own and does not count. */
  comment_count: number;
  /** In the order each emoji was first used. */
  reactions: PotokReaction[];
  /** Whether `toggleGroupReaction` works for this viewer: not only for members of a public group. */
  can_react: boolean;
};

/** A direct sub-group of the app's group, with what it takes to edit it. */
export type PotokChild = PotokSubgroup & {
  /** The source: null when the viewer cannot edit the group, and for an app. */
  description: string | null;
  description_format: PotokContentFormat;
  can_edit: boolean;
  member_count: number;
  updated_at: string;
  /** The app's own key, given by `createChildren`; null for a group made otherwise. */
  key: string | null;
  /** Where its pin stands on a map; null for a group without a place. */
  lat: number | null;
  lng: number | null;
  /** A key of `pins.icons` or "picture"; null for its kind's. */
  pin: string | null;
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
  /**
   * Where its pin stands on a map (`listPlaces`), rounded to 6 decimals: both
   * or neither. Both null take the place away (`updateChild`).
   */
  lat?: number | null;
  lng?: number | null;
  /** A key of `pins.icons` (`getMapConfig`) or "picture"; null for its kind's. */
  pin?: string | null;
};

/** A sub-group `createChildren` makes. */
export type PotokNewChild = Omit<PotokChildAttrs, "picture" | "lat" | "lng" | "pin"> & {
  name: string;
  lat?: number;
  lng?: number;
  pin?: string;
  /**
   * The app's own name for it, 1 to 64 characters without control characters,
   * unique under this group and set once: a group whose key is there already
   * is not made again. Groups with a key are records: their own map shows
   * them, the root's map and the place picker of events do not.
   */
  key?: string;
};

/** What `createChildren` did with one child, in the order they were sent. */
export type PotokCreatedChild = {
  id: number;
  key: string | null;
  /** false: a group with this key was there already, and `id` is that one. */
  created: boolean;
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
  /** `openPollForm` works for this viewer. */
  can_start_polls: boolean;
};

export type PotokGroupTab = "chat" | "description" | "settings";

/** One path of a pin's glyph (24 x 24 Heroicons, solid). */
export type PotokPinPath = { d: string; evenodd: boolean };

/** How a kind of group or a chosen icon looks on a map. */
export type PotokPinLook = {
  key: string;
  /** Its name in the viewer's language. */
  title: string;
  /** A key of `tones`. */
  tone: string;
  paths: PotokPinPath[];
  /**
   * A kind's small glyph (Heroicons 16 solid), which a pin the group picked
   * keeps in its top right corner, as on the group's avatar; null for "none".
   * Icons have none.
   */
  mark?: PotokPinPath[] | null;
};

/** What a map needs before its first pin (`getMapConfig`). */
export type PotokMapConfig = {
  /** Tiles come through Potok: `url` has `{z}`, `{x}` and `{y}`; `attribution` is HTML to show. */
  tiles: { url: string; attribution: string; max_zoom: number };
  /** `[[south, west], [north, east]]`: where a map opens until its editors save a view. */
  default_bounds: [[number, number], [number, number]];
  pins: {
    /** The drop on a 32 x 40 box, as an SVG path, its point at (16, 39). */
    drop: string;
    /** Where the glyph goes in the drop, as an SVG transform. */
    glyph_transform: string;
    /** Where a kind's `mark` goes, in a white disc of radius 5.5 around (26.5, 6.5), as an SVG transform. Potok always sends it. */
    mark_transform?: string;
    /** The colour of each tone, as `#rrggbb`; a white glyph reads on every one. */
    tones: Record<string, string>;
    /** What a group shows by its kind: its preset, "app" or "none". */
    kinds: PotokPinLook[];
    /** What a group can pick instead, in the order of its settings. */
    icons: PotokPinLook[];
  };
  /** The kinds `createPlace` takes, in the order of Potok's "Create sub-group" menu. */
  place_kinds: { key: string; title: string }[];
  /** `createPlace` works for this viewer: a member who may make sub-groups here. */
  can_create_places: boolean;
  /** The viewer may edit this group, so may save the map's view in its config. */
  can_edit_view: boolean;
};

/** A sub-group right under the app's group that has a place on a map. */
export type PotokPlace = {
  id: number;
  name: string;
  /** Where its pin stands; for an area, a point inside it; for a route, its start. */
  lat: number;
  lng: number;
  /** A key of `pins.kinds`. */
  kind: string;
  /** A key of `pins.icons`, "picture" for the group's picture, null for its kind's. */
  pin: string | null;
  picture_url: string | null;
  is_public: boolean;
  /**
   * "area" for a group that covers an area, "route" for one that runs along a
   * line, such as a walk or a bike path (their shapes come from `placeShapes`).
   */
  shape: 'point' | 'area' | 'route';
  /**
   * The areas among the map's places that hold this one, smallest first: its
   * pin lies inside them, and for an area they are the bigger ones; a route
   * lies in every area it passes through.
   */
  areas: number[];
  /** An area's or a route's box: [west, south, east, north]. */
  bbox?: [number, number, number, number];
  /** Changes with an area's border or a route's line: what to keep its shapes by. */
  v?: number;
  /** A route's length, in metres along the Earth's surface. */
  length?: number;
};

/**
 * The shape of an area or a route, simplified for one level of detail
 * (`placeShapes`): a border for an area, a line for a route.
 */
export type PotokPlaceShape = {
  id: number;
  /** The `v` of its place. */
  v: number;
  geojson:
    | { type: 'MultiPolygon'; coordinates: [number, number][][][] }
    | { type: 'MultiLineString'; coordinates: [number, number][][] };
};

/** `[[south, west], [north, east]]`, as Leaflet takes bounds. */
export type PotokBounds = [[number, number], [number, number]];

/** What part of a map `listPlaces` reads, and which of its places. */
export type PotokPlacesQuery = {
  /** The view's box: [west, south, east, north]. */
  bbox: [number, number, number, number];
  /** The map's zoom, 0 to 24. */
  zoom: number;
  /** Only places with this in their name (case, accents and script do not count). Big maps only. */
  search?: string;
  /** Only places that show one of these: keys of `pins.icons` and "kind" for those that show their kind. Big maps only. */
  pins?: string[];
  /** Also `extent`: how many places the filters keep and the box around them. */
  extent?: boolean;
  /** Also `pins` in the reply: how many of the map's places show each pin, whatever the filters. */
  counts?: boolean;
};

/** Places a big map's view holds too close together to draw one by one. */
export type PotokPlaceCluster = {
  count: number;
  /** Their average position. */
  lat: number;
  lng: number;
  /** The box around them. */
  bounds: PotokBounds;
  /** How many of them have each tone (keys of `pins.tones`); tones with none are left out. */
  tones: Record<string, number>;
};

/** How many places show a pin: a key of `pins.icons`, "picture", or "kind". */
export type PotokPinCount = { pin: string; count: number };

/**
 * `listPlaces(view)` on a map of up to 2000 places: all of them, as without a
 * view, filtered and gathered by the app. `search`, `pins`, `extent` and
 * `counts` are ignored: the app works them out from `places`.
 */
export type PotokPlacesAll = {
  ok: true;
  /** Absent from a Potok older than views. */
  mode?: "all";
  places: PotokPlace[];
  truncated: boolean;
};

/**
 * `listPlaces(view)` on a bigger map: Potok gathers the places in the view
 * into cells of about 64 pixels; a cell with one place gives that place, the
 * others a cluster.
 */
export type PotokPlacesView = {
  ok: true;
  mode: "view";
  /** The places alone in their cells. */
  places: PotokPlace[];
  clusters: PotokPlaceCluster[];
  /** The places the filters keep in the view. */
  total: number;
  /** The view had more cells than a reply takes (2000). */
  truncated: boolean;
  /** With `extent`; `bounds` null when the filters keep none. */
  extent?: { count: number; bounds: PotokBounds | null };
  /** With `counts`, the most shown first. */
  pins?: PotokPinCount[];
};

/** A new place: a sub-group from a preset, as Potok's menu makes it, standing at `lat`, `lng`. */
export type PotokPlaceAttrs = {
  name: string;
  /** A key of `place_kinds`. */
  kind: string;
  lat: number;
  lng: number;
  /** Left out, the preset's default under this group. */
  isPublic?: boolean;
  /** A key of `pins.icons` or "picture"; left out, the kind's. */
  pin?: string;
};

export type PotokSubgroupListOptions = {
  /** Page size, at most 50 (the server's default is 20). */
  limit?: number;
  /** The id of the last group of the previous page. */
  beforeId?: number;
  /** Only groups published at this moment or later: ISO 8601 with a zone. Send it with every page. */
  from?: string;
  /** Only groups published before this moment: ISO 8601 with a zone. Send it with every page. */
  to?: string;
  /**
   * The groups around this one instead of the first page, however far down it
   * lies: up to `limit` on each side. Look for its id in the reply, as a group
   * the list does not hold gives the first page.
   */
  aroundId?: number;
};

/** A part of a list of sub-groups, newest first. */
export type PotokSubgroupPage = {
  ok: true;
  groups: PotokSubgroup[];
  /** There are older groups below these. */
  has_more: boolean;
  /** There are newer groups above these. Only `aroundId` can say so. */
  has_newer: boolean;
};

/** An answer of a poll. `votes_count` is null while the poll's rules keep it from this viewer. */
export type PotokPollOption = {
  id: number;
  text: string;
  votes_count: number | null;
  /** The viewer's ballot holds it. Always false in a secret poll, which keeps no answers. */
  mine: boolean;
};

/** A poll of the app's group, as far as its rules show it to this viewer; times are ISO 8601. */
export type PotokPoll = {
  id: number;
  question: string;
  /** Markdown. */
  description: string;
  kind: "single" | "multiple";
  /** For `multiple`: at most this many answers; null for no limit. */
  max_choices: number | null;
  closes_at: string | null;
  closed_at: string | null;
  open: boolean;
  /** Nobody can see who voted for what, and no counts show before the end. */
  secret: boolean;
  /** Signed-in non-members vote too. */
  public: boolean;
  /** `openPoll` lets the viewer vote now, or change their vote. */
  can_vote: boolean;
  voted: boolean;
  can_see_results: boolean;
  can_see_details: boolean;
  /** They may end, change or delete it, on Potok's own page. */
  can_manage: boolean;
  voters_count: number;
  /** What was decided, once the rules show it. */
  outcome: "passed" | "failed" | "no_quorum" | "tie" | null;
  winner_option_id: number | null;
  options: PotokPollOption[];
};

export type PotokPollListOptions = {
  /** "waiting" holds those the viewer can still vote in, without paging. */
  status?: "open" | "closed" | "waiting";
  /** The id of the last poll of the previous page. */
  beforeId?: number;
};

/** `window.potok`. Calls reject if the page does not answer within 10s. */
export type PotokSdk = {
  /** Into a collection, as its rule allows. */
  insertValue<T extends object = PotokData>(
    data: T | string,
    options: { collection: string },
  ): Promise<{ ok: true; value: PotokCollectionValue<T> } | PotokError>;
  insertValue<T extends object = PotokData>(
    data: T | string,
    options?: { contentFormat?: PotokContentFormat },
  ): Promise<{ ok: true; value: PotokValue<T> } | PotokError>;
  /** A collection: every value for its readers, otherwise the viewer's own. */
  listValues<T extends object = PotokData>(
    options: PotokCollectionListOptions,
  ): Promise<
    { ok: true; values: PotokCollectionValue<T>[]; has_more: boolean; total: number | null } | PotokError
  >;
  listValues<T extends object = PotokData>(
    options?: PotokListOptions,
  ): Promise<
    { ok: true; values: PotokListedValue<T>[]; has_more: boolean; total: number | null } | PotokError
  >;
  /** Sums in the database over what `listValues` would page through; 120 a minute with `summarizeValues`. */
  aggregateValues(options?: PotokAggregateOptions): Promise<({ ok: true } & PotokAggregate) | PotokError>;
  /** The config and, per ruled collection, what the viewer may do there. */
  getConfig(): Promise<PotokConfigReply | PotokError>;
  /** For editors. Pass the revision you started from (0 for the first save). */
  saveConfig(
    data: PotokConfigData,
    options: { revision: number },
  ): Promise<{ ok: true; config: PotokConfig } | PotokError>;
  /** The viewer's own value, where the rule lets authors change theirs. */
  updateValue<T extends object = PotokData>(
    id: number,
    data: T | string,
    options?: { revision?: number },
  ): Promise<{ ok: true; value: PotokCollectionValue<T> } | PotokError>;
  /** For editors: one value of a collection, with its files. */
  deleteValue(id: number): Promise<{ ok: true; id: number } | PotokError>;
  /** For editors: a whole collection, with its files. */
  deleteValues(collection: string): Promise<{ ok: true; count: number } | PotokError>;
  /** Counts over the answers under `under`, for `keys`; `score` adds a quiz's numbers. */
  summarizeValues(
    collection: string,
    options?: { under?: string[]; keys?: string[]; score?: boolean },
  ): Promise<{ ok: true; summary: PotokSummary } | PotokError>;
  /** An editor's points and words; `points: null` gives the answer back to the key. */
  gradeValue(
    id: number,
    items: Record<string, { points?: number | null; feedback?: string }>,
  ): Promise<{ ok: true; value: PotokCollectionValue } | PotokError>;
  listRoles(): Promise<{ ok: true; roles: PotokRole[] } | PotokError>;
  /** The viewer's push for each new value of the collection. */
  setNotifications(collection: string, on: boolean): Promise<{ ok: true; on: boolean } | PotokError>;
  /** For editors: makes the app's "Files" and "Private files" groups if missing. */
  ensureFileGroups(): Promise<{ ok: true; files: { public?: number; private?: number } } | PotokError>;
  /** An address the frame can show a file by, for ten minutes. */
  fileUrl(
    id: number,
  ): Promise<{ ok: true; url: string; name: string; type: string; size: number } | PotokError>;
  /** Sends a file for `slot` of `collection`; waits for as long as the upload takes. */
  uploadFile(
    file: File | Blob,
    options: { collection: string; slot: string; onProgress?: (percent: number) => void },
  ): Promise<{ ok: true; file: PotokUploadedFile } | PotokError>;
  /** For editors: a picture of the app itself, with an address in `file.url`. */
  uploadImage(
    file: File | Blob,
    options?: { onProgress?: (percent: number) => void },
  ): Promise<{ ok: true; file: PotokUploadedFile } | PotokError>;
  /** Changes in the app's collections the viewer may see; returns a remover. */
  onValues<T extends object = PotokData>(
    listener: (change: PotokValueChange<T>) => void,
    options?: { collection?: string },
  ): () => void;
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
  ): Promise<PotokSubgroupPage | PotokError>;
  /**
   * Takes the viewer to this group's parent, a direct sub-group or a group
   * `listSubgroups` can return: to its chat, with `tab: "description"` to its
   * description, where a group that is an app runs, or with `tab: "settings"` to
   * its settings. The app ends with the page.
   */
  openGroup(id: number, options?: { tab?: PotokGroupTab }): Promise<{ ok: true } | PotokError>;
  /**
   * Adds the viewer's reaction to a group below this one, or takes it back, as
   * a click on a reaction does. Counts as a write for the rate limit.
   */
  toggleGroupReaction(id: number, emoji: string): Promise<{ ok: true; reactions: PotokReaction[] } | PotokError>;
  /** Lets the viewer choose any emoji in Potok's own picker; waits for as long as they take. */
  pickEmoji(): Promise<{ ok: true; emoji: string } | PotokError>;
  /**
   * Opens the page's way of sharing with the link of a group `openGroup` can
   * reach. A frame has neither Web Share nor the clipboard. With `inApp` the link
   * is to this app open on that group, which must lie below it.
   */
  shareGroup(id: number, options?: { inApp?: boolean }): Promise<{ ok: true } | PotokError>;
  /**
   * Puts a group in the page's address, with no new history entry, so that the
   * address opens this app on it. The app finds it again with `getLinkedGroup`.
   */
  linkGroup(id: number): Promise<{ ok: true } | PotokError>;
  /** The group in the page's address. Nothing checks it: `aroundId` does. */
  getLinkedGroup(): Promise<{ ok: true; group_id: number | null } | PotokError>;
  getGroup(): Promise<{ ok: true; group: PotokOwnGroup } | PotokError>;
  /**
   * The direct sub-groups, in the order of `listSubgroups`. This and the calls
   * below act in the viewer's name, so they need `can_manage_children`.
   */
  listChildren(
    options?: PotokSubgroupListOptions,
  ): Promise<PotokSubgroupPage | PotokError>;
  getChild(id: number): Promise<{ ok: true; group: PotokChild } | PotokError>;
  /** Needs `can_create_children`. Without `isPublic` or `inheritsMembers` only the viewer sees the group. */
  createChild(attrs: PotokChildAttrs & { name: string }): Promise<{ ok: true; group: PotokChild } | PotokError>;
  /**
   * Makes up to 100 sub-groups at once, all or none (`invalid_group` with the
   * `index` of the one that failed), for one write of the rate limit. A child
   * whose `key` is there already is not made again (`created: false`), so a
   * call that timed out can be sent again as it was. Needs `can_create_children`.
   * Open pages hear of the whole call once, and the viewer's unread counts
   * do not follow the new groups.
   */
  createChildren(
    children: PotokNewChild[],
    options?: { onExisting?: "skip" },
  ): Promise<{ ok: true; groups: PotokCreatedChild[] } | PotokError>;
  /** A closed group that opens up moves to the top of the order. */
  updateChild(id: number, attrs: PotokChildAttrs): Promise<{ ok: true; group: PotokChild } | PotokError>;
  /** Closes the group again, and its inherited members leave. Direct members and the viewer stay. */
  withdrawChild(id: number): Promise<{ ok: true; group: PotokChild } | PotokError>;
  /** The text as a feed will show it, sanitized on the server; counts as a write for the rate limit. */
  previewDescription(
    description: string,
    options?: { descriptionFormat?: PotokContentFormat },
  ): Promise<{ ok: true; html: string | null } | PotokError>;
  /** The polls of this group, the newest first, 30 per call. */
  listPolls(
    options?: PotokPollListOptions,
  ): Promise<{ ok: true; polls: PotokPoll[]; has_more: boolean } | PotokError>;
  getPoll(id: number): Promise<{ ok: true; poll: PotokPoll } | PotokError>;
  /**
   * Opens the poll in a dialog of Potok's, over the app, where the viewer votes.
   * An app cannot vote or change a poll itself: it runs for every viewer, and a
   * vote can be final.
   */
  openPoll(id: number): Promise<{ ok: true } | PotokError>;
  /** Opens Potok's form for a new poll in this group; needs `can_start_polls`. */
  openPollForm(): Promise<{ ok: true } | PotokError>;
  /**
   * Gets the id of a poll that changed, got a vote or was deleted, a few at a
   * time. Read it again with `getPoll`; a deleted one is `not_found`. Returns a
   * function that removes the listener.
   */
  onPollChange(listener: (id: number) => void): () => void;
  /**
   * Gets every new value of this app, also the viewer's own; with
   * `{scope: "group"}` also those of the group's other apps. Returns a
   * function that removes the listener.
   */
  onNewValue<T extends object = PotokData>(
    listener: (value: PotokValue<T>) => void,
    options?: { scope?: "group" },
  ): () => void;
  /** How a map is drawn: tiles, where it opens, every pin, and what the viewer may do on it. */
  getMapConfig(): Promise<({ ok: true } & PotokMapConfig) | PotokError>;
  /** The sub-groups right under this group that the viewer sees and that have a place, up to 2000. */
  listPlaces(): Promise<{ ok: true; places: PotokPlace[]; truncated: boolean } | PotokError>;
  /**
   * With a view: all the places of a map of up to 2000 (`mode: "all"`), or
   * what a bigger map shows in the view, gathered by Potok (`mode: "view"`).
   * Ask again when the view moves; a view slower than 4 seconds is `timeout`.
   */
  listPlaces(view: PotokPlacesQuery): Promise<PotokPlacesAll | PotokPlacesView | PotokError>;
  /**
   * The places whose pins stand inside `bounds`, edges included, by name, at
   * most 50: what a cluster holds that the map cannot spread any further.
   */
  listPlacesAt(
    bounds: PotokBounds,
    options?: { search?: string; pins?: string[] },
  ): Promise<{ ok: true; places: PotokPlace[]; has_more: boolean } | PotokError>;
  /**
   * The borders of areas and the lines of routes among `listPlaces` (at most
   * 100 ids), simplified for `zoom`; `level` is the zoom they were simplified
   * for (6, 8, 10, 12, 14 or 16). Keep them by `id`, `v` and `level`.
   */
  placeShapes(
    ids: number[],
    zoom: number,
  ): Promise<{ ok: true; level: number; shapes: PotokPlaceShape[] } | PotokError>;
  /** Makes a sub-group where the viewer tapped; needs `can_create_places`. */
  createPlace(attrs: PotokPlaceAttrs): Promise<{ ok: true; place: PotokPlace } | PotokError>;
  /**
   * Opens a sub-group's description on Potok's page, over the app, with a link
   * to the group. Its own app, a form or a poll, runs there with that group's
   * rights. Only for a sub-group right under this group.
   */
  showGroup(id: number): Promise<{ ok: true } | PotokError>;
  /** Gets the id of the group whose description the viewer closed. Returns a function that removes the listener. */
  onGroupSheetClose(listener: (id: number) => void): () => void;
  /**
   * Called when a sub-group of this group was made, changed or deleted, with
   * no more said: read again what the app shows. Returns a function that
   * removes the listener.
   */
  onSubgroupsChange(listener: () => void): () => void;
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
