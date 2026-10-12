import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { App } from "./App";
import { createApiClient } from "./api";
import { routes } from "./app/routes";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <App client={createApiClient()} router={createBrowserRouter(routes)} />
  </StrictMode>,
);
