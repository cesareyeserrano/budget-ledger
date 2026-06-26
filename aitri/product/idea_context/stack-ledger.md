# Ledger App
**Stack tecnológico · Portafolio**

---

## Fase 1 — Local (sin backend)

El punto de partida. La app corre completamente en el browser, sin cuentas ni base de datos en la nube.

| Herramienta | Para qué sirve |
|-------------|----------------|
| Next.js 15 | Framework React con SSR, routing y estructura lista para producción |
| Tailwind CSS v4 | Utilidades CSS. El estándar actual |
| shadcn/ui | Componentes listos que se copian al proyecto |
| Recharts | Gráficos SVG para resúmenes de gastos e ingresos |
| Lucide | Íconos. Ya viene incluido con shadcn/ui |
| localStorage | Persistencia temporal en el browser. Sin cuenta, sin servidor |

---

## Fase 2 — Con backend

Cuando ya le tengas feeling al stack.

| Herramienta | Para qué sirve |
|-------------|----------------|
| Supabase | Base de datos PostgreSQL + auth. Gratis hasta escala razonable |
| Clerk | Alternativa de auth más fácil de configurar. Login con Google, etc. |
| PlanetScale | Opción de DB si se prefiere MySQL sobre PostgreSQL |

---

## Features del portafolio

**Mínimo indispensable**

- Autenticación básica
- Mobile-first

- Dark mode


- Que se vea bien en mobile
- Que los datos sean coherentes y el flujo tenga sentido
- Que el README explique decisiones técnicas, no solo cómo correrlo

---

## Hosting

Next.js en Docker en Ultron (Pi 5 · 8GB RAM). Nginx como reverse proxy.
Alternativa: Vercel si se quiere acceso público sin Tailscale.

---


