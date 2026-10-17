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

// Platform + material hints for the CSS token layer (styles/global.css).
{
  const html = document.documentElement;
  const ua = navigator.userAgent;
  const platform = /Windows/i.test(ua) ? "windows" : /Mac/i.test(ua) ? "macos" : "other";
  html.dataset.platform = platform;
  const inTauri = "__TAURI_INTERNALS__" in window;
  if (inTauri) html.dataset.tauri = "";
  const route = window.location.hash.replace(/^#\/?/, "") || "panel";
  // the panel window carries native vibrancy (macOS) / Acrylic (Windows): the sheet fills the window
  if (inTauri && platform !== "other" && !route.startsWith("pet") && !route.startsWith("desktop") && !route.startsWith("screensaver") && !route.startsWith("note/")) html.dataset.nativeGlass = "";
  if (new URLSearchParams(window.location.search).has("reduceTransparency")) html.dataset.reduceTransparency = "";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
