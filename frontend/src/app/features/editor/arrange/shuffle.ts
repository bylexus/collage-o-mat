// Random order helper shared by `arrange.ts` and the strategies. Pure, no Angular.

/** Shuffles the array in place (Fisher–Yates) with `random` (values in [0, 1)). */
export function shuffle<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}
