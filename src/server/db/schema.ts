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
  boolean,
  check,
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
});

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
    month: text("month").notNull(), // 'ene'..'dic' (CHECK en migración)
    kind: text("kind").notNull(), // 'budget' | 'actual' (CHECK en migración)
    amount: bigint("amount", { mode: "number" }).notNull(), // >= 0 (CHECK en migración)
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.nodeId, t.month, t.kind] }),
    check("amount_cell_month_ck", sql`${t.month} in ('ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic')`),
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
    amount: bigint("amount", { mode: "number" }).notNull(), // >= 1 (CHECK en migración)
    month: text("month").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    date: text("date"),
    note: text("note"),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.id] }),
    index("movement_owner_created_idx").on(t.ownerId, t.createdAt),
    check("movement_type_ck", sql`${t.type} in ('expense','income','transfer')`),
    check("movement_month_ck", sql`${t.month} in ('ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic')`),
    check("movement_amount_ck", sql`${t.amount} >= 1`),
  ]
);
