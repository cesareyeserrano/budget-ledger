import { cn } from "@/lib/utils";

interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Panel de superficie elevada compartido (ux-consistency FR-301/FR-308): --surface + hairline +
 * --shadow-sm, radio lg. Título de sección con rol .title-sm. Usado por el Dashboard.
 *
 * @aitri-trace FR-ID: FR-301, US-ID: US-301, AC-ID: AC-301, TC-ID: TC-UXC-301h
 */
export function Card({ title, children, className }: CardProps) {
  return (
    <div className={cn("elevated-sm rounded-(--radius-lg) border border-border bg-card px-4 py-3.5", className)}>
      {title && <div className="title-sm mb-3 text-fg">{title}</div>}
      {children}
    </div>
  );
}
