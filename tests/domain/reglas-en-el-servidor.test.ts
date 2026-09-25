// Feature reglas-en-el-servidor — el guardia de ESTADO en el dominio puro. Prefijo TC-RES-*.
//
// Lo que estas pruebas defienden no es solo que el guardia funcione: es que NO SE PASE DE ALCANCE.
// La primera versión juzgaba todo diff y ponía rojas 7 pruebas de dos features cerradas, porque
// NFR-1803 garantiza que las escrituras de ingresos y gastos no adquieren validación nueva.
// TC-RES-212h existe para que eso no vuelva a colarse.
import { describe, it, expect } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { worsenedBy } from "@/domain/guard";
import { AVAILABLE_ID, applyReserveOp, validateReserveWrite } from "@/domain/reserve";
import type { LedgerNode, LedgerState, PeriodKey } from "@/domain/types";

const P: PeriodKey[] = ["2026-05", "2026-06", "2026-07"];

const NODES: LedgerNode[] = [
  { id: "g-i", ownerId: "u", type: "income", level: "group", parentId: null, name: "Ingresos", icon: null, order: 0 },
  { id: "c-sueldo", ownerId: "u", type: "income", level: "category", parentId: "g-i", name: "Sueldo", icon: null, order: 1 },
  { id: "g-e", ownerId: "u", type: "expense", level: "group", parentId: null, name: "Gastos", icon: null, order: 2 },
  { id: "c-merc", ownerId: "u", type: "expense", level: "category", parentId: "g-e", name: "Mercado", icon: null, order: 3 },
  { id: "g-t", ownerId: "u", type: "transfer", level: "group", parentId: null, name: "Bolsillos", icon: null, order: 4 },
  { id: "A", ownerId: "u", type: "transfer", level: "category", parentId: "g-t", name: "Viaje", icon: null, order: 5 },
];

/** Estado con un ingreso y una reserva en 2026-06. Sin transfers extra: la aritmética queda a la vista. */
function st(ingreso: number, reserva: number, gasto = 0): LedgerState {
  return {
    ownerId: "u", nodes: NODES, budgets: {},
    actuals: {
      "c-sueldo": { "2026-06": ingreso },
      ...(gasto ? { "c-merc": { "2026-06": gasto } } : {}),
      "A": { "2026-06": reserva },
    },
    movements: [],
  };
}

describe("FR-2101 — el guardia rechaza lo que empeora, y solo eso", () => {
  it("TC-RES-010f: subir una reserva por encima del techo se rechaza", () => {
    // @aitri-tc TC-RES-010f
    const prev = st(1_000_000, 1_000_000);       // justo en el techo: exceso 0
    const next = st(1_000_000, 1_400_000);       // 400.000 de más
    const v = worsenedBy(prev, next, P);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: "techo", period: "2026-06" });
  });

  it("TC-RES-012h: una escritura de reserva que MEJORA un estado ya violado se acepta", () => {
    // @aitri-tc TC-RES-012h
    const prev = st(400_000, 1_000_000);         // exceso 600.000, alcanzado antes del guardia
    const next = st(400_000, 700_000);           // exceso 300.000 — mejora
    expect(worsenedBy(prev, next, P)).toEqual([]);
  });

  it("TC-RES-015e: un mes que la escritura ESTRENA también se juzga", () => {
    // @aitri-tc TC-RES-015e
    // Junio consume su propio ingreso, así que julio abre en 0 y no tiene flujo propio: cualquier
    // reserva que se estrene allí excede. (La primera versión de esta prueba usaba 900.000 contra
    // un arrastre de 1.000.000 — cabían, y la prueba no probaba nada.)
    const prev = st(1_000_000, 1_000_000);
    const next: LedgerState = {
      ...prev,
      actuals: { ...prev.actuals, A: { "2026-06": 1_000_000, "2026-07": 900_000 } },
    };
    const v = worsenedBy(prev, next, P);
    expect(v.map((x) => x.period)).toContain("2026-07");
  });

  it("TC-RES-013f: el veredicto sale del estado que se le pasa como previo, no de lo que nadie afirme", () => {
    // @aitri-tc TC-RES-013f
    // El servidor pasa SIEMPRE el estado leído de la base. Aquí se comprueba la propiedad que lo
    // hace útil: con el previo REAL rechaza, y un previo inventado —el que una petición mentirosa
    // querría usar— daría otro veredicto. Por eso el servidor nunca acepta el previo de la petición.
    // La mentira que serviría no es inflar el ingreso —el candidato lleva el suyo— sino afirmar
    // que la reserva YA ESTABA en 1.400.000: entonces la escritura no empeoraría nada.
    const real = st(1_000_000, 1_000_000);
    const mentira = st(1_000_000, 1_400_000);
    const next = st(1_000_000, 1_400_000);
    expect(worsenedBy(real, next, P)).toHaveLength(1);   // con el previo REAL, rechaza
    expect(worsenedBy(mentira, next, P)).toEqual([]);    // con el previo mentido, pasaría
    // Por eso el servidor NUNCA usa el previo que la petición declare: lo lee de la base.
  });
});

