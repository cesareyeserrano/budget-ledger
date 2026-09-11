import { test, expect, type Page } from "./helpers/fixtures";
import { seedLedger } from "./helpers/seed";
import type { LedgerNode } from "@/domain/types";

// Feature techo-de-flujo — la deuda e2e declarada en 04_BUILD_REPORT.json. Cubre lo que solo el
// NAVEGADOR puede afirmar: que los tres bloques se rendericen y compartan riel de columnas
// (FR-1805), que el «Máx.» diga la cifra que el dominio acepta (FR-1808), que la señal del mes
// aparezca en sus DOS superficies (FR-1806), que las observaciones vivan en cualquier celda
// (FR-1809) con la nota automática solo en bolsillos (FR-1804), y que el Balance se lea con sus
// diez filas y su columna cuadrando a la vista (FR-1810). Prefijo TC-TDF-*.
//
// Los TCs de dominio equivalentes viven en tests/domain/techo-de-flujo.test.ts: allí se afirma la
// ARITMÉTICA; aquí, que la pantalla la muestre. Son fallos distintos — la cuenta puede estar bien
// y el render no aplicarse, y al revés.

const DESK = { width: 1440, height: 1250 };
const MOBILE = { width: 375, height: 900 };

const NODES: LedgerNode[] = [
  { id: "g-ing", ownerId: "local", type: "income", level: "group", parentId: null, name: "Trabajo", icon: null, order: 0 },
  { id: "c-salario", ownerId: "local", type: "income", level: "category", parentId: "g-ing", name: "Salario", icon: null, order: 0 },
  { id: "g-gas", ownerId: "local", type: "expense", level: "group", parentId: null, name: "Hogar", icon: null, order: 1 },
  { id: "c-mercado", ownerId: "local", type: "expense", level: "category", parentId: "g-gas", name: "Mercado", icon: null, order: 0 },
  { id: "g-res", ownerId: "local", type: "transfer", level: "group", parentId: null, name: "Reservas", icon: null, order: 2 },
  { id: "c-alcancia", ownerId: "local", type: "transfer", level: "category", parentId: "g-res", name: "Alcancía", icon: null, order: 0 },
];

/** Un retiro ya operado — misma forma que usa transferencias.spec.ts. */
const retiro = (from: string, period: string, amount: number) => ({
  id: `mv-${from}-${period}`, ownerId: "local", type: "transfer" as const, catId: from, subId: null,
  target: from, amount, period, createdAt: 1, from, to: "@disponible",
});

/**
 * El estado del propio usuario, el que motivó la feature: enero ingresa 1.000, reserva 1.000 y
 * RETIRA 500; febrero ingresa 1.000 y reserva 1.500 — 500 salen del saldo de enero.
 *
 * El retiro de enero es parte esencial del caso, no un adorno: sin él, enero cierra en 0 y las
 * 1.500 de febrero quedarían POR ENCIMA de su techo, que es un estado distinto (y marcado). Con él,
 * la columna de febrero se lee 500 + 1.000 − 1.500 + 0 = 0 sin ninguna alarma. Es el caso donde la
 * versión anterior mostraba «−500» y el usuario objetó que un saldo gastado vale cero, no menos.
 */
const CASO_USUARIO = {
  nodes: NODES,
  actuals: {
    "c-salario": { "2026-01": 1000, "2026-02": 1000 },
    "c-alcancia": { "2026-01": 1000, "2026-02": 1500 },
  },
  movements: [retiro("c-alcancia", "2026-01", 500)],
} as unknown as Parameters<typeof seedLedger>[1];

/** Abre la grilla con el estado sembrado y espera a que el Balance esté montado. */
async function abrir(page: Page, seed: Parameters<typeof seedLedger>[1]): Promise<void> {
  await seedLedger(page, seed);
  await page.goto("/");
  await expect(page.getByTestId("balance-module")).toBeVisible();
}

// Localizadores — misma convención que balance.spec.ts: las filas del árbol se buscan por su
// RÓTULO (no hay atributo con el id del nodo) y las celdas por índice de mes × plano.
const ENE = 0;
const FEB = 1;

/** La fila del árbol cuyo rótulo contiene `name`. */
const filaDe = (page: Page, name: string) =>
  page.getByTestId("node-row").filter({ has: page.getByTestId("row-label").filter({ hasText: name }) });

/**
 * Garantiza que el grupo de Reservas esté desplegado, esté como esté.
 *
 * Es IDEMPOTENTE a propósito: el botón de plegado se llama «Expandir» en los dos estados, así que
 * pulsarlo a ciegas cerraría un grupo ya abierto. Se comprueba primero si la fila del bolsillo ya
 * se ve, y solo entonces se pulsa. Así el test no depende de cuál sea el estado inicial — que es
 * precisamente la decisión de producto que se revirtió al descubrir que escondía los bolsillos.
 */
