# Deployment — feature `recuperar-acceso`

Notas de despliegue **de esta feature**. El despliegue del producto vive en el `DEPLOYMENT.md` de la
raíz y no cambia: esta feature no añade proceso, servicio, base de datos ni contenedor.

> **Sin Dockerfile ni docker-compose propios, a propósito.** `02_SYSTEM_DESIGN.md#Deployment
> Architecture` declara el modelo *contenedorizado* y dice explícitamente «el mismo contenedor Docker
> que ya existe». Crear un `Dockerfile` dentro de la carpeta de la feature produciría un artefacto
> que nadie construye y que competiría con el real de la raíz. Lo mismo con `.env.example`: el
> canónico es el de la raíz, y ahí se añadieron las variables nuevas.

## Lo único que cambia en el despliegue: cinco variables

```bash
SMTP_HOST=          # p. ej. smtp.gmail.com
SMTP_PORT=          # 587 (STARTTLS) | 465 (TLS implícito)
SMTP_USER=
SMTP_PASSWORD=      # contraseña de APLICACIÓN, nunca la de la cuenta
SMTP_FROM=          # "Ledger <no-reply@tu-dominio>"
```

**Las cinco o ninguna.** Una configuración parcial cuenta como no configurada: es preferible a
descubrir el fallo a mitad de un envío, cuando alguien ya está bloqueado fuera.

**Ausentes, la app arranca igual** (NFR-510) y solo la recuperación queda apagada — la pantalla de
solicitud muestra su aviso y el endpoint responde `503`. Pero entonces **quien olvide su contraseña
no tiene camino de vuelta**, que es el problema entero que esta feature resuelve. Si el despliegue
tiene usuarios reales, configúralas.

Ninguna lleva `NEXT_PUBLIC_`. El gate `security-config` falla si alguna alcanza el bundle del cliente.

## Requisitos previos

- Un servidor SMTP alcanzable desde el contenedor de la app (salida al puerto correspondiente).
- Nada más: sin migraciones, sin tablas nuevas, sin volúmenes. El secreto de recuperación reutiliza
  la tabla `verification` que Better Auth ya tenía.

## Desarrollo local

```bash
npm run db:up      # Postgres
npm run mail:up    # Mailpit — SMTP en 1025, bandeja en http://localhost:8025
npm run dev        # http://localhost:3100
```

En `.env.local`:

```bash
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=dev
SMTP_PASSWORD=dev
SMTP_FROM="Ledger <no-reply@ledger.local>"
```

Los correos se quedan en la bandeja de Mailpit y no salen a Internet. Ambos puertos están atados a
loopback, igual que Postgres.

`npm run mail:down` lo detiene.

## Despliegue a producción

Idéntico al de siempre (ver `DEPLOYMENT.md` de la raíz): construir la imagen, `docker compose up -d`.
Lo único nuevo es exportar las cinco variables. El entrypoint sigue corriendo las migraciones
idempotentes antes de servir — esta feature no añade ninguna.

## Comprobar que funciona (tras desplegar)

1. `GET /health` → `200`. Debe seguir dándolo **aunque el SMTP esté caído**: la disponibilidad de la
   app no depende del correo (NFR-1309).
2. Desde la pantalla de acceso, «¿Olvidaste tu contraseña?» → escribir una dirección **registrada** →
   «Enviar enlace».
3. Interpretar la respuesta:

   | Código | Qué significa | Qué hacer |
   |---|---|---|
   | `200` | Enviado (o la cuenta no existe — el acuse es el mismo a propósito) | Revisar el buzón |
   | `502` | El servidor SMTP no responde | Mirar el log: lleva el motivo técnico (`ECONNREFUSED`, timeout…) |
   | `503` | Faltan variables SMTP | Completar las cinco y reiniciar |

4. Abrir el enlace del correo, fijar una contraseña y entrar con ella.

**El acuse es idéntico exista o no la cuenta** (FR-1303). No es un fallo: impide averiguar qué
direcciones están registradas probándolas. Para comprobar un envío real usa una cuenta que exista.

## Rollback

Esta feature es **aditiva y sin estado propio**, así que el rollback es el estándar del proyecto:
volver a la imagen anterior.

- **No hay migraciones que revertir.** Ninguna tabla se creó ni se alteró.
- **Los secretos emitidos quedan huérfanos y caducan solos** a los 30 minutos. Ninguna limpieza
  manual es necesaria; si prefieres invalidarlos al instante:
  ```sql
  DELETE FROM verification WHERE identifier LIKE 'reset-password:%';
  ```
- **Las contraseñas ya recuperadas siguen siendo válidas**: se guardaron con el mismo argon2id que
  el registro. Volver atrás no deja a nadie fuera.
- **Para apagar solo la recuperación sin desplegar nada**: retira las variables SMTP y reinicia. La
  app sigue funcionando y el flujo responde `503`. Es el interruptor más rápido si el correo se
  convierte en un problema.

## Health checks

| Endpoint | Espera | Nota |
|---|---|---|
| `GET /health` | `200` | No depende del SMTP (NFR-1309) — verificado por TC-REC-225h/226e |
| `GET /` | `<500` | Sirve el formulario de acceso aunque el correo esté caído |
| `POST /api/v1/recovery/request` | `200` / `502` / `503` | Ver la tabla de arriba |

## Observabilidad

Cada petición al endpoint deja su línea con el formato del proyecto:

```
[2026-08-14T20:28:05.783Z] POST /api/v1/recovery/request 200 (19ms) rid=00w5
```

Un fallo de envío añade el motivo técnico con prefijo `[mail]`. **El secreto y la contraseña nunca
se registran** — verificado por TC-REC-217e y TC-REC-221f.

## Integración continua

`.github/workflows/ci.yml` no necesita cambios estructurales: la suite e2e y la de integración
levantan Postgres **y** Mailpit por testcontainers, usando el Docker del runner (el mismo mecanismo
con el que ya se levantaba Postgres). Se documentó en el propio workflow para que quien lo lea sepa
que ahí hay un servidor SMTP real.
