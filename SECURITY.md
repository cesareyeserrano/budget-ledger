# Política de seguridad

Ledger (T-Ledger) es una app web de finanzas personales. Aunque el repositorio es público, los
datos de cualquier despliegue son privados por definición, así que las vulnerabilidades se tratan
en serio.

## Versiones soportadas

| Versión       | Soportada |
| ------------- | --------- |
| 0.0.1-beta    | ✅        |
| < 0.0.1-beta  | ❌        |

El proyecto está en beta: solo la última versión recibe parches de seguridad.

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Los issues son visibles para todo el mundo y expondrían el fallo
antes de que exista un parche.

Usa una de estas dos vías:

1. **GitHub Security Advisories** (preferida) — pestaña **Security → Report a vulnerability** de
   este repositorio. El reporte es privado entre tú y el mantenedor, y permite coordinar el
   arreglo y el CVE en el mismo hilo.
2. **Email** — cesareyeserrano@gmail.com, con `[SECURITY]` en el asunto.

Incluye, en la medida de lo posible: versión afectada, pasos de reproducción, impacto esperado y
cualquier PoC. Un reporte reproducible se arregla mucho más rápido.

### Qué esperar

- **Acuse de recibo:** en 72 horas.
- **Evaluación inicial** (severidad + si es aceptado): en 7 días.
- **Arreglo:** las vulnerabilidades críticas y altas se priorizan sobre cualquier otro trabajo; el
  resto entra en el ciclo normal del pipeline.
- Se te dará crédito en el advisory salvo que prefieras permanecer anónimo.

## Alcance

**Dentro de alcance:** el código de la aplicación (`src/`), la capa de autenticación y sesión, la
API, las consultas a base de datos, el `Dockerfile` y los workflows de CI.

**Fuera de alcance:** vulnerabilidades que requieren acceso físico o de administrador a la máquina
donde corre la app; el fichero `docker-compose.dev.yml` y los valores de `Dockerfile` marcados como
placeholder — son credenciales throwaway de desarrollo/build (`dev-secret-not-for-production`,
`build-time-placeholder`), nunca valores de producción; resultados de escáneres automáticos sin un
impacto demostrado.

## Manejo de secretos

Este repositorio **no contiene ni ha contenido nunca secretos reales**. La configuración sensible se
inyecta por variables de entorno (`.env.local` en local — ignorado por git; variables del entorno de
ejecución en producción). `.env.example` documenta las claves necesarias, siempre con valores vacíos
o placeholders.

Tres controles lo sostienen:

- **`.gitignore`** cubre `.env`, `.env.local` y `.env.*.local`.
- **`scripts/secret-scan.sh`** corre en cada push y PR y falla el build ante un secreto hardcodeado
  (gitleaks si está disponible; si no, un fallback de patrones).
- **Secret scanning y push protection de GitHub** están activos: GitHub bloquea el push si detecta
  una credencial de un proveedor conocido.

Si detectas un secreto real filtrado en el historial, repórtalo por las vías de arriba **antes** de
abrir nada público.
