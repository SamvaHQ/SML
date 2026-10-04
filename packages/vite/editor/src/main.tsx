import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";

// oxlint-disable-next-line import/no-unassigned-import -- global stylesheet side-effect import
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
