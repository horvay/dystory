// The stages a story goes through, from the first draft to a published Short.
// Shared by the app (the stage bar) and the director (what to tell the AI
// when a stage starts).
//
// There are two kinds of story, each with its own stage list:
// - "story": a script the director voices, draws and animates (STAGES)
// - "remake": a cartoon video remade as live action in ~/Music/make_real
//   (REMAKE_STAGES). It has no script; it starts from a source video.
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
    id: "animatic",
    label: "Animatic",
    hint: "Character looks, then stills cut to the voice-over, with captions.",
    goal: `Start with the character profiles, before any stills. For every character who appears on screen, look for an existing profile in the character catalog (list_characters) and in finished stories' 02-characters folders; reuse it when it fits, otherwise design one: a model sheet and identity text (age, face, hair, build, wardrobe, props) in the story's art style. Check every profile against this script, whether reused or new: its age, look, wardrobe, props and art style must suit what the story needs. Adapt the ones that don't and note what changed. Write the profiles to 02-characters/character-bible.md, post each model sheet (post_image) with a caption naming the character, where the profile came from (the catalog, an earlier story, or new) and what you changed, then call request_review with step "the character looks" and end the turn. Make no stills until the looks are approved. Once they are, add every new or changed profile to the character catalog (add_character); a catalogued profile you changed for this story goes in as a new entry named for the difference ("Gary (no hat)"), since older stories still use the original. Then make the stills: sets and one still per planned shot, using the approved model sheets and identity text kept identical across stills. Post every still to the Images tab (post_image) so each can be commented on, then plan the shots (shots_vNN.py). Assemble the animatic: the stills cut to the approved VO master following the shot plan, with authored captions burned in, and post it as a review cut. Don't stop for a review of the stills on their own: people approve the stills and the animatic together, so request review once the animatic is posted, with the animatic and the stills on the card.`,
  },
  {
    id: "animation",
    label: "Animation",
    hint: "Animate every shot (MiniMax H3 on the B70).",
    goal: `Before building any shot, decide for each one where its still falls in the motion: the first frame (the shot moves away from it), the last frame (the shot builds up to it, like a reaction or an aftermath), or a middle frame (the still is the peak of an action that starts before it and carries on after). Judge it from what happens in the shot in the script and the animatic, not by default. Write the choice and a one-line reason for every shot into the shot plan, then pin the still at that frame in guides.txt: frame 0, the last kept frame (keep, or frames - 1 if smaller; frames past keep are cut at assembly), or the middle of the kept frames (keep // 2). Word prompt.txt to match ("<Picture 1> is the last frame of this shot", not "the opening frame") and describe the motion leading into the still as well as away from it. Then animate every shot with MiniMax H3 Ref2VA on the B70, review each take (sheet, frames, SyncNet for talk shots) and retake the bad ones, then assemble the animated cut with captions and post it.`,
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

/**
 * A remake: a cartoon video (a link or a file) remade as live action on the
 * depth route in ~/Music/make_real. Its last stages share their ids with a
 * story's, with goals of their own.
 */
export const REMAKE_STAGES = [
  {
    id: "source",
    label: "Source",
    hint: "The cartoon video to remake, and what to watch out for.",
    goal: "",
  },
  {
    id: "breakdown",
    label: "Breakdown",
    hint: "Scene map, depth video, lyrics, and the cast.",
    goal: `Set the song up and work out who is in it. The source and the notes people gave are in BRIEF.md beside the song root. A link: download it with yt-dlp at the best quality it has. A file: use it where it is. Look at the source's real picture area and choose the 16:9 crop, then run scripts/depth-route/new-song.sh and follow scripts/depth-route/README.md steps 1 to 3: extract every frame, write the scene map (units.tsv, one unit per camera setup, editorial spans marked), build the depth video (./dr depth-all), read every audit row (./dr audit-sheets), and transcribe with WhisperX large-v3. Then the cast: name every character who appears, and match each to profiles/<name>/ (the active profile image and its direction: who sings, the standing rules). A character without a profile gets one: have chatgpt-image-maker draw a live-action portrait from clean cartoon frames of that character, check it yourself, and install it with new-profile.sh. Post each character's profile (post_image) with a caption naming the character, whether the profile already existed or is new, and whether they sing in this video. Write a note titled "Scene map" with one line per unit: its time in the video, what happens, who is in it. Then call request_review. People are approving the cast: the faces and who sings. Make no opening stills before that.`,
  },
  {
    id: "stills",
    label: "Stills",
    hint: "One live-action opening still per shot, beside its cartoon frame.",
    goal: `Make the opening still of every unit. Write prompts/song.ts and stills/desc.tsv from the audit rows (rules: docs/PROMPTING-DEPTH.md; cast direction from each profile.json, plus anything people said in the brief or when they approved the cast) until ./dr prompts prints no ERROR and you have read every WARN. ./dr cartoons, then have chatgpt-image-maker make stills/UNIT/chatgpt-1.png for every unit. Check each still against its cartoon frame on ./dr still-sheets before anyone sees it: framing, person count, eyes, mouth, clothes, stray lettering, hands. Redo the ones that fail (a new still, or a single-image edit). When every unit has a still you would approve, post one image per unit (post_image): the cartoon frame on the left and the still on the right, side by side, captioned with the unit and its time in the video ("Scene 07, 0:21: Jem at the mic"). Then call request_review. Don't run ./dr approve and don't render anything before people approve the stills.`,
  },
  {
    id: "render",
    label: "Render",
    hint: "Every shot rendered (MiniMax H3 on the B70), reviewed and retaken.",
    goal: `The stills are approved: run ./dr approve on every unit (use the still people approved, including any edit), then render. Start the driver with start_job ("./dr drive" in the song root; it submits its own B70 jobs one at a time, so leave gpu unset) and start a second job "./dr wait 6" so you are woken as takes land. On each wake: ./dr queue, hand each group of 6 to a take-reviewer agent, ./dr queue done for the ones reviewed, look yourself at every take a reviewer fails, and retake those (./dr stage UNIT, ./dr retake ATTEMPT UNIT...): change the smallest input the evidence points to and keep the seed. Start ./dr wait again while units are missing. Every 5 newly passed units, build a partial of all passed footage (./dr partial) and post its compressed copy as a cut so people can watch the song come together; comments on a partial are the grade, fix them before going on. When every unit has a PASS and ./dr check-takes shows no FAIL, post the cut of every unit in source order and call request_review.`,
  },
  {
    id: "final",
    label: "Final cut",
    hint: "Transitions, titles, loudness and QA.",
    goal: `Build the finished cut. Rebuild every editorial span of the cartoon in edit.sh and editorial/fx.sh (wipes, dissolves, fades, titles with their exact wording, case, timing and placement; test each effect with ./dr try-fx, and both shots under an effect keep moving), then ./dr assemble. Verify before posting: the frame count against the source span, 1920x1080, loudness near -14 LUFS with true peak near -1.5 dBTP, every transition and title at full resolution, and six even frames of each scene against the cartoon. Post the compressed copy of the master (post_cut) and call request_review. Keep the master in output/.`,
  },
  {
    id: "packaging",
    label: "Packaging",
    hint: "Title, thumbnail, description.",
    goal: `Make the packaging the way docs/PUBLISHING.md describes: about 10 thumbnail candidates (a ChatGPT picture of a moment from the cut with the title sign laid over it, 1280x720, each checked against the cast direction), the title, the description and the tags. Post every thumbnail candidate (post_image) so people can pick, and write a note titled "Packaging" with the title, description and tags. Then call request_review.`,
  },
  {
    id: "upload",
    label: "Upload",
    hint: "Publish the video to YouTube.",
    goal: `Upload the approved master to YouTube following docs/PUBLISHING.md (the master from ./dr assemble, never a compressed review copy). Before anything goes public, ask which channel and which visibility or schedule to use, and wait for the answer in the thread. Run with --dry-run first. Report the video URL when done.`,
  },
  {
    id: "short",
    label: "Short",
    hint: "The vertical 1080x1920 version.",
    goal: `Make the vertical 1080x1920 Short of the approved master following scripts/shorts/README.md (the title sign on top, the whole picture letterboxed, word-by-word lyric captions under it), post it for review, and upload it only after it is approved and the visibility has been confirmed in the thread.`,
  },
  {
    id: "done",
    label: "Done",
    hint: "Published.",
    goal: "",
  },
] as const;

export type StageId = (typeof STAGES)[number]["id"] | (typeof REMAKE_STAGES)[number]["id"];
export type StoryKind = "story" | "remake";
export const STORY_KINDS = ["story", "remake"] as const;

type StageInfo = { id: StageId; label: string; hint: string; goal: string };
const PIPELINES: Record<StoryKind, readonly StageInfo[]> = { story: STAGES, remake: REMAKE_STAGES };

/** Every stage id of either kind, for the database's validator. */
export const STAGE_IDS = [...new Set([...STAGES, ...REMAKE_STAGES].map((s) => s.id))] as StageId[];

/** The stages a story of this kind goes through, in order. A missing kind is a story. */
export const stagesOf = (kind?: StoryKind): readonly StageInfo[] => PIPELINES[kind ?? "story"];

/**
 * A stage's label, hint and goal. Pass the story's kind for a goal: the last
 * stages share an id between the kinds and differ in what they ask for.
 * Without a kind (a label for a cut or a divider) either kind's entry does.
 */
export const stageInfo = (id: StageId, kind?: StoryKind): StageInfo =>
  (kind ? stagesOf(kind).find((s) => s.id === id) : undefined) ??
  STAGES.find((s) => s.id === id) ??
  REMAKE_STAGES.find((s) => s.id === id)!;

export const stageIndex = (id: StageId, kind?: StoryKind) => stagesOf(kind).findIndex((s) => s.id === id);

export const nextStage = (id: StageId, kind?: StoryKind): StageId => {
  const stages = stagesOf(kind);
  return stages[Math.min(stageIndex(id, kind) + 1, stages.length - 1)]!.id;
};

/** The first stage of a kind: people prepare it (a script, a source) before the director starts. */
export const firstStage = (kind?: StoryKind): StageId => stagesOf(kind)[0]!.id;

/** Whether this is a stage people work on before production: the script, or a remake's source. */
export const isSetupStage = (id: StageId) => id === "script" || id === "source";

/**
 * Where a story is within its stage.
 * - writing: the first stage (script or source), people at work
 * - working: the production AI is making this stage's work
 * - review: the work is posted and waits for comments or approval
 * - waiting: the production AI asked a question or hit a problem it can't solve alone
 * - done: published
 */
export const STAGE_STATES = ["writing", "working", "review", "waiting", "done"] as const;
export type StageState = (typeof STAGE_STATES)[number];
