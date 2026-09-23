-- BG-043 — reconciliar las celdas cargadas ANTES del Detalle.
--
-- EL PROBLEMA. diario-de-celda (FR-2511) introdujo la regla «una celda = la suma de sus movimientos» y
-- avisa cuando no se cumple. Los datos anteriores nacieron con otra regla: la cifra se tecleaba en la
-- celda y no había diario detrás. Al desplegar, esas celdas quedaron señaladas como descuadradas, y la
-- app le pasaba al usuario el trabajo de arreglar a mano un historial que estaba bien. Una regla nueva
-- se despliega CON la reconciliación de lo que ya existe; si no, es el usuario quien paga la migración.
--
-- QUÉ HACE. Por cada celda de Ejecutado de una hoja de gasto o ingreso cuyo valor no coincide con la
-- suma de sus movimientos, crea UN movimiento de tipo `adjustment` por la DIFERENCIA exacta — el mismo
-- movimiento que la app crea hoy cuando el usuario teclea un total en una celda (FR-2504).
--
-- QUÉ NO HACE, y es la parte que importa:
--   · NO toca ninguna cifra. `amount_cell` no se modifica: la celda sigue valiendo exactamente lo
--     mismo. Solo pasa a tener detrás lo que la explica.
--   · NO toca los comentarios. `cell_note` no se lee ni se escribe aquí.
--   · NO toca la frontera del cierre. Entra también en meses cerrados a propósito: es donde están las
--     celdas viejas, los totales no cambian y reabrir mes a mes para esto sería absurdo.
--
-- LA FECHA. El primer día del mes de la celda. De esa cifra no se sabe el día, así que se usa lo único
-- que el dato garantiza — que cayó en ese periodo. Dejarla sin fecha no era opción: en modo ciclos un
-- movimiento sin fecha se marca como incoherente (`periodMismatches`, ledgerRepo.ts).
--
-- LA CATEGORÍA. Misma codificación que `adjust.ts:149-150`: en una hoja `sub`, la categoría es su
-- padre y la sub es la hoja; en una hoja `category`, la categoría es ella misma y la sub va nula.
--
-- IDEMPOTENTE. El id es determinista y la inserción lleva ON CONFLICT DO NOTHING, así que aplicarla
-- dos veces no duplica nada. El `kind = 'adjustment'` satisface `movement_amount_ck` de la 0009, que
-- es lo que permite el monto negativo cuando la celda vale MENOS que sus movimientos.
INSERT INTO "movement" (
  "owner_id", "id", "type", "cat_id", "sub_id", "target", "amount", "period", "created_at", "date", "note", "kind"
)
SELECT
  d."owner_id",
  'adj-apertura-' || substr(md5(d."owner_id" || ':' || d."node_id" || ':' || d."period"), 1, 16),
  d."type",
  CASE WHEN d."level" = 'sub' THEN d."parent_id" ELSE d."node_id" END,
  CASE WHEN d."level" = 'sub' THEN d."node_id" ELSE NULL END,
  d."node_id",
  d."diferencia",
  d."period",
  b."base" + d."orden",
  substr(d."period", 1, 7) || '-01T12:00',
  'Ajuste de apertura: la celda ya tenía esta cifra antes de que existiera el Detalle.',
  'adjustment'
FROM (
  SELECT
    c."owner_id",
    c."node_id",
    c."period",
    n."type",
    n."level",
    n."parent_id",
    c."amount" - coalesce(s."suma", 0) AS "diferencia",
    row_number() OVER (PARTITION BY c."owner_id" ORDER BY c."period", c."node_id") AS "orden"
  FROM "amount_cell" c
  JOIN "node" n ON n."owner_id" = c."owner_id" AND n."id" = c."node_id"
  LEFT JOIN (
    SELECT "owner_id", "target", "period", sum("amount") AS "suma"
    FROM "movement" WHERE "type" <> 'transfer' GROUP BY 1, 2, 3
  ) s ON s."owner_id" = c."owner_id" AND s."target" = c."node_id" AND s."period" = c."period"
  WHERE c."kind" = 'actual'
    AND n."type" IN ('expense', 'income')
    -- Solo HOJAS: un nodo con hijos es roll-up y no tiene celda propia que cuadrar.
    AND NOT EXISTS (SELECT 1 FROM "node" h WHERE h."owner_id" = n."owner_id" AND h."parent_id" = n."id")
    AND c."amount" <> coalesce(s."suma", 0)
) d
CROSS JOIN LATERAL (
  SELECT coalesce(max(m."created_at"), 0) AS "base" FROM "movement" m WHERE m."owner_id" = d."owner_id"
) b
ON CONFLICT DO NOTHING;