async function desplegarReservas(page: Page): Promise<void> {
  if (await filaDe(page, "Alcancía").count()) return;
  await filaDe(page, "Reservas").first().getByRole("button", { name: "Expandir" }).first().click();
  await expect(filaDe(page, "Alcancía")).toBeVisible();
}

/** La celda de una hoja: `mes` es el índice de columna (0 = enero), `plano` 0 = Pres., 1 = Ejec. */
const celdaGrilla = (page: Page, name: string, mes: number, plano: 0 | 1) =>
  filaDe(page, name).locator('[data-testid="cell-leaf"]').nth(mes * 2 + plano);

/** La celda de una fila del Balance, por su clave declarada en ROWS. */
const celdaBalance = (page: Page, row: string, mes: number, plano: 0 | 1) =>
  page.locator(`[data-testid="balance-row"][data-row="${row}"]`).getByTestId("balance-cell").nth(mes * 2 + plano);

test.describe("FR-1805 · la grilla en tres bloques", () => {
  test("TC-TDF-040h: se renderizan los tres bloques y Reservas NO comparte el de Ingresos y Gastos", async ({ page }) => {
    // @aitri-tc TC-TDF-040h
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO);

    // Los tres tipos siguen presentes, cada uno con su fila de total.
    for (const type of ["income", "expense", "transfer"]) {
      await expect(page.locator(`[data-testid="type-total-row"][data-type="${type}"]`)).toHaveCount(1);
    }

    // El orden vertical es Ingresos y Gastos · Reservas · Balance. Se afirma por POSICIÓN medida en
    // el navegador, no por el orden del DOM: es lo que el usuario ve.
    const y = async (loc: ReturnType<typeof page.locator>) => (await loc.first().boundingBox())!.y;
    const yGastos = await y(page.locator('[data-testid="type-total-row"][data-type="expense"]'));
    const yReservas = await y(page.locator('[data-testid="type-total-row"][data-type="transfer"]'));
    const yBalance = await y(page.getByTestId("balance-header"));
    expect(yGastos).toBeLessThan(yReservas);
    expect(yReservas).toBeLessThan(yBalance);

    // Y hay SEPARACIÓN real entre bloques: el hueco antes de Reservas es mayor que el alto de una
    // fila cualquiera. Sin esto, «tres bloques» sería indistinguible de nueve filas seguidas.
    const filaAlta = (await page.locator('[data-testid="node-row"]').first().boundingBox())!.height;
    const ultimaDeGastos = filaDe(page, "Mercado");
    const yFinGastos = (await ultimaDeGastos.boundingBox())!.y + (await ultimaDeGastos.boundingBox())!.height;
    expect(yReservas - yFinGastos).toBeGreaterThan(filaAlta * 0.5);
  });

  test("TC-TDF-041h: la fila «Retiros del mes» cierra el bloque de Reservas, ARRIBA del Balance", async ({ page }) => {
    // @aitri-tc TC-TDF-041h
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO);

    const retiros = page.getByTestId("retiros-row");
    await expect(retiros).toHaveCount(1);

    // Vive entre las Reservas y el Balance — el traslado que pidió el usuario (BL-019).
    await desplegarReservas(page);
    const yRetiros = (await retiros.boundingBox())!.y;
    const yAlcancia = (await filaDe(page, "Alcancía").boundingBox())!.y;
    const yBalance = (await page.getByTestId("balance-header").boundingBox())!.y;
    expect(yAlcancia).toBeLessThan(yRetiros);
    expect(yRetiros).toBeLessThan(yBalance);

    // Y es OPERABLE desde ahí: su celda Ejec. abre el mini-form de sacar.
    await retiros.locator('[data-testid="withdraw-cell"][data-month="2026-02"]').click();
    await expect(page.getByTestId("withdraw-source")).toBeVisible();
  });

  test("TC-TDF-042e: los tres bloques comparten UN riel de columnas y UN scroll horizontal", async ({ page }) => {
    // @aitri-tc TC-TDF-042e
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO);

    // Enero de Gastos, enero de Reservas y enero del Balance caen en la MISMA x. Es la propiedad
    // que hace legible la grilla: tres tarjetas, una sola rejilla.
    await desplegarReservas(page);
    // La grilla abre desplazada al mes corriente, así que se ancla en enero para que la medida sea
    // determinista y no dependa de la fecha del reloj.
    await page.getByTestId("budget-grid").evaluate((el) => { el.scrollLeft = 0; });
    await page.waitForTimeout(150);
    const x = async (loc: ReturnType<typeof page.locator>) => Math.round((await loc.first().boundingBox())!.x);
    const xGasto = await x(celdaGrilla(page, "Mercado", ENE, 1));
    const xReserva = await x(celdaGrilla(page, "Alcancía", ENE, 1));
    const xBalance = await x(celdaBalance(page, "monthResult", ENE, 1));
    expect(xReserva).toBe(xGasto);
    expect(xBalance).toBe(xGasto);

    // Al desplazar horizontalmente, los tres se mueven JUNTOS: un solo contenedor de scroll.
    await page.getByTestId("budget-grid").evaluate((el) => { el.scrollLeft = 400; });
    await page.waitForTimeout(150);
    const xGasto2 = await x(celdaGrilla(page, "Mercado", ENE, 1));
    expect(xGasto2).toBeLessThan(xGasto); // de verdad se desplazó
    expect(await x(celdaGrilla(page, "Alcancía", ENE, 1))).toBe(xGasto2);
    expect(await x(celdaBalance(page, "monthResult", ENE, 1))).toBe(xGasto2);
  });

  test("TC-TDF-045f: a 375px la grilla NO se renderiza — la vista sigue siendo Registrar", async ({ page }) => {
    // @aitri-tc TC-TDF-045f
    await page.setViewportSize(MOBILE);
    await seedLedger(page, CASO_USUARIO);
    await page.goto("/");

    await expect(page.getByTestId("budget-grid")).toHaveCount(0);
    // Y sin desbordes: el documento no supera el ancho del viewport.
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(desborde).toBeLessThanOrEqual(1);
  });
});

