# Product Discovery — Problem Statement

Feature **diario-de-celda**, BL-044. Fuentes: el brief de la feature (redactado el 2026-09-14 a partir de BL-044;
al aprobar la fase 1 queda en `01_REQUIREMENTS.json#original_brief`) y el discovery guiado con el usuario del 2026-09-14. Donde una resolución de abajo contradice la idea, gana la
resolución: es la capa más nueva y la validó el usuario.

## Problem

Cada gasto e ingreso que el usuario registra guarda una nota, pero la aplicación no la muestra en ningún
lugar. Al abrir una celda de la grilla, el usuario ve un total y no puede saber de qué se compone ni qué fue
cada gasto. Los movimientos existen, pero una vez guardados son invisibles.

Línea base, medida en los datos reales del usuario el 2026-09-14:
- **27 de 27 movimientos tienen nota (100 %), y ninguna se ve en la aplicación.**
- 17 celdas de ejecutado están formadas por movimientos; una llega a tener 7.
- Hoy las 17 cuadran con la suma de sus movimientos, pero nada lo garantiza: teclear un número en una celda
  reemplaza su valor en silencio y deja los movimientos sin relación con el total.
- Tiene 28 comentarios de solo texto en sus celdas, que no son copias de las notas de los movimientos.
- Ya costó un error de datos que solo se descubrió mirando la base (BG-017, hoy arreglado).

Petición original del usuario: que la observación de una celda «tenga un campo de valor y la celda sume sola».
El objetivo de fondo lo aclaró él mismo en el discovery: poder llevar el detalle de cada gasto **sin una
grilla eternamente larga**, es decir, sin crear una fila por cada gasto.

**Resumen en tres frases.** Registrar gastos ya está resuelto, pero lo registrado no se puede ver: la celda
muestra un total sin su detalle. El usuario necesita abrir una celda y ver los movimientos que la forman, con
su fecha, monto y nota, y poder cargarlos, corregirlos o borrarlos ahí mismo. La celda y su detalle tienen que
cuadrar siempre, sin cuentas mentales.

## Users

- **El presupuestador personal, usuario único del producto en producción.** El mismo de todas las features
  anteriores. Registra cada gasto con «Nuevo movimiento» y lleva la grilla por ciclos de pago (modo ciclos,
  día 21). Siempre anota qué fue cada gasto. Al abrir una celda quiere responder «¿en qué se fue esta plata?».
- No aparece un tipo de usuario nuevo.

## Success Criteria

Montos inventados: se comprueban con datos de prueba, no con los del usuario. Confirmados por el usuario el
2026-09-14.

1. **Ver el detalle.** Dada una celda con 3 movimientos, cuando la abro, entonces veo los 3 con fecha, monto y
   nota, y su suma es exactamente el valor de la celda.
2. **Añadir desde el detalle.** Dada una celda en 100.000, cuando escribo «30.000 · Almuerzo» en «Añadir
   movimiento» del detalle, entonces la celda pasa a 130.000 y el movimiento aparece en la lista con esa nota,
   sin abrir otro formulario.
3. **Escribir directo en la grilla crea un ajuste.** Dada una celda en 100.000, cuando tecleo 120.000, entonces
   aparece un movimiento de ajuste de +20.000 con la nota «Ajuste manual»; si tecleo 90.000, el ajuste es de
   −10.000. En ambos casos la celda y su lista siguen cuadrando.
4. **Editar.** Cuando cambio un movimiento de 50.000 a 5.000, entonces la celda baja exactamente 45.000.
5. **Cambiar de categoría.** Cuando paso un gasto de 20.000 de Restaurantes a Mercado, entonces Restaurantes
   baja 20.000 y Mercado sube 20.000, en el mismo ciclo.
6. **Borrar.** Cuando borro un movimiento repetido de 15.000, entonces desaparece de la lista y la celda baja
   15.000.
7. **Reglas de periodo.** En un ciclo cerrado no se puede añadir, editar, borrar ni teclear, y la pantalla dice
   que está cerrado. En un ciclo abierto (terminado o en curso) o reabierto sí se puede, pero una fecha fuera de
   ese ciclo se rechaza, con la misma regla que ya aplica «Nuevo movimiento» (incluido el ingreso adelantado que
   puede contar en el ciclo que abre).
8. **Comentarios.** Los 28 comentarios existentes siguen en su celda, y los movimientos, los comentarios y los
   comentarios automáticos de los bolsillos se muestran con un mismo estilo. Se puede añadir un comentario nuevo.

## Out of Scope

- **Notas con monto que sumen a la celda.** Se descartan: esa función la cumplen los movimientos.
- **Un segundo formulario de captura.** «Nuevo movimiento» sigue siendo la vía principal; desde la celda solo
  hay una línea compacta de monto y nota.
- **Mover un movimiento a otro mes o ciclo.** Si hace falta, se borra y se crea en el correcto (decisión del
  usuario; pidió que se le avise si aparece una buena razón para incluirlo).
