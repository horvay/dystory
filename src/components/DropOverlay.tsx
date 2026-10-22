import { Upload } from "lucide-react";

/** Full-window hint while files are dragged over a page that takes them. */
export function DropOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-accent/10 p-6 backdrop-blur-[2px]">
      <div className="rounded-3xl border-2 border-dashed border-accent bg-surface px-10 py-8 text-center shadow-float">
        <Upload size={28} className="mx-auto text-accent" />
        <p className="mt-3 font-semibold">{label}</p>
      </div>
    </div>
  );
}
