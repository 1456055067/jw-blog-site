// Generates public/og-default.png from an inline SVG.
// One-shot: re-run with `npm run og:generate` if you redesign the OG image.
// Sharp ships transitively via Astro, so no extra dep needed.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, "..", "public", "og-default.png");

const TITLE_LINE_1 = "Software,";
const TITLE_LINE_2 = "written down.";
const SUBTITLE = "Notes on building, breaking, and shipping software.";
const KICKER = "FIELD NOTES";
const HANDLE = "johnewillmanv.com";

const BG = "#0a0a0a";
const ACCENT = "#34d4a4";
const FG = "#fafafa";
const MUTED = "#9ca3af";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${BG}"/>
  <rect x="0" y="0" width="1200" height="6" fill="${ACCENT}"/>

  <g font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
    <text x="80" y="130"
          fill="${ACCENT}"
          font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
          font-size="22"
          font-weight="600"
          letter-spacing="6">${KICKER}</text>

    <text x="80" y="280"
          fill="${FG}"
          font-size="92"
          font-weight="700"
          letter-spacing="-2">${TITLE_LINE_1}</text>

    <text x="80" y="385"
          fill="${FG}"
          font-size="92"
          font-weight="700"
          letter-spacing="-2">${TITLE_LINE_2}</text>

    <text x="80" y="465"
          fill="${MUTED}"
          font-size="28"
          font-weight="400">${SUBTITLE}</text>

    <text x="80" y="565"
          fill="${MUTED}"
          font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
          font-size="22"
          letter-spacing="3">${HANDLE}</text>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
console.log(`Wrote ${out}`);
