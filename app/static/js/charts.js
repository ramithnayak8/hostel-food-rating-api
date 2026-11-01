// Hand-rolled SVG charts for the weekly view: average score per day (line, fixed 1-5 scale)
// and ratings per day (bars). Two charts, never a dual axis. Each day is a focusable hit
// target with a tooltip; `onSelect(index)` fires on click / Enter.

import { dom, dow, fmt2, fmtDate, fmtInt, html, plural, raw } from "./lib.js";

const W = 720;
const PAD = { top: 24, right: 18, bottom: 40, left: 34 };
// Per-chart geometry: canvas width, y-axis gutter, inset of the first/last day from the axis,
// and the gap between the two lines of each day label.
const LINE = { w: W, left: PAD.left, inset: 0, labelGap: 14 };
const BARS = { w: 380, left: 44, inset: 20, labelGap: 18 };

function xFor(i, n, g = LINE) {
  const inner = g.w - g.left - PAD.right - 2 * g.inset;
  const start = g.left + g.inset;
  return n <= 1 ? start + inner / 2 : start + (inner * i) / (n - 1);
}

function band(n, g = LINE) {
  return (g.w - g.left - PAD.right - 2 * g.inset) / Math.max(1, n - 1);
}

function xLabels(days, height, selected, g = LINE) {
  return days
    .map((d, i) => {
      const x = xFor(i, days.length, g);
      const strong = i === selected ? " strong" : "";
      return `<text class="axis-label${strong}" x="${x}" y="${height - 6 - g.labelGap}" text-anchor="middle">${dow(d.date)}</text>
        <text class="axis-label${strong}" x="${x}" y="${height - 6}" text-anchor="middle">${dom(d.date)}</text>`;
    })
    .join("");
}

function hitTargets(days, height, labelFor, g = LINE) {
  const w = band(days.length, g);
  return days
    .map((d, i) => {
      const x = xFor(i, days.length, g) - w / 2;
      return `<rect class="hit" data-i="${i}" x="${x}" y="0" width="${w}" height="${height - PAD.bottom + 8}" tabindex="0" role="button" aria-label="${labelFor(d)}"></rect>`;
    })
    .join("");
}

