// @aitri-trace components:mobile:buttonStyles — feature gestion-movil (FR-3210).
//
// Módulo:       src/components/mobile/buttonStyles.ts
// Propósito:    Las clases del botón principal (relleno neutro) de las pantallas de gestión del
//               teléfono, en un solo lugar. Es la misma construcción que usan los formularios de
//               acceso; no añade un token.
// Dependencias: ninguna.

/** Botón principal: relleno `--primary` con su texto. Va sobre `ui/button`, a 48 px de alto. */
export const PRIMARY_BUTTON = "h-(--control-lg) border-primary bg-primary text-(--primary-foreground) hover:border-primary";
