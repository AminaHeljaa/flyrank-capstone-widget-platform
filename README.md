# FlyRank Capstone Widget Platform

Platforma za ugradive obrasce i prikupljanje prijava. Backend koristi Node.js,
Express, SQLite, Zod i `bcryptjs`; testovi koriste ugrađeni Node.js test runner.

## Pokretanje

Potrebni su Node.js 20+ i npm.

```sh
npm install
```

Opcionalno kopirajte `.env.example` u `.env` i prilagodite `PORT` ili
`DATABASE_PATH`. Pokretanje aplikacije:

```sh
npm start
```

Razvojni režim s automatskim restartom:

```sh
npm run dev
```

## Interfejs i ručna provjera

FlyRank koristi zajednički dizajnerski sistem bez frontend frameworka ili novih
runtime zavisnosti. Početna stranica (`/`) predstavlja proizvod i uključuje
stvarni demo embed; `/dashboard.html` zadržava prijavu, registraciju, widgete,
prijave i status background poslova; `/embed-demo.html` demonstrira isti
versioned widget script na izdvojenoj testnoj stranici. Embed stilovi su
izolovani u Shadow DOM-u, tako da ne preuzimaju CSS stranice domaćina.

Za brzu browser provjeru pokrenite `npm start`, posjetite `/`, zatim otvorite
`/dashboard.html` i prijavite se ili registrujte. U dashboardu napravite widget,
kopirajte njegov embed kod i provjerite prikaz koda, brojke, tabelu/prazno
stanje i povratnu poruku dugmeta za kopiranje. Otvorite `/embed-demo.html` da
provjerite vanjski embed primjer. Za testiranje stvarnog cross-origin CORS-a
poslužite `public/` na drugom originu i dodajte njegov tačan origin u
`WIDGET_ALLOWED_ORIGINS`; lokalni URL u stranici je samo razvojni primjer.

Aplikacija po zadanim postavkama koristi `widget-platform.db` u korijenu
projekta. Postojeća baza se ne briše: pri pokretanju se dodaju korisničke i
sesijske tabele, a postojeći widgeti dobiju sistemskog vlasnika
`demo-owner@system.invalid`. Taj sistemski nalog nema lozinku za prijavu.
Obavezno napravite vlastitu kopiju SQLite baze prije ručnog eksperimentisanja s
migracijama ili promjenama podataka.

## Autentifikacija

Registracija i prijava koriste email i lozinku od najmanje 12 znakova (do 72
UTF-8 bajta). Lozinke se čuvaju kao bcrypt hashovi. Uspješna registracija ili
prijava postavlja nasumičan, neproziran sesijski token u `HttpOnly`,
`SameSite=Lax` kolačić; u bazi se čuva samo SHA-256 hash tokena. Sesija traje
sedam dana. Kolačić dobija oznaku `Secure` kada je `NODE_ENV=production`, zato
produkcija mora koristiti HTTPS.

| Metoda | Putanja | Opis |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Registracija: `{ "email": "...", "password": "..." }` |
| `POST` | `/api/auth/login` | Prijava s istim JSON poljima |
| `POST` | `/api/auth/logout` | Opoziv trenutne sesije |
| `GET` | `/api/auth/me` | Trenutno prijavljeni korisnik |

Registracija odmah prijavljuje korisnika. Zahtjevi za prijavu/registraciju
ograničeni su na 10 zahtjeva u 15 minuta po IP adresi.

## Widgeti i prijave

Svi `/api/owner` endpointi zahtijevaju važeću sesiju i vraćaju samo podatke
widgeta čiji je `owner_id` prijavljeni korisnik.