describe("FR-2101/ADR-20 — el acotamiento: solo se juzgan las escrituras de RESERVA", () => {
  it("TC-RES-033e: bajar un ingreso sin tocar reservas NO se juzga", () => {
    // @aitri-tc TC-RES-033e
    // Lo exige NFR-1803 de techo-de-flujo: «ninguna escritura de ingresos o gastos adquiere
    // validación nueva». El mes queda excedido y eso es CORRECTO — la marca lo señala, el guardia
    // no lo impide.
    const prev = st(1_000_000, 1_000_000);
    const next = st(400_000, 1_000_000);         // exceso 600.000, y aun así se acepta
    expect(worsenedBy(prev, next, P)).toEqual([]);
  });

  it("TC-RES-033e: subir un gasto sin tocar reservas tampoco se juzga", () => {
    // @aitri-tc TC-RES-033e
    const prev = st(1_000_000, 1_000_000);
    const next = st(1_000_000, 1_000_000, 700_000);
    expect(worsenedBy(prev, next, P)).toEqual([]);
  });

  it("TC-RES-033e: pero una escritura que toca ingreso Y reserva SÍ se juzga", () => {
    // @aitri-tc TC-RES-033e
    // Es el borde del acotamiento y tiene que quedar cerrado, o sería la puerta de escape: bastaría
    // acompañar cada subida de reserva con un cambio de ingreso para esquivar el guardia.
    const prev = st(1_000_000, 1_000_000);
    const next = st(400_000, 1_400_000);
    expect(worsenedBy(prev, next, P).length).toBeGreaterThan(0);
  });
});

describe("FR-2104 — nadie queda encerrado", () => {
  const violado = st(400_000, 1_000_000);        // exceso 600.000

  it("TC-RES-040h: bajar la reserva se acepta", () => {
    // @aitri-tc TC-RES-040h
    expect(worsenedBy(violado, st(400_000, 700_000), P)).toEqual([]);
  });

  it("TC-RES-041h: subir el ingreso se acepta", () => {
    // @aitri-tc TC-RES-041h
    expect(worsenedBy(violado, st(900_000, 1_000_000), P)).toEqual([]);
  });

  it("TC-RES-042f: subir aún más la reserva se rechaza", () => {
    // @aitri-tc TC-RES-042f
    expect(worsenedBy(violado, st(400_000, 1_500_000), P).length).toBeGreaterThan(0);
  });

  it("TC-RES-043e: PROPIEDAD — ningún estado generado queda sin salida", () => {
    // @aitri-tc TC-RES-043e
    // Se GENERAN estados violados en vez de escribir tres ejemplos: el riesgo aquí es el caso que
    // nadie imaginó, y un ejemplo solo cubre el que alguien recordó.
    const sinSalida: string[] = [];
    for (const ingreso of [0, 100_000, 400_000, 1_000_000]) {
      for (const reserva of [500_000, 1_000_000, 3_000_000]) {
        for (const gasto of [0, 300_000, 2_000_000]) {
          const s = st(ingreso, reserva, gasto);
          const salidas = [
            st(ingreso, Math.max(0, reserva - 100_000), gasto),   // reducir la reserva
            st(ingreso + 500_000, reserva, gasto),                // aumentar el ingreso
            st(ingreso, reserva, Math.max(0, gasto - 100_000)),   // reducir el gasto
          ];
          if (!salidas.some((out) => worsenedBy(s, out, P).length === 0)) {
            sinSalida.push(`${ingreso}/${reserva}/${gasto}`);
          }
        }
      }
    }
    expect(sinSalida).toEqual([]);
  });
});

