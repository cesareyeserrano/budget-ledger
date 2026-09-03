# FEATURE_IDEA — cierre-de-mes

_Escrito el 2026-09-02 para que las decisiones dejen de vivir solo en el hilo de una conversación.
Es el punto 3 del orden acordado (`aitri/BACKLOG.md` § «Orden acordado»), y corresponde a BL-036.
Todo lo citado como decisión del usuario se confirmó con él el 2026-09-01._

## El problema, en sus palabras

> «Es el cierre de mes que hay que implementar: después de que se cierre el mes, no se pueden editar
> movimientos. Es importante para evitar esos problemas.»

Lo dijo mucho antes de que existieran BL-037 y BL-038, cuando revisábamos si `movimientos-internos`
valía la pena. Su diagnóstico entonces fue: *«el único gap a cerrar es el cierre de mes, para evitar
dañar cosas ya cerradas»*.

## Por qué es la feature que más valor libera

No es «una feature más»: es la única pendiente que permite **borrar** maquinaria en vez de añadirla.
El razonamiento es del propio usuario, verificado contra el código:

> «Mientras el mes esté abierto uno simplemente edita la celda de reserva… no sería problema.
> Siempre y cuando, cuando cerremos ese mes, esa celda ya no se pueda tocar.»

Todas las reglas complicadas del techo —el consumo bruto, el «no empeorar», las marcas permanentes,
el trinquete— existen **por una sola razón**: hoy se puede editar cualquier mes pasado en cualquier
momento, así que una edición de enero puede romper octubre y hay que vigilar los doce meses en cada
operación. Si un mes cerrado no se toca, esa vigilancia deja de tener sentido y las reglas se
reducen a las dos que él enunció: no reservar más de lo disponible, y no sacar más de lo que hay.

**Consecuencia registrada:** BL-037 y BL-038 están CONGELADOS a propósito esperando a esta feature,
porque probablemente los disuelve. Ver `feature_context/analisis-del-modelo.md` para la evidencia
ejecutada.

## Alcance decidido

- **Congelar un mes cerrado**: sus celdas y sus movimientos dejan de ser editables.
- **Reapertura auditada.** Decidido al resolver que el saldo inicial solo se corrige con el mes
  abierto: > «A menos que en la feature de cerrar mes incluyamos reapertura para arreglar cosas, y
  tendríamos que ver cómo se audita.»

## LA pregunta de diseño central — RESUELTA el 2026-09-03

**¿Qué pasa cuando descubres un error en un mes ya cerrado?**

**Se reabre — pero SOLO el último mes cerrado.** Decisión del usuario, textual: «yo diría reabrir,
pero solo el mes anterior. Que quiere decir: estamos en septiembre inicios, solo podría corregir
algo de agosto, no de julio o antes de julio».

Es una restricción de producto que resuelve un problema técnico de raíz, y por eso se adopta tal
cual. La reapertura sin límite obliga a recalcular hacia adelante todo lo que venga después:
reabrir enero arrastra los once meses siguientes, varios de ellos cerrados. Acotándola al último
mes cerrado, **el recálculo nunca alcanza a otro mes cerrado** —todo lo posterior está abierto o es
plan—, así que el radio de daño queda acotado por construcción y no por disciplina.

*Precisión de redacción sobre las palabras del usuario, con su misma intención:* la regla se escribe
como «el ÚLTIMO MES CERRADO», no «el mes anterior en el calendario». En la cadencia normal son el
mismo mes, pero así se porta bien cuando el usuario se retrasa cerrando: si está en septiembre y
todavía no cerró agosto, lo reabrible es julio, que es el último que congeló. Y no permite caminar
hacia atrás: reabierto agosto y vuelto a cerrar, agosto sigue siendo el último cerrado — julio nunca
queda al alcance.

**Consecuencia aceptada, confirmada por el usuario:** un error en un mes demasiado viejo para
reabrir NO tiene corrección. No se construye el ajuste-en-el-mes-abierto de la contabilidad clásica.
Lo único que queda es dejar una **nota** en la celda explicando qué pasó — que sí se puede, porque
las observaciones no se congelan (ver abajo). Queda registrado para que nadie lo lea como un olvido.

