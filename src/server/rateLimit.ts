// @aitri-trace BG-015 — NFR-1303/FR-1311: el endpoint publico de recuperacion queda acotado.
//
// Módulo:       src/server/rateLimit.ts
// Propósito:    Ventana deslizante en memoria para acotar endpoints públicos que NO pasan por el
//               router HTTP de Better Auth. Existe por BG-015: `rateLimit.customRules` de
//               `server/auth.ts` sólo alcanza a las rutas `/api/auth/*`, y la fachada
//               `/api/v1/recovery/request` llama a `getAuth().api.*` — la API de SERVIDOR—, que
//               esquiva ese limitador por completo. Medido el 2026-08-27: 12 peticiones seguidas
//               al endpoint público devolvían 200 las 12 y salían 12 correos. Cero 429.
// Dependencias: ninguna. En memoria a propósito: el despliegue es de una sola instancia (Ultron),
//               así que un contador compartido en proceso es suficiente y no añade infraestructura.
//               Si algún día hay varias réplicas, esto necesita un almacén compartido.

/** Marcas de tiempo de los intentos vivos de cada clave. */
const buckets = new Map<string, number[]>();

/**
 * ¿Están apagados los límites? Solo en los arneses de prueba: todo el tráfico de los tests viene de
 * 127.0.0.1 y compartiría cubo, haciendo flaky la suite en serie. En producción quedan SIEMPRE activos.
 *
 * BG-048 (RQ-SEC-109): el interruptor `LEDGER_RATE_LIMIT_DISABLED` solo actúa si además está abierta
 * la puerta de pruebas `LEDGER_TEST_OVERRIDES=1`, la misma que protege el reloj (`clock.ts`). Antes
 * bastaba el interruptor: copiarlo por descuido al `.env` de producción apagaba el anti-fuerza-bruta
 * del login sin que nada lo delatara. Un despliegue real no define la puerta, así que el interruptor
 * solo no hace nada. No se usa `NODE_ENV`: el arnés e2e arranca un build de producción.
 *
 * La usan este limitador y el de Better Auth (`server/auth.ts`).
 */
export function rateLimitDisabled(): boolean {
  return process.env.LEDGER_RATE_LIMIT_DISABLED === "true" && process.env.LEDGER_TEST_OVERRIDES === "1";
}

function disabled(): boolean {
  return rateLimitDisabled();
}

/**
 * Registra un intento y dice si se permite.
 *
 * Ventana DESLIZANTE, no por bloques: se descartan las marcas más viejas que la ventana y se cuenta
 * lo que queda. Un limitador por bloques deja pasar el doble del límite a caballo entre dos bloques.
 *
 * @param key Identidad del cubo (p. ej. `recovery:ip:1.2.3.4` o `recovery:email:a@b.c`).
 * @param max Intentos permitidos dentro de la ventana.
 * @param windowSeconds Anchura de la ventana.
 * @returns `true` si el intento se permite; `false` si excede el límite.
 *
 * @aitri-trace BG-015, NFR-ID: NFR-1303
 */
export function allow(key: string, max: number, windowSeconds: number): boolean {
  if (disabled()) return true;
  const ahora = Date.now();
  const desde = ahora - windowSeconds * 1000;
  const vivos = (buckets.get(key) ?? []).filter((t) => t > desde);
  // La marca se registra SIEMPRE, también cuando se rechaza: quien insiste durante el bloqueo
  // extiende su propio bloqueo en vez de resetearlo al dejar de intentarlo justo a tiempo.
  vivos.push(ahora);
  buckets.set(key, vivos);
  // Poda perezosa: sin esto el Map crece sin techo con las claves de un atacante que rota IPs.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.every((t) => t <= desde)) buckets.delete(k);
  }
  return vivos.length <= max;
}

/**
 * IP del cliente, o `undefined` si no se puede determinar con confianza.
 *
 * BG-013 fijó la regla y aquí se respeta: `x-forwarded-for` SÓLO se cree con
 * `LEDGER_TRUST_PROXY=true`. Sin proxy que lo reemplace, el cliente elige ese header y rotarlo le
 * daría un cubo nuevo en cada intento — el límite existiría sin limitar nada. Devolver `undefined`
 * es la respuesta honesta: el llamante decide qué hacer sin esa dimensión.
 *
 * En un route handler de Next.js no hay acceso a la IP del socket, así que no hay más fuentes.
 *
 * @param req Petición entrante.
 * @param trustProxy Si el despliegue declara que hay un reverse proxy de confianza delante.
 * @returns La IP del cliente, o `undefined` si no es determinable con confianza.
 *
 * @aitri-trace BG-015, BG-013
 */
export function clientIp(req: Request, trustProxy: boolean): string | undefined {
  if (!trustProxy) return undefined;
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return undefined;
  // El primero es el cliente original; el resto son los saltos intermedios.
  const primera = xff.split(",")[0]?.trim();
  return primera || undefined;
}

/** Sólo para los tests: vacía el estado entre casos. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
}
