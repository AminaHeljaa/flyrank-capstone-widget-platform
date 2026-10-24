# Build log

## Faza: autentifikacija i izolacija tenant-a

- Uvedene su registracija i prijava s bcrypt hashiranjem lozinki, DB sesijama i
  `HttpOnly` kolačićem.
- Dodani su korisnici, sesije i vlasnik widgeta; postojeći widgeti dobijaju
  sistemskog vlasnika bez uklanjanja postojećih zapisa.
- Dodane su autentifikovane rute za vlastite widgete, prijave i statistiku.
- Zadržani su `/health`, javna konfiguracija widgeta i javno slanje prijava
  (potrebno za demo obrazac).
- Dodani su testovi za autentifikaciju, CRUD, izolaciju i javni demo obrazac.
- Ažurirani su README, dizajn, zavisnosti i lokalna konfiguracija.

## Lokalna provjera

Node.js: `v22.15.0`  
npm: `11.4.2`

`npm test` — uspješno: svih 5 testova prolazi. Provjereni su registracija,
hash lozinke, prijava/odjava i sesija, CRUD widgeta, izolacija widgeta i
prijava, javni demo obrazac, `/health` i očuvanje postojećih podataka pri
migraciji SQLite baze.

## Faza: owner dashboard

- Pregledane su postojeće autentifikacijske i vlasničke API rute.
- Dodan je `GET /api/owner/dashboard` koji identitet dobija iz aktivne sesije,
  vraća samo vlasnikove widgete i prijave te podržava vlasnički filter widgeta.
- Dodana je responzivna `public/dashboard.html` stranica i klijentski kod za
  registraciju, prijavu, odjavu, statistiku, prijave, kreiranje widgeta i kod
  za ugradnju.
- `public/widget.js` sada podržava serverom generisani javni ključ i URL
  skripte za ugradnju, uz očuvanje postojećeg demo obrasca.
- Dashboard API testira neautorizovan pristup, lažiranje vlasnika, izolaciju
  između dva korisnika i privatnost demo prijava.
- README, dizajn i evidence dokumentuju ručnu i automatizovanu provjeru.

Owner dashboard provjera: `npm test` prolazi, 7 testova ukupno.

## Faza: embeddable widget

- Dodana je javna, versioned `/widget/v1.js` koja koristi jedan script tag,
  učitava javnu widget konfiguraciju i dinamički gradi obrazac preko DOM API-ja.
- Zadržani su Zod validacija, JSON limit, API rate limit i honeypot na
  postojećoj javnoj prijava ruti.
- CORS uklonjen je s globalnog middlewarea i ograničen na javne widget
  konfiguracijske/slanje rute, s allowlistom `WIDGET_ALLOWED_ORIGINS` i OPTIONS
  preflight podrškom.
- Konfiguracija kešira 30 sekundi; versioned JS kešira immutable godinu dana.
- Dashboard sada kopira tačan samostalni script tag; demo početna stranica
  koristi versioned skriptu, a `public/embed-demo.html` koristi tag s drugog
  origin-a.
- Dodani su widget embed testovi za konfiguraciju, CORS, preflight, prijave,
  honeypot i privatnost autentifikovanih podataka.

Embeddable widget provjera: `npm test` prolazi sa svih 11 testova. Ručni
browser smoke test na `http://localhost:5500/embed-demo.html` potvrdio je
učitavanje konfiguracije i uspješno slanje prijave cross-origin na
`http://localhost:3000`.

## Faza: validacija, spam zaštita i rate limiting

- Ojačana je postojeća Zod shema za prijave odbijanjem nepoznatih polja;
  ime/email su obavezni, a poruka je ograničena na 2.000 znakova (prazna
  poruka ostaje dopuštena radi kompatibilnosti).
- Dodani su strukturirani JSON odgovori za neispravan JSON (`400`), validaciju
  (`400`), prevelik zahtjev (`413`) i server grešku (`500`) bez internih
  detalja u odgovoru.
- Honeypot se provjerava prije lookup-a widgeta; popunjen unos ne pohranjuje
  prijavu i vraća neutralnu potvrdu.
- Dodan je podesiv javni submission limiter po IP-u (`429` JSON), bez
  `trust proxy`; testni limit se postavlja u izolovanom test procesu.
