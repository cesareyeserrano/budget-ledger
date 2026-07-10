# DEPLOYMENT — budget-state-color

**Modelo de despliegue:** web estática Next.js (`next build` + `next start`), idéntico al de las
features previas. **Sin backend, sin contenedor, sin serverless.** La persistencia vive en
`localStorage` del navegador.

Esta feature **no cambia el artefacto de despliegue**: no agrega dependencias, no toca
`package.json` ni `package-lock.json`, no introduce migraciones de datos y no abre superficie de red.
Es una función pura de dominio, dos tokens CSS y tres cambios de presentación.

---

## Prerequisites

| Requisito | Versión | Nota |
|---|---|---|
| Node.js | ≥ 20 | Next.js 15.5 |
| npm | ≥ 10 | `package-lock.json` versionado |

Sin base de datos, sin broker, sin servicios externos.

---

## Variables de entorno

**La aplicación no requiere ninguna variable de entorno.** No hay `.env.example` porque no hay nada
que configurar para ejecutarla.

Existen dos variables **opcionales**, ambas con default, y ninguna necesaria en producción:

| Variable | Default | Para qué |
|---|---|---|
| `NEXT_DIST_DIR` | `.next` | Directorio de build. Solo lo usa `smoke.sh` (lo fija en `.next-smoke`) para no competir por `.next` con la suite e2e, que corre en paralelo dentro de `aitri verify-run`. |
| `PORT` | `3210` | Puerto que usa `smoke.sh` para levantar la app y sondearla. |
| `E2E_PORT` | `3220` | Puerto del `webServer` de Playwright. |

> En desarrollo la app corre en **3100**, nunca en 3000.

---

## Dev setup

```bash
npm ci
npm run dev -- -p 3100     # http://localhost:3100
```

---

## Producción

```bash
npm ci
npm run build              # genera .next/
npm run start -- -p <port> # sirve el build
```

El resultado es un servidor Next.js estándar. Se puede poner detrás de Nginx; los headers de
seguridad (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) los emite la propia app
desde `next.config.mjs`.

> **No ejecutes `next build` mientras `next dev` está vivo.** Ambos escriben `.next`, y el build
> le arranca el directorio al dev server por debajo (`ENOENT`). Para el dev server primero.

---

## Health check

No hay endpoint `/health`: la app no tiene servicio propio ni proceso long-running que pueda
degradarse independientemente del servidor web. El chequeo de salud es la raíz:

```bash
curl -fsS -o /dev/null -w '%{http_code}' http://localhost:<port>/   # debe dar 200
```

Ese es exactamente el contrato que verifica `./smoke.sh`, declarado como quality gate
`required: true`. Compila si hace falta, arranca la app en su propio `distDir` y falla con exit≠0 si
`/` no responde 200.

```bash
./smoke.sh                 # exit 0 = el producto ensamblado arranca y sirve
```

---

## Rollback

El despliegue es un directorio de build servido por un proceso. El rollback no tiene estado que
deshacer, porque **esta feature no migra datos**:

1. `git revert <sha>` (o `git checkout <sha-anterior>`).
2. `npm ci && npm run build`.
3. Reiniciar el proceso `next start`.
4. Verificar: `./smoke.sh`.

**Datos de usuario:** intactos. La feature deriva el estado de presupuesto de dos números que ya
existían (`budget`, `actual`); no escribe nada nuevo en `localStorage`, no cambia las claves
(`ledger.nodes.v1`, `ledger.budget.v2`) ni sus esquemas. Un rollback devuelve la app a la semántica
de color anterior sin tocar un solo dato persistido, y un roll-forward la restituye.

**Degradación con gracia.** Si los tokens `--state-warning` / `--state-over` no resolvieran (CSS
truncado, tema roto), la celda hereda el color del padre y el color deja de señalar — pero el glifo
(`›` / `››`) sigue presente. El canal redundante de WCAG 1.4.1 mantiene el estado legible. No hay
fallo silencioso total.

---

## CI

`.github/workflows/ci.yml` (preexistente) corre en push y pull_request a `main`: instala
dependencias, y ejecuta `typecheck`, `lint`, `test:run`, `build` y `e2e`.

Esta feature **no declara ninguna NFR de CI/CD**, así que no se modifica el workflow.

---

## Quality gates de la feature

| Gate | Comando | Required | Resultado |
|---|---|---|---|
| typecheck | `npm run typecheck` | sí | pass (exit 0) |
| lint | `npm run lint` | sí | pass (exit 0) |
| coverage | umbral 80 % | sí | pass — 93.25 % medido |
| smoke | `../../../smoke.sh` | sí | pass (exit 0) |

> El gate `e2e` fue **retirado** del manifiesto: Aitri auto-detecta el runner de Playwright y ya lo
> ejecuta dentro de `verify-run` (es de ahí que se acreditan los 20 TCs e2e). Declararlo además como
> gate hacía correr la suite completa dos veces en paralelo, compitiendo por `.next` y por el puerto
> 3220, hasta que el timeout mataba una de las dos corridas.
