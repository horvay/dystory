import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { DIRECTOR_COLOR, DIRECTOR_NAME } from "../shared/director";

/** The user the production AI posts as, created the first time it's needed. */
export async function directorUser(ctx: MutationCtx): Promise<Id<"users">> {
  const existing = (await ctx.db.query("users").collect()).find((u) => u.bot && u.name === DIRECTOR_NAME);
  if (existing) return existing._id;
  return ctx.db.insert("users", { name: DIRECTOR_NAME, color: DIRECTOR_COLOR, bot: true });
}

export async function isBot(ctx: QueryCtx, userId: Id<"users">) {
  return !!(await ctx.db.get(userId))?.bot;
}