test.describe("FR-1810 · el Balance se lee de arriba abajo", () => {
  test("TC-TDF-04xh: las diez filas, en tres bloques rotulados y en su orden", async ({ page }) => {
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO);

    // Los rótulos de bloque que el usuario eligió (opción A). El texto se afirma tal cual está en
    // el DOM: la mayúscula es de CSS (`text-transform`), y afirmarla aquí probaría la hoja de
    // estilos, no el contenido. Que se VEA en mayúsculas se comprueba abajo, sobre el estilo
    // computado, que es donde esa propiedad vive de verdad.
    await expect(page.locator('[data-testid="balance-block"]')).toHaveText(["El mes", "Lo disponible", "El cierre"]);
    const transform = await page.locator('[data-testid="balance-block"]').first().locator("div").first()
      .evaluate((el) => getComputedStyle(el).textTransform);
    expect(transform).toBe("uppercase");

    // Y las diez filas con sus nombres, en orden. La fila de retiros del segmento de Reservas se
    // excluye: no pertenece a la cascada del Balance (ADR-09).
    const filas = page.locator('[data-testid="balance-module"] [data-testid="balance-row"] [data-testid="balance-label"]');
    await expect(filas).toHaveText([
      "+Ingresos",
      "−Gastos",
      "=Resultado del mes",
      "Saldo del mes anterior",
      "+Resultado del mes",
      "−Reservas del mes",
      "+Retiros de reservas",
      "=Saldo disponible",
      "+Saldo reservado",
      "=Saldo total",
    ].map((t) => new RegExp(t.replace(/[+−=]/g, (c) => `\\${c}`).replace(/\s+/g, "\\s*"))));
  });

  test("TC-TDF-100h-e2e: la columna del caso del usuario cierra a la vista, y el −500 NO existe", async ({ page }) => {
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO);

    // Febrero, plano Ejecutado: 500 + 1.000 − 1.500 + 0 = 0.
    await expect(celdaBalance(page, "prevAvailable", FEB, 1)).toHaveText("500");
    await expect(celdaBalance(page, "monthResultCarry", FEB, 1)).toHaveText("1.000");
    await expect(celdaBalance(page, "toReserves", FEB, 1)).toHaveText("1.500");
    // «Saldo disponible» muestra su CERO explícito: en una fila de resultado el 0 es la respuesta,
    // no la ausencia de dato — el guion se leía como «sin datos» (queja del usuario).
    await expect(celdaBalance(page, "available", FEB, 1)).toHaveText("0");
    await expect(celdaBalance(page, "reservedBalance", FEB, 1)).toHaveText("2.000");
    await expect(celdaBalance(page, "total", FEB, 1)).toHaveText("2.000");

    // Y en NINGUNA celda del Balance aparece un −500: la objeción conceptual del usuario, hecha
    // aserción de pantalla. Si alguien reintroduce el modelo del reparto, este test cae.
    const textos = await page.locator('[data-testid="balance-module"] [data-testid="balance-cell"]').allInnerTexts();
    expect(textos.some((t) => t.includes("500") && (t.includes("−") || t.includes("-")))).toBe(false);
  });

  test("TC-TDF-104f-e2e: el negativo REAL sí se pinta con alarma, en la fila donde vive", async ({ page }) => {
    await page.setViewportSize(DESK);
    // Gasto mayor que el ingreso y sin ahorro que lo cubra: deuda de verdad.
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-salario": { "2026-01": 500 }, "c-mercado": { "2026-01": 900 } },
    });

    const disponible = celdaBalance(page, "available", ENE, 1);
    await expect(disponible).toContainText("400");
    // Tres canales a la vez (WCAG 1.4.1): color de alerta, signo y glifo.
    const color = await disponible.evaluate((el) => getComputedStyle(el).color);
    expect(color).not.toBe("rgb(28, 28, 31)"); // no es el neutro
    await expect(disponible).toContainText("−");
    await expect(disponible).toContainText("‹‹");

    // Y «Resultado del mes» también es negativo, pero NO alarma: una pérdida es información.
    const resultado = celdaBalance(page, "monthResult", ENE, 1);
    await expect(resultado).toContainText("400");
    await expect(resultado).not.toContainText("‹‹");
  });
});

