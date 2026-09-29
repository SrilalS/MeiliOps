import { For, Show } from "solid-js";
import { Modal, formatBytes } from "../components/ui";
import { runningCount } from "../state/instances";
import { appVersion, availableUpdate, closeUpdateDialog, installUpdate, updateProgress, updateStatus } from "../state/updater";

export default function UpdateDialog() {
  const busy = () => updateStatus() === "downloading" || updateStatus() === "installing";
  const pct = () => {
    const p = updateProgress();
    return p?.total ? Math.min(100, (p.done / p.total) * 100) : 0;
  };
  return (
    <Show when={availableUpdate()}>
      {(u) => (
        <Modal
          title={`MeiliOps ${u().version} is available`}
          onClose={() => !busy() && closeUpdateDialog()}
          actions={
            <>
              <button disabled={busy()} onClick={closeUpdateDialog}>
                Later
              </button>
              <button class="primary" disabled={busy()} onClick={installUpdate}>
                {updateStatus() === "installing" ? "Installing…" : updateStatus() === "downloading" ? "Downloading…" : "Update and restart"}
              </button>
            </>
          }
        >
          <div class="muted small">
            You have {appVersion()}
            <Show when={u().date}> · released {u().date!.slice(0, 10)}</Show>
          </div>
          <Show when={u().body?.trim()}>
            <ReleaseNotes text={u().body!} />
          </Show>
          <Show when={runningCount() > 0}>
            <div class="warn small">
              {runningCount()} local instance{runningCount() > 1 ? "s are" : " is"} running and will be stopped first. Containers keep their data; start them again after the restart.
            </div>
          </Show>
          <Show when={updateProgress()}>
            <div class="progress">
              <span class="progress-bar" style={{ width: `${pct()}%` }} />
              <span class="progress-label">
                {updateStatus() === "installing" ? "Installing" : "Downloading"} · {formatBytes(updateProgress()!.done)}
                <Show when={updateProgress()!.total}> / {formatBytes(updateProgress()!.total)}</Show>
              </span>
            </div>
          </Show>
          <div class="muted small">The download is verified against MeiliOps' signing key before it's installed.</div>
        </Modal>
      )}
    </Show>
  );
}

/**
 * GitHub's generated notes are Markdown. Show headings and bullets as text (no HTML is
 * injected), shorten PR links to "#123" and drop link syntax.
 */
function ReleaseNotes(props: { text: string }) {
  const clean = (l: string) =>
    l
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/g, "#$1")
      .replace(/\*\*|__|`/g, "");
  const lines = () =>
    props.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const h = l.match(/^#{1,6}\s+(.*)$/);
        if (h) return { kind: "h", text: clean(h[1]) };
        const b = l.match(/^[*-]\s+(.*)$/);
        if (b) return { kind: "li", text: clean(b[1]) };
        return { kind: "p", text: clean(l) };
      });
  return (
    <div class="update-notes">
      <For each={lines()}>{(l) => <div class={`notes-${l.kind}`}>{l.text}</div>}</For>
    </div>
  );
}
