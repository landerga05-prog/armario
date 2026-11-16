# Armario

App web personal (instalable en el iPhone) para encontrar ropa a partir de una foto.

**Foto → recorte → detecta prendas → buscas cada una, nueva o de segunda mano.**

## Qué hace

- Cámara o foto/captura de la galería.
- Recorte: arrastra sobre la parte que te interesa (un toque = imagen entera).
- Detección con IA de cada pieza (gorra, chaqueta, sudadera, vaqueros, gafas, calzado…) con caja numerada.
- Eliges las piezas y los resultados llegan por prenda en paralelo, según terminan.
- Por prenda: mejor coincidencia, "ver todos", orden por precio, filtro Nuevo / 2ª mano.
- Tiendas nuevas (Zalando, ASOS, Zara, Amazon…) y segunda mano (Vinted, Wallapop, eBay, Vestiaire…).
- Enlaces directos de búsqueda a 7 tiendas por si quieres mirar tú.
- Armario: favoritos (♡) y escaneos recientes (últimos 20), guardados en el móvil.
- Compartir con un toque. Sin registro. La compra se hace en la web de la tienda.

## Cómo funciona por dentro

- Vite + TypeScript, sin backend. Todo corre en el navegador.
- IA: API de Anthropic (`claude-opus-5-5`) con el SDK oficial.
  1. Detección: visión + salida JSON estructurada (`effort: low`, rápido).
  2. Búsqueda: herramienta de búsqueda web de Claude, una llamada por prenda.
- Tu API key se guarda solo en `localStorage` del dispositivo.

## Puesta en marcha

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # genera dist/
```

1. Crea una API key en console.anthropic.com → API Keys (necesita saldo).
2. Abre la app → Ajustes → pega la key.

### Publicarla e instalarla en el iPhone

1. En GitHub: Settings → Pages → Source: **GitHub Actions**.
2. Haz merge a `main`: el workflow `.github/workflows/pages.yml` la publica en
   `https://<usuario>.github.io/armario/`.
3. En el iPhone, abre esa URL en Safari → Compartir → **Añadir a pantalla de inicio**.

## Coste aproximado

Cada escaneo = 1 llamada de detección + 1 llamada con búsqueda web por prenda.
Las búsquedas web se cobran aparte (≈10 $ / 1.000 búsquedas; máx. 6 por prenda).

## Límites

- La clave va en el navegador: es aceptable para uso personal, **no** para publicar la app a terceros
  (ahí haría falta un backend propio que guarde la clave).
- Los precios y enlaces salen de la búsqueda web; pueden estar desactualizados.
