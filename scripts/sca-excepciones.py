#!/usr/bin/env python3
"""Excepciones CON NOMBRE Y FECHA del gate de dependencias (RQ-SEC-005 / NFR-513).

Módulo:       scripts/sca-excepciones.py
Propósito:    Decide si un `npm audit` en rojo puede pasar. Solo pasa cuando CADA aviso alto o crítico
              está en la tabla de abajo, su excepción no ha vencido y el aviso NO alcanza a las
              dependencias de producción. Cualquier otro aviso, una excepción vencida o un aviso que
              llegue a producción lo dejan en rojo.
Dependencias: python3 y npm. Lo llaman scripts/security-config.sh y el job de seguridad del CI,
              DESPUÉS de que `npm audit --audit-level=high` haya salido distinto de cero.

POR QUÉ EXISTE (BG-091, 2026-10-04). Se publicó GHSA-vfj7-8cjw-p6xm sobre `braces`, que solo llega al
proyecto por el linter (eslint-config-next → fast-glob → micromatch → braces). No hay versión corregida y
el único «arreglo» de npm es bajar el linter a una versión mayor anterior. El gate caía, y con él toda
verificación, por una herramienta que no viaja en la app. La salida fácil —auditar solo producción, o un
`|| true`— apagaría el gate para siempre; una excepción con nombre y fecha no.

CÓMO SE RETIRA. Cuando salga la versión corregida: subir la dependencia, comprobar que
`npm audit --audit-level=high` pasa solo y BORRAR la fila. Si la fecha llega antes, el gate vuelve a caer
a propósito: hay que mirar de nuevo, no prorrogar por inercia.
"""
import datetime
import json
import subprocess
import sys

# id del aviso · fecha en que la excepción deja de valer (AAAA-MM-DD) · por qué se aceptó.
EXCEPCIONES = [
    {
        "id": "GHSA-vfj7-8cjw-p6xm",
        "vence": "2026-11-03",
        "motivo": "braces: solo dependencias de desarrollo (linter); sin versión corregida al 2026-10-04 (BG-091)",
    },
]
GRAVES = {"high", "critical"}


def avisos_graves(extra):
    """Los avisos altos o críticos que reporta `npm audit`, por id.

    Args:
        extra: argumentos adicionales para `npm audit` (p. ej. ["--omit=dev"]).
    Returns:
        dict id → severidad. Vacío si no hay ninguno.
    Raises:
        SystemExit: si npm no devuelve un informe legible (un escaneo que no corre no acredita nada).
    """
    out = subprocess.run(["npm", "audit", "--json", *extra], capture_output=True, text=True).stdout
    try:
        informe = json.loads(out)
    except json.JSONDecodeError:
        print("   · npm audit no devolvió un informe legible: el escaneo NO SE EJECUTÓ (esto no es un hallazgo)")
        sys.exit(1)
    encontrados = {}
    for paquete in informe.get("vulnerabilities", {}).values():
        for via in paquete.get("via", []):
            if isinstance(via, dict) and via.get("severity") in GRAVES:
                ident = str(via.get("url", "")).rstrip("/").split("/")[-1] or str(via.get("source"))
                encontrados[ident] = via["severity"]
    return encontrados


def main():
    """Sale con 0 solo si todo aviso grave está exceptuado, vigente y fuera de producción.

    Returns:
        Código de salida: 0 pasa, 1 falla.
    """
    hoy = datetime.date.today()
    vigentes = {e["id"]: e for e in EXCEPCIONES}
    todos = avisos_graves([])
    produccion = avisos_graves(["--omit=dev"])
    fallos = []
    for ident, sev in sorted(todos.items()):
        exc = vigentes.get(ident)
        if not exc:
            fallos.append(f"{ident} ({sev}): sin excepción — hay que subir la dependencia")
        elif datetime.date.fromisoformat(exc["vence"]) < hoy:
            fallos.append(f"{ident} ({sev}): la excepción venció el {exc['vence']} — revisar de nuevo, no prorrogar por inercia")
        elif ident in produccion:
            fallos.append(f"{ident} ({sev}): alcanza a las dependencias de PRODUCCIÓN — la excepción solo cubre las de desarrollo")
    if fallos:
        for f in fallos:
            print(f"   · {f}")
        return 1
    for ident in sorted(todos):
        exc = vigentes[ident]
        print(f"   · aceptado hasta {exc['vence']}: {ident} — {exc['motivo']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
