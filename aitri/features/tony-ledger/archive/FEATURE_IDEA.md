<!-- AGENT: if you fill this for the user, confirm the ground-truth fields
     (Problem / Why, Target Users, Success Criteria, Out of Scope) with them —
     do not silently infer. Mark anything you inferred as "[ASSUMPTION] …".
     Phase 1 records these as a provenance contract and blocks unconfirmed,
     untracked guesses on the highest-value inputs. -->

<!-- Origen: BL-057 y las decisiones del usuario del 2026-09-26 y del 2026-10-10. El 10-oct el usuario
     fijó el rumbo: el Tony original queda como prueba de concepto y la copia (`tledger`) hace LO MISMO
     que el original, pero su libro es T-Ledger en vez del archivo y el Excel. Sustituye al borrador
     anterior, que solo cubría lectura. Estudio previo de los dos perfiles hecho por SSH el 10-oct. -->

## Feature
Que Tony Ledger —la copia del agente que el usuario ya usa por Telegram— lleve su libro en T-Ledger: lo que hoy registra, corrige y consulta sobre su archivo propio y su Excel, lo registre, corrija y consulte en la app.

## Problem / Why
Hoy hay dos libros desconectados. Tony captura bien (correo del banco, preguntas por Telegram, pendientes, cuentas por pagar, 4x1000) pero escribe en un archivo propio y un Excel; T-Ledger tiene el presupuesto, los bolsillos y el Balance, pero se alimenta a mano. El usuario registra dos veces o deja uno de los dos atrasado, y cuando le pregunta a Tony cuánto lleva gastado, Tony suma con el modelo sobre su archivo y la cifra puede no coincidir con la app.

T-Ledger no tiene por dónde dejar entrar a un agente: solo acepta la sesión del navegador; cada movimiento exige una categoría del árbol del usuario; no guarda de dónde vino un movimiento, así que un reintento lo duplicaría; y las cifras que importan (presupuestado, ejecutado, restante, Balance, saldo de cada bolsillo) se calculan solo en el navegador.

Decisiones del usuario: integración sobre la copia del perfil, no un agente nuevo dentro de T-Ledger (2026-09-26). El original no se toca y queda como prueba de concepto; la copia es su espejo con T-Ledger como libro (2026-10-10).

## Target Users
El dueño de la cuenta de T-Ledger, que conversa con Tony por Telegram y sigue usando la app en el navegador. Tony (el perfil `tledger` en Hermes) es el cliente técnico que actúa en su nombre con un acceso propio.

## New Behavior

### Acceso del agente (diseño aprobado por el usuario el 2026-10-10)
- El agente NO usa la API del navegador ni escribe directo en la base: entra por una superficie propia y pequeña del mismo servidor, hecha a su medida, que por dentro llama a las mismas funciones del dominio y del repositorio que usa la app. Lo que no está en esa superficie no existe para el agente.
- La superficie del agente ofrece solo esto: leer el árbol; registrar un movimiento (gasto, ingreso u operación de bolsillo); corregirlo; deshacerlo; leer los movimientos de un periodo; pedir el resumen de un periodo; preguntar a qué periodo cae una fecha.
- La API del navegador no cambia y NO acepta el token del agente: sigue exigiendo sesión y Origin.
- El agente se identifica con un token propio de la cuenta: largo, al azar, mostrado una sola vez al crearlo y guardado en el servidor solo como hash. Da acceso ÚNICAMENTE a los datos de la cuenta que lo creó.
- Los tokens se crean, se listan (nombre, cuándo se creó, cuándo se usó por última vez) y se revocan con un comando en el servidor, sin pantalla nueva: una sesión de navegador robada no puede fabricar un token. Un token revocado deja de funcionar de inmediato.
- Cada movimiento que registra el agente queda marcado con quién lo registró y su referencia de origen, y la app lo muestra, para que el usuario vea qué escribió el agente y pueda deshacerlo.
- La superficie del agente tiene un tope de peticiones por token, por si el agente entra en bucle.
- La superficie entera se apaga con un ajuste del servidor; apagada, contesta como si no existiera.
- En producción se alcanza solo por una red interna de la máquina, entre el contenedor del agente y el de la app; no se publica hacia internet.

