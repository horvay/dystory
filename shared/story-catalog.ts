// How the script assistant and the director find another story's screenplay.
// The app knows some stories; older ones only exist as folders. Picking the
// file and matching a name are pure so they can be tested without either.

export const SKIP_FOLDERS = new Set(["voice-library", "lottery-breakup-demo"]);

/** A directory under short-stories/ that is a story, rather than a library or scratch work. */
export function isStoryFolder(name: string): boolean {
  if (!name || name.startsWith(".") || name.startsWith("_")) return false;
  return !SKIP_FOLDERS.has(name);
}

export type ScriptCandidate = { name: string; mtimeMs: number };

const VERSIONED = /-v\d+\.(md|txt)$/i;

/** Higher means "this is more likely the screenplay". 0 means ignore the file. */
export function scriptRank(name: string): number {
  if (name === "script-current.md") return 100;
  if (/^screenplay.*\.md$/i.test(name)) return 80;
  if (/^script-.*\.(md|txt)$/i.test(name)) return 60;
  if (/^idea-board-.*\.txt$/i.test(name)) return 40;
  return 0;
}

/**
 * The screenplay to read out of a story's `00-script/` directory.
 * `script-current.md` wins (the app writes that before a director turn).
 * Otherwise the newest screenplay or script export. Snapshots (`.json`) and
 * versioned copies lose to the export they were taken from when the times match.
 * Gary's story only has idea-board text, so that is the last resort.
 */
export function pickScriptFile(files: ScriptCandidate[]): string | null {
  const ranked = files
    .filter((f) => scriptRank(f.name) > 0)
    .sort((a, b) => {
      const byRank = scriptRank(b.name) - scriptRank(a.name);
      if (byRank) return byRank;
      if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
      const byVersion = Number(VERSIONED.test(a.name)) - Number(VERSIONED.test(b.name));
      if (byVersion) return byVersion;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  return ranked[0]?.name ?? null;
}

const GENERIC_HEADING = /^(script|screenplay|untitled)\b/i;

/** A title to show for a folder-only story: its heading, or the folder name. */
export function titleFromScript(slug: string, text: string): string {
  const heading = text.match(/^\uFEFF?\s*#\s+(.+?)\s*$/m)?.[1];
  if (heading) {
    const clean = heading.split(/\s+(?:\(|—|–|- )/)[0]!.trim();
    if (clean && !GENERIC_HEADING.test(clean)) return clean;
  }
  return slug.replace(/-/g, " ");
}

/** Opening of a screenplay, same length as the snippet stored on a document. */
export function snippetFrom(text: string): string {
  const withoutTitle = text
    .replace(/^\uFEFF?\s*#\s+[^\n]*\n*/, "")
    // Folder exports sometimes start with where the text was fetched from.
    .replace(/^\s*Source:[^\n]*\n*/, "");
  const plain = withoutTitle
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 220);
}

export type StoryName = { slug: string; title: string };

export function normStoryName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export type StoryMatch =
  | { ok: true; slug: string }
  | { ok: false; reason: "none" | "many"; slugs: string[] };

/**
 * Resolve what someone (or the model) called a story. An exact title or folder
 * name wins. Otherwise every word has to be a whole word of the title or the
 * folder name, and it has to match one story.
 */
export function matchStory(query: string, stories: StoryName[]): StoryMatch {
  const q = normStoryName(query);
  if (!q) return { ok: false, reason: "none", slugs: [] };

  const exact = stories.filter((s) => normStoryName(s.slug) === q || normStoryName(s.title) === q);
  if (exact.length === 1) return { ok: true, slug: exact[0]!.slug };
  if (exact.length > 1) return { ok: false, reason: "many", slugs: exact.map((s) => s.slug) };

  const words = q.split(" ").filter((w) => w.length >= 2);
  if (!words.length) return { ok: false, reason: "none", slugs: [] };
  const partial = stories.filter((s) => {
    const bag = new Set([...normStoryName(s.slug).split(" "), ...normStoryName(s.title).split(" ")]);
    return words.every((w) => bag.has(w));
  });
  if (partial.length === 1) return { ok: true, slug: partial[0]!.slug };
  if (partial.length > 1) return { ok: false, reason: "many", slugs: partial.map((s) => s.slug) };
  return { ok: false, reason: "none", slugs: [] };
}
