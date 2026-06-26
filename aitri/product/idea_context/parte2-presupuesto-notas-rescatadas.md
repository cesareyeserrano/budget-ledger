# Parte 2 — Notas de dominio rescatadas (presupuesto + jerarquía de categorías)

> **Origen:** consolidado de las features `budget` y `categories` (ambas 0/5, nunca
> construidas) antes de eliminarlas el 2026-06-24. NO son requisitos aprobados — son
> el insumo de dominio que el usuario desarrolló en sesiones previas, preservado para
> contrastarlo contra el nuevo requerimiento de la Parte 2.
>
> **Recordatorio de contexto raíz (lo que YA existe y se mantiene):**
> - Catálogo de categorías **FIJO** en código: `src/domain/categories.ts`.
> - Presupuesto simple actual: FR-013, pantalla `/presupuestos`, `src/domain/budget.ts`,
>   `src/store/budgetsStore.ts`, `src/components/budgets/BudgetRow.tsx`,
>   `src/app/actions/budgets.ts`. (La feature `budget` planeaba REEMPLAZAR esta pantalla.)
> - Toggles de tipo FIJOS (`TypeToggle`: Gasto/Ingreso/Transferencia) que derivan
>   signo (+/−) y color: `src/domain/sign.ts`, `src/domain/types.ts#MovementType`.
> - Registro de movimientos: `src/store/movementsStore.ts`, `src/app/page.tsx`,
>   `src/components/register/CategoryRow.tsx`.

---

## A) Jerarquía de categorías gestionable (lo que era la feature `categories`)

**Idea:** que el usuario gestione su taxonomía sin tocar código, en 3 niveles:
Tipo/Grupo → Categoría → Subcategoría, con CRUD completo y vista de acordeón expandible,
conectada a la selección de la pantalla de registro.

Comportamientos que el usuario confirmó:
- CRUD de **Categorías** dentro de un Tipo/Grupo.
- CRUD de **Subcategorías** dentro de una Categoría (la subcategoría es **opcional**).
- [CONFIRMADO] CRUD también de los **Tipos/Grupos** padre (nivel superior), no solo hijos.
- Jerarquía mostrada como **acordeones expandibles**: Tipo → Categorías → Subcategorías.
- Las categorías gestionadas **alimentan la selección de la pantalla de registro**,
  filtradas por el toggle de tipo activo.
- [CONFIRMADO] Al eliminar una categoría con movimientos: los movimientos se
  **preservan** y se pide **reasignarlos** a otra categoría (no se pierde historial).

### Decisión central sin resolver — toggles fijos vs dinámicos
Tensión: "los Tipos/Grupos padre son editables" **vs** "las categorías se conectan con
los toggles ya existentes (3 tipos fijos que derivan signo y color)".
- **Opción A:** los 3 tipos-signo (Gasto/Ingreso/Transferencia) permanecen FIJOS como
  eje de signo; los "Grupos" editables son una capa ADICIONAL bajo cada uno. Toggles no cambian.
- **Opción B:** los toggles se vuelven DINÁMICOS, generados desde los Grupos que el
  usuario gestiona (cada grupo declara su signo).
Define el modelo de datos y el alcance de regresión sobre la pantalla principal.

### Regresión a proteger (si esto se reconstruye)
- Catálogo fijo actual se migra como **seed editable** (Comida, Transporte, Salario,
  Ahorros, etc. siguen disponibles).
- Movimientos ya registrados siguen resolviendo su `categoryId` (sin huérfanos).
- Registro de movimientos sigue funcionando: seleccionar tipo + categoría y guardar.
- Signo (+/−) y color por tipo se mantienen correctos (`domain/sign.ts`).
- `/presupuestos` (FR-013) no se rompe mientras exista.

---

## B) Módulo de presupuesto / balance (lo que era la feature `budget`, "Parte 2")

### Balance y roll-ups
- Fórmula base: `Ingresos − Gastos = saldo`.
- Cada **Grupo** muestra un **subtotal**.
- Roll-up encadenado: subcategoría → categoría → grupo → raíz. Todos los grupos bajo
  Ingresos suman a la raíz Ingresos; ídem Gastos. La jerarquía de (A) es la base.

### El nudo: Transferencias (= "ahorro / dos disponibles")
- Una transferencia NO es ingreso ni gasto neto: egreso en una cuenta + ingreso en otra
  (mover plata a Ahorro, banco→ahorro, retirar de ahorro).
- En el **patrimonio total** no cambia nada con una transferencia interna.
- Lo que cambia es el **bolsillo**: al menos dos "disponibles":
  - **Disponible total** (patrimonio: caja + ahorro)
  - **Disponible de caja** (lo gastable ya, sin tocar ahorro)
- Ahorro: sale de caja, entra a ahorro → baja disponible de caja, NO baja total.
  Retirar: sale de ahorro, vuelve a caja.
- **A resolver:** cómo se modela el balance con transferencias; si existe el concepto
  de "cuentas" (banco/caja/ahorro) o solo "bolsillos"; cómo se representa el doble
  disponible (total vs caja) en la UI.

### Saldo acumulado que rueda mes a mes (clave)
- El año se calcula encadenado: si un mes **sobra** dinero, ese sobrante es **saldo
  disponible del mes siguiente**, y así.
- Disponible del mes = (saldo arrastrado del mes anterior) + (ingresos del mes) − (gastos del mes).
- **A resolver:** cómo interactúa el arrastre con el doble disponible (caja vs total)
  y con las transferencias a ahorro.

### Origen de los datos de la grilla (manual vs automático)
- Cada celda tiene dos orígenes:
  - **Presupuesto:** lo introduce el usuario **manualmente**.
  - **Ejecutado:** llega **automáticamente** desde el registro ya construido
    (movimientos de `movementsStore`), agregados por categoría/mes.
  - El ejecutado quizá se pueda **editar manualmente** (override) — a confirmar.

### Layout de la pantalla
- **Desktop (full):**
  - Panel IZQUIERDO: el árbol de operaciones/grupos/categorías/subcategorías (reúsa el
    de la jerarquía A como panel del budget).
  - Resto: **gran grilla** con columnas = meses del año; por categoría, filas de
    **presupuesto** y **ejecutado**. Scroll horizontal si no cabe el año.
  - Subtotales y totales (roll-up por grupo y raíz) visibles en la grilla.
  - Posible **menú lateral** para futuros módulos (dejar navegación preparada).
- **Mobile (resumida):**
  - Árbol + solo el **mes en curso** + **selector de mes** para otros meses.
  - No cabe la tabla del año completo; vista compacta.

### Otros pendientes
- Selector multi-año (nice to have).
- Multi-año y override manual de ejecución pertenecían a esta Parte 2.

---

## Dependencia entre A y B
B (presupuesto) depende de la jerarquía gestionable de A para los roll-ups. En el plan
original eran dos features secuenciales: primero `categories` (cimiento), luego `budget`.
**Punto abierto para el nuevo requerimiento:** decidir si el nuevo alcance las mantiene
separadas, las fusiona, o las reordena.