| Metoda | Putanja | Opis |
| --- | --- | --- |
| `GET` | `/api/owner/dashboard` | Broj widgeta, ukupan broj vlastitih prijava, widgeti i do 100 najnovijih vlastitih prijava; opcionalni `?widgetId=...` filtrira prijave |
| `GET` | `/api/owner/widgets` | Vlastiti widgeti |
| `POST` | `/api/owner/widgets` | Kreiranje widgeta i njegovih postavki; ključ generiše server |
| `GET` | `/api/owner/widgets/:id` | Pregled vlastitog widgeta i postavki |
| `PUT` / `PATCH` | `/api/owner/widgets/:id` | Izmjena naziva i/ili postavki widgeta |
| `DELETE` | `/api/owner/widgets/:id` | Brisanje widgeta i njegovih prijava |
| `GET` | `/api/owner/widgets/:id/submissions` | Do 100 najnovijih vlastitih prijava; podržava `?limit=1..100` |
| `GET` | `/api/owner/widgets/:id/stats` | Broj prijava vlastitog widgeta |

Drugi korisnik za tuđi ili nepostojeći widget dobija isti odgovor `404`.
Prijave se ne mogu čitati preko javnog ključa. Stari
`GET /api/widgets/:publicKey/stats` endpoint je zadržan, ali sada traži prijavu
i vraća podatke samo vlasniku.

Odgovori vlasničkog dashboarda uključuju lokaciju prijave u polju
`geolocation` (država, regija, grad, koordinate, provider i status), te zbirne
brojeve pozadinskih poslova svih tipova za widgete trenutnog korisnika.

Javni demo obrazac ostaje dostupan:

- `GET /api/widgets/:publicKey` vraća javnu konfiguraciju obrasca.
- `POST /api/widgets/:publicKey/submissions` prima validiranu prijavu bez
  prijave vlasnika; to je namjerno jer obrazac popunjavaju javni posjetioci.
- Honeypot polje `website`, Zod validacija i JSON limit od 10 KB štite javni
  endpoint za prijave.

Prijava poslata kroz javni obrazac pripada vlasniku ciljnog widgeta. Javna ruta
ne omogućava pregled, izmjenu ni brisanje pohranjenih prijava.

## Dashboard vlasnika

Otvorite `http://localhost:3000/dashboard.html` i registrujte se ili prijavite.
Dashboard prikazuje broj vlastitih widgeta, ukupan broj prijava svih widgeta,
broj prijava za trenutno odabrani widget i broj redova prikazanih u tabeli.
Tabela prikazuje do 100 najnovijih prijava uz filter po widgetu, uključujući
državu/grad kada su dostupni ili status obrade lokacije. Kartice pozadinskih
poslova prikazuju sve tipove poslova, ne samo geolokaciju, u stanjima pending,
processing, completed i failed. Dashboard prikazuje i javni ključ, datum
kreiranja i kod za ugradnju svakog vlastitog widgeta. Dugme **Create Widget** otvara editor s
internim nazivom, naslovom i opisom forme, tekstom dugmeta, akcentnom bojom,
izborom polja i porukom uspjeha; pregled se ažurira dok se postavke mijenjaju.
Kreiranje i uređivanje šalju validirane podatke na vlasničke API rute i trajno
ih čuvaju u SQLite-u. Lista nudi detalje/uređivanje, brisanje uz potvrdu,
dugme **Embed / pregled** koje otvara odabrani widget i njegov kopirljivi kod,
zaseban **Pregled** u novoj kartici i brzo kopiranje embed koda. Vlasništvo se provjerava iz sesije
na serveru; drugi korisnik za widget dobija `404`. Brojevi poslova se računaju
samo za prijave widgeta trenutno prijavljenog korisnika. Stariji klijenti i
dalje mogu kreirati widget slanjem samo `{ "name": "Moj obrazac" }`; server
primjenjuje kompatibilne podrazumijevane postavke.

Javni ključ služi za prikaz obrasca i slanje prijava, ne za pregled vlasničkih
podataka. Demo obrazac ostaje na `/` i koristi postojeći `demo-widget`.
Njegove prijave pripadaju sistemskom vlasniku bez lozinke i ne prikazuju se
dashboardima korisnika.

Ručna provjera: pokrenite `npm start`, otvorite `/dashboard.html`, registrujte
korisnika s lozinkom od najmanje 12 znakova, napravite widget, kopirajte
ugradni kod i provjerite da widget prikazuje obrazac. Za probnu prijavu
korisničkog widgeta ugradite njegov kod na stranicu ili pošaljite
`POST /api/widgets/<publicKey>/submissions`, pa osvježite dashboard. Odjavite
se i potvrdite da su vlasnički podaci dostupni tek nakon prijave.

