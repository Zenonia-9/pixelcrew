import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppBoundary } from "./AppBoundary";
import "./style.css";
import { connectSession } from "./session";
window.addEventListener("hashchange", () => {
  if (new URLSearchParams(location.hash.slice(1)).has("session")) location.reload();
});
connectSession().then(() => createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppBoundary>
      <App />
    </AppBoundary>
  </React.StrictMode>,
)).catch(error => {
  document.getElementById("root")!.textContent = error instanceof Error ? error.message : "Could not connect to PixelCrew.";
});