- Verziona i legacy widget skripta prikazuju razumljive poruke za 400/413/429,
  štite od paralelnog slanja i ne prikazuju uspjeh na neuspješan odgovor.
- Dodani su testovi za validne/neispravne podatke, veličinu tijela, honeypot,
  rate limit, CORS/OPTIONS i autentifikovane rute.

Završna provjera nakon implementacije: `npm test` prolazi sa 13 testova,
0 neuspješnih; `node --check` prolazi za sve izmijenjene JavaScript fajlove.

## Faza: geolokacija s fallback providerom

- Dodan je `src/services/geolocation.js` sa dva HTTPS providera:
  ipwho.is kao primarni i FreeIPAPI kao rezervni provider. Timeout, HTTP/JSON
  greška i neupotrebljiv rezultat prelaze na fallback; privatne, loopback i
  rezervisane IPv4/IPv6 adrese se preskaču.
- Javni endpoint prvo trajno upisuje prijavu, zatim obavlja geolokaciju.
  Provideri primaju samo IP iz `req.ip`; prijave, IP adrese i provider greške
  ne izlažu se klijentu niti se cijeli IP zapisuje u logove.
- Dodana je idempotentna SQLite migracija nullable lokacijskih polja.
  Postojeće prijave ostaju sačuvane i dobijaju `not_processed`; IP se ne
  pohranjuje. Vlasnički dashboard odgovor uključuje normalizovan objekat
  `geolocation`.
- Timeout po provideru se podešava kroz `GEOLOCATION_TIMEOUT_MS` (1200 ms
  zadano). Nema nove runtime zavisnosti.
- Dodani su mock testovi za primarni uspjeh, fallback, timeout, neispravan JSON,
  nevažeće koordinate, privatne IP adrese, očuvanje prijave pri kvaru oba
  providera i dashboard prikaz.
- Ažurirani su README, DESIGN i EVIDENCE za provider limite, privatnost i
  proxy ponašanje.

Završna provjera geolokacijske faze: `npm test` — svih 19 testova prolazi;
`node --check` prolazi za svih pet izmijenjenih JavaScript fajlova. `git status`
nije dostupan jer radni direktorij nema `.git` metapodatke.

## Faza: background jobs, retries i upozorenja

- Dodana je idempotentna `background_jobs` tabela u SQLite-u s JSON payloadom,
  statusom, attempt counterom, next-attempt vremenom, lease/processing tokenom,
  timestampima i sanitizovanim posljednjim error kodom; dodani su indeksi za
  claim, lease oporavak i tenant statistiku.
- Submission endpoint prvo sačuva prijavu, zatim enqueue-a geolokacijski posao
  s prijavom ID-em i IP-om. Odgovor se više ne čeka na provider HTTP pozive.
  Greška reda ostavlja prijavu sačuvanu, vraća uspješan odgovor i ispisuje samo
  generičko upozorenje; taj pojedinačni posao se ne može automatski ponoviti.
- Dodan je jedan worker uz glavni server proces. Atomski SQLite claim,
  unikatni processing token, lease heartbeat i reclaim isteklih lease-ova
  štite od duple obrade i oporavljaju processing poslove nakon restarta.
- Provider odgovor `unavailable` je prolazan i ulazi u retry; `skipped` je
  konačno dovršen rezultat. Retry je eksponencijalan, ograničen na pet
  pokušaja i maksimalno čekanje jedan sat. Konačni neuspjeh briše IP payload,
  čuva samo fiksni error kod i loguje sigurno upozorenje bez privatnih podataka.
- Dashboard prikazuje brojeve poslova po statusu, izračunate samo za prijave
  widgeta prijavljenog vlasnika; payload i error detalji nisu izloženi.
- Dodani su privremeni DB/mock testovi za uspjeh, retry raspored, konačni
  neuspjeh i upozorenje, restart recovery, duple workere, enqueue failure,
  očuvanje prijave, tenant statistiku i migraciju.

Završna provjera: `npm test` — 25 testova prolazi, 0 pada; `node --check`
prolazi za sve izmijenjene JavaScript fajlove. `git status` nije dostupan jer
workspace nema `.git` direktorij.
