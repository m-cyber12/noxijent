import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerNoxijentSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
