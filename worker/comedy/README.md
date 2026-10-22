# Comedy styles

These skills come from [pantheon-org/tekhne](https://github.com/pantheon-org/tekhne)
(`skills/comedy/`, commit `65046a0`), MIT licensed (see `LICENSE`). Only each
skill's `SKILL.md` and `references/` were copied.

When someone picks a style in the Claude panel, the worker appends that skill's
`SKILL.md` (minus frontmatter) and its reference files to Claude's system prompt.
The dropdown's labels and descriptions live in `shared/comedy.ts`; a new style
needs an entry there and a folder here with the same id.
