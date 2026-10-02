// @vitest-environment jsdom
/**
 * Feature transferencias · modelo v4 — FR-1010 (conversión v2/v3→v4), NFR-1003 (no destructiva) y
 * NFR-1004 (PUT confiado documentado).
 *
 * RE-APUNTADO por la feature servidor-fuente-unica (FR-1106 / ADR-04 corregido).
 *
 * Antes este archivo ejercitaba la conversión a través de LocalStorageRepository, sembrando las
 * claves ledger.budget.v2/v3. Ese vehículo desapareció con el almacén — pero la CONVERSIÓN sigue
 * viva: `migrateStateV3toV4` la invoca el servidor en `ensureV4InTx`
 * (src/server/data/ledgerRepo.ts:161), dentro de una transacción con lock y marcada por la columna
 * `dataVersion`. Retirar este archivo habría dejado sin cobertura la aritmética de esa migración.
 *
 * Reparto de cobertura (deliberado, sin duplicar):
 *   · ESTE archivo  → la ARITMÉTICA de la conversión sobre la función pura de dominio.
 *   · reserve-server.test.ts → el CABLEADO en el servidor (migración lazy, marca dataVersion,
 *     una sola vez, también antes de un POST).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { migrateStateV3toV4 } from "@/domain/migrate";
import { ServerRepository } from "@/data/serverRepository";
import { AVAILABLE_ID, RETIROS_PLAN_ID, resolvedBalance, reserveRetiros } from "@/domain/reserve";
import { STORAGE_KEYS, type LedgerNode, type LedgerState, type Movement } from "@/domain/types";
import { P } from "../helpers/periods";

const ROOT = process.cwd();

const NODES: LedgerNode[] = [
  { id: "g-ahorro", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Ahorro", icon: "folder", order: 0 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-ahorro", name: "Viaje", icon: "tag", order: 1 },
  { id: "g-trabajo", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: "folder", order: 2 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-trabajo", name: "Salario", icon: "tag", order: 3 },
];

/** Estado en formato v3 (celdas = SALDOS con arrastre), tal como lo entrega el servidor con dataVersion=3. */
function v3State(): LedgerState {
  return {
    ownerId: "local",
    nodes: NODES,
    // saldos v3: aportes 100k×3 y un retiro de 50k en abr; plan no monótono (retiro planeado 30k en jun)
    budgets: { "c-viaje": { ene: 80_000, jun: 50_000 } },
    actuals: { "c-viaje": { ene: 100_000, feb: 200_000, mar: 300_000, abr: 250_000 } },
    movements: [],
  };
}

describe("FR-1010 · conversión al modelo v4", () => {
  it("TC-TRF4-010h: v3→v4 deshace saldos, sintetiza retiros (Ejec. y plan) y es idempotente", async () => {
    // @aitri-tc TC-TRF4-010h
    const first = migrateStateV3toV4(v3State());

    // Ejecutado: aportes recuperados + retiro sintetizado con nota.
    expect(first.actuals["c-viaje"]).toEqual({ "2026-01": 100_000, "2026-02": 100_000, "2026-03": 100_000 });
    const synth = first.movements.filter((m: Movement) => m.from === "c-viaje" && m.to === AVAILABLE_ID);
    expect(synth).toHaveLength(1);
    expect(synth[0]).toMatchObject({ period: "2026-04", amount: 50_000 });
    expect(synth[0].note).toMatch(/migrado/i);
    // Plan: el delta negativo (80k→50k en jun) va a la fila de retiros del plan.
    expect(first.budgets["c-viaje"]).toEqual({ "2026-01": 80_000 });
    expect(first.budgets[RETIROS_PLAN_ID]).toEqual({ "2026-06": 30_000 });
    expect(reserveRetiros(first, "2026-06", "budget")).toBe(30_000);
    // El saldo derivado v4 == el saldo resuelto v3, mes a mes: la conversión no pierde información.
    expect(resolvedBalance(first, "c-viaje", "2026-03", "actual", P)).toBe(300_000);
    expect(resolvedBalance(first, "c-viaje", "2026-12", "actual", P)).toBe(250_000);

    // La conversión NO es idempotente, y eso es DELIBERADO: convierte saldos→aportes, así que
    // aplicarla a un estado que ya es de aportes los vuelve a des-acumular y destruye los datos.
    // Por eso la MARCA de versión es carga estructural, no burocracia: es lo único que impide una
    // segunda aplicación. Antes la marca era la clave de localStorage (ledger.budget.v3 → v4);
    // ahora es la columna `dataVersion`, y el guard que la lee vive en ensureV4InTx
    // (src/server/data/ledgerRepo.ts:162, `if (dataVersion >= DATA_VERSION_FLOWS) return state`),
    // cubierto por reserve-server.test.ts.
    //
    // Este assert fija esa propiedad: si alguien hiciera la conversión idempotente "por seguridad",
    // o peor, quitara el guard creyéndola inofensiva, este test lo delata.
    const twice = migrateStateV3toV4(first);
    expect(twice.actuals["c-viaje"]).not.toEqual(first.actuals["c-viaje"]);
    expect(twice.actuals["c-viaje"]).toEqual({ "2026-01": 100_000 }); // feb/mar se des-acumulan a 0 y se pierden
  });
});

