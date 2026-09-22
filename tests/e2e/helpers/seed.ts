/**
 * Module: tests/e2e/helpers/seed
 * Purpose: Siembra el ledger de la cuenta e2e a través de la API autenticada.
 *
 *   Reemplaza el mecanismo anterior —`page.addInitScript(() => localStorage.setItem("ledger.nodes.v1", …))`—
 *   que dejó de funcionar al retirar el almacén de localStorage (feature servidor-fuente-unica,
 *   FR-1104). Sembrar por la API es además más fiel: es el mismo camino que recorre un dato real,
 *   así que un fallo del contrato de escritura sale aquí en vez de esconderse tras una siembra
 *   sintética que ningún usuario ejecuta.
 *
 * Dependencies: @playwright/test
 */
import type { Page } from "@playwright/test";
import type { LedgerNode, AmountMap, Movement } from "@/domain/types";

export interface SeedInput {
  nodes: LedgerNode[];
  budgets?: AmountMap;
  actuals?: AmountMap;
  movements?: Movement[];
  cellNotes?: Record<string, Record<string, string>>;
  /**
   * Siembra TAL CUAL, sin completar el respaldo de las celdas (NFR-2502). Solo para las pruebas que
   * necesitan un ledger DESCUADRADO a propósito — el aviso de descuadre de FR-2511. Por defecto la
   * siembra cuadra, que es el estado que cualquier otra prueba da por supuesto.
   */
  sinCuadrar?: boolean;
}

/**
 * Los movimientos del escenario MÁS el respaldo que falte (NFR-2502, feature diario-de-celda).
 *
 * Desde esta feature el servidor rechaza una celda de Ejecutado de gasto o ingreso que no cuadre con
 * la suma de sus movimientos. Muchos specs sembraban la cifra suelta —su intención era «esta celda
 * vale N», no «una celda sin respaldo»— y el PUT empezó a responder 422. En vez de retocar doce
 * specs, el respaldo se completa AQUÍ: por cada celda descuadrada se añade un movimiento por la
 * diferencia, que es exactamente lo que hace la app cuando el usuario teclea un total (FR-2504).
 *
 * Los bolsillos (`transfer`) se quedan fuera: su celda es el aporte del mes y nunca descuadra
 * (NFR-2503). Un spec que necesite sembrar una celda DESCUADRADA a propósito —las pruebas del aviso
 * de descuadre, FR-2511— pasa `sinCuadrar: true` y siembra tal cual.
 */
function conRespaldo(input: SeedInput): Movement[] {
  const movements = [...(input.movements ?? [])];
  const tipoDe = new Map(input.nodes.map((n) => [n.id, n] as const));
  let seq = 0;

  for (const [nodeId, meses] of Object.entries(input.actuals ?? {})) {
    const node = tipoDe.get(nodeId);
    if (!node || node.type === "transfer") continue;
    for (const [period, cell] of Object.entries(meses as Record<string, number>)) {
      const suma = movements
        .filter((m) => m.type !== "transfer" && m.target === nodeId && m.period === period)
        .reduce((a, m) => a + m.amount, 0);
      const diff = (cell ?? 0) - suma;
      if (diff === 0) continue;
      movements.push({
        id: `respaldo-${nodeId}-${period}-${++seq}`,
        ownerId: "local",
        type: node.type,
        catId: node.level === "sub" && node.parentId ? node.parentId : nodeId,
        subId: node.level === "sub" ? nodeId : null,
        target: nodeId,
        amount: diff,
        period: period as Movement["period"],
        createdAt: 800_000 + seq,
        // Día 10: dentro del mes natural y del ciclo que ese mes nombra.
        date: `${period.slice(0, 7)}-10T12:00`,
        ...(diff < 0 ? { kind: "adjustment" as const } : {}),
      });
    }
  }
  return movements;
}

/**
 * Escribe el estado completo del ledger de la cuenta e2e. Debe llamarse ANTES de `page.goto`,
 * porque la app hidrata al montar el gate.
 *
 * Lee la revisión vigente primero: el PUT usa lock optimista y un `baseRevision` obsoleto
 * devolvería 409 (el mismo mecanismo que protege al usuario de escrituras concurrentes).
 */
