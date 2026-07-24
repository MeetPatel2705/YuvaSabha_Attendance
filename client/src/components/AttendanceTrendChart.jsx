import { useMemo, useState } from 'react';

const CHART_HEIGHT = 220;
const AXIS_LABEL_HEIGHT = 32;
const SLOT_WIDTH = 44;
const BAR_WIDTH = 22;
const BAR_RADIUS = 4;
const LEFT_GUTTER = 40;

function niceMax(value) {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const residual = value / magnitude;
  let niceResidual;
  if (residual <= 1) niceResidual = 1;
  else if (residual <= 2) niceResidual = 2;
  else if (residual <= 5) niceResidual = 5;
  else niceResidual = 10;
  return niceResidual * magnitude;
}

function formatShortDate(iso, showYear) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: showYear ? '2-digit' : undefined,
    timeZone: 'UTC',
  });
}

function formatFullDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Rounded top, square baseline: an rx-rounded rect plus a flush square patch
// over its bottom BAR_RADIUS px, since SVG <rect> can't take per-corner radii.
function Bar({ x, y, width, height, radius, fill, className }) {
  const r = Math.min(radius, height, width / 2);
  return (
    <g className={className}>
      <rect x={x} y={y} width={width} height={height} rx={r} ry={r} fill={fill} />
      {height > r && <rect x={x} y={y + height - r} width={width} height={r} fill={fill} />}
    </g>
  );
}

export default function AttendanceTrendChart({ weeks, totalMembers, onSelectDate }) {
  const [hovered, setHovered] = useState(null);
  const [showTable, setShowTable] = useState(false);

  const max = useMemo(() => niceMax(Math.max(...weeks.map((w) => w.presentCount), 0)), [weeks]);
  const ticks = useMemo(() => [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f)), [max]);

  if (weeks.length === 0) {
    return (
      <div className="trend-chart trend-chart-empty">
        <p className="muted">No attendance recorded yet — the trend will appear after the first Saturday.</p>
      </div>
    );
  }

  const chartWidth = Math.max(weeks.length * SLOT_WIDTH, 280);
  const plotHeight = CHART_HEIGHT - AXIS_LABEL_HEIGHT;
  const scaleY = (value) => plotHeight - (value / max) * plotHeight;

  return (
    <div className="trend-chart">
      <div className="trend-chart-scroll">
        <svg
          className="trend-chart-svg"
          width={chartWidth + LEFT_GUTTER}
          height={CHART_HEIGHT}
          role="img"
          aria-label={`Present count per Yuva Sabha, ${formatFullDate(weeks[0].date)} to ${formatFullDate(weeks[weeks.length - 1].date)}`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={LEFT_GUTTER}
                x2={LEFT_GUTTER + chartWidth}
                y1={scaleY(t)}
                y2={scaleY(t)}
                className="trend-gridline"
              />
              <text x={LEFT_GUTTER - 8} y={scaleY(t)} className="trend-tick-label" textAnchor="end" dy="0.32em">
                {t}
              </text>
            </g>
          ))}

          {weeks.map((w, i) => {
            const barHeight = (w.presentCount / max) * plotHeight;
            const x = LEFT_GUTTER + i * SLOT_WIDTH + (SLOT_WIDTH - BAR_WIDTH) / 2;
            const y = scaleY(w.presentCount);
            const showYear = i === 0 || weeks[i - 1].date.slice(0, 4) !== w.date.slice(0, 4);
            const isHovered = hovered === i;
            return (
              <g
                key={w.date}
                tabIndex={0}
                role="button"
                aria-label={`${formatFullDate(w.date)}: ${w.presentCount} present${
                  totalMembers ? ` of ${totalMembers}` : ''
                }`}
                className="trend-bar-hit"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                onClick={() => onSelectDate?.(w.date)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectDate?.(w.date);
                  }
                }}
              >
                <rect
                  x={LEFT_GUTTER + i * SLOT_WIDTH}
                  y={0}
                  width={SLOT_WIDTH}
                  height={plotHeight}
                  fill="transparent"
                />
                <Bar
                  x={x}
                  y={y}
                  width={BAR_WIDTH}
                  height={Math.max(barHeight, 0)}
                  radius={BAR_RADIUS}
                  fill={isHovered ? 'var(--accent-hover)' : 'var(--accent)'}
                  className="trend-bar"
                />
                <text
                  x={LEFT_GUTTER + i * SLOT_WIDTH + SLOT_WIDTH / 2}
                  y={plotHeight + 18}
                  className="trend-tick-label"
                  textAnchor="middle"
                >
                  {formatShortDate(w.date, showYear)}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered !== null && (
          <div
            className="trend-tooltip"
            style={{ left: LEFT_GUTTER + hovered * SLOT_WIDTH + SLOT_WIDTH / 2 }}
          >
            <strong>{weeks[hovered].presentCount}</strong> present
            {totalMembers ? ` of ${totalMembers}` : ''}
            <div className="trend-tooltip-date">{formatFullDate(weeks[hovered].date)}</div>
          </div>
        )}
      </div>

      <button type="button" className="link-button trend-table-toggle" onClick={() => setShowTable((v) => !v)}>
        {showTable ? 'Hide table' : 'View as table'}
      </button>

      {showTable && (
        <table className="trend-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Present</th>
            </tr>
          </thead>
          <tbody>
            {[...weeks].reverse().map((w) => (
              <tr
                key={w.date}
                className={onSelectDate ? 'trend-table-row-clickable' : undefined}
                onClick={() => onSelectDate?.(w.date)}
              >
                <td>{formatFullDate(w.date)}</td>
                <td>
                  {w.presentCount}
                  {totalMembers ? ` / ${totalMembers}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
