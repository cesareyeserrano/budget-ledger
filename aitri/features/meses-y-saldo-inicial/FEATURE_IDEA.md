# FEATURE_IDEA — meses-y-saldo-inicial

_Capturado el 2026-09-01 de las palabras del usuario. Lo que sigue es SU planteamiento, no una
reinterpretación; las preguntas abiertas van marcadas aparte al final y deben confirmarse con él
antes de cerrar la Fase 1._

## El problema, en sus palabras

> «Grilla por meses: problema — están quemados los meses a mostrar, y además si el usuario empieza a
> usar la app en junio, le quedan los meses de enero a mayo vacíos haciendo ruido.»

> «Se debe poder dar la opción de saldo inicial o configurar saldo inicial, porque si un usuario
> quiere iniciar a usar la app y ya tiene dinero pero no tiene los rubros, debería poder tener la
> opción de saldo inicial, que vendría siendo el saldo mes anterior que tenemos hoy día, solo que en
> ese caso sería saldo inicial.»

> «Adicional se propone crear una página de configuraciones, para poner allí todo lo que sea
> configurable o personalizaciones.»

## Su propuesta

1. **Solo mostrar los meses con información.** La grilla deja de tener los doce meses quemados.
2. **Cuando haya mucha historia, poder seleccionarlos desde el selector de año.**
3. **A futuro, poder mostrar al menos 12 o 24 meses hacia adelante.**
4. **Saldo inicial configurable**, que ocupa el lugar del «Saldo del mes anterior» en el primer mes
   que se muestre — con ese nombre: «saldo inicial».
5. **Una página de configuraciones** donde vivan éste y los demás ajustes.

## Qué ES el saldo inicial (confirmado por el usuario, 2026-09-01)

> «Para mí el saldo inicial es la primera entrada en la app en la historia del usuario. Vendría
> siendo, digamos, en ese mes, lo que hoy día es saldo del mes anterior.»

Es decir: **el saldo de APERTURA del historial**, no un campo por mes. Ocupa la casilla que hoy
ocupa «Saldo del mes anterior» en el primer mes que el usuario tiene, y solo cambia su rótulo:
allí se llama «Saldo inicial».

Consecuencia directa sobre el dominio: hoy `computeBalanceSeries` abre en `ZERO_CARRY` («el mes 1
no tiene mes previo: abre en 0/0»). Con esto, abre en el saldo declarado. Es un cambio pequeño y
localizado — el resto de la cascada no se entera.

### El riesgo que hay que cerrar en el diseño: el saldo inicial NO puede flotar

Si el saldo inicial se ata a «el primer mes con información», entonces **teclear un dato en un mes
anterior lo movería de sitio en silencio** y recalcularía toda la serie hacia adelante. El usuario
empieza en junio, declara su saldo inicial, y meses después registra algo de marzo: de golpe marzo
pasa a ser el primer mes y hereda una apertura que no le corresponde.

Propuesta a confirmar: el saldo inicial se ancla a un **mes declarado** («empiezo a usar la app en
junio de 2026»), no al primero que tenga datos. Los meses anteriores a ese ancla no forman parte del
historial del usuario.

## Lo que esto REVOCA (decisión anterior del propio proyecto)

La feature `balance` declaró esto en su `no_go_zone`, textual:

> «Saldo inicial manual del mes 1: DECIDIDO que el mes 1 arranca en 0 (no hay mes anterior). No se
> construye un campo de saldo inicial editable.»

Y el código lo documenta en `src/domain/balance.ts`: *«No existe un saldo inicial manual (decisión
de producto, no_go_zone)»*.

El usuario está revocando esa decisión con una razón nueva y concreta que antes no estaba sobre la
mesa: **quien empieza a usar la app a mitad de año ya tiene dinero, y hoy no tiene forma de
decírselo.** La revocación es legítima, pero debe quedar registrada como tal —no colada— y el
`no_go_zone` de esta feature tiene que decir explícitamente que la supersede.

## Su relación con `cierre-de-mes` (BL-036)

El usuario priorizó `cierre-de-mes` en la misma conversación, y las dos tocan el modelo temporal:

- `cierre-de-mes` congela el pasado (y, según su propio análisis, permitiría **retirar** buena parte
  de la maquinaria del techo — BL-037 y BL-038 quedarían disueltos).
