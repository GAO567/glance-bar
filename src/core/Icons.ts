/**
 * Lucide icon path registry for Canvas rendering.
 * Paths sourced from lucide-static (ISC License).
 * https://lucide.dev
 *
 * Usage:
 *   drawIcon(ctx, ICONS.phone, cx, cy, size, '#ffffff');
 */

export interface IconDef {
  /** SVG path d-strings to stroke */
  paths: string[];
  /** Optional filled rounded-rect shapes (pause bars, etc.) */
  rects?: { x: number; y: number; w: number; h: number; r: number }[];
  /** Optional circles to stroke */
  circles?: { cx: number; cy: number; r: number }[];
}

export const ICONS: Record<string, IconDef> = {

  // ── Communication ──────────────────────────────────────────────
  'message-circle': {
    paths: [
      'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719',
    ],
  },

  'phone': {
    paths: [
      'M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384',
    ],
  },

  'phone-off': {
    paths: [
      'M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272',
      'M22 2 2 22',
      'M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473',
    ],
  },

  // ── Audio ──────────────────────────────────────────────────────
  'volume-x': {
    paths: [
      'M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z',
      'm16.5 14.5 5-5',
      'm16.5 9.5 5 5',
    ],
  },

  'volume-2': {
    paths: [
      'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z',
      'M16 9a5 5 0 0 1 0 6',
      'M19.364 18.364a9 9 0 0 0 0-12.728',
    ],
  },

  // ── Actions ────────────────────────────────────────────────────
  'send': {
    paths: [
      'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z',
      'm21.854 2.147-10.94 10.939',
    ],
  },

  'send-horizontal': {
    paths: [
      'M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z',
      'M6 12h16',
    ],
  },

  'play': {
    paths: [
      'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z',
    ],
  },

  'pause': {
    paths: [],
    rects: [
      { x: 14, y: 3, w: 5, h: 18, r: 1 },
      { x: 5,  y: 3, w: 5, h: 18, r: 1 },
    ],
  },

  'x': {
    paths: [
      'M18 6 6 18',
      'm6 6 12 12',
    ],
  },

  'minus': {
    paths: ['M5 12h14'],
  },

  'menu': {
    paths: ['M4 12h16', 'M4 6h16', 'M4 18h16'],
  },

  'chevron-right': {
    paths: ['m9 18 6-6-6-6'],
  },

  'arrow-left-right': {
    paths: [
      'm16 3 4 4-4 4',
      'M20 7H4',
      'm8 21-4-4 4-4',
      'M4 17h16',
    ],
  },

  // ── Navigation / Spatial ───────────────────────────────────────
  'map-pin': {
    paths: [
      'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
    ],
    circles: [{ cx: 12, cy: 10, r: 3 }],
  },

  'lock': {
    paths: ['M7 11V7a5 5 0 0 1 10 0v4'],
    rects: [{ x: 3, y: 11, w: 18, h: 11, r: 2 }],
  },
};

/**
 * Draw a Lucide icon centered at (cx, cy) with given pixel size and color.
 * Uses ctx.stroke() — matches Lucide's stroke-based design language.
 *
 * @param strokeWidth  Line weight in the 24×24 icon coordinate space (Lucide default: 2)
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  icon: IconDef,
  cx: number,
  cy: number,
  size: number,
  color: string,
  strokeWidth = 2
): void {
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(scale, scale);

  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = color;

  // Stroke paths
  for (const d of icon.paths) {
    const path = new Path2D(d);
    ctx.stroke(path);
  }

  // Rounded-rect shapes (e.g. pause bars) — filled
  if (icon.rects) {
    for (const r of icon.rects) {
      ctx.beginPath();
      // Manually draw rounded rect for compat
      ctx.moveTo(r.x + r.r, r.y);
      ctx.lineTo(r.x + r.w - r.r, r.y);
      ctx.quadraticCurveTo(r.x + r.w, r.y, r.x + r.w, r.y + r.r);
      ctx.lineTo(r.x + r.w, r.y + r.h - r.r);
      ctx.quadraticCurveTo(r.x + r.w, r.y + r.h, r.x + r.w - r.r, r.y + r.h);
      ctx.lineTo(r.x + r.r, r.y + r.h);
      ctx.quadraticCurveTo(r.x, r.y + r.h, r.x, r.y + r.h - r.r);
      ctx.lineTo(r.x, r.y + r.r);
      ctx.quadraticCurveTo(r.x, r.y, r.x + r.r, r.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Circles
  if (icon.circles) {
    for (const c of icon.circles) {
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();
}
