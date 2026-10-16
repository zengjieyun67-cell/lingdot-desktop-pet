import { useEffect, useRef } from "react";
import type { Phase } from "./timeOfDay";

/**
 * 「海」 made alive: one WebGL pass over the four time-of-day photos —
 * perspective-scaled ripple displacement below the horizon (the diving platform is masked out),
 * light glints that sparkle where the water is already bright (sun / moon path), a very slow
 * sky drift and a tiny "breathing" zoom. Capped at 30 fps, paused while the window is hidden,
 * a single still frame under prefers-reduced-motion. Falls back to the plain photos (rendered
 * underneath) when WebGL is unavailable.
 */

const PHASES: Phase[] = ["dawn", "day", "dusk", "night"];
const FRAME_MS = 1000 / 30;

/** Photo geometry (all four share one composition). */
export const SEA_GEOMETRY = { horizon: 0.2, platformTop: 0.69, aspect: 2560 / 1429 };

const VERT = `
attribute vec2 p;
varying vec2 vS;
void main() {
  vS = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D t0, t1, t2, t3;
uniform vec4 w;
uniform float time;
uniform vec2 res;
uniform float imgAspect;
varying vec2 vS;
const float H = ${SEA_GEOMETRY.horizon.toFixed(3)};
const float PT = ${SEA_GEOMETRY.platformTop.toFixed(3)};

vec2 cover(vec2 s) {
  float sa = res.x / res.y;
  vec2 uv = s;
  if (sa > imgAspect) {
    float h = sa / imgAspect;
    uv.y = (s.y + (h - 1.0) * 0.7) / h;   // background-position: 50% 70%
  } else {
    float wd = imgAspect / sa;
    uv.x = (s.x + (wd - 1.0) * 0.5) / wd;
  }
  return uv;
}

vec3 photo(vec2 uv) {
  return texture2D(t0, uv).rgb * w.x + texture2D(t1, uv).rgb * w.y + texture2D(t2, uv).rgb * w.z + texture2D(t3, uv).rgb * w.w;
}

void main() {
  // slow breathing zoom (always >= cover, so no edges show)
  float breathe = 1.0 - 0.006 * (0.5 + 0.5 * sin(time * 0.21));
  vec2 s = (vS - 0.5) * breathe + 0.5;
  vec2 uv = cover(s);

  float water = smoothstep(0.0, 0.025, uv.y - H);
  float d = clamp((uv.y - H) / (1.0 - H), 0.0, 1.0);

  // diving platform: a slightly widening trapezoid from PT to the bottom
  float k = clamp((uv.y - PT) / (1.0 - PT), 0.0, 1.0);
  float xl = mix(0.468, 0.452, k);
  float xr = mix(0.532, 0.562, k);
  float plat = smoothstep(PT - 0.01, PT + 0.004, uv.y) * smoothstep(xl - 0.014, xl, uv.x) * (1.0 - smoothstep(xr, xr + 0.014, uv.x));

  // ripples: tighter + smaller near the horizon (perspective), bigger close by
  float amp = (0.0007 + 0.0032 * d * d) * water * (1.0 - plat);
  float f = mix(260.0, 46.0, d);
  float sway = sin(uv.x * 26.0 + time * 0.45) * 1.4;
  vec2 disp = vec2(
    sin(uv.y * f + time * 1.05 + sway) * 0.6,
    sin(uv.y * f * 0.83 - time * 0.85 + uv.x * 14.0) * 0.45
  ) * amp;

  // sky: barely perceptible drift of the clouds
  float sky = 1.0 - smoothstep(-0.03, 0.0, uv.y - H);
  disp.x += sky * sin(time * 0.017) * 0.006 * (H - min(uv.y, H)) / H;

  vec3 c = photo(uv + disp);

  // glints where the water is already bright (sun / moon path, crests)
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float g = sin(uv.x * 940.0 + time * 2.6 + sin(uv.y * 210.0) * 2.0) * sin(uv.y * 1350.0 - time * 2.1 + sin(uv.x * 170.0 + time * 0.3) * 3.0);
  float spark = smoothstep(0.93, 1.0, g) * smoothstep(0.3, 0.72, l) * water * (1.0 - plat) * (0.35 + 0.65 * d);
  c += vec3(spark) * 0.32;

  gl_FragColor = vec4(c, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = fail;
    im.src = src;
  });
}

export function SeaCanvas({ weights, className }: { weights: Record<Phase, number>; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const target = useRef(weights);
  target.current = weights;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: false });
    if (!gl) return;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uW = u("w");
    const uTime = u("time");
    const uRes = u("res");
    gl.uniform1f(u("imgAspect"), SEA_GEOMETRY.aspect);

    let alive = true;
    let raf = 0;
    let still = 0;
    let last = 0;
    const start = performance.now();
    const cur = { ...target.current };
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25); // soft photo: no need for full retina
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
    };

    const draw = (now: number) => {
      // ease weights toward the clock's blend (the CSS photos used a 60 s fade)
      for (const p of PHASES) cur[p] += (target.current[p] - cur[p]) * 0.02;
      gl.uniform4f(uW, cur.dawn, cur.day, cur.dusk, cur.night);
      gl.uniform1f(uTime, reduced ? 12.0 : (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const loop = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (document.hidden || now - last < FRAME_MS) return;
      last = now;
      resize();
      draw(now);
    };

    const onVis = () => {
      if (!document.hidden && !reduced && alive) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      }
    };

    void Promise.all(PHASES.map((p) => loadImage(`/scenes/sea/sea-${p}.webp`)))
      .then((imgs) => {
        if (!alive) return;
        imgs.forEach((im, i) => {
          const tex = gl.createTexture();
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
          gl.uniform1i(u(`t${i}`), i);
        });
        Object.assign(cur, target.current);
        resize();
        draw(performance.now());
        canvas.dataset.ready = "1";
        if (reduced) {
          // still frame; redraw only when the window size or the phase blend changes
          still = window.setInterval(() => {
            resize();
            draw(performance.now());
          }, 5000);
          return;
        }
        raf = requestAnimationFrame(loop);
      })
      .catch(() => undefined);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearInterval(still);
      document.removeEventListener("visibilitychange", onVis);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
