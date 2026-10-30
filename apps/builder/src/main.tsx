import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// The preview runs on 127.0.0.1. Opened from `localhost` it would be a cross-site iframe and Chrome drops its cookie.
if (location.hostname === "localhost") location.replace(location.href.replace("//localhost", "//127.0.0.1"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
