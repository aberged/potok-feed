# potok-feed

Potok aplikacija koja simulira news-feed. Jedna grupa je jedna vest, a njen opis je tekst vesti. Svajpom se ide redom kroz vesti. Dole su datum objave, reakcije, deljenje i dugme **Komentari**, koje vodi u razgovor o vesti. Dugme sa datumom otvara filter po datumu. Vest može da bude i aplikacija, koju pokreće dugme **Otvori**.

Napravljena je po šablonu [potok-vite](https://github.com/aberged/potok-vite/tree/align-alt-descriptions). Aplikacija je jedan fajl, `dist/potok-build.html`, koji se nalepi kao opis grupe sa uključenim „Koristi API“.

Traži `listSubgroups`, `openGroup`, `toggleGroupReaction`, `pickEmoji`, `shareGroup`, `linkGroup` i `getLinkedGroup` iz App API-ja, pa radi tek uz verziju potok-a koja ih ima.

Radi u paru sa aplikacijom [FeedCreator](https://github.com/aberged/potok-feed-creator), koja stoji u `.feed` i pravi vesti. Taj par je opisan u `docs/feed-i-feedcreator.md` u projektu potok-ide.

## Postavljanje u potok-u

```
Vesti              grupa sa aplikacijom
└── .feed          podgrupa koju aplikacija čita
    ├── Prva vest      opis ove grupe je tekst vesti
    └── Druga vest
```

1. Pokreni `npm run build`.
2. U grupi otvori **Izmeni grupu**, uključi **Koristi API** i u **Opis** nalepi ceo `dist/potok-build.html`.
3. U toj grupi napravi podgrupu `.feed`.
4. Svaka vest je podgrupa u `.feed`, a tekst vesti je njen opis, u markdownu ili HTML-u. Vesti pravi FeedCreator, a mogu i ručno.
5. Na `.feed` i na vestima uključi nasleđivanje članova, da članovi grupe sa aplikacijom odmah uđu u chat. Bez toga gledalac koji nije član vesti umesto chata vidi opis i dugme za pristup, jer chat vide samo članovi.
6. Ako je grupa sa aplikacijom javna, i `.feed` mora biti javna. Inače nečlan dobija poruku da `.feed` ne postoji.
7. U `.feed` napravi sopstveni manifest i isključi „Kreiranje podgrupa“ za sve članove. Bez toga svaki član može ručno da napravi javnu grupu u `.feed`, i ona odmah ulazi u feed. Vesti koriste taj manifest same od sebe.

Tačka u imenu `.feed` nema posebno značenje za potok, pa se ta grupa vidi u listi podgrupa kao svaka druga. Ime je u konstanti `FEED_GROUP` u [src/feed.ts](src/feed.ts).

## Kako radi

- Vesti idu od najnovije. Grupa koja je bila zatvorena (privatna, bez nasleđivanja) računa se od trenutka kad se otvorila, pa nacrt izlazi na vrh kad se objavi. Svajp nagore vodi na stariju vest, a svajp nadole na noviju. Na računaru isto rade točkić i strelice.
- Svajp je nativni CSS scroll-snap ([src/style.css](src/style.css)), bez koda za dodir, i pomera tačno jednu vest.
- Dugačak opis se skroluje unutar kartice, a na kraju teksta sledeći svajp prelazi na sledeću vest.
- Vesti se učitavaju u stranama od 20. Sledeća strana stiže kad do kraja ostane 5 vesti.
- Gledalac vidi samo vesti koje vidi i u potok-u: privatnu vest vidi samo njen član. Zato autor među vestima vidi i svoj nacrt, sa oznakom **Nacrt**.
- Komentari otvaraju razgovor u istoj aplikaciji. Povratak nazad vraća na istu vest, sa istim filterom po datumu. Svako drugo otvaranje kreće od najnovije, bez filtera.
- Adresa strane prati vest na ekranu (`?at=<id vesti>`), pa link otvara Feed baš na toj vesti, a dugme za deljenje deli upravo takav link.
- Opis stiže prečišćen sa servera. Vest bez opisa prikazuje samo ime i dugme Komentari.
- Vest koja je sama aplikacija prikazuje ime i ono što aplikacija kaže o sebi u `<meta name="description">`. Dugme **Otvori** vodi na stranu te grupe, gde aplikacija radi punim funkcijama, a povratak nazad vraća na istu vest. U samoj kartici se ne pokreće: API je vezan za grupu na ekranu, Feed bi stajao između nje i potok-a, a dodir u aplikaciji bi se sudarao sa svajpom.
- Aplikacija samo čita. Ne pravi data vrednosti, a vesti se dodaju pravljenjem podgrupa u `.feed`.

## Komande

```sh
npm install
npm run dev      # dev mock potok API-ja na portu 5174
npm test         # vitest testovi za src/feed.ts
npm run build    # tsc + vite build → dist/potok-build.html
```

U dev-u primer podataka zadaje `?seed` u URL-u:

| URL | Šta prikazuje |
|---|---|
| `/?seed` | 45 vesti, među njima dugačka, aplikacija, nacrt i vest bez opisa |
| `/?seed=empty` | `.feed` bez vesti |
| `/?seed=none` | grupu bez `.feed` |

## Struktura

| Fajl | Šta je |
|---|---|
| [src/feed.ts](src/feed.ts) | stanje: strane, učitavanje unapred, povratak iz chata |
| [src/ui.ts](src/ui.ts) | lit-html prikaz, strelice, praćenje tekuće vesti |
| [src/style.css](src/style.css) | Tailwind, daisyUI sa prefiksom `d-`, scroll-snap |
| [src/main.ts](src/main.ts) | pokretanje |
| [src/dev-tools.ts](src/dev-tools.ts), [src/dev-theme.css](src/dev-theme.css) | samo za dev: primer vesti i zamena za temu stranice |

`src/potok.ts`, `src/potok-dev.ts`, `vite.config.ts` i `tsconfig.json` su iz šablona, bez izmena.

## Licenca

MIT, vidi [LICENSE](LICENSE).

Build nosi i licence koda koji pakuje: pun tekst licence lit-html-a (BSD-3-Clause) na vrhu skripte, a u CSS-u napomene Tailwind CSS-a i daisyUI-ja (MIT).
