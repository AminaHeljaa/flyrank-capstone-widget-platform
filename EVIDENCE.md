# Evidence of Completed Work

## Trenutni dokazni plan prema capstone PDF-u

Ova lista razlikuje automatizovane dokaze od ručne provjere. Screenshotovi
ispod su preporučeni; nijedan screenshot nije spremljen u repozitorij u okviru
ovog rada.

| Zahtjev | Koraci i očekivani rezultat | Automatizovani dokaz | Screenshot |
| --- | --- | --- | --- |
| Registracija i prijava | Otvoriti `/dashboard.html`, registrovati novi email s lozinkom od najmanje 12 znakova, odjaviti se i prijaviti. Dashboard se otvara; neispravna prijava vraća jasnu grešku. | `test/auth.test.js` | Forma prijave i dashboard nakon prijave; bez prikaza lozinke. |
| Tenant izolacija | Napraviti dva naloga i widget/prijavu za svaki. Prijavljeni vlasnik vidi samo svoje podatke; pristup tuđem widgetu/prijavama vraća `404`. | `test/auth.test.js`, `test/dashboard.test.js` | Dva odvojena browser profila s različitim widgetima/prijavama. |
| Widget CRUD i postavke | U dashboardu Create Widget, izmijeniti naslov/boju/polja/poruku uspjeha, osvježiti stranicu, testirati pregled i brisanje uz potvrdu. Postavke ostaju sačuvane. | `test/dashboard.test.js`, `test/migration.test.js` | Forma s previewem, sačuvani widget i embed kod. |
| Embed na drugom originu | Dozvoliti tačan origin u `WIDGET_ALLOWED_ORIGINS`, poslužiti `public/` na portu 5500 i otvoriti `/embed-demo.html`. Network tab treba prikazati učitavanje konfiguracije i prijavu na API originu. | `test/widget-embed.test.js` (konfiguracija, CORS i OPTIONS); raniji browser smoke test je zabilježen u nastavku | Widget prikazan na drugom originu i uspješno poslata probna prijava; Network tab bez tajni. |
| Prijava i dashboard | Poslati validnu prijavu kroz embed; API vraća `201`, prijava se trajno sačuva i pojavi samo u dashboardu vlasnika odgovarajućeg widgeta. | `test/widget-embed.test.js`, `test/dashboard.test.js`, `test/geolocation.test.js` | Uspješan embed odgovor i ista prijava u dashboardu. |
| Validacija i veličina tijela | Poslati neispravan email/ime, nepoznato polje, neispravan JSON i zahtjev veći od 10 KB. Očekuju se strukturirani `400` ili `413`; nema lažnog uspjeha. | `test/submission-protection.test.js`, `test/widget-embed.test.js` | JSON odgovori iz Network taba, bez privatnih podataka. |
| CORS i preflight | Pozvati `OPTIONS` s dozvoljenog i nedozvoljenog Origin-a. Dozvoljeni javni endpoint vraća `204` i odgovarajuće CORS zaglavlje; privatne/auth rute nemaju CORS dozvolu. | `test/widget-embed.test.js`, `test/submission-protection.test.js` | Preflight response headers za dozvoljeni origin. |
| Rate limit i honeypot | Preći konfigurirani limit slanja; očekuje se JSON `429`. Poslati popunjen `website` honeypot; odgovor je neutralan, ali se prijava ne upisuje. | `test/submission-protection.test.js` | `429` odgovor; za honeypot dokaz je broj zapisa prije/poslije, ne sadržaj osjetljivog zahtjeva. |
| Geolokacija A → B | Bez interneta se testira mockom: A uspije → B se ne zove; A ne uspije/timeout/neispravan rezultat → B se poziva; privatne IP adrese preskaču oba. | `test/geolocation.test.js` | Nije potreban screenshot; testovi mockiraju oba HTTP providera. |
| Background retry i konačni neuspjeh | Testirati eksponencijalni raspored, obradu nakon restarta, konkurentne workere i završni `failed`/sigurno upozorenje. Prijava ostaje sačuvana i na konačnom neuspjehu. | `test/background-jobs.test.js`, `test/geolocation.test.js` | Dashboard statusi poslova po vlasniku; bez payload-a ili emaila. |
| Webhook bez blokiranja prijave | Testovi simuliraju queue grešku, ne-2xx receiver, retry i konačni neuspjeh. HTTP prijava i dalje vraća `201`, zapis ostaje u SQLite-u, log ne sadrži lead podatke; retry koristi isti idempotency key. | `test/widget-embed.test.js`, `test/background-jobs.test.js` | Nije potreban screenshot za mock test. Za ručni dokaz snimiti kontrolisani receiver i red događaja, ali sakriti email, poruku i HMAC ključ. |
| Migracije i konfiguracija | Migracijski test kreira privremenu staru SQLite šemu i potvrđuje očuvanje widgeta/prijava te novih indeksa. Provjeriti da `.env` nije praćen, a `.env.example` nema stvarne tajne. | `test/migration.test.js`; `git check-ignore .env` može potvrditi ignore pravilo | Nije potreban screenshot; ne otvarati stvarnu bazu za ručne izmjene. |
| Evaluator manifest | Pokrenuti `npm start`, zatim provjeriti `GET /health`. `capstone.yaml` opisuje stvarni `run.command`, `base_url`, SQLite i autentifikaciju. | `test/health.test.js`; validirati manifest ručno/evaluatorom ako je dostupan | Nije potreban screenshot. |

