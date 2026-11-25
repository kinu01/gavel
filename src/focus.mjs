// Learns where the maintainers are working now from what they closed as fixed recently.
// Each label gets the share of recent fixes that carried it; an issue's focus is its best label share.
export function focusAreas(recentFixes) {
  const counts = {};
  for (const fix of recentFixes) for (const l of new Set(fix.labels)) counts[l] = (counts[l] || 0) + 1;
  const total = recentFixes.length || 1;
  return Object.fromEntries(Object.entries(counts).map(([l, c]) => [l, c / total]));
}

export function focusOf(labels, areas) {
  return labels.reduce((best, l) => Math.max(best, areas[l] || 0), 0);
}
