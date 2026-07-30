/**
 * Feature transferencias · modelo v4 — FR-1010 (migraciones v2/v3→v4), NFR-1003 (no destructiva,
 * blob corrupto → semilla) y NFR-1004 (PUT confiado documentado).
 *
 * ESTE ARCHIVO es el spec dedicado que siembra los formatos viejos (TC-TRF4-157e): ningún otro
 * archivo de tests/ puede contener las claves ledger.budget.v2 / ledger.budget.v3.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LocalStorageRepository } from "@/data/repository";
import { AVAILABLE_ID, RETIROS_PLAN_ID, resolvedBalance, reserveRetiros } from "@/domain/reserve";
import { STORAGE_KEYS, type LedgerNode, type LedgerState } from "@/domain/types";

const V2_KEY = "ledger.budget.v2";
const V3_KEY = "ledger.budget.v3";
const ROOT = process.cwd();

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

describe("FR-1010 · migraciones al modelo v4 (localStorage)", () => {
  it("TC-TRF4-010h: v3→v4 deshace saldos, sintetiza retiros (Ejec. y plan) y es idempotente", async () => {
    // @aitri-tc TC-TRF4-010h
    const storage = makeStorage({
      [STORAGE_KEYS.nodes]: nodesBlob(NODES),
      [V3_KEY]: JSON.stringify({
        version: 3,
        // saldos v3: aportes 100k×3 y un retiro de 50k en abr; plan no monótono (retiro planeado 30k en jun)
        budgets: { "c-viaje": { ene: 80_000, jun: 50_000 } },
        actuals: { "c-viaje": { ene: 100_000, feb: 200_000, mar: 300_000, abr: 250_000 } },
        movements: [],
      }),
    });
    const repo = new LocalStorageRepository(storage);

    const first = await repo.load("local");
    expect(first).not.toBeNull();
    // Ejecutado: aportes recuperados + retiro sintetizado con nota.
    expect(first!.actuals["c-viaje"]).toEqual({ ene: 100_000, feb: 100_000, mar: 100_000 });
    const synth = first!.movements.filter((m) => m.from === "c-viaje" && m.to === AVAILABLE_ID);
    expect(synth).toHaveLength(1);
    expect(synth[0]).toMatchObject({ month: "abr", amount: 50_000 });
    expect(synth[0].note).toMatch(/migrado/i);
    // Plan: el delta negativo (80k→50k en jun) va a la fila de retiros del plan.
    expect(first!.budgets["c-viaje"]).toEqual({ ene: 80_000 });
    expect(first!.budgets[RETIROS_PLAN_ID]).toEqual({ jun: 30_000 });
    expect(reserveRetiros(first!, "jun", "budget")).toBe(30_000);
    // El saldo derivado v4 == el saldo resuelto v3, mes a mes.
    expect(resolvedBalance(first!, "c-viaje", "mar", "actual")).toBe(300_000);
    expect(resolvedBalance(first!, "c-viaje", "dic", "actual")).toBe(250_000);
    // Idempotencia: la clave vieja se eliminó y la segunda carga no duplica nada.
    expect(storage.map.has(V3_KEY)).toBe(false);
    const second = await repo.load("local");
    expect(second!.actuals).toEqual(first!.actuals);
    expect(second!.movements.filter((m) => m.note?.match(/migrado/i))).toHaveLength(1);
  });
});

describe("NFR-1003 · la migración es no destructiva", () => {
  it("TC-TRF4-153h: un estado pre-feature v2 completo carga sin pérdida (identidad) y el CHECK sigue intacto", async () => {
    // @aitri-tc TC-TRF4-153h
    const oldMovements = [
      { id: "m-1", ownerId: "local", type: "expense", catId: "c-salario", subId: null, target: "c-salario", amount: 10_000, month: "ene", createdAt: 1 },
      { id: "m-2", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 50_000, month: "feb", createdAt: 2, date: "2026-02-10T09:00", note: "aporte viejo" },
    ];
    const storage = makeStorage({
      [STORAGE_KEYS.nodes]: nodesBlob(NODES),
      [V2_KEY]: JSON.stringify({
        version: 2,
        budgets: { "c-salario": { ene: 900_000 } },
        actuals: { "c-salario": { ene: 870_000 }, "c-viaje": { feb: 50_000 } },
        movements: oldMovements,
      }),
    });

    const loaded = await new LocalStorageRepository(storage).load("local");

    // IDENTIDAD: las celdas v2 ya eran aportes — nada se convierte ni se pierde.
    expect(loaded!.nodes.map((n) => n.id)).toEqual(NODES.map((n) => n.id));
    expect(loaded!.budgets["c-salario"]).toEqual({ ene: 900_000 });
    expect(loaded!.actuals["c-viaje"]).toEqual({ feb: 50_000 });
    expect(loaded!.movements).toHaveLength(2);
    expect(loaded!.movements[1]).toMatchObject({ id: "m-2", note: "aporte viejo" });
    expect(loaded!.movements[1].from).toBeUndefined();
    expect(storage.map.has(V2_KEY)).toBe(false); // re-persistido como v4

    // El CHECK de la BD no se toca y la migración drizzle es puramente aditiva.
    const dbSchema = readFileSync(path.join(ROOT, "src/server/db/schema.ts"), "utf8");
    expect(dbSchema).toContain('check("amount_cell_amount_ck", sql`${t.amount} >= 0`)');
    const migration = readFileSync(path.join(ROOT, "drizzle/0001_transferencias.sql"), "utf8");
    expect(migration).not.toMatch(/DROP/i);
    expect(migration).not.toMatch(/ALTER TABLE "amount_cell"/i);
  });

  it("TC-TRF4-153e: claves ajenas intactas y movimientos sin from/to jamás lanzan", async () => {
    // @aitri-tc TC-TRF4-153e
    expect(STORAGE_KEYS.nodes).toBe("ledger.nodes.v1");
    expect(STORAGE_KEYS.budget).toBe("ledger.budget.v4");
    // theme convive sin colisión de prefijo: ninguna clave del ledger la pisa
    expect(Object.values(STORAGE_KEYS).every((k) => k.startsWith("ledger."))).toBe(true);

    const storage = makeStorage({
      [STORAGE_KEYS.nodes]: nodesBlob(NODES),
      [STORAGE_KEYS.budget]: JSON.stringify({
        version: 4,
        budgets: {},
        actuals: { "c-viaje": { feb: 50_000 } },
        movements: [{ id: "m-old", ownerId: "local", type: "transfer", catId: "c-viaje", subId: null, target: "c-viaje", amount: 50_000, month: "feb", createdAt: 1 }],
      }),
    });
    const loaded = await new LocalStorageRepository(storage).load("local");
    expect(loaded).not.toBeNull();
    // movimiento viejo sin from/to: se deriva sin lanzar y no cuenta como retiro
    expect(() => resolvedBalance(loaded!, "c-viaje", "dic", "actual")).not.toThrow();
    expect(resolvedBalance(loaded!, "c-viaje", "dic", "actual")).toBe(50_000);
    expect(reserveRetiros(loaded!, "feb", "actual")).toBe(0);
  });

  it("TC-TRF4-153f: un blob local corrupto (negativos/no enteros) se rechaza y cae a semilla", async () => {
    // @aitri-tc TC-TRF4-153f
    const blobs = [
      { version: 4, budgets: {}, actuals: { "c-viaje": { ene: -999 } }, movements: [] },
      { version: 4, budgets: {}, actuals: { "c-viaje": { ene: 100.5 } }, movements: [] },
      { version: 4, budgets: { [RETIROS_PLAN_ID]: { ene: -5 } }, actuals: {}, movements: [] },
    ];
    for (const blob of blobs) {
      const storage = makeStorage({ [STORAGE_KEYS.nodes]: nodesBlob(NODES), [STORAGE_KEYS.budget]: JSON.stringify(blob) });
      const loaded = await new LocalStorageRepository(storage).load("local");
      expect(loaded, JSON.stringify(blob)).toBeNull(); // → el caller siembra (NFR-003)
    }
  });
});

describe("NFR-1004 · decisión del PUT snapshot", () => {
  it("TC-TRF4-154f: el PUT confiado está documentado y el server no re-valida reglas (ADR-04)", () => {
    // @aitri-tc TC-TRF4-154f
    const design = readFileSync(path.join(ROOT, "aitri/features/transferencias/spec/02_SYSTEM_DESIGN.md"), "utf8");
    expect(design).toMatch(/PUT confiado/);
    expect(design).toContain("ADR-04");
    const repoSrc = readFileSync(path.join(ROOT, "src/server/data/ledgerRepo.ts"), "utf8");
    expect(repoSrc).not.toContain("validateReserveWrite");
    const schemasSrc = readFileSync(path.join(ROOT, "src/server/schemas.ts"), "utf8");
    expect(schemasSrc).not.toContain("validateReserveWrite");
  });
});
