import Anthropic from "@anthropic-ai/sdk";
import type { DetectedItem, Match } from "./types";

const MODEL = "claude-opus-5-5";
// Si el modelo rechaza una petición, la API la reintenta con otro modelo.
const BETAS = ["server-side-fallback-2026-07-01"];

function client(apiKey: string) {
  // App personal: la clave vive solo en tu navegador (localStorage).
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

function imageBlock(dataUrl: string) {
  const [meta, data] = dataUrl.split(",");
  const media = meta.match(/data:(.*);base64/)?.[1] ?? "image/jpeg";
  return {
    type: "image" as const,
    source: { type: "base64" as const, media_type: media as "image/jpeg", data },
  };
}

function textOf(msg: Anthropic.Beta.BetaMessage): string {
  return msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function checkStop(msg: Anthropic.Beta.BetaMessage) {
  if (msg.stop_reason === "refusal") throw new Error("El modelo ha rechazado la petición.");
}

/* ---------- 1. Detectar prendas ---------- */

const DETECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["categoria", "nombre", "descripcion", "color", "marca", "busqueda", "caja"],
        properties: {
          categoria: { type: "string", description: "gorra, chaqueta, sudadera, camiseta, vaqueros, pantalón, gafas, zapatillas, bolso, etc." },
          nombre: { type: "string", description: "Nombre corto para mostrar (máx. 4 palabras)" },
          descripcion: { type: "string", description: "Descripción visual precisa: corte, material, estampado, detalles" },
          color: { type: "string" },
          marca: { type: "string", description: "Marca/modelo si se reconoce con seguridad (logo visible). Vacío si no." },
          busqueda: { type: "string", description: "Consulta de búsqueda óptima para encontrar la prenda en tiendas" },
          caja: {
            type: "array",
            description: "Caja [x1,y1,x2,y2] normalizada 0-1000 respecto a la imagen",
            items: { type: "integer" },
          },
        },
      },
    },
  },
} as const;

export async function detectItems(apiKey: string, dataUrl: string): Promise<DetectedItem[]> {
  const msg = await client(apiKey).beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: BETAS,
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: DETECT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          imageBlock(dataUrl),
          {
            type: "text",
            text:
              "Detecta cada prenda y accesorio visible en esta imagen (gorra, chaqueta, sudadera, camiseta, vaqueros, gafas, calzado, bolso, joyas...). " +
              "Una entrada por pieza. Ignora piezas casi ocultas. Ordénalas de arriba a abajo. Textos en español.",
          },
        ],
      },
    ],
  });
  checkStop(msg);
  const parsed = JSON.parse(textOf(msg)) as { items: Omit<DetectedItem, "id">[] };
  return parsed.items.map((it, i) => ({ ...it, id: `i${Date.now()}_${i}` }));
}

/* ---------- 2. Buscar coincidencias ---------- */

export async function findMatches(
  apiKey: string,
  dataUrl: string,
  item: DetectedItem,
  country: string,
): Promise<Match[]> {
  const c = client(apiKey);
  const prompt =
    `Busca en la web dónde comprar esta prenda: "${item.nombre}" — ${item.descripcion}. Color: ${item.color}.` +
    (item.marca ? ` Marca probable: ${item.marca}.` : "") +
    ` Consulta sugerida: "${item.busqueda}". La imagen adjunta es el outfit; la prenda está en la caja ${JSON.stringify(item.caja)} (0-1000).\n\n` +
    `Comprador en ${country}. Busca:\n` +
    `- La pieza exacta si existe (web oficial de la marca, Zalando, ASOS, Zara, Amazon, El Corte Inglés, etc.).\n` +
    `- Alternativas parecidas más baratas.\n` +
    `- Segunda mano y vintage (Vinted, Wallapop, eBay, Vestiaire Collective, Depop, Grailed).\n\n` +
    `Reglas: usa solo URLs de producto que hayas visto en los resultados de búsqueda; no inventes URLs ni precios. ` +
    `Si no ves el precio, pon null. Máximo 10 resultados, el más parecido primero.\n\n` +
    `Responde SOLO con JSON, sin texto alrededor, con esta forma:\n` +
    `{"resultados":[{"titulo":"","tienda":"","precio":12.5,"moneda":"EUR","url":"https://...","tipo":"nuevo|segunda_mano","exacto":true,"parecido":0-100}]}`;

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: [imageBlock(dataUrl), { type: "text", text: prompt }] },
  ];

  let msg: Anthropic.Beta.BetaMessage | undefined;
  // pause_turn: la búsqueda web puede pausar el turno; se continúa reenviando.
  for (let i = 0; i < 4; i++) {
    msg = await c.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 32000,
        betas: BETAS,
        fallbacks: "default",
        output_config: { effort: "medium" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
        messages,
      })
      .finalMessage();
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  if (!msg) return [];
  checkStop(msg);

  const raw = textOf(msg);
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  let data: { resultados?: Omit<Match, "itemId">[] };
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Respuesta no válida al buscar resultados.");
  }
  return (data.resultados ?? [])
    .filter((r) => typeof r.url === "string" && /^https?:\/\//.test(r.url))
    .map((r) => ({ ...r, itemId: item.id, precio: typeof r.precio === "number" ? r.precio : null }));
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "API key no válida. Revísala en Ajustes.";
  if (e instanceof Anthropic.RateLimitError) return "Demasiadas peticiones. Espera unos segundos.";
  if (e instanceof Anthropic.APIConnectionError) return "Sin conexión con la API.";
  if (e instanceof Anthropic.APIError) return `Error de la API (${e.status}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
