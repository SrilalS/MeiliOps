import { createSignal } from "solid-js";
import { api, refreshIndexes, setView, trackTask } from "../state/app";
import { Modal } from "../components/ui";

export default function CreateIndexDialog(props: { onClose: () => void }) {
  const [uid, setUid] = createSignal("");
  const [pk, setPk] = createSignal("");
  const valid = () => /^[a-zA-Z0-9_-]{1,400}$/.test(uid());

  const create = async () => {
    const name = uid();
    props.onClose();
    const t = await trackTask(api().req("POST", "/indexes", { body: { uid: name, primaryKey: pk() || null } }), `Create index ${name}`);
    if (t?.status === "succeeded") {
      await refreshIndexes();
      setView({ kind: "index", uid: name, tab: "documents" });
    }
  };

  return (
    <Modal
      title="Create index"
      onClose={props.onClose}
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button class="primary" disabled={!valid()} onClick={create}>
            Create
          </button>
        </>
      }
    >
      <label class="field">
        <span>Index UID</span>
        <input value={uid()} onInput={(e) => setUid(e.currentTarget.value)} placeholder="products" autofocus />
        <small class="muted">Letters, digits, - and _ only.</small>
      </label>
      <label class="field">
        <span>Primary key (optional)</span>
        <input value={pk()} onInput={(e) => setPk(e.currentTarget.value)} placeholder="inferred from the first documents" />
      </label>
    </Modal>
  );
}