test.describe("FR-1808 · el «Máx.» dice lo que el dominio acepta", () => {
  test("TC-TDF-070h: el indicador se ve ANTES de teclear y no consume ancho del input", async ({ page }) => {
    // @aitri-tc TC-TDF-070h
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO);

    await desplegarReservas(page);
    await celdaGrilla(page, "Alcancía", ENE, 1).click();
    const max = page.getByTestId("reserve-max");
    await expect(max).toBeVisible(); // visible sin haber tecleado nada (H1/H5)

    // Flota BAJO el input, no a su lado: el input conserva el ancho íntegro de la celda.
    const input = page.locator('[data-testid="cell-leaf"] input, input[aria-label]').first();
    const cajaInput = (await input.boundingBox())!;
    const cajaMax = (await max.boundingBox())!;
    expect(cajaMax.y).toBeGreaterThanOrEqual(cajaInput.y + cajaInput.height - 2);
  });

  test("TC-TDF-072f: bajar una celda con el cupo agotado NO se pinta en rojo", async ({ page }) => {
    // @aitri-tc TC-TDF-072f
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO);

    // Enero tiene el cupo agotado (reservó todo su flujo), pero su celda vale 1.000 y bajarla es
    // perfectamente válido: el «Máx.» es un TOTAL, no un incremento.
    await desplegarReservas(page);
    const celda = celdaGrilla(page, "Alcancía", ENE, 1);
    await celda.click();
    const input = page.locator("input").first();
    await input.fill("800");
    await expect(page.getByTestId("reserve-block")).toHaveCount(0); // sin mensaje de rechazo

    await input.press("Enter");
    await expect(celdaGrilla(page, "Alcancía", ENE, 1)).toHaveText("800");
  });
});

test.describe("FR-1806 · la señal del mes vive en sus dos superficies", () => {
  /** Un mes por encima de su techo: reservó 1.500 con un flujo de 1.000 y sin saldo previo. */
  const EXCEDIDO = {
    nodes: NODES,
    actuals: { "c-salario": { "2026-01": 1000 }, "c-alcancia": { "2026-01": 1500 } },
  };

  test("TC-TDF-050h: la marca del encabezado y la franja del Balance aparecen JUNTAS", async ({ page }) => {
    await page.setViewportSize(DESK);
    await abrir(page, EXCEDIDO);

    // No puede haber marca sin detalle ni detalle sin marca: leen la MISMA lista (ADR-05).
    await expect(page.locator('[data-testid="techo-mark"][data-month="2026-01"]')).toBeVisible();
    const franja = page.getByTestId("techo-banner");
    await expect(franja).toBeVisible();
    await expect(franja).toContainText(/enero/i);
    await expect(franja).toContainText("500"); // el exceso, nombrado

    // La marca no es solo color: lleva texto accesible (WCAG 1.4.1).
    const etiqueta = await page.locator('[data-testid="techo-mark"][data-month="2026-01"]').getAttribute("aria-label");
    expect(etiqueta).toMatch(/enero/i);
  });

  test("TC-TDF-051f: un estado sano no renderiza NINGUNA de las dos — sin esto, 050h no probaría nada", async ({ page }) => {
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO); // reservas dentro del techo en los dos meses

    await expect(page.locator('[data-testid="techo-mark"]')).toHaveCount(0);
    await expect(page.getByTestId("techo-banner")).toHaveCount(0);
  });
});

