import { $ } from "bun"
import { downloadCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.NOXIJENT_CHANNEL ?? "dev"}`

await $`cd ../noxijent && bun script/build-node.ts`
await downloadCliToResources()
