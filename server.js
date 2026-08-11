/**
 * funn.no – server
 *
 * Sjekker FINN.no-søk med jevne mellomrom, leser annonsebeskrivelser for å
 * regne ut REELL pris (f.eks. "pris per kort"), og sender EKTE push-varsler
 * til alle enheter som har lagt funn.no på hjemskjermen og skrudd på varsler.
 *
 * VIKTIG:
 * - Dette leser FINNs offentlige nettsider, ikke et offisielt API. Sjekk
 *   sjelden (standard: hvert 10. minutt) og bruk kun til privat bruk.
 * - FINN kan endre HTML-strukturen sin. Se SELECTORS-kommentarene i
 *   hentAnnonser() / hentFullBeskrivelse() hvis ingenting blir funnet.
 * - Web push på iPhone krever iOS 16.4+, at siden kjører over HTTPS, og at
 *   du har lagt siden til på hjemskjermen (Del-knappen -> "Legg til på
 *   Hjem-skjerm") FØR du trykker "Skru på varsler".
 */

const express = require("express");
const webpush = require("web-push");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DB_FILE = path.join(__dirname, "db.json");
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutter

// ---- VAPID-nøkler (identifiserer DIN server til nettleserens push-tjeneste) ----
// Disse er allerede generert til deg. Vil du ha dine egne, kjør:
//   npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY =
  "BFxL_Z9XYS3iNbd8SFqSl7bexUUllNEqyGLFg3mqGoOjTUCVNc_VJbkICztCF99Dj7npULy59bhUaeLOI5iwsf0";
const VAPID_PRIVATE_KEY = "QhsaqNOTrl3JgY_vkAujK9wN58I5eeCFn-OV9FTby-s";

