// The only place this tool asks anything. `--yes` answers every question with
// its default, and a question with no terminal to ask on is an error rather
// than a silent default — the same rule the daemon's own commands follow.

import { createInterface } from "node:readline/promises";

export function createPrompter({ yes = false, input = process.stdin, output = process.stderr } = {}) {
  const interactive = Boolean(input.isTTY) && !yes;

  function refuse(question, fallback) {
    return new Error(
      `${question} — there is no terminal to ask on; pass --yes to take the default (${fallback})`,
    );
  }

  async function read(text) {
    const rl = createInterface({ input, output });
    try {
      return (await rl.question(text)).trim();
    } finally {
      rl.close();
    }
  }

  /** A free-text answer; empty takes `fallback`. */
  async function ask(question, fallback) {
    if (yes) return fallback;
    if (!interactive) throw refuse(question, fallback);
    const answer = await read(`${question} [${fallback}] `);
    return answer || fallback;
  }

  /**
   * A yes/no answer. `fallback` is what Enter means; `whenYes` is what `--yes`
   * means, which for a destructive question is not always the default.
   */
  async function confirm(question, { fallback = true, whenYes = fallback } = {}) {
    if (yes) return whenYes;
    if (!interactive) throw refuse(question, fallback ? "yes" : "no");
    const answer = (await read(`${question} [${fallback ? "Y/n" : "y/N"}] `)).toLowerCase();
    if (answer === "") return fallback;
    return answer === "y" || answer === "yes";
  }

  return { ask, confirm, interactive };
}
