/**
 * BG-043 — la migración 0011 reconcilia las celdas cargadas ANTES del Detalle.
 *
 * La regla «una celda = la suma de sus movimientos» (FR-2511) llegó con diario-de-celda y dejó señaladas
 * como descuadradas las celdas que se habían tecleado cuando esa regla no existía. El arreglo NO es
 * avisar mejor: es que la actualización reconcilie los datos que ya estaban, creando el ajuste que
 * explica la cifra — el mismo que la app crea al teclear un total (FR-2504).
 *
 * Lo que estas pruebas protegen, en este orden: que las cifras NO se tocan, que los comentarios NO se
 * tocan, que la celda queda cuadrada para el dominio, que entra también en meses cerrados y que
 * aplicarla dos veces no duplica nada.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { truncateAll, closeTestDb, testDb, createTestUser } from "./helpers/db";
import { loadLedger } from "@/server/data/ledgerRepo";
import { cellMismatches } from "@/domain/mismatch";
import type { PeriodKey } from "@/domain/types";

const A = "user-bg043";
const SEP: PeriodKey = "2026-09";
const AGO: PeriodKey = "2026-08";
const P: PeriodKey[] = ["2026-07", AGO, SEP, "2026-10"];

const MIGRACION = readFileSync(path.resolve(process.cwd(), "drizzle/0011_reconciliar_celdas_viejas.sql"), "utf8");
const aplicar = () => testDb().execute(sql.raw(MIGRACION));

/** Árbol mínimo: un grupo con una hoja de categoría y una hoja `sub` bajo otra categoría. */
async function sembrarArbol(): Promise<void> {
  const db = testDb();
  // La fila `ledger` del dueño: sin ella no hay revisión ni frontera de cierre que leer.
  await db.execute(sql`INSERT INTO ledger (owner_id, revision, data_version) VALUES (${A}, 1, 4)`);
  await db.execute(sql`
    INSERT INTO node (owner_id, id, type, level, parent_id, name, icon, system, sort_order) VALUES
      (${A}, 'g-gas',   'expense', 'group',    NULL,        'Hogar',       NULL, false, 0),
      (${A}, 'c-merc',  'expense', 'category', 'g-gas',     'Mercado',     NULL, false, 0),
      (${A}, 'c-tec',   'expense', 'category', 'g-gas',     'Tecnologia',  NULL, false, 1),
      (${A}, 's-acc',   'expense', 'sub',      'c-tec',     'Accesorios',  NULL, false, 0),
      (${A}, 'g-ing',   'income',  'group',    NULL,        'Trabajo',     NULL, false, 2),
      (${A}, 'c-sal',   'income',  'category', 'g-ing',     'Salario',     NULL, false, 0)`);
}
const celda = (nodeId: string, period: PeriodKey, amount: number) =>
  testDb().execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
                       VALUES (${A}, ${nodeId}, ${period}, 'actual', ${amount})`);
const movimiento = (id: string, target: string, period: PeriodKey, amount: number, createdAt: number) =>
  testDb().execute(sql`INSERT INTO movement (owner_id, id, type, cat_id, sub_id, target, amount, period, created_at, date, note, kind)
                       VALUES (${A}, ${id}, 'expense', ${target}, NULL, ${target}, ${amount}, ${period}, ${createdAt},
                               ${`${period}-05T12:00`}, 'Pan', 'manual')`);

async function movimientosDe(target: string, period: PeriodKey) {
  const r = await testDb().execute(sql`SELECT id, amount, kind, date, note, cat_id, sub_id, created_at
                                       FROM movement WHERE owner_id = ${A} AND target = ${target} AND period = ${period}
                                       ORDER BY created_at`);
  return [...r] as { id: string; amount: string | number; kind: string; date: string; note: string;
                     cat_id: string; sub_id: string | null; created_at: string | number }[];
}
async function celdasDe(): Promise<Record<string, number>> {
  const r = await testDb().execute(sql`SELECT node_id, period, amount FROM amount_cell WHERE owner_id = ${A} ORDER BY node_id, period`);
  return Object.fromEntries([...r].map((f) => {
    const x = f as { node_id: string; period: string; amount: string | number };
    return [`${x.node_id} ${x.period}`, Number(x.amount)];
  }));
}

beforeEach(async () => {
  await truncateAll();
  await createTestUser(A, "bg043@example.com");
  await sembrarArbol();
});
afterAll(async () => { await closeTestDb(); });

describe("BG-043 — la migración 0011 cuadra lo viejo sin tocar lo que el usuario escribió", () => {
  it("BG-043-a: una celda tecleada sin movimientos recibe su ajuste por el total", async () => {
    // @aitri-tc BG-043-a
    await celda("c-merc", SEP, 388_800);
    const antes = await celdasDe();

    await aplicar();

    const movs = await movimientosDe("c-merc", SEP);
    expect(movs).toHaveLength(1);
    expect(Number(movs[0].amount)).toBe(388_800);
    expect(movs[0].kind).toBe("adjustment");
    expect(movs[0].date).toBe("2026-09-01T12:00");
    expect(movs[0].note).toContain("Ajuste de apertura");
    // La cifra NO se toca: es la condición que el usuario puso.
    expect(await celdasDe()).toEqual(antes);
  });

  it("BG-043-b: una celda con movimientos parciales recibe solo la DIFERENCIA", async () => {
    // @aitri-tc BG-043-b
    await celda("s-acc", SEP, 4_280_800);
    await movimiento("m-1", "s-acc", SEP, 230_800, 1);

    await aplicar();

    const movs = await movimientosDe("s-acc", SEP);
    expect(movs).toHaveLength(2);
    const ajuste = movs.find((m) => m.kind === "adjustment")!;
    expect(Number(ajuste.amount)).toBe(4_050_000);
    // Hoja `sub`: la categoría es su padre y la sub es la hoja (misma codificación que adjust.ts).
    expect({ cat: ajuste.cat_id, sub: ajuste.sub_id }).toEqual({ cat: "c-tec", sub: "s-acc" });
    // El movimiento que ya existía sigue igual.
    const manual = movs.find((m) => m.kind === "manual")!;
    expect({ amount: Number(manual.amount), note: manual.note }).toEqual({ amount: 230_800, note: "Pan" });
  });

  it("BG-043-c: si la celda vale MENOS que sus movimientos, el ajuste es negativo", async () => {
    // @aitri-tc BG-043-c
    await celda("c-merc", SEP, 10_000);
    await movimiento("m-1", "c-merc", SEP, 30_000, 1);

    await aplicar();

    const ajuste = (await movimientosDe("c-merc", SEP)).find((m) => m.kind === "adjustment")!;
    expect(Number(ajuste.amount)).toBe(-20_000);
  });

  it("BG-043-d: tras migrar, el dominio ya no ve ninguna celda descuadrada", async () => {
    // @aitri-tc BG-043-d
    await celda("c-merc", SEP, 388_800);
    await celda("s-acc", AGO, 112_618);
    await celda("c-sal", SEP, 11_311_690);
    await movimiento("m-1", "c-merc", SEP, 88_800, 1);
    const estadoAntes = (await loadLedger(A))!.state;
    expect(cellMismatches(estadoAntes, P)).toHaveLength(3);

    await aplicar();

    const estado = (await loadLedger(A))!.state;
    expect(cellMismatches(estado, P)).toEqual([]);
    // Y ninguna cifra cambió por el camino.
    expect(estado.actuals["c-merc"]?.[SEP]).toBe(388_800);
    expect(estado.actuals["s-acc"]?.[AGO]).toBe(112_618);
    expect(estado.actuals["c-sal"]?.[SEP]).toBe(11_311_690);
  });

  it("BG-043-e: entra también en un mes CERRADO y no mueve la frontera", async () => {
    // @aitri-tc BG-043-e
    await celda("c-merc", SEP, 50_000);
    await testDb().execute(sql`UPDATE ledger SET closed_through = ${SEP} WHERE owner_id = ${A}`);

    await aplicar();

    expect(await movimientosDe("c-merc", SEP)).toHaveLength(1);
    const r = await testDb().execute(sql`SELECT closed_through FROM ledger WHERE owner_id = ${A}`);
    expect(([...r][0] as { closed_through: string }).closed_through).toBe(SEP);
  });

  it("BG-043-f: los comentarios de la celda no se tocan", async () => {
    // @aitri-tc BG-043-f
    await celda("c-merc", SEP, 50_000);
    await testDb().execute(sql`INSERT INTO cell_note (owner_id, node_id, period, id, created_at, text, date) VALUES
      (${A}, 'c-merc', ${SEP}, 'n-viejo', 1, 'Pedir factura', NULL),
      (${A}, 'c-merc', ${SEP}, 'n-nuevo', 2, 'Compartido con Ana', '2026-09-21')`);

    await aplicar();

    const r = await testDb().execute(sql`SELECT id, text, date FROM cell_note WHERE owner_id = ${A} ORDER BY id`);
    expect([...r]).toEqual([
      { id: "n-nuevo", text: "Compartido con Ana", date: "2026-09-21" },
      { id: "n-viejo", text: "Pedir factura", date: null },
    ]);
  });

  it("BG-043-g: aplicarla dos veces no duplica ni descuadra", async () => {
    // @aitri-tc BG-043-g
    await celda("c-merc", SEP, 388_800);

    await aplicar();
    await expect(aplicar()).resolves.toBeDefined();

    expect(await movimientosDe("c-merc", SEP)).toHaveLength(1);
    expect(cellMismatches((await loadLedger(A))!.state, P)).toEqual([]);
  });

  it("BG-043-h: no inventa ajustes donde no hay descuadre, ni en bolsillos ni en nodos padre", async () => {
    // @aitri-tc BG-043-h
    await celda("c-merc", SEP, 30_000);
    await movimiento("m-1", "c-merc", SEP, 30_000, 1); // cuadrada: no debe recibir nada
    await testDb().execute(sql`
      INSERT INTO node (owner_id, id, type, level, parent_id, name, icon, system, sort_order)
      VALUES (${A}, 'g-res', 'transfer', 'group', NULL, 'Reservas', NULL, false, 3),
             (${A}, 'c-via', 'transfer', 'category', 'g-res', 'Viaje', NULL, false, 0)`);
    await testDb().execute(sql`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
                               VALUES (${A}, 'c-via', ${SEP}, 'actual', 1_000_000),
                                      (${A}, 'c-tec', ${SEP}, 'actual', 500_000)`); // c-tec es PADRE de s-acc

    await aplicar();

    const r = await testDb().execute(sql`SELECT count(*)::int AS n FROM movement WHERE owner_id = ${A} AND kind = 'adjustment'`);
    expect(([...r][0] as { n: number }).n).toBe(0);
  });
});
