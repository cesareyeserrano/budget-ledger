/**
 * Module: server/agent/origin
 * Purpose: ¿Esta petición llegó por la red interna, o a través del frente público? (ADR-06,
 *   NFR-3411). La superficie del agente solo atiende lo primero.
 *
 *   POR QUÉ SE MIRA EL VALOR Y NO LA PRESENCIA de las cabeceras `x-forwarded-*`. El servidor de
 *   Next se las pone a TODA petición antes de entregarla a la ruta: `x-forwarded-for` con la
 *   dirección de quien se conectó (si el cliente no la trajo) y `x-forwarded-host` con el `Host`.
 *   La primera versión rechazaba cualquier petición que las trajera, y en un servidor real eso es
 *   rechazarlas todas — medido el 2026-10-13 en dev; las pruebas en proceso no lo veían porque
 *   llaman a la ruta sin pasar por Next.
 *
 *   Lo que distingue un camino del otro:
 *     · Conexión directa (el agente, por la red interna o el loopback): `x-forwarded-for` es la
 *       dirección del propio socket y `x-forwarded-host` es igual a `Host`.
 *     · A través de un proxy (`tailscale serve`, Nginx): el proxy escribe en `x-forwarded-for` la
 *       dirección del cliente REAL, que no es interna, y quien pasa por el proxy no puede cambiarla.
 *   Un cliente directo sí podría inventarse la cabecera, pero para conectarse directo ya tiene que
 *   estar dentro: no gana nada. El token sigue siendo obligatorio en todos los casos.
 * Dependencies: ninguna
 */

/** Cabeceras que Next no añade nunca: si están, las puso un proxy. */
const SOLO_DE_PROXY = "forwarded";
const PREFIJO_TAILSCALE = "tailscale-";
const IPV4_MAPEADA = "::ffff:";
const LOOPBACK_V6 = "::1";
const LOOPBACK_V4 = "127.0.0.0/8";
const BITS_IPV4 = 32;

/** Convierte "a.b.c.d" en su entero de 32 bits, o null si no es una IPv4 válida. */
function ipv4(texto: string): number | null {
  const partes = texto.split(".");
  if (partes.length !== 4) return null;
  let n = 0;
  for (const p of partes) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const octeto = Number(p);
    if (octeto > 255) return null;
    n = n * 256 + octeto;
  }
  return n;
}

/**
 * ¿Es válida una entrada de la lista de orígenes internos? Acepta una IPv4 ("172.30.0.5") o un
 * bloque CIDR IPv4 ("172.30.0.0/24").
 * @param entrada el texto a validar
 * @returns true si se puede usar como origen
 */
export function isValidSource(entrada: string): boolean {
  const [ip, prefijo, sobra] = entrada.split("/");
  if (sobra !== undefined || ipv4(ip ?? "") === null) return false;
  if (prefijo === undefined) return true;
  return /^\d{1,2}$/.test(prefijo) && Number(prefijo) <= BITS_IPV4;
}

/** ¿La dirección IPv4 `ip` está dentro de `bloque` ("a.b.c.d" o "a.b.c.d/n")? */
function dentroDe(ip: number, bloque: string): boolean {
  const [base, prefijo] = bloque.split("/");
  const red = ipv4(base ?? "");
  if (red === null) return false;
  const bits = prefijo === undefined ? BITS_IPV4 : Number(prefijo);
  if (bits === 0) return true;
  const divisor = 2 ** (BITS_IPV4 - bits);
  return Math.floor(ip / divisor) === Math.floor(red / divisor);
}

/**
 * ¿La dirección es interna? El loopback lo es siempre; lo demás, solo si está en `sources`.
 * @param direccion dirección tal como llega en `x-forwarded-for` (IPv4, IPv6 o IPv4 mapeada)
 * @param sources bloques adicionales declarados por el despliegue (LEDGER_AGENT_SOURCES)
 * @returns true si la conexión viene de dentro
 */
export function isInternalAddress(direccion: string, sources: readonly string[]): boolean {
  const limpia = direccion.trim().toLowerCase();
  if (limpia === LOOPBACK_V6) return true;
  const v4 = ipv4(limpia.startsWith(IPV4_MAPEADA) ? limpia.slice(IPV4_MAPEADA.length) : limpia);
  if (v4 === null) return false;
  return [LOOPBACK_V4, ...sources].some((b) => dentroDe(v4, b));
}

/**
 * ¿La petición llegó por la red interna (y no a través de un proxy)?
 * @param req la petición, con las cabeceras tal como las entrega el servidor
 * @param sources bloques internos adicionales al loopback (LEDGER_AGENT_SOURCES)
 * @returns true si se puede atender en la superficie del agente
 * @aitri-trace NFR-ID: NFR-3411, US-ID: US-3405, AC-ID: AC-3405a, TC-ID: TC-AGT-253e
 */
export function isInternalRequest(req: Request, sources: readonly string[]): boolean {
  const h = req.headers;
  if (h.has(SOLO_DE_PROXY)) return false;
  for (const nombre of h.keys()) if (nombre.toLowerCase().startsWith(PREFIJO_TAILSCALE)) return false;

  // Un proxy que reescribe el host deja `x-forwarded-host` distinto de `Host`.
  const reenviado = h.get("x-forwarded-host");
  const host = h.get("host");
  if (reenviado !== null && host !== null && reenviado !== host) return false;

  // Sin la cabecera no hay rastro de proxy (así llama una prueba en proceso). Con ella: UNA sola
  // dirección —una lista es la huella de un salto intermedio— y tiene que ser interna.
  const origen = h.get("x-forwarded-for");
  if (origen === null) return true;
  if (origen.includes(",")) return false;
  return isInternalAddress(origen, sources);
}