## Embeddable widget

Dashboard prikazuje tačan, samostalan script tag za svaki vaš widget:

```html
<script src="https://widgets.example.com/widget/v1.js" data-widget-key="JAVNI_KLJUC_WIDGETA"></script>
```

Lokalni primjer:

```html
<script src="http://localhost:3000/widget/v1.js" data-widget-key="demo-widget"></script>
```

Za stvarno objavljivanje zamijenite lokalni URL javnim **HTTPS** URL-om
servera i postavite pravi javni ključ. `data-widget-key` je jedinstveni javni ključ konkretnog sačuvanog widgeta
(ne ID demo widgeta). Skripta dohvaća samo javne postavke s
`GET /api/widgets/:publicKey` — naslov, opis, tekst dugmeta, boju, polja i
poruku uspjeha — i šalje prijave na
`POST /api/widgets/:publicKey/submissions`. Konfiguracija sadrži samo naziv,
javni ključ i javne postavke; ona nikad ne izlaže vlasnika, prijave ili tajne.
Obrazac koristi samo podržana tekstualna polja (`name`, `email`, `message`)
koja se generišu DOM API-jem, bez izvršavanja HTML-a iz konfiguracije. Embed
stilovi su izolovani u Shadow DOM-u. Polja koja nisu odabrana ne prikazuju se;
njihove vrijednosti se pohranjuju kao prazne vrijednosti radi kompatibilnosti
postojećeg modela prijave.

Konfiguracija ima kratak cache od 30 sekundi i `must-revalidate`.
Versioned datoteka `/widget/v1.js` ima
`Cache-Control: public, max-age=31536000, immutable`. Kad se promijeni javno
ponašanje skripte, objavite novu putanju verzije umjesto mijenjanja sadržaja
postojeće verzije.
Raniji `/widget.js` ostaje dostupan za postojeće dvodijelne embedove; za nove
integracije koristite versioned v1 script tag.

CORS je omogućen samo za javne konfiguracijske i prijava endpoint-e, ne za
autentifikovane API rute. U `.env` navedite tačne origin vrijednosti (scheme +
host + port, bez putanje), odvojene zarezima:

```env
WIDGET_ALLOWED_ORIGINS=https://www.example.com,https://shop.example.com
```

Lokalni `.env.example` sadrži `http://localhost:5500` i
`http://127.0.0.1:5500`. Dodajte produkcijske domene eksplicitno i restartujte
server nakon izmjene; wildcard `*` nije podržan. CORS preflight dopušta samo
`GET`, `POST` i `Content-Type` na javnim rutama.

### Testiranje na drugom originu

1. Sačuvajte bazu i pokrenite aplikaciju na portu 3000: `npm start`.
2. Provjerite da `.env` sadrži
   `WIDGET_ALLOWED_ORIGINS=http://localhost:5500`. Ako testna stranica koristi
   `127.0.0.1`, dodajte i taj origin; zatim restartujte aplikaciju.
3. Otvorite mapu `public/` u VS Code i pokrenite VS Code Live Server na portu
   5500. Otvorite `http://localhost:5500/embed-demo.html`; ne koristite `file://`.
4. Stranica koristi script tag za `demo-widget`. Pošaljite probnu prijavu i
   provjerite uspješnu poruku. Demo prijava ostaje pod sistemskim vlasnikom.
5. Za vlastiti widget prijavite se na
   `http://localhost:3000/dashboard.html`, kreirajte widget i kopirajte njegov
   script tag u `embed-demo.html`, zamjenjujući demo tag. Pošaljite prijavu i
   provjerite da se pojavljuje samo u dashboardu vlasnika tog widgeta.

## Konfiguracija

