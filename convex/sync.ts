import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { components } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";

export const prosemirrorSync = new ProsemirrorSync<Id<"docs">>(components.prosemirrorSync);

// Exposed to the browser's useTiptapSync hook as `api.sync`.
export const { getSnapshot, submitSnapshot, latestVersion, getSteps, submitSteps } =
  prosemirrorSync.syncApi<DataModel>({
    checkWrite: async (ctx, id) => {
      const doc = await ctx.db.get(id);
      if (!doc) throw new Error("Document not found");
    },
    onSnapshot: async (ctx, id) => {
      const doc = await ctx.db.get(id);
      if (doc) await ctx.db.patch(id, { lastChangedAt: Date.now() });
    },
  });
