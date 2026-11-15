// Lists every story the script assistant and the director may read, and
// returns one story's screenplay. Stories in the app come from Convex (the
// live document). Older stories only have a folder; those are read from
// 00-script/. Nothing here writes.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { STAGES } from "../shared/stages";
import {
  isStoryFolder,
  matchStory,
  pickScriptFile,
  snippetFrom,
  titleFromScript,
  type StoryName,
} from "../shared/story-catalog";

const STORIES_DIR = resolve(process.env.STORIES_DIR || join(process.env.HOME ?? "", "ai/clips/short-stories"));
const MAX_SCRIPT = 40_000;

type Entry = StoryName & {
  stage: string;
  snippet: string;
  where: "app" | "folder";
  current: boolean;
  /** Screenplay text for a folder-only story. App stories are read from Convex on demand. */
  markdown?: string;
  folder?: string;
};

function stageLabel(stage: string): string {
  return STAGES.find((s) => s.id === stage)?.label ?? stage;
}

function displayPath(full: string): string {
  const home = process.env.HOME;
  if (home && (full === home || full.startsWith(`${home}/`))) return `~${full.slice(home.length)}`;
  return full;
}

function diskEntries(skip: Set<string>, currentSlug: string | undefined): Entry[] {
  if (!existsSync(STORIES_DIR)) return [];
  const found: Entry[] = [];
  let names: string[];
  try {
    names = readdirSync(STORIES_DIR);
  } catch (err) {
    console.warn(`[stories] couldn't list ${STORIES_DIR}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
  for (const name of names) {
    if (!isStoryFolder(name) || skip.has(name)) continue;
    const folder = join(STORIES_DIR, name);
    const dir = join(folder, "00-script");
    if (!existsSync(dir)) continue;
    let files: { name: string; mtimeMs: number }[];
    try {
      files = readdirSync(dir)
        .map((file) => {
          const st = statSync(join(dir, file));
          return st.isFile() ? { name: file, mtimeMs: st.mtimeMs } : null;
        })
        .filter((f) => f !== null);
    } catch (err) {
      console.warn(`[stories] couldn't read ${dir}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const picked = pickScriptFile(files);
    if (!picked) continue;
    let text = "";
    try {
      text = readFileSync(join(dir, picked), "utf8");
    } catch (err) {
      console.warn(`[stories] couldn't read ${picked} in ${name}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    found.push({
      slug: name,
      title: titleFromScript(name, text),
      stage: "not in the app",
      snippet: snippetFrom(text),
      where: "folder",
      current: name === currentSlug,
      markdown: text,
      folder: displayPath(folder),
    });
  }
  found.sort((a, b) => a.title.localeCompare(b.title));
  return found;
}

async function loadEntries(convex: ConvexClient, current?: { docId?: string; slug?: string }): Promise<Entry[]> {
  const [live, trashed] = await Promise.all([
    convex.query(api.stories.list, {}),
    convex.query(api.stories.list, { trashed: true }),
  ]);
  const skip = new Set(trashed.map((s) => s.slug));
  const entries: Entry[] = [];
  for (const s of live) {
    skip.add(s.slug);
    const folder = join(STORIES_DIR, s.slug);
    entries.push({
      slug: s.slug,
      title: s.title,
      stage: stageLabel(s.stage),
      snippet: (s.snippet ?? "").trim(),
      where: "app",
      current: s.docId === current?.docId || s.slug === current?.slug,
      folder: existsSync(folder) ? displayPath(folder) : undefined,
    });
  }
  entries.push(...diskEntries(skip, current?.slug));
  return entries;
}

function formatEntry(e: Entry): string {
  const here = e.current ? " · this one is open now" : "";
  return `${e.title} (${e.slug}) · ${e.stage}${here}\n${e.snippet || "(no script yet)"}`;
}

/** What list_stories shows. */
export async function describeStories(convex: ConvexClient, current?: { docId?: string; slug?: string }): Promise<string> {
  const entries = await loadEntries(convex, current);
  if (!entries.length) return "There are no stories to read yet.";
  const head =
    "Stories you can read. The snippet is the opening of the screenplay, so a description of what happens is enough to pick one. Call read_story with the title or the name in parentheses.";
  return `${head}\n\n${entries.map(formatEntry).join("\n\n")}`;
}

function formatScript(e: Entry, markdown: string, showFolder: boolean): string {
  const body = markdown.trim().slice(0, MAX_SCRIPT) || "(the script is empty)";
  const cut = markdown.trim().length > MAX_SCRIPT ? "\n\n(The screenplay was cut here. The opening is the part that shows the style.)" : "";
  const where = showFolder && e.folder ? `\nFolder: ${e.folder}` : "";
  const open = e.current ? "\nThis is the story open now." : "";
  return `${e.title} (${e.slug}) · ${e.stage}${where}${open}\n\n${body}${cut}\n\nBorrow how this screenplay is built: who speaks, how a scene turns, how long it runs, the tone. Write new jokes, a new situation and new lines. Leave its look, cast and voices alone unless someone asked for those.`;
}

function formatMany(query: string, entries: Entry[]): string {
  const lines = entries.map((e) => `- ${e.title} (${e.slug}) · ${e.stage}\n  ${e.snippet || "(no script yet)"}`);
  return `More than one story matches "${query}". Call read_story with the name in parentheses:\n\n${lines.join("\n")}`;
}

/** What read_story shows. `showFolder` is for the director, which can open the folder when asked. */
export async function readStoryScript(
  convex: ConvexClient,
  name: string,
  opts: { showFolder: boolean; current?: { docId?: string; slug?: string } },
): Promise<string> {
  const entries = await loadEntries(convex, opts.current);
  const match = matchStory(name, entries);
  if (!match.ok && match.reason === "none") {
    return `No story matches "${name}". Call list_stories to see the titles and openings.`;
  }
  if (!match.ok) {
    const wanted = new Set(match.slugs);
    return formatMany(name, entries.filter((e) => wanted.has(e.slug)));
  }
  const entry = entries.find((e) => e.slug === match.slug)!;
  if (entry.where === "folder") return formatScript(entry, entry.markdown ?? "", opts.showFolder);
  const script = await convex.mutation(api.stories.scriptBySlug, { slug: entry.slug });
  if (!script) return `No story matches "${name}". Call list_stories to see the titles and openings.`;
  return formatScript(entry, script.markdown, opts.showFolder);
}