| Varijabla | Podrazumijevano | Namjena |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATABASE_PATH` | `widget-platform.db` u korijenu projekta | Putanja do SQLite baze |
| `NODE_ENV` | — | Postaviti na `production` radi `Secure` kolačića |
| `WIDGET_ALLOWED_ORIGINS` | prazno (CORS bez cross-origin dozvole) | Tačna allowlista origin-a za javne widget API rute |
| `GEOLOCATION_TIMEOUT_MS` | `1200` | Maksimalno čekanje svakog geolokacijskog providera u milisekundama |
| `BACKGROUND_JOB_POLL_INTERVAL_MS` | `1000` | Worker interval provjere reda |
| `BACKGROUND_JOB_MAX_ATTEMPTS` | `5` | Maksimalan broj izvršavanja posla |
| `BACKGROUND_JOB_RETRY_BASE_MS` | `1000` | Početno eksponencijalno čekanje |
| `BACKGROUND_JOB_RETRY_MAX_MS` | `3600000` | Gornja granica čekanja |
| `BACKGROUND_JOB_LEASE_MS` | `30000` | Lease trajanje za oporavak napuštenih poslova |
| `SUBMISSION_WEBHOOK_URL` | prazno (isključeno) | HTTPS endpoint za događaj nove prijave; HTTP je dopušten samo za localhost |
| `SUBMISSION_WEBHOOK_SECRET` | prazno | Obavezan uz webhook URL; HMAC-SHA256 ključ od najmanje 32 bajta |
| `SUBMISSION_WEBHOOK_TIMEOUT_MS` | `5000` | Timeout za webhook HTTP poziv |

Nije potreban JWT ili hardkodirani session secret: sesijski tokeni se generišu
kriptografski sigurnim generatorom pri prijavi.

## Testovi i provjera

```sh
npm test
```

Testovi koriste privremenu SQLite bazu i ne mijenjaju projektnu bazu.
Pokrivaju `/health`, registraciju i prijavu, hashiranje lozinke, widget CRUD,
pristup prijavama, izolaciju korisnika, dashboard API, versioned widget script,
javnu konfiguraciju, CORS/OPTIONS, validaciju, honeypot, rate limiting i
geolokacijski fallback, background job retry i webhook side effect.

## Validacija, spam zaštita i ograničenja zahtjeva

Javni endpoint za prijave provjerava ime (2–100 znakova), email (najviše 254
znaka) i poruku (najviše 2.000 znakova). Ime i email su obavezni; poruka može
biti prazna radi kompatibilnosti s postojećim API ponašanjem. Nepoznata polja
se odbijaju. Neispravan JSON i Zod validacija vraćaju strukturirani JSON s
statusom `400`; zahtjev veći od 10 KB vraća `413`. Server greške ne uključuju
stack trace ili detalje baze u odgovor.

Popunjen skriveni `website` honeypot vraća neutralan uspješan odgovor, ali se
prijava ne pohranjuje. Na javne pokušaje slanja primjenjuje se podesiv limit po
IP adresi:

| Varijabla | Podrazumijevano | Namjena |
| --- | --- | --- |
| `WIDGET_SUBMISSION_RATE_WINDOW_MS` | `900000` | Trajanje prozora limita u milisekundama |
| `WIDGET_SUBMISSION_RATE_LIMIT` | `10` | Najviše pokušaja po IP adresi u prozoru |

Prekoračenje limita javnih prijava vraća `429` i JSON kod
`RATE_LIMIT_EXCEEDED`; opšti API limit također vraća JSON `429`. Limitator
koristi memorijski store jednog Node.js procesa: brojači se resetuju pri
restartu i nisu dijeljeni među više procesa/instanci. Za višestruke produkcijske
instance potreban je zajednički rate-limit store. Aplikacija ne postavlja
`trust proxy`; iza reverse proxy-ja Express može vidjeti proxy IP za sve
klijente. Nemojte uključiti `trust proxy` naslijepo: ako je potrebno, podesite
Express pouzdanim proxy adresama/CIDR-ovima prema stvarnoj topologiji prije
izlaganja aplikacije.

Testni limit je postavljen samo u zasebnom test procesu (`9` zahtjeva u testnom
prozoru); testovi koriste privremenu SQLite bazu i ne mijenjaju runtime
konfiguraciju ni projektnu bazu.

## Background jobs i geolokacija prijava

Nakon uspješnog upisa prijave, API dodaje `geolocate_submission` posao u
SQLite i odmah odgovara; HTTP zahtjev ne čeka vanjske servise. Posao sadrži
`submission_id` i IP unutar JSON payload-a, ali ne sadrži ime, email ili
poruku. IP payload se uklanja kada posao završi ili iscrpi pokušaje. Ako
SQLite ne može dodati posao, prijava ostaje sačuvana i korisnik i dalje dobija
uspješan odgovor; aplikacija emituje generičko upozorenje bez privatnih
vrijednosti, ali taj konkretni posao tada nema automatski retry.

Jedan worker se pokreće uz glavni Node proces i provjerava red po
`BACKGROUND_JOB_POLL_INTERVAL_MS`. Poslovi se atomski preuzimaju SQLite
`UPDATE ... RETURNING` operacijom sa statusom `processing`, jedinstvenim
processing tokenom i lease-om; paralelni workeri ne mogu preuzeti isti posao.
Worker heartbeat obnavlja lease tokom poziva providera. Pri restartu i tokom
rada se vraćaju istekli processing poslovi u pending. Ako je istekao lease
posla koji je već potrošio sve pokušaje, označava se kao failed i emituje se
sigurno upozorenje.

Greške providera `unavailable` se smatraju prolaznim i ulaze u retry. Javne
adrese koje su preskočene (`skipped`) su konačan rezultat, jer retry ne bi
promijenio činjenicu da se privatne/lokalne adrese ne šalju providerima.
Retry koristi eksponencijalni raspored: `base * 2^(attempts - 1)`, do
`BACKGROUND_JOB_RETRY_MAX_MS`; nakon najviše
`BACKGROUND_JOB_MAX_ATTEMPTS` izvršavanja posao prelazi u failed. Posljednja
greška sadrži samo fiksni kod, ne tekst iz provider odgovora.

### Webhook za nove prijave

Opcionalno postavite `SUBMISSION_WEBHOOK_URL` da biste uključili stvarnu
sporednu radnju za nove prijave. URL mora biti HTTPS; HTTP je dozvoljen samo za
`localhost`, `127.0.0.1` ili `::1` u lokalnom razvoju. Endpointom upravlja
vlasnik servera kroz environment, nikada posjetilac widgeta, pa se URL ne može
koristiti za slanje proizvoljnih zahtjeva sa javnog API-ja. Tajne se ne stavljaju
u kod ni u repozitorij. `SUBMISSION_WEBHOOK_SECRET` mora biti postavljen i imati
najmanje 32 UTF-8 bajta kad je URL konfigurisan; FlyRank tada dodaje
`X-FlyRank-Signature: sha256=<hex>` koji je
HMAC-SHA256 nad tačnim JSON tijelom. Primaoc mora provjeriti potpis u
konstantnom vremenu i koristiti `Idempotency-Key` za deduplikaciju.
Generišite vlastiti ključ lokalno i unesite ga u `.env` (ne u repozitorij):

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Poslije upisa prijave u SQLite, aplikacija samo ubacuje
`submission_webhook` posao u isti trajni red i vraća HTTP `201` bez čekanja na
receiver. Posao u redu sadrži samo vezu na prijavu, ne ime, email ili poruku;
worker ih učitava pri isporuci. Primaoc dobija `submission.created` s
identifikatorom i vremenom prijave, widget ID-em/nazivom te imenom, emailom i
porukom prijave. Zato endpoint treba biti pouzdan i ovlašten za prijem ovih
podataka.

Ne-2xx odgovor, mrežna greška ili timeout prolazi kroz isti ograničeni
eksponencijalni retry. Konačni neuspjeh označava posao `failed`, briše payload
i bilježi samo fiksni `WEBHOOK_DELIVERY_FAILED` kod uz upozorenje koje ne sadrži
lead podatke, URL, potpis ili response body. Enqueue greška također ne
poništava već sačuvanu prijavu; vraća se uspješan odgovor i ispisuje se samo
generičko upozorenje, ali taj pojedinačni webhook tada nije automatski
isporučiv. Red ima jedinstveni partial index po prijavi za webhook tip, a svaki
pokušaj koristi stabilni idempotency key `flyrank-submission-<id>`. Ovo
sprečava dupli lokalni posao i omogućava primaocu da deduplicira ponovljenu
isporuku; tačno-jednom isporuka ne može se garantovati ako receiver ignoriše
idempotency key.

Kada webhook URL nije konfigurisan, webhook funkcionalnost je isključena i
posao se ne kreira; aplikacija ne tvrdi da je poruka poslana. `.env.example`
navodi sve opcionalne postavke. Za lokalni test može se koristiti kontrolisani
HTTP receiver vezan samo na loopback; automatizovani testovi koriste isključivo
mockirani `fetch` i ne kontaktiraju internet.

SQLite red je namijenjen lokalnom/persistentnom disku koji podržava SQLite
lockove; nemojte dijeliti WAL bazu preko nepouzdanog mrežnog fajl sistema.
Više workera na istoj podržanoj SQLite bazi koristi atomski claim i lease, ali
produkcijski throughput ostaje ograničen SQLite pisanjem i jednim claimom po
worker instanci.

Primarni provider je
[ipwho.is](https://ipwhois.io/documentation); ako zahtjev istekne, provider
vrati HTTP/JSON grešku ili neupotrebljiv rezultat, koristi se rezervni
[FreeIPAPI](https://freeipapi.com/docs/api-reference/api-introduction).
Svaki poziv ima vlastiti timeout (`GEOLOCATION_TIMEOUT_MS`, zadano 1200 ms).
Neuspjeh oba providera zakazuje retry, a prijava ostaje sačuvana. Nakon
konačnog neuspjeha geolokacijski status ostaje bez lokacije (`not_processed`),
a posao se označava failed. Adrese koje nisu javno rutabilne dobijaju status
`skipped` bez poziva javnih servisa. Stare prijave dobijaju
`not_processed`, jer za njih IP nije sačuvan i lokacija se ne može
rekonstruisati.

Provider A dokumentuje besplatni plan bez registracije/API ključa od 1.000
zahtjeva dnevno i komercijalnu upotrebu
([cjenovnik](https://ipwhois.io/pricing)); uptime nije garantovan. Provider B
navodi besplatnu komercijalnu i nekomercijalnu upotrebu uz ograničenje 60
zahtjeva u minuti ([FreeIPAPI](https://freeipapi.com/)). Limiti, dostupnost i
uslovi mogu se promijeniti; provider može odbiti zahtjeve nakon prekoračenja
kvote. Lokacijski podaci su približni, nisu dokaz fizičke lokacije, a ovaj
servis ne garantuje dostupnost providera.

Geolokacija se izvršava na serveru: providerima se šalje samo IP adresa, nikad
ime, email ili poruka iz prijave. IP se čuva privremeno samo u payload-u SQLite
reda dok je posao na čekanju, u obradi ili se ponavlja; briše se po završetku ili
konačnom neuspjehu. IP se ne ispisuje u aplikacijske logove. Geolokacijski
API-ji mogu bilježiti zahtjeve prema vlastitoj politici privatnosti; prije
produkcijske upotrebe obavijestite posjetioce i utvrdite odgovarajući pravni
osnov i rok čuvanja. Zaštitni filter preskače loopback, privatne, link-local,
multicast i poznate rezervisane IPv4/IPv6 opsege.

Klijentski IP se uzima iz `req.ip` dok je Express `trust proxy` isključen;
`X-Forwarded-For` se ne čita direktno. Aplikacija ne geolocira IP u browseru i
ne izmišlja IP kada zahtjev dolazi preko lokalnog ili privatnog proxy-ja. Ako
deployment koristi reverse proxy, ograničite direktan pristup aplikaciji i
ručno podesite Express `trust proxy` isključivo na poznatu adresu/CIDR tog
proxy-ja; nikad ga ne postavljajte na `true` ili `0.0.0.0/0` bez pouzdane
topologije.