export async function seedLedger(page: Page, input: SeedInput): Promise<void> {
  const ctx = page.request;

  const current = await ctx.get("/api/v1/ledger");
  const baseRevision = current.status() === 200 ? ((await current.json()) as { revision: number }).revision : 0;

  const state = {
    ownerId: "local",
    nodes: input.nodes,
    budgets: input.budgets ?? {},
    actuals: input.actuals ?? {},
    movements: input.sinCuadrar ? (input.movements ?? []) : conRespaldo(input),
    ...(input.cellNotes ? { cellNotes: input.cellNotes } : {}),
  };

  const res = await ctx.put("/api/v1/ledger", { data: { baseRevision, state } });
  if (res.ok()) return;

  const cuerpo = await res.text();

  // ── SIEMBRA EN DOS PASOS (feature reglas-en-el-servidor, FR-2101) ──────────────────────────
  //
  // Desde que el servidor hace cumplir las reglas del dominio, un escenario que YA está por encima
  // del techo —los que prueban que la marca de exceso se pinta— no se puede escribir de un tirón:
  // la escritura crearía el exceso, y eso es exactamente lo que el guardia rechaza. Un usuario
  // tampoco podría; a ese estado se llega en DOS pasos, y así es como se siembra aquí:
  //
  //   1. el mismo escenario pero con el ingreso inflado, de modo que las reservas quepan de sobra;
  //   2. el escenario real, que respecto del anterior SOLO baja ingresos — y una escritura que no
  //      toca reservas no se juzga (ADR-20, NFR-1803).
  //
  // Es más fiel que un atajo por debajo de la API: reproduce el camino real por el que un ledger
  // llega a estar excedido, en vez de fabricar un estado que ninguna ruta del producto produce.
  if (!cuerpo.includes("domain_rule_violation")) {
    throw new Error(`seedLedger falló: HTTP ${res.status()} ${cuerpo}`);
  }

  const hojaIngreso = input.nodes.find(
    (n) => n.type === "income" && !input.nodes.some((h) => h.parentId === n.id)
  );
  if (!hojaIngreso) {
    throw new Error(
      `seedLedger falló y no hay hoja de ingreso para sembrar en dos pasos: HTTP ${res.status()} ${cuerpo}`
    );
  }

  // Los periodos que el escenario toca, más los del plan: el ingreso se infla en todos ellos.
  const periodos = new Set<string>();
  for (const mapa of [state.actuals, state.budgets]) {
    for (const porNodo of Object.values(mapa as AmountMap)) {
      for (const p of Object.keys(porNodo as Record<string, number>)) periodos.add(p);
    }
  }
  for (const m of state.movements) periodos.add(m.period);

  const HOLGURA = 1_000_000_000_000; // muy por encima de cualquier escenario, y muy por debajo de 2^53
  // NFR-2502: el ingreso inflado va CON su movimiento. Sin él, este primer paso es una celda sin
  // respaldo y el servidor responde 422 `cell_movement_mismatch` — el atajo de dos pasos moría antes
  // de llegar al escenario real. Lo que el paso holgado hace sigue siendo lo mismo: dar margen de
  // sobra para que las reservas quepan, y bajarlo después.
  // El respaldo es la DIFERENCIA hasta la holgura, no la holgura entera: `state.movements` ya trae
  // el que respalda la cifra original del escenario, y sumar otro por el total dejaba la celda en
  // HOLGURA con sus movimientos sumando HOLGURA + lo anterior — descuadrada otra vez, al revés.
  const yaSumado = (p: string) =>
    state.movements
      .filter((m) => m.type !== "transfer" && m.target === hojaIngreso.id && m.period === p)
      .reduce((a, m) => a + m.amount, 0);
  const respaldo: Movement[] = [...periodos]
    .map((p, i) => ({
      id: `holgura-${i + 1}`,
      ownerId: "local",
      type: "income" as const,
      catId: hojaIngreso.id,
      subId: null,
      target: hojaIngreso.id,
      amount: HOLGURA - yaSumado(p),
      period: p as Movement["period"],
      createdAt: 900_000 + i,
      date: `${p.slice(0, 7)}-10T12:00`,
    }))
    .filter((m) => m.amount !== 0);
  const holgado = {
    ...state,
    actuals: {
      ...state.actuals,
      [hojaIngreso.id]: {
        ...((state.actuals as AmountMap)[hojaIngreso.id] ?? {}),
        ...Object.fromEntries([...periodos].map((p) => [p, HOLGURA])),
      },
    },
    // Los movimientos del escenario real se conservan: el paso holgado solo AÑADE el respaldo del
    // ingreso inflado, que el paso 2 retira junto con la cifra.
    movements: [...respaldo, ...state.movements],
  };

  const paso1 = await ctx.put("/api/v1/ledger", { data: { baseRevision, state: holgado } });
  if (!paso1.ok()) {
    throw new Error(`seedLedger falló en el paso holgado: HTTP ${paso1.status()} ${await paso1.text()}`);
  }
  const rev1 = ((await paso1.json()) as { revision: number }).revision;

  const paso2 = await ctx.put("/api/v1/ledger", { data: { baseRevision: rev1, state } });
  if (!paso2.ok()) {
    throw new Error(`seedLedger falló en el paso real: HTTP ${paso2.status()} ${await paso2.text()}`);
  }
}

/**
 * Lee el estado, aplica `mutate` sobre sus nodos y lo vuelve a escribir.
 *
 * Sustituye al patrón `page.evaluate(() => { leer ledger.nodes.v1 → mutar → escribir })` que usaban
 * los tests para inyectar nodos o corromper un icono. Tras la escritura hay que recargar para que
 * la app re-hidrate, igual que antes.
 */
export async function mutateNodes(page: Page, mutate: (nodes: LedgerNode[]) => void): Promise<void> {
  const res = await page.request.get("/api/v1/ledger");
  if (res.status() !== 200) throw new Error(`mutateNodes: no se pudo leer el ledger (HTTP ${res.status()})`);
  const body = (await res.json()) as { revision: number; state: SeedInput & { nodes: LedgerNode[] } };

  mutate(body.state.nodes);

  const put = await page.request.put("/api/v1/ledger", {
    data: { baseRevision: body.revision, state: body.state },
  });
  if (!put.ok()) throw new Error(`mutateNodes falló: HTTP ${put.status()} ${await put.text()}`);
}

/** Lee el estado vigente del servidor — sustituye a leer `ledger.budget.v4` de localStorage. */
export async function readLedger(page: Page): Promise<{
  budgets: AmountMap;
  actuals: AmountMap;
  movements: Movement[];
} | null> {
  const res = await page.request.get("/api/v1/ledger");
  if (res.status() !== 200) return null;
  const body = (await res.json()) as { state: { budgets: AmountMap; actuals: AmountMap; movements: Movement[] } };
  return body.state;
}
