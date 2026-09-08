# Traspaso — Cadencia (Ciclos), para la sesión que la retome

_Escrito el 2026-09-08 al cerrar la sesión que analizó la feature. Decisión del usuario: los bugs
de dinero primero, Cadencia en sesión nueva._

## Estado

**BL-043 (P1) en el backlog. NO arrancada.** No hay `aitri feature init` hecho — se decidió a
propósito que lo primero es un **discovery**, no una feature.

## Lo primero que hay que leer

`requerimiento-ciclos-de-pago.md`, en esta misma carpeta. Es material del cliente y es
**AUTORITATIVO**: sus decisiones se llevan a los FR tal cual, no se re-deciden. El usuario advirtió
que **está en crudo y hay que refinarlo** — refinar significa resolver los huecos CON él, no
reescribir lo que ya definió.

## LA PREGUNTA QUE HAY QUE RESOLVER ANTES QUE NINGUNA OTRA

**¿Qué pasa con una celda de la grilla bajo el modelo de ciclos?**

No está en el documento del usuario, y es la que lo decide todo:

- Un **movimiento** capturado desde el Registro lleva `Movement.date` con la fecha ISO completa
  (`src/domain/types.ts`), y el `period` se DERIVA de ahí. La regla de asignación de la sección 3
  los coloca sola. **Media feature ya está pagada.**
- Una **celda de la grilla** es `budgets[hojaId]["2026-09"]`: un mes SIN día. **No hay información
  para decidir a qué ciclo pertenece.**

De ahí salen las dos rutas posibles, y son productos distintos:

1. **Los ciclos SUSTITUYEN a la grilla mensual.** La rejilla pasa a tener columnas de ciclo. Es
   coherente pero rehace FR-006, y todo lo tecleado en celdas hasta hoy hay que reasignarlo a mano.
2. **Conviven.** La grilla mensual se queda para planear y los ciclos son una vista de ejecución.
   Más barato, pero hay que definir qué manda cuando discrepan — y ese es justo el error que el
   propio documento llama "mezclar dos sistemas de corte" (sección 4.1).

**CONSECUENCIA PRÁCTICA CON RELOJ:** el usuario empezó a meter datos reales el 2026-09-08. Todo lo
que teclee DIRECTO EN LA GRILLA desde entonces es dato que no se podrá reasignar automáticamente.
Cuanto más tarde se responda esto, más trabajo manual cuesta.

## Análisis de impacto ya hecho — medido en el código, no estimado (2026-09-08)

1. **Toca el eje de indexación del dominio.** `PeriodKey = "YYYY-MM"` (`src/domain/periods.ts:21`)
   vive en **25 ficheros** de `src/` y es la clave de los mapas de dinero. Un ciclo es un rango de
   **duración variable** (15 y 16 días alternados en quincenal, 13 en febrero) que en los esquemas
   semanal o catorcenal ni se alinea con el calendario.
2. **Colisiona con `cierre-de-mes` entera** (92 TCs verificados): `closedThrough` y
   `reopenedPeriod` son PeriodKey de MES, 26 menciones en `src/domain/closure.ts`. El cierre
   secuencial, el trinquete de reapertura y la línea de base del impacto se redefinen sobre la
   frontera del ciclo.
3. **Colisiona con `meses-y-saldo-inicial`:** `startMonth` es el ancla del historial y es un mes.
4. **Colisiona con `multi-anio`:** `activeRange` deriva el eje de meses con datos y del horizonte en
   años; la rejilla de 12 columnas de FR-006 asume meses.
5. **RF-09c (prorratear un gasto entre los ciclos que lo anteceden) es conceptualmente lo mismo que
   las alcancías/reservas de `transferencias`**, con su techo y su piso. Estudiar si se REUSA ese
   motor: sería la mayor economía de toda la feature.
6. **RV-07** ("un cambio de configuración no puede alterar el balance de ningún ciclo anterior") es
   la NFR de regresión más dura y la que más fácil se rompe en silencio. El documento avisa: *"es el
   error más costoso de este modelo"*.

## Trampa que el usuario ya dejó señalada y conviene verificar pronto

**Sección 8.1 — arrastre de saldo entre ciclos.** El arrastre YA EXISTE en el producto y opera
sobre el MES. El documento lo clava: *"es una falla silenciosa: el cálculo funciona, pero contra el
periodo equivocado"*. Verificarlo es barato y dice mucho.

## Ruta recomendada

**No es una feature, son varias.** Empezar por `aitri run-phase discovery` propio —lo que AGENTS.md
pide para algo de este tamaño— y resolver ahí, CON el usuario:

- La pregunta de la celda de la grilla (arriba). **Bloquea todo lo demás.**
- Los cinco casos abiertos de la sección 8 del documento.
- Si se reusa el motor de reservas para RF-09c.
- Qué pasa con `cierre-de-mes` bajo ciclos: ¿se cierra un ciclo en vez de un mes?

## Contexto del proyecto al cerrar la sesión

- La raíz: 7 fases aprobadas, verify 59/59, release 0.0.1-beta sellado. Un bloqueador:
  `recuperar-acceso` con verify rojo, **pospuesta por decisión del usuario**.
- `semilla-intacta` cerrada 5/5: la semilla ya no trae montos de ejemplo.
- Pendiente decidido y SIN construir: la feature del recorrido de arranque (pantalla de apertura,
  botón «cargar datos de ejemplo», Configuración diciendo qué declaraste, separador de miles al
  escribir dinero).
- **La base de desarrollo tiene datos REALES del usuario desde el 2026-09-08.** No borrar ni
  modificar sin pedírselo cada vez.
