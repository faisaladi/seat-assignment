// Canvas seat map — renders the venue from grid positions, with zoom/pan,
// hover tooltips and click-to-select. Smooth at 2,000+ seats because hit
// testing is O(1) grid math (no per-seat hit regions).

import type { EventState, Seat } from '../core/types';
import { seatByAssignment } from '../core/types';
import { h } from './components';

const PITCH = 30; // px between seat centers at zoom 1
const SIZE = 26; // seat square size

export const STATUS_COLORS: Record<string, string> = {
  available: '#6b7280',
  blocked: '#dc2626',
  restricted: '#f97316',
  held: '#a855f7',
  damaged: '#7f1d1d',
};
export const ASSIGN_COLORS: Record<string, string> = {
  assigned: '#3b82f6',
  approved: '#22c55e',
  uploaded: '#14b8a6',
};
const CATEGORY_PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16'];

export interface SeatMapApi {
  el: HTMLElement;
  update: () => void;
  setHighlight: (labels: Set<string>) => void;
  selected: () => string | null;
  select: (label: string | null) => void;
}

export function createSeatMap(
  getState: () => EventState | undefined,
  opts: {
    colorBy?: 'status' | 'category';
    onSelect?: (label: string | null) => void;
    showLegend?: boolean;
  } = {},
): SeatMapApi {
  const canvas = h('canvas', { class: 'seat-canvas' });
  const tooltip = h('div', { class: 'seat-tooltip', style: 'display:none' });
  const wrap = h('div', { class: 'seat-map-wrap' }, canvas, tooltip);
  const ctx = canvas.getContext('2d')!;

  let tx = 40;
  let ty = 40;
  let scale = 1;
  let fitted = false;
  let selected: string | null = null;
  let highlight = new Set<string>();
  let colorBy: 'status' | 'category' = opts.colorBy ?? 'status';

  const categoryColor = (() => {
    const map = new Map<string, string>();
    return (cat: string) => {
      if (!map.has(cat)) map.set(cat, CATEGORY_PALETTE[map.size % CATEGORY_PALETTE.length]);
      return map.get(cat)!;
    };
  })();

  // index for fast hit-testing
  let grid = new Map<string, Seat>();
  function rebuildIndex(state: EventState): void {
    grid = new Map();
    for (const label of state.seatOrder) {
      const s = state.seats[label];
      grid.set(`${s.grid_x},${s.grid_y}`, s);
    }
  }

  function hit(clientX: number, clientY: number): Seat | null {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left - tx) / scale;
    const y = (clientY - rect.top - ty) / scale;
    const gx = Math.floor(x / PITCH);
    const gy = Math.floor(y / PITCH);
    if (x - gx * PITCH > SIZE || y - gy * PITCH > SIZE) return null;
    return grid.get(`${gx},${gy}`) ?? null;
  }

  function fitToContent(state: EventState): void {
    if (!state.seatOrder.length) return;
    let maxX = 0;
    let maxY = 0;
    for (const label of state.seatOrder) {
      const s = state.seats[label];
      maxX = Math.max(maxX, s.grid_x);
      maxY = Math.max(maxY, s.grid_y);
    }
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    const contentW = (maxX + 1) * PITCH;
    const contentH = (maxY + 2) * PITCH + 30;
    scale = Math.min(1.4, Math.max(0.15, Math.min(w / (contentW + 80), hgt / (contentH + 80))));
    tx = (w - contentW * scale) / 2;
    ty = 50;
    fitted = true;
  }

  function draw(): void {
    const state = getState();
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const hgt = wrap.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== hgt * dpr) {
      canvas.width = w * dpr;
      canvas.height = hgt * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${hgt}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    if (!state || !state.seatOrder.length) return;
    if (!fitted) fitToContent(state);
    rebuildIndex(state);

    const bySeat = new Map(Object.values(state.assignments).map((a) => [a.seat_label, a]));

    // stage marker
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    let maxX = 0;
    for (const label of state.seatOrder) maxX = Math.max(maxX, state.seats[label].grid_x);
    ctx.fillStyle = '#d1d5db';
    ctx.fillRect(0, -36, (maxX + 1) * PITCH - (PITCH - SIZE), 16);
    ctx.fillStyle = '#6b7280';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('STAGE', ((maxX + 1) * PITCH) / 2, -24);

    for (const label of state.seatOrder) {
      const s = state.seats[label];
      const a = bySeat.get(label);
      const x = s.grid_x * PITCH;
      const y = s.grid_y * PITCH;

      let fill: string;
      if (a) fill = ASSIGN_COLORS[a.status];
      else if (colorBy === 'category' && s.status === 'available') fill = categoryColor(s.category || '?');
      else fill = STATUS_COLORS[s.status] ?? STATUS_COLORS.available;

      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x, y, SIZE, SIZE, 5);
      ctx.fill();

      if (s.status === 'blocked' || s.status === 'damaged') {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 6);
        ctx.lineTo(x + SIZE - 6, y + SIZE - 6);
        ctx.moveTo(x + SIZE - 6, y + 6);
        ctx.lineTo(x + 6, y + SIZE - 6);
        ctx.stroke();
      }
      if (s.status === 'held' && !a) {
        ctx.strokeStyle = '#7c3aed';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, SIZE - 2, SIZE - 2, 4);
        ctx.stroke();
      }
      if (highlight.has(label)) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(x - 2, y - 2, SIZE + 4, SIZE + 4, 7);
        ctx.stroke();
      }
      if (selected === label) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.roundRect(x - 3, y - 3, SIZE + 6, SIZE + 6, 8);
        ctx.stroke();
      }

      if (scale >= 0.75) {
        const num = label.match(/\d+$/)?.[0] ?? '';
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = `${num.length > 2 ? 8 : 10}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(num, x + SIZE / 2, y + SIZE / 2 + 1);
      }
    }
    ctx.restore();
  }

  // ── interactions ──
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      tx += dx;
      ty += dy;
      lastX = e.clientX;
      lastY = e.clientY;
      tooltip.style.display = 'none';
      draw();
      return;
    }
    const s = hit(e.clientX, e.clientY);
    if (s) {
      const state = getState()!;
      const a = seatByAssignment(state)[s.seat_label];
      const buyer = a ? state.buyers[a.ticket_code] : undefined;
      tooltip.innerHTML = '';
      tooltip.append(
        h('strong', {}, s.seat_label),
        h('div', {}, `${s.category || 'no category'} · ${s.status}`),
        ...(buyer
          ? [h('div', {}, `${buyer.name || buyer.ticket_code}`), h('div', { class: 'muted' }, `booking ${buyer.booking_code} · ${a!.status}`)]
          : [h('div', { class: 'muted' }, 'empty')]),
      );
      const rect = wrap.getBoundingClientRect();
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(e.clientX - rect.left + 14, rect.width - 180)}px`;
      tooltip.style.top = `${e.clientY - rect.top + 14}px`;
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.style.display = 'none';
      canvas.style.cursor = 'grab';
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    if (!moved) {
      const s = hit(e.clientX, e.clientY);
      selected = s ? s.seat_label : null;
      opts.onSelect?.(selected);
      draw();
    }
  });
  canvas.addEventListener('pointerleave', () => {
    tooltip.style.display = 'none';
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.min(3, Math.max(0.12, scale * factor));
      tx = mx - ((mx - tx) / scale) * next;
      ty = my - ((my - ty) / scale) * next;
      scale = next;
      draw();
    },
    { passive: false },
  );

  const resizeObs = new ResizeObserver(() => draw());
  resizeObs.observe(wrap);

  if (opts.showLegend !== false) {
    wrap.append(
      h(
        'div',
        { class: 'map-legend' },
        legendItem(STATUS_COLORS.available, 'Empty'),
        legendItem(ASSIGN_COLORS.assigned, 'Assigned'),
        legendItem(ASSIGN_COLORS.approved, 'Approved'),
        legendItem(ASSIGN_COLORS.uploaded, 'Uploaded'),
        legendItem(STATUS_COLORS.blocked, 'Blocked'),
        legendItem(STATUS_COLORS.restricted, 'Restricted view'),
        legendItem(STATUS_COLORS.held, 'Held'),
      ),
    );
  }

  function legendItem(color: string, label: string): HTMLElement {
    return h('span', { class: 'legend-item' }, h('span', { class: 'legend-dot', style: `background:${color}` }), label);
  }

  return {
    el: wrap,
    update: draw,
    setHighlight: (labels) => {
      highlight = labels;
      draw();
    },
    selected: () => selected,
    select: (label) => {
      selected = label;
      draw();
    },
  };
}