describe("FR-2103 — una sola implementación de la regla", () => {
  it("TC-RES-030f: el guardia no calcula nada de la regla", () => {
    // @aitri-tc TC-RES-030f
    const src = readFileSync("src/domain/guard.ts", "utf8");
    const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // Ni aritmética del techo ni sus nombres: si aparecieran aquí, habría dos sitios que mantener.
    for (const prohibido of ["excess", "margin", "arrastre", "deficit", "techoScan", "reserveAportes"]) {
      expect(codigo, `${prohibido} no debe calcularse en el guardia`).not.toContain(prohibido);
    }
  });

  it("TC-RES-031f: no existe otra implementación del techo fuera del dominio de reservas", () => {
    // @aitri-tc TC-RES-031f
    // Se buscan DEFINICIONES, no usos: que `BalanceModule` importe `reserveAportes` para pintar es
    // exactamente lo correcto —una sola sede, muchos consumidores—. Lo que no puede existir es una
    // segunda función que calcule lo mismo.
    const hits = execSync(
      "grep -rln 'function techoScan\\|function reserveAportes\\|function chainCheck' src/ || true",
      { encoding: "utf8" }
    ).trim().split("\n").filter(Boolean);
    expect(hits).toEqual(["src/domain/reserve.ts"]);
  });

  it("TC-RES-032e: el cuerpo de chainCheck no cambió ni una línea", () => {
    // @aitri-tc TC-RES-032e
    const cuerpo = (src: string): string => {
      const i = src.indexOf("function chainCheck(");
      expect(i).toBeGreaterThan(-1);
      return src.slice(i, src.indexOf("\n}\n", i));
    };
    const actual = readFileSync("src/domain/reserve.ts", "utf8");
    const base = execSync("git show bfded04:src/domain/reserve.ts", { encoding: "utf8" });
    expect(cuerpo(actual)).toBe(cuerpo(base));
  });

  it("TC-RES-034h: el guardia y la validación del navegador dan el MISMO veredicto", () => {
    // @aitri-tc TC-RES-034h
    // Salen de la misma función, así que no pueden discrepar — y esto lo demuestra en vez de
    // afirmarlo, comparando los dos caminos sobre los mismos datos.
    for (const intento of [700_000, 1_000_000, 1_400_000, 3_000_000]) {
      const prev = st(1_000_000, 500_000);
      const navegador = validateReserveWrite(prev, { leafId: "A", period: "2026-06", plane: "actual", newAmount: intento }, P);
      const servidor = worsenedBy(prev, st(1_000_000, intento), P);
      expect(servidor.length === 0, `intento ${intento}`).toBe(navegador.ok);
    }
  });
});

