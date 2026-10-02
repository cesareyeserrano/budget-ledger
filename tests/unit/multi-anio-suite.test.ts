// Feature multi-anio — NFR-1901: adaptar la suite NO es desactivarla.
// TC: TC-MAN-202f
import { describe, it, expect } from "vitest";
import { pruebasApagadas } from "../helpers/pruebasApagadas";

describe("NFR-1901 · ninguna prueba quedó desactivada al migrar", () => {
  it("TC-MAN-202f: no existe ni un `skip`, `only` o `todo` en toda la suite", () => {
    // La migración tocó 43 ficheros de prueba. La tentación al adaptar en masa es marcar como
    // saltada la que estorba, y eso deja la suite verde mintiendo. Se comprueba mecánicamente.
    // BL-073: el detector es el compartido, que ve también los saltos condicionales y «fixme».
    const ofensas = pruebasApagadas();
    expect(ofensas, `pruebas desactivadas:\n${ofensas.join("\n")}`).toEqual([]);
  });
});
