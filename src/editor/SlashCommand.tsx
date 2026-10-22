import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { BLOCKS, type BlockItem } from "./blocks";
import { cn } from "../lib/hooks";

type ListProps = { items: BlockItem[]; command: (item: BlockItem) => void };
type ListHandle = { onKeyDown: (e: KeyboardEvent) => boolean };

const SlashList = forwardRef<ListHandle, ListProps>(({ items, command }, ref) => {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setIndex(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!items.length) return false;
      if (e.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        setIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        command(items[index]!);
        return true;
      }
      return false;
    },
  }));

  if (!items.length) return null;
  return (
    <div
      ref={listRef}
      className="scroll-thin max-h-80 w-64 overflow-y-auto rounded-xl border border-line bg-surface p-1 font-sans shadow-float"
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          data-i={i}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            command(item);
          }}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left",
            i === index && "bg-surface-2",
          )}
        >
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-bg",
              item.id === "ai" && "border-transparent bg-ai-soft text-ai",
            )}
          >
            <item.icon size={16} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">{item.title}</span>
            <span className="block truncate text-xs text-muted">{item.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
});

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<BlockItem, BlockItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        allow: ({ state, range }) => {
          // Not inside code blocks.
          const $from = state.doc.resolve(range.from);
          return !$from.parent.type.spec.code;
        },
        items: ({ query }) => {
          const q = query.toLowerCase();
          return BLOCKS.filter(
            (b) => !q || b.title.toLowerCase().includes(q) || b.keywords.includes(q),
          );
        },
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: BlockItem }) =>
          props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<ListHandle, ListProps> | null = null;
          let el: HTMLDivElement | null = null;

          const place = (props: SuggestionProps<BlockItem, BlockItem>) => {
            const rect = props.clientRect?.();
            if (!rect || !el) return;
            computePosition({ getBoundingClientRect: () => rect }, el, {
              placement: "bottom-start",
              strategy: "fixed",
              middleware: [offset(8), flip(), shift({ padding: 8 })],
            }).then(({ x, y }) => {
              if (el) Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
            });
          };

          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashList, {
                props: { items: props.items, command: props.command },
                editor: props.editor,
              });
              el = document.createElement("div");
              el.style.position = "fixed";
              el.style.zIndex = "60";
              el.appendChild(renderer.element);
              document.body.appendChild(el);
              place(props);
            },
            onUpdate: (props) => {
              renderer?.updateProps({ items: props.items, command: props.command });
              place(props);
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === "Escape") {
                el?.remove();
                return true;
              }
              return renderer?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              renderer?.destroy();
              el?.remove();
              renderer = null;
              el = null;
            },
          };
        },
      }),
    ];
  },
});
