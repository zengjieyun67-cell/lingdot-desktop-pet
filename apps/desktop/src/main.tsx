import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { PetWindow } from "./pet/PetWindow";
import { PanelApp } from "./panel/PanelApp";
import { DesktopScene } from "./desktop/DesktopScene";
import { NoteWindow } from "./notes/NoteWindow";

/** One bundle, five kinds of windows (plus `#/note/<id>` floating 便签): `#/pet` (floating pet), `#/panel` (compact panel), `#/desktop` (桌面模式 wallpaper scene)
 *  and `#/screensaver` (屏保模式: same scene, look only, exits on mouse move / key press). */
function Root() {
  const route = window.location.hash.replace(/^#\/?/, "") || "panel";
  if (route.startsWith("desktop")) return <DesktopScene mode="desktop" pet={<PetWindow variant="desktop" />} />;
  if (route.startsWith("note/")) return <NoteWindow id={route.slice(5)} />;
  if (route.startsWith("screensaver")) return <DesktopScene mode="screensaver" pet={<PetWindow variant="desktop" quiet />} />;
  return route.startsWith("pet") ? <PetWindow /> : <PanelApp />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
