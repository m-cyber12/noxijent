import { run as runTui, type TuiInput } from "@noxijent-ai/tui"
import { Global } from "@noxijent-ai/core/global"
import { AppNodeBuilder } from "@noxijent-ai/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
