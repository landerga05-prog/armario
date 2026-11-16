import "./style.css";
import { describeError, detectItems, findMatches } from "./claude";
import { attachCropper, cropToDataUrl, dataUrlToImage, loadFile } from "./image";
import {
  deleteScan,
  getFavorites,
  getScans,
  isFavorite,
  saveScan,
  settings,
  toggleFavorite,
} from "./store";
import type { DetectedItem, Match, Scan } from "./types";

const app = document.getElementById("app")!;
const camInput = document.getElementById("file-camera") as HTMLInputElement;
const libInput = document.getElementById("file-library") as HTMLInputElement;

/* ---------- utilidades ---------- */

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function h(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function price(m: Match) {
  if (m.precio == null) return "—";
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: m.moneda || "EUR" }).format(m.precio);
  } catch {
    return `${m.precio} ${m.moneda}`;
  }
}

function toast(msg: string) {
  const t = h(`<div class="toast">${esc(msg)}</div>`);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

async function share(title: string, url: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
    } catch {
      /* cancelado */
    }
  } else {
    await navigator.clipboard.writeText(url);
    toast("Enlace copiado");
  }
}

function storeLinks(q: string) {
  const e = encodeURIComponent(q);
  return [
    ["Google Shopping", `https://www.google.com/search?tbm=shop&q=${e}`],
    ["Vinted", `https://www.vinted.es/catalog?search_text=${e}`],
    ["Wallapop", `https://es.wallapop.com/app/search?keywords=${e}`],
    ["Zalando", `https://www.zalando.es/catalogo/?q=${e}`],
    ["ASOS", `https://www.asos.com/es/search/?q=${e}`],
    ["Amazon", `https://www.amazon.es/s?k=${e}`],
    ["eBay", `https://www.ebay.es/sch/i.html?_nkw=${e}`],
  ];
}

/* ---------- navegación ---------- */

type Tab = "scan" | "closet" | "settings";

function setTab(tab: Tab) {
  document.querySelectorAll<HTMLButtonElement>(".tabbar button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab),
  );
  if (tab === "scan") renderHome();
  if (tab === "closet") renderCloset();
  if (tab === "settings") renderSettings();
  window.scrollTo(0, 0);
}

document.querySelectorAll<HTMLButtonElement>(".tabbar button").forEach((b) =>
  b.addEventListener("click", () => setTab(b.dataset.tab as Tab)),
);

/* ---------- 1. Inicio ---------- */

function renderHome() {
  const scans = getScans();
  app.innerHTML = "";
  const el = h(`
    <section class="screen">
      <header class="hero">
        <h1>Armario</h1>
        <p>Foto o captura → recorta → encuentra cada prenda, nueva o de segunda mano.</p>
      </header>
      <div class="big-actions">
        <button class="btn primary" id="cam">📷 Cámara</button>
        <button class="btn" id="lib">🖼️ Fotos / capturas</button>
      </div>
      ${settings.apiKey ? "" : `<p class="warn">Falta tu API key de Anthropic. Ponla en <a href="#" id="go-settings">Ajustes</a>.</p>`}
      <h2>Escaneos recientes</h2>
      <div class="recent">
        ${
          scans.length
            ? scans
                .map(
                  (s) => `<button class="recent-card" data-id="${s.id}">
                    <img src="${s.thumb}" alt="" />
                    <span>${s.items.length} prendas · ${new Date(s.fecha).toLocaleDateString("es-ES")}</span>
                  </button>`,
                )
                .join("")
            : `<p class="muted">Aún no hay escaneos.</p>`
        }
      </div>
    </section>`);
  app.append(el);
  el.querySelector("#cam")!.addEventListener("click", () => camInput.click());
  el.querySelector("#lib")!.addEventListener("click", () => libInput.click());
  el.querySelector("#go-settings")?.addEventListener("click", (e) => {
    e.preventDefault();
    setTab("settings");
  });
  el.querySelectorAll<HTMLButtonElement>(".recent-card").forEach((b) =>
    b.addEventListener("click", () => {
      const scan = getScans().find((s) => s.id === b.dataset.id);
      if (scan) renderResults(scan, scan.thumb, false);
    }),
  );
}

for (const input of [camInput, libInput]) {
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    renderCrop(await loadFile(file));
  });
}

/* ---------- 2. Recorte ---------- */

