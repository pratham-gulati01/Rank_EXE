export type GameMode = 'rank' | 'versus' | 'kmk' | 'smash' | 'fact_cap' | 'rating';
export type ChallengeEntry = { id: string; text: string; imageUrl?: string };
export type Challenge = {
  id: string;
  title: string;
  description: string;
  category: string;
  mode: GameMode;
  themeColor?: string;
  entries: ChallengeEntry[];
  creator: string;
  createdAt: number;
  postId?: `t3_${string}`;
  status: 'draft' | 'published';
  subredditName?: string;
};
export type Submission = { mode: GameMode; values: Record<string, string | number> };
export type Aggregate = { plays: number; submissions: Record<string, Submission> };
export const MODE_LABELS: Record<GameMode, string> = {
  rank: 'Rank Roulette',
  versus: 'Pick a Side',
  kmk: 'Kiss, Marry, Kill',
  smash: 'Smash or Pass',
  fact_cap: 'Fact or Cap',
  rating: 'Rating',
};
export const MIN_ENTRIES: Record<GameMode, number> = { rank: 2, versus: 2, kmk: 3, smash: 2, fact_cap: 2, rating: 1 };
export const MAX_ENTRIES = 30;
export const MAX_ENTRIES_BY_MODE: Record<GameMode, number> = { rank: 10, versus: MAX_ENTRIES, kmk: 3, smash: MAX_ENTRIES, fact_cap: MAX_ENTRIES, rating: MAX_ENTRIES };
export const validEntryCount = (mode: GameMode, count: number): boolean => count >= MIN_ENTRIES[mode] && count <= MAX_ENTRIES_BY_MODE[mode];

export const isVideoUrl = (url?: string): boolean => {
  if (!url) return false;
  return (
    /\.(avi|mp4|webm|mov|mkv)(\?|$)/i.test(url) ||
    url.startsWith('data:video/') ||
    url.includes('v.redd.it')
  );
};

export function isValidSubmission(challenge: Challenge, submission: Submission): boolean {
  // Keep already-published legacy Rank Roulette posts (up to the former global cap) playable.
  if (submission.mode !== challenge.mode || challenge.entries.length < MIN_ENTRIES[challenge.mode] || challenge.entries.length > MAX_ENTRIES) return false;
  const validIds = new Set(challenge.entries.map((entry) => entry.id));
  const values = Object.values(submission.values);
  if (challenge.mode === 'rank') {
    const ids = Object.keys(submission.values);
    const slots = values;
    const entryCount = challenge.entries.length;
    return ids.length === entryCount && ids.every((id) => validIds.has(id)) && slots.length === entryCount && new Set(slots.map(Number)).size === entryCount && slots.every((slot) => Number.isInteger(Number(slot)) && Number(slot) >= 1 && Number(slot) <= entryCount);
  }
  if (challenge.mode === 'kmk') {
    const roles = ['Kiss', 'Marry', 'Kill'];
    return Object.keys(submission.values).length === 3 && roles.every((role) => typeof submission.values[role] === 'string' && validIds.has(String(submission.values[role]))) && new Set(roles.map((role) => submission.values[role])).size === 3;
  }
  if (challenge.mode === 'smash') return Object.keys(submission.values).length === challenge.entries.length && Object.keys(submission.values).every((entryId) => validIds.has(entryId)) && values.every((value) => ['Smash', 'Pass'].includes(String(value)));
  if (challenge.mode === 'fact_cap') return Object.keys(submission.values).length === challenge.entries.length && Object.keys(submission.values).every((entryId) => validIds.has(entryId)) && values.every((value) => ['Fact', 'Cap'].includes(String(value)));
  if (challenge.mode === 'rating') return Object.keys(submission.values).length === challenge.entries.length && Object.keys(submission.values).every((entryId) => validIds.has(entryId)) && values.every((value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10);
  const picks = Object.entries(submission.values);
  // Pick a Side advances one champion through every remaining challenger.
  return picks.length === challenge.entries.length - 1 && picks.every(([id, chosen]) => validIds.has(id) && typeof chosen === 'string' && validIds.has(chosen));
}
