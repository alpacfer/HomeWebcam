/**
 * Edge refraction for the glass panels: real lensing, not another blur.
 *
 * A frosted rectangle reads as a card with a blur behind it. What makes a panel
 * read as *glass* is what happens at its rim, where thickness bends whatever is
 * behind it. The technique is the established web recreation of Apple's Liquid
 * Glass (kube.io, shuding/liquid-glass): precompute a displacement map on a
 * canvas, hand it to an SVG feDisplacementMap, and hang that filter off
 * `backdrop-filter`, so the live mirror behind the panel is what bends.
 *
 * Two things are load-bearing and easy to lose:
 * - `color-interpolation-filters="sRGB"`. Without it the browser converts the
 *   map to linear RGB first and every displacement comes out wrong.
 * - The <svg> has to stay in the document and must not be display:none, or
 *   Chrome drops the filter and the panels silently go flat.
 *
 * `backdrop-filter: url(...)` is Chromium-only. The station is a dedicated
 * Chrome, and the CSS lists a plain blur first, so a browser that ignores the
 * url() still gets a frosted panel. Refraction is delight; it never carries
 * meaning. Turn it off with CONFIG.ui.glass.refraction.
 */

import { smoothstep } from "../lib/ease.js";

export interface LensSpec {
  width: number;
  height: number;
  radius: number;
  /** How far in from the edge the bending reaches, px. */
  band: number;
  /** Peak backdrop displacement at the rim, px. */
  strength: number;
  /**
   * Per-channel spread of the displacement, 0..1. Red is bent hardest and blue
   * least, which is what puts the faint prismatic fringe on the rim. Costs two
   * extra displacement passes; 0 buys them back.
   */
  aberration: number;
}

/** Bigger maps cost more to build and buy nothing: the panels are ~112 px. */
const MAX_MAP_PX = 256;

const lenses = new Map<string, string>();
let defs: SVGSVGElement | null = null;

/** Returns a CSS `url(#id)` for the spec, building and caching it on first use. */
export function ensureLens(spec: LensSpec): string {
  const key = [
    spec.width,
    spec.height,
    spec.radius,
    spec.band,
    spec.strength,
    spec.aberration,
  ].join(":");
  const cached = lenses.get(key);
  if (cached !== undefined) return cached;

  const id = `glass-lens-${lenses.size}`;
  const reference = `url(#${id})`;
  buildFilter(id, spec);
  lenses.set(key, reference);
  return reference;
}

function buildFilter(id: string, spec: LensSpec): void {
  const map = displacementMap(spec);
  const svgns = "http://www.w3.org/2000/svg";
  const filter = document.createElementNS(svgns, "filter");
  filter.setAttribute("id", id);
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", "100%");
  filter.setAttribute("height", "100%");
  filter.setAttribute("color-interpolation-filters", "sRGB");

  const image = document.createElementNS(svgns, "feImage");
  image.setAttribute("href", map.href);
  image.setAttribute("x", "0");
  image.setAttribute("y", "0");
  image.setAttribute("width", String(spec.width));
  image.setAttribute("height", String(spec.height));
  image.setAttribute("preserveAspectRatio", "none");
  image.setAttribute("result", "map");
  filter.append(image);

  if (spec.aberration <= 0) {
    filter.append(displace("SourceGraphic", map.scale, "out"));
  } else {
    // One pass per channel at a slightly different scale, each masked down to
    // its own colour, screened back together. Same trick as the reference
    // implementations: the rim fringes, the middle stays neutral.
    const channels: Array<[string, number[]]> = [
      ["r", [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]],
      ["g", [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]],
      ["b", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]],
    ];
    channels.forEach(([name, matrix], index) => {
      const scale = map.scale * (1 + spec.aberration * (1 - index));
      filter.append(displace("SourceGraphic", scale, `${name}-shifted`));
      const isolate = document.createElementNS(svgns, "feColorMatrix");
      isolate.setAttribute("in", `${name}-shifted`);
      isolate.setAttribute("type", "matrix");
      isolate.setAttribute("values", matrix.join(" "));
      isolate.setAttribute("result", name);
      filter.append(isolate);
    });
    filter.append(blend("r", "g", "rg"));
    filter.append(blend("rg", "b", "out"));
  }

  defs ??= createDefs();
  defs.append(filter);
}

