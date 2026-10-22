// Document chat limits and helpers, shared by the backend (convex/chat.ts)
// and the chat panel (src/panels/ChatPanel.tsx).

export const CHAT_MAX_TEXT = 4000;
export const CHAT_MAX_QUOTE = 5000;

/** One line standing in for a message, for reply previews and notifications. */
export function chatPreview(m: { text: string; quote?: { text: string } }): string {
  const s = m.text || (m.quote ? `“${m.quote.text}”` : "");
  return s.replace(/\s+/g, " ").trim().slice(0, 160);
}
