function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const statusPill = document.getElementById("statusPill");
const enableBtn = document.getElementById("enableBtn");
const testBtn = document.getElementById("testBtn");
const searchList = document.getElementById("searchList");
const searchForm = document.getElementById("searchForm");

async function settStatus() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    statusPill.textContent = "ikke støttet i denne nettleseren";
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    statusPill.textContent = "varsler på";
    statusPill.classList.add("on");
  } else {
    statusPill.textContent = "varsler av";
    statusPill.classList.remove("on");
  }
}

async function skruPaVarsler() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    alert("Denne nettleseren støtter ikke push-varsler. På iPhone: legg funn.no til på hjemskjermen først, og åpne den derfra.");
    return;
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    alert("Du må gi tillatelse til varsler for at dette skal fungere.");
    return;
  }

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const { key } = await fetch("/api/vapid-public-key").then((r) => r.json());
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });

  await fetch("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });

  await settStatus();
  alert("Varsler er nå skrudd på!");
}

async function lastSok() {
  const sok = await fetch("/api/searches").then((r) => r.json());
  searchList.innerHTML = "";
  if (sok.length === 0) {
    searchList.innerHTML = '<div class="empty">Ingen søk lagt til enda.</div>';
    return;
  }
  sok.forEach((s) => {
    const el = document.createElement("div");
    el.className = "search-item";
    el.innerHTML = `
      <div>
        <div>${s.navn}</div>
        <div class="meta">maks ${s.maksPris} kr ${s.verifisertKunSelger ? "· kun verifiserte" : ""}</div>
      </div>
      <button data-id="${s.id}" title="Slett">✕</button>
    `;
    el.querySelector("button").onclick = async () => {
      await fetch(`/api/searches/${s.id}`, { method: "DELETE" });
      lastSok();
    };
    searchList.appendChild(el);
  });
}

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    navn: document.getElementById("navn").value,
    url: document.getElementById("url").value,
    maksPris: document.getElementById("maksPris").value,
    verifisertKunSelger: document.getElementById("verifisert").checked,
  };
  await fetch("/api/searches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  searchForm.reset();
  lastSok();
});

enableBtn.addEventListener("click", skruPaVarsler);
testBtn.addEventListener("click", () => fetch("/api/test-varsel", { method: "POST" }));

settStatus();
lastSok();
