"use client";

import { useLedgerStore } from "@/state/store";
import { HORIZONS } from "@/domain/range";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/**
 * Elige el horizonte de planeación: 1 o 2 AÑOS COMPLETOS hacia adelante (FR-1904).
 *
 * Por qué existe este componente y por qué está AQUÍ. El horizonte era la única cosa que el usuario
 * pidió «a elección de usuario» y que no podía elegir: la maquinaria estaba completa —dominio
 * (`activeRange`), estado (`setHorizon`), endpoint (`/api/v1/preferences/horizon`) y persistencia
 * por cuenta— pero ningún componente llamaba al setter, así que todo el mundo se quedaba en el
 * defecto de 2 años. Lo detectó la auditoría de requisitos del 2026-09-03 (GAP-1): FR-1907 difería
 * el control a la página de Configuración y el `no_go_zone` difería Configuración al punto 4 del
 * orden acordado, de modo que la capacidad no la reclamaba ninguna de las dos features.
 *
 * Su sitio es PROVISIONAL y está escrito así a propósito: acompaña al `ThemeToggle` porque es donde
 * hoy vive lo configurable, y se muda a Configuración cuando esa página exista — que es literalmente
 * lo que FR-1907 dice que debe pasar. No se crea aquí una página de ajustes.
 *
 * SU SITIO DEFINITIVO ES CONFIGURACIÓN, y ya está ahí (FR-2204, 2026-09-07). La nota anterior
 * decía que su lugar en la cabecera era provisional «hasta que exista la página de Configuración»;
 * esa página existe, así que se mudó y se retiró de `DesktopShell`. Queda un solo control por
 * ajuste, que es lo que FR-1907 difería.
 *
 * `mostrarRotulo` existe por esa mudanza: en la cabecera el rótulo iba DENTRO del componente porque
 * «2 años» a solas no dice de qué; en un formulario la etiqueta la pone la página, junto a las de
 * los demás ajustes, y repetirla sería ruido. El control en sí no cambia.
 *
 * @aitri-trace FR-ID: FR-1904, FR-1907
 */
export function HorizonSelect({ mostrarRotulo = true }: { mostrarRotulo?: boolean }) {
  const horizon = useLedgerStore((s) => s.horizon);
  const setHorizon = useLedgerStore((s) => s.setHorizon);

  return (
    <div className="flex items-center gap-2">
      {mostrarRotulo && (
        <span className="caption text-fg-muted whitespace-nowrap">Horizonte</span>
      )}
      <div className="w-[160px]">
        <Select value={String(horizon)} onValueChange={(v) => setHorizon(Number(v))}>
          <SelectTrigger
            aria-label="Horizonte de planeación"
            data-testid="horizon-select"
            className="py-1 label"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HORIZONS.map((h) => (
              <SelectItem key={h} value={String(h)}>
                {h === 1 ? "1 año" : `${h} años`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