webpush.setVapidDetails(
  "mailto:ingen@eksempel.no",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

// ==================== ENKEL FILBASERT LAGRING ====================

function lastDb() {
  if (!fs.existsSync(DB_FILE)) {
    return { searches: [], subscriptions: [], seen: [] };
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function lagreDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ==================== SMART PRISGJENKJENNING ====================

const PER_ENHET_MØNSTER =
  /pris(?:en)?\s*(?:er\s*)?per\s*(kort|stk\.?|stykk|enhet|kg)/i;
const ANTALL_MØNSTER = /(\d+)\s*(kort|stk\.?|stykk|enheter|kg)/i;

function finnReellPris(listetPris, beskrivelse) {
  if (!beskrivelse || listetPris == null) return { pris: listetPris, korrigert: false };
  if (PER_ENHET_MØNSTER.test(beskrivelse)) {
    const m = beskrivelse.match(ANTALL_MØNSTER);
    if (m) {
      const antall = parseInt(m[1], 10);
      return { pris: listetPris * antall, korrigert: true };
    }
  }
  return { pris: listetPris, korrigert: false };
}

// ==================== SKRAPING AV FINN ====================

async function hentAnnonser(sokUrl) {
  const { data: html } = await axios.get(sokUrl, { headers: HTTP_HEADERS, timeout: 15000 });
  const $ = cheerio.load(html);
  const annonser = [];

  // JUSTER VED BEHOV: FINN endrer klassenavn og struktur over tid.
  $("article").each((_, el) => {
    const kort = $(el);
    const lenkeTag = kort.find("a[href*='/bap/forsale/']").first().length
      ? kort.find("a[href*='/bap/forsale/']").first()
      : kort.find("a").first();
    if (!lenkeTag.length) return;

    let lenke = lenkeTag.attr("href") || "";
    if (lenke && !lenke.startsWith("http")) lenke = "https://www.finn.no" + lenke;

    const tittel = kort.find("h2, h3").first().text().trim() || "Uten tittel";
    const kortTekst = kort.text().replace(/\s+/g, " ").trim();
    const prisMatch = kortTekst.match(/(\d[\d\s]*)\s*kr/);
    const pris = prisMatch ? parseInt(prisMatch[1].replace(/\s/g, ""), 10) : null;
    const verifisert = /verifisert/i.test(kortTekst);

    annonser.push({ id: lenke, tittel, pris, lenke, verifisert });
  });

  return annonser;
}

async function hentFullBeskrivelse(annonseUrl) {
  try {
    const { data: html } = await axios.get(annonseUrl, { headers: HTTP_HEADERS, timeout: 15000 });
    const $ = cheerio.load(html);
    // JUSTER VED BEHOV: pek på selve beskrivelsesfeltet for bedre nøyaktighet.
    return $("main").text().replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

// ==================== SEND EKTE PUSH-VARSEL ====================

async function sendVarselTilAlle(db, tittel, tekst, url) {
  const gjenlevende = [];
  for (const sub of db.subscriptions) {
    try {
      await webpush.sendNotification(
        sub,
        JSON.stringify({ title: tittel, body: tekst, url })
      );
      gjenlevende.push(sub);
    } catch (e) {
      // 410/404 = abonnementet er utløpt (f.eks. avinstallert) -> fjern det
      if (e.statusCode !== 410 && e.statusCode !== 404) gjenlevende.push(sub);
    }
  }
  db.subscriptions = gjenlevende;
}

// ==================== HOVEDLOGIKK ====================

async function sjekkAlleSok() {
  const db = lastDb();
  const settIdSet = new Set(db.seen);

  for (const sok of db.searches) {
    console.log(`Sjekker søk: ${sok.navn}...`);
    let annonser;
    try {
      annonser = await hentAnnonser(sok.url);
    } catch (e) {
      console.log(`  Kunne ikke hente søket: ${e.message}`);
      continue;
    }

    for (const annonse of annonser) {
      if (settIdSet.has(annonse.id)) continue;

      const fullBeskrivelse = await hentFullBeskrivelse(annonse.lenke);
      const { pris: reellPris, korrigert } = finnReellPris(annonse.pris, fullBeskrivelse);

      if (sok.verifisertKunSelger && !annonse.verifisert) {
        settIdSet.add(annonse.id);
        continue;
      }
      if (reellPris != null && reellPris > sok.maksPris) {
        settIdSet.add(annonse.id);
        continue;
      }

      const merknad = korrigert
        ? ` ⚠️ Pris er PER enhet – reell totalpris er ${reellPris} kr, ikke ${annonse.pris} kr!`
        : "";
      const tittel = `🎯 Funn: ${sok.navn}`;
      const tekst = `${annonse.tittel} – ${annonse.pris} kr.${merknad}`;

      console.log(`  Nytt funn -> sender varsel: ${tekst}`);
      await sendVarselTilAlle(db, tittel, tekst, annonse.lenke);

      settIdSet.add(annonse.id);
      await new Promise((r) => setTimeout(r, 2000)); // vær grei mot FINN sine servere
    }
  }

  db.seen = Array.from(settIdSet);
  lagreDb(db);
}

// ==================== API ====================

app.get("/api/vapid-public-key", (_req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY });
});

app.get("/api/searches", (_req, res) => {
  res.json(lastDb().searches);
});

app.post("/api/searches", (req, res) => {
  const { navn, url, maksPris, verifisertKunSelger } = req.body;
  if (!navn || !url || !maksPris) {
    return res.status(400).json({ error: "navn, url og maksPris er påkrevd" });
  }
  const db = lastDb();
  const nyttSok = {
    id: Date.now().toString(),
    navn,
    url,
    maksPris: Number(maksPris),
    verifisertKunSelger: Boolean(verifisertKunSelger),
  };
  db.searches.push(nyttSok);
  lagreDb(db);
  res.json(nyttSok);
});

app.delete("/api/searches/:id", (req, res) => {
  const db = lastDb();
  db.searches = db.searches.filter((s) => s.id !== req.params.id);
  lagreDb(db);
  res.json({ ok: true });
});

app.post("/api/subscribe", (req, res) => {
  const db = lastDb();
  const sub = req.body;
  const finnesAllerede = db.subscriptions.some((s) => s.endpoint === sub.endpoint);
  if (!finnesAllerede) db.subscriptions.push(sub);
  lagreDb(db);
  res.json({ ok: true });
});

app.post("/api/test-varsel", async (_req, res) => {
  const db = lastDb();
  await sendVarselTilAlle(
    db,
    "🎯 Testvarsel fra funn.no",
    "Hvis du ser dette, fungerer varslingen din!",
    "/"
  );
  res.json({ ok: true, antallMottakere: db.subscriptions.length });
});

// ==================== START ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`funn.no kjører på http://localhost:${PORT}`);
  console.log(`Sjekker FINN hvert ${CHECK_INTERVAL_MS / 60000}. minutt.`);
});

sjekkAlleSok();
setInterval(sjekkAlleSok, CHECK_INTERVAL_MS);
