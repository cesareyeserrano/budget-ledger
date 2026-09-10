/**
 * Module: tests/fixtures/ciclos-usuario
 * Purpose: F-USER — réplica ANONIMIZADA del ledger del usuario antes de activar ciclos. Conserva la forma
 *   del respaldo del 2026-09-10 (35 nodos, 19 hojas con celdas, 50 celdas (5 en 0), 27 movimientos del
 *   21-ago al 8-sep, sus fechas, el presupuesto espejo del ejecutado y cada Ejecutado igual a la suma de
 *   sus movimientos), pero los MONTOS son inventados: no son los del usuario. SIN notas de celda y SIN
 *   el texto de las notas de movimientos. El dueño es el sintético de F-SYN.
 * Dependencies: @/domain/types, ./ciclos
 */
import type { LedgerNode, LedgerState, Movement, NodeLevel, NodeType } from "@/domain/types";
import { OWNER } from "./ciclos";

/** [id, tipo, nivel, padre, nombre, ícono, orden] */
const NODOS: ReadonlyArray<readonly [string, NodeType, NodeLevel, string | null, string, string | null, number]> = [
  ["63d9ac8d-11d8-44ad-aa2c-e547b7c593c1", "expense", "group", null, "Vivienda", "home", 5],
  ["0cc96c6d-9158-4fd6-8b45-8ccaec693ca1", "expense", "category", "63d9ac8d-11d8-44ad-aa2c-e547b7c593c1", "Servicios", "power", 6],
  ["g-trabajo", "income", "group", null, "Trabajo", "folder", 7],
  ["139c82ba-a76a-4922-9013-db67210bf7d1", "expense", "sub", "0cc96c6d-9158-4fd6-8b45-8ccaec693ca1", "Agua", null, 7],
  ["c-salario", "income", "category", "g-trabajo", "Salario", "banknote", 8],
  ["199d27b3-69d6-44ee-a9fd-8cee74994bcb", "expense", "sub", "0cc96c6d-9158-4fd6-8b45-8ccaec693ca1", "Energía", null, 8],
  ["37f612c9-1508-4c22-94dd-3577eae5dca7", "expense", "sub", "0cc96c6d-9158-4fd6-8b45-8ccaec693ca1", "Gas", null, 9],
  ["g-ahorro", "transfer", "group", null, "Ahorro", "folder", 10],
  ["78f615fd-ef94-4fcb-97cf-893eb10c0e0e", "expense", "category", "63d9ac8d-11d8-44ad-aa2c-e547b7c593c1", "Mercado", "shopping", 10],
  ["c-ahorros", "transfer", "category", "g-ahorro", "Ahorros", "piggy-bank", 11],
  ["af7bb0ca-a5a8-4a42-a91a-46a37663135f", "expense", "group", null, "Transporte", "car", 11],
  ["e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", "expense", "category", "af7bb0ca-a5a8-4a42-a91a-46a37663135f", "Parqueaderos", "car", 12],
  ["cf0254d5-de54-48e4-a14b-d714fc0700ea", "expense", "group", null, "Mantenimientos", "wrench", 13],
  ["34e2e6d4-9b14-4553-8947-9e7a8b106ed3", "expense", "category", "cf0254d5-de54-48e4-a14b-d714fc0700ea", "Vehículo", "car", 14],
  ["322a2af5-12cd-4a7e-9161-dd1c366180e4", "expense", "sub", "34e2e6d4-9b14-4553-8947-9e7a8b106ed3", "Seguros", null, 15],
  ["111a6765-0a32-4e95-8341-520c237491bf", "expense", "sub", "34e2e6d4-9b14-4553-8947-9e7a8b106ed3", "Revisiones", null, 16],
  ["71dee80a-4784-4aad-a402-ed3a589a6a8a", "expense", "category", "cf0254d5-de54-48e4-a14b-d714fc0700ea", "Hogar", "hammer", 17],
  ["833156ce-ba94-40a5-86db-f0bbcb8f3772", "expense", "group", null, "Estilo de vida", "shopping", 18],
  ["711d5f78-0657-4b6c-87f2-311b564f091a", "expense", "category", "833156ce-ba94-40a5-86db-f0bbcb8f3772", "Restaurantes", "utensils", 19],
  ["4115a07a-0ff7-40f0-98be-ee9e4ce52d53", "expense", "category", "833156ce-ba94-40a5-86db-f0bbcb8f3772", "Vestuario", "shirt", 20],
  ["b3fcaadd-2ca0-4180-b31b-dec2b36ab434", "expense", "sub", "4115a07a-0ff7-40f0-98be-ee9e4ce52d53", "Ropa", null, 21],
  ["5c89a236-799d-49b1-9ab2-4c9ecc621a48", "expense", "category", "833156ce-ba94-40a5-86db-f0bbcb8f3772", "Tecnología", "laptop", 22],
  ["eb8b94a2-ef5c-49b0-9619-3f40c61c6bc6", "expense", "sub", "5c89a236-799d-49b1-9ab2-4c9ecc621a48", "Accesorios", null, 23],
  ["c19a69c2-d862-455e-8803-9059e8588b92", "expense", "sub", "5c89a236-799d-49b1-9ab2-4c9ecc621a48", "Software", null, 24],
  ["89dc98d2-9147-46a7-904b-dfcfcce7b9f8", "expense", "category", "833156ce-ba94-40a5-86db-f0bbcb8f3772", "Gym", "gym", 25],
  ["066aff11-4f3d-419a-863d-8d4f1a041c0b", "expense", "category", "833156ce-ba94-40a5-86db-f0bbcb8f3772", "Entretenimiento", "entertainment", 26],
  ["d6de4b3f-72ee-45c4-982a-e36b2c64e485", "expense", "sub", "066aff11-4f3d-419a-863d-8d4f1a041c0b", "Salidas", null, 27],
  ["5e0f3f52-e7ee-4668-bb30-1fb47c99f722", "expense", "category", "833156ce-ba94-40a5-86db-f0bbcb8f3772", "Peluquería", "grooming", 28],
  ["5463814a-7cff-4466-a323-9dd73fb484ce", "expense", "group", null, "Créditos", "bank", 29],
  ["90b50434-dd96-4505-b259-c237b8b31c04", "expense", "category", "5463814a-7cff-4466-a323-9dd73fb484ce", "Hipoteca", "home", 30],
  ["d600e06e-26f3-47f5-aef2-046167b878f2", "expense", "category", "5463814a-7cff-4466-a323-9dd73fb484ce", "Tarjeta de crédito", "card", 31],
  ["4ffa83dd-4c21-494c-836b-4f5b191cd921", "expense", "sub", "0cc96c6d-9158-4fd6-8b45-8ccaec693ca1", "Internet", null, 31],
  ["ef860cfd-41ef-434f-914c-8771c2efb219", "expense", "category", "af7bb0ca-a5a8-4a42-a91a-46a37663135f", "Combustibles", "fuel", 32],
  ["aa7db345-9d35-40cf-a802-330235d81a0a", "expense", "category", "63d9ac8d-11d8-44ad-aa2c-e547b7c593c1", "Administracion", "home", 33],
  ["4a66f347-a502-48bf-b03e-ab51f04f0f08", "expense", "group", null, "Impuestos", "hand-coins", 34],
];
/** [hoja, plano, periodo, monto] */
const CELDAS: ReadonlyArray<readonly [string, "budget" | "actual", string, number]> = [
  ["711d5f78-0657-4b6c-87f2-311b564f091a", "actual", "2026-08", 336700],
  ["89dc98d2-9147-46a7-904b-dfcfcce7b9f8", "actual", "2026-08", 84900],
  ["b3fcaadd-2ca0-4180-b31b-dec2b36ab434", "actual", "2026-08", 268400],
  ["c-salario", "actual", "2026-08", 8450000],
  ["d6de4b3f-72ee-45c4-982a-e36b2c64e485", "actual", "2026-08", 58000],
  ["e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", "actual", "2026-08", 29800],
  ["eb8b94a2-ef5c-49b0-9619-3f40c61c6bc6", "actual", "2026-08", 187500],
  ["711d5f78-0657-4b6c-87f2-311b564f091a", "budget", "2026-08", 336700],
  ["89dc98d2-9147-46a7-904b-dfcfcce7b9f8", "budget", "2026-08", 84900],
  ["b3fcaadd-2ca0-4180-b31b-dec2b36ab434", "budget", "2026-08", 268400],
  ["c-salario", "budget", "2026-08", 8450000],
  ["d6de4b3f-72ee-45c4-982a-e36b2c64e485", "budget", "2026-08", 58000],
  ["e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", "budget", "2026-08", 29800],
  ["eb8b94a2-ef5c-49b0-9619-3f40c61c6bc6", "budget", "2026-08", 187500],
  ["111a6765-0a32-4e95-8341-520c237491bf", "actual", "2026-09", 289300],
  ["139c82ba-a76a-4922-9013-db67210bf7d1", "actual", "2026-09", 226300],
  ["199d27b3-69d6-44ee-a9fd-8cee74994bcb", "actual", "2026-09", 141600],
  ["322a2af5-12cd-4a7e-9161-dd1c366180e4", "actual", "2026-09", 468700],
  ["37f612c9-1508-4c22-94dd-3577eae5dca7", "actual", "2026-09", 41200],
  ["4ffa83dd-4c21-494c-836b-4f5b191cd921", "actual", "2026-09", 96400],
  ["5e0f3f52-e7ee-4668-bb30-1fb47c99f722", "actual", "2026-09", 47000],
  ["711d5f78-0657-4b6c-87f2-311b564f091a", "actual", "2026-09", 512400],
  ["78f615fd-ef94-4fcb-97cf-893eb10c0e0e", "actual", "2026-09", 20900],
  ["90b50434-dd96-4505-b259-c237b8b31c04", "actual", "2026-09", 1318200],
  ["b3fcaadd-2ca0-4180-b31b-dec2b36ab434", "actual", "2026-09", 254800],
  ["c-ahorros", "actual", "2026-09", 35062400],
  ["c-salario", "actual", "2026-09", 0],
  ["c19a69c2-d862-455e-8803-9059e8588b92", "actual", "2026-09", 32900],
  ["d600e06e-26f3-47f5-aef2-046167b878f2", "actual", "2026-09", 850000],
  ["e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", "actual", "2026-09", 34100],
  ["111a6765-0a32-4e95-8341-520c237491bf", "budget", "2026-09", 289300],
  ["139c82ba-a76a-4922-9013-db67210bf7d1", "budget", "2026-09", 226300],
  ["199d27b3-69d6-44ee-a9fd-8cee74994bcb", "budget", "2026-09", 141600],
  ["322a2af5-12cd-4a7e-9161-dd1c366180e4", "budget", "2026-09", 468700],
  ["37f612c9-1508-4c22-94dd-3577eae5dca7", "budget", "2026-09", 41200],
  ["4ffa83dd-4c21-494c-836b-4f5b191cd921", "budget", "2026-09", 96400],
  ["5e0f3f52-e7ee-4668-bb30-1fb47c99f722", "budget", "2026-09", 47000],
  ["711d5f78-0657-4b6c-87f2-311b564f091a", "budget", "2026-09", 512400],
  ["78f615fd-ef94-4fcb-97cf-893eb10c0e0e", "budget", "2026-09", 20900],
  ["90b50434-dd96-4505-b259-c237b8b31c04", "budget", "2026-09", 1318200],
  ["b3fcaadd-2ca0-4180-b31b-dec2b36ab434", "budget", "2026-09", 254800],
  ["c-ahorros", "budget", "2026-09", 35062400],
  ["c-salario", "budget", "2026-09", 8450000],
  ["c19a69c2-d862-455e-8803-9059e8588b92", "budget", "2026-09", 32900],
  ["d600e06e-26f3-47f5-aef2-046167b878f2", "budget", "2026-09", 850000],
  ["e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", "budget", "2026-09", 34100],
  ["c-salario", "actual", "2026-10", 0],
  ["4ffa83dd-4c21-494c-836b-4f5b191cd921", "budget", "2026-10", 0],
  ["78f615fd-ef94-4fcb-97cf-893eb10c0e0e", "budget", "2026-10", 0],
  ["c-salario", "budget", "2026-10", 0],
];
/** [id, tipo, categoría, sub, destino, monto, periodo, creado, fecha] */
const MOVIMIENTOS: ReadonlyArray<readonly [string, NodeType, string, string | null, string, number, string, number, string]> = [
  ["2ad85b3f-2022-4ab3-9940-5b199830ec11", "income", "c-salario", null, "c-salario", 8450000, "2026-08", 1, "2026-08-21T12:00"],
  ["c8a4d814-3641-43e3-9412-c397a8a2ce2f", "expense", "711d5f78-0657-4b6c-87f2-311b564f091a", null, "711d5f78-0657-4b6c-87f2-311b564f091a", 13400, "2026-08", 2, "2026-08-21T12:00"],
  ["8d333fa4-f049-43b3-9906-96cebf217292", "expense", "89dc98d2-9147-46a7-904b-dfcfcce7b9f8", null, "89dc98d2-9147-46a7-904b-dfcfcce7b9f8", 84900, "2026-08", 3, "2026-08-22T12:00"],
  ["36e26ec6-a84b-4a38-baa7-9466f0877891", "expense", "066aff11-4f3d-419a-863d-8d4f1a041c0b", "d6de4b3f-72ee-45c4-982a-e36b2c64e485", "d6de4b3f-72ee-45c4-982a-e36b2c64e485", 58000, "2026-08", 4, "2026-08-25T12:00"],
  ["caff0891-6009-4f32-8097-5c447d2fe27f", "expense", "5c89a236-799d-49b1-9ab2-4c9ecc621a48", "eb8b94a2-ef5c-49b0-9619-3f40c61c6bc6", "eb8b94a2-ef5c-49b0-9619-3f40c61c6bc6", 187500, "2026-08", 5, "2026-08-26T12:00"],
  ["9788a7a8-b5eb-4a6c-bdfd-adf643658cb2", "expense", "711d5f78-0657-4b6c-87f2-311b564f091a", null, "711d5f78-0657-4b6c-87f2-311b564f091a", 171200, "2026-08", 6, "2026-08-28T12:00"],
  ["9cd9d90a-a56a-4b0d-b483-a3e2da238ed3", "expense", "4115a07a-0ff7-40f0-98be-ee9e4ce52d53", "b3fcaadd-2ca0-4180-b31b-dec2b36ab434", "b3fcaadd-2ca0-4180-b31b-dec2b36ab434", 268400, "2026-08", 7, "2026-08-28T12:00"],
  ["d4e5b960-f372-46d4-aa71-f756c05cd041", "expense", "e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", null, "e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", 29800, "2026-08", 8, "2026-08-28T12:00"],
  ["57cb1507-c10b-4700-99af-c29999b34f71", "expense", "711d5f78-0657-4b6c-87f2-311b564f091a", null, "711d5f78-0657-4b6c-87f2-311b564f091a", 132800, "2026-08", 9, "2026-08-29T12:00"],
  ["1bbbb11b-f84e-4658-82e3-fe6aece66349", "expense", "711d5f78-0657-4b6c-87f2-311b564f091a", null, "711d5f78-0657-4b6c-87f2-311b564f091a", 19300, "2026-08", 10, "2026-08-29T12:00"],
  ["acbe4468-46ec-49f9-a0c0-a208a2a40535", "expense", "90b50434-dd96-4505-b259-c237b8b31c04", null, "90b50434-dd96-4505-b259-c237b8b31c04", 1318200, "2026-09", 11, "2026-09-01T12:00"],
  ["a2942f93-fb6c-4a68-bfab-6054d5c9bfdd", "expense", "d600e06e-26f3-47f5-aef2-046167b878f2", null, "d600e06e-26f3-47f5-aef2-046167b878f2", 850000, "2026-09", 12, "2026-09-02T12:00"],
  ["1a664ed5-9dac-4d4d-a82d-688c893feaa1", "expense", "0cc96c6d-9158-4fd6-8b45-8ccaec693ca1", "139c82ba-a76a-4922-9013-db67210bf7d1", "139c82ba-a76a-4922-9013-db67210bf7d1", 226300, "2026-09", 13, "2026-09-02T12:00"],
  ["396219d4-fa4e-4a39-9e72-f98ac5301cc5", "expense", "78f615fd-ef94-4fcb-97cf-893eb10c0e0e", null, "78f615fd-ef94-4fcb-97cf-893eb10c0e0e", 20900, "2026-09", 14, "2026-09-03T12:00"],
  ["63f3bd4f-b554-41ee-b4b1-f975dd1651ac", "expense", "711d5f78-0657-4b6c-87f2-311b564f091a", null, "711d5f78-0657-4b6c-87f2-311b564f091a", 111800, "2026-09", 15, "2026-09-04T12:00"],
  ["2698a550-c2dd-4b41-a01e-1435b1663219", "expense", "5c89a236-799d-49b1-9ab2-4c9ecc621a48", "c19a69c2-d862-455e-8803-9059e8588b92", "c19a69c2-d862-455e-8803-9059e8588b92", 32900, "2026-09", 16, "2026-09-04T12:00"],
  ["8106d63f-8457-4f13-ad22-4e0fd5a5a66d", "expense", "34e2e6d4-9b14-4553-8947-9e7a8b106ed3", "322a2af5-12cd-4a7e-9161-dd1c366180e4", "322a2af5-12cd-4a7e-9161-dd1c366180e4", 468700, "2026-09", 17, "2026-09-05T12:00"],
  ["8fc2a3cd-2fe0-410f-b49b-8b6dc485f6ec", "expense", "5e0f3f52-e7ee-4668-bb30-1fb47c99f722", null, "5e0f3f52-e7ee-4668-bb30-1fb47c99f722", 47000, "2026-09", 18, "2026-09-05T12:00"],
  ["10b82e73-a29d-4566-bc80-0161cd248d08", "expense", "0cc96c6d-9158-4fd6-8b45-8ccaec693ca1", "199d27b3-69d6-44ee-a9fd-8cee74994bcb", "199d27b3-69d6-44ee-a9fd-8cee74994bcb", 141600, "2026-09", 19, "2026-09-05T12:00"],
  ["7509486f-6061-4291-95d7-e7e461d9a7a0", "expense", "0cc96c6d-9158-4fd6-8b45-8ccaec693ca1", "37f612c9-1508-4c22-94dd-3577eae5dca7", "37f612c9-1508-4c22-94dd-3577eae5dca7", 41200, "2026-09", 20, "2026-09-05T12:00"],
  ["f5f8212c-47ed-4173-a752-9b269f941674", "expense", "4115a07a-0ff7-40f0-98be-ee9e4ce52d53", "b3fcaadd-2ca0-4180-b31b-dec2b36ab434", "b3fcaadd-2ca0-4180-b31b-dec2b36ab434", 254800, "2026-09", 21, "2026-09-05T12:00"],
  ["812e21c3-a6b9-40c9-a553-7cfd0d8de42e", "expense", "e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", null, "e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", 19600, "2026-09", 22, "2026-09-05T12:00"],
  ["abc50c77-9d97-4734-babc-f3774179109f", "expense", "34e2e6d4-9b14-4553-8947-9e7a8b106ed3", "111a6765-0a32-4e95-8341-520c237491bf", "111a6765-0a32-4e95-8341-520c237491bf", 289300, "2026-09", 23, "2026-09-05T12:00"],
  ["38461cbd-860a-4e9f-871c-ea10b38a8e05", "expense", "711d5f78-0657-4b6c-87f2-311b564f091a", null, "711d5f78-0657-4b6c-87f2-311b564f091a", 98300, "2026-09", 24, "2026-09-08T12:00"],
  ["5a3db14c-4849-4203-a0be-32c32b3aa785", "expense", "e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", null, "e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", 3800, "2026-09", 25, "2026-09-08T12:00"],
  ["db333c30-ea0f-49a7-82b3-d3f26cbca7ab", "expense", "711d5f78-0657-4b6c-87f2-311b564f091a", null, "711d5f78-0657-4b6c-87f2-311b564f091a", 302300, "2026-09", 26, "2026-09-08T12:00"],
  ["00d5e2e0-3abf-4ae2-8877-a550b27677ca", "expense", "e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", null, "e6fe80c1-ccbf-48ac-b680-6ae8ae06c6ea", 10700, "2026-09", 27, "2026-09-08T12:00"],
];

