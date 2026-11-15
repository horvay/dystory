<img src="assets/icon.svg" width="64" height="64" alt="">

# Dynastory

A studio for short AI-made comedy videos, from the first line of a script to a published YouTube video. It replaced
Idea Board (scripts) and Video Review (cuts and comments) on 2026-10-19 and runs on gregarch. It was called Dystory
until 2026-10-23; the folder, the systemd service, the repo, storage keys and job units still use `dystory`.

A story moves through stages (a [remake](#remakes) has its own):

**Script → Casting → Voice-over → Animatic → Animation → Sound → Final cut → Packaging → Upload → Short**

- **Script**: write it with the script assistant (Claude Fable or Muse) in the editor Idea Board had: live
  co-editing, the people chat, history, comedy styles, dictation. The picker under the chat box chooses the
  model, and each document keeps a separate conversation with each one. It can read the other stories'
  screenplays, so "make one like Idle time" borrows that story's shape and tone and writes new jokes.
- **Start production**: the story's **director** takes over. It's one Claude Opus session (medium effort) that keeps
  its context for the whole story. It works in `~/ai/clips/short-stories/<slug>/` with the clips tools and GPUs, and
  posts every cut, still and note to the story's page.
- **The story page** is a thread: the stages down the left, the director's messages in the middle, and whenever it
  asks for review, a card with the cut and images it wants looked at, right there. Under the thread, a glowing
  decision bar: **Approve** (the director starts the next stage) or **Not good…** (say why, by typing or dictating,
  pointing at images or a moment of the cut; it goes back to the director at once). The box under it writes to the
  director. Nobody has to open Cuts, Images or Notes (links under the stages) to finish a stage.
- **Notes along the way**: "Add a note at 0:12" under a cut, "Leave a note on this" on an image, or the corner checks
  of several images open a note box right there (amber, so it isn't mistaken for the director's box at the bottom).
  Notes (and comments made in Cuts, Images and Notes) go to the director together three quiet minutes after the last
  one; "Send now" skips the wait, and an approval, a "Not good" or a message to the director takes waiting notes along.
- **Redo or skip**: a stage's `⋯` menu in the left rail ("Redo from here…", "Skip ahead to here…"), confirmed first.
  Clicking a stage only scrolls the thread to it.
- Voices approved at casting go into the **voice catalog** (Voices in the sidebar), which later stories cast from.
- **Character looks come first in Animatic.** The director finds each on-screen character in the **character
  catalog** (Characters in the sidebar) or an earlier story, or designs a new profile, and checks each one fits this
  story. It posts the model sheets and stops for "Approve the character looks" before making any stills. That approval
  only lets it carry on with Animatic, and new profiles go into the catalog.

Plain reviews (news segments, long-video clips) still work as they did on Video Review: Reviews in the sidebar, or
`~/ai/clips/tools/review_site.py`.

## Remakes

A **remake** is a second kind of story: a cartoon video (usually a song) remade as live action, shot for shot. It has
no script. "New remake" on the home page or "Remake" above the story list starts one, and it moves through its own
stages:

**Source → Breakdown → Stills → Render → Final cut → Packaging → Upload → Short**

- **Source**: a link (YouTube, or anything yt-dlp downloads) or a video file, plus notes for the director ("Aja
  never sings"). "Start the remake" hands it over.
- **Breakdown**: the director gets the video, maps every shot, builds the depth video and the transcript, and works
  out the cast. You approve **the cast**: each character's profile and who sings.
- **Stills**: one ChatGPT opening still per shot, posted beside its cartoon frame. You approve **the stills**. Nothing
  renders before that.
- **Render**: MiniMax H3 on the B70, every take reviewed and the bad ones retaken. A partial cut lands in the thread
  every 5 finished shots; the stage's review is the whole video in source order.
- **Final cut** onward works like a story's last stages: transitions and titles, packaging, YouTube, the Short.

The work itself lives in `~/Music/make_real` (the depth route: `scripts/depth-route/README.md`, `AGENTS.md`). The
remake's director runs there, in that repo, so it loads its rule book and its two helper agents
(`chatgpt-image-maker`, `take-reviewer`). Each remake's song root is `make_real/work/<slug>/depth/`, and Dynastory
writes `work/<slug>/BRIEF.md` (the source and the notes) before every turn.

**A song already in progress** in make_real can be brought in: "New remake" → "A song in progress" lists the song
folders that have a depth-route root. Say which stage it has reached; the director reads the song's README, posts its
newest cut to the thread and carries on from there. A song folder belongs to one remake.

What differs from a story, in the code:

| | Story | Remake |
|---|---|---|
| `stories.kind` | missing or `"story"` | `"remake"` |
| First stage | `script` (a document) | `source` (`stories.source`: `url`, `file` or `adopt`, plus `notes`) |
| Stages | `STAGES` in `shared/stages.ts` | `REMAKE_STAGES` (the last four share ids with a story's, with their own goals) |
| Director runs in | `~/ai/clips/short-stories/<slug>/` | `~/Music/make_real` (song root `work/<slug>/depth/`) |
| Instructions | `worker/director-prompt.md` | `worker/remake-prompt.md` |
| Model | `DIRECTOR_MODEL` (Opus) | `REMAKE_MODEL` (Fable) |
| App tools | all of `studio-tools.ts` | the same minus the script, voice, character and story-catalog tools |

`./dr drive` and `./dr retake` submit their own B70 jobs one at a time, so `start_job` never puts those two commands
in the B70 queue themselves, whatever `gpu` says (`queuesItself` in `worker/jobs.ts`).

## Run it

```sh
bun install          # first time only
bun run stt:setup    # first time only: builds Whisper for dictation (STT_GPU=0 for CPU only, as here)
bun run start        # builds the app and starts everything
bun run dev          # the same with live reload, while working on the code
```

On gregarch it runs as a systemd user service:

```sh
cp deploy/dystory.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now dystory
systemctl --user restart dystory        # after changing the code
journalctl --user -u dystory -f         # logs
```

`node` must be the system one (`/usr/bin/node`): mise's shim has no node configured globally, so `convex dev` fails
under it. The unit's PATH takes care of that; in a shell, run `PATH=/usr/bin:$PATH bun run dev`.

Open:

- **On the tailnet:** https://gregarch.tail061b9a.ts.net:5190 (no password)
- **Anyone, anywhere:** https://gregarch.tail061b9a.ts.net:10000 (asks for the site password once per device)

```sh
tailscale serve  --bg --https=5190  http://127.0.0.1:5190   # tailnet, straight to the app
tailscale funnel --bg --https=10000 http://127.0.0.1:5192   # public, through the password gate
tailscale funnel --https=10000 off                          # stop public access
```

`SITE_GATE_PASSWORD` in `.env.local` is the public password. People on the tailnet and this machine are never asked.

| Process     | Port | What it does |
|-------------|------|--------------|
| `convex`    | 3210 | Local Convex backend; data in `.convex/` |
| `web`       | 5190 | The app. Proxies `/api` to Convex, `/media` to the media server and `/stt` to dictation, so one port is all a browser needs. |
| `media`     | 5191 | Cuts (chunked uploads, range playback, thumbnails), images and voice samples, stored in `data/` |
| `gate`      | 5192 | Password gate in front of the app for public visitors |
| `stt`       | 5193 | Whisper `small.en` (CPU) for dictation |
| `assistant` |      | The script assistant (`worker/script-assistant.ts`, Claude Fable or Muse) |
| `director`  |      | The production AI (`worker/director.ts`, Claude Opus) |

## How the director works

- **Turns.** Everything that needs the director becomes a turn in Convex (`turns`): a stage starting, a batch of
  review feedback, a message in the thread, a background job finishing. The worker runs them one at a time
  per story (up to four stories at once), resuming the story's Agent SDK session each time.
- **Its tools.** Every Claude Code tool, with permissions bypassed (nobody is at a terminal), plus the app tools in
  `worker/studio-tools.ts`: `post_cut`, `post_image`, `write_note`, `reply_to_comment`, `resolve_comment`,
  `request_review`, `ask_user`, `start_job`, `wake_me_in`, `list_voices`, `add_voice`, `list_characters`,
  `add_character`, `read_script`, `edit_script`, `list_stories`, `read_story` and more. `list_stories` and
  `read_story` are also on the script assistant. They return the screenplay (from the app, or from `00-script/`
  for a story that was never imported) and nothing else. It loads Greg's global Claude settings (GPU rules, browser leases).
- **Its instructions** are `worker/director-prompt.md` plus `worker/writing-style.md`, re-read every turn. Each
  stage's goal is in `shared/stages.ts`.
- **Long jobs** (TTS batches, H3 renders) go through `start_job`. B70 work (`gpu: "b70"`, or any command that calls
  `b70-lease`) is submitted to the b70q queue over its socket (`~/b70/queue/README.md`) with owner
  `dystory-<slug>-<kind>`; the daemon runs it in `b70q-<id>.service` when its turn comes. Other jobs run as transient
  systemd user units (`dystory-<slug>-…`). Restarting Dynastory kills neither. The director checks every 15 s, shows a
  waiting B70 job's place in line, and wakes the AI with the job's exit code and log tail. Logs are in
  `<story folder>/.director/jobs/`. Stop buttons in the decision bar stop the unit or kill the ticket.
- **Restarts.** A restart kills whatever turn is running (and its foreground commands). At startup the worker marks
  those turns cut off and queues a turn in the same session telling the director to check what was half-done and
  carry on (`resetStale` in `convex/director.ts`). The session ID is saved as soon as a turn starts, so this works for
  a story's first turn too. After three cut-offs in a row it stops and asks instead. Background jobs aren't affected.
- **Requests** (`requests`, `convex/requests.ts`): each `request_review` or `ask_user` call is a card in the thread.
  It shows the cuts and images the director posted since its last request (or the ones it names), and is `open`
  until someone approves, says "Not good" (`changes`), answers, or a newer request replaces it. A review with a `step`
  ("the character looks") approves one step inside the stage: Approve queues a `step` turn telling the director to
  carry on, and the story stays on its stage. Every cut and image
  the director posts records its turn, so the thread shows it there too. `stories.get` returns the open one for the
  decision bar.
- **Where the story stands** (`stories.state`): `writing` (script stage), `working` (the director is on it),
  `review` (it asked for review), `waiting` (it asked a question, failed, or stopped), `done`. The status bar shows it,
  with the matching action.
- **Context.** After each turn the director records the session's context size. Past 300k tokens it queues a
  `/compact` turn. "New director session…" in the story's `⋯` menu starts over; the director then catches up from the story's
  README and folder.
- **Feedback batching.** Comments, replies, image comments and note edits on a story are recorded in `feedback`.
  Three quiet minutes after the newest one (`FEEDBACK_QUIET_MS` in `shared/director.ts`) they go to the director as
  one turn.

- **Notifications.** "Turn on notifications" in the sidebar subscribes that browser to Web Push (Chrome
  notifications, even with no Dynastory tab open). When a turn ends with the story handed back to people (ready for
  review, a question, a failure, or a reply), `director.finish` returns the notification and `worker/notify.ts` sends
  it to every subscribed browser. Nothing is sent while a background job runs, when another turn is already queued,
  or when someone stopped the turn. The service worker (`public/sw.js`) skips it if that story is open and focused.
  Keys: `VITE_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` in `.env.local`. Changing them means every
  browser has to turn notifications on again.

Settings (`.env.local` or the environment): `DIRECTOR_MODEL` (default `claude-opus-5-5`), `DIRECTOR_EFFORT`
(`medium`), `DIRECTOR_CONCURRENCY` (4), `AI_MODEL` for the script assistant's Claude (`claude-fable-5-2`),
`MUSE_MODEL` to override Muse, `STORIES_DIR`
(`~/ai/clips/short-stories`), `MEDIA_DIR` (`./data`), `APP_URL` (the address used in links the director writes).
For remakes: `REMAKE_MODEL` (`claude-fable-5-2`), `REMAKE_EFFORT` (the director's effort unless set), `REMAKE_DIR`
(`~/Music/make_real`).

## Layout

```
convex/        backend: documents and their history, the script assistant's queue, stories, turns,
               feedback, wakeups, voices, characters, videos/versions/comments/notes/images (review)
shared/        editor schema + Markdown, stages, director settings
src/           React app: components/ (shell, sidebar, home, documents, reviews), story/ (story page: stage
               rail, thread, decision bar, a remake's Source page), voices/, characters/, player/, notes/, images/, panels/ (script assistant, chat, history)
worker/        script-assistant.ts, director.ts, studio-tools.ts, jobs.ts, media.ts, prompts
               (director-prompt.md for stories, remake-prompt.md for remakes)
media/         media server
gate/          password gate
stt/           dictation
deploy/        systemd unit
```
