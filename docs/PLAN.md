# Dynastory plan

Dynastory replaces Idea Board and Video Review with one app on gregarch. A story goes from a script to a published video
with one AI session that keeps its memory for the whole story.

## Decisions (Greg, 2026-10-19)

- Everything runs on gregarch: the web app, Convex, media, and the AI worker that drives production on the GPUs.
- Script writing stays separate: the script assistant is Claude Fable, per document, as in Idea Board. Production is
  one resumed Claude Opus session (medium effort) per story, from "Start production" to upload. A new session only
  when the user asks. The worker compacts it at about 300k tokens.
- No data is copied from the old apps; Dynastory starts empty. Muse is dropped.
- Dynastory replaces both old apps, including review of news segments and long-video clips.
- Stages: Script → Casting → Voice-over → Stills → Animatic → Animation → SFX → Final cut + QA → Packaging → Upload →
  Vertical Short.
- Approved voices go into a voice catalog that later stories can cast from.
- Review is by commenting on cuts and images; no per-item approve UI.
- Production starts the easy way (the AI works in a story folder with clips-style scripts) and moves into a shared
  pipeline owned by this repo over time.
- Users: Greg and his wife. The password-gated public path (Tailscale Funnel) stays.

## Architecture

One Bun project, started by one systemd user unit:

| process | job |
|---|---|
| convex | local Convex backend; all app data |
| web | React 19 + Vite + Tailwind front end, one origin that proxies `/api`, `/media`, `/stt` |
| media | chunked video uploads, images, range playback (from Video Review's `media/server.ts`) |
| stt | Whisper dictation (from Idea Board) |
| gate | password gate for the public Funnel path |
| director | the AI worker: one Claude Agent SDK session per story |

### Data

- From Idea Board: `users`, `categories`, `docs` (the script, ProseMirror-synced), `versions`, `chatMessages`, `presence`.
- From Video Review: `videos`, `versions`, `comments`, `notes`, `images`, `imageComments`. A video gets an optional
  `storyId`; videos without one are plain reviews (news, clips).
- New:
  - `stories`: title, script doc, stage, stage state (`working` / `awaiting_review` / `approved`), the Claude session
    id, token count, story folder on disk.
  - `storyMessages`: the user ↔ AI conversation for the story (this is the AI panel, for every stage).
  - `voices`: the catalog. Name, character notes, reference wav and its text, a sample, and the story it was approved in.

### The director

1. Watches Convex for story events: a user message, a stage change, new comments on the story's cut or images.
2. Sends each event into the story's session with `resume`. Comments arrive as one batch, the way `review_watch.py`
   reports them today.
3. The session's working directory is the story folder (`stories/<slug>/`, the clips layout). It has Bash and file tools
   for production, plus app tools over MCP: read/edit the script, post a cut or image, write a note, set the stage
   state, add a voice to the catalog.
4. When a stage's work is ready it posts the review cut and sets `awaiting_review`. Greg comments; the director feeds
   the comments back. Greg's "Approve" moves the story to the next stage.
5. Going back a stage is allowed. The AI says what has to be redone (for example, re-voiced lines break lip sync on
   their talk shots).

## Milestones

Milestones 1 to 6 were built on 2026-10-19; see the README for how it works.

1. **Merge the apps.** One repo, one Convex, the two front ends under one shell, shared components de-duplicated.
2. **Stories and the script stage.** Story list, script editor, AI panel backed by the story session.
3. **Stages and review.** Stage bar, approve and send-back, story ↔ cut linking, comments routed to the session.
4. **Casting and voice-over** end to end with Drama 3, plus the voice catalog.
5. **Stills through Vertical Short**, following `~/ai/clips/SHORT_STORY_VIDEO_PRODUCTION_GUIDE.md`.
6. **Cutover.** Point `review_site.py` and `review_watch.py` at Dynastory (done 2026-10-19; `REVIEW_SITE` reaches the
   old site). Retiring the two services on serverchy is Greg's call.
7. **Shared pipeline.** Move the per-story copied scripts into this repo as one tool set.