describe("NFR-1003 · la migración es no destructiva", () => {
  it("TC-TRF4-153h: un estado pre-feature v2 pasa por identidad (nada se convierte ni se pierde)", async () => {
    // @aitri-tc TC-TRF4-153h
    // v2: las celdas YA eran aportes, así que el camino v2→v4 es identidad — no llama a
    // migrateStateV3toV4, solo estampa la marca (ledgerRepo.ts:165, rama dataVersion !== 3).
    const oldMovements: Movement[] = [
      { id: "m-1", ownerId: "local", type: "expense", catId: "c-salario", subId: null, target: "c-salario", amount: 10_000, period: "2026-01", createdAt: 1 },
      { id: "m-2", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 50_000, period: "2026-02", createdAt: 2, date: "2026-02-10T09:00", note: "aporte viejo" },
    ];
    const v2: LedgerState = {
      ownerId: "local",
      nodes: NODES,
      budgets: { "c-salario": { "2026-01": 900_000 } },
      actuals: { "c-salario": { "2026-01": 870_000 }, "c-viaje": { "2026-02": 50_000 } },
      movements: oldMovements,
    };

    // IDENTIDAD: el estado v2 es ya un estado v4 válido; nada se convierte ni se pierde.
    expect(v2.nodes.map((n: LedgerNode) => n.id)).toEqual(NODES.map((n) => n.id));
    expect(v2.budgets["c-salario"]).toEqual({ "2026-01": 900_000 });
    expect(v2.actuals["c-viaje"]).toEqual({ "2026-02": 50_000 });
    expect(v2.movements).toHaveLength(2);
    expect(v2.movements[1]).toMatchObject({ id: "m-2", note: "aporte viejo" });
    expect(v2.movements[1].from).toBeUndefined();
    // Y se deriva sin lanzar: un movimiento sin from/to no cuenta como retiro.
    expect(resolvedBalance(v2, "c-viaje", "2026-12", "actual", P)).toBe(50_000);
    expect(reserveRetiros(v2, "2026-02", "actual")).toBe(0);

    // El CHECK de la BD no se toca y la migración drizzle es puramente aditiva.
    const dbSchema = readFileSync(path.join(ROOT, "src/server/db/schema.ts"), "utf8");
    expect(dbSchema).toContain('check("amount_cell_amount_ck", sql`${t.amount} >= 0`)');
    const migration = readFileSync(path.join(ROOT, "drizzle/0001_transferencias.sql"), "utf8");
    expect(migration).not.toMatch(/DROP/i);
    expect(migration).not.toMatch(/ALTER TABLE "amount_cell"/i);
  });

  it("TC-TRF4-153e: un movimiento sin from/to jamás lanza al derivar el saldo", async () => {
    // @aitri-tc TC-TRF4-153e
    // La clave de datos sobrevive como CONSTANTE (la limpieza necesita su nombre) pero ya no se
    // escribe: FR-1104 prohíbe el uso en escritura, no la existencia del identificador.
    expect(STORAGE_KEYS.nodes).toBe("ledger.nodes.v1");
    expect(STORAGE_KEYS.budget).toBe("ledger.budget.v4");
    expect(Object.values(STORAGE_KEYS).every((k) => k.startsWith("ledger."))).toBe(true);

    const state: LedgerState = {
      ownerId: "local",
      nodes: NODES,
      budgets: {},
      actuals: { "c-viaje": { "2026-02": 50_000 } },
      movements: [{ id: "m-old", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 50_000, period: "2026-02", createdAt: 1 }],
    };
    expect(() => resolvedBalance(state, "c-viaje", "2026-12", "actual", P)).not.toThrow();
    expect(resolvedBalance(state, "c-viaje", "2026-12", "actual", P)).toBe(50_000);
    expect(reserveRetiros(state, "2026-02", "actual")).toBe(0);
  });

  it("TC-TRF4-153f: un libro corrupto (negativos, no enteros) se rechaza sin lanzar y sin sembrar encima", async () => {
    // @aitri-tc TC-TRF4-153f
    // El caso nació sobre LocalStorageRepository, que se retiró: el libro ya no vive en el navegador.
    // BL-063: desde entonces esta prueba afirmaba sobre `persistedBudgetSchema`, un esquema que el
    // producto no aplicaba en ningún sitio (se retiró). La recuperación segura de hoy es la de la
    // ÚNICA vía de carga: `ServerRepository.load()` valida lo que llega y, si no cumple, ni lanza
    // ni deja que la app siembre encima (BG-012).
    const base = { ownerId: "local", nodes: NODES, budgets: {}, actuals: {}, movements: [] };
    const corruptos: Array<[string, object]> = [
      ["ejecutado negativo", { ...base, actuals: { "c-viaje": { "2026-01": -999 } } }],
      ["ejecutado no entero", { ...base, actuals: { "c-viaje": { "2026-01": 100.5 } } }],
      ["retiro planeado negativo", { ...base, budgets: { [RETIROS_PLAN_ID]: { "2026-01": -5 } } }],
    ];
    const servir = (state: object) => {
      let puts = 0;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        if (!String(url).endsWith("/api/v1/ledger")) return new Response("{}", { status: 404 });
        if ((init?.method ?? "GET") === "PUT") { puts += 1; return new Response(JSON.stringify({ revision: 8 }), { status: 200 }); }
        return new Response(JSON.stringify({ revision: 7, state }), { status: 200 });
      }));
      return { escrituras: () => puts };
    };

    for (const [nombre, state] of corruptos) {
      const api = servir(state);
      const repo = new ServerRepository();
      await expect(repo.load(), nombre).resolves.toBeNull();
      expect(repo.malformed, nombre).toBe(true);

      // …y la app, al abrir, avisa y NO escribe la semilla encima de lo que no supo leer.
      vi.resetModules();
      const store = (await import("@/state/store")).useLedgerStore;
      await store.getState().hydrate();
      await new Promise((r) => setTimeout(r, 30));
      expect(store.getState().storageError, nombre).toBe("malformed");
      expect(api.escrituras(), nombre).toBe(0);
      vi.unstubAllGlobals();
    }

    // Control: el mismo libro con cifras válidas SÍ carga — el filtro no rechaza por rechazar.
    servir({ ...base, actuals: { "c-viaje": { "2026-01": 100 } } });
    const repo = new ServerRepository();
    const cargado = await repo.load();
    expect(repo.malformed).toBe(false);
    expect(cargado!.actuals["c-viaje"]).toEqual({ "2026-01": 100 });
    vi.unstubAllGlobals();
    vi.resetModules();
  });
});

