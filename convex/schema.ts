import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { COMEDY_STYLES } from "../shared/comedy";
import { STAGE_IDS, STAGE_STATES } from "../shared/stages";

export const versionKind = v.union(
  v.literal("initial"),
  v.literal("auto"),
  v.literal("manual"),
  v.literal("ai-before"),
  v.literal("ai-after"),
  v.literal("before-restore"),
  v.literal("restore"),
);

export const aiStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("done"),
  v.literal("error"),
  v.literal("cancelled"),
);

// How hard the AI thinks before answering; picked with the slider in the AI panel.
export const aiEffort = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));

// Optional comedy style for a request; picked from the dropdown in the AI panel.
export const aiComedyStyle = v.union(...COMEDY_STYLES.map((s) => v.literal(s.id)));

// A passage of a document quoted in its chat. `from`/`to` are where it was
// when quoted; clients find it again by its text as the document changes.
export const chatQuote = v.object({ text: v.string(), from: v.number(), to: v.number() });


// A shape drawn on a paused frame. Points are flat [x0, y0, x1, y1, ...] in
// 0..1 of the video frame, so they line up at any player size.
export const shape = v.object({
  tool: v.union(v.literal("pen"), v.literal("arrow"), v.literal("rect")),
  color: v.string(),
  points: v.array(v.number()),
});

// What the media server reports about an uploaded file (see media/server.ts).
export const fileInfo = {
  fileId: v.string(),
  fileName: v.string(),
  size: v.number(),
  duration: v.number(),
  width: v.number(),
  height: v.number(),
  fps: v.number(),
};

export const stage = v.union(...STAGE_IDS.map((s) => v.literal(s)));
export const stageState = v.union(...STAGE_STATES.map((s) => v.literal(s)));

// What started a turn of the production AI.
export const turnKind = v.union(
  v.literal("message"), // someone wrote to it in the Director panel
  v.literal("stage"), // a stage started (approval, or a move back)
  v.literal("feedback"), // a batch of review comments
  v.literal("wake"), // a background job it was waiting on finished, or a timer
  v.literal("compact"), // the director compacting a long session
);

