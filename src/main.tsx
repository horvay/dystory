import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import "@fontsource-variable/inter";
import "@fontsource-variable/literata";
import "@fontsource-variable/literata/wght-italic.css";
import "./index.css";
import { App } from "./App";

// Convex is proxied through the same origin as the app (see vite.config.ts),
// so this works from any machine on the TailNet.
const convex = new ConvexReactClient(window.location.origin, {
  skipConvexDeploymentUrlCheck: true,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </StrictMode>,
);
