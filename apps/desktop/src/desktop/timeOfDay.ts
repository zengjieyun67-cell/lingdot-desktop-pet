/**
 * 时间系统: the scene's colours follow the time of day.
 *
 * Four palettes (清晨 / 白天 / 黄昏 / 夜晚) are pinned to times of day; between two
 * pins every colour is blended in OKLab so the hand-off (blue noon → orange dusk)
 * never goes through grey mud. The result is a set of CSS variables the scene
 * applies to its root; it is recomputed every minute.
 */

export type Phase = "dawn" | "day" | "dusk" | "night";

export interface Palette {
  /** Sonoma: deep base behind the aurora. */
  base: string;
  /** Sonoma: four aurora ribbons / blobs. */
  a1: string;
  a2: string;
  a3: string;
  a4: string;
  /** Sonoma: clock + text colour and the glass halo glow. */
  ink: string;
  glow: string;
  /** Poster: paper, ink and the single accent colour. */
  paper: string;
  pInk: string;
  pAccent: string;
}

export const PALETTES: Record<Phase, Palette> = {
  dawn: {
    base: "#3a2a55",
    a1: "#ff9b85",
    a2: "#ffd3a1",
    a3: "#8f7dff",
    a4: "#f4a3c6",
    ink: "#fffaf4",
    glow: "#ffd9c2",
    paper: "#f4e7dc",
    pInk: "#2b1d22",
    pAccent: "#df644c",
  },
  day: {
    base: "#4a68e0",
    a1: "#6f7cff",
    a2: "#ff746c",
    a3: "#4fb35a",
    a4: "#a6e36d",
    ink: "#ffffff",
    glow: "#f3f6ff",
    paper: "#f1eee6",
    pInk: "#141414",
    pAccent: "#d23b2e",
  },
  dusk: {
    base: "#2c1238",
    a1: "#ff7440",
    a2: "#c72f6c",
    a3: "#5a2c92",
    a4: "#ffb25a",
    ink: "#fff3ea",
    glow: "#ffb48e",
    paper: "#ead0b6",
    pInk: "#2a1418",
    pAccent: "#b5321d",
  },
  night: {
    base: "#070b1f",
    a1: "#2534a0",
    a2: "#5a2d9c",
    a3: "#0f6a78",
    a4: "#1c1460",
    ink: "#eef0ff",
    glow: "#8d86ff",
    paper: "#13151e",
    pInk: "#ece5d6",
    pAccent: "#c7a2ff",
  },
};

/** Pins (minute of day → palette). A palette holds between its two pins, then blends to the next. */
const PINS: Array<[number, Phase]> = [
  [0, "night"],
  [4 * 60 + 30, "night"],
  [6 * 60, "dawn"],
  [7 * 60 + 30, "dawn"],
  [9 * 60 + 30, "day"],
  [15 * 60 + 30, "day"],
  [17 * 60 + 45, "dusk"],
  [18 * 60 + 45, "dusk"],
  [20 * 60 + 30, "night"],
  [24 * 60, "night"],
];

export const PHASE_LABEL: Record<Phase, string> = { dawn: "清晨", day: "白天", dusk: "黄昏", night: "夜晚" };

// ---------------------------------------------------------------- colour maths

type Rgb = [number, number, number];
type Lab = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function rgbToOklab([r, g, b]: Rgb): Lab {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => {
    const c = Math.min(1, Math.max(0, v));
    return c <= 0.0031308 ? 255 * 12.92 * c : 255 * (1.055 * c ** (1 / 2.4) - 0.055);
  }) as Rgb;
}

/** Blend two hex colours in OKLab (t = 0 → a, 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  if (t <= 0) return a.toLowerCase();
  if (t >= 1) return b.toLowerCase();
  const la = rgbToOklab(hexToRgb(a));
  const lb = rgbToOklab(hexToRgb(b));
  return rgbToHex(oklabToRgb([0, 1, 2].map((i) => la[i]! + (lb[i]! - la[i]!) * t) as Lab));
}

/** Relative luminance 0..1 (for picking light/dark details). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------------------------------------------------------------- time → palette

const smooth = (t: number) => t * t * (3 - 2 * t);

export interface TimeTheme {
  palette: Palette;
  /** The palette that dominates right now. */
  phase: Phase;
  /** Minute of day the theme was computed for. */
  minute: number;
}

