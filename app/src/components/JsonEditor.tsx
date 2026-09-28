import { createEffect, onCleanup, onMount } from "solid-js";
import type { EditorView } from "@codemirror/view";

// CodeMirror is loaded lazily so it costs nothing until an editor is on screen.
const cm = () =>
  Promise.all([
    import("codemirror"),
    import("@codemirror/view"),
    import("@codemirror/state"),
    import("@codemirror/lang-json"),
    import("@codemirror/lint"),
    import("@codemirror/merge"),
    import("@codemirror/language"),
    import("@lezer/highlight"),
  ]);

export interface JsonEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  /** When set, changes relative to this text are highlighted inline (diff view). */
  original?: string;
  class?: string;
  /** Called on Ctrl/Cmd+Enter. */
  onSubmit?: () => void;
  lint?: boolean;
}

export default function JsonEditor(props: JsonEditorProps) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let rebuild: (() => void) | undefined;
  let disposed = false;

  onMount(async () => {
    const [{ basicSetup }, { EditorView, keymap }, { EditorState }, { json, jsonParseLinter }, { linter }, { unifiedMergeView }, { HighlightStyle, syntaxHighlighting }, { tags }] = await cm();
    if (disposed) return;
    // Colors come from CSS variables so the editor follows the light/dark theme.
    const highlight = HighlightStyle.define([
      { tag: tags.propertyName, color: "var(--syn-key)" },
      { tag: tags.string, color: "var(--syn-string)" },
      { tag: tags.number, color: "var(--syn-number)" },
      { tag: [tags.bool, tags.null], color: "var(--syn-keyword)" },
      { tag: [tags.bracket, tags.separator, tags.punctuation], color: "var(--fg-2)" },
    ]);
    rebuild = () => {
      const doc = view?.state.doc.toString() ?? props.value;
      view?.destroy();
      const extensions = [
        basicSetup,
        json(),
        syntaxHighlighting(highlight),
        EditorView.lineWrapping,
        EditorState.readOnly.of(!!props.readOnly),
        EditorView.editable.of(!props.readOnly),
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              props.onSubmit?.();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) props.onChange?.(u.state.doc.toString());
        }),
      ];
      if (props.lint !== false && !props.readOnly) extensions.push(linter(jsonParseLinter(), { delay: 300 }));
      if (props.original !== undefined)
        extensions.push(unifiedMergeView({ original: props.original, mergeControls: false, highlightChanges: true, gutter: true }));
      view = new EditorView({ parent: host, state: EditorState.create({ doc, extensions }) });
    };
    rebuild();
  });

  // Rebuild when the diff base or read-only flag changes.
  createEffect((prev?: string) => {
    const key = `${props.original ?? "\u0000"}|${!!props.readOnly}`;
    if (prev !== undefined && prev !== key) rebuild?.();
    return key;
  });

  // Push external value changes into the editor.
  createEffect(() => {
    const v = props.value;
    if (view && v !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    }
  });

  onCleanup(() => {
    disposed = true;
    view?.destroy();
  });

  return <div ref={host} class={`json-editor ${props.class ?? ""}`} />;
}
