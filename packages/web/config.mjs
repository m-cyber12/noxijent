const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://noxijent.ai" : `https://${stage}.noxijent.ai`,
  console: stage === "production" ? "https://noxijent.ai/auth" : `https://${stage}.noxijent.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/noxijent",
  discord: "https://noxijent.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
