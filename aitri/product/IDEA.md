# Project Idea — Ledger

> App web de finanzas personales: registrar movimientos y planear/analizar **presupuesto vs.
> ejecutado**. Proyecto de portafolio con un stack moderno y decisiones técnicas justificadas.
>
> **Naturaleza de este documento (acordado con el usuario 2026-06-25):** los archivos en
> `idea_context/` (Functional Spec, version-1-roadmap, parte2-notas, First_idea, HTML + mockups)
> son una **mezcla de ideas de distintas sesiones, NO decisiones cerradas**. Todo aquí es
> insumo a **validar y refinar en Discovery**. El HTML "offline" + los mockups son la **base
> demo / concepto visual** del MVP — todavía no es un MVP construido.
>
> Encuadre confirmado: **Version 1 es DESKTOP-primario** (HOME = la grilla de presupuesto),
> **optimizado para mobile** (vista reducida), **visión completa implementable por fases**, con
> **backend real** (Postgres + Auth) construido desde cero en este proyecto.

---

## Problem

Llevar las finanzas personales contra un presupuesto es tedioso con las herramientas actuales:
capturar un movimiento toma demasiados pasos, y ver el plan contra lo realmente gastado mes a mes
(con categorías propias) suele requerir hojas de cálculo frágiles o apps demasiado complejas.
Ledger busca dos caras del mismo producto: **capturar un movimiento en segundos** (mobile) y
**planear/analizar presupuesto vs. ejecutado a lo largo del año** (desktop). Secundariamente, es
una pieza de portafolio que demuestra un stack moderno y UX cuidada con decisiones justificadas.

## Target Users

Una o varias personas que gestionan sus finanzas personales. Cada usuario usa **desktop** como
herramienta de planeación y análisis (grilla anual de presupuesto, gestión de categorías, dashboard)
y **mobile** como herramienta de captura sobre la marcha. No necesita contabilidad formal.
En V1 el flujo es de un usuario con su propia cuenta (auth) y su propio **libro (ledger)**, pero la
arquitectura debe dejar **andamiaje para multiusuario a futuro**: cada usuario con su sesión y su
libro por separado, **o** varios colaborando sobre un mismo libro.

## Current Pain / Baseline

[ASSUMPTION] Hoy se registra en notas del teléfono u hojas de cálculo, o no se registra. El
registro manual es tedioso y se abandona; cruzar presupuesto contra gasto real por categoría/mes
es manual y propenso a error. No hay métrica establecida. Objetivos a validar en discovery:
capturar un movimiento típico en ~10 s / 3 toques, y ver presupuesto vs. ejecutado del mes/año sin
trabajo manual.

## Business Rules

> Todas las reglas siguientes son **propuestas derivadas del prototipo/spec, a validar en
> Discovery** (ver Decisiones Abiertas D-1…D-8 en `Ledger - Functional Spec.md` §7 y el nudo de
> transferencias/saldo rodante en `parte2-presupuesto-notas-rescatadas.md`).

The system must registrar un movimiento con: monto, tipo, categoría (o subcategoría) y mes/período.
The system must soportar tres tipos fijos de movimiento — Gasto, Ingreso, Transferencia — cada uno con su signo (−/+/neutral) y color propio (D-1 propuesta: tipos fijos).
The system must permitir al usuario gestionar (CRUD) una jerarquía de categorías de 3 niveles bajo cada tipo: Grupo → Categoría → Subcategoría, donde Categoría puede ser hoja o contener Subcategorías.
The system must agregar montos de abajo hacia arriba (roll-up): Subcategoría → Categoría → Grupo → Tipo; los niveles superiores no almacenan número propio, lo derivan de sus hojas.
The system must mantener, por cada hoja y cada mes, dos números: Presupuestado (plan, manual) y Ejecutado (real, suma de movimientos; posible override manual a confirmar — D-3).
The system must permitir editar Presupuestado/Ejecutado únicamente en las hojas; los nodos padre (Categoría con hijos, Grupo, Tipo) son de solo lectura y solo reflejan el roll-up de sus hojas. (La distribución proporcional al editar un padre — D-4 — queda DESCARTADA.)
The system must preservar el historial al eliminar una categoría con movimientos, pidiendo reasignarlos a otra categoría del mismo tipo (incluye nodo "Sin asignar"); guardrail al borrar grupos no vacíos (D-2 a validar).
The system must presentar en DESKTOP (HOME) una grilla de presupuesto con la jerarquía sticky a la izquierda, columnas de mes × subcolumnas (Presupuestado/Ejecutado), scroll horizontal y edición inline.
The system must soportar múltiples años en la grilla (no infinito): todos los años pasados ya cargados + un año futuro, recorribles con scroll horizontal; con un toggle/filtro para ver solo el año actual; por defecto la app abre posicionada en el mes actual.
The system must permitir reordenar (drag-to-reorder) la estructura de la jerarquía (grupos/categorías/subcategorías) — en alcance; puede diferirse a una fase posterior (D-7).
The system must ofrecer en desktop un panel lateral "Nuevo movimiento" para captura (el Ejecutado se alimenta de los movimientos).
The system must presentar una franja de indicadores de resumen (mínimo: Presupuesto total, Ejecutado + % usado, Disponible/restante con alerta en negativo) regida por un filtro Mes/Año que afecta solo a las cards, no a la grilla.
The system must ofrecer un Dashboard con 7 indicadores mínimos: Ingresos, Gastos, Balance neto, Tasa de ahorro, Adherencia de gasto, Top categorías de gasto, Lista sobre-presupuesto.
The system must ofrecer en MOBILE una vista reducida del presupuesto (mes en curso + selector de mes) y la captura como pantalla primaria, con navegación inferior.
The system must persistir todos los datos en un backend real con autenticación (un usuario accede solo a sus datos).
The system must ofrecer modo oscuro (dark mode) y usar emojis (íconos funcionales vía Lucide).
The system must operar con una sola moneda (COP) en V1.

