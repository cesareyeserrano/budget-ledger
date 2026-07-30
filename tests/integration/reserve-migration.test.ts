/**
 * Feature transferencias (Reservas) — EP-03: migración v2→v3 y persistencia (cliente).
 * FR-1010 (migración versionada e idempotente), FR-1001 (la distinción ausente-vs-0 sobrevive el
 * round-trip), NFR-1003 (no destructiva; CHECK y claves ajenas intactos), NFR-1004 (PUT confiado
 * documentado), NFR-1007 (este spec es el ÚNICO punto de contacto con el formato viejo).
 *
 * ESTE ARCHIVO es el spec dedicado que siembra el formato v2 (TC-TRF-157f): ningún otro archivo
 * de tests/ puede contener la clave vieja.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { LocalStorageRepository } from "@/data/repository";
import { resolvedBalance, reserveCellState } from "@/domain/reserve";
import { STORAGE_KEYS, type LedgerNode, type LedgerState } from "@/domain/types";

const LEGACY_KEY = "ledger.budget.v2";
const ROOT = process.cwd();

/** Storage en memoria con la interfaz mínima que usa el repositorio. */
function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function nodesBlob(nodes: LedgerNode[]): string {
  return JSON.stringify({ version: 1, ownerId: "local", nodes });
}

