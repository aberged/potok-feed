import './dev-theme.css';
import { FEED_GROUP } from './feed';
import type { PotokSubgroup } from './potok';

// Dev only (main.ts imports it in its DEV block). Fills what potok-dev.ts
// reads for `listSubgroups` (localStorage `potok-dev:subgroups`):
// - `?seed`: 45 stories, with a long one, an app that says what it is and one
//   without a description;
// - `?seed=empty`: a `.feed` with no stories;
// - `?seed=none`: no `.feed`.
//
// Without `?seed` the store stays as it is. `?seed` runs on every load, so
// each URL always shows the same feed.

const SUBGROUPS_STORAGE_KEY = 'potok-dev:subgroups';

const paragraph =
  'Reka nosi sve što joj se da, a grupa pamti ono što joj članovi ostave. Svaka vest je jedna grupa, sa svojim opisom i svojim razgovorom.';

const picture = (id: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="hsl(${(id * 47) % 360} 60% 55%)"/></svg>`,
  )}`;

function story(id: number): PotokSubgroup {
  const shared = {
    id,
    app_description: null,
    uses_api: false,
    picture_url: picture(id),
    inserted_at: '2026-11-05T08:00:00Z',
    last_value_at: null,
  };

  if (id === 44) return { ...shared, name: 'Vest bez opisa', description_html: null };
  if (id === 43) {
    return {
      ...shared,
      name: 'Vest koja je aplikacija',
      description_html: null,
      app_description: 'Mala igra za dvoje, koja se pokreće na strani ove grupe.',
      uses_api: true,
    };
  }

  if (id === 45) {
    return {
      ...shared,
      name: 'Dugačka vest',
      description_html: `<h1>Dugačka vest</h1>${`<p>${paragraph}</p>`.repeat(30)}`,
    };
  }

  return {
    ...shared,
    name: `Vest ${id}`,
    description_html: `<h1>Vest ${id}</h1><p>${paragraph}</p><ul><li>prva stavka</li><li>druga stavka</li></ul><p><a href="https://example.com">Više o tome</a></p>`,
  };
}

export function seedDevFeed() {
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed === null) return;

  if (seed === 'none') {
    localStorage.removeItem(SUBGROUPS_STORAGE_KEY);
    return;
  }

  const stories = seed === 'empty' ? [] : Array.from({ length: 45 }, (_, index) => story(index + 1));
  localStorage.setItem(SUBGROUPS_STORAGE_KEY, JSON.stringify({ [FEED_GROUP]: stories }));
}
