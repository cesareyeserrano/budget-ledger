/**
 * Module: tests/integration/backend/helpers/sweepOrphans
 * Purpose: barre contenedores de testcontainers que quedaron huérfanos de corridas anteriores, ANTES
 *   de levantar los de esta corrida.
 *
 *   Por qué existe: el reaper (Ryuk) SÍ funciona — ante un Ctrl-C o un SIGKILL del proceso de vitest
 *   cierra el socket, espera su reconnection-timeout y borra todo lo etiquetado con su session-id.
 *   Lo que no cubre es que se caiga el propio demonio: Ryuk es un contenedor más y se crea con
 *   AutoRemove, así que si Docker Desktop se cierra (o la VM se reinicia) Ryuk muere a la vez que lo
 *   que debía barrer, desaparece sin dejar rastro, y nadie vuelve a mirar esos contenedores NUNCA.
 *   Ese es el caso real observado: dos postgres con la MISMA session-id y el MISMO instante de
 *   Finished, Exited(255), vivos en `docker ps -a` tres semanas después.
 *
 *   Ryuk no puede arreglar eso desde dentro de la VM que se está cayendo. El único punto donde se
 *   puede recuperar es el arranque de la siguiente corrida, que es lo que hace este módulo: la
 *   basura pasa de acumularse indefinidamente a durar, como mucho, hasta el próximo `./unit.sh`.
 *
 *   Seguridad del barrido — sólo borra un contenedor si se cumple TODO:
 *     1. lleva la etiqueta org.testcontainers=true  → jamás toca los ledger-dev-* ni nada de compose;
 *     2. lleva un org.testcontainers.session-id     → deja en paz los `.withReuse()`, que se crean
 *                                                     sin session-id justamente para sobrevivir;
 *     3. su session-id NO tiene un Ryuk vivo        → una corrida en paralelo mantiene su Ryuk en
 *                                                     pie, así que sus contenedores son intocables.
 *   Ryuk arranca siempre ANTES del primer contenedor de su sesión (getReaper() se llama dentro de
 *   GenericContainer.start()), así que "sesión viva" ⟺ "su Ryuk está corriendo" no tiene ventana de
 *   carrera por la que se cuele una corrida ajena.
 *
 * Dependencies: testcontainers (getContainerRuntimeClient — resuelve el mismo endpoint Docker que
 *   usa testcontainers: respeta DOCKER_HOST, contextos y CI sin depender del CLI `docker`).
 */
import { getContainerRuntimeClient } from "testcontainers";

const LABEL_TESTCONTAINERS = "org.testcontainers";
const LABEL_SESSION_ID = "org.testcontainers.session-id";
const LABEL_RYUK = "org.testcontainers.ryuk";

export async function sweepOrphanedContainers(): Promise<number> {
  let removed = 0;
  try {
    const client = await getContainerRuntimeClient();
    const { dockerode } = client.container;

    const containers = await dockerode.listContainers({
      all: true,
      filters: { label: [`${LABEL_TESTCONTAINERS}=true`] },
    });

    // Una sesión está viva mientras su reaper esté en pie. Todo lo demás es basura sin dueño.
    const liveSessions = new Set(
      containers
        .filter((c) => c.State === "running" && c.Labels[LABEL_RYUK] === "true")
        .map((c) => c.Labels[LABEL_SESSION_ID])
        .filter((id): id is string => Boolean(id)),
    );

    const orphans = containers.filter((c) => {
      if (c.Labels[LABEL_RYUK] === "true") return false; // el reaper se autogestiona (AutoRemove)
      const sessionId = c.Labels[LABEL_SESSION_ID];
      if (!sessionId) return false; // sin session-id = opt-out deliberado del auto-cleanup
      return !liveSessions.has(sessionId);
    });

    for (const orphan of orphans) {
      try {
        // force: se lleva también los que siguen corriendo (el caso que quema batería).
        // v: borra los volúmenes anónimos del contenedor, que si no se quedan ocupando disco.
        await dockerode.getContainer(orphan.Id).remove({ force: true, v: true });
        removed++;
      } catch (err) {
        // Otra corrida pudo borrarlo entre el listado y el remove: no es un fallo nuestro.
        console.warn(`[sweep] no se pudo borrar ${orphan.Id.slice(0, 12)}: ${String(err)}`);
      }
    }

    if (removed > 0) {
      console.info(`[sweep] ${removed} contenedor(es) huérfano(s) de corridas anteriores eliminados`);
    }
  } catch (err) {
    // El barrido es higiene, no un requisito de la suite: si Docker no contesta, que falle el
    // arranque del contenedor de verdad y no aquí, con un error que no explica nada.
    console.warn(`[sweep] barrido omitido: ${String(err)}`);
  }
  return removed;
}
