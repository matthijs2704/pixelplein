/**
 * Return a sorted array of group names from a stats object.
 * Always includes 'ungrouped'.
 */
export function extractGroups(stats) {
  const groups = Object.keys((stats?.photos?.groups) || {}).sort();
  return groups.length ? groups : ['ungrouped'];
}
