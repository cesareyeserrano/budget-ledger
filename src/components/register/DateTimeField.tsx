"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { CalendarClock } from "lucide-react";
import { dateLabel, isValidDate } from "@/lib/date";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

// Carga diferida: el calendario solo entra al bundle cuando se abre el picker (FR-210, perf).
const DateCalendar = dynamic(() => import("./DateCalendar"), {
  ssr: false,
  loading: () => (
    <div data-testid="calendar-loading" className="p-4 text-sm text-fg-muted">
      Cargando calendario…
    </div>
  ),
});

interface Props {
  value: string; // datetime-local "YYYY-MM-DDTHH:mm"
  onChange: (value: string) => void;
}

function toDate(value: string): Date | undefined {
  return isValidDate(value) ? new Date(value) : undefined;
}

/** Construye "YYYY-MM-DDTHH:mm" con el día elegido y la hora actual del value. */
function withDay(day: Date, current: string): string {
  const base = toDate(current) ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}` +
    `T${pad(base.getHours())}:${pad(base.getMinutes())}`
  );
}

/**
 * Campo de fecha: muestra "Hoy" por defecto (o la fecha); abre un Popover (shadcn/Radix, FR-310) con
 * el calendario para cambiar el día — foco/Escape/click-fuera los gestiona Radix. La hora se conserva
 * pero NUNCA se muestra (FR-210). Superficie/borde/radio por token, coherente con el chrome (FR-307).
 *
 * @aitri-trace FR-ID: FR-310, US-ID: US-310, AC-ID: AC-310, TC-ID: TC-UXC-310h
 */
export function DateTimeField({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="label text-fg-secondary">Fecha</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="date-field"
            aria-haspopup="dialog"
            className="flex min-h-[48px] w-full items-center gap-2 rounded-(--radius-md) border border-border bg-card px-3 py-3 text-left outline-none focus-visible:border-accent data-[state=open]:border-accent"
          >
            <CalendarClock className="h-4 w-4 text-fg-secondary" strokeWidth={1.5} aria-hidden />
            <span data-testid="date-label" className="flex-1 text-sm text-fg-secondary">
              {dateLabel(value)}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          role="dialog"
          aria-label="Elegir fecha"
          data-testid="date-popover"
          className="rdp-root w-max max-w-[calc(100vw-2rem)]"
        >
          <DateCalendar
            selected={toDate(value)}
            onSelect={(day) => {
              if (day) {
                onChange(withDay(day, value));
                setOpen(false);
              }
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
