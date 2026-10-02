/**
 * BL-072 — `schema.ts` describe la base que construyen las migraciones.
 *
 * Módulo:       tests/integration/backend/bl-072-esquema-al-dia.test.ts
 * Propósito:    Las migraciones 0002 en adelante están escritas a mano y `schema.ts` se quedó atrás:
 *               le faltaban los CHECK que añadieron y conservaba el patrón de periodo sin la `t` de
 *               los ciclos. Nada lo notaba, porque las pruebas construyen la base con las
 *               migraciones. El riesgo era el contrario: un `drizzle-kit generate` o `push` habría
 *               producido una migración que QUITA restricciones para igualar la base al esquema.
 *
 *               Aquí se levantan DOS bases en el mismo servidor —una con las migraciones, otra con el
 *               SQL que drizzle-kit genera desde `schema.ts`— y se comparan sus catálogos. No se
 *               compara texto: se le pregunta a Postgres qué construyó en cada una, así que dos
 *               formas de escribir la misma restricción cuentan como iguales.
 * Dependencias: drizzle-kit/api, el Postgres efímero del globalSetup, drizzle/*.sql.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "@/server/db/schema";
import { MIGRACIONES, baseNueva, catalogo, sqlDe, tagsDelJournal, type Catalogo } from "./helpers/catalogo";

describe("BL-072 · schema.ts y las migraciones construyen la misma base", () => {
  let deMigraciones: Catalogo;
  let deEsquema: Catalogo;

  async function construida(prefijo: string, sentencias: string[]): Promise<Catalogo> {
    const base = await baseNueva(prefijo);
    try {
      for (const s of sentencias) await base.db.unsafe(s);
      return await catalogo(base.db);
    } finally {
      await base.cerrar();
    }
  }

  beforeAll(async () => {
    deMigraciones = await construida("bl072_mig", tagsDelJournal().map(sqlDe));
    // De una base vacía al esquema entero: lo que `drizzle-kit generate` escribiría en un repo nuevo.
    deEsquema = await construida("bl072_ts", await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema)));
  });

  it("BL-072: las dos bases tienen tablas (si alguna saliera vacía, lo de abajo pasaría en falso)", () => {
    expect(deMigraciones.columnas.length).toBeGreaterThan(60);
    expect(deMigraciones.restricciones.length).toBeGreaterThan(40);
    expect(deEsquema.columnas.length).toBeGreaterThan(60);
  });

  it("BL-072: las mismas columnas, con su tipo, su nulabilidad y su valor por defecto", () => {
    expect(deEsquema.columnas).toEqual(deMigraciones.columnas);
  });

  it("BL-072: las mismas restricciones — claves, foráneas y cada CHECK con su nombre", () => {
    expect(deEsquema.restricciones).toEqual(deMigraciones.restricciones);
  });

  it("BL-072: los mismos índices", () => {
    expect(deEsquema.indices).toEqual(deMigraciones.indices);
  });

  // La otra mitad: drizzle-kit no compara contra la base sino contra su último snapshot. Los
  // snapshots se habían quedado en la 0001, así que `generate` habría escrito una migración con todo
  // lo que las once siguientes ya hicieron a mano. Con el snapshot al día responde «nothing to
  // migrate». Quien cambie schema.ts regenera el snapshot con el número de su migración.
  it("BL-072: el último snapshot de drizzle/meta es el de schema.ts — `drizzle-kit generate` no propone nada", () => {
    const meta = path.join(MIGRACIONES, "meta");
    const ultimo = readdirSync(meta).filter((f) => f.endsWith("_snapshot.json")).sort().at(-1)!;
    const { id: _id, prevId: _prev, ...guardado } = JSON.parse(readFileSync(path.join(meta, ultimo), "utf8"));
    const { id: _id2, prevId: _prev2, ...actual } = JSON.parse(JSON.stringify(generateDrizzleJson(schema)));
    expect(guardado, `${ultimo} no describe schema.ts`).toEqual(actual);
  });
});