function renderCrop(img: HTMLImageElement) {
  app.innerHTML = "";
  const el = h(`
    <section class="screen">
      <h2>Recorta lo que te interesa</h2>
      <p class="muted">Arrastra para seleccionar. Toca una vez para usar la imagen entera.</p>
      <div id="crop"></div>
      <div class="row">
        <button class="btn" id="back">Cancelar</button>
        <button class="btn primary" id="go">Detectar prendas</button>
      </div>
    </section>`);
  app.append(el);
  const cropper = attachCropper(el.querySelector("#crop")!, img);
  el.querySelector("#back")!.addEventListener("click", () => renderHome());
  el.querySelector("#go")!.addEventListener("click", () => {
    const dataUrl = cropToDataUrl(img, cropper.rect());
    renderDetect(dataUrl);
  });
}

/* ---------- 3. Detección y selección ---------- */

async function renderDetect(dataUrl: string) {
  if (!settings.apiKey) {
    toast("Pon tu API key en Ajustes");
    setTab("settings");
    return;
  }
  app.innerHTML = "";
  const el = h(`
    <section class="screen">
      <div class="stage"><img src="${dataUrl}" alt="" /><div class="boxes"></div></div>
      <p class="status"><span class="spinner"></span> Detectando prendas…</p>
    </section>`);
  app.append(el);

  let items: DetectedItem[];
  try {
    items = await detectItems(settings.apiKey, dataUrl);
  } catch (e) {
    el.querySelector(".status")!.innerHTML = `<span class="error">${esc(describeError(e))}</span>
      <button class="btn small" id="retry">Reintentar</button>`;
    el.querySelector("#retry")!.addEventListener("click", () => renderDetect(dataUrl));
    return;
  }
  if (!items.length) {
    el.querySelector(".status")!.textContent = "No he encontrado prendas. Prueba con otro recorte.";
    return;
  }

  // miniaturas por prenda
  const img = await dataUrlToImage(dataUrl);
  for (const it of items) {
    const [x1, y1, x2, y2] = it.caja.length === 4 ? it.caja : [0, 0, 1000, 1000];
    const W = img.naturalWidth / 1000;
    const H = img.naturalHeight / 1000;
    const rect = { x: x1 * W, y: y1 * H, w: Math.max(10, (x2 - x1) * W), h: Math.max(10, (y2 - y1) * H) };
    it.thumb = cropToDataUrl(img, rect, 240, 0.75);
  }

  const selected = new Set(items.map((i) => i.id));
  const boxes = el.querySelector(".boxes")!;
  items.forEach((it, n) => {
    const [x1, y1, x2, y2] = it.caja;
    if (it.caja.length !== 4) return;
    boxes.append(
      h(`<div class="box" data-id="${it.id}" style="left:${x1 / 10}%;top:${y1 / 10}%;width:${(x2 - x1) / 10}%;height:${(y2 - y1) / 10}%"><b>${n + 1}</b></div>`),
    );
  });

  el.querySelector(".status")!.replaceWith(
    h(`<div>
      <h2>Toca las prendas que quieres</h2>
      <div class="chips">${items
        .map(
          (it, n) => `<button class="chip on" data-id="${it.id}">
            <img src="${it.thumb}" alt="" /><span><b>${n + 1}.</b> ${esc(it.nombre)}</span></button>`,
        )
        .join("")}</div>
      <button class="btn primary wide" id="search">Buscar (${items.length})</button>
    </div>`),
  );

  const searchBtn = el.querySelector<HTMLButtonElement>("#search")!;
  const toggle = (id: string) => {
    selected.has(id) ? selected.delete(id) : selected.add(id);
    el.querySelectorAll<HTMLElement>(`[data-id="${id}"]`).forEach((n) => n.classList.toggle("on", selected.has(id)));
    el.querySelectorAll<HTMLElement>(`.box[data-id="${id}"]`).forEach((n) => n.classList.toggle("off", !selected.has(id)));
    searchBtn.textContent = `Buscar (${selected.size})`;
    searchBtn.disabled = selected.size === 0;
  };
  el.querySelectorAll<HTMLElement>("[data-id]").forEach((n) => n.addEventListener("click", () => toggle(n.dataset.id!)));

  searchBtn.addEventListener("click", async () => {
    const thumb = cropToDataUrl(img, { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }, 400, 0.7);
    const scan: Scan = {
      id: `s${Date.now()}`,
      fecha: Date.now(),
      thumb,
      items: items.filter((i) => selected.has(i.id)),
      matches: {},
    };
    renderResults(scan, dataUrl, true);
  });
}

/* ---------- 4. Resultados ---------- */

type Sort = "relevancia" | "precio_asc" | "precio_desc";
type Filter = "todo" | "nuevo" | "segunda_mano";

