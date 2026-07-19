# BUILD_PLAN — Feature control-size-scale (Fase 4)

Plan generado: fresh (fases 1–3 aprobadas, sin re-open upstream).

Escala canónica de altura de control: 3 tokens CSS (`--control-sm`=32 / `--control-md`=40 /
`--control-lg`=48) como única fuente de verdad, y re-mapeo de cada control a su token. Solo altura;
color/tipo/radio/comportamiento intactos. Es un incremento de un solo epic.

## EP-01 — Escala de altura + mapeo de controles
- **Delivers:** US-801 (escala única), US-802 (cada control a su token)
- **Makes pass:** TC-801h, TC-801e, TC-801f, TC-802h, TC-802e, TC-802f, TC-851h, TC-851e, TC-851f,
  TC-852h, TC-852e, TC-852f, TC-853h, TC-853e, TC-853f, TC-855h, TC-855e, TC-855f
- **Why here:** slice única — no hay dependencias internas; primero se definen los tokens
  (`globals.css`), luego los consumen los componentes de control.
- **Estado:** done — tokens en globals.css + mapeo de button/tabs/select/ThemeToggle/registro.
  Makes-pass verdes: 15 e2e de control-size-scale (TC-801/802/851/852/853 × h/e/f) + 3 manuales
  (TC-855x). Regresión verificada: feature-stack + ux-consistency (94 e2e) verdes, incl.
  TC-UXC-353e (registro ≥48). typecheck + lint limpios.

### Pasos dentro del epic
1. **Skeleton — tokens.** `globals.css`: declarar `--control-sm/-md/-lg = 32/40/48px` en `:root`
   (+ 3 clases utilitarias `.control-sm/.control-md/.control-lg` que fijan `height`).
2. **Integración — mapeo de componentes.**
   - `ui/button.tsx`: variante `sm`/`icon` → sm; `default` → md (retira h-8=32 sólo donde aplica, h-9=36→md).
   - `ui/tabs.tsx`: `TabsTrigger` → sm (32, altura fija en vez de py-1.5).
   - `ui/select.tsx`: `SelectTrigger` → md (40).
   - `ThemeToggle` → md (40, baja de 44).
   - `register/*` (TypeToggle, tiles, date-field, Guardar): confirmar/expresar lg (48) vía token.
3. **Hardening — tests.** Escribir `tests/e2e/control-size-scale.spec.ts` (mide alturas con
   boundingBox + lee tokens de :root) y correr los TC del epic. Los TC-855x son manuales
   (inspección del diff: sin /api, sin esquema, sin deps).

## Cobertura de TCs
18 TCs, todos en EP-01: 6 FR (801/802 × h/e/f) + 9 NFR e2e (851/852/853 × h/e/f) + 3 NFR-805 manual.

## Riesgos (del diseño)
- Test que codifica altura vieja (30/36/44): verificado — NINGÚN test existente lo hace; los asserts
  de altura actuales (TC-SUT-252f, TC-UXC-353e) piden ≥48 en registro, que la escala mantiene.
- Control omitido del re-mapeo: lo cubre TC-801e/TC-802f (auditoría de que nada cae fuera de {32,40,48}
  ni en 30/36/44).

## Regresión a vigilar
Suites existentes verdes: registro (feature-stack), ux-consistency (contraste/scroll/tamaños),
budget-state-color (código de estado), grilla, reparent/promote/demote.
