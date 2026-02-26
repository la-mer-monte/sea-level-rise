import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Si vous déployez dans un sous-dossier (ex: GitHub Pages),
  // décommentez et adaptez la ligne suivante :
  // base: "/sea-level-rise/",
});