test.describe("FR-1809 y FR-1804 · observaciones", () => {
  test("TC-TDF-080h: una celda de GASTO admite observación, y su marca aparece al guardarla", async ({ page }) => {
    await page.setViewportSize(DESK);
    await abrir(page, {
      nodes: NODES,
      actuals: { "c-salario": { "2026-01": 1000 }, "c-mercado": { "2026-01": 300 } },
    });

    // Antes de FR-1809 esto solo existía en celdas de bolsillo.
    const celda = celdaGrilla(page, "Mercado", ENE, 1);
    await expect(celda.getByTestId("note-dot")).toHaveCount(0);
    await celda.click();
    const seccion = page.getByTestId("cell-notes");
    await expect(seccion).toBeVisible();
    await expect(page.getByTestId("cell-notes-empty")).toBeVisible();

    await seccion.getByLabel("Añadir observación").fill("mercado de la quincena");
    await seccion.getByTestId("cell-note-add").click();
    await expect(seccion.getByTestId("cell-note")).toHaveText(/mercado de la quincena/);

    // Al cerrar el editor, la celda muestra su marca.
    await page.keyboard.press("Escape");
    await expect(celdaGrilla(page, "Mercado", ENE, 1).getByTestId("note-dot")).toBeVisible();
  });

  test("TC-TDF-034h: la nota automática vive en el BOLSILLO que reservó, nunca en una celda de gasto", async ({ page }) => {
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO); // febrero toma 500 del saldo de enero

    await desplegarReservas(page);
    // En la celda del bolsillo que aportó: la nota derivada, con sus dos cifras.
    await celdaGrilla(page, "Alcancía", FEB, 1).click();
    const nota = page.getByTestId("carry-note");
    await expect(nota).toBeVisible();
    await expect(nota).toContainText("1.500");
    await expect(nota).toContainText("500");
    await expect(nota).toContainText(/enero/i);
    await page.keyboard.press("Escape");

    // Y NO en una celda de gasto del mismo mes: es información del bolsillo, no de cualquier celda.
    // (Auditoría 2026-09-01: el gate sin tipo la mostraba al editar un gasto cualquiera.)
    await celdaGrilla(page, "Mercado", FEB, 1).click();
    await expect(page.getByTestId("cell-notes")).toBeVisible(); // la sección sí está (FR-1809)…
    await expect(page.getByTestId("carry-note")).toHaveCount(0); // …pero sin la nota de reservas
  });
});

test.describe("FR-1805 · el bolsillo que crece y el mes resaltado", () => {
  /** Seis bolsillos: el caso que motivó plegar los grupos (doce filas enterraban los Retiros). */
  const SEIS_BOLSILLOS = {
    nodes: [
      ...NODES,
      ...["Viaje", "Emergencia", "Curso", "Regalo", "Moto"].map((name, i) => ({
        id: `c-b${i}`, ownerId: "local", type: "transfer" as const, level: "category" as const,
        parentId: "g-res", name, icon: null, order: i + 1,
      })),
    ],
    actuals: { "c-salario": { "2026-01": 1000 } },
  } as unknown as Parameters<typeof seedLedger>[1];

  test("TC-TDF-043e: con seis bolsillos y el grupo plegado, «Retiros del mes» sigue a la vista", async ({ page }) => {
    // @aitri-tc TC-TDF-043e
    await page.setViewportSize(DESK);
    await abrir(page, SEIS_BOLSILLOS);

    // El usuario pliega su grupo de Reservas — el caso que AC-1820 describe.
    await filaDe(page, "Reservas").first().getByRole("button", { name: "Expandir" }).first().click();
    await expect(filaDe(page, "Viaje")).toHaveCount(0); // plegado de verdad

    // La fila de retiros sigue montada, visible y dentro del viewport, sin desplazarse.
    const retiros = page.getByTestId("retiros-row");
    await expect(retiros).toBeVisible();
    const caja = (await retiros.boundingBox())!;
    expect(caja.y).toBeGreaterThan(0);
    expect(caja.y + caja.height).toBeLessThanOrEqual(DESK.height);
  });

  test("TC-TDF-044h: el resaltado del mes atraviesa los tres bloques y se mueve a la vez", async ({ page }) => {
    // @aitri-tc TC-TDF-044h
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO);
    await desplegarReservas(page);

    /** Fondo de la celda Ejec. de un mes en cada uno de los tres bloques. */
    const fondos = async (mes: number) => {
      const bg = (l: ReturnType<typeof page.locator>) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
      return {
        gasto: await bg(celdaGrilla(page, "Mercado", mes, 1)),
        reserva: await bg(celdaGrilla(page, "Alcancía", mes, 1)),
        balance: await bg(celdaBalance(page, "monthResult", mes, 1)),
      };
    };

    await page.getByLabel("Mes").click();
    await page.getByRole("option", { name: "Enero 2026", exact: true }).click();
    const ene = await fondos(ENE);
    const feb = await fondos(FEB);

    // Los tres bloques resaltan, y se comprueba bloque a bloque contra SU PROPIO mes sin resaltar.
    // No se exige que los tres den el mismo color: el tinte es el mismo tratamiento (8% de acento)
    // pero se mezcla sobre superficies base distintas —la grilla y el módulo hundido—, así que el
    // resultado difiere por construcción. Lo que AC-1828 pide es que el resaltado LLEGUE a los tres.
    expect(ene.gasto, "el gasto de enero debe resaltar").not.toBe(feb.gasto);
    expect(ene.reserva, "la reserva de enero debe resaltar").not.toBe(feb.reserva);
    expect(ene.balance, "el Balance de enero debe resaltar").not.toBe(feb.balance);

    // Al cambiar de mes, el resaltado se MUEVE en los tres a la vez: febrero toma el tratamiento
    // que tenía enero, y enero recupera el fondo normal.
    await page.getByLabel("Mes").click();
    await page.getByRole("option", { name: "Febrero 2026", exact: true }).click();
    const feb2 = await fondos(FEB);
    const ene2 = await fondos(ENE);
    for (const bloque of ["gasto", "reserva", "balance"] as const) {
      expect(feb2[bloque], `${bloque}: febrero toma el resaltado`).toBe(ene[bloque]);
      expect(ene2[bloque], `${bloque}: enero lo suelta`).toBe(feb[bloque]);
    }
  });
});

