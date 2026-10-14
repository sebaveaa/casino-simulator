import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { App } from "./App";
import { createApiClient } from "./api";
import { routes } from "./app/routes";
import { createSessionStore } from "./session";
// The opsz build carries weight and optical size, so large headings get the tighter display cut.
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

const session = createSessionStore();

createRoot(container).render(
  <StrictMode>
    <App client={createApiClient(session)} router={createBrowserRouter(routes)} session={session} />
  </StrictMode>,
);
