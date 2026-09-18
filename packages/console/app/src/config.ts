/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://noxijent.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/anomalyco/noxijent",
    starsFormatted: {
      compact: "195K",
      full: "195,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/noxijent",
    discord: "https://discord.gg/noxijent",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "950",
    commits: "13,000",
    monthlyUsers: "16M",
  },
} as const