const NODES: LedgerNode[] = [
  { id: "g-ahorro", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Ahorro", icon: "folder", order: 0 },
  { id: "c-viaje", ownerId: "local", type: "transfer", level: "category", parentId: "g-ahorro", name: "Viaje", icon: "tag", order: 1 },
  { id: "g-trabajo", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: "folder", order: 2 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-trabajo", name: "Salario", icon: "tag", order: 3 },
];

describe("FR-1010 · migración v2→v3 en localStorage (el cliente es el dueño)", () => {
  it("TC-TRF-110h: la migración v2→v3 acumula ambos planos y es idempotente", async () => {
    // @aitri-tc TC-TRF-110h
    const storage = makeStorage({
      [STORAGE_KEYS.nodes]: nodesBlob(NODES),
      [LEGACY_KEY]: JSON.stringify({
        version: 2,
        budgets: { "c-viaje": { ene: 100_000, feb: 100_000, mar: 100_000 } },
        actuals: { "c-viaje": { ene: 100_000, feb: 100_000, mar: 100_000 }, "c-salario": { ene: 500_000 } },
        movements: [],
      }),
    });
    const repo = new LocalStorageRepository(storage);

    const first = await repo.load("local");
    expect(first).not.toBeNull();
    // cumsum en AMBOS planos, escritura DISPERSA: explícito SOLO donde hubo aporte ({100, 200, 300});
    // abr..dic quedan AUSENTES y ARRASTRAN el saldo en gris (el arrastre sobrevive la migración).
    for (const plane of ["budgets", "actuals"] as const) {
      expect(first![plane]["c-viaje"]).toEqual({ ene: 100_000, feb: 200_000, mar: 300_000 });
    }
    expect(resolvedBalance(first!, "c-viaje", "dic", "actual")).toBe(300_000);
    expect(reserveCellState(first!, "c-viaje", "dic", "actual")).toBe("carried");
    // income intacto (no se acumula) y la clave vieja eliminada tras re-persistir en v3.
    expect(first!.actuals["c-salario"]).toEqual({ ene: 500_000 });
    expect(storage.map.has(LEGACY_KEY)).toBe(false);
    expect(storage.map.has(STORAGE_KEYS.budget)).toBe(true);

    // Cargar DOS veces produce exactamente lo mismo que una: la marca (la clave) impide re-acumular.
    const second = await repo.load("local");
    expect(second!.budgets).toEqual(first!.budgets);
    expect(second!.actuals).toEqual(first!.actuals);
  });

  it("TC-TRF-101e: 0 explícito = vaciada, y la distinción ausente-vs-0 sobrevive el round-trip de persistencia", async () => {
    // @aitri-tc TC-TRF-101e
    const storage = makeStorage();
    const repo = new LocalStorageRepository(storage);
    const state: LedgerState = {
      ownerId: "local",
      nodes: NODES,
      budgets: {},
      actuals: { "c-viaje": { jul: 200_000, sep: 0 } }, // ago AUSENTE
      movements: [],
    };

    expect(await repo.save("local", state)).toBe(true);
    const loaded = await repo.load("local");

    // El mapa conserva la forma byte a byte: ago sigue AUSENTE, sep sigue presente con 0.
    expect(loaded!.actuals["c-viaje"]).toEqual({ jul: 200_000, sep: 0 });
    expect("ago" in loaded!.actuals["c-viaje"]).toBe(false);
    // Y la resolución lee lo que corresponde: ago arrastra 200.000, sep..dic resuelven 0 (vaciada).
    expect(resolvedBalance(loaded!, "c-viaje", "ago", "actual")).toBe(200_000);
    expect(resolvedBalance(loaded!, "c-viaje", "sep", "actual")).toBe(0);
    expect(resolvedBalance(loaded!, "c-viaje", "dic", "actual")).toBe(0);
    expect(reserveCellState(loaded!, "c-viaje", "ago", "actual")).toBe("carried");
    expect(reserveCellState(loaded!, "c-viaje", "sep", "actual")).toBe("explicit");
  });
});

describe("NFR-1003 · la migración es no destructiva", () => {
  it("TC-TRF-153h: un estado pre-feature completo carga sin pérdida", async () => {
    // @aitri-tc TC-TRF-153h
    const oldMovements = [
      { id: "m-1", ownerId: "local", type: "expense", catId: "c-salario", subId: null, target: "c-salario", amount: 10_000, month: "ene", createdAt: 1 },
      { id: "m-2", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 50_000, month: "feb", createdAt: 2, date: "2026-02-10T09:00", note: "aporte viejo" },
    ];
    const storage = makeStorage({
      [STORAGE_KEYS.nodes]: nodesBlob(NODES),
      [LEGACY_KEY]: JSON.stringify({
        version: 2,
        budgets: { "c-salario": { ene: 900_000 } },
        actuals: { "c-salario": { ene: 870_000 }, "c-viaje": { feb: 50_000 } },
        movements: oldMovements,
      }),
    });

    const loaded = await new LocalStorageRepository(storage).load("local");

    // Nada se borra: nodos completos, celdas de income intactas, journal completo (sin from/to y con date/note).
    expect(loaded!.nodes.map((n) => n.id)).toEqual(NODES.map((n) => n.id));
    expect(loaded!.budgets["c-salario"]).toEqual({ ene: 900_000 });
    expect(loaded!.actuals["c-salario"]).toEqual({ ene: 870_000 });
    expect(loaded!.movements).toHaveLength(2);
    expect(loaded!.movements[1]).toMatchObject({ id: "m-2", note: "aporte viejo", date: "2026-02-10T09:00" });
    expect(loaded!.movements[1].from).toBeUndefined();
    // La celda transfer migró a saldo disperso: explícito solo en feb; diciembre ARRASTRA 50.000.
    expect(loaded!.actuals["c-viaje"]).toEqual({ feb: 50_000 });
    expect(resolvedBalance(loaded!, "c-viaje", "dic", "actual")).toBe(50_000);
  });

  it("TC-TRF-153e: el CHECK amount >= 0 no cambió y las claves ajenas quedan intactas", () => {
    // @aitri-tc TC-TRF-153e
    const dbSchema = readFileSync(path.join(ROOT, "src/server/db/schema.ts"), "utf8");
    // El CHECK del piso natural sigue tal cual — la feature NO lo toca (constraint del PRD).
    expect(dbSchema).toContain('check("amount_cell_amount_ck", sql`${t.amount} >= 0`)');

    // La migración SQL de la feature es puramente ADITIVA: ni DROP ni ALTER de amount_cell.
    const migration = readFileSync(path.join(ROOT, "drizzle/0001_transferencias.sql"), "utf8");
    expect(migration).not.toMatch(/DROP/i);
    expect(migration).not.toMatch(/ALTER TABLE "amount_cell"/i);
    expect(migration).toMatch(/ADD COLUMN "data_version"/);
    expect(migration).toMatch(/ADD COLUMN "from_id"/);

    // Las claves de datos ajenas a transfer no cambian.
    expect(STORAGE_KEYS.nodes).toBe("ledger.nodes.v1");
  });
});

describe("NFR-1004 · decisión del PUT snapshot", () => {
  it("TC-TRF-154f: el PUT confiado está documentado y el server no re-valida reglas (ADR-04)", () => {
    // @aitri-tc TC-TRF-154f
    // La decisión vive en el diseño aprobado, explícita — no una omisión.
    const design = readFileSync(path.join(ROOT, "aitri/features/transferencias/spec/02_SYSTEM_DESIGN.md"), "utf8");
    expect(design).toMatch(/PUT .*(confiad|CONFIAD)/);
    expect(design).toContain("ADR-04");

    // Y el código honra la decisión: la capa del ledger NO importa las reglas de reservas para el
    // snapshot (validateReserveWrite queda fuera del camino del PUT).
    const repoSrc = readFileSync(path.join(ROOT, "src/server/data/ledgerRepo.ts"), "utf8");
    expect(repoSrc).not.toContain("validateReserveWrite");
    const schemasSrc = readFileSync(path.join(ROOT, "src/server/schemas.ts"), "utf8");
    expect(schemasSrc).not.toContain("validateReserveWrite");
  });
});

describe("NFR-1007 · un solo punto de contacto con el formato viejo", () => {
  it("TC-TRF-157f: el spec de migración es el ÚNICO que siembra v2", () => {
    // @aitri-tc TC-TRF-157f
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry) && readFileSync(full, "utf8").includes(LEGACY_KEY)) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, "tests"));

    // Exactamente este archivo — sembrar v2 fuera de él re-introduciría fixtures con semántica vieja.
    expect(offenders).toEqual(["tests/integration/reserve-migration.test.ts"]);
  });
});
