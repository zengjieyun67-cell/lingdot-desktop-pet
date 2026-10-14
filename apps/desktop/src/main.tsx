import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { PetWindow } from "./pet/PetWindow";
import { PanelApp } from "./panel/PanelApp";

/** One bundle, two windows: `#/pet` (transparent pet) and `#/panel` (compact panel). */
function Root() {
  const route = window.location.hash.replace(/^#\/?/, "") || "panel";
  return route.startsWith("pet") ? <PetWindow /> : <PanelApp />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
