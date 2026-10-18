// @vitest-environment node
import { describe, expect, it } from "vitest";
// legacy url.resolve: the same resolver pixi-live2d-display uses for moc / textures / motions
// @ts-ignore -- node built-in, no @types/node in this package
import { resolve as urlResolve } from "node:url";
import { fileUrl, isLocalPath, plainPath } from "./createRenderer";

/** What Tauri's asset protocol does with the request path: drop the leading "/", percent-decode. */
function protocolPath(url: string, base: string): string {
  return decodeURIComponent(url.slice(base.length));
}

const WIN = "http://asset.localhost/";
const MAC = "asset://localhost/";

describe("asset URLs for imported Live2D models", () => {
  const winModel = "C:\\Users\\张 三\\AppData\\Roaming\\com.desktoppet.app\\live2d\\models\\free1\\free1.model3.json";
  const macModel = "/Users/d/Library/Application Support/com.desktoppet.app/live2d/models/free1/free1.model3.json";

  it("round-trips the path through the protocol", () => {
    expect(protocolPath(fileUrl(winModel, WIN), WIN)).toBe(winModel.replace(/\\/g, "/"));
    expect(protocolPath(fileUrl(macModel, MAC), MAC)).toBe(macModel);
  });

  it("resolves moc / textures relative to the model json (pixi-live2d-display's url.resolve)", () => {
    const w: string = urlResolve(fileUrl(winModel, WIN), "free1.4096/texture_00.png");
    expect(protocolPath(w, WIN)).toBe("C:/Users/张 三/AppData/Roaming/com.desktoppet.app/live2d/models/free1/free1.4096/texture_00.png");
    const m: string = urlResolve(fileUrl(macModel, MAC), "free1.moc3");
    expect(protocolPath(m, MAC)).toBe("/Users/d/Library/Application Support/com.desktoppet.app/live2d/models/free1/free1.moc3");
    // and with the WHATWG URL parser (fetch / XHR / <img>)
    expect(protocolPath(new URL("motions/idle.motion3.json", fileUrl(winModel, WIN)).href, WIN)).toBe(
      "C:/Users/张 三/AppData/Roaming/com.desktoppet.app/live2d/models/free1/motions/idle.motion3.json",
    );
  });

  it("encodes characters that would break a URL", () => {
    const u = fileUrl("C:\\模型 #1\\a?b%.model3.json", WIN);
    expect(u).toBe("http://asset.localhost/C%3A/%E6%A8%A1%E5%9E%8B%20%231/a%3Fb%25.model3.json");
    expect(protocolPath(u, WIN)).toBe("C:/模型 #1/a?b%.model3.json");
  });

  it("strips Windows verbatim prefixes and recognises local paths", () => {
    expect(plainPath("\\\\?\\C:\\x\\m.model3.json")).toBe("C:\\x\\m.model3.json");
    expect(plainPath("\\\\?\\UNC\\srv\\share\\m.json")).toBe("\\\\srv\\share\\m.json");
    expect(isLocalPath("\\\\?\\C:\\x")).toBe(true);
    expect(isLocalPath("C:/x")).toBe(true);
    expect(isLocalPath("/Users/x")).toBe(true);
    expect(isLocalPath("\\\\srv\\share\\m.json")).toBe(true);
    expect(isLocalPath("models/x.json")).toBe(false);
    expect(fileUrl("\\\\?\\C:\\a\\b.json", WIN)).toBe("http://asset.localhost/C%3A/a/b.json");
    expect(protocolPath(fileUrl("\\\\srv\\share\\m.json", WIN), WIN)).toBe("//srv/share/m.json");
  });
});
