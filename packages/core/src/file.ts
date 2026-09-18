export * as File from "./file"

import { Revert } from "@noxijent-ai/schema/revert"

export const Diff = Revert.FileDiff
export type Diff = typeof Diff.Type