function renderResults(scan: Scan, dataUrl: string, runSearch: boolean) {
  let sort: Sort = "relevancia";
  let filter: Filter = "todo";
  const expanded = new Set<string>();
  const state: Record<string, "loading" | "done" | string> = {};
  for (const it of scan.items) state[it.id] = scan.matches[it.id] ? "done" : runSearch ? "loading" : "done";

  app.innerHTML = "";
  const el = h(`
    <section class="screen">
      <div class="row between">
        <button class="btn small" id="new">＋ Nuevo escaneo</button>
        ${runSearch ? "" : `<button class="btn small danger" id="del">Borrar</button>`}
      </div>
      <div class="controls">
        <select id="sort">
          <option value="relevancia">Más parecidos</option>
          <option value="precio_asc">Más baratos</option>
          <option value="precio_desc">Más caros</option>
        </select>
        <div class="seg" id="filter">
          <button data-f="todo" class="on">Todo</button>
          <button data-f="nuevo">Nuevo</button>
          <button data-f="segunda_mano">2ª mano</button>
        </div>
      </div>
      <div id="items"></div>
    </section>`);
  app.append(el);
  el.querySelector("#new")!.addEventListener("click", () => renderHome());
  el.querySelector("#del")?.addEventListener("click", () => {
    deleteScan(scan.id);
    renderHome();
  });
  el.querySelector<HTMLSelectElement>("#sort")!.addEventListener("change", (e) => {
    sort = (e.target as HTMLSelectElement).value as Sort;
    draw();
  });
  el.querySelectorAll<HTMLButtonElement>("#filter button").forEach((b) =>
    b.addEventListener("click", () => {
      filter = b.dataset.f as Filter;
      el.querySelectorAll("#filter button").forEach((x) => x.classList.toggle("on", x === b));
      draw();
    }),
  );

  const list = el.querySelector("#items")!;

  function sorted(ms: Match[]) {
    let r = ms.filter((m) => filter === "todo" || m.tipo === filter);
    if (sort === "precio_asc") r = [...r].sort((a, b) => (a.precio ?? 1e9) - (b.precio ?? 1e9));
    if (sort === "precio_desc") r = [...r].sort((a, b) => (b.precio ?? -1) - (a.precio ?? -1));
    return r;
  }

  function matchCard(m: Match, it: DetectedItem, best = false) {
    const fav = isFavorite(m.url);
    return `<div class="match ${best ? "best" : ""}">
      <a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer" class="match-main">
        ${best ? `<span class="tag">Mejor coincidencia</span>` : ""}
        <span class="title">${esc(m.titulo)}</span>
        <span class="meta">${esc(m.tienda)} · ${m.tipo === "segunda_mano" ? "2ª mano" : "Nuevo"}${m.exacto ? " · exacto" : ""}</span>
        <span class="price">${price(m)}</span>
      </a>
      <div class="match-actions">
        <button class="icon fav ${fav ? "on" : ""}" data-url="${esc(m.url)}" data-item="${it.id}" aria-label="Guardar">${fav ? "♥" : "♡"}</button>
        <button class="icon share" data-url="${esc(m.url)}" data-title="${esc(m.titulo)}" aria-label="Compartir">↗</button>
      </div>
    </div>`;
  }

  function draw() {
    list.innerHTML = scan.items
      .map((it) => {
        const st = state[it.id];
        const ms = sorted(scan.matches[it.id] ?? []);
        const open = expanded.has(it.id);
        let body: string;
        if (st === "loading") body = `<p class="status"><span class="spinner"></span> Buscando en tiendas…</p>`;
        else if (st !== "done") body = `<p class="error">${esc(st)}</p><button class="btn small retry" data-id="${it.id}">Reintentar</button>`;
        else if (!ms.length) body = `<p class="muted">Sin resultados con este filtro.</p>`;
        else
          body =
            matchCard(ms[0], it, sort === "relevancia") +
            (open ? ms.slice(1).map((m) => matchCard(m, it)).join("") : "") +
            (ms.length > 1
              ? `<button class="link more" data-id="${it.id}">${open ? "Ver menos" : `Ver los ${ms.length} resultados`}</button>`
              : "");
        return `<article class="item">
          <header><img src="${it.thumb ?? ""}" alt="" />
            <div><h3>${esc(it.nombre)}</h3><p class="muted">${esc(it.color)}${it.marca ? ` · ${esc(it.marca)}` : ""}</p></div>
          </header>
          ${body}
          <details class="stores"><summary>Buscar directamente en…</summary>
            <div>${storeLinks(it.busqueda)
              .map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${n}</a>`)
              .join("")}</div>
          </details>
        </article>`;
      })
      .join("");

    list.querySelectorAll<HTMLButtonElement>(".more").forEach((b) =>
      b.addEventListener("click", () => {
        expanded.has(b.dataset.id!) ? expanded.delete(b.dataset.id!) : expanded.add(b.dataset.id!);
        draw();
      }),
    );
    list.querySelectorAll<HTMLButtonElement>(".retry").forEach((b) =>
      b.addEventListener("click", () => search(scan.items.find((i) => i.id === b.dataset.id)!)),
    );
    list.querySelectorAll<HTMLButtonElement>(".share").forEach((b) =>
      b.addEventListener("click", () => share(b.dataset.title!, b.dataset.url!)),
    );
    list.querySelectorAll<HTMLButtonElement>(".fav").forEach((b) =>
      b.addEventListener("click", () => {
        const it = scan.items.find((i) => i.id === b.dataset.item)!;
        const m = (scan.matches[it.id] ?? []).find((x) => x.url === b.dataset.url)!;
        const on = toggleFavorite({ ...m, savedAt: Date.now(), itemNombre: it.nombre, itemThumb: it.thumb });
        toast(on ? "Guardado en tu Armario" : "Quitado del Armario");
        draw();
      }),
    );
  }

  async function search(it: DetectedItem) {
    state[it.id] = "loading";
    draw();
    try {
      scan.matches[it.id] = await findMatches(settings.apiKey, dataUrl, it, settings.country);
      state[it.id] = "done";
      saveScan(scan);
    } catch (e) {
      state[it.id] = describeError(e);
    }
    draw();
  }

  draw();
  if (runSearch) {
    saveScan(scan);
    // en paralelo: cada prenda aparece en cuanto llegan sus resultados
    scan.items.forEach((it) => void search(it));
  }
}

/* ---------- 5. Armario ---------- */

function renderCloset() {
  const favs = getFavorites();
  app.innerHTML = "";
  const el = h(`
    <section class="screen">
      <h1>Tu Armario</h1>
      <h2>Favoritos (${favs.length})</h2>
      <div class="favs">${
        favs.length
          ? favs
              .map(
                (f) => `<div class="match">
                <img class="fav-thumb" src="${f.itemThumb ?? ""}" alt="" />
                <a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer" class="match-main">
                  <span class="title">${esc(f.titulo)}</span>
                  <span class="meta">${esc(f.tienda)} · ${f.tipo === "segunda_mano" ? "2ª mano" : "Nuevo"}</span>
                  <span class="price">${price(f)}</span>
                </a>
                <div class="match-actions">
                  <button class="icon fav on" data-url="${esc(f.url)}">♥</button>
                  <button class="icon share" data-url="${esc(f.url)}" data-title="${esc(f.titulo)}">↗</button>
                </div></div>`,
              )
              .join("")
          : `<p class="muted">Pulsa ♡ en un resultado para guardarlo aquí.</p>`
      }</div>
      <h2>Escaneos recientes</h2>
      <div class="recent">${getScans()
        .map(
          (s) => `<button class="recent-card" data-id="${s.id}"><img src="${s.thumb}" alt="" />
          <span>${s.items.map((i) => esc(i.nombre)).join(", ")}</span></button>`,
        )
        .join("") || `<p class="muted">Aún no hay escaneos.</p>`}</div>
    </section>`);
  app.append(el);
  el.querySelectorAll<HTMLButtonElement>(".fav").forEach((b) =>
    b.addEventListener("click", () => {
      const f = favs.find((x) => x.url === b.dataset.url)!;
      toggleFavorite(f);
      renderCloset();
    }),
  );
  el.querySelectorAll<HTMLButtonElement>(".share").forEach((b) =>
    b.addEventListener("click", () => share(b.dataset.title!, b.dataset.url!)),
  );
  el.querySelectorAll<HTMLButtonElement>(".recent-card").forEach((b) =>
    b.addEventListener("click", () => {
      const scan = getScans().find((s) => s.id === b.dataset.id);
      if (scan) renderResults(scan, scan.thumb, false);
    }),
  );
}

/* ---------- 6. Ajustes ---------- */

function renderSettings() {
  app.innerHTML = "";
  const el = h(`
    <section class="screen">
      <h1>Ajustes</h1>
      <label>API key de Anthropic
        <input id="key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(settings.apiKey)}" />
      </label>
      <p class="muted small">Se guarda solo en este dispositivo. Consíguela en console.anthropic.com → API Keys.</p>
      <label>País / moneda para buscar
        <input id="country" value="${esc(settings.country)}" />
      </label>
      <button class="btn primary wide" id="save">Guardar</button>
    </section>`);
  app.append(el);
  el.querySelector("#save")!.addEventListener("click", () => {
    settings.apiKey = el.querySelector<HTMLInputElement>("#key")!.value.trim();
    settings.country = el.querySelector<HTMLInputElement>("#country")!.value.trim() || "España (precios en EUR)";
    toast("Guardado");
    setTab("scan");
  });
}

/* ---------- arranque ---------- */

renderHome();
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
