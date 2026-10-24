import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { COLORS } from "../lib/identity";
import { cn } from "../lib/hooks";
import { Avatar } from "./Avatar";

export function Onboarding({ onDone }: { onDone: (userId: string) => void }) {
  const users = useQuery(api.users.people);
  const create = useMutation(api.users.create);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  // Default to the first color nobody uses yet (skipping the neutral gray).
  const color =
    picked ?? COLORS.slice(0, -1).find((c) => !users?.some((u) => u.color === c)) ?? COLORS[0]!;
  const setColor = setPicked;
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // Only grab focus when there's nobody to "continue as".
  useEffect(() => {
    if (users?.length === 0) nameRef.current?.focus();
  }, [users?.length]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      onDone(await create({ name, color }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img src="/icon.svg" alt="" className="mx-auto mb-4 size-12 rounded-2xl shadow-soft" />
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Dynastory</h1>
          <p className="mt-1 text-muted">Write a story together, then watch it become a video.</p>
        </div>

        {users && users.length > 0 && (
          <div className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-soft">
            <p className="mb-3 text-sm font-medium text-ink-2">Continue as</p>
            <div className="flex flex-wrap gap-2">
              {users.map((u) => (
                <button
                  key={u._id}
                  onClick={() => onDone(u._id)}
                  className="flex items-center gap-2 rounded-full border border-line py-1 pr-3.5 pl-1 text-sm font-medium transition hover:border-line-strong hover:bg-surface-2"
                >
                  <Avatar name={u.name} color={u.color} size={26} />
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
          <p className="mb-3 text-sm font-medium text-ink-2">
            {users?.length ? "Or join as someone new" : "What should we call you?"}
          </p>
          <div className="flex items-center gap-3">
            <Avatar name={name || "?"} color={color} size={40} />
            <input
              ref={nameRef}
              value={name}
              aria-label="Your name"
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="h-11 flex-1 rounded-xl border border-line bg-bg px-3.5 text-base outline-none focus:border-accent"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                className={cn(
                  "size-8 rounded-full transition",
                  c === color ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : "hover:scale-110",
                )}
                style={{ background: c }}
              />
            ))}
          </div>
          <button
            disabled={!name.trim() || busy}
            className="mt-5 h-11 w-full rounded-xl bg-ink font-medium text-bg transition hover:opacity-90 disabled:opacity-40"
          >
            Start writing
          </button>
        </form>
      </div>
    </div>
  );
}