test.describe("FR-1808 · el indicador avisa antes de confirmar y no empuja a nadie", () => {
  test("TC-TDF-071e: al pasarse, el «Máx.» enrojece ANTES de confirmar", async ({ page }) => {
    // @aitri-tc TC-TDF-071e
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO);
    await desplegarReservas(page);

    await celdaGrilla(page, "Alcancía", FEB, 1).click();
    const max = page.getByTestId("reserve-max");
    const colorDe = () => max.evaluate((el) => getComputedStyle(el).color);
    const normal = await colorDe();

    // Se teclea por encima del total admitido. NO se confirma: no hay Enter.
    await page.locator("input").first().fill("99999999");
    await expect.poll(colorDe, { timeout: 5000 }).not.toBe(normal);

    // Es el color de alerta, y el rechazo aún no ha ocurrido — la celda no se ha guardado.
    expect(await colorDe()).toBe("rgb(173, 57, 50)"); // --alert-strong claro
    await expect(page.getByTestId("reserve-block")).toHaveCount(0);
  });

  test("TC-TDF-073e: el indicador no tapa ni desplaza las celdas vecinas", async ({ page }) => {
    // @aitri-tc TC-TDF-073e
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO);
    await desplegarReservas(page);

    const filaArriba = () => filaDe(page, "Mercado");
    const yArribaAntes = Math.round((await filaArriba().boundingBox())!.y);

    await celdaGrilla(page, "Alcancía", FEB, 1).click();
    const max = page.getByTestId("reserve-max");
    await expect(max).toBeVisible();

    // (a) Las filas AJENAS al editor no se mueven: el indicador no reflow-ea la grilla.
    expect(Math.round((await filaArriba().boundingBox())!.y)).toBe(yArribaAntes);

    // (b) Y la prueba geométrica de que FLOTA: su caja se sale por debajo de la fila que lo abre,
    //     superponiéndose a lo que hay debajo en vez de empujarlo. Si estuviera en el flujo, su
    //     alto quedaría DENTRO de la fila y todo lo de abajo bajaría (AC-1833).
    const fila = (await filaDe(page, "Alcancía").boundingBox())!;
    const caja = (await max.boundingBox())!;
    expect(caja.y).toBeGreaterThanOrEqual(fila.y + fila.height - 2);
    expect(caja.y + caja.height, "el indicador se sale de su fila: flota").toBeGreaterThan(fila.y + fila.height);

    // (c) Y no tapa el input que lo acompaña: queda por DEBAJO, no encima.
    const input = (await page.locator("input").first().boundingBox())!;
    expect(caja.y).toBeGreaterThanOrEqual(input.y + input.height - 2);
  });
});

/**
 * El escenario de CORRECCIÓN desde la lista (FR-1802 / FR-1803).
 *
 * Marzo ingresa 2.000, reserva 1.000 y retira 500 — el bolsillo queda en 500 y marzo cierra con
 * 1.500 disponibles. Abril reserva 1.300, que salen justo de ese cierre.
 *
 * Los números están elegidos para que la MISMA operación admita una corrección y rechace otra, que
 * es lo que FR-1803 exige demostrar: bajar el retiro a 300 deja marzo cerrando en 1.300 y abril
 * sigue cabiendo exacto; bajarlo a 100 lo dejaría en 1.100 y abril se quedaría sin respaldo. Sin
 * las 1.300 de abril, bajar el retiro no rompería nada y el rechazo no tendría dónde ocurrir.
 */
const CASO_CORRECCION = {
  nodes: NODES,
  actuals: {
    "c-salario": { "2026-03": 2000 },
    "c-alcancia": { "2026-03": 1000, "2026-04": 1300 },
  },
  movements: [{ ...retiro("c-alcancia", "2026-03", 500), id: "mv-f3" }],
} as unknown as Parameters<typeof seedLedger>[1];

/** Marzo con DOS operaciones y nada que dependa de ellas: el escenario de la eliminación. */
const CASO_DOS_OPS = {
  nodes: NODES,
  actuals: {
    "c-salario": { "2026-03": 2000 },
    "c-alcancia": { "2026-03": 1000 },
  },
  movements: [
    { ...retiro("c-alcancia", "2026-03", 300), id: "mv-a", createdAt: 1 },
    { ...retiro("c-alcancia", "2026-03", 200), id: "mv-b", createdAt: 2 },
  ],
} as unknown as Parameters<typeof seedLedger>[1];

