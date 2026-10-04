import { samvaEditor } from "@samva/vite";
import { defineConfig } from "vite";

// Run `vite` to inspect the code-authored TSX entry at http://localhost:5173/.
// This is the local browser preview; Git commit/push and `samva templates publish` own
// synchronization and immutable publication for a Samva-managed project.
export default defineConfig({
  plugins: [samvaEditor()],
});