- Ésta cambia **qué meses existen** en la vista y de dónde sale el saldo de apertura.

Si un mes cerrado no se toca, «el saldo inicial» y «el cierre del último mes cerrado» son casi la
misma idea. Conviene decidir el ORDEN antes de diseñar cualquiera de las dos.

## Respuestas del usuario (2026-09-01) — decisiones tomadas

**El historial empieza donde el usuario empieza.** > «Si inicio en junio, ¿por qué querría meter
algo en marzo? Eso no se puede, la historia comienza en junio. Si el usuario quiere iniciar su
historia en marzo estando en junio, tendrá que transcribir su historia manualmente empezando en
marzo.» ⇒ El ancla queda resuelta: no hay meses anteriores al de inicio, así que el saldo inicial no
puede flotar. El riesgo descrito arriba queda cerrado por decisión de producto, no por código.

**El saldo inicial es UN solo número.** > «Inicio con $X y con eso comienzo a registrar todo.»
Las alcancías arrancan vacías; si al empezar ya tenía algo apartado, lo declara como parte del
disponible y lo reserva después.

**Y observa que podría no hacer falta nada:** > «Incluso puede ser un ingreso normal y no
tendríamos que hacer nada… si crea un rubro único para todo o usa uno como salario; en ese caso
servirían los comentarios de las celdas.»
*Contrapunto a resolver en Fase 1:* aritméticamente funciona, pero **miente sobre el resultado del
mes** — el mes de arranque mostraría como INGRESO plata que el usuario ya tenía, y «Resultado del
mes» existe justamente para decir si el patrimonio creció. Un campo de apertura propio mantiene esa
cifra honesta. Sirve como solución provisional mientras la feature no exista.

**Corregible mientras el mes esté abierto.** > «Sí, siempre y cuando el mes esté abierto. Si se
cerró no se podría, a menos que en la feature de cerrar mes incluyamos reapertura para arreglar
cosas, y tendríamos que ver cómo se audita.» ⇒ Depende de `cierre-de-mes`, y la reapertura auditada
se apunta como alcance de ESA feature.

**Qué meses se ven.** > «Solo se ven los meses con datos y a futuro; es decir, no se muestra pasado
sin datos. Sí meses futuros sin datos, se va a usar.» ⇒ Pasado vacío: oculto. Futuro vacío: visible
(es donde se planea).

## Hallazgo de alcance: «12 o 24 meses a futuro» es OTRA feature

Verificado en el código: **el año no existe en el modelo.** `MonthKey` son doce literales
(`"ene"…"dic"`), `AmountMap` indexa por ellos, y el esquema de base de datos no tiene ninguna columna
de año. Todo el ledger es un único año implícito.

Por eso hay que separar dos cosas que en el enunciado van juntas:

- **Ocultar el pasado vacío y mostrar el futuro DENTRO del año** → presentación pura, sin tocar el
  modelo ni la base. Pequeño.
- **Mostrar 12–24 meses hacia adelante cruzando el año** → exige meter el año en el modelo, migrar
  los datos y revisar todas las derivaciones y reglas. Es una feature propia y grande (multi-año).

## Preguntas abiertas — CONFIRMAR con el usuario antes de cerrar Fase 1

1. **¿Se parte la feature?** Recomendación técnica pendiente de su visto bueno: (a) grilla dinámica
   dentro del año —presentación pura, alivio inmediato—, (b) saldo inicial y página de
   configuración DESPUÉS de `cierre-de-mes`, (c) multi-año como feature propia.
2. **¿Qué ve un usuario NUEVO, sin ningún dato?** Con la regla «solo meses con datos», su grilla
   estaría vacía. Propuesta: mostrar siempre el mes de inicio declarado y los futuros.

## Fuera de alcance (propuesto, a confirmar)

- El cierre de mes en sí (BL-036) — es su propia feature.
- Cambiar el modelo de reservas (BL-037 / BL-038), que el usuario decidió congelar a la espera del
  cierre de mes.
- Multi-año real: hoy la escala es de doce meses de un año. Mostrar «24 meses a futuro» puede exigir
  cruzar el año, y eso es un cambio de modelo mayor que hay que dimensionar aparte.
