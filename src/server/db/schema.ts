// @aitri-trace FR-ID: FR-506, US-ID: US-506, AC-ID: AC-506b, TC-ID: TC-BE-022e
/**
 * Module: server/db/schema
 * Purpose: Esquema PostgreSQL (Drizzle) — fuente de verdad multiusuario. Tablas de auth (Better Auth)
 *   + tablas del ledger, TODAS con owner_id NOT NULL + FK a user (FR-505/FR-506). Los CHECK espejan
 *   los tipos del dominio (src/domain/types.ts); el dominio no se reinterpreta, se persiste.
 * Dependencies: drizzle-orm/pg-core
 *
 * Los nombres de campo (JS keys) de las tablas de auth coinciden con el modelo de Better Auth
 * (camelCase); las columnas físicas van en snake_case.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ── Better Auth: user / session / account / verification ─────────────────────────────

/** user.id ES el ownerId real del producto (reemplaza el "local" fijo del cliente-puro). */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  /** Horizonte de planeación en AÑOS COMPLETOS: 1 o 2 (FR-1904/FR-1907, ADR-06). Vive en la
   *  CUENTA, no en el navegador, así que viaja entre dispositivos; y NO va en el snapshot del
   *  ledger, de modo que cambiarlo no sube `ledger.revision`. */
  horizon: integer("horizon").notNull().default(2),
});

/** Sesiones en BD (ADR-04): logout = DELETE de la fila; expiración por expires_at. */
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/** Vincula email+contraseña (provider 'credential', password=hash argon2id) y Google al MISMO user. */
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Tokens de flujo (state OAuth, verificación de email, etc.). */
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── Ledger (todas con owner_id NOT NULL + FK → user.id) ───────────────────────────────

/**
 * Una fila por usuario: ancla del lock optimista (revision) y del evento SSE.
 * Fila ausente = usuario que nunca persistió → GET 204 → el cliente siembra (FR-513).
 */
export const ledger = pgTable("ledger", {
  ownerId: text("owner_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Feature transferencias (FR-1010): marca de versión de DATOS. 2 = celdas transfer como aportes
  // (formato viejo); 3 = saldos. loadLedger migra lazy y estampa 3 — idempotencia por marca.
  dataVersion: integer("data_version").notNull().default(2),
  // Feature cierre-de-mes (FR-2001/ADR-11). La frontera del cierre es un ESCALAR: todo periodo
  // <= closedThrough esta cerrado. NULL = nada cerrado, que es el estado de todo usuario previo
  // y de todo usuario nuevo. Vive AQUI, junto a `revision`, para heredar gratis el lock optimista
  // — a diferencia de `user.horizon`, que es preferencia de presentacion y NO sube revision.
  closedThrough: text("closed_through"),
  /** El mes actualmente reabierto (= closedThrough + 1 mes) o NULL. Guardia de «uno a la vez». */
  reopenedPeriod: text("reopened_period"),
  // Feature cierre-de-mes (FR-2010/ADR-15). La LINEA DE BASE del impacto: el saldo con el que
  // cerraba el mes reabierto en el instante de reabrirlo. Existe exactamente cuando existe
  // `reopened_period` — el CHECK `ledger_reopen_baseline_ck` (migracion 0005) lo impone, para que
  // «se borra al volver a cerrar» no dependa de que nadie lo olvide. Sin >= 0: un mes puede cerrar
  // en deficit y la linea de base representa el estado real, no el deseable.
  reopenBaseAvailable: bigint("reopen_base_available", { mode: "number" }),
  reopenBaseReserved: bigint("reopen_base_reserved", { mode: "number" }),
  // Feature meses-y-saldo-inicial (FR-2201/FR-2202/ADR-01). La APERTURA declarada del historial:
  // en que mes empieza y con cuanto. Viven AQUI, junto a `revision` y por el mismo motivo que
  // `closed_through`: cambian las CIFRAS, asi que heredan gratis el lock optimista. `user.horizon`
  // no lo hace porque es preferencia de presentacion y no altera ningun numero.
  //
  // NULL en ambas = no declarado = comportamiento previo a la feature, byte a byte. Los CHECK de la
  // migracion 0006 imponen el formato «YYYY-MM», el >= 0 del monto, y que un saldo no pueda existir
  // sin un mes al que aplicarse (lo inverso SI es legal: es «empiezo desde cero»).
  startMonth: text("start_month"),
  openingBalance: bigint("opening_balance", { mode: "number" }),
});

/**
 * El rastro de cierres y reaperturas (FR-2005). Tabla APPEND-ONLY: solo INSERT.
 *
 * Es auditoria, no fuente de verdad operativa (ADR-13): el comportamiento del sistema lo decide
 * `ledger.reopened_period`, no este historial — asi que se puede leer, exportar o purgar sin
 * alterar lo que la app permite hacer.
 */
export const closureEvent = pgTable(
  "closure_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    action: text("action").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("closure_event_owner_at_idx").on(t.ownerId, t.at)]
);

/** Nodo de la jerarquía (Grupo→Categoría→Subcategoría). CHECKs espejan NodeType/NodeLevel. */
export const node = pgTable(
  "node",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    type: text("type").notNull(), // 'expense' | 'income' | 'transfer' (CHECK en migración)
    level: text("level").notNull(), // 'group' | 'category' | 'sub' (CHECK en migración)
    parentId: text("parent_id"),
    name: text("name").notNull(),
    icon: text("icon"),
    system: boolean("system").notNull().default(false),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.id] }),
    check("node_type_ck", sql`${t.type} in ('expense','income','transfer')`),
    check("node_level_ck", sql`${t.level} in ('group','category','sub')`),
  ]
);

