import { describe, expect, test } from "vitest";
import {
  isStoryFolder,
  matchStory,
  pickScriptFile,
  snippetFrom,
  titleFromScript,
} from "../shared/story-catalog";

const disk = [
  { slug: "data-centers-psa", title: "data centers psa" },
  { slug: "data-center-redneck", title: "Data Centers Ain't Scary" },
  { slug: "gary-ai-takeover", title: "gary ai takeover" },
  { slug: "idle-time", title: "Idle time" },
  { slug: "the-holiday", title: "the holiday" },
  { slug: "why-you-should-pt", title: "Why you should pt" },
];

describe("story folders", () => {
  test("skips the library, the demo and anything scratched out", () => {
    expect(isStoryFolder("gary-ai-takeover")).toBe(true);
    expect(isStoryFolder("biological-needs")).toBe(true);
    expect(isStoryFolder("voice-library")).toBe(false);
    expect(isStoryFolder("lottery-breakup-demo")).toBe(false);
    expect(isStoryFolder("_scratch-wrong-script")).toBe(false);
    expect(isStoryFolder("_ig-schedule")).toBe(false);
  });
});

describe("which file is the screenplay", () => {
  test("script-current.md wins even when a later draft is newer", () => {
    expect(
      pickScriptFile([
        { name: "script-current.md", mtimeMs: 1 },
        { name: "screenplay-rev9.md", mtimeMs: 99 },
      ]),
    ).toBe("script-current.md");
  });

  test("the newest screenplay revision wins", () => {
    expect(
      pickScriptFile([
        { name: "screenplay-approved.md", mtimeMs: 10 },
        { name: "screenplay-rev4.md", mtimeMs: 20 },
        { name: "screenplay-rev5.md", mtimeMs: 30 },
      ]),
    ).toBe("screenplay-rev5.md");
  });

  test("an export beats its versioned copy and a newer snapshot", () => {
    expect(
      pickScriptFile([
        { name: "snap-j97-latest7.json", mtimeMs: 500 },
        { name: "script-1-psa-v2966.md", mtimeMs: 100 },
        { name: "script-1-psa.md", mtimeMs: 100 },
        { name: "idea-board-doc-latest7.txt", mtimeMs: 100 },
      ]),
    ).toBe("script-1-psa.md");
  });

  test("a newer versioned script beats an older export", () => {
    expect(
      pickScriptFile([
        { name: "script-1-psa.md", mtimeMs: 100 },
        { name: "script-1-psa-v3000.md", mtimeMs: 200 },
      ]),
    ).toBe("script-1-psa-v3000.md");
  });

  test("gary's idea-board text is used when that is all there is", () => {
    expect(
      pickScriptFile([
        { name: "snap-v757.json", mtimeMs: 300 },
        { name: "idea-board-doc-v755.txt", mtimeMs: 100 },
        { name: "idea-board-doc-v757.txt", mtimeMs: 200 },
      ]),
    ).toBe("idea-board-doc-v757.txt");
  });

  test("a folder of snapshots has no screenplay", () => {
    expect(pickScriptFile([{ name: "snap-v1.json", mtimeMs: 1 }])).toBeNull();
  });
});

describe("names", () => {
  test("uses a real heading and ignores a version label", () => {
    expect(titleFromScript("biological-needs", "# biological needs\n\n## Script 4\n")).toBe("biological needs");
    expect(titleFromScript("data-center-redneck", "# Data Centers Ain't Scary (Greg's script, rev 5 — notes)\n")).toBe(
      "Data Centers Ain't Scary",
    );
    expect(titleFromScript("data-centers-psa", "# Script 1 (PSA)\n\nNARRATOR\n")).toBe("data centers psa");
    expect(titleFromScript("gary-ai-takeover", "GARY\nstop chopping\n")).toBe("gary ai takeover");
  });

  test("the snippet is the opening, without the heading or a source line", () => {
    const text = `# Data Centers Ain't Scary (rev 5)\n\nI am a simple man, and I got simple questions.\n`;
    expect(snippetFrom(text)).toBe("I am a simple man, and I got simple questions.");
    const exported = `# Script 1 (PSA)\n\nSource: Idea Board doc abc (https://example.test/d/abc), snapshot version 1.\n\nNARRATOR\nMeet Gary.\n`;
    expect(snippetFrom(exported).startsWith("NARRATOR Meet Gary.")).toBe(true);
  });

  test("matches a title, a folder name, or one story's words", () => {
    expect(matchStory("Idle time", disk)).toEqual({ ok: true, slug: "idle-time" });
    expect(matchStory("idle-time", disk)).toEqual({ ok: true, slug: "idle-time" });
    expect(matchStory("the holiday", disk)).toEqual({ ok: true, slug: "the-holiday" });
    expect(matchStory("gary", disk)).toEqual({ ok: true, slug: "gary-ai-takeover" });
    expect(matchStory("pt", disk)).toEqual({ ok: true, slug: "why-you-should-pt" });
    expect(matchStory("psa", disk)).toEqual({ ok: true, slug: "data-centers-psa" });
    expect(matchStory("data center", disk)).toEqual({ ok: true, slug: "data-center-redneck" });
    expect(matchStory("scary", disk)).toEqual({ ok: true, slug: "data-center-redneck" });
  });

  test("data centers matches the PSA and the story titled Data Centers Ain't Scary", () => {
    const match = matchStory("data centers", disk);
    expect(match.ok).toBe(false);
    if (!match.ok) expect(match.slugs.sort()).toEqual(["data-center-redneck", "data-centers-psa"]);
  });

  test("data on its own is both data-center stories", () => {
    const match = matchStory("data", disk);
    expect(match.ok).toBe(false);
    if (!match.ok) expect(match.slugs.sort()).toEqual(["data-center-redneck", "data-centers-psa"]);
  });

  test("an unknown name matches nothing", () => {
    expect(matchStory("vacuum", disk)).toEqual({ ok: false, reason: "none", slugs: [] });
    expect(matchStory("", disk)).toEqual({ ok: false, reason: "none", slugs: [] });
  });
});
