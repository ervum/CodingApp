export function upsertById<T extends { id: string }>(
  list: readonly T[],
  item: T,
  mode: 'replace-or-append' | 'prepend' = 'replace-or-append',
): T[] {
  const index = list.findIndex((x) => x.id === item.id);
  if (index >= 0) {
    const next = [...list];
    next[index] = item;
    return next;
  }
  return mode === 'prepend' ? [item, ...list] : [...list, item];
}
