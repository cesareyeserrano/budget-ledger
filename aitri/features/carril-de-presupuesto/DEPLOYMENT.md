# Deployment — Feature: carril-de-presupuesto

Esta feature **no cambia el modelo de despliegue** ni la base de datos: el mismo contenedor Next.js
standalone + Postgres de la raíz, en Ultron detrás de Tailscale. Ver el `DEPLOYMENT.md`, el `Dockerfile` y el
`docker-compose.yml` **de la raíz del proyecto**.

## Qué cambia en el despliegue

**Nada de infraestructura y SIN migraciones.** No hay columnas, tablas, rutas, servicios ni variables de
entorno nuevas; `drizzle/` no recibe ficheros.

Cambian dos REGLAS de cálculo, que navegador y servidor aplican desde las mismas funciones
(`computeBalanceSeries`, `techoScanRaw` y `chainCheck`), así que cambian a la vez con la imagen:

1. Cada mes, la columna Presupuestado abre con el cierre **presupuestado** del mes anterior, no con el cierre
   real (FR-2901). Los dos planos arrancan del mismo saldo inicial (FR-2902).
2. Las reglas de reservas bloquean en Presupuestado igual que en Ejecutado (FR-2904, FR-2906): no se puede
   planear guardar más de lo que el plan deja disponible.

- **Orden: indiferente.** La imagen nueva y la anterior leen y escriben exactamente las mismas columnas.
- **Sin respaldo obligatorio por esta feature.** El respaldo antes de desplegar sigue siendo buena práctica,
  pero aquí no hay migración que lo haga imprescindible.

## Efecto visible al desplegar

Las cifras del Balance no se guardan: se calculan al cargar. En la primera carga con la imagen nueva:

- **La columna Pres. del Balance cambia** a partir del segundo mes del rango: cada mes arrastra lo que dejó el
  plan del mes anterior. La columna Ejec. queda idéntica (NFR-2901).
- **Un mes cuyo plan ya reservaba de más aparece con el triángulo** en su encabezado y en la franja del
  Balance, con el texto «Plan: reservas $X por encima del margen del mes». Antes ese mismo plan se marcaba
  con un «!» ámbar en la celda, que desaparece. El plan guardado no se toca: la regla solo impide
  empeorarlo, y bajarlo siempre se acepta.
- El «Máx.» aparece también en el editor de las celdas Pres. de bolsillo.

## Pasos

```bash
docker compose up -d --build
```

Y, como en cada despliegue, la verificación posterior de la raíz:

```bash
scripts/verificar-prod.sh
```

## Rollback

Volver a la imagen anterior (`git checkout <sha anterior>` + `docker compose up -d --build`). Sin pérdida de
datos: nada de lo guardado cambió de forma. Lo que se haya escrito con la imagen nueva son cifras normales de
presupuesto que la imagen anterior lee sin problema.

## Salud

Sin cambios: el healthcheck del contenedor y `GET /health` de la raíz. `scripts/verificar-prod.sh` confirma
que la app carga el ledger real tras el despliegue.