function displace(input: string, scale: number, result: string): SVGElement {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "feDisplacementMap");
  node.setAttribute("in", input);
  node.setAttribute("in2", "map");
  node.setAttribute("scale", scale.toFixed(3));
  node.setAttribute("xChannelSelector", "R");
  node.setAttribute("yChannelSelector", "G");
  node.setAttribute("result", result);
  return node;
}

function blend(a: string, b: string, result: string): SVGElement {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "feBlend");
  node.setAttribute("in", a);
  node.setAttribute("in2", b);
  node.setAttribute("mode", "screen");
  node.setAttribute("result", result);
  return node;
}

function createDefs(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("glass-defs");
  svg.append(document.createElementNS("http://www.w3.org/2000/svg", "defs"));
  document.body.append(svg);
  return svg;
}

/**
 * Encodes the per-pixel bend as an image, the way feDisplacementMap wants it:
 * a channel of 0.5 means "do not move", and the browser shifts by
 * `scale * (channel - 0.5)`. Normalizing by the largest bend in the map and
 * handing back the matching scale keeps the full 8 bits of precision.
 */
function displacementMap(spec: LensSpec): { href: string; scale: number } {
  const longest = Math.max(spec.width, spec.height);
  const resolution = Math.min(1, MAX_MAP_PX / longest);
  const w = Math.max(2, Math.round(spec.width * resolution));
  const h = Math.max(2, Math.round(spec.height * resolution));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("Displacement map canvas is unavailable");

  const image = ctx.createImageData(w, h);
  const deltas = new Float32Array(w * h * 2);
  const halfW = spec.width / 2;
  const halfH = spec.height / 2;
  let peak = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sample at pixel centres, in the panel's own pixel space.
      const px = ((x + 0.5) / w) * spec.width - halfW;
      const py = ((y + 0.5) / h) * spec.height - halfH;
      const depth = -roundedBoxSdf(px, py, halfW, halfH, spec.radius);
      const i = (y * w + x) * 2;
      if (depth <= 0 || depth >= spec.band) continue;

      // Strongest right at the rim, gone by the time the glass is `band` deep.
      const falloff = 1 - smoothstep(0, spec.band, depth);
      const [nx, ny] = sdfNormal(px, py, halfW, halfH, spec.radius);
      // Inward, so the rim samples the backdrop from deeper in and magnifies it.
      const dx = -nx * spec.strength * falloff;
      const dy = -ny * spec.strength * falloff;
      deltas[i] = dx;
      deltas[i + 1] = dy;
      peak = Math.max(peak, Math.abs(dx), Math.abs(dy));
    }
  }

  const scale = Math.max(peak * 2, 1e-3);
  for (let p = 0; p < w * h; p++) {
    const dx = deltas[p * 2] ?? 0;
    const dy = deltas[p * 2 + 1] ?? 0;
    image.data[p * 4] = Math.round(255 * (0.5 + dx / scale));
    image.data[p * 4 + 1] = Math.round(255 * (0.5 + dy / scale));
    image.data[p * 4 + 2] = 128;
    image.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return { href: canvas.toDataURL(), scale };
}

/** Inigo Quilez's rounded-box signed distance. Negative inside the panel. */
function roundedBoxSdf(x: number, y: number, halfW: number, halfH: number, r: number): number {
  const qx = Math.abs(x) - halfW + r;
  const qy = Math.abs(y) - halfH + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

/** Central differences: the analytic normal of a rounded box is not worth it. */
function sdfNormal(
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  r: number,
): [number, number] {
  const e = 0.5;
  const nx = roundedBoxSdf(x + e, y, halfW, halfH, r) - roundedBoxSdf(x - e, y, halfW, halfH, r);
  const ny = roundedBoxSdf(x, y + e, halfW, halfH, r) - roundedBoxSdf(x, y - e, halfW, halfH, r);
  const length = Math.hypot(nx, ny);
  return length < 1e-6 ? [0, 0] : [nx / length, ny / length];
}
