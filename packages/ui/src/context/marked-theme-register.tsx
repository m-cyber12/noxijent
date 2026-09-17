import { registerCustomTheme } from "@pierre/diffs"
import { NoxijentTheme } from "./marked-theme"

let registered = false

export function registerNoxijentTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("Noxijent", () => Promise.resolve(NoxijentTheme))
}
