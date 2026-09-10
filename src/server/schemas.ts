// @aitri-trace FR-ID: FR-507, US-ID: US-507, AC-ID: AC-507c, TC-ID: TC-BE-026f
/**
 * Module: server/schemas
 * Purpose: Esquemas Zod del BORDE de la API (FR-507). Reutilizan las reglas del dominio compartido
 *   (PERIOD_KEY, amountSchema) para que el contrato de datos sea UNO solo cliente/servidor (evita
 *   deriva). Un payload que no valida se rechaza 400/422 ANTES de abrir cualquier transacción.
 * Dependencies: zod, @/domain (PERIOD_KEY, amountSchema)
 */
import { z } from "zod";
import { PERIOD_KEY, amountSchema, cellAmountSchema } from "@/domain";

const nodeType = z.enum(["expense", "income", "transfer"]);

/** Input de un movimiento nuevo (POST /api/v1/movements). amount entero >= 1 (regla del dominio). */
export const movementInputSchema = z.object({
  type: nodeType,
  catId: z.string().min(1),
  subId: z.string().nullable().optional(),
  amount: amountSchema,
  period: PERIOD_KEY,
  date: z.string().optional(),
  note: z.string().nullable().optional(),
  // Feature transferencias (FR-1004/FR-1010): extremos De→A de una operación de reserva (hoja
  // transfer o el sentinel "@disponible"). Acotados como `target`; ignorados para expense/income.
  from: z.string().min(1).max(64).optional(),
  to: z.string().min(1).max(64).optional(),
});
export type MovementInput = z.infer<typeof movementInputSchema>;

const apiNodeSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  type: nodeType,
  level: z.enum(["group", "category", "sub"]),
  parentId: z.string().nullable(),
  name: z.string(),
  icon: z.string().nullable(),
  system: z.boolean().optional(),
  order: z.number().int(),
});

// BG-021: la celda comparte el tope del dominio. Sin el, un snapshot podia traer 1e21 y el
// PUT terminaba en 500 al chocar con el bigint de Postgres, o guardaba en silencio otro numero.
const apiAmountMap = z.record(z.string(), z.record(PERIOD_KEY, cellAmountSchema));

const apiMovementSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  type: nodeType,
  catId: z.string(),
  subId: z.string().nullable(),
  target: z.string(),
  amount: amountSchema, // BG-021: con tope superior
  period: PERIOD_KEY,
  createdAt: z.number(),
  date: z.string().optional(),
  note: z.string().nullable().optional(),
  // FR-1010: sin estos campos el PUT snapshot haría strip silencioso de los extremos De→A.
  from: z.string().optional(),
  to: z.string().optional(),
});

/** Observaciones por celda (FR-1012): nodeId → mes → notas manuales (texto ≤280, como `note`). */
const apiCellNotes = z.record(
  z.string(),
  z.record(PERIOD_KEY, z.array(z.object({ id: z.string(), createdAt: z.number(), text: z.string().min(1).max(280) })))
);

/** Estado completo del ledger para el snapshot PUT. */
/** Feature ciclos: la configuración versionada tal como viaja en el snapshot (solo lectura). */
export const cycleConfigSchema = z.object({
  mode: z.enum(["month", "cycle"]),
  versions: z.array(z.object({
    seq: z.number().int(),
    mode: z.enum(["month", "cycle"]),
    anchorDay: z.number().int().min(1).max(31).nullable(),
    eomPolicy: z.enum(["last_day", "shift"]).nullable(),
    effectiveFrom: z.string(),
    firstPay: z.string().nullable(),
    restoreStartMonth: z.string().nullable(),
    createdAt: z.string(),
  })),
});
export const ledgerStateSchema = z.object({
  ownerId: z.string(),
  nodes: z.array(apiNodeSchema),
  budgets: apiAmountMap,
  actuals: apiAmountMap,
  movements: z.array(apiMovementSchema),
  // FR-1010/FR-1012: opcional — un cliente pre-feature no lo envía; sin este campo el PUT haría
  // strip silencioso de las observaciones.
  cellNotes: apiCellNotes.optional(),
  // FR-2001: opcional, por el MISMO motivo que cellNotes — y la trampa es literalmente la misma.
  // Este esquema no solo valida el PUT: ServerRepository.load() lo usa para validar el snapshot
  // que LLEGA, y zod descarta por defecto lo que no declara. Sin esta línea el cierre viajaba del
  // servidor al navegador y desaparecía en silencio antes de tocar el store, así que la grilla
  // pintaba todo como abierto por mucho que la base dijera lo contrario.
  //
  // Aceptarlo en el PUT es inofensivo: saveLedger IGNORA state.closure a propósito — la frontera
  // solo la mueven los endpoints de cierre.
  closure: z
    .object({
      closedThrough: PERIOD_KEY.nullable(),
      reopened: PERIOD_KEY.nullable(),
      // FR-2010. Declararlo NO es opcional aunque el campo lo sea: zod descarta las claves que no
      // están en el esquema, y este mismo objeto valida la RESPUESTA que el cliente carga. Sin esta
      // línea la línea de base viajaba correcta desde el servidor y el navegador la tiraba al
      // parsear, así que el impacto salía siempre vacío sin ningún error a la vista.
      reopenBaseline: z
        .object({ available: z.number().finite(), reservedBalance: z.number().finite() })
        .optional(),
    })
    .optional(),
  // FR-2201/FR-2202: la apertura declarada. Opcionales y NULLABLES, por el mismo motivo que
  // `closure` y `cellNotes` — y con la MISMA trampa, que conviene no volver a pisar: este esquema
  // no solo valida el PUT, `ServerRepository.load()` lo usa para validar el snapshot que LLEGA, y
  // zod descarta por defecto lo que no declara. Sin estas dos lineas los valores viajarian
  // correctos desde el servidor y desapareceran en silencio antes de tocar el store, asi que la
  // grilla abriria en cero por mucho que la base dijera otra cosa (TC-MSI-063e).
  //
  // Aceptarlos en el PUT es inofensivo: `saveLedger` los IGNORA a proposito — la apertura solo la
  // mueve PUT /api/v1/ledger/start, que es donde viven sus dos reglas de servidor (ADR-02).
  startMonth: PERIOD_KEY.nullable().optional(),
  openingBalance: cellAmountSchema.nullable().optional(), // BG-021
  // Feature ciclos (ADR-03): se ACEPTA (el cliente lo recibe en GET y lo reenvía en PUT) y se IGNORA
  // en saveLedger — la configuración solo cambia por /api/v1/ledger/cycles.
  cycles: cycleConfigSchema.optional(),
});