/**
 * Índice de COLUMNA de marzo en los dos escenarios de corrección — 0, no 2.
 *
 * El horizonte de la grilla arranca en el primer mes CON DATOS, no en enero: sembrado marzo, la
 * primera columna es marzo (medido: las celdas de retiro van de 2026-03 a 2028-12). `ENE`/`FEB` de
 * arriba valen 0 y 1 porque CASO_USUARIO siembra enero y febrero, no porque el eje sea fijo.
 */
const MAR = 0;

/**
 * Abre la lista «Operaciones de este mes» del mes indicado desde la fila «Retiros del mes».
 *
 * Se localiza por `data-month` y NO por índice: la grilla renderiza 34 celdas de retiro (los doce
 * meses más las de los otros rieles), así que `nth(2)` no es marzo — es otra celda cualquiera, y
 * el fallo se presenta como «la lista no abre» en vez de «apunté a la celda equivocada».
 */
async function abrirOperaciones(page: Page, period: string): Promise<void> {
  await page.locator(`[data-testid="withdraw-cell"][data-month="${period}"]`).click();
  await expect(page.getByTestId("withdraw-history")).toBeVisible();
}

test.describe("FR-1803 · corregir desde la lista, con el rechazo a la vista", () => {
  test("TC-TDF-091h: la edición válida se aplica; la que rompe se rechaza nombrando el mes", async ({ page }) => {
    // @aitri-tc TC-TDF-091h
    await page.setViewportSize(DESK);
    await abrir(page, CASO_CORRECCION);

    await abrirOperaciones(page, "2026-03");
    const monto = page.getByTestId("op-amount-mv-f3");
    await expect(monto).toHaveValue("500");

    // (1) La corrección que el usuario pidió por su nombre: bajar el retiro de 500 a 300.
    await monto.fill("300");
    await monto.press("Enter");
    await expect(monto).toHaveValue("300");
    await expect(page.getByTestId("op-error-mv-f3")).toHaveCount(0);

    // Y la pantalla lo refleja: marzo devuelve 300 en vez de 500, y su disponible baja a 1.300.
    await expect(celdaBalance(page, "toWithdrawals", MAR, 1)).toHaveText("300");
    await expect(celdaBalance(page, "available", MAR, 1)).toHaveText("1.300");

    // (2) La edición que ROMPE: bajarlo a 100 dejaría a abril reservando plata que ya no existe.
    // Antes de esta feature, eliminar un retiro no validaba NADA y por esta puerta se llegaba al
    // encierro; aquí la puerta responde.
    // La lista sigue abierta tras la corrección —el popover no se cierra al editar— así que se
    // reutiliza el mismo campo. Volver a pulsar la celda lo CERRARÍA, que es el gesto de alternar.
    await expect(page.getByTestId("withdraw-history")).toBeVisible();
    const monto2 = page.getByTestId("op-amount-mv-f3");
    await monto2.fill("100");
    await monto2.press("Enter");

    // El mensaje aparece EN LÍNEA, nombra el mes afectado —abril, no marzo— y no se lo lleva un toast.
    const error = page.getByTestId("op-error-mv-f3");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error).toContainText(/abril/i);

    // Y el campo vuelve a lo que había: un rechazo no deja la pantalla mintiendo.
    await expect(monto2).toHaveValue("300");
    await expect(celdaBalance(page, "toWithdrawals", MAR, 1)).toHaveText("300");
    await expect(celdaBalance(page, "available", MAR, 1)).toHaveText("1.300");
  });
});

