// @ts-nocheck

import { Noxijent } from "@noxijent-ai/core"
import { ReadTool } from "@noxijent-ai/core/tools"

const noxijent = Noxijent.make({})

noxijent.tool.add(ReadTool)

noxijent.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

noxijent.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

noxijent.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await noxijent.session.create({
  agent: "build",
})

noxijent.subscribe((event) => {
  console.log(event)
})

await noxijent.session.prompt({
  sessionID,
  text: "hey what is up",
})

await noxijent.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await noxijent.session.wait()

console.log(await noxijent.session.messages(sessionID))