### Escribir como lo hace hoy Tony
- El sistema debe aplicar a lo que escribe el agente exactamente las mismas reglas que al registro manual (categoría válida, mes cerrado, periodo según la fecha, techo y piso de bolsillos) y contestar el motivo del rechazo de forma que Tony pueda decírselo al usuario.
- El sistema debe guardar, por movimiento, una referencia de origen opcional que entrega quien lo registra; si llega otra vez un registro con la misma referencia, no crea un segundo movimiento y devuelve el que ya existe. (Tony reintenta, y el banco manda dos avisos por traslado.)
- El sistema debe dejar que el agente corrija lo que ya registró: monto, fecha, nota y categoría de un gasto o ingreso, y borrarlo (lo que en Tony es «anular» o «ignorar» algo ya clasificado).
- [ASSUMPTION] El sistema debe dejar deshacer con el token una operación de bolsillo registrada por error. Revisado el 2026-10-10: hoy corregir o borrar un movimiento de bolsillo por la vía de los movimientos se rechaza siempre (`unsupported_type`); solo el navegador puede, guardando el libro completo, que es justo la vía que el agente no debe usar. El dominio ya tiene las funciones (`removeReserveOp`, `editReserveOp`).
- Equivalencia fijada por el usuario (2026-10-10): lo que en Tony es la cuenta principal, en la app es el saldo DISPONIBLE; lo que en Tony son las alcancías, en la app es el saldo RESERVADO. Un traslado de la principal a una alcancía = reservar; de vuelta = sacar; entre alcancías = mover. Como la app reserva siempre en un bolsillo concreto, el agente elige el bolsillo del árbol y pregunta cuál cuando no es evidente.
- La descripción que hoy guarda Tony viaja como la nota del movimiento.

### Categorías: se usa el árbol de la app, sin crear nada
- El sistema debe entregar el árbol vigente del usuario (tipos, grupos, categorías, subcategorías y bolsillos, con identificadores y nombres) para que Tony clasifique directamente contra él.
- El agente NO crea, renombra ni borra categorías ni bolsillos. Si ningún nodo encaja, el movimiento se queda pendiente en Tony y Tony le dice al usuario que lo cree en la app o elija otro.
- El agente no tiene catálogo propio: usa el de la app (decisión del usuario, 2026-10-10). Sus alias aprendidos («Rappicard = tarjeta de crédito») apuntan a nodos del árbol de la app.

### Consultar con las cifras de la app
- El sistema debe ofrecer una lectura de resumen de un periodo, calculada en el servidor con las mismas funciones del dominio que usa la pantalla: por categoría y grupo, lo presupuestado, lo ejecutado y lo restante; los totales de ingresos y gastos; el Balance (disponible) y el saldo de cada bolsillo.
- El sistema debe permitir leer con el token los movimientos de un periodo, para contestar «en qué se fue» y para que Tony ubique un movimiento reciente al corregirlo.
- El sistema debe decir a qué periodo pertenece una fecha según el calendario del usuario (mes o ciclo), para que Tony no lleve el ciclo por su cuenta.

### El lado de Tony (la copia)
- El código del agente es de Hermes y NO vive en este repositorio público: va en un repositorio aparte, privado y bien configurado (decisión del usuario, 2026-10-10). Este repositorio entrega la API y su contrato documentado, sin datos personales ni secretos.
- La copia se llamará Agent-L (nombre fijado por el usuario el 2026-10-13).
- La copia se vuelve a igualar con el original antes de integrarla: desde el 26-sep el original ganó el cálculo del 4x1000 y cambios en sus instrucciones.
- Se quedan en Tony, sin pasar a T-Ledger: los pendientes sin confirmar, lo ignorado, las cuentas por pagar, los correos ya procesados, los recordatorios y el número visible de cada movimiento (L123), que Tony enlaza con el movimiento de la app.

