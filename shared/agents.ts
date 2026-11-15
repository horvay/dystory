// The models you can pick in the script assistant's panel. The worker runs
// Claude through the Claude Agent SDK and Muse through `muse serve`, both
// using the logins already on this machine. The director is separate and
// stays on Claude Opus.
export const AI_AGENTS = [
  { id: "claude", label: "Claude Fable", name: "Claude", hint: "Anthropic's Claude Fable 5.2" },
  { id: "muse", label: "Muse", name: "Muse", hint: "Meta's Muse Code" },
] as const;

export type AiAgent = (typeof AI_AGENTS)[number]["id"];

export const agentInfo = (id: AiAgent | undefined) => AI_AGENTS.find((a) => a.id === (id ?? "claude"))!;
