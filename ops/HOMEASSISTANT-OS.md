# Installeren op Home Assistant OS

Home Assistant OS is een appliance en geen gewone Docker-host. Er zijn twee
routes. Neem route A, tenzij je een reden hebt om dat niet te doen.

| | Route A: add-on | Route B: Portainer-stack |
| --- | --- | --- |
| Beheer | Home Assistant zelf: installeren, starten, updaten, logs | Portainer |
| **Data in Home Assistant backups** | **ja** | nee |
| Watchdog en autostart | ja, van de Supervisor | `restart: unless-stopped` |
| Resourcelimieten | nee, die kent de Supervisor niet | ja, per service |
| Isolatie | één container, database en app samen | drie containers, database op eigen netwerk |
| Configuratie | optieformulier met validatie | environment variables |

Route A lost het echte probleem op: bij route B staan je database en je foto's in
Docker-volumes, en die zitten **niet** in een Home Assistant backup. Als je die
machine ooit opnieuw moet opzetten, ben je alles kwijt.

Wat je bij route A inlevert: de Supervisor kan geen CPU- of geheugengrens per
add-on zetten, dus de bescherming tegen een database die je huisautomatisering
verhongert valt weg. Op een i5 met 16 GB is dat te overzien.

> Blijft staan, ongeacht de route: een los altijd-aan bakje, of Proxmox met Home
> Assistant in een VM en deze stack in een tweede VM, is een betere plek voor jaren
> aan foto's dan een appliance-OS. Het kost bij route B nul regels code, want dan
> gebruik je gewoon `compose.yaml`.

---

## Route A: als Home Assistant add-on

De hele repo is de add-on. `config.yaml`, `build.yaml`, `Dockerfile`, `DOCS.md`,
`icon.png`, `logo.png` en `rootfs/` staan daarom in de root en niet in een submap:
de Supervisor bouwt een add-on met de add-onmap als build-context, dus de
Dockerfile moet bij de broncode van `api`, `web` en `shared` kunnen.

Eén container met PostgreSQL 17 met PostGIS en de Node-api erin, met s6-overlay
als procesbeheerder. Alle data in `/data`, het persistente volume van de add-on.

### 1. Repo naar de HA-machine

De add-on wordt op het toestel gebouwd, dus de code moet in `/addons` staan. Open
de terminal-add-on (Advanced SSH & Web Terminal, of Terminal & SSH) en kloon hem
daar. Push de repo eerst naar een git-remote, of gebruik de Samba-add-on om de map
te kopiëren.

```bash
git clone https://github.com/<jij>/kroegentocht.git /addons/kroegentocht
ls /addons/kroegentocht/config.yaml
```

Dat laatste bestand moet bestaan, anders ziet de Supervisor de add-on niet.

Let op bij kopiëren via Samba in plaats van git: de scripts in `rootfs/` en
`ops/backup/` moeten LF-regeleindes hebben. De repo dwingt dat af met
`.gitattributes`, maar een kopieeractie via Windows kan het alsnog verpesten. Een
script met CRLF geeft bij het starten "no such file or directory" op een pad dat
wél bestaat; dat is het symptoom.

### 2. Add-on installeren

**Instellingen → Add-ons → ⋮ (rechtsboven) → Controleer op updates.** Daarna
verschijnt "Kroegentocht" onderaan onder **Local add-ons**. Open hem en klik
**Installeren**.

De eerste build duurt op een i5-7400 een paar minuten: hij haalt de basisimages
op, installeert PostgreSQL 17 met PostGIS uit de PGDG-repository en draait `npm
ci`, `tsc` en `vite build`. Reken op ongeveer 3 GB tijdelijke schijfruimte.
Controleer vooraf:

```bash
df -h /mnt/data
```

### 3. Configureren en starten

Op het tabblad **Configuratie** minimaal deze drie invullen:

