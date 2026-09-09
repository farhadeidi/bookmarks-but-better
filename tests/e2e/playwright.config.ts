import { defineConfig } from "@playwright/test"

/**
 * The end-to-end suites, each driven by its own `run-*.sh` against a real
 * daemon the script started.
 *
 * `testDir` is this directory rather than the repository root, which is the
 * whole point of the file: with no config, Playwright discovers from the
 * working directory and treats the spec path on the command line as a filter
 * *pattern*, so a checkout nested inside the repository — an agent worktree
 * under `.delta/`, an unpacked archive — contributes a second copy of every
 * spec. Both copies then run in parallel against the one daemon the script
 * started, and they fail each other.
 *
 * Tests are *not* `fullyParallel`: each spec shares one daemon and seeds it
 * from a file-level `beforeAll`, which Playwright runs once per worker. Split
 * a file across workers and the seed is applied several times over.
 */
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: 0,
  reporter: [["line"]],
  use: {
    trace: "retain-on-failure",
  },
})
