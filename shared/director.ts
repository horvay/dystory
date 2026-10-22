// Settings shared by the app, Convex and the director worker.

/** The production AI's name in the app, and the user it posts cuts and replies as. */
export const DIRECTOR_NAME = "Director";
export const DIRECTOR_COLOR = "#2f5bd3";

/**
 * Review comments are collected for this long after the newest one before
 * they go to the production AI as one batch, so a review session of several
 * comments becomes one round of fixes. "Send now" skips the wait.
 */
export const FEEDBACK_QUIET_MS = 3 * 60_000;

/** When the production session's context passes this many tokens, the director compacts it. */
export const COMPACT_TOKENS = 300_000;

/** Lowercase, dashed folder name for a story title. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "story"
  );
}