| Optie | Voorbeeld |
| --- | --- |
| `invite_code` | een eigen code van minimaal 6 tekens |
| `public_base_url` | `https://kroegen.jouwdomein.nl` |
| `contact_email` | `jij@jouwdomein.nl` |

Opslaan, dan **Starten**, dan het **Logboek** openen. Daar moet staan:

```
[init-config] Configuratie staat klaar
[init-postgres] Eerste start: database initialiseren in /data/postgres
[api] wachten tot PostgreSQL verbindingen aanneemt
[migrate] toepassen 0001_extensions_and_core.sql
...
[migrate] rol kroeg_public is read-only en mag alleen de publicatieviews lezen
api luistert op http://0.0.0.0:3000
```

De geheimen hoef je niet in te vullen: het sessiegeheim en de twee
databasewachtwoorden worden bij de eerste start gegenereerd en in
`/data/secrets.env` bewaard. Dat bestand zit in de backup. Gooi het niet weg,
want zonder die waarden komt de api niet meer bij de bestaande database.

### 4. Reverse proxy

De add-on publiceert poort 3000 uit de container op poort 8099 op de host.

Gebruik je de **Nginx Proxy Manager**-add-on, dan hangt die aan hetzelfde
add-onnetwerk en kan hij de container op naam bereiken:

- Scheme: `http`
- Forward Hostname / IP: `local-kroegentocht`
- Forward Port: `3000`

Werkt die naam niet, gebruik dan het IP van je Home Assistant-machine met poort
`8099`. Zoek de exacte containernaam desnoods op:

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep kroegentocht
```

Op het **SSL**-tabblad: Let's Encrypt, **Force SSL**, **HTTP/2** en **HSTS** aan.
Op het **Advanced**-tabblad precies één regel:

```nginx
client_max_body_size 12m;
```

Zonder die regel weigert nginx een foto van 10 MB voordat de app hem ziet. Zet er
géén eigen `Content-Security-Policy` bij: de app stuurt die zelf, en twee policies
naast elkaar betekent in de praktijk dat er stilletjes iets niet meer werkt.

Bij Cloudflare: een A- of AAAA-record naar je publieke IP, of een CNAME naar je
bestaande hostnaam.

### 5. Controleren

```bash
curl -fsS http://127.0.0.1:8099/readyz
```

Dit moet `{"status":"ok","checks":{"database":"ok","publicView":"ok"}}` geven.
Staat `publicView` op `fout`, dan kon de read-only rol niet inloggen; kijk of
`/data/secrets.env` er nog staat.

Eerste account: ga naar `https://kroegen.jouwdomein.nl/registreren`, vul je
`invite_code` in, en maak jezelf daarna beheerder:

```bash
docker exec addon_local_kroegentocht \
  psql -U kroeg -d kroegentocht \
  -c "UPDATE users SET role = 'admin' WHERE username = 'sander';"
```

Zet daarna eventueel `registration_enabled` op `false`.

### 6. Backups

De add-on staat op `backup: cold`. De Supervisor stopt hem dus tijdens een backup;
Postgres krijgt een fast shutdown en de datamap staat schoon op het moment dat de
backup hem inleest. De kaarttegelcache is uitgesloten, want die loopt zichzelf
weer vol.

Twee dingen die je zelf moet regelen:

1. **Maak volledige backups**, geen gedeeltelijke. Alleen die nemen add-ondata mee.
2. **Haal de backups van de machine af.** Een backup op dezelfde schijf is geen
   backup.

Terugzetten gaat via de normale restore van Home Assistant. De add-on start daarna
met de teruggezette database; de migraties draaien opnieuw en zetten de read-only
rol en zijn rechten weer goed.

### Bijwerken

```bash
cd /addons/kroegentocht && git pull
```

Verhoog `version` in `config.yaml` (of laat de nieuwe commit dat doen), en dan
**⋮ → Controleer op updates**. Home Assistant biedt daarna een update aan.

