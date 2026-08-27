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
> aan foto's dan een appliance-OS.

---

## Route A: als Home Assistant add-on

De add-on wordt **niet op je toestel gebouwd**. Het image komt kant en klaar uit
GitHub Container Registry, gebouwd door de CI van deze repo.

Dat is geen luiheid maar noodzaak. Op Home Assistant OS krijgt de build-container
van BuildKit geen DNS-namen opgelost, ook niet als de Supervisor-DNS gewoon werkt
(`nslookup` in de terminal lukt, `apt-get` in de build niet). De build strandt dan
na vier minuten wachten op:

```
Temporary failure resolving 'deb.debian.org'
E: Package 'gnupg' has no installation candidate
```

Images **ophalen** lukt op diezelfde machine wel. Vandaar deze opzet. Bijkomende
voordelen: installeren duurt een minuut in plaats van twintig, en de Supervisor
blokkeert een pull niet als je systeem als `unsupported` staat gemarkeerd — een
build wél.

### 1. Zorg dat het image gepubliceerd is

Push naar `main`. De CI bouwt het add-onimage, draait er een smoketest op (de
add-on wordt echt gestart en `/readyz` moet `database: ok` en `publicView: ok`
geven) en pusht daarna naar:

```
ghcr.io/sanderrtjee/kroegentocht-amd64:1.0.0
```

**De eerste keer staat dat pakket op private.** Zet het eenmalig op publiek:
GitHub → je profielfoto → **Packages** → `kroegentocht-amd64` → **Package
settings** → **Change visibility** → Public. Anders kan je Home Assistant het niet
ophalen zonder inloggegevens.

Controleer of het er staat:

```bash
docker pull ghcr.io/sanderrtjee/kroegentocht-amd64:1.0.0
```

Of gewoon in de browser: github.com/Sanderrtjee?tab=packages

### 2. Repository toevoegen in Home Assistant

Dit is waar dat **Add repository**-venster voor is.

**Instellingen → Add-ons → Add-on store → ⋮ rechtsboven → Repositories.** Plak:

```
https://github.com/Sanderrtjee/kroegentocht
```

**Add**, dan het venster sluiten. Onderaan de store staat nu een kop
**Kroegentocht** met de add-on eronder. Openen → **Installeren**. Dat duurt nu
ongeveer een minuut: hij haalt alleen het image op.

Staat hij er niet, dan **⋮ → Controleer op updates**. Werkt dat niet omdat je
systeem als unsupported staat gemarkeerd (`StoreManager.reload blocked from
execution`), herstart dan de Supervisor; die leest de store bij het starten
opnieuw in via een pad dat niet geblokkeerd wordt:

```bash
ha supervisor restart
```

Had je eerder de repo naar `/addons/kroegentocht` gekloond, ruim die dan op —
anders heb je de add-on twee keer:

```bash
rm -rf /addons/kroegentocht
```

### 2b. Als het toevoegen van de repository geblokkeerd wordt

Staat je systeem als `unsupported` gemarkeerd, dan weigert de Supervisor **alle**
StoreManager-acties:

```
Error: 'StoreManager.add_repository' blocked from execution, unsupported OS version
```

Dan is er een omweg die wel werkt. Een **lokale** add-on in `/addons` wordt niet
via StoreManager ingelezen maar bij het starten van de Supervisor, en dat pad is
niet geblokkeerd. En omdat `config.yaml` een `image:` heeft, valt er niets te
bouwen: de Supervisor haalt het image gewoon op.

De add-onmap hoeft daarvoor alleen het manifest te bevatten, niet de broncode:

```bash
git clone --depth 1 https://github.com/Sanderrtjee/kroegentocht.git /tmp/kt && cp -r /tmp/kt/kroegentocht /addons/kroegentocht && rm -rf /tmp/kt
```

In `/addons/kroegentocht` staan daarna vier bestanden: `config.yaml`, `DOCS.md`,
`icon.png` en `logo.png`. Samen een paar kilobyte.

Dan de Supervisor laten herlezen:

```bash
ha supervisor restart
```

Wacht een halve minuut en controleer:

```bash
ha addons info local_kroegentocht 2>&1 | grep -E "^(name|version|state|build|image)"
```

