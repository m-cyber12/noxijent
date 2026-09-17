export * from "./client.js"
export * from "./server.js"

import { createNoxijentClient } from "./client.js"
import { createNoxijentServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createNoxijent(options?: ServerOptions) {
  const server = await createNoxijentServer({
    ...options,
  })

  const client = createNoxijentClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
