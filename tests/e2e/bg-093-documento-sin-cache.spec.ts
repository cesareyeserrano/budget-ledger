/**
 * BG-093 — el documento de la app nunca se sirve desde caché.
 *
 * Reportado por el usuario el 2026-10-05: en producción «volvió» BG-089 (un comentario escrito en
 * Presupuestado quedaba en Ejecutado) y la celda de Presupuestado seguía mostrando el formulario de
 * movimientos que se retiró el 2-oct. El servidor tenía el código nuevo; el navegador corría el de
 * antes. La página salía prerenderizada con `Cache-Control: s-maxage=31536000` y sin `no-cache`, así
 * que un navegador podía seguir abriendo el HTML de un despliegue anterior —que apunta a su JavaScript
 * viejo, inmutable y también en caché— contra el servidor nuevo.
 *
 * La suite corre contra la compilación de PRODUCCIÓN, que es donde existía el fallo (en `next dev` el
 * documento ya sale con `no-store`).
 */
import { test, expect } from "./helpers/fixtures";

const PAGINAS = ["/", "/configuracion", "/recuperar"];

test.describe("BG-093 · el documento no se cachea", () => {
  for (const ruta of PAGINAS) {
    test(`BG-093: ${ruta} sale con no-store y sin vida para cachés compartidas`, async ({ request }) => {
      const res = await request.get(ruta, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      const cache = (res.headers()["cache-control"] ?? "").toLowerCase();
      expect(cache, `Cache-Control de ${ruta}`).toContain("no-store");
      expect(cache).not.toContain("s-maxage");
      expect(res.headers()["x-nextjs-prerender"]).toBeUndefined();
    });
  }

  test("BG-093: el JavaScript con hash sigue cacheado para siempre (no se paga en cada carga)", async ({ request }) => {
    const html = await (await request.get("/")).text();
    const chunk = html.match(/\/_next\/static\/chunks\/[^"]+\.js/)?.[0];
    expect(chunk, "la página referencia al menos un chunk").toBeTruthy();
    const cache = ((await request.get(chunk!)).headers()["cache-control"] ?? "").toLowerCase();
    expect(cache).toContain("immutable");
    expect(cache).toContain("max-age=31536000");
  });
});
