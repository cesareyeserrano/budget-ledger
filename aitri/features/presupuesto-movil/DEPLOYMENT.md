# Deployment — Feature: presupuesto-movil

Esta feature **no cambia el modelo de despliegue** ni la base de datos. Se despliega en el mismo contenedor
Next.js standalone + Postgres de la raíz, en Ultron detrás de Tailscale. Ver el `DEPLOYMENT.md`, el `Dockerfile` y
el `docker-compose.yml` **de la raíz del proyecto**.

## Qué cambia en el despliegue

**Nada de infraestructura.** Sin migraciones SQL, sin conversión de datos, sin rutas, servicios ni variables de
entorno nuevas. `drizzle/` no recibe ficheros. Es solo código de cliente, más dos refactors que no cambian el
comportamiento de escritorio.

No hace falta respaldo por esta feature. El respaldo habitual previo a cualquier despliegue sigue siendo buena
práctica.

## Efecto visible al desplegar

- **En el teléfono (≤760 px):** arriba aparece «Registrar | Presupuesto». La app sigue abriendo en Registrar.
  «Presupuesto» muestra el mes con sus grupos y categorías, permite cambiar lo planeado, ver, corregir y borrar
  gastos, cambiar lo aportado a una alcancía, corregir retiros y ver el Balance. El resumen de saldos abre
  plegado y oculto; un toque en el ojo muestra los valores 10 segundos.
- **En el computador (>760 px):** nada cambia.

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

Abrir la app en el teléfono, pasar a «Presupuesto» y tocar el ojo del resumen: los saldos se ven 10 segundos y
se ocultan solos; un segundo toque los oculta antes.

## Rollback

Volver a la imagen anterior (`git checkout <sha anterior>` + `docker compose up -d --build`). No hay datos que
revertir: la feature no escribe nada con un formato nuevo, así que la versión anterior lee el mismo libro.

## Salud

Sin cambios: el healthcheck del contenedor, `GET /health` de la raíz y `scripts/verificar-prod.sh`, que confirma
que la app carga el ledger real tras el despliegue.