- **Anotar, editar o borrar en un ciclo cerrado.** Para corregirlo se usa la reapertura que ya existe.
- **Ligar un gasto con la alcancía que lo financió** (BL-035, diferido por el usuario el 2026-08-29).
- **Movimientos negativos fuera de los ajustes.** Solo un ajuste por teclear un valor menor puede ser negativo
  [ASSUMPTION: el usuario aceptó los ajustes negativos; no se habló de cargar a mano un monto negativo].
- **El presupuesto (plan).** No tiene movimientos: se sigue tecleando como hoy.

## Resolutions

Decisiones del usuario en el discovery guiado del 2026-09-14. Cada línea: tensión → decisión → qué descarta.

1. **Qué manda cuando lo tecleado y la suma de movimientos difieren** → **teclear un valor en la celda de
   ejecutado crea un movimiento de ajuste por la diferencia, hacia arriba o hacia abajo**, con la nota por
   defecto «Ajuste manual», que el usuario puede cambiar. Descarta la celda de solo lectura y el descuadre
   marcado pero tolerado.
2. **Celdas sin movimientos** → teclear en una celda vacía también crea un ajuste por el total, con la nota
   automática. Descarta dos comportamientos distintos según la celda tenga o no movimientos.
3. **Dónde se anota y con qué fecha** (tres vueltas; la última gana y supera a las anteriores): primero el
   usuario dijo «la fecha del sistema»; luego «un ciclo que ya terminó no admite registros»; tras repasar las
   reglas de cierre de mes → **manda el CIERRE**: se puede anotar en cualquier ciclo NO cerrado, terminado o en
   curso, y en el último reabierto, con fecha dentro de ese ciclo. Descarta congelar un ciclo solo porque terminó,
   que habría vaciado de sentido el cierre manual.
4. **Registrar transacciones ya estaba resuelto** (el usuario pidió revisar «Nuevo movimiento») → **no se
   construye un segundo sistema**: lo que falta es ver lo registrado; «Nuevo movimiento» es la vía principal y
   teclear en la grilla, la secundaria. Supersede la idea original de «notas con valor».
5. **Añadir desde la celda: abrir el formulario grande o escribir ahí mismo** → **una línea «Añadir movimiento»
   con monto y nota dentro del detalle**. El usuario vio raro abrir un formulario desde una celda que ya se está
   editando; se eligió esta opción frente a «teclear el total nuevo» porque sus 27 movimientos tienen nota y hay
   celdas con varios gastos, así que sumar de cabeza y poner la nota después añadía fricción. Descarta abrir el
   formulario grande desde la celda.
6. **Editar o borrar un movimiento, que hoy no existe** → **se edita todo (monto, nota, fecha y categoría) y se
   puede borrar**, con las reglas de periodo de la resolución 3. Descarta corregir solo con ajustes.
7. **Validar la fecha al editar un ingreso adelantado** → **editar aplica las mismas reglas que «Nuevo
   movimiento»**, que ya permite que un ingreso cercano al día de pago cuente en el ciclo que abre. Descarta
   exigir siempre «fecha dentro del ciclo donde cuenta».
8. **Qué hacer con los 28 comentarios de solo texto** → **se quedan**, conviven con los movimientos, se pueden
   añadir nuevos y todo comparte el estilo de los comentarios automáticos. Descarta borrarlos o migrarlos.
9. **Nombres mezclados** (el usuario notó que «notas», «observaciones» y «detalles» se cruzaban, y que parecía
   «movimiento dentro de movimiento») → **un nombre por nivel en toda la app: la celda tiene un Detalle; el
   Detalle lista Movimientos y Comentarios; un Movimiento tiene Nota.** Supersede el rótulo actual
   «Observaciones».
10. **BG-017**, que la idea proponía cerrar aquí → ya está arreglado; queda fuera.

## Discovery Confidence
Confidence: medium
Evidence gaps:
- Las 2 celdas de ejecutado tecleadas a mano que hoy no tienen movimientos: la resolución 2 dice que teclear en
  una celda vacía crea un ajuste, y de ahí se infiere que esas 2 celdas reciben un ajuste por su valor actual
  para que todo cuadre desde el primer día [ASSUMPTION]. El usuario lo tiene que confirmar al aprobar. Con la
  resolución 3 la fecha ya no es problema: su ciclo sigue abierto.
- Cargar a mano un movimiento con monto negativo no se discutió; se asume que solo los ajustes pueden ser
  negativos [ASSUMPTION].
- Añadir un movimiento con fecha en un ciclo futuro no cerrado se asume igual que hoy en «Nuevo movimiento»
  [ASSUMPTION].
Handoff decision: ready — todas las decisiones estructurales las tomó el usuario; los tres gaps son
confirmaciones puntuales que pasan por la checklist de aprobación.
