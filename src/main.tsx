import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TournamentApp from "../app/tournament-app";
import "../app/globals.css";

// index.htmlのroot要素へReactアプリを描画します。
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("描画先のroot要素が見つかりません。");

createRoot(rootElement).render(
  <StrictMode>
    <TournamentApp />
  </StrictMode>,
);