## Success Criteria

Given la grilla de presupuesto en desktop (HOME), when el usuario abre la app, then ve la jerarquía de categorías a la izquierda y 12 meses con Presupuestado/Ejecutado, con scroll horizontal y columna de categoría fija.
Given una hoja (sub)categoría, when el usuario edita su Presupuestado/Ejecutado de un mes, then el valor se guarda y todos los ancestros (categoría/grupo/tipo) se recalculan por roll-up.
Given el panel "Nuevo movimiento" (desktop) o la pantalla de captura (mobile), when el usuario guarda un movimiento, then se suma al Ejecutado de la hoja destino para ese mes y aparece en recientes.
Given una categoría con movimientos, when el usuario intenta eliminarla, then el sistema exige reasignar sus movimientos antes de completar el borrado (sin perder historial).
Given el filtro Mes/Año, when el usuario lo cambia, then las cards de resumen se actualizan pero la grilla sigue mostrando los meses del rango.
Given la grilla multi-año, when el usuario abre la app, then queda posicionada en el mes actual y puede hacer scroll horizontal a años pasados (cargados) y un año futuro; un toggle permite acotar la vista solo al año actual.
Given el Dashboard, when el usuario lo abre para un período, then ve los 7 indicadores mínimos calculados desde los mismos datos de presupuesto/movimientos.
Given un usuario sin sesión, when intenta acceder, then debe autenticarse y solo ve sus propios datos.
Given mobile, when el usuario abre la app, then ve la versión reducida (mes en curso + selector) y la captura como pantalla primaria.

## Hard Constraints

- **Stack obligatorio:** Next.js 15 (App Router, SSR), Tailwind CSS v4, shadcn/ui, Lucide (íconos), Recharts (gráficos del dashboard). Ver `idea_context/stack-ledger.md`.
- **Backend real desde cero en este proyecto:** PostgreSQL + autenticación (Auth.js u opción equivalente — a decidir en Arquitectura). NO existe código ni backend previo en esta carpeta (las referencias del roadmap a `src/` y a un backend "5/5" son de un proyecto anterior y NO aplican aquí).
- **Hosting inicial (no el único):** Ultron (Raspberry Pi 5, 8GB RAM), Next.js en Docker con Nginx como reverse proxy. Es el punto de partida; el despliegue debe poder **moverse a cualquier host web** después (portabilidad). Vercel como fallback de acceso público. (Detalle en Arquitectura.)
- **Andamiaje multiusuario:** aunque V1 opere para un usuario, el modelo de datos y la auth deben dejar lista la evolución a multiusuario — libros (ledgers) separados por usuario y/o colaboración de varios usuarios sobre un mismo libro.
- **Preparado para APIs / integraciones:** dejar la arquitectura lista para exponer/consumir APIs que permitan integrar otras soluciones (p. ej. fuentes externas de registro de movimientos) a futuro.
- **Moneda única** (COP) en V1.
- **README enfocado en producto:** puede ser técnico, pero centrado en el producto (qué es, qué resuelve, cómo usarlo). Audiencia mixta: desarrolladores y también product owners / stakeholders.

## Out of Scope

- Distribución proporcional al editar un nodo padre (D-4) — **descartada**: los padres son solo roll-up de sus hojas.
- Multi-moneda / conversión de divisas.
- Multi-año **infinito** (V1: años pasados cargados + un año futuro, no ilimitado).
- Export de datos.
- Indicadores más allá del set mínimo del dashboard.
- Sincronización/conexión con bancos.
- Integraciones vía API en funcionamiento (V1 solo deja el **andamiaje** arquitectónico, no integraciones activas).
- Colaboración multiusuario en funcionamiento (V1 solo deja el **andamiaje**; el flujo activo es de un usuario).

## Tech Stack

Next.js 15 (App Router, SSR) · Tailwind CSS v4 · shadcn/ui · Lucide · Recharts ·
PostgreSQL + Auth.js (backend real). Despliegue: Docker + Nginx en Pi 5 (Vercel fallback).
Detalle por fases en `idea_context/stack-ledger.md`. Decisión final de DB/auth/despliegue en Arquitectura.

## Assets

Material de referencia en `aitri/product/idea_context/` (todo a validar en Discovery — son ideas, no decisiones):

- `Ledger - Functional Spec.md` — spec funcional: conceptos, reglas de negocio propuestas, decisiones abiertas D-1…D-8, desarrollo por fases.
- `version-1-roadmap.md` — reencuadre desktop-primario (2026-06-24): partición por features F1 (jerarquía) · F2 (grilla presupuesto = núcleo/home) · F3 (mobile reducido) · F4 (dashboard). ⚠️ asume código/backend de un proyecto previo que NO existe aquí.
- `parte2-presupuesto-notas-rescatadas.md` — notas de dominio: roll-ups, el nudo de **transferencias** (cuentas / doble disponible: total vs. caja) y el **saldo rodante mes a mes**. Insumo clave para discovery de F2.
- `First_idea.md` — idea seminal (mobile-first, localStorage) — superada por el reencuadre desktop + backend, conservada como contexto histórico.
- `stack-ledger.md` — stack tecnológico por fases y hosting.
- `Ledger (offline).html` — prototipo/demo offline (localStorage). Base demo / **referencia visual** del concepto desktop.
- `mockup-budget-desktop-gastos.png`, `mockup-budget-desktop-gastos-2.png`, `mockup-budget-desktop-transferencias.png`, `mockup-dashboard.png` — referencia visual del objetivo.
