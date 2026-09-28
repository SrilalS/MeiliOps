import { For, Show, createResource, createSignal } from "solid-js";
import { api, notify, notifyError } from "../state/app";
import { errorMessage } from "../api/meili";
import JsonEditor from "../components/JsonEditor";
import { ApiError, Confirm, Modal, Tabs, pretty } from "../components/ui";
import { streamSse } from "../lib/sse";

interface Msg {
  role: "user" | "assistant" | "system";
  content: string;
}

const NEW_SETTINGS = {
  source: "openAi",
  apiKey: "sk-…",
  baseUrl: null,
  prompts: { system: "You are a helpful assistant that answers using the search results." },
};

export default function ChatsView() {
  const [list, { refetch }] = createResource(async () => {
    const r = await api().req<{ results: { uid: string }[] }>("GET", "/chats", { query: { limit: 1000 } });
    return r.results;
  });
  const [ws, setWs] = createSignal<string>();
  const [tab, setTab] = createSignal<"chat" | "settings">("chat");
  const [creating, setCreating] = createSignal(false);
  const [newUid, setNewUid] = createSignal("");
  const [confirm, setConfirm] = createSignal<"delete" | "reset">();

  return (
    <div class="page">
      <div class="page-head">
        <h2>Chats</h2>
        <span class="muted small">Conversational search (RAG). Needs the chatCompletions experimental feature and an LLM provider in the workspace settings.</span>
        <span class="grow" />
        <button onClick={refetch}>↻</button>
        <button class="primary" onClick={() => setCreating(true)}>
          + New workspace
        </button>
      </div>
      <Show when={!list.error} fallback={<ApiError error={list.error} />}>
        <div class="split">
          <nav class="settings-nav">
            <For each={list() ?? []} fallback={<div class="muted small pad">No workspaces</div>}>
              {(w) => (
                <div class="settings-item" classList={{ active: ws() === w.uid }} onClick={() => setWs(w.uid)}>
                  {w.uid}
                </div>
              )}
            </For>
          </nav>
          <section class="settings-body">
            <Show when={ws()} keyed fallback={<div class="empty muted">Select a workspace</div>}>
              {(uid) => (
                <>
                  <div class="row">
                    <h3 class="grow">{uid}</h3>
                    <Tabs
                      tabs={[
                        { id: "chat", label: "Playground" },
                        { id: "settings", label: "Settings" },
                      ]}
                      value={tab()}
                      onChange={setTab}
                    />
                    <button onClick={() => setConfirm("reset")}>Reset settings</button>
                    <button class="danger" onClick={() => setConfirm("delete")}>
                      Delete
                    </button>
                  </div>
                  <Show when={tab() === "chat"} fallback={<WorkspaceSettings uid={uid} />}>
                    <Playground uid={uid} />
                  </Show>
                </>
              )}
            </Show>
          </section>
        </div>
      </Show>

      <Show when={creating()}>
        <Modal
          title="New chat workspace"
          onClose={() => setCreating(false)}
          actions={
            <button
              class="primary"
              disabled={!newUid().trim()}
              onClick={async () => {
                try {
                  await api().req("PATCH", "/chats/{workspace_uid}/settings", { path: { workspace_uid: newUid().trim() }, body: NEW_SETTINGS });
                  setCreating(false);
                  setWs(newUid().trim());
                  setTab("settings");
                  refetch();
                } catch (e) {
                  notifyError(e, "Create workspace");
                }
              }}
            >
              Create
            </button>
          }
        >
          <label class="field">
            <span>Workspace UID</span>
            <input value={newUid()} onInput={(e) => setNewUid(e.currentTarget.value)} autofocus />
          </label>
          <p class="muted small">Creates the workspace with placeholder OpenAI settings. Edit them in the Settings tab.</p>
        </Modal>
      </Show>
      <Show when={confirm() && ws()}>
        <Confirm
          title={confirm() === "delete" ? "Delete workspace" : "Reset workspace settings"}
          message={<>{confirm() === "delete" ? "Delete" : "Reset settings of"} workspace “{ws()}”?</>}
          confirmText={confirm() === "delete" ? "Delete" : "Reset"}
          onClose={() => setConfirm(undefined)}
          onConfirm={async () => {
            try {
              if (confirm() === "delete") {
                await api().req("DELETE", "/chats/{workspace_uid}", { path: { workspace_uid: ws()! } });
                setWs(undefined);
              } else await api().req("DELETE", "/chats/{workspace_uid}/settings", { path: { workspace_uid: ws()! } });
              refetch();
            } catch (e) {
              notifyError(e);
            }
          }}
        />
      </Show>
    </div>
  );
}

