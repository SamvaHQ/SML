import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

// oxlint-disable-next-line import/no-unassigned-import -- Side-effect import: loads the harness Tailwind theme + editor chrome styles.
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