/** Espeja AmountMap (budgets y actuals) celda a celda: (owner, nodo, mes, kind) → monto. */
export const amountCell = pgTable(
  "amount_cell",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    period: text("period").notNull(), // 'YYYY-MM' (CHECK en migración, FR-1902)
    kind: text("kind").notNull(), // 'budget' | 'actual' (CHECK en migración)
    amount: bigint("amount", { mode: "number" }).notNull(), // >= 0 (CHECK en migración)
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.nodeId, t.period, t.kind] }),
    check("amount_cell_period_ck", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("amount_cell_kind_ck", sql`${t.kind} in ('budget','actual')`),
    check("amount_cell_amount_ck", sql`${t.amount} >= 0`),
  ]
);

/** Movimientos. amount >= 1 (CHECK). Índice (owner, created_at DESC) para el listado. */
export const movement = pgTable(
  "movement",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    type: text("type").notNull(),
    catId: text("cat_id").notNull(),
    subId: text("sub_id"),
    target: text("target").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(), // manual >= 1; ajuste <> 0 (CHECK en migración 0009)
    period: text("period").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    date: text("date"),
    note: text("note"),
    // Feature transferencias (FR-1004/FR-1010): extremos De→A de una operación de reserva.
    // Sin FK (como target); NULL en movimientos previos y en gastos/ingresos.
    fromId: text("from_id"),
    toId: text("to_id"),
    // Feature diario-de-celda (FR-2504): 'manual' (lo que el usuario registró) o 'adjustment' (lo
    // que nace de teclear un total en la celda). Las filas previas reciben 'manual' por el DEFAULT.
    kind: text("kind").notNull().default("manual"),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.id] }),
    index("movement_owner_created_idx").on(t.ownerId, t.createdAt),
    check("movement_type_ck", sql`${t.type} in ('expense','income','transfer')`),
    check("movement_period_ck", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("movement_kind_ck", sql`${t.kind} in ('manual','adjustment')`),
    // El monto depende del kind: solo un AJUSTE admite negativo, nunca cero, y solo en gasto o
    // ingreso — las reservas tienen su propia regla (NFR-2503). Debe decir lo mismo que la 0009.
    check(
      "movement_amount_ck",
      sql`(${t.kind} = 'manual' AND ${t.amount} >= 1) OR (${t.kind} = 'adjustment' AND ${t.amount} <> 0 AND ${t.type} in ('expense','income'))`
    ),
  ]
);

/**
 * Feature ciclos (FR-2401/FR-2408, ADR-03). Una fila por VERSION de la configuracion de ciclos,
 * append-only: la ultima por `id` es la vigente; sin filas = modo mes. Cambiar es INSERTAR (RF-07/08).
 * `first_pay` es el primer pago bajo la version (RF-09a): NULL en la primera activacion (el calendario
 * cubre todo el historial) y en las filas `month`. `restore_start_month` recuerda el mes de inicio
 * previo a activar, para la vuelta a mes (FR-2410). Los CHECKs viven en la migracion 0007.
 */
export const cycleConfigVersion = pgTable(
  "cycle_config_version",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    anchorDay: integer("anchor_day"),
    eomPolicy: text("eom_policy"),
    effectiveFrom: date("effective_from").notNull(),
    firstPay: date("first_pay"),
    restoreStartMonth: text("restore_start_month"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cycle_cfg_owner_id_idx").on(t.ownerId, t.id)]
);

/**
 * Feature ciclos, re-derivación del 2026-09-10 (ADR-07, migración 0008). La memoria de origen: de qué mes
 * calendario vino cada dato sin día que la activación movió. Sin FK a las filas que recuerda (el snapshot
 * las reinserta en cada guardado); solo el endpoint de ciclos la escribe y la consume. `amount` con signo
 * solo en 'actual' (residuo, ADR-06).
 */
export const relocationOrigin = pgTable(
  "relocation_origin",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(), // 'budget' | 'actual' | 'movement' | 'note' (CHECK en migración)
    ref: text("ref").notNull(), // id de hoja, de movimiento o de nota
    period: text("period").notNull(), // clave donde vive hoy
    originPeriod: text("origin_period").notNull(), // mes calendario del que vino
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "relocation_origin_pk", columns: [t.ownerId, t.subject, t.ref, t.period, t.originPeriod] }),
    check("relocation_origin_subject_ck", sql`${t.subject} in ('budget','actual','movement','note')`),
    check("relocation_origin_amount_ck", sql`${t.subject} = 'actual' or ${t.amount} >= 0`),
  ]
);

/** Observaciones manuales por celda (FR-1012). Texto ≤ 280 (CHECK); CASCADE por owner. */
export const cellNote = pgTable(
  "cell_note",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    period: text("period").notNull(),
    id: text("id").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.nodeId, t.period, t.id] }),
    check("cell_note_period_ck", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("cell_note_text_ck", sql`char_length(${t.text}) <= 280`),
  ]
);
