# Deployment — Feature: impacto-movil

Esta feature **no cambia el modelo de despliegue** ni la base de datos. Se despliega en el mismo contenedor
Next.js standalone + Postgres de la raíz, en Ultron detrás de Tailscale. Ver el `DEPLOYMENT.md`, el `Dockerfile` y
el `docker-compose.yml` **de la raíz del proyecto**.

## Qué cambia en el despliegue

**Nada de infraestructura.** Sin migraciones SQL, sin conversión de datos, sin rutas, servicios ni variables de
entorno nuevas. Es solo código de cliente para el teléfono: una tarjeta que lee datos ya cargados.

No hace falta respaldo por esta feature. El respaldo habitual previo a cualquier despliegue sigue siendo buena
práctica.

## Efecto visible al desplegar

- **En el teléfono (≤760 px):** mientras haya un mes reabierto y una corrección haya movido algún mes posterior, en
  la lista del mes y en el detalle de una categoría aparece la tarjeta «Al corregir <mes> se movieron N meses».
  Plegada por defecto; al tocarla lista cada mes con su disponible de antes y de después, y marca los que quedaron
  sin cubrir. Sin mes reabierto, el teléfono se ve igual que antes.
- **En el computador (>760 px):** nada cambia; el panel de impacto de siempre.
- Junto con esta entrega va el cambio de texto del aviso de cierre y de reapertura, que ahora nombra el mes
  («Julio 2026 cerrado.»), en teléfono y escritorio.

## Pasos

```bash
# 1. imagen nueva (en Ultron; ver DEPLOYMENT.md de la raíz)
docker compose up -d --build
# 2. verificación posterior de la raíz
scripts/verificar-prod.sh
```

Si `IMAGE` aparece como `sha256:…` en lugar del nombre, la app sigue corriendo la imagen vieja:
`docker compose up -d --force-recreate app`.

## Comprobación tras desplegar

Sin mes reabierto no hay nada que ver, y eso es lo correcto: abrir «Presupuesto» en el teléfono y comprobar que la
lista se ve como antes. La tarjeta solo aparece al corregir un mes reabierto; no hace falta reabrir ninguno para dar
el despliegue por bueno.

## Rollback

Volver a la imagen anterior (`git checkout <sha anterior>` + `docker compose up -d --build`). No hay datos que
revertir: la feature no escribe nada.

## Salud

Sin cambios: el healthcheck del contenedor, `GET /health` de la raíz y `scripts/verificar-prod.sh`.