### Als het niet start

**"Vul de opties aan"** in het logboek: de melding zegt per optie wat er mist.

**Permissiefouten van Postgres.** De Supervisor zet een AppArmor-profiel op de
add-on. Kom je daar niet door, zet dan tijdelijk `apparmor: false` in
`config.yaml` om vast te stellen of dat de oorzaak is. Laat het daarna niet zo
staan zonder erover nagedacht te hebben.

**"no such file or directory"** op een pad dat bestaat: CRLF-regeleindes in een
script. Zie de opmerking bij stap 1.

**Bouwfout bij `apt-get`**: de PGDG-repository was niet bereikbaar. Probeer
opnieuw; het is een netwerkfout, geen configuratiefout.

---

## Route B: Portainer-stack

Alleen als route A niet lukt of als je de resourcelimieten echt nodig hebt. Je
data staat dan buiten je Home Assistant backups; regel daar zelf iets voor.

`docker compose` bestaat niet op HA OS: de host heeft alleen de `docker`-CLI,
zonder de compose-plugin. Ook via de debug-SSH op poort 22222 kun je dus geen
`docker compose up` draaien. De Portainer-add-on brengt zijn eigen compose mee en
is daarom de enige praktische route.

`compose.hassio.yaml` past de stack aan voor deze machine: zuiniger
resourcelimieten, de api ook op het `hassio`-netwerk zodat de proxy erbij kan
zonder poort op de host, en de backups naar `/share` in plaats van naar een
Docker-volume, want `/share` gaat wél mee in een volledige Home Assistant backup.

### Voorbereiden

```bash
mkdir -p /share/kroegentocht-backups
chown 70:70 /share/kroegentocht-backups
ls -d /mnt/data/supervisor/share
df -h /mnt/data
docker network ls | grep hassio
```

Uid 70 is de postgres-gebruiker waaronder de backupcontainer draait. Wijkt het pad
van `/share` af, pas dan de bind mount in `compose.hassio.yaml` aan.

Geheimen genereren, drie keer:

```bash
openssl rand -hex 24
```

Hexadecimaal en niet base64: base64 kan een `/` of `@` bevatten en die breken een
connection-URL.

### Uitrollen

**Stacks → Add stack → Repository.**

| Veld | Waarde |
| --- | --- |
| Name | `kroegentocht` |
| Repository URL | je repo-URL |
| Repository reference | `refs/heads/main` |
| Compose path | `compose.yaml` |
| Additional paths | `compose.hassio.yaml` |
| Authentication | aan bij een privérepo, met een read-only token |

Noem de stack echt `kroegentocht`: Portainer gebruikt de stacknaam als
compose-projectnaam, dus dan heten de volumes `kroegentocht_pgdata` en
`kroegentocht_media`, net als in de README.

Heeft jouw Portainer geen veld **Additional paths**, dan kan hij maar één
compose-bestand aan. Voeg in dat geval de inhoud van `compose.hassio.yaml` met de
hand samen in `compose.yaml`, of gebruik alleen `compose.yaml` en accepteer de
zwaardere resourcelimieten plus een poort op de host.

Bij **Environment variables** (Advanced mode aan, dan kun je plakken):

```
POSTGRES_PASSWORD=<geheim 1>
PUBLIC_DB_PASSWORD=<geheim 2>
SESSION_SECRET=<geheim 3>
INVITE_CODE=<zelf kiezen, minimaal 6 tekens>
PUBLIC_BASE_URL=https://kroegen.jouwdomein.nl
CONTACT_EMAIL=jij@jouwdomein.nl
TZ=Europe/Amsterdam
API_BIND=127.0.0.1
API_PORT=8080
```

Reverse proxy, controleren en het eerste account gaan verder als bij route A, met
`kroegentocht-api` poort `3000` als forwardadres en `http://127.0.0.1:8080/readyz`
als controle.
