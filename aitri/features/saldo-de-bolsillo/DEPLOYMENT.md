# Deployment — Feature: saldo-de-bolsillo

Esta feature **no cambia el modelo de despliegue** ni el esquema de la base de datos. Se despliega en el mismo
contenedor Next.js standalone + Postgres de la raíz, en Ultron detrás de Tailscale. Ver el `DEPLOYMENT.md`, el
`Dockerfile` y el `docker-compose.yml` **de la raíz del proyecto**.

## Qué cambia en el despliegue

**Sin migraciones SQL ni infraestructura nueva.** No hay columnas, tablas, rutas, servicios ni variables de
entorno nuevas, y `drizzle/` no recibe ficheros.

**Sí hay una conversión de DATOS, una sola vez por ledger** (FR-3006). Al cargar un ledger con
`data_version < 7`, el servidor reparte los retiros planeados sin alcancía (fila global `@retiros` de
`amount_cell`) entre las alcancías, y la alcancía con más plan ese mes va primero. Guarda las filas
`@retiros:<alcancía>` y marca el ledger con `data_version = 7`. El total planeado de cada mes se conserva, así
que el Balance no se mueve (NFR-3001). Todo ocurre en una transacción: si falla, se revierte, queda en el log
(`[ledger] no se pudo repartir…`) y el ledger se sirve sin convertir hasta la siguiente carga.

- **Respaldo OBLIGATORIO antes de desplegar** (`pg_dump` de la base de producción): la conversión reescribe
  filas del plan.
- **Orden:** desplegar la imagen y abrir la app. La primera carga de cada cuenta hace la conversión.

## Efecto visible al desplegar

- La celda Pres. de «Retiros del mes» abre el mismo formulario que la de Ejec.: alcancía, monto con «Máx.»,
  «¿Para qué?» y «Planear», con la lista de los retiros planeados del mes, corregibles.
- Los retiros planeados que ya existían aparecen en esa lista, asignados a su alcancía.
- Las celdas de las alcancías y las filas de grupo y «RESERVAS» siguen mostrando lo aportado ese mes, sin
  cambios frente a la versión anterior.

## Pasos

```bash
# 1. respaldo (ver DEPLOYMENT.md de la raíz para el comando exacto en Ultron)
# 2. imagen nueva
docker compose up -d --build
# 3. verificación posterior de la raíz
scripts/verificar-prod.sh
```

Después, abrir la app con la cuenta de producción y confirmar que «Retiros del mes · Pres.» dice lo mismo que
antes en cada mes.

## Rollback

Volver a la imagen anterior (`git checkout <sha anterior>` + `docker compose up -d --build`). La imagen
anterior solo lee la fila global `@retiros`, así que con los datos ya convertidos **los retiros planeados
dejarían de verse** (el resto del ledger queda intacto). Para volver del todo, restaurar el respaldo previo
al despliegue.

## Salud

Sin cambios: el healthcheck del contenedor, `GET /health` de la raíz y `scripts/verificar-prod.sh`, que
confirma que la app carga el ledger real tras el despliegue.
