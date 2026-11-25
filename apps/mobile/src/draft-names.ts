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

export function getDraftProjects<
  Choice extends { template: { id: string; name: string } },
  Draft extends { name?: string | null },
>(choices: readonly Choice[], drafts: Readonly<Record<string, Readonly<Record<string, Draft>>>>, filterId?: string) {
  const seenNames = new Set<string>();
  const sharedNames = new Set<string>();
  for (const { template } of choices) {
    for (const draft of Object.values(drafts[template.id] ?? {})) {
      const name = (draft.name ?? template.name).toLowerCase();
      if (seenNames.has(name)) sharedNames.add(name);
      seenNames.add(name);
    }
  }
  return choices.flatMap((choice) => {
    const { template } = choice;
    if (filterId !== undefined && filterId !== template.id) return [];
    return getNamedDrafts(drafts[template.id] ?? {}, (draft) => draft.name ?? template.name).map((project) => {
      const { name, label } = project;
      const deleteTarget = sharedNames.has(name.toLowerCase()) ? `“${label}” from ${template.name}` : `${label} draft`;
      return { ...choice, ...project, deleteTarget };
    });
  });
}

// Keep identically named cards and their confirmation dialogs distinguishable after relaunch.
export function getNamedDrafts<Draft>(drafts: Readonly<Record<string, Draft>>, getName: (draft: Draft) => string) {
  const siblings = Object.entries(drafts).map(([draftId, draft]) => ({ draftId, draft, name: getName(draft) }));
  const idsByName = new Map<string, string[]>();
  for (const { draftId, name } of siblings) {
    const key = name.toLowerCase();
    const ids = idsByName.get(key);
    if (ids) ids.push(draftId);
    else idsByName.set(key, [draftId]);
  }
  for (const ids of idsByName.values()) ids.sort();
  return siblings.map((project) => {
    const { name, draftId } = project;
    const ids = idsByName.get(name.toLowerCase())!;
    const label = ids.length > 1 ? `${name} (${ids.indexOf(draftId) + 1} of ${ids.length})` : name;
    return { ...project, label };
  });
}
