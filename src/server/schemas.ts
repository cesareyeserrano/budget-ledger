// @aitri-trace FR-ID: FR-507, US-ID: US-507, AC-ID: AC-507c, TC-ID: TC-BE-026f
/**
 * Module: server/schemas
 * Purpose: Esquemas Zod del BORDE de la API (FR-507). Reutilizan las reglas del dominio compartido
 *   (PERIOD_KEY, amountSchema) para que el contrato de datos sea UNO solo cliente/servidor (evita
 *   deriva). Un payload que no valida se rechaza 400/422 ANTES de abrir cualquier transacción.
 * Dependencies: zod, @/domain (PERIOD_KEY, amountSchema)
 */
import { z } from "zod";
import { PERIOD_KEY, NOTE_DAY, amountSchema, cellAmountSchema, MONTO_MAX } from "@/domain";

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

/**
 * Parche de un movimiento (PATCH /api/v1/movements/{id}), feature diario-de-celda (FR-2505).
 *
 * `.strict()` y al menos un campo: un cuerpo vacío no es una edición, y un campo de más es un
 * cliente que cree estar cambiando algo que no existe — mejor un 422 que un silencio.
 *
 * El PERIODO no viaja: lo deriva el servidor de `date` con el calendario del dueño (FR-2405). Si el
 * cliente pudiera mandarlo habría dos fuentes del mismo dato y podrían discrepar.
 *
 * Lo que este esquema NO puede juzgar es la regla del monto según el `kind`: el kind está GUARDADO,
 * no en el cuerpo. Eso lo decide el dominio (`editMovement` → `invalid_amount`) y la ruta lo traduce
 * a 422 `invalid_payload` (TC-DDC-312f) — aquí solo se acota lo que el borde sí conoce.
 */
export const movementPatchSchema = z
  .object({
    amount: z
      .number({ invalid_type_error: "El monto debe ser numérico" })
      .finite("El monto debe ser un número finito")
      .int("El monto debe ser un entero")
      .refine((n) => Math.abs(n) <= MONTO_MAX, `El monto no puede superar ${MONTO_MAX.toLocaleString("es-CO")}`)
      .optional(),
    // La nota se NORMALIZA en el borde, como en el resto de la app: se recorta y una nota vacía es
    // `null`, no `""`. Sin esto, «   » y "" entrarían como notas distintas de «sin nota» y el
    // Detalle pintaría una fila con texto invisible (FR-2505).
    note: z.string().max(280).nullable().optional()
      .transform((n) => (n == null ? n : n.trim() === "" ? null : n.trim())),
    date: z.string().min(1).optional(),
    /** FR-2406: un ingreso fechado en la ventana de pago puede contarse en el ciclo que ABRE. */
    countInOpeningCycle: z.boolean().optional(),
    catId: z.string().min(1).max(64).optional(),
    subId: z.string().min(1).max(64).nullable().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, "Nada que cambiar");
export type MovementPatchInput = z.infer<typeof movementPatchSchema>;

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

/**
 * Un movimiento tal como viaja en el snapshot del PUT.
 *
 * Exportado desde la feature diario-de-celda (NFR-2501): la regla del monto DEPENDE del `kind`, y esa
 * decisión merece prueba propia en vez de ejercitarse solo de rebote a través del estado completo
 * (TC-DDC-310e). Sigue siendo el mismo esquema que usa `ledgerStateSchema` — no una copia.
 */
export const apiMovementSchema = z
  .object({
    id: z.string(),
    ownerId: z.string(),
    type: nodeType,
    catId: z.string(),
    subId: z.string().nullable(),
    target: z.string(),
    // La regla del monto DEPENDE del kind (FR-2504), así que el campo solo exige «entero finito» y
    // el resto lo decide el refinamiento de abajo. Con `amountSchema` (>= 1) aquí, un ajuste
    // negativo legítimo se rechazaba antes de poder juzgarlo.
    amount: z
      .number({ invalid_type_error: "El monto debe ser numérico" })
      .finite("El monto debe ser un número finito")
      .int("El monto debe ser un entero"),
    period: PERIOD_KEY,
    createdAt: z.number(),
    date: z.string().optional(),
    note: z.string().nullable().optional(),
    // FR-1010: sin estos campos el PUT snapshot haría strip silencioso de los extremos De→A.
    from: z.string().optional(),
    to: z.string().optional(),
    // Feature diario-de-celda (FR-2504). Ausente ≡ 'manual': los movimientos previos y los del
    // registro no lo traen, y el borde no debe inventarlo.
    kind: z.literal("adjustment").optional(),
  })
  .superRefine((m, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["amount"] });
    if (Math.abs(m.amount) > MONTO_MAX) return issue(`El monto no puede superar ${MONTO_MAX.toLocaleString("es-CO")}`);
    if (m.kind === undefined) {
      // Movimiento normal: la regla de siempre. Un negativo SIN kind no entra (TC-DDC-073f).
      if (m.amount < 1) issue("El monto debe ser mayor a 0");
      return;
    }
    // Ajuste: nunca cero —«no hacer nada» no se guarda— y solo en gasto o ingreso; los bolsillos
    // tienen su propia regla (NFR-2503), así que un transfer con kind es un payload inválido.
    if (m.amount === 0) issue("Un ajuste no puede ser de 0");
    if (m.type === "transfer") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Un bolsillo no admite ajustes", path: ["kind"] });
    }
  });

/**
 * Observaciones por celda (FR-1012): nodeId → mes → notas manuales (texto ≤280, como `note`).
 * fecha-de-comentario: `date` opcional validado con NOTE_DAY; un día inválido → 422 invalid_payload
 * sin escribir. Declararlo aquí NO es opcional: sin él zod lo descartaría en silencio (NFR-2606).
 *
 * @aitri-trace FR-ID: FR-2601, US-ID: US-2601, AC-ID: AC-2601a, TC-ID: TC-FDC-008f, TC-FDC-111f, TC-FDC-112f
 */
const apiCellNotes = z.record(
  z.string(),
  z.record(PERIOD_KEY, z.array(z.object({
    id: z.string(), createdAt: z.number(), text: z.string().min(1).max(280), date: NOTE_DAY.optional(),
  })))
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
