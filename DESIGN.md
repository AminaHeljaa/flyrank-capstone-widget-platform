# System Design

## Cilj i arhitektura

Platforma omogućava korisnicima da upravljaju ugradivim obrascima i pregledaju
prijave koje ti obrasci prikupe.

- Backend: Node.js i Express
- UI/demo: HTML, CSS i JavaScript u `public/`
- Baza: SQLite preko `better-sqlite3`
- Validacija: Zod
- Lozinke: bcrypt (`bcryptjs`, 12 rundi)
- Sesije: nasumični 256-bitni token u `HttpOnly`, `SameSite=Lax` kolačiću;
  baza čuva SHA-256 hash tokena i vrijeme isteka od sedam dana
- Testiranje: Node.js ugrađeni test runner

## Model podataka

- **User**: `id`, jedinstveni `email`, `password_hash`, `created_at`.
- **Widget**: `id`, `name`, jedinstveni `public_key`, `created_at`, `owner_id`.
- **Submission**: `id`, `widget_id`, `name`, `email`, `message`, `created_at`,
  nullable `geo_country`, `geo_region`, `geo_city`, `geo_latitude`,
  `geo_longitude`, `geo_provider` and `geo_status`.
- **BackgroundJob**: `id`, `type`, `payload_json`, nullable `submission_id`,
  `status`, `attempts`, `next_attempt_at`, `created_at`, `completed_at`,
  `locked_at`, `processing_token` and sanitized `last_error`.
- **Session**: `token_hash`, `user_id`, `expires_at`, `created_at`.

Svaki widget ima vlasnika. Za postojeću SQLite bazu migracija dodaje
`owner_id`, kreira sistemskog vlasnika bez lozinke i dodjeljuje mu prethodno
postojeće widgete; prijave i ključevi widgeta ostaju sačuvani. Novi widgeti
uvijek se kreiraju s vlasnikom. Brisanje widgeta briše njegove prijave u istoj
transakciji. Idempotentna migracija dodaje nullable geolokacijska polja
postojećim prijavama; raniji zapisi dobijaju status `not_processed`, bez
izmjene prijave ili ponovnog kreiranja tabela. IP adresa se čuva privremeno
samo u JSON payload-u aktivnog geolokacijskog posla i briše se u terminalnom
stanju.

## API

- Javno: `GET /health`, `GET /api/widgets/:publicKey`,
  `POST /api/widgets/:publicKey/submissions`; javni konfiguracijski i prijava
  endpointi podržavaju allowlisted CORS preflight.
- Autentifikacija: `POST /api/auth/register`, `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me`.
- Dashboard: autentifikovani `GET /api/owner/dashboard` vraća zbirne brojeve,
  widgete, broj pozadinskih poslova po statusu i do 100 najnovijih prijava;
  `?widgetId=...` filtrira prijave i njihove poslove.
- Upravljanje: autentifikovani `GET`, `POST`, `PUT`/`PATCH` i `DELETE` pod
  `/api/owner/widgets`; vlasnički endpointi daju pristup prijavama i statistici
  samo nakon provjere `owner_id`.
- Kompatibilnost: `GET /api/widgets/:publicKey/stats` ostaje, ali zahtijeva
  prijavljenog vlasnika.

Javna ruta za slanje prijave je namjerna: posjetioci ne moraju imati nalog da
bi koristili obrazac. Ona omogućava samo dodavanje prijave, ne pregled ili
izmjenu postojećih podataka.

## Sigurnosne kontrole

- Bcrypt hashovi lozinki; lozinke se nikad ne upisuju kao običan tekst.
- Sesijski tokeni nastaju pomoću `crypto.randomBytes`; u SQLite se čuva samo
  njihov SHA-256 hash.
- `HttpOnly`, `SameSite=Lax`, sedmodnevni rok i `Secure` kolačić u produkciji.
- Zod validacija javnih prijava, ograničenje JSON tijela na 10 KB, strukturirani
  `400`/`413` JSON odgovori i generički `500` bez detalja servera.
