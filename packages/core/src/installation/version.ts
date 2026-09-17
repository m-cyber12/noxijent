declare global {
  const NOXIJENT_VERSION: string
  const NOXIJENT_CHANNEL: string
}

export const InstallationVersion = typeof NOXIJENT_VERSION === "string" ? NOXIJENT_VERSION : "local"
export const InstallationChannel = typeof NOXIJENT_CHANNEL === "string" ? NOXIJENT_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
