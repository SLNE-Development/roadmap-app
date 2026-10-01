/**
 * Suggests a name for a saved view: the page name, then the active filters.
 *
 * @param base the page name, such as `Board`
 * @param chips the active filters as `Label: value` texts
 * @returns for example `Board · Owner: Ammo`, cut to 60 characters
 */
export function suggestViewName(base: string, chips: string[]): string {
  return [base, ...chips].join(" · ").slice(0, 60);
}

/**
 * Describes the active filters as `Label: value` texts, in the order of `defs`;
 * the search text comes first. A value that matches no option shows as is.
 *
 * @param defs the filters, each with its query key, label and options
 * @param current the query values
 * @param searchLabel the word before the search text
 */
export function activeChips(
  defs: { key: string; label: string; options: { value: string; label: string }[] }[],
  current: Record<string, string | null | undefined>,
  searchLabel = "Search",
): string[] {
  const chips = current.q ? [`${searchLabel}: ${current.q}`] : [];
  for (const d of defs) {
    const value = current[d.key];
    if (value) chips.push(`${d.label}: ${d.options.find((o) => o.value === value)?.label ?? value}`);
  }
  return chips;
}
