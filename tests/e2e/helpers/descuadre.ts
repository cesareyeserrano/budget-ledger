/**
 * Module: tests/e2e/helpers/descuadre
 * Purpose: Sembrar un ledger DESCUADRADO por SQL directo (feature diario-de-celda, NFR-2502).
 *
 *   POR QUÉ HACE FALTA UN ACCESO DIRECTO A LA BASE, y por qué NO es un atajo. Desde esta feature el
 *   servidor rechaza toda escritura que descuadre una celda de gasto o ingreso: su valor tiene que
 *   ser la suma de sus movimientos. Es correcto para el producto —nadie debe poder fabricar un
 *   descuadre desde fuera— pero deja sin escenario a las pruebas que necesitan PARTIR de uno.
 *
 *   El caso real: TC-CIC-176f (feature ciclos) comprueba que, al cambiar de periodo, la
 *   previsualización avisa de que una celda «quedaría en negativo» porque el usuario tecleó menos de
 *   lo que suman sus movimientos. Ese aviso solo existe si la celda NO cuadra, así que el escenario
 *   es, por definición, un descuadre previo. Sembrarlo por la API es imposible a propósito.
 *
 *   Es el ÚNICO caso de la suite que lo necesita: su hermana TC-CIC-175f verifica la misma regla en
 *   el dominio (`tests/domain/ciclos.test.ts`), donde no hay base ni API de por medio.
 *
 *   Es infraestructura de pruebas, equivalente al reset de cierre (`closure.ts`) y a un TRUNCATE: no
 *   se añade ningún endpoint de producción para esto, que sería justo la puerta trasera que la regla
 *   existe para no tener. La decisión es del usuario (2026-09-15, opción A).
 * Dependencies: ./pg
 */
import { db } from "./pg";
import type { LedgerState } from "@/domain/types";

/**
 * Escribe celdas y movimientos de UNA cuenta saltándose la API, sin exigir que cuadren.
 *
 * ACOTADO A UNA CUENTA por su correo, y no por elegancia: los workers comparten Postgres —cada uno
 * tiene su cuenta, no su base—, así que una escritura sin `WHERE` envenenaría la prueba de otro y
 * aparecería como intermitencia inexplicable (la lección que ya dejó escrita `closure.ts`).
 *
 * Sube la revisión en 1, como haría un guardado real: el cliente lee con lock optimista y un
 * `baseRevision` viejo recibiría 409.
 *
 * @param email Correo de la cuenta e2e del worker.
 * @param state Estado a escribir; solo se usan `actuals` y `movements` (los nodos ya están).
 * @throws Nunca — sin base configurada no hace nada, como el resto de helpers de reset.
 */
export async function seedDescuadrado(
  email: string, state: Pick<LedgerState, "actuals" | "movements">
): Promise<void> {
  const c = db();
  if (!c) return;
  const owner = c`(SELECT id FROM "user" WHERE email = ${email})`;

  await c`DELETE FROM amount_cell WHERE owner_id IN ${owner} AND kind = 'actual'`;
  await c`DELETE FROM movement WHERE owner_id IN ${owner}`;

  for (const [nodeId, meses] of Object.entries(state.actuals)) {
    for (const [period, amount] of Object.entries(meses)) {
      if (amount == null) continue;
      await c`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
              SELECT id, ${nodeId}, ${period}, 'actual', ${amount} FROM "user" WHERE email = ${email}`;
    }
  }
  for (const m of state.movements) {
    await c`INSERT INTO movement (owner_id, id, type, cat_id, sub_id, target, amount, period, created_at, date, note, from_id, to_id, kind)
            SELECT id, ${m.id}, ${m.type}, ${m.catId}, ${m.subId}, ${m.target}, ${m.amount},
                   ${m.period}, ${m.createdAt}, ${m.date ?? null}, ${m.note ?? null},
                   ${m.from ?? null}, ${m.to ?? null}, ${m.kind ?? "manual"}
            FROM "user" WHERE email = ${email}`;
  }
  await c`UPDATE ledger SET revision = revision + 1 WHERE owner_id IN ${owner}`;
}

/**
 * Descuadra UNA celda sin tocar `revision` (feature diario-de-celda, TC-DDC-217f).
 *
 * La diferencia con `seedDescuadrado` es justo la revisión, y es TODO el escenario: simula el dato
 * que cambió por debajo mientras una pestaña seguía abierta. Si subiera la revisión, el cliente
 * detectaría el conflicto por el lock optimista y nunca llegaría a pedir el cierre — que es
 * precisamente lo que el caso quiere que ocurra, para comprobar que el servidor lo rechaza y el
 * control se pone al día tras el resync.
 *
 * @param email Correo de la cuenta e2e del worker (aislamiento por cuenta, como el resto).
 * @param nodeId Hoja cuya celda de Ejecutado se descuadra.
 * @param period Periodo de la celda.
 * @param amount Valor que se le escribe, sin movimientos que lo respalden.
 * @throws Nunca — sin base configurada no hace nada.
 */
export async function descuadrarCelda(
  email: string, nodeId: string, period: string, amount: number
): Promise<void> {
  const c = db();
  if (!c) return;
  await c`INSERT INTO amount_cell (owner_id, node_id, period, kind, amount)
          SELECT id, ${nodeId}, ${period}, 'actual', ${amount} FROM "user" WHERE email = ${email}
          ON CONFLICT (owner_id, node_id, period, kind) DO UPDATE SET amount = ${amount}`;
}
