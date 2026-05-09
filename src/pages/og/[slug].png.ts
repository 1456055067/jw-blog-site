import { getCollection, type CollectionEntry } from "astro:content";
import sharp from "sharp";
import type { APIRoute } from "astro";

export async function getStaticPaths() {
  const posts = await getCollection("blog", ({ data }) => !data.draft);
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
}

const BG = "#0a0a0a";
const ACCENT = "#34d4a4";
const FG = "#fafafa";
const MUTED = "#9ca3af";
const HANDLE = "johnewillmanv.com";

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  // If we couldn't fit all words, ellipsize the final line.
  const consumedWords = lines.flatMap((l) => l.split(/\s+/)).length;
  if (consumedWords < words.length && lines.length > 0) {
    const last = lines[lines.length - 1];
    const trimmed = last.replace(/\s\S+$/, "");
    lines[lines.length - 1] = (trimmed || last) + "…";
  }
  return lines;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function svgFor(post: CollectionEntry<"blog">): string {
  // Title flows from top; description + date anchored to bottom so layout
  // stays balanced regardless of title length.
  const titleLines = wrap(post.data.title, 28, 3);
  const descLines = wrap(post.data.description, 60, 2);
  const date = post.data.pubDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  const titleStartY = 220;
  const titleLineHeight = 82;
  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<text x="80" y="${titleStartY + i * titleLineHeight}" fill="${FG}" font-size="68" font-weight="700" letter-spacing="-2">${escapeXml(line)}</text>`
    )
    .join("");

  const descLineHeight = 38;
  const descBottomY = 520;
  const descStartY = descBottomY - (descLines.length - 1) * descLineHeight;
  const descSvg = descLines
    .map(
      (line, i) =>
        `<text x="80" y="${descStartY + i * descLineHeight}" fill="${MUTED}" font-size="26" font-weight="400">${escapeXml(line)}</text>`
    )
    .join("");

  const dateRowY = 580;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="${BG}"/>
    <rect x="0" y="0" width="1200" height="6" fill="${ACCENT}"/>
    <g font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
      <text x="80" y="120" fill="${ACCENT}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="22" font-weight="600" letter-spacing="6">POST</text>
      ${titleSvg}
      ${descSvg}
      <text x="80" y="${dateRowY}" fill="${MUTED}" font-size="20">${escapeXml(date)}</text>
      <text x="1120" y="${dateRowY}" fill="${MUTED}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="20" letter-spacing="2" text-anchor="end">${HANDLE}</text>
    </g>
  </svg>`;
}

export const GET: APIRoute = async ({ props }) => {
  const { post } = props as { post: CollectionEntry<"blog"> };
  const buffer = await sharp(Buffer.from(svgFor(post)))
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Response(buffer, {
    headers: { "Content-Type": "image/png" },
  });
};