## Success Criteria
- Dado un movimiento confirmado por el usuario en Telegram, cuando Tony lo registra, entonces aparece en la app en la categoría y el periodo correctos, con la misma cifra, y el Ejecutado y el Balance cambian igual que si se hubiera registrado a mano.
- Dado el mismo registro enviado dos veces con la misma referencia de origen, entonces en la app hay un solo movimiento.
- Dado un registro que la app no admite (mes cerrado, categoría inexistente, bolsillo sin saldo), entonces el libro no cambia y la respuesta trae el motivo.
- Dado el libro de pruebas de admin@admin.com, cuando se pide con un token el resumen de un periodo, entonces cada cifra es idéntica, peso a peso, a la que muestra la app.
- Dado un token válido, cuando se usa contra la API del navegador (guardar el libro, cerrar un mes, cambiar preferencias, tocar el árbol), entonces se rechaza igual que una petición sin sesión y nada cambia.
- Dado un movimiento registrado por el agente, entonces en la app se distingue de uno registrado a mano.
- Dado un token revocado, cuando se usa, entonces se rechaza y no devuelve ningún dato. Dado el token de un usuario, nunca aparecen ni se tocan datos de otra cuenta.
- La auditoría de seguridad (`aitri audit security`) sobre la superficie nueva no deja hallazgos P0.
- Ningún token, clave ni dato real queda en el repositorio (es público).
- Prueba de punta a punta antes de producción (confirmado por el usuario, 2026-10-10: siempre se prueba en dev): en dev, con admin@admin.com, la copia registra un gasto, un ingreso, una reserva y una corrección, y contesta una consulta, todo por Telegram.

## Touch Points
- AÑADE: una superficie propia para agentes bajo `src/app/api/` con su envoltorio (token, tope de peticiones, interruptor) y un módulo de tokens en `src/server/`. `src/server/http.ts` (el envoltorio de la API del navegador) NO cambia.
- AÑADE: un comando de servidor en `scripts/` para crear, listar y revocar tokens.
- MODIFICA: esquema de la base (migración aditiva: tabla de tokens guardados como hash; referencia de origen y marca de quién registró en el movimiento).
- MODIFICA: `src/server/data/ledgerRepo.ts` (referencia de origen e idempotencia; deshacer una operación de bolsillo reutilizando `removeReserveOp`).
- MODIFICA: el Detalle de movimientos de la app, para mostrar la marca de lo registrado por el agente.
- AÑADE: dentro de la superficie del agente, las lecturas (resumen del periodo, árbol, periodo de una fecha) que reutilizan `src/domain/rollup.ts`, `src/domain/balance.ts` y `src/domain/reserve.ts` sin cambiarlos.
- AÑADE: la documentación del contrato de la API para agentes. El cliente y el perfil viven en el repositorio aparte.

## Must Not Break (Regression Boundary)
- El acceso por sesión del navegador sigue igual: mismas rutas, mismas respuestas, mismas cookies.
- Toda mutación de la API del navegador sigue exigiendo sesión y un Origin permitido; una petición sin sesión recibe el mismo rechazo que hoy, traiga o no un token de agente.
- Las cifras de la pantalla no cambian: el resumen del servidor usa las funciones del dominio, no una copia.
- Las reglas del servidor valen igual para el agente: ninguna escritura con token deja el libro en un estado que el registro manual habría rechazado.
- El aislamiento entre cuentas se mantiene: ninguna lectura ni escritura alcanza datos de otro usuario.
- Los movimientos registrados a mano, sin referencia de origen, siguen siendo válidos y se comportan igual.
- Los límites de intentos del login y de la recuperación de acceso siguen activos y con los mismos valores.
- La sincronización entre pestañas sigue funcionando, y un movimiento que registra Tony aparece en la app abierta sin recargar.

## Out of Scope
- Migrar a T-Ledger los movimientos del libro del Tony original: en producción se toma lo que llegue desde el arranque (decisión del usuario, 2026-10-10).
- Que el agente cree, renombre, mueva o borre categorías, grupos o bolsillos: el árbol se administra a mano en la app (decisión del usuario, 2026-10-10).
- Que el agente cierre o reabra meses, cambie ciclos, el saldo inicial, el presupuesto o las preferencias.
- Pasar a T-Ledger los pendientes, lo ignorado, las cuentas por pagar y los recordatorios: siguen en Tony.
- Todo cambio en el perfil original `ledger`, que no se toca, y el relevo del vigilante de correo del original a la copia, que es un paso de operación en la Pi posterior a esta entrega.
- Un chat dentro de la app, WhatsApp o un servidor MCP: el canal es Telegram por Hermes.
- Elegir o cambiar el modelo de Tony.
- Tokens con permisos a medida, con caducidad configurable o compartidos entre cuentas.
- Una pantalla en la app para gestionar tokens: se hace con un comando del servidor; la pantalla se añade después si hace falta.
- Una bandeja de propuestas del agente para aprobar en la app: el usuario ya confirma en Telegram.
- Que el agente escriba directo en la base de datos o use la API del navegador.
