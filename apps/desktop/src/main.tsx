import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { PetWindow } from "./pet/PetWindow";
import { PanelApp } from "./panel/PanelApp";
import { DesktopScene } from "./desktop/DesktopScene";

/** One bundle, three windows: `#/pet` (floating pet), `#/panel` (compact panel) and `#/desktop` (桌面模式 full-screen scene). */
function Root() {
  const route = window.location.hash.replace(/^#\/?/, "") || "panel";
  if (route.startsWith("desktop")) return <DesktopScene pet={<PetWindow variant="desktop" />} />;
  return route.startsWith("pet") ? <PetWindow /> : <PanelApp />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
