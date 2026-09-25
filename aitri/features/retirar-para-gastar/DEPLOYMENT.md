# Deployment — Feature: retirar-para-gastar

Esta feature **no cambia el modelo de despliegue** ni la base de datos: el mismo contenedor Next.js
standalone + Postgres de la raíz, en Ultron detrás de Tailscale. Ver el `DEPLOYMENT.md`, el `Dockerfile` y el
`docker-compose.yml` **de la raíz del proyecto**.

## Qué cambia en el despliegue

**Nada de infraestructura y SIN migraciones.** No hay columnas, tablas, rutas, servicios ni variables de
entorno nuevas; `drizzle/` no recibe ficheros.

Lo único que cambia es una REGLA del dominio: el techo de reservas del plano Ejecutado se consume con lo
reservado NETO del mes (aportes − retiros) en vez de con los aportes brutos (FR-2801). El navegador y el
servidor la aplican desde la misma función (`chainCheck`), así que cambian a la vez con la imagen.

- **Orden: indiferente.** La imagen nueva y la anterior leen y escriben exactamente las mismas columnas.
- **Sin respaldo obligatorio por esta feature.** El respaldo antes de desplegar sigue siendo buena práctica,
  pero aquí no hay migración que lo haga imprescindible.

## Efecto visible al desplegar

Las marcas de error de mes no se guardan: se calculan al cargar. Por eso, en la primera carga con la imagen
nueva, los meses que hoy estén marcados **solo** porque se sacó de un bolsillo para cubrir un gasto pierden
la marca, sin que el usuario haga nada (FR-2806). Es el efecto buscado. Un mes realmente pasado de su margen
sigue marcado.

También cambian, por la misma razón, el «Máx.» del registro y de la celda de bolsillo en los meses con
retiros, y la nota «De los X reservados este mes, Y salieron del saldo de <mes>» (FR-2805).

## Pasos

```bash
docker compose up -d --build
```

Y, como en cada despliegue, la verificación posterior de la raíz:

```bash
scripts/verificar-prod.sh
```

No hay migraciones que contar: el número de migraciones aplicadas no cambia con esta feature.

## Health check

Sin cambios: `GET /health` responde **200** sin autenticación y `GET /api/v1/ledger` sin sesión responde
**401**. El gate `smoke` los verifica en cada verify.

## Rollback

**Volver la imagen anterior es suficiente y no pierde ningún dato.** Lo único que revierte es la regla: el
techo vuelve a contar los aportes en bruto y reaparecen las marcas de los meses donde se sacó para cubrir un
gasto (BL-037, BL-038). Los datos escritos con la imagen nueva siguen siendo válidos para la anterior: son
las mismas celdas y los mismos movimientos. Una reserva que la regla nueva aceptó y la vieja no habría
aceptado queda guardada y, con la imagen anterior, se vería como un mes marcado, no como un error de carga.

```bash
docker tag t-ledger:<tag-anterior> t-ledger:latest
docker compose up -d
```