## Su relación con las features vecinas

- **Va DESPUÉS de multi-año** (punto 1), que se cerró el 2026-09-02. La grilla dinámica (punto 2)
  se cerró sin construirse el 2026-09-03: multi-año la absorbió — ver `aitri/BACKLOG.md`. Riesgo
  asumido y anotado en el backlog: multi-año migró el modelo temporal, y esta feature podría
  eliminar después parte de esa maquinaria. El usuario lo aceptó porque el filtro por fechas que
  quiere no existe sin años.
- **Va ANTES del saldo inicial** (punto 4), por tres razones: la regla que él fijó para corregirlo
  —«solo mientras el mes esté abierto»— **necesita** que exista el concepto de «abierto»; el saldo
  inicial es conceptualmente *la apertura congelada del primer mes*, que es la idea que esta feature
  introduce; y construirlo antes sería apoyarlo sobre reglas a punto de cambiar.

## Decisiones del usuario (2026-09-03) — las cuatro preguntas, resueltas

Tomadas en conversación tras plantearle cada una con sus alternativas y su coste. No se re-abren.

1. **Cómo se corrige un mes cerrado** → reapertura acotada al último mes cerrado. Ver la sección
   central de arriba, con su consecuencia aceptada.

2. **Qué se congela: las CIFRAS sí, las NOTAS no.** Se congelan las celdas y los movimientos —todo
   lo que entra en un cálculo—, pero las observaciones de celda (FR-1012) siguen editables sobre un
   mes cerrado. Razón del usuario al elegirlo: una nota no altera ninguna cifra, y poder escribir
   «esto se corrigió en marzo» sobre un mes cerrado es lo que hace auditable el cierre. Encaja con
   la decisión 1: es la única salida que le queda a un error demasiado viejo para reabrirse.

3. **Cierre MANUAL, y si el usuario no cierra la app solo AVISA — nunca cierra por su cuenta.**
   El usuario preguntó expresamente qué pasaría si nunca cerrara («creo que generaría muchos errores
   si empieza a tocar cosas»), se le explicó el efecto completo, y aun así decidió que la app no
   congele nada a sus espaldas: aviso visible mientras haya meses sin cerrar, y nada más.

   **CONSECUENCIA QUE EL DISEÑO DEBE ABSORBER — no es un detalle.** Se le presentó antes de decidir
   y la aceptó. Toda la maquinaria complicada del techo (BL-037, BL-038, las marcas falsas y el
   trinquete) existe porque hoy cualquier mes pasado es editable en cualquier momento. Esa
   maquinaria solo puede RETIRARSE si los meses cerrados están garantizados — y con el cierre
   voluntario no lo están: un usuario que nunca cierre deja la app exactamente como hoy. Por tanto
   **BL-037 y BL-038 NO quedan disueltos automáticamente por esta feature**, al contrario de lo que
   supone el § «Por qué es la feature que más valor libera» escrito el 2026-09-02. El dominio tiene
   que soportar los DOS estados a la vez: reglas simples donde hay meses cerrados, y la vigilancia
   actual donde no los hay. Dimensionarlo es trabajo de la Fase 2; darlo por resuelto sería el error.

4. **Los meses futuros ya planeados siguen editables.** Cerrar septiembre congela septiembre y nada
   más. El saldo con que cierra pasa a ser el saldo de apertura de octubre y ese punto de partida
   queda fijo, pero todo el plan de octubre en adelante se sigue editando con libertad. Razón: el
   futuro es plan, y el plan cambia.

## Lo que sigue abierto para la Fase 1

- **Qué cuenta como «mes cerrable»**: ¿se puede cerrar un mes futuro? (Presumiblemente no, pero no
  se le preguntó y no se infiere aquí.)
- **La forma del aviso** de la decisión 3: dónde vive y cuándo aparece.
- **El rastro de la reapertura**: qué se registra exactamente y dónde se consulta. El usuario dijo
  «tendríamos que ver cómo se audita» y no se ha concretado.
