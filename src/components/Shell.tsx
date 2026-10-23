import { useQuery } from "convex/react";
import { createContext, useContext, useEffect, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import { useMe } from "../lib/identity";
import { useMediaQuery, cn } from "../lib/hooks";
import { useNotificationClicks } from "../lib/notifications";
import { Avatar } from "./Avatar";
import { DocPage } from "./DocPage";
import { Home } from "./Home";
import { ProfileDialog } from "./ProfileDialog";
import { ReviewsHome } from "./ReviewsHome";
import { Sidebar } from "./Sidebar";
import { StoryPage } from "../story/StoryPage";
import { ToastProvider } from "./Toast";
import { UploadsProvider } from "./Uploads";
import { VideoPage } from "./VideoPage";
import { VoicesPage } from "../voices/VoicesPage";

type ShellCtx = { sidebarOpen: boolean; toggleSidebar: () => void; isWide: boolean; onSwitchUser: () => void };
const Ctx = createContext<ShellCtx>({ sidebarOpen: true, toggleSidebar: () => {}, isWide: true, onSwitchUser: () => {} });
export const useShell = () => useContext(Ctx);

export function Shell({ onSwitchUser }: { onSwitchUser: () => void }) {
  const isWide = useMediaQuery("(min-width: 1024px)");
  const [sidebarOpen, setSidebarOpen] = useState(isWide);
  const [location] = useLocation();
  useNotificationClicks();
  useWaitingTitle();
  useScrollClosesKeyboard();

  useEffect(() => setSidebarOpen(isWide), [isWide]);
  // On narrow screens the sidebar is a drawer; close it after navigating.
  useEffect(() => {
    if (!isWide) setSidebarOpen(false);
  }, [location, isWide]);

  const toggleSidebar = () => setSidebarOpen((o) => !o);

  return (
    <Ctx.Provider value={{ sidebarOpen, toggleSidebar, isWide, onSwitchUser }}>
      <ToastProvider>
        <UploadsProvider>
          <div className="flex h-full overflow-hidden">
            {isWide ? (
              <aside
                className={cn(
                  "shrink-0 overflow-hidden border-r border-line bg-sidebar transition-[width] duration-200",
                  sidebarOpen ? "w-72" : "w-0 border-r-0",
                )}
              >
                <div className="h-full w-72">
                  <Sidebar onSwitchUser={onSwitchUser} />
                </div>
              </aside>
            ) : (
              <>
                <div
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] transition-opacity",
                    sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
                  )}
                />
                <aside
                  className={cn(
                    "fixed inset-y-0 left-0 z-50 w-[min(20rem,85vw)] bg-sidebar transition-transform duration-200",
                    sidebarOpen ? "translate-x-0 shadow-float" : "-translate-x-full",
                  )}
                >
                  <Sidebar onSwitchUser={onSwitchUser} />
                </aside>
              </>
            )}
            <main className="relative min-w-0 flex-1">
              <Switch>
                <Route path="/s/:id/:tab?/:item?">
                  {(params) => {
                    // wouter's types miss optional params in this pattern.
                    const p = params as unknown as { id: string; tab?: string; item?: string };
                    return <StoryPage key={p.id} storyId={p.id} tab={p.tab} item={p.item} />;
                  }}
                </Route>
                <Route path="/d/:id">{(p) => <DocPage key={p.id} docId={p.id} />}</Route>
                <Route path="/v/:id/:tab?/:item?">
                  {(params) => {
                    const p = params as unknown as { id: string; tab?: string; item?: string };
                    return <VideoPage key={p.id} videoId={p.id} tab={p.tab} item={p.item} />;
                  }}
                </Route>
                <Route path="/reviews">
                  <ReviewsHome />
                </Route>
                <Route path="/voices">
                  <VoicesPage />
                </Route>
                <Route>
                  <Home />
                </Route>
              </Switch>
            </main>
          </div>
        </UploadsProvider>
      </ToastProvider>
    </Ctx.Provider>
  );
}

/**
 * On a phone, dragging the page to scroll closes the keyboard, like a chat
 * app. Scrolling inside the box being typed in doesn't.
 */
function useScrollClosesKeyboard() {
  useEffect(() => {
    const onMove = (e: TouchEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !(el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      el.blur();
    };
    window.addEventListener("touchmove", onMove, { passive: true });
    return () => window.removeEventListener("touchmove", onMove);
  }, []);
}

/** "(2) Dystory" in the tab while stories wait on people. */
function useWaitingTitle() {
  const stories = useQuery(api.stories.list, {});
  const n = stories?.filter((s) => s.state === "review" || s.state === "waiting").length ?? 0;
  useEffect(() => {
    document.title = n ? `(${n}) Dystory` : "Dystory";
  }, [n]);
}

/** Your avatar in a page header: profile, appearance, switching person. */
export function ProfileButton() {
  const me = useMe();
  const { onSwitchUser } = useShell();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`${me.name}: profile and appearance`}
        className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-surface-2"
      >
        <Avatar name={me.name} color={me.color} size={28} />
      </button>
      {open && <ProfileDialog onClose={() => setOpen(false)} onSwitchUser={onSwitchUser} />}
    </>
  );
}
