import { Show, createSignal } from "solid-js";
import { api, notify, trackTask } from "../../state/app";
import { Modal } from "../../components/ui";
import JsonEditor from "../../components/JsonEditor";
import { Task } from "../../api/meili";

type Format = "json" | "ndjson" | "csv";
const CONTENT_TYPE: Record<Format, string> = { json: "application/json", ndjson: "application/x-ndjson", csv: "text/csv" };

export default function AddDocumentsDialog(props: { uid: string; onClose: () => void; onDone: (t: Task | undefined) => void }) {
  const [text, setText] = createSignal('[\n  { "id": 1, "title": "Hello" }\n]');
  const [file, setFile] = createSignal<File>();
  const [format, setFormat] = createSignal<Format>("json");
  const [mode, setMode] = createSignal<"replace" | "update">("replace");
  const [primaryKey, setPrimaryKey] = createSignal("");
  const [csvDelimiter, setCsvDelimiter] = createSignal(",");

  const pickFile = (f: File | undefined) => {
    setFile(f);
    if (!f) return;
    const name = f.name.toLowerCase();
    if (name.endsWith(".csv")) setFormat("csv");
    else if (name.endsWith(".ndjson") || name.endsWith(".jsonl")) setFormat("ndjson");
    else setFormat("json");
  };

  const submit = async () => {
    const payload: Blob | string = file() ?? text();
    if (!file() && format() === "json") {
      try {
        JSON.parse(text());
      } catch (e) {
        return notify("error", `Invalid JSON: ${(e as Error).message}`);
      }
    }
    const query: Record<string, unknown> = { primaryKey: primaryKey() || undefined };
    if (format() === "csv" && csvDelimiter() !== ",") query.csvDelimiter = csvDelimiter();
    props.onClose();
    // POST = add or replace, PUT = add or update (partial merge).
    const opts = { path: { index_uid: props.uid }, query, body: payload, contentType: CONTENT_TYPE[format()] };
    const t = await trackTask(
      mode() === "replace" ? api().req("POST", "/indexes/{index_uid}/documents", opts) : api().req("PUT", "/indexes/{index_uid}/documents", opts),
      `${mode() === "replace" ? "Add/replace" : "Add/update"} documents in ${props.uid}${file() ? ` (${file()!.name})` : ""}`,
    );
    props.onDone(t);
  };

  return (
    <Modal
      title={`Add documents to ${props.uid}`}
      onClose={props.onClose}
      wide
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button class="primary" onClick={submit}>
            Upload
          </button>
        </>
      }
    >
      <div class="row wrap">
        <label class="field inline">
          <span>Mode</span>
          <select value={mode()} onChange={(e) => setMode(e.currentTarget.value as "replace" | "update")}>
            <option value="replace">Add or replace (POST)</option>
            <option value="update">Add or update — partial merge (PUT)</option>
          </select>
        </label>
        <label class="field inline">
          <span>Format</span>
          <select value={format()} onChange={(e) => setFormat(e.currentTarget.value as Format)}>
            <option value="json">JSON array</option>
            <option value="ndjson">NDJSON</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <Show when={format() === "csv"}>
          <label class="field inline">
            <span>CSV delimiter</span>
            <input class="tiny-input" maxLength={1} value={csvDelimiter()} onInput={(e) => setCsvDelimiter(e.currentTarget.value || ",")} />
          </label>
        </Show>
        <label class="field inline">
          <span>Primary key</span>
          <input value={primaryKey()} onInput={(e) => setPrimaryKey(e.currentTarget.value)} placeholder="(inferred)" />
        </label>
      </div>
      <label class="field">
        <span>From file (streams straight from disk — use this for big files)</span>
        <input type="file" accept=".json,.ndjson,.jsonl,.csv" onChange={(e) => pickFile(e.currentTarget.files?.[0])} />
      </label>
      <Show
        when={!file()}
        fallback={
          <div class="muted">
            {file()!.name} · {(file()!.size / 1024 / 1024).toFixed(1)} MB{" "}
            <button class="link" onClick={() => setFile(undefined)}>
              clear
            </button>
          </div>
        }
      >
        <div class="editor-box">
          <JsonEditor value={text()} onChange={setText} lint={format() === "json"} onSubmit={submit} />
        </div>
      </Show>
    </Modal>
  );
}
