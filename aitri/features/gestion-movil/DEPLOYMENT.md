# Deployment — Feature: gestion-movil

Esta feature **no cambia el modelo de despliegue** ni la base de datos. Se despliega en el mismo contenedor
Next.js standalone + Postgres de la raíz, en Ultron detrás de Tailscale. Ver el `DEPLOYMENT.md`, el `Dockerfile` y
el `docker-compose.yml` **de la raíz del proyecto**.

## Qué cambia en el despliegue

**Nada de infraestructura.** Sin migraciones SQL, sin conversión de datos, sin rutas, servicios ni variables de
entorno nuevas. `drizzle/` no recibe ficheros. Es solo código de cliente para el teléfono, más un módulo de lectura
en el dominio.

No hace falta respaldo por esta feature. El respaldo habitual previo a cualquier despliegue sigue siendo buena
práctica, y aquí con más motivo: desde el teléfono ya se puede borrar una categoría vacía y cerrar un mes.

## Efecto visible al desplegar

- **En el teléfono (≤760 px):** en «Presupuesto», junto al título, aparecen «Organizar» y «Cierre».
  - «Organizar» muestra el árbol de categorías sin cifras; cada elemento abre su pantalla con Renombrar, Cambiar
    ícono, Añadir dentro, Mover a… y Borrar. Un borrado bloqueado dice por qué.
  - «Cierre» permite cerrar el mes cerrable y reabrir el último cerrado, cada uno con confirmación.
  - El aviso de un mes cerrado ya no manda al computador: lleva a «Cierre de mes».
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

Abrir la app en el teléfono, pasar a «Presupuesto» y tocar «Organizar»: se ve el árbol de categorías. Tocar una
categoría y «Mover a…»: se listan los destinos, con el lugar actual marcado «Aquí está». Volver y tocar «Cierre»:
el bloque nombra el mes que se puede cerrar. No hace falta cerrar ni mover nada para comprobarlo.

## Rollback

Volver a la imagen anterior (`git checkout <sha anterior>` + `docker compose up -d --build`). No hay datos que
revertir: la feature escribe la estructura y el cierre con las mismas acciones y el mismo formato que escritorio,
así que la versión anterior lee el mismo libro. Lo que se haya creado, movido, borrado o cerrado desde el teléfono
antes del rollback se queda como está y se sigue gestionando desde escritorio.

## Salud

Sin cambios: el healthcheck del contenedor, `GET /health` de la raíz y `scripts/verificar-prod.sh`, que confirma
que la app carga el ledger real tras el despliegue.
