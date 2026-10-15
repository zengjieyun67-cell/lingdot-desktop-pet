/**
 * Hand-drawn layered SVG catgirl (built-in fallback character).
 *
 * Layering (back -> front), each part a separate <g> so it can be animated
 * independently in a Live2D-like way:
 *   shadow, tail, back hair, body (+ collar bell), paws, laptop (working),
 *   head [ ears, face, blush, eyes (pupils follow cursor), mouth variants,
 *          bangs, side locks, ribbon, ahoge ], effects (sparkles, heart, alert).
 *
 * `c` maps semantic part names to CSS-module class names (see Catgirl.module.css).
 * viewBox is 200 x 240; transform origins in the CSS use view-box coordinates.
 */
export type ClassMap = Readonly<Record<string, string>>;

export function buildCatgirlSvg(c: ClassMap, uid = "cg"): string {
  const k = (name: string) => c[name] ?? name;
  const id = (name: string) => `${uid}-${name}`;
  const star = (x: number, y: number, s: number, cls: string) =>
    `<g transform="translate(${x} ${y}) scale(${s})"><path class="${k(cls)}" d="M0 -7 C0.8 -2.2 2.2 -0.8 7 0 C2.2 0.8 0.8 2.2 0 7 C-0.8 2.2 -2.2 0.8 -7 0 C-2.2 -0.8 -0.8 -2.2 0 -7 Z" fill="#FFD66B"/></g>`;

  return `
<svg class="${k("svg")}" viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="猫娘桌宠">
  <defs>
    <linearGradient id="${id("hair")}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#C9B8F2"/>
      <stop offset="0.55" stop-color="#A893E3"/>
      <stop offset="1" stop-color="#8A75CF"/>
    </linearGradient>
    <linearGradient id="${id("hairDark")}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9F8ADB"/>
      <stop offset="1" stop-color="#7663BE"/>
    </linearGradient>
    <radialGradient id="${id("iris")}" cx="0.5" cy="0.35" r="0.75">
      <stop offset="0" stop-color="#8BE3E8"/>
      <stop offset="0.45" stop-color="#3BB3C8"/>
      <stop offset="1" stop-color="#235E92"/>
    </radialGradient>
    <linearGradient id="${id("skin")}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFF3EC"/>
      <stop offset="1" stop-color="#FFE4D6"/>
    </linearGradient>
    <linearGradient id="${id("hoodie")}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#EEE8FB"/>
    </linearGradient>
    <linearGradient id="${id("laptop")}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F4F1FB"/>
      <stop offset="1" stop-color="#D9D2EE"/>
    </linearGradient>
  </defs>

  <ellipse class="${k("shadow")}" cx="100" cy="229" rx="44" ry="6.5" fill="#3C2A5A" opacity="0.16"/>

  <g class="${k("character")}">
    <g class="${k("tailWrap")}">
      <g class="${k("tail")}">
        <path d="M122 206 C150 212 176 198 174 170 C172 150 180 136 190 136" fill="none" stroke="url(#${id("hairDark")})" stroke-width="12" stroke-linecap="round"/>
        <path d="M122 206 C150 212 176 198 174 170 C172 150 180 136 190 136" fill="none" stroke="#B9A6EC" stroke-width="5" stroke-linecap="round" opacity="0.55"/>
        <circle cx="190" cy="135" r="7.5" fill="#F7F3FF"/>
      </g>
    </g>

    <g class="${k("breath")}">
      <!-- back hair -->
      <path d="M52 100 C46 140 52 166 66 180 C76 175 86 182 100 177 C114 182 124 175 134 180 C148 166 154 140 148 100 Z" fill="url(#${id("hairDark")})"/>

      <!-- body / hoodie -->
      <g class="${k("body")}">
        <path d="M68 226 C64 198 72 170 100 163 C128 170 136 198 132 226 Z" fill="url(#${id("hoodie")})" stroke="#D9CFF3" stroke-width="1.5"/>
        <path d="M86 168 L100 186 L114 168" fill="none" stroke="#C8B9EF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M80 214 C92 218 108 218 120 214" fill="none" stroke="#E2DAF6" stroke-width="2" stroke-linecap="round"/>
        <ellipse cx="86" cy="226" rx="11" ry="5.5" fill="#A893E3"/>
        <ellipse cx="114" cy="226" rx="11" ry="5.5" fill="#A893E3"/>
        <!-- collar ribbon + bell -->
        <path d="M88 164 C94 168 106 168 112 164" fill="none" stroke="#FF8FAE" stroke-width="4" stroke-linecap="round"/>
        <g class="${k("bell")}">
          <circle cx="100" cy="171" r="5.2" fill="#FFD25E" stroke="#E7A93A" stroke-width="1.2"/>
          <path d="M96.5 171 L103.5 171" stroke="#C98A23" stroke-width="1"/>
          <circle cx="100" cy="173.2" r="1.1" fill="#B9781B"/>
        </g>
      </g>

      <!-- laptop (working only) -->
      <g class="${k("laptop")}">
        <rect x="66" y="190" width="68" height="34" rx="6" fill="url(#${id("laptop")})" stroke="#C4BAE3" stroke-width="1.5"/>
        <circle cx="94.5" cy="204" r="2.2" fill="#B5A6E3"/><circle cx="100" cy="201.2" r="2.2" fill="#B5A6E3"/><circle cx="105.5" cy="204" r="2.2" fill="#B5A6E3"/>
        <ellipse cx="100" cy="210.5" rx="5" ry="4" fill="#B5A6E3"/>
        <rect x="60" y="222" width="80" height="5" rx="2.5" fill="#CFC6EA"/>
      </g>

      <!-- paws -->
      <g class="${k("pawL")}">
        <ellipse cx="80" cy="196" rx="9" ry="8" fill="#FFFFFF" stroke="#DCD2F4" stroke-width="1.4"/>
        <circle cx="77" cy="197" r="1.6" fill="#FFB3C7"/><circle cx="80.5" cy="194.5" r="1.6" fill="#FFB3C7"/><circle cx="84" cy="197" r="1.6" fill="#FFB3C7"/>
      </g>
      <g class="${k("pawR")}">
        <ellipse cx="120" cy="196" rx="9" ry="8" fill="#FFFFFF" stroke="#DCD2F4" stroke-width="1.4"/>
        <circle cx="116" cy="197" r="1.6" fill="#FFB3C7"/><circle cx="119.5" cy="194.5" r="1.6" fill="#FFB3C7"/><circle cx="123" cy="197" r="1.6" fill="#FFB3C7"/>
      </g>

      <!-- head (follow transform on wrapper, idle sway on inner) -->
      <g class="${k("headFollow")}">
        <g class="${k("head")}">
          <g class="${k("earL")}">
            <path d="M58 80 L50 30 C50 26 54 25 57 27 L90 58 Z" fill="url(#${id("hair")})" stroke="#8A75CF" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M61 70 L56 39 L80 60 Z" fill="#FFC4D6"/>
          </g>
          <g class="${k("earR")}">
            <path d="M142 80 L150 30 C150 26 146 25 143 27 L110 58 Z" fill="url(#${id("hair")})" stroke="#8A75CF" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M139 70 L144 39 L120 60 Z" fill="#FFC4D6"/>
          </g>

          <!-- face -->
          <path d="M54 96 C54 128 76 147 100 149 C124 147 146 128 146 96 C146 68 126 54 100 54 C74 54 54 68 54 96 Z" fill="url(#${id("skin")})"/>
          <ellipse class="${k("blush")}" cx="70" cy="124" rx="8.5" ry="4.2" fill="#FF9DB8" opacity="0.5"/>
          <ellipse class="${k("blush")}" cx="130" cy="124" rx="8.5" ry="4.2" fill="#FF9DB8" opacity="0.5"/>

          <!-- eyes -->
          <g class="${k("eyes")}">
            <g class="${k("eyeL")}">
              <ellipse cx="80" cy="109" rx="11" ry="13" fill="#FFFFFF"/>
              <g class="${k("pupils")}">
                <ellipse cx="80" cy="110.5" rx="9" ry="11" fill="url(#${id("iris")})"/>
                <ellipse cx="80" cy="111.5" rx="4.2" ry="6.2" fill="#1C2F55"/>
                <circle cx="76.2" cy="105.5" r="3.4" fill="#FFFFFF"/>
                <circle cx="83.5" cy="115.5" r="1.6" fill="#FFFFFF" opacity="0.9"/>
              </g>
              <path d="M68.5 105 Q76 91 92 101" fill="none" stroke="#3B2A4D" stroke-width="3" stroke-linecap="round"/>
              <path d="M69 104.5 Q65.5 104 63.5 100.5" fill="none" stroke="#3B2A4D" stroke-width="2.2" stroke-linecap="round"/>
              <path d="M73 121.5 Q80 124 87 121.5" fill="none" stroke="#C9A2B4" stroke-width="1.2" stroke-linecap="round" opacity="0.8"/>
            </g>
            <g class="${k("eyeR")}">
              <ellipse cx="120" cy="109" rx="11" ry="13" fill="#FFFFFF"/>
              <g class="${k("pupils")}">
                <ellipse cx="120" cy="110.5" rx="9" ry="11" fill="url(#${id("iris")})"/>
                <ellipse cx="120" cy="111.5" rx="4.2" ry="6.2" fill="#1C2F55"/>
                <circle cx="116.2" cy="105.5" r="3.4" fill="#FFFFFF"/>
                <circle cx="123.5" cy="115.5" r="1.6" fill="#FFFFFF" opacity="0.9"/>
              </g>
              <path d="M131.5 105 Q124 91 108 101" fill="none" stroke="#3B2A4D" stroke-width="3" stroke-linecap="round"/>
              <path d="M131 104.5 Q134.5 104 136.5 100.5" fill="none" stroke="#3B2A4D" stroke-width="2.2" stroke-linecap="round"/>
              <path d="M113 121.5 Q120 124 127 121.5" fill="none" stroke="#C9A2B4" stroke-width="1.2" stroke-linecap="round" opacity="0.8"/>
            </g>
          </g>
          <!-- sleepy half-closed lids (emotion: sleepy) -->
          <g class="${k("eyesSleepy")}">
            <path d="M67 97 L93 97 L93 110 Q80 104.5 67 110 Z" fill="url(#${id("skin")})"/>
            <path d="M67.5 110 Q80 104.5 92.5 110" fill="none" stroke="#3B2A4D" stroke-width="3" stroke-linecap="round"/>
            <path d="M107 97 L133 97 L133 110 Q120 104.5 107 110 Z" fill="url(#${id("skin")})"/>
            <path d="M107.5 110 Q120 104.5 132.5 110" fill="none" stroke="#3B2A4D" stroke-width="3" stroke-linecap="round"/>
          </g>
          <!-- puffed cheeks (emotion: angry / sulky) -->
          <g class="${k("cheeks")}">
            <ellipse cx="68" cy="123" rx="10" ry="7" fill="#FF9DB8" opacity="0.55"/>
            <ellipse cx="132" cy="123" rx="10" ry="7" fill="#FF9DB8" opacity="0.55"/>
            <path d="M62 121 l3 3 M66 120 l3 3 M70 120 l3 3" stroke="#F06C8E" stroke-width="1.2" stroke-linecap="round"/>
            <path d="M128 120 l3 3 M132 120 l3 3 M136 121 l3 3" stroke="#F06C8E" stroke-width="1.2" stroke-linecap="round"/>
          </g>
          <!-- happy ^ ^ eyes (completed) -->
          <g class="${k("eyesHappy")}" fill="none" stroke="#3B2A4D" stroke-width="3.4" stroke-linecap="round">
            <path d="M70 112 Q80 100 90 112"/>
            <path d="M110 112 Q120 100 130 112"/>
          </g>

          <!-- nose + mouths -->
          <circle cx="100" cy="121" r="1.1" fill="#E9A3A3"/>
          <path class="${k("mouthIdle")}" d="M93 126 Q96.5 130.5 100 126 Q103.5 130.5 107 126" fill="none" stroke="#7A4256" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
          <path class="${k("mouthHappy")}" d="M92.5 125.5 Q100 137 107.5 125.5 Q100 128 92.5 125.5 Z" fill="#EE6F8A" stroke="#7A4256" stroke-width="1.4" stroke-linejoin="round"/>
          <path class="${k("mouthPout")}" d="M95 129 Q100 125.5 105 129" fill="none" stroke="#7A4256" stroke-width="2" stroke-linecap="round"/>
          <path class="${k("mouthShy")}" d="M96 127.5 Q98 126 100 127.5 Q102 129 104 127.5" fill="none" stroke="#7A4256" stroke-width="1.7" stroke-linecap="round"/>
          <ellipse class="${k("mouthAlert")}" cx="100" cy="129" rx="3.4" ry="4.4" fill="#B84A63"/>
          <ellipse class="${k("mouthTalk")}" cx="100" cy="128" rx="4" ry="3.6" fill="#C2526C" stroke="#7A4256" stroke-width="1.2"/>
          <!-- napping: fully closed eyes -->
          <g class="${k("eyesClosed")}" fill="none" stroke="#3B2A4D" stroke-width="3" stroke-linecap="round">
            <path d="M70 110 Q80 116 90 110"/>
            <path d="M110 110 Q120 116 130 110"/>
          </g>

          <!-- front hair -->
          <path d="M50 99 C46 62 72 43 100 43 C128 43 154 62 150 99 C145 88 139 80 133 77 C131 88 125 93 118 95 C118 85 114 77 108 72 C104 84 96 90 86 93 C88 85 88 79 86 75 C78 83 70 89 59 91 C56 94 53 96 50 99 Z" fill="url(#${id("hair")})"/>
          <path d="M53 92 C48 118 52 138 61 149 C61 132 61 113 63 97 Z" fill="url(#${id("hair")})"/>
          <path d="M147 92 C152 118 148 138 139 149 C139 132 139 113 137 97 Z" fill="url(#${id("hair")})"/>
          <path d="M70 58 C80 52 92 50 102 51" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" opacity="0.45"/>
          <!-- ahoge -->
          <path class="${k("ahoge")}" d="M100 45 C95 30 110 27 105 16" fill="none" stroke="#A893E3" stroke-width="3.2" stroke-linecap="round"/>
          <!-- headphones (listening to music) -->
          <g class="${k("headphones")}">
            <path d="M52 100 C48 58 74 36 100 36 C126 36 152 58 148 100" fill="none" stroke="#FFC94D" stroke-width="7" stroke-linecap="round"/>
            <path d="M52 100 C48 58 74 36 100 36 C126 36 152 58 148 100" fill="none" stroke="#FFE7A3" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>
            <rect x="40" y="92" width="18" height="30" rx="8" fill="#FF9DB8" stroke="#E86C90" stroke-width="1.5"/>
            <rect x="142" y="92" width="18" height="30" rx="8" fill="#FF9DB8" stroke="#E86C90" stroke-width="1.5"/>
            <circle cx="49" cy="107" r="4" fill="#FFE7A3"/><circle cx="151" cy="107" r="4" fill="#FFE7A3"/>
          </g>
          <!-- ribbon -->
          <g transform="translate(136 62) rotate(18)">
            <path d="M0 0 L-10 -7 L-10 7 Z M0 0 L10 -7 L10 7 Z" fill="#FF8FAE" stroke="#E86C90" stroke-width="1" stroke-linejoin="round"/>
            <circle cx="0" cy="0" r="2.6" fill="#FFB3C7"/>
          </g>
        </g>
      </g>
    </g>
  </g>

  <!-- effects -->
  <g class="${k("sparkles")}">
    ${star(38, 72, 1.0, "sparkle1")}
    ${star(165, 96, 0.8, "sparkle2")}
    ${star(156, 44, 1.15, "sparkle3")}
  </g>
  <g class="${k("heart")}">
    <path transform="translate(154 58) scale(1.7)" d="M0 6 C-10 -2 -8 -12 0 -7 C8 -12 10 -2 0 6 Z" fill="#FF6F91" stroke="#FFFFFF" stroke-width="0.9"/>
  </g>
  <g class="${k("markAnger")}" stroke="#FF4D6D" stroke-width="2.6" stroke-linecap="round" fill="none">
    <path d="M141 58 q4 2 8 0"/><path d="M141 66 q4 -2 8 0"/><path d="M140 59 q-2 3.5 0 7"/><path d="M150 59 q2 3.5 0 7"/>
  </g>
  <g class="${k("markZzz")}" fill="#8A75CF" font-family="-apple-system, Helvetica, sans-serif" font-weight="700">
    <text x="146" y="66" font-size="11">z</text><text x="154" y="55" font-size="14">z</text><text x="164" y="42" font-size="17">Z</text>
  </g>
  <g class="${k("notes")}" fill="#F0A43A" font-family="-apple-system, Helvetica, sans-serif" font-weight="700">
    <text class="${k("note1")}" x="150" y="70" font-size="16">♪</text>
    <text class="${k("note2")}" x="30" y="84" font-size="14">♫</text>
    <text class="${k("note3")}" x="160" y="40" font-size="12">♪</text>
  </g>
  <g class="${k("markHeart")}">
    <path transform="translate(44 70) scale(0.9)" d="M0 6 C-10 -2 -8 -12 0 -7 C8 -12 10 -2 0 6 Z" fill="#FF8FB1"/>
  </g>
  <g class="${k("alert")}">
    <path d="M150 58 L146 68 L158 59 Z" fill="#FF5C7A"/>
    <circle cx="157" cy="42" r="15" fill="#FF5C7A" stroke="#FFFFFF" stroke-width="2.5"/>
    <rect x="154.6" y="31" width="4.8" height="13.5" rx="2.4" fill="#FFFFFF"/>
    <circle cx="157" cy="50" r="2.7" fill="#FFFFFF"/>
  </g>
</svg>`;
}
