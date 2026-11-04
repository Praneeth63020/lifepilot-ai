import clsx from "clsx";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: "info" | "success" | "error";
  actions?: { label: string; onClick: () => void }[];
}
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++seq;
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      if (!t.actions?.length) setTimeout(() => dismiss(id), t.tone === "error" ? 7000 : 4000);
    },
    [dismiss],
  );
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={clsx(
              "fade-in pointer-events-auto w-full max-w-sm rounded-xl border bg-surface p-3 shadow-lg",
              t.tone === "error" ? "border-danger/40" : t.tone === "success" ? "border-ok/40" : "border-line",
            )}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <p className="text-sm font-medium">{t.title}</p>
                {t.body && <p className="mt-0.5 text-sm text-muted">{t.body}</p>}
                {t.actions && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {t.actions.map((a) => (
                      <button
                        key={a.label}
                        className="rounded-md border border-line px-2 py-1 text-xs font-medium hover:bg-surface-2"
                        onClick={() => {
                          a.onClick();
                          dismiss(t.id);
                        }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-muted hover:text-ink">
                <X className="size-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
