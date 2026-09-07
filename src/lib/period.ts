export type DashboardPeriod = "month" | "quarter" | "semester" | "year" | "all";

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  month: "Mois",
  quarter: "Trimestre",
  semester: "Semestre",
  year: "Année",
  all: "Tout",
};

export function periodBounds(period: DashboardPeriod, now = new Date()) {
  if (period === "all") return { start: null as string | null, end: null as string | null };
  const year = now.getFullYear();
  const month = now.getMonth();
  let startMonth = month;
  let endMonth = month;
  if (period === "quarter") { startMonth = Math.floor(month / 3) * 3; endMonth = startMonth + 2; }
  if (period === "semester") { startMonth = month < 6 ? 0 : 6; endMonth = startMonth + 5; }
  if (period === "year") { startMonth = 0; endMonth = 11; }
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, endMonth + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  return { start: iso(start), end: iso(end) };
}

export function dateInPeriod(value: string | null | undefined, period: DashboardPeriod, now = new Date()) {
  if (period === "all") return true;
  if (!value) return false;
  const { start, end } = periodBounds(period, now);
  return !!start && !!end && value.slice(0, 10) >= start && value.slice(0, 10) <= end;
}

export function rangesOverlap(startValue: string | null | undefined, endValue: string | null | undefined, period: DashboardPeriod, now = new Date()) {
  if (period === "all") return true;
  if (!startValue) return false;
  const { start, end } = periodBounds(period, now);
  const itemStart = startValue.slice(0, 10);
  const itemEnd = (endValue || startValue).slice(0, 10);
  return !!start && !!end && itemStart <= end && itemEnd >= start;
}
