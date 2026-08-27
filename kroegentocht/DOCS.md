# Kroegentocht

Kroegentochten vastleggen en bezochte tenten op een interactieve kaart zetten.
Werkt offline, want in een kroeg is de dekking slecht.

## Wat deze add-on doet

Eén container met PostgreSQL 17 met PostGIS en de applicatie erin. Alle data staat
in `/data`, het persistente volume van de add-on, en gaat dus mee in een Home
Assistant backup:

| Pad | Inhoud |
| --- | --- |
| `/data/postgres` | de database |
| `/data/media` | de foto's, webp zonder metadata |
| `/data/tiles` | kaarttegelcache, staat niet in de backup |
| `/data/secrets.env` | de bij de eerste start gegenereerde geheimen |

De add-on staat op `backup: cold`. De Supervisor stopt hem dus tijdens een backup,
zodat de database schoon op schijf staat op het moment dat de backup hem inleest.
Een kopie van een draaiende database is niet betrouwbaar terug te zetten.

## Installeren

1. Vul op het tabblad **Configuratie** minimaal `invite_code`, `public_base_url`
   en `contact_email` in. Zonder die drie start de add-on niet, met een uitleg in
   het logboek.
2. Start de add-on. De eerste start duurt langer: de database wordt
   geïnitialiseerd en de migraties worden uitgevoerd.
3. Zet een reverse proxy ervoor voor TLS. Zie hieronder.
4. Ga naar `https://<jouw adres>/registreren`, vul je `invite_code` in en maak je
   account.
5. Maak jezelf beheerder. Open een terminal en voer uit:

   ```bash
   docker exec addon_local_kroegentocht \
     psql -U kroeg -d kroegentocht \
     -c "UPDATE users SET role = 'admin' WHERE username = 'jouwnaam';"
   ```

   Werkt die containernaam niet, zoek hem dan op met `docker ps | grep kroegentocht`.

## Opties

| Optie | Verplicht | Wat het doet |
| --- | --- | --- |
| `invite_code` | ja | Registreren zit hierachter. Minimaal 6 tekens. Deel hem alleen met wie je erbij wil. |
| `registration_enabled` | nee | Op `false` gaat de deur helemaal dicht, ook met een geldige code. Handig zodra iedereen binnen is. |
| `public_base_url` | ja | Het adres waarop de app te bereiken is, bijvoorbeeld `https://kroegen.jouwdomein.nl`. Gaat mee in de User-Agent naar OpenStreetMap. |
| `contact_email` | ja | Contactadres in die User-Agent. Het gebruiksbeleid van OpenStreetMap en Nominatim vraagt om een contactmogelijkheid. |
| `cookie_secure` | nee | Laat dit op `true` staan zodra er TLS voor zit. Op `false` kun je de app eerst op je eigen netwerk over plain http controleren; de app start dan met een waarschuwing in het logboek en laat ook upgrade-insecure-requests uit de Content Security Policy weg, want anders krijg je een lege pagina. Zet hem daarna weer aan. |
| `log_level` | nee | `info` is genoeg. `debug` als je iets uitzoekt. |
| `tile_cache_ttl_days` | nee | Hoe lang een gecachete kaarttegel meegaat. 30 dagen is netjes tegenover OpenStreetMap. |
| `tile_upstream_template` | nee | Bron van de kaarttegels. Alleen wijzigen als je een eigen tileserver hebt. |
| `nominatim_base_url` | nee | Geocodingdienst voor het zoeken op adres. Zet dit op je eigen instantie als je die hebt. |

De geheimen staan niet bij de opties: het sessiegeheim en de twee
databasewachtwoorden worden bij de eerste start gegenereerd en in
`/data/secrets.env` bewaard. **Gooi dat bestand niet weg**, want zonder die
waarden komt de api niet meer bij de bestaande database.

## Reverse proxy

De add-on luistert op poort 3000 in de container, gepubliceerd op poort 8099 op de
host. TLS handel je af bij de proxy; de add-on doet zelf alleen plain HTTP.

Gebruik je de **Nginx Proxy Manager**-add-on, dan hangen jullie aan hetzelfde
add-onnetwerk en kan hij de container op naam bereiken:

- Scheme: `http`
- Forward Hostname / IP: `local-kroegentocht`
- Forward Port: `3000`

Werkt die naam niet, gebruik dan het IP van je Home Assistant-machine met poort
`8099`. Op het **SSL**-tabblad: Let's Encrypt, **Force SSL**, **HTTP/2** en
**HSTS** aan. En op het **Advanced**-tabblad precies deze regel:

```nginx
client_max_body_size 12m;
```

Zonder die regel weigert nginx een foto van 10 MB voordat de app hem ziet. Zet er
géén eigen `Content-Security-Policy` bij: de app stuurt die zelf, en twee policies
naast elkaar betekent in de praktijk dat er stilletjes iets niet meer werkt.

**Geen ingress.** Dat is een keuze, niet een gemis: ingress zet de app achter een
wisselend pad, en daar loopt de service worker op stuk. Zonder service worker
werkt de offline wachtrij niet, en dat is precies de functie waarom je deze app in
een kroeg kunt gebruiken.

## Privacy

Wat er in deze add-on aan persoonsgegevens staat en hoe lang, staat in de README
van het project. Kort samengevat:

- Anonieme meldingen worden alleen via een databaseview gepubliceerd, met
  uitsluitend tent, cijfer, tags, tekst en de bezoekmaand. De applicatie leest die
  view met een aparte databaserol die de brontabellen niet eens mag lezen.
- Een tent verschijnt pas op de publieke kaartlaag vanaf drie verschillende
  melders.
- Bij het uploaden wordt alle metadata uit een foto gestript, inclusief
  GPS-coördinaten, en wordt de foto hergecodeerd naar webp.
- IP-adressen worden alleen gehasht en in het geheugen gebruikt voor rate
  limiting, en nergens opgeslagen.
- Een gebruiker kan zijn account en alle bijbehorende data volledig laten
  verwijderen.

## Problemen oplossen

**De add-on stopt direct na het starten.** Kijk in het logboek. Bij ontbrekende
opties staat er per optie wat er mist.

**"publicView: fout" op `/readyz`.** De read-only databaserol kon niet inloggen.
Meestal is `/data/secrets.env` weg of aangepast. Zonder die geheimen is de
database niet meer te openen; terugzetten uit een backup is dan de weg.

**Foto's uploaden mislukt met een 413.** De `client_max_body_size` in de reverse
proxy staat te laag.

**Kaart blijft leeg.** De add-on haalt tegels op bij OpenStreetMap. Controleer of
de machine uitgaand internet heeft. Bij een storing daar serveert de proxy zo lang
mogelijk verouderde tegels uit de cache.

## Backup en herstel

Home Assistant backups nemen `/data` mee, dus de database en de foto's zitten
erin. De kaarttegelcache is uitgesloten; die loopt zichzelf weer vol.

Twee dingen om zelf te regelen:

1. **Maak volledige backups**, geen gedeeltelijke. Alleen die nemen de add-ondata
   mee.
2. **Haal de backups van de machine af.** Een backup op dezelfde schijf is geen
   backup.

Terugzetten gaat via de normale restore van Home Assistant. De add-on start daarna
met de teruggezette database; de migraties draaien opnieuw en zetten de read-only
rol en zijn rechten weer goed.
