import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("snapshot changed documents", { minutes: 1 }, internal.docVersions.autoSnapshot, {});
crons.interval("clean up presence", { minutes: 10 }, internal.presence.cleanup, {});
export default crons;