function WorkspaceSettings(props: { uid: string }) {
  const [text, setText] = createSignal("");
  const [server, { refetch }] = createResource(async () => {
    // GET /chats/{uid} returns the workspace itself; settings (with a redacted key) come from /settings.
    await api().req("GET", "/chats/{workspace_uid}", { path: { workspace_uid: props.uid } });
    const s = pretty(await api().req("GET", "/chats/{workspace_uid}/settings", { path: { workspace_uid: props.uid } }));
    setText(s);
    return s;
  });
  const save = async () => {
    try {
      await api().req("PATCH", "/chats/{workspace_uid}/settings", { path: { workspace_uid: props.uid }, body: JSON.parse(text()) });
      notify("success", "Workspace settings saved");
      refetch();
    } catch (e) {
      notifyError(e, "Save settings");
    }
  };
  return (
    <>
      <p class="muted small">source: openAi · mistral · azureOpenAi · vLlm. The API key is redacted when read back. Leave it unchanged to keep the stored one.</p>
      <div class="editor-box fill">
        <JsonEditor value={text()} onChange={setText} original={server()} onSubmit={save} />
      </div>
      <div class="row">
        <button class="primary" onClick={save}>
          Save (Ctrl+Enter)
        </button>
      </div>
    </>
  );
}

function Playground(props: { uid: string }) {
  const [model, setModel] = createSignal("gpt-4o-mini");
  const [messages, setMessages] = createSignal<Msg[]>([]);
  const [input, setInput] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string>();
  let ctrl: AbortController | undefined;

  const send = async () => {
    const text = input().trim();
    if (!text || busy()) return;
    const history: Msg[] = [...messages(), { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setErr(undefined);
    ctrl = new AbortController();
    let answer = "";
    try {
      await streamSse(
        api(),
        "POST",
        "/chats/{workspace_uid}/chat/completions",
        {
          onData: (d) => {
            if (d === "[DONE]") return;
            const chunk = JSON.parse(d);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              answer += delta;
              setMessages([...history, { role: "assistant", content: answer }]);
            }
          },
        },
        { path: { workspace_uid: props.uid }, body: { model: model(), messages: history, stream: true }, signal: ctrl.signal },
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="chat">
      <div class="chat-log">
        <For each={messages()} fallback={<div class="muted pad">Ask a question about your indexed data.</div>}>
          {(m) => (
            <div class={`chat-msg ${m.role}`}>
              <div class="chat-role">{m.role}</div>
              <div class="chat-text">{m.content || (busy() ? "…" : "")}</div>
            </div>
          )}
        </For>
      </div>
      <Show when={err()}>
        <div class="err">{err()}</div>
      </Show>
      <div class="row">
        <input class="mono" style={{ width: "160px" }} value={model()} onInput={(e) => setModel(e.currentTarget.value)} title="Model" />
        <input class="grow" value={input()} onInput={(e) => setInput(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Message…" />
        <Show when={!busy()} fallback={<button onClick={() => ctrl?.abort()}>Stop</button>}>
          <button class="primary" onClick={send}>
            Send
          </button>
        </Show>
        <button onClick={() => setMessages([])}>Clear</button>
      </div>
    </div>
  );
}
