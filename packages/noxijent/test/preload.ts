// Test preload for the Noxijent test suite.
// Keeps unit tests hermetic: no sharing, no telemetry, no host configuration
// bleeding into tests. Individual test files may override these values.
process.env.NOXIJENT_DISABLE_SHARE = "true"
process.env.NOXIJENT_TEST = "1"
