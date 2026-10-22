import { useMutation } from "convex/react";
import { useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMe } from "../lib/identity";

// The document this tab just created, so its title field can take focus.
let justCreated: string | null = null;
export function takeJustCreated(docId: string): boolean {
  if (justCreated !== docId) return false;
  justCreated = null;
  return true;
}

export function useCreateDoc() {
  const me = useMe();
  const create = useMutation(api.docs.create);
  const [, navigate] = useLocation();
  return async (categoryId?: Id<"categories"> | null) => {
    const id = await create({ userId: me._id, categoryId: categoryId ?? undefined });
    justCreated = id;
    navigate(`/d/${id}`);
  };
}
