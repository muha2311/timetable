import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./index.css";

if (localStorage.getItem("theme") === "dark") document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

// Offline support: cache the app shell. A new deployment is detected and the user is offered a reload (see the sync indicator).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) window.dispatchEvent(new Event("app-update-ready")); });
      });
    }).catch(() => undefined);
  });
}
