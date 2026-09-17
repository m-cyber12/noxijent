interface ImportMetaEnv {
  readonly NOXIJENT_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:noxijent-server" {
  export namespace Server {
    export const listen: typeof import("../../../noxijent/dist/types/src/node").Server.listen
    export type Listener = import("../../../noxijent/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../noxijent/dist/types/src/node").Config.get
    export type Info = import("../../../noxijent/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../noxijent/dist/types/src/node").bootstrap
}
