/**
 * Module: tests/integration/backend/helpers/agente
 * Purpose: Lo que comparten las pruebas de la puerta para agentes (feature tony-ledger): un libro
 *   de prueba con ids conocidos, la creación de tokens, el constructor de peticiones a
 *   /api/agent/v1 y el lanzador del comando `scripts/agent-token.mjs`. Todos los datos son
 *   inventados; los tokens se generan en cada prueba y nunca se escriben en un archivo.
 * Dependencies: los helpers de la suite de backend, @/server/agent/tokens, @/server/env
 */
import { spawnSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { signUp } from "./authClient";
import { testDb } from "./db";
import { getSessionUser } from "@/server/session";
import { saveLedger } from "@/server/data/ledgerRepo";
import { generateToken, hashToken } from "@/server/agent/tokens";
import { __resetEnvForTests } from "@/server/env";
import { __resetRateLimitForTests } from "@/server/rateLimit";
import type { LedgerNode, LedgerState, PeriodKey } from "@/domain";

export const PASSWORD = "Contra$eña123";
export const ORIGIN = "http://localhost:3100";
/** Base de la superficie del agente. */
export const AGENT = "/api/agent/v1";
/** Periodo de trabajo de las pruebas: octubre del año de referencia. */
export const OCT: PeriodKey = "2026-10";

let ipCounter = 0;
/** Una IP distinta por registro: cada alta estrena cubo de rate-limit (ver setupEnv, BG-018). */
function nextIp(): string {
  ipCounter += 1;
  return `10.34.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

/** Registra una cuenta y devuelve su cookie de sesión y su id. */
export async function newUser(email: string): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, PASSWORD, email.split("@")[0], nextIp());
  const userId = (await getSessionUser(new Headers({ cookie })))!.userId;
  return { cookie, userId };
}

/**
 * El árbol de prueba: 12 nodos con ids fijos. `prefijo` permite una segunda cuenta con ids propios
 * (`b-`), para que un id ajeno sea reconocible en una respuesta.
 */
export function nodos(ownerId: string, prefijo = ""): LedgerNode[] {
  const n = (
    id: string, type: LedgerNode["type"], level: LedgerNode["level"], parentId: string | null, name: string, order: number
  ): LedgerNode => ({
    id: prefijo + id, ownerId, type, level, parentId: parentId === null ? null : prefijo + parentId, name,
    icon: level === "sub" ? null : level === "group" ? "folder" : "tag", order,
  });
  return [
    n("g-vida", "expense", "group", null, "Vida", 0),
    n("c-alimentacion", "expense", "category", "g-vida", "Alimentación", 1),
    n("s-mercado", "expense", "sub", "c-alimentacion", "Mercado", 2),
    n("s-restaurantes", "expense", "sub", "c-alimentacion", "Restaurantes", 3),
    n("c-transporte", "expense", "category", "g-vida", "Transporte", 4),
    n("g-ingresos", "income", "group", null, "Ingresos", 5),
    n("c-salario", "income", "category", "g-ingresos", "Salario", 6),
    n("c-otros", "income", "category", "g-ingresos", "Otros ingresos", 7),
    n("g-reservas", "transfer", "group", null, "Reservas", 8),
    n("c-metas", "transfer", "category", "g-reservas", "Metas", 9),
    n("s-viaje", "transfer", "sub", "c-metas", "Viaje", 10),
    n("s-carro", "transfer", "sub", "c-metas", "Carro", 11),
  ];
}

/** Un libro de prueba con el árbol de arriba y las celdas que se indiquen. */
export function libro(
  ownerId: string,
  opts: { budgets?: LedgerState["budgets"]; actuals?: LedgerState["actuals"]; prefijo?: string } = {}
): LedgerState {
  return {
    ownerId,
    nodes: nodos(ownerId, opts.prefijo ?? ""),
    budgets: opts.budgets ?? {},
    actuals: opts.actuals ?? {},
    movements: [],
  };
}

/** Guarda el libro de una cuenta como su primer guardado. Devuelve la revisión resultante. */
export async function sembrar(ownerId: string, state: LedgerState): Promise<number> {
  const res = await saveLedger(ownerId, state, 0);
  if (!res.ok) throw new Error(`No se pudo sembrar el libro de prueba: ${JSON.stringify(res)}`);
  return res.revision;
}

let tokenSeq = 0;
/** Crea un token activo para una cuenta, igual que lo haría el comando. Devuelve el token en claro. */
export async function crearToken(ownerId: string, name = "Agent-L"): Promise<{ token: string; id: string }> {
  tokenSeq += 1;
  const token = generateToken();
  const id = `agt_prueba${String(tokenSeq).padStart(4, "0")}`;
  await testDb().execute(
    sql`INSERT INTO "agent_token" ("id","owner_id","name","token_hash") VALUES (${id}, ${ownerId}, ${name}, ${hashToken(token)})`
  );
  return { token, id };
}

/** Un token con formato válido que no existe en la base. */
export function tokenInexistente(): string {
  return generateToken();
}

export interface AgentReqInit {
  token?: string;
  method?: string;
  body?: unknown;
  /** Cuerpo ya serializado (para probar tamaños y JSON a medida). */
  rawBody?: string;
  cookie?: string;
  headers?: Record<string, string>;
}

/** Construye una petición a la superficie del agente. Sin cookie ni Origin salvo que se pidan. */
export function agentReq(path: string, init: AgentReqInit = {}): Request {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.cookie) headers.cookie = init.cookie;
  const body = init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined);
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${AGENT}${path}`, { method: init.method ?? "GET", headers, body });
}

