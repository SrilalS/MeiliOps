import { createVirtualizer } from "@tanstack/solid-virtual";
import { For, JSX, Show, createEffect } from "solid-js";

export interface Column<T = any> {
  key: string;
  title: string;
  width: number;
  render?: (row: T) => JSX.Element;
}

export interface VirtualTableProps<T = any> {
  count: number;
  columns: Column<T>[];
  /** Returns the row at index i, or undefined while it is still loading. */
  row: (i: number) => T | undefined;
  onRange?: (start: number, end: number) => void;
  onRowClick?: (i: number) => void;
  selected?: number;
  rowHeight?: number;
  empty?: JSX.Element;
}

/** Only the visible rows exist in the DOM, so 1M rows cost the same as 50. */
export default function VirtualTable<T>(props: VirtualTableProps<T>) {
  let scroller!: HTMLDivElement;
  const rowHeight = () => props.rowHeight ?? 28;

  const virtualizer = createVirtualizer({
    get count() {
      return props.count;
    },
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight(),
    overscan: 15,
  });

  createEffect(() => {
    const items = virtualizer.getVirtualItems();
    if (items.length && props.onRange) props.onRange(items[0].index, items[items.length - 1].index);
  });

  const totalWidth = () => props.columns.reduce((s, c) => s + c.width, 0) + 56;

  return (
    <div class="vtable" ref={scroller}>
      <div class="vtable-inner" style={{ width: `${totalWidth()}px`, height: `${virtualizer.getTotalSize() + rowHeight()}px` }}>
        <div class="vtable-head" style={{ height: `${rowHeight()}px` }}>
          <div class="vtable-cell vtable-rownum">#</div>
          <For each={props.columns}>
            {(c) => (
              <div class="vtable-cell" style={{ width: `${c.width}px` }} title={c.title}>
                {c.title}
              </div>
            )}
          </For>
        </div>
        <For each={virtualizer.getVirtualItems()}>
          {(item) => {
            const r = () => props.row(item.index);
            return (
              <div
                class="vtable-row"
                classList={{ selected: props.selected === item.index, odd: item.index % 2 === 1 }}
                style={{ height: `${item.size}px`, transform: `translateY(${item.start + rowHeight()}px)` }}
                onClick={() => props.onRowClick?.(item.index)}
              >
                <div class="vtable-cell vtable-rownum">{item.index + 1}</div>
                <Show when={r()} fallback={<div class="vtable-cell muted">loading…</div>}>
                  {(row) => (
                    <For each={props.columns}>
                      {(c) => (
                        <div class="vtable-cell" style={{ width: `${c.width}px` }}>
                          {c.render ? c.render(row()) : formatCell((row() as any)[c.key])}
                        </div>
                      )}
                    </For>
                  )}
                </Show>
              </div>
            );
          }}
        </For>
      </div>
      <Show when={props.count === 0}>
        <div class="vtable-empty">{props.empty ?? "No rows"}</div>
      </Show>
    </div>
  );
}

export function formatCell(v: unknown): JSX.Element {
  if (v === undefined) return <span class="muted">—</span>;
  if (v === null) return <span class="muted">null</span>;
  if (typeof v === "number") return <span class="num">{v}</span>;
  if (typeof v === "boolean") return <span class="bool">{String(v)}</span>;
  if (typeof v === "string") return v.length > 300 ? v.slice(0, 300) + "…" : v;
  const s = JSON.stringify(v);
  return <span class="json">{s.length > 300 ? s.slice(0, 300) + "…" : s}</span>;
}
