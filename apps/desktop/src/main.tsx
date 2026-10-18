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
  // Which material this window can have (styles/global.css):
  //  - data-scene: 桌面 / 屏保 — the page paints its own backdrop (the sea), so glass really blurs.
  //  - data-native-glass: macOS panel with native vibrancy behind the webview; the sheet fills the window.
  //  - otherwise a transparent window with nothing the webview can blur: an opaque-ish fill.
  //    (Windows never gets native Acrylic any more: it turned solid on blur, ignored our rounded
  //    corners and lagged while dragging — one CSS sheet looks the same everywhere.)
  const scene = route.startsWith("desktop") || route.startsWith("screensaver");
  if (scene) html.dataset.scene = "";
  if (inTauri && platform === "macos" && !scene && !route.startsWith("pet") && !route.startsWith("note/")) html.dataset.nativeGlass = "";
  if (new URLSearchParams(window.location.search).has("reduceTransparency")) html.dataset.reduceTransparency = "";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
