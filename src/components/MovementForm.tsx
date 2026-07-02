"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowLeftRight } from "lucide-react";
import { useLedgerStore } from "@/state/store";
import type { NodeType } from "@/domain/types";
import { MONTHS } from "@/domain/months";
import { canSave, signOf } from "@/domain";
import { typeColorVar } from "./format";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";

const TYPES: { id: NodeType; label: string; Icon: typeof ArrowDown }[] = [
  { id: "expense", label: "Gasto", Icon: ArrowDown },
  { id: "income", label: "Ingreso", Icon: ArrowUp },
  { id: "transfer", label: "Transferencia", Icon: ArrowLeftRight },
];

function currentMonthKey() {
  return MONTHS[new Date().getMonth()]?.k ?? "ene";
}

/** FR-001 — módulo de registro. Única vista en móvil; panel en escritorio. Input estándar (sin teclado numérico). */
export function MovementForm({ variant = "screen" }: { variant?: "screen" | "panel" }) {
  const data = useLedgerStore((s) => s.data);
  const add = useLedgerStore((s) => s.addMovement);
  const showToast = useLedgerStore((s) => s.showToast);

  const [type, setType] = useState<NodeType>("expense");
  const [catId, setCatId] = useState<string>("");
  const [subId, setSubId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [month, setMonth] = useState(currentMonthKey);

  const categories = useMemo(
    () => data.nodes.filter((n) => n.type === type && n.level === "category" && !n.system).sort((a, b) => a.order - b.order),
    [data.nodes, type]
  );
  const effectiveCat = catId || categories[0]?.id || "";
  const subs = useMemo(
    () => (effectiveCat ? data.nodes.filter((n) => n.parentId === effectiveCat && n.level === "sub") : []),
    [data.nodes, effectiveCat]
  );

  const enabled = canSave({ amount, catId: effectiveCat || null });
  const color = typeColorVar(type);

  function onSave() {
    if (!enabled) return;
    add({ type, catId: effectiveCat, subId: subId || null, amount, month });
    setAmount("");
    setSubId("");
    showToast("Movimiento guardado");
  }

  return (
    <div style={{ animation: "mvScreenIn 0.26s ease" }}>
      {variant === "panel" ? (
        <div className="mb-3.5">
          <div className="text-[0.58rem] text-fg-muted tracking-[0.12em] mb-2">MONTO · COP</div>
          <div className="flex items-center gap-2 bg-elevated rounded-[--radius-sm] px-3.5 py-3" style={{ borderBottom: `2px solid ${color}`, border: "1px solid var(--border)", borderBottomColor: color, borderBottomWidth: 2 }}>
            <span className="text-[1.6rem] font-light" style={{ color }}>{signOf(type)}</span>
            <input aria-label="Monto" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" className="flex-1 min-w-0 bg-transparent border-0 text-fg text-[1.6rem] font-light outline-none" />
          </div>
        </div>
      ) : (
        <div className="text-center pt-3.5 pb-4">
          <div className="text-[0.6rem] text-fg-muted tracking-[0.14em] mb-2.5">MONTO · COP</div>
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-[1.8rem] font-light" style={{ color }}>{signOf(type)}</span>
            <input aria-label="Monto" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" className="w-[200px] bg-transparent border-0 text-fg text-[3rem] font-light tracking-[-0.04em] text-center outline-none" style={{ borderBottom: `2px solid ${color}` }} />
          </div>
        </div>
      )}

      <ToggleGroup
        type="single"
        value={type}
        onValueChange={(v) => { if (v) { setType(v as NodeType); setCatId(""); setSubId(""); } }}
        className="flex gap-1.5 mb-3.5"
      >
        {TYPES.map((t) => (
          <ToggleGroupItem key={t.id} value={t.id} aria-label={t.label} activeColor={typeColorVar(t.id)}>
            <t.Icon size={15} /> {t.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Field label="CATEGORÍA">
        <Select value={effectiveCat} onValueChange={(v) => { setCatId(v); setSubId(""); }}>
          <SelectTrigger aria-label="Categoría"><SelectValue placeholder="— crea una categoría —" /></SelectTrigger>
          <SelectContent>
            {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      {subs.length > 0 && (
        <Field label="SUBCATEGORÍA">
          <Select value={subId || "__none"} onValueChange={(v) => setSubId(v === "__none" ? "" : v)}>
            <SelectTrigger aria-label="Subcategoría"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">— Sin subcategoría —</SelectItem>
              {subs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field label="MES">
        <Select value={month} onValueChange={(v) => setMonth(v as typeof month)}>
          <SelectTrigger aria-label="Mes"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m) => <SelectItem key={m.k} value={m.k}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Button
        onClick={onSave}
        disabled={!enabled}
        className="w-full mt-2 h-11 border"
        style={enabled ? { borderColor: color, background: `color-mix(in srgb, ${color} 16%, transparent)`, color } : undefined}
      >
        {variant === "panel" ? "Registrar movimiento" : "Guardar movimiento"}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <div className="text-[0.58rem] text-fg-muted tracking-[0.12em] mb-2.5">{label}</div>
      {children}
    </div>
  );
}