/** Petición a la API del navegador (/api/v1), con las cabeceras que se indiquen. */
export function apiReq(
  url: string, init: { method?: string; cookie?: string; body?: unknown; origin?: string; token?: string } = {}
): Request {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${url}`, {
    method: init.method ?? "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** Enciende o apaga la superficie del agente para el proceso de pruebas. */
export function superficie(estado: "on" | "off" | string): void {
  if (estado === "off") delete process.env.LEDGER_AGENT_API;
  else process.env.LEDGER_AGENT_API = estado;
  __resetEnvForTests();
}

/** Deja los cubos de rate-limit vacíos: cada prueba empieza sin intentos de la anterior. */
export function limpiarTopes(): void {
  __resetRateLimitForTests();
}

/** Ejecuta `scripts/agent-token.mjs` contra la base de la suite. */
export function cli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", ["scripts/agent-token.mjs", ...args], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Captura las líneas de console.log emitidas mientras corre `fn`. */
export async function capturarLogs(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try { await fn(); } finally { console.log = original; }
  return lines;
}

/** Filas de una tabla de la cuenta, ordenadas, para comparar «antes» y «después». */
export async function volcado(ownerId: string): Promise<string> {
  const db = testDb();
  const partes: string[] = [];
  for (const [tabla, orden] of [["node", "id"], ["amount_cell", "node_id, period, kind"], ["movement", "id"], ["ledger", "owner_id"]] as const) {
    const filas = await db.execute(sql.raw(
      `SELECT * FROM "${tabla}" WHERE owner_id = '${ownerId.replace(/'/g, "''")}' ORDER BY ${orden}`
    ));
    partes.push(tabla + ":" + JSON.stringify(filas, (k, v) => (k === "updated_at" ? undefined : v)));
  }
  return partes.join("\n");
}

/**
 * Marca un movimiento ya guardado como registrado por un agente. Escribe las tres columnas de
 * origen directamente: sirve para preparar escenarios de LECTURA sin depender de la escritura.
 */
export async function marcarComoAgente(
  ownerId: string, movementId: string, ref: string, tokenId: string, agentName = "Agent-L"
): Promise<void> {
  await testDb().execute(
    sql`UPDATE "movement" SET origin_ref = ${ref}, agent_token_id = ${tokenId}, agent_name = ${agentName}
        WHERE owner_id = ${ownerId} AND id = ${movementId}`
  );
}

/** Cabecera de pruebas que fija el «hoy» del servidor (solo con LEDGER_TEST_OVERRIDES=1). */
export function hoy(fecha: string): Record<string, string> {
  return { "x-ledger-today": fecha };
}