describe("NFR-2102 — el alcance no se pasó de la raya", () => {
  it("TC-RES-212h: lo que aquellas 7 pruebas protegen sigue FUERA del alcance del guardia", () => {
    // @aitri-tc TC-RES-212h
    // Es el guardia contra esta misma feature. La primera versión juzgaba todo diff y ponía rojas
    // siete pruebas de dos features cerradas (TC-CPR-036h/040e/043f, TC-TDF-006e/050h/052e/222e):
    // todas dicen lo mismo desde ángulos distintos —bajar el ingreso, teclear gastos, operar a la
    // baja con el techo roto se ACEPTAN, la señal marca sin bloquear—. Lo que aquí se afirma es la
    // FRONTERA que las mantiene verdes: ninguna de esas escrituras entra en el veredicto del
    // guardia. Se comprueba en proceso, contra la función: esas 7 corren en esta misma pasada, y
    // relanzar la suite desde dentro de la suite no probaba nada que su propio exit code no diga ya.
    const casos: Array<{ que: string; prev: LedgerState; next: LedgerState }> = [
      // Bajar el ingreso deja el mes excedido, pero la escritura no es de reserva: no se juzga.
      { que: "bajar el ingreso (TC-CPR-040e/043f)", prev: st(1_000_000, 1_000_000), next: st(400_000, 1_000_000) },
      // Teclear un gasto, incluso sobregirando: tampoco toca reservas.
      { que: "teclear un gasto (TC-TDF-222e/006e)", prev: st(1_000_000, 1_000_000), next: st(1_000_000, 1_000_000, 5_000_000) },
      // Y desde un estado YA excedido, seguir operando a la baja sigue permitido.
      { que: "operar a la baja con el techo roto (TC-CPR-036h/TC-TDF-050h/052e)", prev: st(400_000, 1_000_000), next: st(400_000, 1_000_000, 200_000) },
    ];
    for (const { que, prev, next } of casos) {
      expect(worsenedBy(prev, next, P), `${que} NO puede entrar en el alcance del guardia`).toEqual([]);
    }
  });

  it("TC-RES-211f: el consumo del plano Ejecutado es el que fija el dominio — NETO desde FR-2801", () => {
    // @aitri-tc TC-RES-211f
    // REESCRITO el 2026-09-25 por retirar-para-gastar (FR-2801, ADR-03 de su TRD). Esta prueba fijaba
    // que el consumo de Ejecutado seguía siendo BRUTO (FR-1801) para vigilar que ESTA feature no lo
    // cambiara; esa promesa se cumplió. Lo cambió después el usuario, a propósito, en otra feature. Lo
    // que se conserva es lo que importa aquí: el guardia no tiene regla propia, hereda la del dominio.
    // Con ingreso 1.000.000, reserva 1.000.000 y un retiro de 500.000, el cupo SÍ se recarga en
    // 500.000: la celda admite 1.500.000 y ni un peso más.
    let s = st(1_000_000, 0);
    const ap = applyReserveOp(s, { from: AVAILABLE_ID, to: "A", period: "2026-06", amount: 1_000_000 }, P);
    expect("rejected" in ap).toBe(false);
    if ("rejected" in ap) return;
    const ret = applyReserveOp(ap.state, { from: "A", to: AVAILABLE_ID, period: "2026-06", amount: 500_000 }, P);
    expect("rejected" in ret).toBe(false);
    if ("rejected" in ret) return;
    s = ret.state;
    const cabe = validateReserveWrite(s, { leafId: "A", period: "2026-06", plane: "actual", newAmount: 1_500_000 }, P);
    expect(cabe.ok).toBe(true); // el retiro devolvió su cupo
    const unPesoMas = validateReserveWrite(s, { leafId: "A", period: "2026-06", plane: "actual", newAmount: 1_500_001 }, P);
    expect(unPesoMas).toMatchObject({ ok: false, rule: "techo", period: "2026-06", limit: 500_000 });
  });

  it("TC-RES-210f: el veredicto de las operaciones de reserva no cambia", () => {
    // @aitri-tc TC-RES-210f
    // Valores fijados a mano contra la regla, no leídos de la implementación.
    const prev = st(1_000_000, 0);
    const casos: [number, boolean][] = [[0, true], [500_000, true], [1_000_000, true], [1_000_001, false], [2_000_000, false]];
    for (const [monto, esperado] of casos) {
      const v = validateReserveWrite(prev, { leafId: "A", period: "2026-06", plane: "actual", newAmount: monto }, P);
      expect(v.ok, `reservar ${monto}`).toBe(esperado);
    }
  });
});

