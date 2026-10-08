import { useState, type ReactNode } from "react";
import { IconChevron } from "../Icons";

interface SectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function Section({ title, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section${open ? " open" : ""}`}>
      <button type="button" className="section-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <IconChevron />
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
