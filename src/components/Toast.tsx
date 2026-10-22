import { X } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Toast = {
  id: number;
  message: ReactNode;
  action?: { label: string; run: () => void };
};

type ShowToast = (t: Omit<Toast, "id">, ms?: number) => void;

const Ctx = createContext<ShowToast>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const show = useCallback<ShowToast>(
    (t, ms = 6000) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[90] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="toast-in pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-ink py-2 pr-2 pl-4 text-sm text-bg shadow-float"
          >
            <span className="min-w-0 truncate">{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
                className="shrink-0 rounded-lg px-2.5 py-1 font-semibold hover:bg-bg/15"
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="grid size-7 shrink-0 place-items-center rounded-lg opacity-70 hover:bg-bg/15 hover:opacity-100"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
