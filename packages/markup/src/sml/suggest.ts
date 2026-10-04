/** Levenshtein distance, capped so a long non-match is cheap. */
const distance = (a: string, b: string, cap: number): number => {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        row[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = row;
  }
  return previous[b.length]!;
};

/** The candidate closest to `name`, when one is close enough to be a typo. */
export const didYouMean = (name: string, candidates: readonly string[]): string | undefined => {
  const lower = name.toLowerCase();
  const exact = candidates.find((candidate) => candidate.toLowerCase() === lower);
  if (exact !== undefined && exact !== name) return exact;
  const cap = Math.max(1, Math.min(3, Math.floor(name.length / 3)));
  let best: string | undefined;
  let bestDistance = cap + 1;
  for (const candidate of candidates) {
    const d = distance(lower, candidate.toLowerCase(), cap);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
};
