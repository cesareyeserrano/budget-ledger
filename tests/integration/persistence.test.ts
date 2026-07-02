// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { LocalStorageRepository } from "@/data/repository";
import { buildSeed } from "@/domain";
import { STORAGE_KEYS } from "@/domain/types";
import { setLeafAmount, addMovement, renameNode } from "@/domain/mutations";
import { findNode } from "@/domain/tree";

beforeEach(() => localStorage.clear());

describe("FR-011 / NFR-003 persistencia", () => {
  // @aitri-tc TC-011h
  it("TC-011h: los datos persisten tras recargar", async () => {
    const repo = new LocalStorageRepository(localStorage);
    const s = addMovement(buildSeed("local"), { type: "expense", catId: "c-vivienda", amount: 40000, month: "jun" });
    await repo.save("local", s);
    const repo2 = new LocalStorageRepository(localStorage);
    const loaded = await repo2.load("local");
    expect(loaded).not.toBeNull();
    expect(loaded!.movements.some((m) => m.amount === 40000)).toBe(true);
  });

  // @aitri-tc TC-011e
  it("TC-011e: una edición de Presupuesto se relee tras recargar", async () => {
    const repo = new LocalStorageRepository(localStorage);
    const s = setLeafAmount(buildSeed("local"), "s-comida-mercado", "ene", "budget", 900000);
    await repo.save("local", s);
    const loaded = await new LocalStorageRepository(localStorage).load("local");
    expect(loaded!.budgets["s-comida-mercado"].ene).toBe(900000);
  });

  // @aitri-tc TC-011f
  it("TC-011f: JSON inválido → load devuelve null sin lanzar (→ semilla)", async () => {
    localStorage.setItem(STORAGE_KEYS.nodes, "{corrupto::");
    localStorage.setItem(STORAGE_KEYS.budget, "{corrupto::");
    const repo = new LocalStorageRepository(localStorage);
    await expect(repo.load("local")).resolves.toBeNull();
  });

  // @aitri-tc TC-103h
  it("TC-103h: robustez — estado con 2 movimientos + 1 edición sobrevive a reinicio", async () => {
    let s = buildSeed("local");
    s = addMovement(s, { type: "expense", catId: "c-vivienda", amount: 1000, month: "ene" });
    s = addMovement(s, { type: "income", catId: "c-salario", amount: 2000, month: "feb" });
    s = setLeafAmount(s, "c-vivienda", "mar", "budget", 5000);
    await new LocalStorageRepository(localStorage).save("local", s);
    const loaded = await new LocalStorageRepository(localStorage).load("local");
    expect(loaded!.movements.length).toBe(2);
    expect(loaded!.budgets["c-vivienda"].mar).toBe(5000);
  });

  // @aitri-tc TC-103e
  it("TC-103e: fallo de setItem (quota) no propaga crash", async () => {
    const throwing = {
      getItem: () => null,
      setItem: vi.fn(() => { throw new Error("QuotaExceededError"); }),
      removeItem: () => {},
    };
    const repo = new LocalStorageRepository(throwing);
    await expect(repo.save("local", buildSeed("local"))).resolves.toBeUndefined();
    expect(throwing.setItem).toHaveBeenCalled();
  });

  // @aitri-tc TC-103f
  it("TC-103f: payload no conforme al esquema → load null (recupera a semilla)", async () => {
    localStorage.setItem(STORAGE_KEYS.nodes, JSON.stringify({ foo: 1 }));
    localStorage.setItem(STORAGE_KEYS.budget, JSON.stringify({ foo: 1 }));
    const loaded = await new LocalStorageRepository(localStorage).load("local");
    expect(loaded).toBeNull();
  });
});

describe("FR-013 semilla determinista", () => {
  // @aitri-tc TC-013h
  it("TC-013h: primer arranque sin datos → semilla coherente y determinista", async () => {
    const loaded = await new LocalStorageRepository(localStorage).load("local");
    expect(loaded).toBeNull(); // storage vacío
    const a = buildSeed("local");
    const b = buildSeed("local");
    // Ene–May ejecutado > 0, Jul–Dic = 0, para una hoja concreta
    expect(a.actuals["s-comida-mercado"].ene).toBeGreaterThan(0);
    expect(a.actuals["s-comida-mercado"].jul).toBe(0);
    // determinismo
    expect(JSON.stringify(a.actuals)).toBe(JSON.stringify(b.actuals));
  });

  // @aitri-tc TC-013e
  it("TC-013e: la semilla es editable (renombrar persiste)", async () => {
    const s = renameNode(buildSeed("local"), "c-comida", "Alimentación");
    const repo = new LocalStorageRepository(localStorage);
    await repo.save("local", s);
    const loaded = await new LocalStorageRepository(localStorage).load("local");
    expect(findNode(loaded!.nodes, "c-comida")!.name).toBe("Alimentación");
  });

  // @aitri-tc TC-013f
  it("TC-013f: con datos existentes, no se regenera la semilla", async () => {
    // datos de usuario previos con 'Mascotas'
    const s = { ...buildSeed("local") };
    s.nodes = [...s.nodes, { id: "c-mascotas", ownerId: "local", type: "expense" as const, level: "category" as const, parentId: "g-esenciales", name: "Mascotas", icon: "tag", order: 999 }];
    await new LocalStorageRepository(localStorage).save("local", s);
    const loaded = await new LocalStorageRepository(localStorage).load("local");
    expect(loaded).not.toBeNull(); // hay datos → no se usa buildSeed
    expect(findNode(loaded!.nodes, "c-mascotas")).toBeDefined();
  });
});
