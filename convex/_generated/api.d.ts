/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as bots from "../bots.js";
import type * as categories from "../categories.js";
import type * as chat from "../chat.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as director from "../director.js";
import type * as docVersions from "../docVersions.js";
import type * as docs from "../docs.js";
import type * as feedback from "../feedback.js";
import type * as images from "../images.js";
import type * as notes from "../notes.js";
import type * as presence from "../presence.js";
import type * as push from "../push.js";
import type * as requests from "../requests.js";
import type * as snapshots from "../snapshots.js";
import type * as stories from "../stories.js";
import type * as sync from "../sync.js";
import type * as turns from "../turns.js";
import type * as users from "../users.js";
import type * as videos from "../videos.js";
import type * as voices from "../voices.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  bots: typeof bots;
  categories: typeof categories;
  chat: typeof chat;
  comments: typeof comments;
  crons: typeof crons;
  director: typeof director;
  docVersions: typeof docVersions;
  docs: typeof docs;
  feedback: typeof feedback;
  images: typeof images;
  notes: typeof notes;
  presence: typeof presence;
  push: typeof push;
  requests: typeof requests;
  snapshots: typeof snapshots;
  stories: typeof stories;
  sync: typeof sync;
  turns: typeof turns;
  users: typeof users;
  videos: typeof videos;
  voices: typeof voices;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  prosemirrorSync: import("@convex-dev/prosemirror-sync/_generated/component.js").ComponentApi<"prosemirrorSync">;
};