export function themeAt(minuteOfDay: number): TimeTheme {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  let i = 0;
  while (i < PINS.length - 2 && PINS[i + 1]![0] <= m) i++;
  const [m0, p0] = PINS[i]!;
  const [m1, p1] = PINS[i + 1]!;
  const t = m1 === m0 ? 0 : smooth((m - m0) / (m1 - m0));
  const A = PALETTES[p0];
  const B = PALETTES[p1];
  const palette = Object.fromEntries(
    (Object.keys(A) as Array<keyof Palette>).map((k) => [k, mixHex(A[k], B[k], t)]),
  ) as unknown as Palette;
  return { palette, phase: t < 0.5 ? p0 : p1, minute: m };
}

export function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** CSS custom properties for the scene root. */
export function themeVars(theme: TimeTheme): Record<string, string> {
  const p = theme.palette;
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) vars[`--tod-${k}`] = v;
  // poster details that must stay readable whatever the paper colour is
  vars["--tod-paper-dark"] = luminance(p.paper) < 0.2 ? "1" : "0";
  return vars;
}

/** 早上好 / 下午好 … for the headline copy. */
export function partOfDay(h: number): string {
  if (h < 5) return "深夜";
  if (h < 8) return "清晨";
  if (h < 11) return "上午";
  if (h < 13) return "正午";
  if (h < 17) return "午后";
  if (h < 19) return "黄昏";
  return "夜晚";
}

/** Poster headline (English, two lines) for the hour. */
export function posterHeadline(h: number): [string, string] {
  if (h < 5) return ["After", "Hours."];
  if (h < 8) return ["First", "Light."];
  if (h < 11) return ["Good", "Morning."];
  if (h < 13) return ["High", "Noon."];
  if (h < 17) return ["Slow", "Afternoon."];
  if (h < 19) return ["Golden", "Hour."];
  if (h < 22) return ["After", "Dark."];
  return ["Late", "Night."];
}

/** How much each phase photo shows right now (sums to 1) — the 「海」 scene crossfades its photos with this. */
export function phaseWeights(minuteOfDay: number): Record<Phase, number> {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  let i = 0;
  while (i < PINS.length - 2 && PINS[i + 1]![0] <= m) i++;
  const [m0, p0] = PINS[i]!;
  const [m1, p1] = PINS[i + 1]!;
  const t = m1 === m0 ? 0 : smooth((m - m0) / (m1 - m0));
  const w: Record<Phase, number> = { dawn: 0, day: 0, dusk: 0, night: 0 };
  w[p0] += 1 - t;
  w[p1] += t;
  return w;
}

const WEEKDAY_SHORT = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
export const WEEKDAYS_SCRIPT = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Small greeting above the clock: 早安，星期五 / 晚安，星期日. */
export function greeting(d: Date): string {
  const h = d.getHours();
  const word = h < 5 ? "晚安" : h < 11 ? "早安" : h < 14 ? "午安" : h < 18 ? "下午好" : h < 22 ? "晚上好" : "晚安";
  return `${word}，${WEEKDAY_SHORT[d.getDay()]}`;
}

export const DAILY_QUOTES: string[] = [
  "慢慢来，比较快。",
  "把今天过成喜欢的样子。",
  "海很大，你也可以很勇敢。",
  "累了就停一下，风会等你。",
  "Stay soft, stay curious.",
  "一点点进步，也是进步。",
  "今天也辛苦啦，记得喝水。",
  "Do one thing at a time.",
  "认真生活的人，自带光。",
  "别急，好事正在路上。",
  "Less noise, more ocean.",
  "你已经做得很好了。",
];

/** One quote per calendar day (stable within the day). */
export function dailyQuote(d: Date): string {
  const day = Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
  return DAILY_QUOTES[((day % DAILY_QUOTES.length) + DAILY_QUOTES.length) % DAILY_QUOTES.length]!;
}
