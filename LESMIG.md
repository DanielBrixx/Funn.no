# funn.no – PWA med ekte push-varsler

Dette er en komplett, fungerende nettside (Progressive Web App) som:
- Overvåker FINN.no-søk du legger inn
- Leser beskrivelsen på hver annonse for å finne REELL pris (f.eks. "pris per kort")
- Filtrerer på maks pris og verifisert selger
- Sender ekte push-varsler til iPhonen din når den er lagt til på hjemskjermen

## Viktig å vite

- **Krever iOS 16.4 eller nyere** for at web push skal fungere på iPhone.
- Varsler fungerer **kun** når siden er lagt til på hjemskjermen via Safari –
  ikke i en vanlig nettleser-fane.
- Serveren må kjøre kontinuerlig et sted (den kan ikke bo på telefonen din).
  Se seksjon "Sett den i drift" nedenfor.
- Dette leser FINNs offentlige nettsider, ikke et offisielt API. FINNs
  brukervilkår tillater i utgangspunktet ikke automatisert uthenting av data.
  Behold sjekkeintervallet romslig (standard: 10 minutter) og bruk kun privat.
- FINN kan endre HTML-strukturen sin når de vil. Hvis ingen annonser blir
  funnet, se kommentarene merket "JUSTER VED BEHOV" i `server.js` – da må du
  åpne finn.no, høyreklikke en annonse -> "Inspiser", og oppdatere CSS-
  selektorene til det som faktisk står i koden nå.

## Kjøre lokalt (for testing)

```bash
npm install
npm start
```

Åpne `http://localhost:3000` i nettleseren. Push-varsler krever HTTPS og en
ekte hjemskjerm-installasjon, så for å faktisk teste på iPhonen må du sette
den i drift et sted som er tilgjengelig fra internett (se under).

## Sett den i drift (nødvendig for ekte varsler på iPhone)

Du trenger et sted som kjører Node.js kontinuerlig med HTTPS. Enkleste gratis-
/billig-alternativer:

**Render.com** (enklest, gratis-tier finnes)
1. Last opp denne mappen til et GitHub-repo
2. Render.com -> New -> Web Service -> koble til repoet
3. Build command: `npm install`, Start command: `npm start`
4. Render gir deg automatisk en `https://dittnavn.onrender.com`-adresse

**Railway.app** eller **Fly.io** fungerer på samme måte.

**Egen server / Raspberry Pi**
Krever at du selv setter opp HTTPS (f.eks. med Caddy eller nginx + Let's
Encrypt) og en domenenavn som peker til den.

## Etter driftsetting

1. Åpne `https://din-adresse` i Safari på iPhonen
2. Del-knappen -> "Legg til på Hjem-skjerm"
3. Åpne funn.no fra hjemskjermen (viktig – ikke fra Safari-fanen)
4. Trykk "Skru på varsler på denne enheten" og godta
5. Legg til FINN-søkene dine i appen
6. Vent (eller trykk "Send meg et testvarsel" for å bekrefte at det fungerer)

## Egne VAPID-nøkler (valgfritt)

Serveren bruker et allerede generert nøkkelpar. Vil du ha dine egne (f.eks.
hvis du deler koden videre), kjør:

```bash
npx web-push generate-vapid-keys
```

og lim inn de nye nøklene i `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` i
`server.js`.