/** Cuerpo de PUT /api/v1/ledger: estado completo + revisión base para el lock optimista. */
export const ledgerPutSchema = z.object({
  baseRevision: z.number().int().gte(0),
  state: ledgerStateSchema,
});
export type LedgerPutBody = z.infer<typeof ledgerPutSchema>;

/**
 * Cuerpo de PUT /api/v1/ledger/start (FR-2201/FR-2202/ADR-02): la apertura declarada del historial.
 *
 * UN solo endpoint para los DOS valores, no dos. El usuario declara un hecho —«mi historia empieza
 * en junio con 1.200.000»— y partirlo en dos escrituras abriria una ventana en la que el mes ya
 * cambio pero el saldo todavia no, con la cascada recalculada a medias entre las dos. Ademas sube
 * `revision` una sola vez.
 *
 * `openingBalance` admite null: es el estado «declare cuando empiezo, pero no traigo dinero previo»
 * (los estados 3 y 4 de la tarjeta de arranque). El negativo se rechaza aqui, antes de que ninguna
 * consulta de dominio llegue a ejecutarse (TC-MSI-092h).
 */
export const startPutSchema = z.object({
  baseRevision: z.number().int().gte(0),
  startMonth: PERIOD_KEY,
  openingBalance: cellAmountSchema.nullable(), // BG-021
});
export type StartPutBody = z.infer<typeof startPutSchema>;

/**
 * Cuerpo del PUT del horizonte (FR-1907). Solo 1 o 2 AÑOS: cualquier otro valor es 400 antes de
 * tocar la base — el CHECK de la columna queda como última defensa, no como la única.
 */
export const horizonPutSchema = z.object({
  horizon: z.union([z.literal(1), z.literal(2)], {
    errorMap: () => ({ message: "El horizonte debe ser 1 o 2 años" }),
  }),
});
export type HorizonPutBody = z.infer<typeof horizonPutSchema>;

/**
 * Cuerpo de las dos operaciones de cierre (FR-2002, FR-2005). SOLO `baseRevision`.
 *
 * `.strict()` es la decisión, no un adorno: el cliente NO propone qué mes cerrar. Si el cuerpo
 * pudiera llevar un `period`, el servidor tendría que validarlo y un cierre fuera de orden sería
 * al menos EXPRESABLE. Mandando solo la revisión, el mes cerrable es una función del estado del
 * servidor y la petición ilegal no se puede ni escribir (TC-CDM-022f).
 */
export const closurePostSchema = z.object({
  baseRevision: z.number().int().gte(0),
}).strict();
export type ClosurePostBody = z.infer<typeof closurePostSchema>;

// ── Feature ciclos (FR-2401, FR-2408, NFR-2408) ─────────────────────────────────────────────────
/** Fecha civil «YYYY-MM-DD». La existencia del día (30-feb) la comprueba el dominio (`isIsoDate`). */
const ISO_DATE = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Fecha inválida: se espera YYYY-MM-DD");
/**
 * El objetivo de un cambio de periodo. `anchorDay` es un ENTERO 1..31 — un decimal, una cadena o
 * un nulo son `invalid_payload` antes de tocar la base (lección de BG-002).
 *
 * @aitri-trace FR-ID: FR-2401, US-ID: US-2401, AC-ID: AC-2403, TC-ID: TC-CIC-006f, TC-CIC-017f
 */
export const cyclesTargetSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("month") }).strict(),
  z.object({
    mode: z.literal("cycle"),
    anchorDay: z.number().int().min(1).max(31),
    eomPolicy: z.enum(["last_day", "shift"]),
    firstPayDate: ISO_DATE.optional(),
  }).strict(),
]);
export type CyclesTarget = z.infer<typeof cyclesTargetSchema>;
export const cyclesPreviewSchema = z.object({ target: cyclesTargetSchema }).strict();
export type CyclesPreviewBody = z.infer<typeof cyclesPreviewSchema>;
export const cyclesPutSchema = z.object({
  baseRevision: z.number().int().gte(0),
  target: cyclesTargetSchema,
}).strict();
export type CyclesPutBody = z.infer<typeof cyclesPutSchema>;