test.describe("FR-1802 · teclear 0 elimina, en línea y sin modal", () => {
  test("TC-TDF-092e: la fila desaparece con aviso en línea, sin diálogo, y el saldo se restaura", async ({ page }) => {
    // @aitri-tc TC-TDF-092e
    await page.setViewportSize(DESK);
    await abrir(page, CASO_DOS_OPS);

    await abrirOperaciones(page, "2026-03");
    await expect(page.getByTestId("op-retiro")).toHaveCount(2);
    await expect(celdaBalance(page, "toWithdrawals", MAR, 1)).toHaveText("500"); // 300 + 200

    // Cuántas capas de overlay hay ANTES: la lista vive dentro de un popover, que Radix marca como
    // `dialog`. Lo que este caso prohíbe es que aparezca UNA MÁS al eliminar — el diálogo de
    // confirmación que esta feature retira. Contar el delta distingue las dos cosas; afirmar
    // «cero dialogs» habría fallado por el popover y habría tentado a relajar la aserción.
    const overlaysAntes = await page.locator('[role="dialog"]').count();

    const monto = page.getByTestId("op-amount-mv-a");
    await monto.fill("0");
    await monto.press("Enter");

    // La fila desapareció y la lista queda con UNA operación.
    await expect(page.getByTestId("op-amount-mv-a")).toHaveCount(0);
    await expect(page.getByTestId("op-retiro")).toHaveCount(1);
    await expect(page.getByTestId("op-amount-mv-b")).toBeVisible();

    // El aviso EN LÍNEA, dentro de la propia lista y anunciado a los lectores de pantalla.
    const aviso = page.getByTestId("op-deleted-notice");
    await expect(aviso).toBeVisible();
    await expect(aviso).toHaveText("Operación eliminada");
    await expect(aviso).toHaveAttribute("role", "status");

    // Y NINGÚN diálogo nuevo: ni una capa más, ni un alertdialog, ni botones de confirmación.
    expect(await page.locator('[role="dialog"]').count(), "apareció un overlay nuevo").toBe(overlaysAntes);
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /confirmar|sí, |seguro/i })).toHaveCount(0);

    // El saldo restaurado: los 300 vuelven al bolsillo (500 → 800) y marzo solo devuelve ya 200.
    await expect(celdaBalance(page, "toWithdrawals", MAR, 1)).toHaveText("200");
    await expect(celdaBalance(page, "available", MAR, 1)).toHaveText("1.200");
    await expect(celdaBalance(page, "reservedBalance", MAR, 1)).toHaveText("800");
  });
});

test.describe("NFR-1806 · la mudanza de «Retiros del mes» no duplicó la fila", () => {
  test("TC-TDF-253f: existe exactamente UNA, y vive en el segmento de Reservas", async ({ page }) => {
    // @aitri-tc TC-TDF-253f
    // La fila se MUDÓ del Balance al bloque de Reservas (ADR-09). El modo de fallo de una mudanza
    // es dejar la copia vieja donde estaba: dos filas con el mismo rótulo, cada una con su cifra, y
    // el lector sin saber cuál manda. Se cuenta el rótulo en TODA la página, no dentro de un
    // contenedor — buscar solo donde debe estar no puede encontrar la que sobra.
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO);
    await desplegarReservas(page);

    await expect(page.getByTestId("retiros-row")).toHaveCount(1);
    await expect(page.getByTestId("retiros-label")).toHaveCount(1);
    await expect(page.getByText("Retiros del mes", { exact: true })).toHaveCount(1);

    // Su reflejo dentro del Balance existe, pero con OTRO rótulo: son dos filas distintas y se
    // llaman distinto, que es lo que impide leerlas como un duplicado.
    await expect(page.locator('[data-testid="balance-row"][data-row="toWithdrawals"]')).toHaveCount(1);
    await expect(page.getByText("Retiros de reservas", { exact: true })).toHaveCount(1);
    // Y la fila operable NO está entre las del Balance.
    await expect(page.locator('[data-testid="balance-row"][data-row="retiros"]')).toHaveCount(0);

    // Ubicación: bajo el bolsillo y por ENCIMA del encabezado del Balance — cierra Reservas.
    const yRetiros = (await page.getByTestId("retiros-row").boundingBox())!.y;
    const yAlcancia = (await filaDe(page, "Alcancía").boundingBox())!.y;
    const yBalance = (await page.getByTestId("balance-header").boundingBox())!.y;
    expect(yAlcancia).toBeLessThan(yRetiros);
    expect(yRetiros).toBeLessThan(yBalance);
  });
});

test.describe("FR-1807 · la UI retirada no existe", () => {
  test("TC-TDF-061f: sin botón «Sacar» en la fila del bolsillo y sin botones de borrar", async ({ page }) => {
    // @aitri-tc TC-TDF-061f
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO);
    await desplegarReservas(page);

    // En la fila del bolsillo ya no hay puerta propia para sacar: la única está en «Retiros del mes».
    await expect(filaDe(page, "Alcancía").getByRole("button", { name: /sacar/i })).toHaveCount(0);
    await expect(page.getByText("Sin saldo que sacar")).toHaveCount(0);
    await expect(page.getByTestId("withdraw-source-fixed")).toHaveCount(0);
  });

  test("TC-TDF-063f: corregir una operación es editar su monto — no hay botón de borrar", async ({ page }) => {
    // @aitri-tc TC-TDF-063f
    await page.setViewportSize(DESK);
    await abrir(page, CASO_USUARIO); // enero tiene un retiro de 500

    await page.getByTestId("retiros-row").locator('[data-testid="withdraw-cell"]').first().click();
    // La operación del mes se lista con su monto EDITABLE…
    const monto = page.locator('[data-testid^="op-amount-"]').first();
    await expect(monto).toBeVisible();
    // …y no hay ningún botón de borrar en la lista: la corrección es teclear otro monto (0 elimina).
    await expect(page.getByTestId("withdraw-delete")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /borrar|eliminar/i })).toHaveCount(0);
  });
});
