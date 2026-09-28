import { createSignal } from "solid-js";
import { api, trackTask } from "../../state/app";
import { Modal } from "../../components/ui";
import { Task } from "../../api/meili";

export default function DeleteByIdsDialog(props: { uid: string; onClose: () => void; onDone: (t: Task | undefined) => void }) {
  const [text, setText] = createSignal("");
  const ids = () =>
    text()
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const submit = async () => {
    const list = ids();
    props.onClose();
    props.onDone(
      await trackTask(
        api().req("POST", "/indexes/{index_uid}/documents/delete-batch", { path: { index_uid: props.uid }, body: list }),
        `Delete ${list.length} documents from ${props.uid}`,
      ),
    );
  };

  return (
    <Modal
      title="Delete documents by ID"
      onClose={props.onClose}
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button class="danger" disabled={ids().length === 0} onClick={submit}>
            Delete {ids().length} documents
          </button>
        </>
      }
    >
      <label class="field">
        <span>Document IDs (comma, space or newline separated)</span>
        <textarea class="mono" rows={8} value={text()} onInput={(e) => setText(e.currentTarget.value)} />
      </label>
    </Modal>
  );
}