`build: false` en een `image:`-regel betekenen dat hij gaat pullen in plaats van
bouwen. Daarna staat hij in de store onder **Local add-ons** en duurt installeren
ongeveer een minuut.

Bijwerken gaat dan met hetzelfde `git clone`-commando hierboven, gevolgd door
**⋮ → Controleer op updates** of een supervisor-herstart.

Dit is een omweg om een blokkade heen, geen eindstation. Werk je OS bij zodra dat
kan; dan verdwijnt de blokkade en kun je de nette repository-route uit stap 2
gebruiken.

### 3. Configureren en starten

Op het tabblad **Configuratie** minimaal deze drie invullen:

| Optie | Voorbeeld |
| --- | --- |
| `invite_code` | een eigen code van minimaal 6 tekens |
| `public_base_url` | `https://kroegen.jouwdomein.nl` |
| `contact_email` | `jij@jouwdomein.nl` |

Opslaan, dan **Starten**, dan het **Logboek** openen. Daar moet staan:

```
[init-config] Configuratie klaarzetten (bron: supervisor)
[init-config] Eerste start: geheimen genereren in /data/secrets.env
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
docker exec addon_local_kroegentocht psql -U kroeg -d kroegentocht -c "UPDATE users SET role = 'admin' WHERE username = 'sander';"
```

Bij een add-on uit een repository heet de container mogelijk anders; zoek hem op
met het `docker ps`-commando hierboven.

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

1. Verhoog `version` in `kroegentocht/config.yaml`.
2. Commit en push naar `main`. De CI pusht een image met die tag.
3. In Home Assistant: **⋮ → Controleer op updates**. De add-on biedt de update aan.

Het versienummer in `config.yaml` en de gepushte tag moeten gelijk zijn. Wijken ze
af, dan meldt de Supervisor alleen dat het image niet bestaat.

### Als het niet start

**"Vul de opties aan"** in het logboek: de melding zegt per optie wat er mist.

**Image niet te vinden.** Het GHCR-pakket staat nog op private, of de tag bestaat
niet. Controleer beide (zie stap 1).

**Permissiefouten van Postgres.** De Supervisor zet een AppArmor-profiel op de
add-on. Kom je daar niet door, zet dan tijdelijk `apparmor: false` in
`kroegentocht/config.yaml` om vast te stellen of dat de oorzaak is. Laat het daarna
niet zo staan zonder erover nagedacht te hebben.

**`unsupported` blokkeert acties.** Controleer met `ha resolution info` wat er
speelt. Een verouderde OS-versie zet de Supervisor in unsupported-toestand,
waarna hij onder andere de store-reload en het bouwen van add-ons weigert. Een
pull van een bestaand image gaat wel door.

---

## Route B: Portainer-stack

Alleen als route A niet lukt of als je de resourcelimieten echt nodig hebt. Je
data staat dan buiten je Home Assistant backups; regel daar zelf iets voor.

`docker compose` bestaat niet op HA OS: de host heeft alleen de `docker`-CLI,
zonder de compose-plugin. De Portainer-add-on brengt zijn eigen compose mee en is
daarom de enige praktische route.

`compose.hassio.yaml` past de stack aan voor deze machine: zuiniger
resourcelimieten, de api ook op het `hassio`-netwerk zodat de proxy erbij kan
zonder poort op de host, en de backups naar `/share` in plaats van naar een
Docker-volume, want `/share` gaat wél mee in een volledige Home Assistant backup.

Let op: ook Portainer bouwt met dezelfde Docker-daemon, dus als de
build-container op jouw machine geen DNS heeft, loopt route B op precies hetzelfde
probleem vast.

### Voorbereiden

```bash
mkdir -p /share/kroegentocht-backups
```

```bash
chown 70:70 /share/kroegentocht-backups
```

Uid 70 is de postgres-gebruiker waaronder de backupcontainer draait. Controleer
ook het pad van `/share` en of het netwerk bestaat:

```bash
ls -d /mnt/data/supervisor/share; df -h /mnt/data; docker network ls | grep hassio
```

Wijkt het pad af, pas dan de bind mount in `compose.hassio.yaml` aan.

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