- Honeypot `website` se provjerava prije lookup-a widgeta; popunjeno polje ne
  kreira prijavu i vraća neutralan odgovor.
- Poseban rate limit javnih prijava vraća strukturirani `429`; prozor i limit
  se podešavaju preko `WIDGET_SUBMISSION_RATE_WINDOW_MS` i
  `WIDGET_SUBMISSION_RATE_LIMIT`.
- Geolokacija se izvršava tek nakon trajnog upisa prijave. Neuspjeh providera
  ne utiče na uspješan odgovor klijentu. Samo javne IP adrese idu prema
  providerima; ne šalju se podaci prijave i IP se ne loguje.
- SQLite red je trajan. Preuzimanje je atomsko uz processing token; lease
  heartbeat i periodičan oporavak vraćaju napuštene poslove. Retry je
  eksponencijalan, ograničen brojem pokušaja i maksimalnim čekanjem.
- Dashboard broji samo poslove povezane s prijavama widgeta trenutnog vlasnika;
  payload i greške posla nisu dostupni klijentu.
- Izvor IP-a je `req.ip` uz podrazumijevani Express `trust proxy = false`;
  aplikacija ne čita `X-Forwarded-For` direktno.
- CORS allowlista iz `WIDGET_ALLOWED_ORIGINS` primjenjuje se samo na javnu
  konfiguraciju i slanje prijava; vlasnički i auth endpointi nemaju cross-origin
  CORS dozvolu.
- Svi upiti za privatne widgete i prijave filtriraju prema autentifikovanom
  `owner_id`; tuđi i nepostojeći widgeti vraćaju `404`.
- Dashboard i kreiranje widgeta izvode vlasnika iz sesije, nikada iz klijentskog
  `owner_id` polja ili query parametra.

## Dashboard i ugradnja

`/dashboard.html` omogućava prijavu/registraciju/odjavu, pregled broja widgeta i
prijava, broja poslova po statusu, filtriranje prijava po widgetu i kreiranje
widgeta. Za svaki vlastiti widget prikazuje jedan script tag na `/widget/v1.js`
s `data-widget-key`.
Verzionirana skripta ubacuje pristupačan obrazac bez `eval` ili HTML string
izvršavanja, dohvaća konfiguraciju preko servera koji ju je poslužio i šalje
prijavu istom serveru.

`GET /api/widgets/:publicKey` izlaže samo naziv, javni ključ i polja. Njegov
cache traje 30 sekundi uz `must-revalidate`; versioned JS ima jednogodišnji
immutable cache.
`WIDGET_ALLOWED_ORIGINS` je lista tačnih web-origin-a za CORS. Preflight
`OPTIONS` i dozvoljeni CORS odgovori dostupni su samo za javnu konfiguraciju i
slanje prijava; autentifikovane rute nisu dio CORS allowliste. Javni ključ
dozvoljava samo konfiguraciju i slanje prijave, nikada pregled privatnih
zapisa.

`public/embed-demo.html` demonstrira instalaciju script taga na drugom originu.
Lokalno ga poslužuje Live Server na portu 5500, dok Express API radi na portu
3000; dodavanje `http://localhost:5500` u `WIDGET_ALLOWED_ORIGINS` dopušta
browser fetch konfiguracije i JSON slanje prijave.

Javni submission rate limiter koristi `express-rate-limit` memorijski store,
po IP adresi u jednom Node procesu. Brojači se resetuju nakon restarta i nisu
zajednički između replika; više instanci zahtijeva zajednički store. Aplikacija
ne postavlja `trust proxy`; deployment iza proxy-ja treba svjesno definisati
pouzdane proxy adrese/CIDR-ove prije prosljeđivanja klijentskog IP-a.

Dashboard prikazuje najviše 100 najnovijih prijava po trenutnom prikazu. Ukupan
broj prijava računa se zasebno i nije ograničen na tabelu.

## Background jobs

