interface ChartPoint {
  label: string;
  short: string;
  value: number;
}

interface ChartProps {
  points: ChartPoint[];
  /** Максимум шкалы. Если не задан — максимум по данным (минимум 1). */
  max?: number;
  /** Формат подписи значения над столбцом. */
  formatValue?: (value: number) => string;
  /** Подпись под графиком (для скринридеров). */
  ariaLabel: string;
  /** Что показать, если данных нет. */
  emptyText?: string;
  /** Цвет столбцов: фирменный градиент или акцентный. */
  tone?: "brand" | "accent";
}

const WIDTH = 640;
const HEIGHT = 240;
const PADDING = { top: 28, right: 16, bottom: 34, left: 16 };

/**
 * Лёгкий SVG-график (без внешних зависимостей): столбцы по категориям
 * с сеткой, подписями и нативными подсказками (`<title>`).
 *
 * Используется на странице обзора: активность звонков по дням недели и
 * успеваемость по классам 5–11.
 */
export function AdminBarChart({
  points,
  max,
  formatValue = (value) => String(value),
  ariaLabel,
  emptyText = "Пока нет данных",
  tone = "brand",
}: ChartProps) {
  const values = points.map((point) => point.value);
  const peak = max ?? Math.max(...values, 1);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const step = points.length > 0 ? plotWidth / points.length : plotWidth;
  const barWidth = Math.min(step * 0.56, 56);
  const hasData = values.some((value) => value > 0);

  const gradientId = tone === "brand" ? "chartGradientBrand" : "chartGradientAccent";

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="chartGradientBrand" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="chartGradientAccent" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#0891b2" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#00d9ff" stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* Сетка: 0%, 25%, 50%, 75%, 100% */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = PADDING.top + plotHeight * (1 - ratio);
          return (
            <line
              key={ratio}
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y}
              y2={y}
              stroke="rgba(148, 163, 184, 0.14)"
              strokeDasharray={ratio === 0 ? undefined : "4 6"}
            />
          );
        })}

        {/* Подписи шкалы */}
        {[0, 0.5, 1].map((ratio) => {
          const y = PADDING.top + plotHeight * (1 - ratio);
          return (
            <text
              key={`scale-${ratio}`}
              x={PADDING.left}
              y={y - 6}
              fontSize="15"
              fill="#64748b"
              textAnchor="start"
            >
              {formatValue(Math.round(peak * ratio * 100) / 100)}
            </text>
          );
        })}

        {points.map((point, index) => {
          const value = Math.max(0, point.value);
          const barHeight = peak > 0 ? (value / peak) * plotHeight : 0;
          const x = PADDING.left + step * index + (step - barWidth) / 2;
          const y = PADDING.top + plotHeight - barHeight;

          return (
            <g key={point.label}>
              <title>{`${point.label}: ${formatValue(value)}`}</title>

              {/* Подсветка колонки при наведении */}
              <rect
                x={PADDING.left + step * index}
                y={PADDING.top}
                width={step}
                height={plotHeight}
                fill="rgba(168, 85, 247, 0.06)"
                className="opacity-0 transition-opacity duration-200 hover:opacity-100"
              />

              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, value > 0 ? 3 : 0)}
                rx="10"
                fill={`url(#${gradientId})`}
                opacity={hasData ? 1 : 0.35}
              />

              {value > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={y - 8}
                  fontSize="16"
                  fontWeight="600"
                  fill="#e2e8f0"
                  textAnchor="middle"
                >
                  {formatValue(value)}
                </text>
              )}

              <text
                x={x + barWidth / 2}
                y={HEIGHT - 12}
                fontSize="17"
                fill="#94a3b8"
                textAnchor="middle"
              >
                {point.short}
              </text>
            </g>
          );
        })}
      </svg>

      {!hasData && <p className="mt-1 text-center text-xs text-slate-500">{emptyText}</p>}
    </div>
  );
}
