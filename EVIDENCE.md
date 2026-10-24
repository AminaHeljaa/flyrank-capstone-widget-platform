# Evidence of Completed Work

## Implementirane funkcionalnosti

- `GET /health` i javni demo obrazac ostaju dostupni.
- Registracija, prijava i odjava koriste postojeće API rute.
- Dashboard vlasnika je dostupan na `/dashboard.html` i iz demo stranice.
- Dashboard prikazuje ukupan broj vlastitih widgeta i prijava, najviše 100
  najnovijih prijava po prikazu, te omogućava filtriranje po widgetu.
- Vlasnik može kreirati widget, pregledati javni ključ i kopirati kod za
  ugradnju. Ugrađeni obrazac šalje prijave API serveru koji je poslužio
  versioned `widget/v1.js`.
- Vlasnički API koristi korisnika iz sesije. Dashboard ne prihvata `ownerId`
  kao izvor identiteta; tuđi widget za filter vraća `404`.
- Postojeći demo widget i prijave pripadaju sistemskom vlasniku bez lozinke i
  nisu vidljivi korisničkim dashboardima.
- `public/widget/v1.js` pruža versioned, single-script embed bez `eval` i bez
  dinamičkog izvršavanja HTML stringova. Skripta dohvaća samo javnu konfiguraciju
  i prikazuje obrazac iz DOM elemenata.
- `GET /api/widgets/:publicKey` vraća samo naziv, javni ključ i polja obrasca.
  Konfiguracija ima 30-sekundni cache; `/widget/v1.js` koristi immutable
  jednogodišnji cache.
- CORS je ograničen na javne widget konfiguracijske i submission rute i
  `WIDGET_ALLOWED_ORIGINS`; OPTIONS preflight nije otvoren na autentifikovanim
  rutama.
- `public/embed-demo.html` pokazuje script tag koji se može testirati na
  drugom originu. Početna demo stranica i dashboard koriste isti versioned embed.

## Testna pokrivenost

- `test/health.test.js`: health endpoint.
- `test/auth.test.js`: registracija, prijava/odjava, CRUD, izolacija, prijave i
  kompatibilnost javnog demo obrasca.
- `test/migration.test.js`: očuvanje widgeta i prijava pri migraciji.
- `test/dashboard.test.js`: neautorizovan pristup, odbijanje klijentskog
  `owner_id`, dashboard podaci između dva korisnika, filter po widgetu i
  privatnost sistemskog demo widgeta.
- `test/widget-embed.test.js`: konfiguracija, cache headers, script cache,
  CORS/OPTIONS allowlist, submission validacija/honeypot i pristup vlasničkim
  statistikama/prijavama bez sesije.
- `test/submission-protection.test.js`: validne i neispravne prijave, neispravan
  JSON, payload veći od 10 KB, neutralan honeypot odgovor bez upisa, `429`
  rate-limit JSON i očuvanje CORS/autorizacije.
- `test/geolocation.test.js`: uspjeh primarnog providera, fallback, timeout,
  neispravan JSON/koordinate, preskakanje privatnih/rezervisanih IP adresa i
  enqueue bez čekanja na providere, očuvanje prijave pri enqueue grešci.
- `test/background-jobs.test.js`: uspješan posao, retry s eksponencijalnim
  čekanjem, konačni neuspjeh i sanitizovano upozorenje, oporavak isteklog
  processing lease-a i sprečavanje duple obrade dva workera.
- `test/dashboard.test.js`: statusi background poslova su ograničeni na
  prijave widgeta trenutnog vlasnika i poštuju widget filter.
- `test/migration.test.js`: uz postojeće widgete i prijave provjerava migraciju
  novih nullable geo kolona i background jobs tabele bez gubitka postojećih
  podataka.

Javni API endpoint odbija neispravno tijelo sa JSON `400`, payload veći od
10 KB sa JSON `413`, a prekoračenje limita sa JSON `429`. Honeypot odgovor ne
otkriva razlog odbijanja; widget prikazuje razumljivu poruku i sprečava
istovremeno višestruko slanje.

Svi testovi koriste privremene SQLite baze. Projektna baza nije korištena za
testne zapise.

## Provjera

Za ponavljanje provjere:

```sh
npm test
```

Završna provjera validacije/rate-limit faze: `npm test` — 13 testova,
13 prolaznih, 0 neuspješnih. `node --check` prošao je za sve izmijenjene
JavaScript fajlove.

Geolokacijska faza: `npm test` — 19 prolaznih, 0 neuspješnih;
`node --check` za `src/app.js`, `src/db.js`,
`src/services/geolocation.js`, `test/geolocation.test.js` i
`test/migration.test.js` — sve sintaksne provjere prošle. Testovi mockiraju
HTTP; nije potreban pristup internetu. `git status` nije dostupan jer workspace
nema `.git` direktorij. Provjera veličine i vremena izmjene projektne baze
potvrdila je da testovi nisu pisali u nju.

Background jobs faza: kompletni `npm test` — 25 prolaznih, 0 neuspješnih.
`node --check` je prošao za sve izmijenjene JS fajlove, uključujući queue,
worker, API, dashboard skriptu i testove. Testovi koriste mockirane providere i
privremene baze. `git status` nije moguć jer workspace nema `.git`. Postojeća
projektna SQLite baza nije korištena u testovima.

Browser smoke test: otvoren je `http://localhost:5500/embed-demo.html` dok je
API radio na `http://localhost:3000` s dozvoljenim origin-om `localhost:5500`.
Vanjska stranica učitala je konfiguraciju `demo-widget`, a slanje prijave
prikazalo je poruku „Prijava je uspješno zaprimljena.”

Za ručnu provjeru `npm start`, postavite allowlistu
`WIDGET_ALLOWED_ORIGINS=http://localhost:5500`, pa poslužite `public/` preko VS
Code Live Server na portu 5500. Otvorite
`http://localhost:5500/embed-demo.html`; konfiguracija i submission poziv idu
preko CORS-a na FlyRank server. `/` i `/dashboard.html` ostaju dostupni.