export const F_USER_INICIO = { startMonth: "2026-08", openingBalance: 32180000 } as const;

/** Un estado F-USER nuevo en cada llamada (las pruebas no comparten objetos). */
export function estadoUsuario(): LedgerState {
  const nodes: LedgerNode[] = NODOS.map(([id, type, level, parentId, name, icon, order]) => ({ id, ownerId: OWNER, type, level, parentId, name, icon, order }));
  const budgets: LedgerState["budgets"] = {};
  const actuals: LedgerState["actuals"] = {};
  for (const [hoja, plano, periodo, monto] of CELDAS) {
    const m = plano === "budget" ? budgets : actuals;
    m[hoja] = { ...(m[hoja] ?? {}), [periodo]: monto };
  }
  const movements: Movement[] = MOVIMIENTOS.map(([id, type, catId, subId, target, amount, period, createdAt, date]) => ({ id, ownerId: OWNER, type, catId, subId, target, amount, period, createdAt, date }));
  return { ownerId: OWNER, nodes, budgets, actuals, movements, cellNotes: {}, startMonth: F_USER_INICIO.startMonth, openingBalance: F_USER_INICIO.openingBalance };
}

/** El id de la hoja de F-USER con ese nombre (los nombres de hoja son únicos en la réplica). */
export function hojaPorNombre(nombre: string): string {
  const conCeldas = new Set(CELDAS.map(([hoja]) => hoja));
  const hits = NODOS.filter(([id, , , , name]) => name === nombre && conCeldas.has(id));
  if (hits.length !== 1) throw new Error(`F-USER: ${hits.length} hojas con el nombre «${nombre}»`);
  return hits[0]![0];
}
