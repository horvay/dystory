import { useMutation } from "convex/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { COLORS, useMe } from "../lib/identity";
import { cn, useTheme } from "../lib/hooks";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";

const THEMES = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
] as const;

export function ProfileDialog({ onClose, onSwitchUser }: { onClose: () => void; onSwitchUser: () => void }) {
  const me = useMe();
  const update = useMutation(api.users.update);
  const [name, setName] = useState(me.name);
  const [color, setColor] = useState(me.color);
  const [theme, setTheme] = useTheme();
  return (
    <Modal onClose={onClose} className="max-w-sm">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await update({ userId: me._id, name, color });
          onClose();
        }}
        className="p-5"
      >
        <h2 className="mb-4 font-semibold">Your profile</h2>
        <div className="flex items-center gap-3">
          <Avatar name={name || "?"} color={color} size={40} />
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Your name"
            className="h-10 flex-1 rounded-xl border border-line bg-bg px-3 outline-none focus:border-accent"
          />
        </div>
        <div className="mt-4 grid grid-cols-10 gap-1.5">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
              className={cn(
                "aspect-square rounded-full",
                c === color && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
              )}
              style={{ background: c }}
            />
          ))}
        </div>

        <div className="mt-5 text-xs font-medium text-muted">Appearance</div>
        <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
          {THEMES.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => setTheme(t.id)}
              aria-pressed={theme === t.id}
              className={cn(
                "flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium",
                theme === t.id ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink",
              )}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onSwitchUser}
            className="mr-auto h-9 rounded-xl px-2 text-sm text-muted hover:bg-surface-2 hover:text-ink"
          >
            Switch person…
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-4 text-sm hover:bg-surface-2">
            Cancel
          </button>
          <button className="h-9 rounded-xl bg-ink px-4 text-sm font-medium text-bg">Save</button>
        </div>
      </form>
    </Modal>
  );
}
