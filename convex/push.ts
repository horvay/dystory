import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Turns notifications on for one browser (re-subscribing replaces its keys). */
export const subscribe = mutation({
  args: { userId: v.id("users"), endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing) await ctx.db.patch(existing._id, args);
    else await ctx.db.insert("pushSubscriptions", args);
  },
});

/** Turns them off, or drops a subscription the push service says is gone. */
export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** Whether this browser is subscribed, as far as the app knows. */
export const isSubscribed = query({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) =>
    !!(await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique()),
});

/** Every subscribed browser, for the director worker. */
export const all = query({
  args: {},
  handler: async (ctx) => {
    const subs = await ctx.db.query("pushSubscriptions").collect();
    return subs.map(({ endpoint, p256dh, auth }) => ({ endpoint, keys: { p256dh, auth } }));
  },
});