export default defineSchema({
  users: defineTable({
    name: v.string(),
    color: v.string(),
    // The production AI posts cuts and comments as a user too; it is never
    // offered as someone to sign in as.
    bot: v.optional(v.boolean()),
  }),

  // Sections that documents are filed under in the sidebar. A document is in
  // at most one. Categories nest; deleting one moves its documents and
  // subcategories up a level.
  categories: defineTable({
    name: v.string(),
    color: v.string(),
    // Missing for top-level categories.
    parentId: v.optional(v.id("categories")),
    // Position among its siblings, lowest first. Rewritten when people reorder.
    order: v.number(),
    createdBy: v.id("users"),
  }).index("by_order", ["order"]),

  docs: defineTable({
    title: v.string(),
    categoryId: v.optional(v.id("categories")),
    createdBy: v.id("users"),
    updatedAt: v.number(),
    lastEditedBy: v.optional(v.id("users")),
    trashed: v.boolean(),
    // Set whenever the content changes; the snapshot cron compares it with
    // lastSnapshotAt to find documents that need a new version.
    lastChangedAt: v.number(),
    lastSnapshotAt: v.number(),
    lastSnapshotVersion: v.number(),
    // People who edited since the last snapshot, credited on the next one.
    pendingAuthors: v.array(v.id("users")),
    // The script assistant's Claude session (Agent SDK), so follow-up
    // requests keep their context.
    aiSessionId: v.optional(v.string()),
    // "New conversation" moves this forward; the chat panel hides older requests.
    conversationStartedAt: v.optional(v.number()),
    // Start of the text, for previews on the home screen.
    snippet: v.optional(v.string()),
    // When someone last opened or typed in it. Two days without that and the
    // sidebar and home screen hide it as inactive; "Mark inactive" sets it to
    // 0. Missing on documents from before this existed, which go by updatedAt.
    lastOpenedAt: v.optional(v.number()),
  })
    .index("by_trashed_updated", ["trashed", "updatedAt"])
    .index("by_category", ["categoryId"]),

  docVersions: defineTable({
    docId: v.id("docs"),
    kind: versionKind,
    label: v.optional(v.string()),
    title: v.string(),
    content: v.string(), // ProseMirror JSON
    markdown: v.string(),
    pmVersion: v.number(),
    authors: v.array(v.id("users")),
    byAi: v.boolean(),
    aiRequestId: v.optional(v.id("aiRequests")),
    words: v.number(),
    added: v.number(),
    removed: v.number(),
  }).index("by_doc", ["docId"]),

  aiRequests: defineTable({
    docId: v.id("docs"),
    prompt: v.string(),
    selection: v.optional(v.string()),
    requestedBy: v.id("users"),
    // Missing on requests made before the effort slider existed.
    effort: v.optional(aiEffort),
    comedyStyle: v.optional(aiComedyStyle),
    status: aiStatus,
    response: v.string(),
    // Short human-readable log of what Claude is doing ("Reading the document").
    activity: v.array(v.string()),
    editCount: v.number(),
    // The version to go back to if this request's changes are undone.
    beforeVersionId: v.optional(v.id("docVersions")),
    // Where Claude's latest edit landed, so editors can briefly highlight it.
    lastEdit: v.optional(v.object({ from: v.number(), to: v.number(), at: v.number() })),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_doc", ["docId"]),

  // The people's chat beside each document (the Chat panel).
  chatMessages: defineTable({
    docId: v.id("docs"),
    authorId: v.id("users"),
    // Empty when the message is only a quoted passage.
    text: v.string(),
    quote: v.optional(chatQuote),
    // The message this one answers.
    replyTo: v.optional(v.id("chatMessages")),
    // Made by the sender's browser, so its optimistic copy and the saved one
    // are the same message on screen.
    clientId: v.optional(v.string()),
    // Set when its author deletes it. The row stays so replies to it can say
    // what they answered, and so "Undo" can bring it back.
    deletedAt: v.optional(v.number()),
  }).index("by_doc", ["docId"]),

  // Heartbeat from the AI worker process, so the UI can show if Claude is reachable.
  workers: defineTable({
    name: v.string(),
    lastSeen: v.number(),
  }).index("by_name", ["name"]),

  presence: defineTable({
    docId: v.id("docs"),
    sessionId: v.string(),
    userId: v.id("users"),
    lastSeen: v.number(),
    cursor: v.optional(v.object({ anchor: v.number(), head: v.number() })),
    // Last keystroke in the chat box, for "… is typing".
    typingAt: v.optional(v.number()),
  })
    .index("by_doc", ["docId"])
    .index("by_session", ["sessionId"])
    .index("by_lastSeen", ["lastSeen"]),

  // ---------------------------------------------------------------------
  // Review (from Video Review): videos, their cuts, comments, notes, images
  // ---------------------------------------------------------------------

  // A video being made: its cuts (versions), notes, and reference images.
  // It can exist before the first cut is uploaded. Story videos have a
  // storyId; the rest are plain reviews (news segments, clips).
  videos: defineTable({
    title: v.string(),
    createdBy: v.id("users"),
    updatedAt: v.number(),
    trashed: v.boolean(),
    storyId: v.optional(v.id("stories")),
    // Denormalized from the newest version, for the home grid. 0 and unset
    // until the first cut is uploaded.
    latestVersion: v.number(),
    latestFileId: v.optional(v.string()),
    latestDuration: v.optional(v.number()),
  })
    .index("by_trashed_updated", ["trashed", "updatedAt"])
    .index("by_story", ["storyId"]),

  versions: defineTable({
    videoId: v.id("videos"),
    number: v.number(),
    uploadedBy: v.id("users"),
    // Set on cuts the production AI posts: the stage it was made for and
    // what changed since the last cut.
    stage: v.optional(stage),
    summary: v.optional(v.string()),
    ...fileInfo,
  }).index("by_video", ["videoId", "number"]),

  comments: defineTable({
    videoId: v.id("videos"),
    versionId: v.id("versions"),
    authorId: v.id("users"),
    body: v.string(),
    // Replies have a parent and inherit its time; only top-level notes have one.
    parentId: v.optional(v.id("comments")),
    time: v.optional(v.number()),
    endTime: v.optional(v.number()),
    drawing: v.optional(v.array(shape)),
    resolved: v.boolean(),
    resolvedBy: v.optional(v.id("users")),
    editedAt: v.optional(v.number()),
  })
    .index("by_version", ["versionId"])
    .index("by_video", ["videoId"]),

  notes: defineTable({
    videoId: v.id("videos"),
    title: v.string(),
    body: v.string(),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_video", ["videoId"]),

  // Files live on the media server (media/server.ts); `file` and `thumb` are
  // their names under /media/images/.
  images: defineTable({
    videoId: v.id("videos"),
    uploadedBy: v.id("users"),
    file: v.string(),
    thumb: v.string(),
    fileName: v.string(),
    size: v.number(),
    width: v.number(),
    height: v.number(),
    // What the production AI says the image is ("k07 still, seed 3").
    caption: v.optional(v.string()),
  }).index("by_video", ["videoId"]),

  imageComments: defineTable({
    imageId: v.id("images"),
    authorId: v.id("users"),
    body: v.string(),
    // Where it's pinned on the image, in 0..1 of its width and height.
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    editedAt: v.optional(v.number()),
  }).index("by_image", ["imageId"]),

  // ---------------------------------------------------------------------
  // Stories: a script on its way to a published video
  // ---------------------------------------------------------------------

  stories: defineTable({
    title: v.string(),
    // Folder name under STORIES_DIR where the production AI works.
    slug: v.string(),
    docId: v.id("docs"), // the script
    videoId: v.id("videos"), // cuts, images and notes for review
    createdBy: v.id("users"),
    updatedAt: v.number(),
    trashed: v.boolean(),
    stage: stage,
    state: stageState,
    // What the production AI last said it is doing or waiting for.
    statusLine: v.optional(v.string()),
    // During a turn: the state before it began, and whether the AI set a new
    // one itself (asked for review, asked a question).
    prevState: v.optional(stageState),
    stateSet: v.optional(v.boolean()),
    // The production AI's Claude session (Agent SDK), kept for the whole
    // story; "New session" clears it. Tokens are the context size after the
    // last turn, so the director knows when to compact.
    sessionId: v.optional(v.string()),
    sessionTokens: v.optional(v.number()),
    conversationStartedAt: v.optional(v.number()),
    // Review feedback waiting to go to the production AI, and when it goes:
    // a few quiet minutes after the newest comment, or now on "Send now".
    feedbackDueAt: v.optional(v.number()),
  })
    .index("by_trashed_updated", ["trashed", "updatedAt"])
    .index("by_doc", ["docId"])
    .index("by_video", ["videoId"])
    .index("by_slug", ["slug"]),

  // One turn of a story's production AI: what it was told, what it did.
  turns: defineTable({
    storyId: v.id("stories"),
    kind: turnKind,
    // What the AI is sent.
    prompt: v.string(),
    // What the Director panel shows for it (the message, or "Voice-over started").
    display: v.string(),
    requestedBy: v.optional(v.id("users")),
    status: aiStatus,
    response: v.string(),
    activity: v.array(v.string()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    // A turn picking up after restarts cut off the one before: how many in a row.
    resumes: v.optional(v.number()),
  })
    .index("by_story", ["storyId"])
    .index("by_status", ["status"]),

  // A review comment, image comment or note change not yet sent to the
  // production AI.
  feedback: defineTable({
    storyId: v.id("stories"),
    kind: v.union(v.literal("comment"), v.literal("reply"), v.literal("imageComment"), v.literal("note")),
    refId: v.string(),
    authorId: v.id("users"),
    sentAt: v.optional(v.number()),
  })
    .index("by_story_sent", ["storyId", "sentAt"]),

  // Something the production AI is waiting for between turns: a background
  // job to exit, or a time to come. The director wakes it up with a turn.
  // Jobs run as transient systemd user units, so restarting the app doesn't
  // kill a render.
  wakeups: defineTable({
    storyId: v.id("stories"),
    note: v.string(),
    unit: v.optional(v.string()),
    log: v.optional(v.string()),
    at: v.optional(v.number()),
    status: v.union(v.literal("waiting"), v.literal("fired"), v.literal("cancelled")),
    firedAt: v.optional(v.number()),
    // Set by the Stop button; the director stops the unit and clears it.
    stopUnit: v.optional(v.boolean()),
    // A B70 job still waiting in the b70q queue: its place in line.
    queue: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_story", ["storyId"]),

  // Voices approved in a story, ready to cast in later ones.
  voices: defineTable({
    name: v.string(),
    // Who it was made for and what it sounds like.
    character: v.optional(v.string()),
    description: v.string(),
    // The cloning reference: a wav on this machine and its exact transcript.
    refPath: v.string(),
    refText: v.string(),
    // A playable copy under /media/audio/.
    audioFile: v.string(),
    duration: v.number(),
    // Generation notes: model, cues, capacity, anything needed to reuse it.
    notes: v.optional(v.string()),
    storyId: v.optional(v.id("stories")),
    createdBy: v.id("users"),
    trashed: v.boolean(),
  }).index("by_trashed", ["trashed"]),

  // Browsers that turned on notifications (Web Push). The director sends to
  // all of them when it hands a story back to people.
  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  }).index("by_endpoint", ["endpoint"]),
});
