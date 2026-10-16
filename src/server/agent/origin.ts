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
 *
 *   LO QUE ESTO GARANTIZA Y LO QUE NO (revisión adversarial, 2026-10-13). Garantiza que lo que entra
 *   por un frente que REESCRIBE `x-forwarded-for` con la dirección del cliente no se atiende. NO
 *   autentica a un cliente que conecta directo al puerto: ese elige la cabecera (Next solo la pone
 *   si no vino), así que para él la única barrera es el token. Por eso:
 *     · NINGUNA dirección es interna por defecto, tampoco el loopback: hay que declararla en
 *       LEDGER_AGENT_SOURCES. Con un segundo proxy local (Nginx detrás de `tailscale serve`) todo
 *       el tráfico externo llega como 127.0.0.1, y darlo por interno abría la puerta entera.
 *     · No se admiten bloques anchos: un `/0` declarado por descuido lo dejaría todo dentro.
 *   La separación de verdad —un listener solo para /api/agent en la red del agente— queda fuera de
 *   esta entrega y está declarada como deuda.
 * Dependencies: ninguna
 */

/** Cabeceras que Next no añade nunca: si están, las puso un proxy. */
const SOLO_DE_PROXY = "forwarded";
const PREFIJO_TAILSCALE = "tailscale-";
const IPV4_MAPEADA = "::ffff:";
const LOOPBACK_V6 = "::1";
const LOOPBACK_V4 = "127.0.0.1";
const BITS_IPV4 = 32;
/** El bloque más ancho que se acepta declarar: /16. Más ancho que eso no es «una red interna». */
const PREFIJO_MINIMO = 16;
/** El loopback entero (127.0.0.0/8) es el único bloque que puede declararse más ancho. */
const PRIMER_OCTETO_LOOPBACK = 127;
const PREFIJO_LOOPBACK = 8;

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
 * ¿Es válida una entrada de la lista de orígenes internos? Acepta una IPv4 ("172.30.34.5") o un
 * bloque CIDR IPv4 de /16 o más estrecho ("172.30.34.0/24"). Un bloque más ancho se rechaza —un
 * `0.0.0.0/0` puesto por descuido dejaría todo «dentro»—, salvo el loopback (127.0.0.0/8).
 * @param entrada el texto a validar
 * @returns true si se puede usar como origen
 */
export function isValidSource(entrada: string): boolean {
  const [ip, prefijo, sobra] = entrada.split("/");
  const base = ipv4(ip ?? "");
  if (sobra !== undefined || base === null) return false;
  if (prefijo === undefined) return true;
  if (!/^\d{1,2}$/.test(prefijo) || Number(prefijo) > BITS_IPV4) return false;
  const esLoopback = Math.floor(base / 2 ** 24) === PRIMER_OCTETO_LOOPBACK;
  return Number(prefijo) >= (esLoopback ? PREFIJO_LOOPBACK : PREFIJO_MINIMO);
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
 * ¿La dirección es interna? SOLO si está en `sources`: ninguna lo es por defecto, tampoco el
 * loopback. `::1` y las IPv4 mapeadas (`::ffff:a.b.c.d`) se juzgan por su equivalente IPv4.
 * @param direccion dirección tal como llega en `x-forwarded-for` (IPv4, IPv6 o IPv4 mapeada)
 * @param sources las direcciones o bloques declarados por el despliegue (LEDGER_AGENT_SOURCES)
 * @returns true si la conexión viene de un origen declarado
 */
export function isInternalAddress(direccion: string, sources: readonly string[]): boolean {
  const limpia = direccion.trim().toLowerCase();
  const equivalente = limpia === LOOPBACK_V6 ? LOOPBACK_V4
    : limpia.startsWith(IPV4_MAPEADA) ? limpia.slice(IPV4_MAPEADA.length) : limpia;
  const v4 = ipv4(equivalente);
  if (v4 === null) return false;
  return sources.some((b) => dentroDe(v4, b));
}

/**
 * ¿La petición llegó por la red interna (y no a través de un proxy)?
 * @param req la petición, con las cabeceras tal como las entrega el servidor
 * @param sources las direcciones o bloques internos declarados (LEDGER_AGENT_SOURCES)
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

  // Sin la cabecera no hay servidor de Next delante (así llama una prueba unitaria a la envoltura):
  // en un servidor real Next la pone SIEMPRE. Con ella: UNA sola dirección —una lista es la huella
  // de un salto intermedio— y tiene que estar declarada como interna.
  const origen = h.get("x-forwarded-for");
  if (origen === null) return true;
  if (origen.includes(",")) return false;
  return isInternalAddress(origen, sources);
}
