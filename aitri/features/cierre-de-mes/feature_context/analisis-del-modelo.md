# Análisis del modelo de reservas — la evidencia ejecutada

_Registro del 2026-09-01. Un auditor adversarial examinó el MODELO contable (no su implementación,
que ya se había auditado dos veces) buscando escenarios donde las reglas acordadas, aplicadas
fielmente, produjeran resultados sin sentido. Cada hallazgo se reprodujo con ejecuciones propias
contra el dominio real. Este documento existe porque esos números vivían solo en el hilo de la
conversación: sin ellos, quien diseñe el cierre de mes no sabe QUÉ va a poder borrar._

## Los dos defectos son UNO solo

Verificado ejecutando los dos caminos que la app ofrece para cubrir un gasto con reservas:

```
Junio: entran 1.000 · reservo 1.000 · aparece un gasto de 300

CAMINO A — saco 300 de la reserva para cubrirlo (el que la app prescribe)
  disponible 0 · en alcancía 700 · total 700 · ⚠ MARCADO COMO ERROR (exceso 300)

CAMINO B — bajo la celda de 1.000 a 700
  disponible 0 · en alcancía 700 · total 700 · sin marca
```

**Los mismos números exactos. Dos veredictos distintos.** Y el que queda marcado es el camino que
CONSERVA la verdad (metí 1.000, saqué 300 para pagar); el que sale impune es el que BORRA
información — la app olvida que llegaste a meter 1.000.

De ahí sale el trinquete de BL-038: bajar la celda es la única escapatoria de una marca falsa, y una
vez bajada, subirla otra vez se rechaza. Verificado:

```
bajar la celda 1.000 → 700 : ACEPTADO
volver a subirla a 1.000   : RECHAZADO  ← aquí nace el trinquete
```

**Conclusión para el diseño:** BL-037 (el castigo) y BL-038 (el trinquete) no son dos problemas.
Son uno. Si el cierre de mes elimina la marca falsa, nadie necesita bajar la celda y el trinquete
deja de aparecer en la práctica.

## La congelación de plata fresca

```
entran 1.000                            disponible 1.000 · cajón     0
los reservo todos                       disponible     0 · cajón 1.000
saco 300 porque los necesito            disponible   300 · cajón   700
y los gasto                             disponible     0 · cajón   700
entran 400 más                          disponible   400 · cajón   700

¿Puedo reservar esos 400 nuevos?
   con la regla simple del usuario:  SÍ
   con la regla de hoy:              NO — rechazado
```

Es la queja textual del usuario: *«si a mitad de mes me ingresa más dinero… o lo ahorro en
reservas»*, y la app dice que no.

## El modelo simple que el usuario enunció, y su verificación

> 1. Puedes reservar hasta lo que tengas **disponible** en ese mes.
> 2. Puedes sacar hasta lo que haya en el cajón.
> 3. Ninguna operación puede dejar un mes con gastos sin cubrir.

Aritméticamente, la regla 1 es «Δ ≤ disponible(mes)», porque `disponible = saldo anterior + ingresos
− gastos − reservado neto`.

**Lo que más importaba comprobar: ¿reabre el encierro original?** NO.

```
Estado que encerró al usuario: celda 1.500 con un retiro de 500 (ingreso 1.000)
  si borro el retiro → meses sin cubrir: ene,feb,mar,abr,may,jun,jul,ago,sep,oct,nov,dic
  ⇒ la regla 3 lo BLOQUEA
```

**Lo que se cede con ese modelo:** después de sacar 500 del cajón podrías volver a meterlos, y la
celda diría 1.500 aunque en el cajón haya 1.000. El usuario lo rechazó — *«la realidad es lo que
tengo; si dice 1.500 cuando tengo 1.000, está mal»*— y de ahí nació **BL-041**.

## El dato que cambia la conversación de BL-041

La divergencia entre lo que dice la celda y lo que hay en el cajón **YA EXISTE HOY**. No la
introduce ninguna propuesta:

```
reservo los 1.000              celda dice 1.000  ·  en el cajón hay 1.000
saco 300 porque los necesito   celda dice 1.000  ·  en el cajón hay   700   ← ya no coincide

reservo 600 en enero y 400 en febrero
   celda:  [600, 400]      ← lo que metí cada mes
   cajón:  [600, 1.000]    ← lo que tengo de verdad
```

La celda de febrero dice 400 cuando hay 1.000. La objeción del usuario es contra el diseño vigente,
no contra una propuesta nueva.

## Lo que el modelo defendió bien (no tocar sin razón)

Ejecutado y resistido: conservación en todas las operaciones de reserva; el mover es reversible;
**no hay doble consumo entre meses** (la fórmula del usuario «ingresos − gastos + saldo anterior» se
cumple limpiamente de mes a mes); el viaje al pasado está bloqueado (no se puede sacar plata que aún
no estaba); y el dedazo de un retiro es corregible en su propio mes.

Además, un dato que ahorra trabajo: **los retiros ya salen del acumulado**, no de lo aportado ese
mes. Verificado: aportando 600 en enero y nada en marzo, se pueden sacar los 600 en marzo. Esa parte
del modelo del usuario ya está construida.
