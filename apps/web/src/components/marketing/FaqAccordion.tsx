import clsx from "clsx";
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import type { FaqContext, FaqItem } from "../../content/faq";

/**
 * Accessible accordion: each question is a real <button> inside a heading, with aria-expanded and
 * aria-controls pointing at a labelled region. Several answers can be open at once.
 */
export function FaqAccordion({ items, ctx, defaultOpen }: { items: FaqItem[]; ctx: FaqContext; defaultOpen?: string }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpen ? [defaultOpen] : []));
  const base = useId();
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
      {items.map((item, i) => {
        const isOpen = open.has(item.id);
        const btnId = `${base}-q-${item.id}`;
        const panelId = `${base}-a-${item.id}`;
        return (
          <div key={item.id}>
            <h3 className="m-0">
              <button
                id={btnId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                className="group flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-surface-2/60 sm:px-6"
              >
                <span aria-hidden className="hidden w-7 shrink-0 font-mono text-xs text-muted sm:block">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1 text-base font-semibold text-ink">{item.question}</span>
                <span
                  aria-hidden
                  className={clsx(
                    "grid size-8 shrink-0 place-items-center rounded-full border transition-[transform,background-color,border-color]",
                    isOpen ? "rotate-45 border-accent bg-accent text-accent-ink" : "border-line text-ink",
                  )}
                >
                  <Plus className="size-4" />
                </span>
              </button>
            </h3>
            <div id={panelId} role="region" aria-labelledby={btnId} hidden={!isOpen} className="px-5 pb-6 sm:pl-[4.25rem] sm:pr-16">
              {item.answer(ctx).map((p) => (
                <p key={p} className="mt-2 max-w-3xl text-[15px] leading-relaxed text-muted first:mt-0">
                  {p}
                </p>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
