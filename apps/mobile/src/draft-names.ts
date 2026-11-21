export function nextDraftName(
  templateName: string,
  siblings: Readonly<Record<string, { name?: string | null }>>,
  copyOf?: string,
) {
  const names = new Set(Object.values(siblings).map((draft) => (draft.name ?? templateName).toLowerCase()));
  const base = copyOf === undefined ? templateName : `${copyOf} copy`;
  if (!names.size || (copyOf !== undefined && !names.has(base.toLowerCase()))) return base;
  let number = 2;
  while (names.has(`${base} ${number}`.toLowerCase())) number++;
  return `${base} ${number}`;
}