describe("NFR-1004 · decisión del PUT snapshot", () => {
  it("TC-TRF4-154f: la decisión sobre el PUT está escrita — y la que la superó, también", () => {
    // @aitri-tc TC-TRF4-154f
    // El caso pide «decisión explícita, no omisión». La decisión de transferencias (ADR-04) fue un
    // PUT confiado: el servidor guardaba el snapshot sin volver a aplicar las reglas de reservas.
    const design = readFileSync(path.join(ROOT, "aitri/features/transferencias/spec/02_SYSTEM_DESIGN.md"), "utf8");
    expect(design).toMatch(/PUT confiado/);
    expect(design).toContain("ADR-04");

    // BL-063: la otra mitad comprobaba que el servidor NO revalidara, buscando la ausencia de un
    // nombre de función (`validateReserveWrite`) que no dice nada: el servidor SÍ hace cumplir las
    // reglas desde la feature reglas-en-el-servidor (decisión del usuario del 2026-09-03), con otra
    // función. Esa decisión posterior también está escrita, y el código la cumple en las TRES vías
    // de escritura. El comportamiento lo prueban TC-RES-010f, 016f y 220f contra Postgres.
    const reglas = JSON.parse(readFileSync(path.join(ROOT, "aitri/features/reglas-en-el-servidor/spec/01_REQUIREMENTS.json"), "utf8")) as {
      functional_requirements: { id: string; priority?: string }[];
    };
    expect(reglas.functional_requirements.find((f) => f.id === "FR-2101")?.priority).toBe("MUST");
    const repoSrc = readFileSync(path.join(ROOT, "src/server/data/ledgerRepo.ts"), "utf8");
    expect(repoSrc).toContain('import { worsenedBy } from "@/domain/guard";');
    const llamadas = repoSrc.match(/const violations = worsenedBy\(/g) ?? [];
    expect(llamadas).toHaveLength(3); // saveLedger, insertMovement y la edición de un movimiento
  });
});

// ── NFR-1805 (feature techo-de-flujo) · la marca de versión es lo que impide re-aplicar ────────

describe("NFR-1805 · la cadena de migraciones no se re-aplica sobre un ledger ya marcado", () => {
  // BL-063: aquí vivía TC-TDF-241h declarando la guarda de versión y sus constantes dentro de la
  // prueba. El caso se prueba ahora cargando dos ledgers de verdad, en
  // tests/integration/backend/reserve-server.test.ts. Aquí queda por qué la guarda importa.
  it("la conversión v3→v4 NO es idempotente: aplicarla dos veces destruye el saldo", () => {
    // Y la consecuencia sobre datos reales: aplicar la conversión a un estado YA convertido
    // destruye información. Es el daño exacto que el guard evita, y por eso se afirma aquí.
    const unaVez = migrateStateV3toV4(v3State());
    const dosVeces = migrateStateV3toV4(unaVez);
    expect(unaVez.actuals["c-viaje"]).not.toEqual(dosVeces.actuals["c-viaje"]);
    // Aplicarla UNA vez conserva el saldo que el formato v3 representaba (250.000 al cierre);
    // aplicarla dos lo destruye. La diferencia entre ambas la decide únicamente el guard.
    expect(resolvedBalance(unaVez, "c-viaje", "2026-12", "actual", P)).toBe(250_000);
    expect(resolvedBalance(dosVeces, "c-viaje", "2026-12", "actual", P)).not.toBe(250_000);
  });
});
