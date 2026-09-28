import { createSignal } from "solid-js";
import { api } from "../../state/app";
import { errorMessage } from "../../api/meili";
import { Modal, pretty } from "../../components/ui";
import JsonEditor from "../../components/JsonEditor";

/** Try document templates / embedder fragments against a real document (POST /render-template). */
export default function RenderTemplateDialog(props: { uid: string; kind: "documentTemplate" | "chatDocumentTemplate"; embedder?: string; onClose: () => void }) {
  const [body, setBody] = createSignal(
    pretty({
      template: { kind: props.kind, indexUid: props.uid, ...(props.embedder ? { embedder: props.embedder } : {}) },
      input: { kind: "indexDocument", indexUid: props.uid, id: "" },
    }),
  );
  const [out, setOut] = createSignal("");

  const run = async () => {
    try {
      setOut(pretty(await api().req("POST", "/render-template", { body: JSON.parse(body()) })));
    } catch (e) {
      setOut(errorMessage(e));
    }
  };

  return (
    <Modal title="Test template rendering" onClose={props.onClose} wide>
      <p class="muted small">
        Renders a template against a document so you can see exactly what gets embedded or sent to the LLM. Experimental: needs the <code>renderRoute</code> feature. Set <code>input.id</code> to a document ID, or use{" "}
        <code>{'{"kind":"inlineDocument","inline":{…}}'}</code>. Template kinds: documentTemplate, chatDocumentTemplate, indexingFragment, searchFragment, inlineDocumentTemplate, inlineFragment.
      </p>
      <div class="split" style={{ height: "340px" }}>
        <div class="console-pane">
          <div class="pane-title">Request</div>
          <JsonEditor value={body()} onChange={setBody} onSubmit={run} class="grow" />
        </div>
        <div class="console-pane">
          <div class="pane-title">Rendered</div>
          <JsonEditor value={out()} readOnly class="grow" />
        </div>
      </div>
      <button class="primary" onClick={run}>
        Render (Ctrl+Enter)
      </button>
    </Modal>
  );
}
