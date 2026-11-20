export function newId(): string {
  // randomUUID is only available in secure contexts (https / localhost).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
