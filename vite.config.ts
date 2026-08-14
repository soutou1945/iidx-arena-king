import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** GitHub PagesのプロジェクトサイトURLに合わせて公開パスを固定します。 */
export default defineConfig({
  base: "/iidx-arena-king/",
  plugins: [react()],
});