describe("NFR-2101/2104 — la suite y la convivencia de los dos guardias", () => {
  it("TC-RES-023e: con varias violaciones manda la de periodo más temprano", () => {
    // @aitri-tc TC-RES-023e
    // Julio queda excedido y septiembre en déficit. Lo que se informa es julio: arreglarlo es lo
    // que hace que septiembre sea siquiera alcanzable. Informar del segundo mandaría al usuario a
    // trabajar en algo que el primero seguiría bloqueando.
    const P4: PeriodKey[] = ["2026-06", "2026-07", "2026-08", "2026-09"];
    const base: LedgerState = {
      ownerId: "u", nodes: NODES, budgets: {},
      actuals: { "c-sueldo": { "2026-06": 1_000_000 }, A: { "2026-06": 1_000_000 } },
      movements: [],
    };
    const peor: LedgerState = {
      ...base,
      actuals: { ...base.actuals, A: { "2026-06": 1_000_000, "2026-07": 800_000, "2026-09": 900_000 } },
    };
    const v = worsenedBy(base, peor, P4);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].period).toBe("2026-07");
    // Y viene ordenado: ningún periodo posterior aparece antes que uno anterior.
    const orden = v.map((x) => P4.indexOf(x.period));
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("TC-RES-232f: los DOS guardias siguen vivos, y el del cierre va primero", () => {
    // @aitri-tc TC-RES-232f
    // El guardia nuevo se AÑADIÓ, no reemplazó nada. El orden lo fija ADR-19 y aquí se verifica por
    // posición en el código, no por confianza.
    const repo = readFileSync("src/server/data/ledgerRepo.ts", "utf8");
    const cierre = repo.indexOf("closedPeriodsViolated({");
    const dominio = repo.indexOf("worsenedBy(prev, state");
    expect(cierre, "el guardia del cierre sigue presente").toBeGreaterThan(-1);
    expect(dominio, "el guardia de dominio está presente").toBeGreaterThan(-1);
    expect(cierre, "el cierre se evalúa ANTES (ADR-19)").toBeLessThan(dominio);
  });

  it("TC-RES-201f: no crece el número de pruebas desactivadas", () => {
    // @aitri-tc TC-RES-201f
    // Misma semántica que el suelo que ya tenía el proyecto (TC-MAN-202f): frontera de palabra
    // —`skipIf` condicional no es una prueba apagada— y las líneas de comentario no cuentan. El
    // patrón se COMPONE en vez de escribirse literal: escrito entero, esta línea se acusaba a sí
    // misma y ponía en rojo el suelo del vecino, que es exactamente lo que pasaba hasta hoy.
    const marca = new RegExp(`\\b(describe|it|test)\\.(${["skip", "only", "todo"].join("|")})\\b`);
    const apagadas: string[] = [];
    for (const f of globSync("tests/**/*.{test,spec}.ts?(x)")) {
      readFileSync(f, "utf8").split("\n").forEach((linea, i) => {
        const t = linea.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        if (marca.test(linea)) apagadas.push(`${f}:${i + 1}`);
      });
    }
    // El suelo: ninguna. Si sube, alguien apagó una prueba para pasar.
    expect(apagadas, "pruebas desactivadas").toEqual([]);
  });

  it("TC-RES-200h: el guardia bloquea SOLO la reserva que empeora — tabla de verdad completa", () => {
    // @aitri-tc TC-RES-200h
    // Antes esta prueba relanzaba la suite entera y comprobaba que pasaba. No probaba nada: que la
    // suite pase lo dice el exit code del runner, que es lo que `aitri verify-run` lee. Lo que sí
    // hay que demostrar es la afirmación de la que colgaba —"el guardia no le añade validación
    // nueva a nada más"— y eso se afirma enumerándolo: de las seis escrituras posibles sobre este
    // estado, solo UNA puede quedar bloqueada. Si el alcance se ensancha, esta tabla se rompe.
    //
    // (La versión con subproceso, además, se lanzaba a sí misma: costó la máquina del desarrollador.
    //  Ninguna prueba vuelve a ejecutar la suite en la que vive.)
    const base = st(1_000_000, 500_000);           // dentro del techo, con margen
    const excedido = st(400_000, 1_000_000);       // ya violado ANTES de escribir
    const tabla: Array<{ que: string; prev: LedgerState; next: LedgerState; bloquea: boolean }> = [
      { que: "subir la reserva por encima del techo", prev: base, next: st(1_000_000, 1_400_000), bloquea: true },
      { que: "subir la reserva dentro del techo", prev: base, next: st(1_000_000, 800_000), bloquea: false },
      { que: "bajar la reserva", prev: base, next: st(1_000_000, 100_000), bloquea: false },
      { que: "subir el ingreso", prev: base, next: st(2_000_000, 500_000), bloquea: false },
      { que: "bajar el ingreso", prev: base, next: st(600_000, 500_000), bloquea: false },
      { que: "registrar un gasto", prev: base, next: st(1_000_000, 500_000, 300_000), bloquea: false },
      { que: "bajar la reserva desde un estado YA excedido", prev: excedido, next: st(400_000, 700_000), bloquea: false },
      { que: "subir la reserva desde un estado YA excedido", prev: excedido, next: st(400_000, 1_200_000), bloquea: true },
    ];
    for (const { que, prev, next, bloquea } of tabla) {
      expect(worsenedBy(prev, next, P).length > 0, que).toBe(bloquea);
    }
  });

  it("TC-RES-202e: las suites vecinas pasan SIN modificarse", () => {
    // @aitri-tc TC-RES-202e
    // Si alguna hubiera necesitado retoques, sería señal de que el guardia cambió comportamiento y
    // no solo quién lo hace cumplir.
    //
    // ANCLA AVANZADA de 396653e a 69d39c4 el 2026-09-05, a propósito y por una sola razón.
    //
    // Lo que tocó `techo-de-flujo.test.ts` entre 396653e y 69d39c4 NO fue esta feature acomodando
    // a un vecino para pasar. Fue BG-001 de techo-de-flujo: 17 de sus 79 casos declarados en la
    // fase 3 NUNCA se implementaron y la feature cerró 5/5 contándolos como «saltados», con
    // NFR-1807 llegando al sello con CERO pruebas. Lo que se añadió son esos casos que faltaban
    // —cuatro de ellos en este fichero: TC-TDF-082f, 232e, 233f y 252e—, no un retoque a los que
    // ya había: ni una sola aserción existente cambió. El guardia de esta feature no se tocó.
    //
    // La razón anterior, que sigue vigente por debajo del ancla nueva:
    // El ancla se AVANZA, no se borra: la alarma conserva todos los dientes a partir del punto
    // nuevo, y lo que queda por debajo es un cambio que ya está justificado por escrito.
    //
    // Lo que tocó `contrapartidas-reserva.test.ts` entre bfded04 y 396653e NO fue esta feature
    // acomodando a un vecino para pasar —que es justo lo que esta prueba existe para delatar—.
    // Fue BG-026, un defecto en cómo se MIDE el tiempo: los guardarraíles cronometran con
    // `performance.now()` contra un margen fijo, y bajo instrumentación de cobertura v8 cada rama
    // va envuelta para contarse, así que el cronómetro medía el coste de contar y no el del
    // algoritmo. El gate `coverage` fallaba AL AZAR —una aserción distinta en cada corrida— y lo
    // declaran `required` trece features más la raíz, así que bloqueaba `verify-complete` en
    // cualquiera de ellas.
    //
    // El único cambio bajo el ancla nueva es envolver TC-CPR-086e con `SALTAR_SI_INSTRUMENTADO`
    // (ver tests/helpers/perf.ts). Ni una línea de comportamiento: la corrida normal —la que Aitri
    // parsea para acreditar los TCs— no define `AITRI_COVERAGE`, así que ahí ese guardarraíl se
    // afirma exactamente igual que antes.
    //
    // ANCLA AVANZADA a c81f706 el 2026-09-08, y por una razon que NO es la que esta prueba vigila.
    // Lo que toco los ficheros vigilados fue BG-030: la guarda de tiempo de BG-026 resulto ser
    // ASIMETRICA. `CRONOMETRO_FIABLE` se apaga con AITRI_COVERAGE, que solo define la corrida
    // instrumentada; pero `aitri verify-run` lanza a la vez el runner normal (SIN la variable) y el
    // gate de cobertura (CON ella), y es la corrida NORMAL la que se queda sin CPU. Sus
    // guardarrailes se afirmaban contra margenes fijos mientras otra suite le competia: runner
    // exit 1 con CERO TCs en rojo, cuatro veces solo el 2026-09-08.
    //
    // El cambio es de MEDICION, no de comportamiento: cada asercion de tiempo pasa a medirse
    // MEJOR-DE-5 (`mejorDe`/`mejorTiempo` en tests/helpers/perf.ts) en vez de con un cronometro
    // suelto. El minimo es la pasada que menos CPU tuvo que compartir. Medido con seis carriles
    // compitiendo, sobre algo cuyo valor real es 1.02: la media simple se iba a 2.18 y el
    // mejor-de-5 dio 1.02 seis de seis.
    //
    // NO se relajo NADA — al contrario: con la medicion estable, el tope de TC-MAN-262e BAJO de x3
    // a x2. Ninguna asercion de comportamiento se toco. Verificado con la suite completa bajo OCHO
    // carriles de CPU y carga 7.24: cero fallos de cronometro.
    //
    // ANCLA AVANZADA a c11727b el 2026-09-08, y por una razon que NO es la que esta prueba vigila.
    // Lo que toco `contrapartidas-reserva.test.ts` y `techo-de-flujo.test.ts` fue BG-019, una
    // DECISION DEL USUARIO: una alcancia con dinero dentro ya no se puede borrar. Antes se borraba
    // y su saldo se descongelaba a Disponible sin un aviso (medido: reservado 500.000 -> 0,
    // disponible 4.500.000 -> 5.000.000). La razon que dio el usuario es la coherencia — la app ya
    // bloquea borrar una categoria con datos, y una alcancia con saldo era la misma situacion con
    // distinto comportamiento solo porque el dinero habia entrado por otra puerta.
    //
    // Cuatro TC aprobados cambian de VEREDICTO por esto, en tres features. NO se acomodaron para
    // que pasaran —que es justo lo que esta alarma existe para delatar—: se reescribieron
    // conservando su intencion y declarando por escrito que la decision cambio. TC-CPR-013f sigue
    // vigilando que borrar el destino no resucite el saldo del origen, solo que ahora vacia el
    // bolsillo por el camino legitimo primero.
    //
    // De paso se destapo algo que conviene no perder de vista: vaciar la CELDA de un bolsillo a 0
    // NO lo vacia — el mover que le dio el dinero se lo sigue acreditando. Medido: celda
    // `undefined` y balance 100.000 en los doce meses.
    //
    // ANCLA AVANZADA a a673f31 el 2026-09-09. Lo que toco los ficheros vigilados NO fue esta feature
    // ni ninguna vecina acomodandose: fue la tanda de bugs de dinero e infraestructura de ese dia.
    // BG-022 endurecio `parseAmount` (dejaba pasar "0x10" como 16 y "1e3" como 1000, guardando un
    // numero distinto del tecleado) y `setPlannedRetiro` (se tragaba la entrada invalida en silencio
    // y el store respondia ok:true). Ninguna asercion de comportamiento se relajo: TC-TRF4-015f, que
    // afirmaba el no-op mudo, pasa a afirmar MAS fuerte —el estado sigue intacto Y el llamante se
    // entera—, y se anadio un caso de regresion que fija que lo que una persona si escribe sigue
    // entrando. Ver el mensaje del commit.
    //
    // ANCLA AVANZADA a 0684671 el 2026-09-25. Lo que tocó `techo-de-flujo.test.ts` NO fue esta
    // feature ni un vecino acomodándose para pasar: fue la feature retirar-para-gastar, que por
    // decisión del usuario cambió la REGLA del techo de Ejecutado de consumo bruto a neto (FR-2801,
    // BL-037/BL-038). Tres TC de techo-de-flujo fijaban la regla vieja a propósito (TC-TDF-001h,
    // 002f, 072f) y se reescribieron conservando su id y su intención, con la razón escrita junto a
    // cada uno; TC-TDF-002f y 072f siguen afirmando el rechazo con el cupo agotado, sobre un estado
    // cuyo cupo está agotado de verdad. `contrapartidas-reserva.test.ts` no se tocó. El guardia de
    // esta feature tampoco: sigue delegando entero en `chainCheck`.
    //
    const tocadas = execSync(
      "git diff --name-only 0684671 -- tests/domain/techo-de-flujo.test.ts tests/domain/contrapartidas-reserva.test.ts || true",
      { encoding: "utf8" }
    ).trim();
    expect(tocadas).toBe("");
  });
});