Uspješno sačuvana prijava se zatim stavlja u SQLite `background_jobs`. Red
koristi indekse za pending redoslijed, processing lease i vezu s prijavom.
Greška pri enqueue-u ne poništava već upisanu prijavu; endpoint vraća uspjeh,
zapisuje samo generičko upozorenje i taj posao neće imati automatski
geolokacijski retry. Enqueue nije dio iste transakcije kao prijava namjerno,
jer je zahtjev da prijava preživi neuspjeh reda.

Glavni Node process pokreće jednu worker instancu. Claim je jedna atomarna
SQLite `UPDATE ... RETURNING`, s unikatnim processing tokenom. Više workera koji
dijele SQLite bazu ne mogu claimati isti pending posao; lease i heartbeat
sprečavaju da aktivan posao bude pogrešno vraćen u red. Ne koristite SQLite
WAL bazu preko fajl sistema koji ne podržava pouzdane SQLite lockove.

`unavailable` od oba geolokacijska providera je prolazna greška i izaziva
retry; `skipped` za privatni/rezervisani IP je konačan rezultat i posao se
označava completed. Pokušaji su ograničeni na pet; čekanje počinje od jedne
sekunde, udvostručuje se po pokušaju i ograničeno je na jedan sat. Poslije
konačnog neuspjeha `last_error` je fiksni kod, payload IP se briše i upozorenje
sadrži samo tip posla, interni job ID i broj pokušaja. Posao koji je processing
pri restartu se ponovo preuzima kada istekne lease; ako je već potrošio sve
pokušaje, označava se failed.

## Geolokacija

`src/services/geolocation.js` provjerava javnu rutabilnost IP-a i koristi
ipwho.is kao primarni provider, zatim FreeIPAPI kao fallback. Oba poziva koriste
HTTPS, šalju samo IP adresu, imaju timeout `GEOLOCATION_TIMEOUT_MS` (zadano
1200 ms svaki) i normalizuju rezultat u `country`, `region`, `city`,
`latitude`, `longitude`, `provider`, `status`. HTTP greške, timeouti,
neispravan JSON i neupotrebljiva lokacija aktiviraju provider B. Ako oba
propadnu, posao se retry-a, a nakon konačnog neuspjeha prijava ostaje
nepromijenjena, bez lokacije; za privatne/lokalne/rezervisane adrese status je
`skipped`.

Vlasnički dashboard uključuje normalizovano polje `geolocation` uz vlastite
prijave, pa tenant izolacija ostaje nepromijenjena. Geolokacija je približna i
zavisi od third-party dostupnosti/kvota. ipwho.is/ipwhois.io navodi besplatni
plan bez ključa od 1.000 zahtjeva dnevno, s dopuštenom komercijalnom upotrebom,
ali bez uptime garancije
([pricing](https://ipwhois.io/pricing)). FreeIPAPI navodi besplatnu upotrebu
za komercijalne i nekomercijalne svrhe, uz 60 zahtjeva u minuti
([home](https://freeipapi.com/), [API docs](https://freeipapi.com/docs)).
Limiti i uslovi mogu se promijeniti i provider može odbiti pozive po prekoračenju.

Prije produkcijskog korištenja potrebno je objaviti odgovarajuću obavijest o
obradi IP adresa i utvrditi pravni osnov. Provider može obrađivati ili logovati
upite prema vlastitim pravilima. Za reverse proxy je sigurnije ostaviti
`trust proxy` isključen (IP tada može biti proxy i lokacija će se preskočiti)
nego prihvatiti proizvoljni `X-Forwarded-For`; ako je nužno, deployment mora
podesiti samo poznate proxy adrese/CIDR-ove i blokirati direktan pristup Node
portu.

## Ograničenja / budući rad

- Demo widget pripada sistemskom nalogu i nije dio korisničkog CRUD-a.
- Stari demo widget i njegove prijave ostaju sačuvani, ali nisu vidljivi
  korisničkim dashboardima.
- Geolokacijski posao obrađuje se sinhrono unutar jednog worker execution-a,
  ali nezavisno od HTTP zahtjeva prijave; red i retry mehanizam su u SQLite-u.
