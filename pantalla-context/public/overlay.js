// Muestra el último contexto VERIFICADO. Parámetros: ?entities=0 oculta los datos clave, ?verified=all muestra también
// lo no verificado (atenuado) y ?token=... si el servidor protege la API.
const POLL_MS = 2000;
const MAX_CHIPS = 4;

const params = new URLSearchParams(location.search);
const showEntities = params.get("entities") !== "0";
const query = new URLSearchParams({ format: "json" });
for (const key of ["verified", "token", "max_age"]) if (params.has(key)) query.set(key, params.get(key));
const el = (id) => document.getElementById(id);

let shownAt = null;

function render(latest) {
  el("card").hidden = !latest;
  if (!latest) return;
  el("card").classList.toggle("unverified", latest.verified === false);
  el("activity").textContent = latest.activity;
  el("activity").hidden = !latest.activity;
  el("title").textContent = latest.title;
  el("summary").textContent = latest.summary;
  el("entities").replaceChildren(
    ...(showEntities ? latest.entities.slice(0, MAX_CHIPS) : []).map((e) => {
      const li = document.createElement("li");
      const label = document.createElement("b");
      label.textContent = `${e.label}: `;
      li.append(label, e.value);
      return li;
    }),
  );
}

async function poll() {
  try {
    const { latest } = await (await fetch(`/api/context?${query}`, { cache: "no-store" })).json();
    // Solo repintamos cuando hay un análisis nuevo, para no reiniciar la animación.
    if ((latest?.at ?? null) !== shownAt) {
      shownAt = latest?.at ?? null;
      render(latest);
    }
  } catch {
    // Servidor no disponible: conservamos lo que ya se muestra y reintentamos.
  }
}

poll();
setInterval(poll, POLL_MS);
