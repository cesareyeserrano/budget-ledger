// @vitest-environment jsdom
/**
 * FR-011 / NFR-003 / FR-013 — persistencia y semilla.
 *
 * Re-cimentado por la feature servidor-fuente-unica (FR-1106, ADR-03). Antes todo este archivo
 * ejercitaba LocalStorageRepository, que se retiró de src/. Ahora:
 *   · el round-trip de persistencia se prueba contra ServerRepository (el camino REAL de producción)
 *   · los casos que solo necesitaban "un repositorio cualquiera" usan el fake InMemoryRepository
 *   · la semilla (FR-013) se prueba sobre buildSeed, que es su verdadero sujeto
 *
 * RISK-2 declarado (ver TRD): la robustez ante datos corruptos NO es equivalente entre ambos
 * caminos. LocalStorageRepository validaba con Zod y devolvía null (recuperación a semilla, sin
 * lanzar). ServerRepository LANZA ante una respuesta malformada y NO valida la forma del cuerpo
 * cuando el JSON es sintácticamente válido. Estos tests verifican lo que el camino de servidor
 * garantiza de verdad —que el fallo no rompe la app— y NO fingen cubrir la validación de forma,
 * que quedó registrada como hueco (BL-021).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ServerRepository } from "@/data/serverRepository";
import { InMemoryRepository } from "../helpers/inMemoryRepository";
import { buildSeed } from "@/domain";
import { setLeafAmount, addMovement, renameNode } from "@/domain/mutations";
import { findNode } from "@/domain/tree";
import type { Movement, LedgerNode } from "@/domain/types";
import { P, P0 } from "../helpers/periods";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

/** Simula la API: el PUT acepta y el GET devuelve el último estado guardado. */
function stubApi(initial: ReturnType<typeof buildSeed> | null = null) {
  let stored = initial;
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      stored = JSON.parse(String(init.body)).state;
      return new Response(JSON.stringify({ revision: 1 }), { status: 200 });
    }
    if (stored === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ revision: 1, state: stored }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("FR-011 / NFR-003 persistencia", () => {
  // @aitri-tc TC-011h
  it("TC-011h: los datos persisten tras recargar", async () => {
    stubApi();
    const repo = new ServerRepository();
    const s = addMovement(buildSeed("local", P0), { type: "expense", catId: "c-vivienda", amount: 40000, period: "2026-06" }, P);
    await repo.save("local", s);
    // Instancia NUEVA: simula la recarga de la página, sin estado en memoria compartido.
    const loaded = await new ServerRepository().load();
    expect(loaded).not.toBeNull();
    expect(loaded!.movements.some((m: Movement) => m.amount === 40000)).toBe(true);
  });

  // @aitri-tc TC-011e
  it("TC-011e: una edición de Presupuesto se relee tras recargar", async () => {
    stubApi();
    const s = setLeafAmount(buildSeed("local", P0), "s-comida-mercado", "2026-01", "budget", 900000, P);
    await new ServerRepository().save("local", s);
    const loaded = await new ServerRepository().load();
    expect(loaded!.budgets["s-comida-mercado"]["2026-01"]).toBe(900000);
  });

  // @aitri-tc TC-011f
  it("TC-011f: una respuesta malformada no lanza y devuelve null (el caller siembra)", async () => {
    // Restaurado a lo que el AC-022 aprobado siempre pidió: «load NO lanza excepción y devuelve
    // null». La versión anterior de ESTE test afirmaba lo contrario (`rejects`) porque se reescribió
    // para encajar con el camino de servidor cuando se adoptó — el código se apartó del contrato y
    // el test se movió detrás. BG-012 devuelve ambos a su sitio.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{corrupto::", { status: 200 })));
    const repo = new ServerRepository();
    await expect(repo.load()).resolves.toBeNull();
    // Y se distingue de un 204: `malformed` le dice al caller que NO siembre encima (ver BG-012).
    expect(repo.malformed).toBe(true);
  });

  // @aitri-tc TC-103h
  it("TC-103h: robustez — estado con 2 movimientos + 1 edición sobrevive a reinicio", async () => {
    stubApi();
    let s = buildSeed("local", P0);
    s = addMovement(s, { type: "expense", catId: "c-vivienda", amount: 1000, period: "2026-01" }, P);
    s = addMovement(s, { type: "income", catId: "c-salario", amount: 2000, period: "2026-02" }, P);
    s = setLeafAmount(s, "c-vivienda", "2026-03", "budget", 5000, P);
    await new ServerRepository().save("local", s);
    const loaded = await new ServerRepository().load();
    expect(loaded!.movements.length).toBe(2);
    expect(loaded!.budgets["c-vivienda"]["2026-03"]).toBe(5000);
  });

  // @aitri-tc TC-103e
  it("TC-103e: un fallo de persistencia devuelve false y no propaga crash", async () => {
    // Antes: QuotaExceededError de localStorage. Ahora el fallo equivalente es la red caída —
    // el disparador cambió con el almacén, la garantía (no propagar, devolver false) es la misma.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const repo = new ServerRepository();
    await expect(repo.save("local", buildSeed("local", P0))).resolves.toBe(false);
    // Y no quedó marcado como conflicto: un fallo de red NO es un 409 (distinción de la que
    // depende el store para elegir entre re-sincronizar y avisar al usuario).
    expect(repo.conflicted).toBe(false);
  });

  // @aitri-tc TC-103f
  it("TC-103f: un estado HTTP inesperado lanza en vez de devolver datos a medias", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(new ServerRepository().load()).rejects.toThrow(/HTTP 500/);
  });
});

describe("FR-013 semilla determinista", () => {
  // @aitri-tc TC-013h
  it("TC-013h: primer arranque sin datos → semilla coherente y determinista", async () => {
    // 204 = usuario nuevo: el repositorio devuelve null y el CLIENTE siembra (FR-513).
    stubApi(null);
    expect(await new ServerRepository().load()).toBeNull();
    const a = buildSeed("local", P0);
    const b = buildSeed("local", P0);
    expect(a.actuals["s-comida-mercado"]["2026-01"]).toBeGreaterThan(0);
    expect(a.actuals["s-comida-mercado"]["2026-07"]).toBe(0);
    expect(JSON.stringify(a.actuals)).toBe(JSON.stringify(b.actuals));
  });

  // @aitri-tc TC-013e
  it("TC-013e: la semilla es editable (renombrar persiste)", async () => {
    const repo = new InMemoryRepository();
    const s = renameNode(buildSeed("local", P0), "c-comida", "Alimentación");
    await repo.save("local", s);
    const loaded = await repo.load("local");
    expect(findNode(loaded!.nodes, "c-comida")!.name).toBe("Alimentación");
  });

  // @aitri-tc TC-013f
  it("TC-013f: con datos existentes, no se regenera la semilla", async () => {
    const repo = new InMemoryRepository();
    const s = { ...buildSeed("local", P0) };
    s.nodes = [...s.nodes, { id: "c-mascotas", ownerId: "local", type: "expense" as const, level: "category" as const, parentId: "g-esenciales", name: "Mascotas", icon: "tag", order: 999 }];
    await repo.save("local", s);
    const loaded = await repo.load("local");
    expect(loaded).not.toBeNull(); // hay datos → no se usa buildSeed
    expect(findNode(loaded!.nodes, "c-mascotas")).toBeDefined();
    // La semilla no se coló encima de los datos del usuario.
    expect(loaded!.nodes.filter((n: LedgerNode) => n.id === "c-mascotas").length).toBe(1);
  });
});