### Ručna konfiguracija webhooka

U lokalnom `.env` postaviti pouzdan HTTPS `SUBMISSION_WEBHOOK_URL` i zaseban
nasumični ključ od najmanje 32 bajta kao `SUBMISSION_WEBHOOK_SECRET`; ključ se
mora postaviti kad je URL uključen. Ne kopirati tajnu u Git, screenshotove ili prijave.
Restartovati server i poslati novu probnu prijavu. Receiver treba dobiti JSON
`submission.created`, `Idempotency-Key` i, kad je ključ podešen,
`X-FlyRank-Signature`. Za test greške privremeno podesiti kontrolisani receiver
da vraća `503`, potvrditi `pending`/retry pa konačni `failed`, i provjeriti da
se prijava i dalje vidi u dashboardu. Automatizovani testovi ne pozivaju
vanjski internet. Ako URL nije konfigurisan, webhook je namjerno isključen i
ne smije se tvrditi da je događaj poslan.

## Implementirane funkcionalnosti

- `GET /health` i javni demo obrazac ostaju dostupni.
- Registracija, prijava i odjava koriste postojeće API rute.
- Dashboard vlasnika je dostupan na `/dashboard.html` i iz demo stranice.
- Dashboard prikazuje ukupan broj vlastitih widgeta i prijava, broj prijava
  prema izabranom widgetu i broj redova prikazanih u tabeli. U tabeli su
  država/regija/grad ili status geolokacije; lista je ograničena na 100
  najnovijih prijava po prikazu.
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
  `owner_id`, dashboard podaci između dva korisnika, filter po widgetu,
  ukupan/filtriran broj, geolokacijska polja i privatnost sistemskog demo widgeta.
- `test/widget-embed.test.js`: konfiguracija, cache headers, script cache,
  CORS/OPTIONS allowlist, submission validacija/honeypot i pristup vlasničkim
  statistikama/prijavama bez sesije.
- `test/submission-protection.test.js`: validne i neispravne prijave, neispravan
  JSON, payload veći od 10 KB, neutralan honeypot odgovor bez upisa, `429`
  rate-limit JSON i očuvanje CORS/autorizacije.
- `test/geolocation.test.js`: uspjeh primarnog providera, fallback, timeout,
  neispravan JSON/koordinate, preskakanje privatnih/rezervisanih IP adresa i
  enqueue bez čekanja na providere, očuvanje prijave pri enqueue grešci.
- `test/background-jobs.test.js`: geolokacija i webhook, retry s
  eksponencijalnim čekanjem, HMAC/idempotency key, konačni neuspjeh i
  sanitizovano upozorenje, webhook timeout, oporavak isteklog processing
  lease-a i sprečavanje duple obrade dva workera.
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
HTTP; nije potreban pristup internetu. Provjera veličine i vremena izmjene
projektne baze potvrdila je da testovi nisu pisali u nju.

Background jobs faza: kompletni `npm test` — 25 prolaznih, 0 neuspješnih.
`node --check` je prošao za sve izmijenjene JS fajlove, uključujući queue,
worker, API, dashboard skriptu i testove. Testovi koriste mockirane providere i
privremene baze. Postojeća projektna SQLite baza nije korištena u testovima.

Dashboard geolokacija i brojanje: `npm test` — 32 prolazna, 0 neuspješnih;
`node --check public/dashboard.js`, `node --check test/dashboard.test.js` i
`git diff --check` prošli su. Testovi potvrđuju geolokacijski objekt iz API-ja,
ukupan broj, broj filtriranog widgeta i broj prikazanih prijava.

Browser smoke test na serveru s privremenom SQLite bazom: registrovan je
korisnik, kreiran widget, učitana konfiguracija preko `/widget/v1.js`, poslata
prijava i prikazana poruka uspjeha. Nakon reload-a dashboard je prikazao
sačuvanu prijavu, brojeve 1/1/1 i status lokacije za lokalnu IP adresu.
Projekat nema Playwright/Puppeteer browser-test infrastrukturu, zato nije
dodata browser-test zavisnost; screenshot nije sačuvan. API i UI tok su
provjereni u integrisanom browseru, bez slanja stvarnih podataka van aplikacije.

Browser smoke test: otvoren je `http://localhost:5500/embed-demo.html` dok je
API radio na `http://localhost:3000` s dozvoljenim origin-om `localhost:5500`.
Vanjska stranica učitala je konfiguraciju `demo-widget`, a slanje prijave
prikazalo je poruku „Prijava je uspješno zaprimljena.”

Embed dijalog je ručno provjeren na privremenoj bazi: nakon kreiranja widgeta
dugme **Embed / pregled** otvorilo je njegov sačuvani naslov i polja u iframeu,
prikazalo tačan `data-widget-key` u iframeu i odgovarajući script tag, a
**Kopiraj embed kod** prikazalo je potvrdu kopiranja. Automatizovani
`test/widget-embed.test.js` provjerava postojanje dijaloga i povezivanje
preview/code s `widget.publicKey`; browser provjera je ručna, jer projekat nema
Playwright/Puppeteer test runner.

Za ručnu provjeru `npm start`, postavite allowlistu
`WIDGET_ALLOWED_ORIGINS=http://localhost:5500`, pa poslužite `public/` preko VS
Code Live Server na portu 5500. Otvorite
`http://localhost:5500/embed-demo.html`; konfiguracija i submission poziv idu
preko CORS-a na FlyRank server. `/` i `/dashboard.html` ostaju dostupni.
