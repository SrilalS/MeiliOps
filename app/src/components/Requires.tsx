import { JSX, ParentProps, Show } from "solid-js";
import { Empty } from "./ui";
import { GatedOp, missing, serverVersion, shortVersion } from "../lib/compat";

/** Renders its children only when the connected server serves `op`; otherwise explains which version it needs. */
export default function Requires(props: ParentProps<{ op: GatedOp; feature: string; fallback?: JSX.Element }>) {
  return (
    <Show when={missing(props.op)} fallback={props.children}>
      {(v) =>
        props.fallback ?? (
          <Empty title={`${props.feature} needs Meilisearch ${shortVersion(v())} or newer`}>
            <p>This server runs {serverVersion()}. Upgrade Meilisearch to use this screen.</p>
          </Empty>
        )
      }
    </Show>
  );
}
