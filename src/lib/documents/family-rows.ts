type FamilyVersion = {
  id: string;
  familyId: string | null;
  isLatest: boolean;
  version: number | null;
  createdAt: Date;
};

/** Call after concrete-version authorization and procedure/stage filtering. */
export function materialFamilyRows<T extends FamilyVersion>(documents: readonly T[]) {
  const families = new Map<string, T[]>();
  for (const document of documents) {
    const key = document.familyId ? `family:${document.familyId}` : `document:${document.id}`;
    const versions = families.get(key) ?? [];
    versions.push(document);
    families.set(key, versions);
  }
  return [...families.values()].map(versions => {
    const ordered = [...versions].sort((a, b) => Number(b.isLatest) - Number(a.isLatest)
      || (b.version ?? 0) - (a.version ?? 0)
      || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      || a.id.localeCompare(b.id));
    return { document: ordered[0], versionCount: versions.length };
  });
}
