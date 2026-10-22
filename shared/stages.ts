// The stages a story goes through, from the first draft to a published Short.
// Shared by the app (the stage bar) and the director (what to tell the AI
// when a stage starts).
export const STAGES = [
  {
    id: "script",
    label: "Script",
    hint: "Write the screenplay with the script assistant.",
    goal: "",
  },
  {
    id: "casting",
    label: "Casting",
    hint: "Pick or design a voice for every speaking character.",
    goal: `Cast every speaking character. Check the voice catalog first (list_voices): reuse a catalogued voice when it fits the character, otherwise design a new one with Fish Audio Drama 3 (see ~/ai/clips/short-stories/voice-library/README.md for auditions). Post an audition cut for review: a dark card per character with the character's name and the line being read, each candidate voice reading two or three of that character's lines from the script. Name the candidates on the card so comments can refer to them.`,
  },
  {
    id: "voiceover",
    label: "Voice-over",
    hint: "Voice every line and build the VO master.",
    goal: `Voice the whole script with the approved voices (Drama 3 on the B70, 8 takes per line, picked as a matching set), build the VO master and its timeline, and post a voice-only review cut: a dark card with the speaker and the line on screen for each line. WhisperX on the master must read the script word for word.`,
  },
  {
    id: "stills",
    label: "Stills",
    hint: "Character sheets, sets and one still per shot.",
    goal: `Make the stills: character sheets, sets, and one still per planned shot, with identity text kept identical across stills. Post every still to the Images tab (post_image) so each can be commented on, then plan the shots (shots_vNN.py).`,
  },
  {
    id: "animatic",
    label: "Animatic",
    hint: "Stills cut to the voice-over, with captions.",
    goal: `Assemble the animatic: the stills cut to the approved VO master following the shot plan, with authored captions burned in. Post it as a review cut.`,
  },
  {
    id: "animation",
    label: "Animation",
    hint: "Animate every shot (MiniMax H3 on the B70).",
    goal: `Animate every shot with MiniMax H3 Ref2VA on the B70, review each take (sheet, frames, SyncNet for talk shots) and retake the bad ones, then assemble the animated cut with captions and post it.`,
  },
  {
    id: "sfx",
    label: "Sound",
    hint: "Sound effects and ambience.",
    goal: `Add sound effects and ambience (Stable Audio 3 through ComfyUI), placed on the timeline and levelled against the VO, and post the cut.`,
  },
  {
    id: "final",
    label: "Final cut",
    hint: "Full-quality render and QA.",
    goal: `Render the final 1080p cut (ask before using the 3080 for upscaling), loudness -14 LUFS, run tools/qa_cut.sh and the caption validation, write the QA note, and post the final cut.`,
  },
  {
    id: "packaging",
    label: "Packaging",
    hint: "Title, thumbnail, description.",
    goal: `Write the packaging: title candidates, thumbnails (1280x720, checked at 168x94) posted to the Images tab, description, chapters and hashtags. Keep 06-thumbnails/PACKAGING.md as the source of truth and mirror it to a note titled "Packaging".`,
  },
  {
    id: "upload",
    label: "Upload",
    hint: "Publish the landscape video to YouTube.",
    goal: `Upload the approved landscape cut to YouTube with tools/youtube_upload.py. Before anything goes public, ask which channel and which visibility (or schedule) to use, and wait for the answer in the chat. Run with --dry-run first. Report the video URL when done.`,
  },
  {
    id: "short",
    label: "Short",
    hint: "The vertical 1080x1920 version.",
    goal: `Reframe the approved cut as a vertical 1080x1920 Short with captions (the-holiday/08-short is the reference), post it for review, and upload it only after it is approved and the visibility has been confirmed in the chat.`,
  },
  {
    id: "done",
    label: "Done",
    hint: "Published.",
    goal: "",
  },
] as const;

export type StageId = (typeof STAGES)[number]["id"];
export const STAGE_IDS = STAGES.map((s) => s.id) as StageId[];

export const stageInfo = (id: StageId) => STAGES.find((s) => s.id === id)!;
export const stageIndex = (id: StageId) => STAGE_IDS.indexOf(id);
export const nextStage = (id: StageId): StageId => STAGE_IDS[Math.min(stageIndex(id) + 1, STAGE_IDS.length - 1)]!;

/**
 * Where a story is within its stage.
 * - writing: the script stage, people and the script assistant at work
 * - working: the production AI is making this stage's work
 * - review: the work is posted and waits for comments or approval
 * - waiting: the production AI asked a question or hit a problem it can't solve alone
 * - done: published
 */
export const STAGE_STATES = ["writing", "working", "review", "waiting", "done"] as const;
export type StageState = (typeof STAGE_STATES)[number];
