// The only place this tool asks anything, drawn with @clack/prompts. `--yes`
// answers every question with its default, and a question with no terminal
// to ask on is an error rather than a silent default — the same rule the
// daemon's own commands follow.

import * as p from "@clack/prompts";

/** The user pressed Ctrl-C or Escape on a question. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
}

export function createPrompter({ yes = false, input = process.stdin } = {}) {
  const interactive = Boolean(input.isTTY) && !yes;

  function refuse(question, fallback) {
    return new Error(
      `${question} — there is no terminal to ask on; pass --yes to take the default (${fallback}), or say it on the command line`,
    );
  }

  function unwrap(answer) {
    if (p.isCancel(answer)) throw new Cancelled();
    return answer;
  }

  /** A free-text answer; empty takes `fallback`. */
  async function ask(question, fallback, { validate } = {}) {
    if (yes) return fallback;
    if (!interactive) throw refuse(question, fallback);
    const answer = unwrap(
      await p.text({ message: question, placeholder: fallback, defaultValue: fallback, validate }),
    );
    return String(answer).trim() || fallback;
  }

  /**
   * A yes/no answer. `fallback` is what Enter means; `whenYes` is what `--yes`
   * means, which for a destructive question is not always the default.
   */
  async function confirm(question, { fallback = true, whenYes = fallback } = {}) {
    if (yes) return whenYes;
    if (!interactive) throw refuse(question, fallback ? "yes" : "no");
    return unwrap(await p.confirm({ message: question, initialValue: fallback }));
  }

  /** One of `options` (`{ value, label, hint? }`). A choice has no default, so it needs a terminal. */
  async function select(question, options) {
    if (!interactive) throw refuse(question, options.map((option) => option.value).join(" | "));
    return unwrap(await p.select({ message: question, options }));
  }

  return { ask, confirm, select, interactive };
}