export function scoreChart(days, selected) {
  const H = 280;
  const n = days.length;
  const y = (v) => PAD.top + ((5 - v) / 4) * (H - PAD.top - PAD.bottom);
  const grid = [1, 2, 3, 4, 5]
    .map((v) => `<line class="gridline" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis-label" x="${PAD.left - 12}" y="${y(v) + 4}" text-anchor="end">${v}</text>`)
    .join("");

  // Break the line where a day has no ratings instead of drawing through it.
  const segments = [];
  let current = [];
  days.forEach((d, i) => {
    if (d.avg_score === null || d.avg_score === undefined) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push([xFor(i, n), y(d.avg_score)]);
  });
  if (current.length) segments.push(current);
  const line = segments
    .map((pts) => `<path class="line" d="M${pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join("L")}"/>`)
    .join("");
  const area = segments
    .filter((pts) => pts.length > 1)
    .map((pts) => {
      const base = y(1).toFixed(1);
      const path = pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join("L");
      return `<path class="area" d="M${pts[0][0].toFixed(1)},${base}L${path}L${pts[pts.length - 1][0].toFixed(1)},${base}Z"/>`;
    })
    .join("");

  const dots = days
    .map((d, i) => {
      if (d.avg_score === null || d.avg_score === undefined) return "";
      const sel = i === selected;
      return `<circle class="dot${sel ? " is-selected" : ""}" cx="${xFor(i, n)}" cy="${y(d.avg_score)}" r="${sel ? 6 : 4.5}"/>`;
    })
    .join("");

  const sel = days[selected];
  const selX = sel ? xFor(selected, n) : 0;
  // Highlight the selected day, kept inside the plot so the first and last days don't spill out.
  const half = Math.min(band(n) / 2 - 6, 40);
  const bandL = Math.max(PAD.left - 14, selX - half);
  const bandR = Math.min(W - PAD.right + 14, selX + half);
  const selBand = sel ? `<rect class="sel-band" x="${bandL}" y="${PAD.top - 12}" width="${bandR - bandL}" height="${H - PAD.top - PAD.bottom + 12}" rx="10"/>` : "";
  const label =
    sel && sel.avg_score !== null && sel.avg_score !== undefined
      ? `<text class="value-label" x="${selX}" y="${y(sel.avg_score) - 14}" text-anchor="middle">${fmt2(sel.avg_score)}</text>`
      : "";
  const empty = days.every((d) => !d.rating_count)
    ? `<text class="empty-label" x="${W / 2}" y="${H / 2 - 6}" text-anchor="middle">No ratings in this week yet</text>`
    : "";

  const svg = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Average score per day, 1 to 5">
    ${selBand}${grid}${area}${line}${dots}${label}${empty}
    <line class="crosshair" x1="0" x2="0" y1="${PAD.top - 8}" y2="${H - PAD.bottom}"/>
    ${xLabels(days, H, selected)}
    ${hitTargets(days, H, (d) => `${fmtDate(d.date)}: ${d.avg_score === null ? "no ratings" : `average ${fmt2(d.avg_score)}, ${d.rating_count} ratings`}`)}
  </svg>`;
  return chartShell(svg, "score");
}

export function countChart(days, selected) {
  const H = 330;
  const PB = PAD.bottom + 8;
  const n = days.length;
  const max = Math.max(1, ...days.map((d) => d.rating_count || 0));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const y = (v) => PAD.top + (1 - v / top) * (H - PAD.top - PB);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const grid = ticks
    .map((v) => `<line class="gridline" x1="${BARS.left}" x2="${BARS.w - PAD.right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis-label" x="${BARS.left - 10}" y="${y(v) + 4}" text-anchor="end">${fmtInt(v)}</text>`)
    .join("");
  const barW = Math.min(30, band(n, BARS) * 0.5);
  const base = y(0);
  const bars = days
    .map((d, i) => {
      const count = d.rating_count || 0;
      if (!count) return "";
      const x = xFor(i, n, BARS) - barW / 2;
      const top = y(count);
      const r = Math.min(4, (base - top) / 2, barW / 2);
      const dim = selected >= 0 && i !== selected ? " is-dim" : "";
      return `<path class="bar${dim}" d="M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${base}Z"/>`;
    })
    .join("");
  const sel = days[selected];
  const label = sel?.rating_count
    ? `<text class="value-label" x="${xFor(selected, n, BARS)}" y="${y(sel.rating_count) - 8}" text-anchor="middle">${fmtInt(sel.rating_count)}</text>`
    : "";
  const svg = `<svg viewBox="0 0 ${BARS.w} ${H}" role="group" aria-label="Number of ratings per day">
    ${grid}${bars}${label}
    <line class="crosshair" x1="0" x2="0" y1="${PAD.top - 8}" y2="${H - PB}"/>
    ${xLabels(days, H, selected, BARS)}
    ${hitTargets(days, H, (d) => `${fmtDate(d.date)}: ${plural(d.rating_count || 0, "rating")}`, BARS)}
  </svg>`;
  return chartShell(svg, "count", true);
}

function niceStep(max) {
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 5, 10].find((m) => m * pow >= rough) ?? 10;
  return Math.max(1, unit * pow);
}

function chartShell(svg, kind, compact = false) {
  return html`<div class="chart-wrap" data-chart="${kind}"><div class="chart ${compact ? "compact" : ""}">${raw(svg)}</div><div class="tooltip" aria-hidden="true"></div></div>`;
}

export function weekTable(days) {
  return html`<div class="table-scroll"><table class="data-table">
    <caption class="sr-only">Ratings per day this week</caption>
    <thead><tr><th scope="col">Day</th><th scope="col">Ratings</th><th scope="col">Average score</th></tr></thead>
    <tbody>${days.map((d) => html`<tr><td>${fmtDate(d.date)}</td><td>${fmtInt(d.rating_count)}</td><td>${fmt2(d.avg_score)}</td></tr>`)}</tbody>
  </table></div>`;
}

/** Wire hover tooltips, crosshair and selection for every chart inside `root`. */
export function bindCharts(root, days, onSelect) {
  root.querySelectorAll(".chart-wrap").forEach((wrap) => {
    const svg = wrap.querySelector("svg");
    const tip = wrap.querySelector(".tooltip");
    const cross = wrap.querySelector(".crosshair");
    if (!svg || !tip) return;

    const show = (i) => {
      const d = days[i];
      if (!d) return;
      tip.innerHTML = String(html`<div class="t-date">${fmtDate(d.date, "long")}</div>
        <div><b>${d.avg_score === null ? "No ratings" : fmt2(d.avg_score)}</b>${d.avg_score === null ? "" : " average"}</div>
        <div>${plural(d.rating_count || 0, "rating")}</div>`);
      const box = svg.getBoundingClientRect();
      const g = wrap.dataset.chart === "count" ? BARS : LINE;
      const cx = xFor(i, days.length, g);
      const x = cx * (box.width / g.w);
      cross?.setAttribute("x1", String(cx));
      cross?.setAttribute("x2", String(cx));
      cross?.classList.add("on");
      const tipW = tip.offsetWidth || 160;
      const left = Math.min(Math.max(0, x - tipW / 2), Math.max(0, box.width - tipW));
      tip.style.transform = `translate(${left}px, -${(tip.offsetHeight || 70) + 6}px)`;
      tip.classList.add("on");
    };
    const hide = () => {
      tip.classList.remove("on");
      cross?.classList.remove("on");
    };

    svg.querySelectorAll(".hit").forEach((hit) => {
      const i = Number(hit.dataset.i);
      hit.addEventListener("pointerenter", () => show(i));
      hit.addEventListener("focus", () => show(i));
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("blur", hide);
      hit.addEventListener("click", () => onSelect?.(i));
      hit.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(i);
        }
      });
    });
  });
}
