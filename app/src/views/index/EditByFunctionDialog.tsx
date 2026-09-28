import { createSignal } from "solid-js";
import { api, trackTask } from "../../state/app";
import { Modal } from "../../components/ui";
import JsonEditor from "../../components/JsonEditor";
import { Task } from "../../api/meili";

export default function EditByFunctionDialog(props: { uid: string; filter: string; onClose: () => void; onDone: (t: Task | undefined) => void }) {
  const [fn, setFn] = createSignal('doc.title = doc.title.to_upper();\n// return () to delete the document');
  const [filter, setFilter] = createSignal(props.filter);
  const [context, setContext] = createSignal("{}");

  const run = async () => {
    let ctx: unknown = undefined;
    try {
      const parsed = JSON.parse(context() || "{}");
      if (parsed && Object.keys(parsed).length) ctx = parsed;
    } catch {
      /* ignore invalid context → validated by the server */
    }
    props.onClose();
    props.onDone(
      await trackTask(
        api().req("POST", "/indexes/{index_uid}/documents/edit", { path: { index_uid: props.uid }, body: { function: fn(), filter: filter() || undefined, context: ctx } }),
        `Edit documents by function in ${props.uid}`,
      ),
    );
  };

  return (
    <Modal
      title="Edit documents with a Rhai function"
      onClose={props.onClose}
      wide
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button class="primary" onClick={run}>
            Run on matching documents
          </button>
        </>
      }
    >
      <p class="muted small">
        Experimental: enable <code>editDocumentsByFunction</code> in Experimental features. The function runs server-side on every matching document; <code>doc</code> is the document and <code>context</code> is the JSON below.
      </p>
      <label class="field">
        <span>Filter (empty = all documents)</span>
        <input class="mono" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
      </label>
      <label class="field">
        <span>Function (Rhai)</span>
        <textarea class="mono" rows={7} value={fn()} onInput={(e) => setFn(e.currentTarget.value)} spellcheck={false} />
      </label>
      <div class="field">
        <span>Context (JSON, optional)</span>
        <div class="editor-box short">
          <JsonEditor value={context()} onChange={setContext} />
        </div>
      </div>
    </Modal>
  );
}
