import { Hono } from 'hono';
import { context, media, reddit, redis } from '@devvit/web/server';
import { EntrypointHeight } from '@devvit/reddit';
import { randomInt, randomUUID } from 'node:crypto';
import { isValidSubmission, MAX_ENTRIES_BY_MODE, MIN_ENTRIES, MODE_LABELS, validEntryCount } from '../../shared/game';
import type { Challenge, ChallengeEntry, GameMode, Submission } from '../../shared/game';

export const api = new Hono();
const prefix = () => `rankexe:${context.subredditId}:`;
const identityTtl = 60 * 60 * 24 * 30;
const challengeKey = (id: string) => `${prefix()}challenge:${id}`;
const sessionKey = (id: string, user: string) => `${prefix()}session:${id}:${user}`;
const resultsKey = (id: string) => `${prefix()}results:${id}`;
const sessionLockKey = (id: string, user: string) => `${prefix()}session-lock:${id}:${user}`;
const acquireSessionLock = async (id: string, user: string) => {
  const key = sessionLockKey(id, user);
  const token = randomUUID();
  const acquired = await redis.set(key, token, { nx: true, expiration: new Date(Date.now() + 30_000) });
  return acquired ? { key, token } : undefined;
};
const releaseSessionLock = async (lock: { key: string; token: string }) => {
  try { if (await redis.get(lock.key) === lock.token) await redis.del(lock.key); } catch (err) { console.error('Session lock cleanup failed', err); }
};
const text = (value: unknown, max = 180): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const themeColor = (value: unknown): string | undefined => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : undefined;
const modeOK = (mode: unknown): mode is GameMode => ['rank', 'versus', 'kmk', 'smash', 'fact_cap', 'rating'].includes(String(mode));
const getChallenge = async (id: string): Promise<Challenge | undefined> => {
  const raw = await redis.get(challengeKey(id));
  if (!raw) return undefined;
  try { return JSON.parse(raw) as Challenge; } catch { return undefined; }
};
const requireUser = () => context.userId;

api.get('/init', async (c) => {
  const postData = context.postData as { challengeId?: unknown; setup?: unknown } | undefined;
  const challengeId = text(postData?.challengeId, 80);
  const challenge = challengeId ? await getChallenge(challengeId) : undefined;
  let subreddit = context.subredditName || challenge?.subredditName;
  if (!subreddit) {
    try {
      const sub = await reddit.getCurrentSubreddit();
      subreddit = sub?.name;
    } catch {
      /* ignore */
    }
  }
  return c.json({
    username: context.username ?? 'Redditor',
    challenge: challenge ?? null,
    setup: !challengeId && postData?.setup === true,
    postId: context.postId ?? null,
    subreddit: subreddit ?? 'Rank_EXE',
  });
});

api.get('/challenges', async (c) => {
  const indexed = await redis.zRange(`${prefix()}challenge-index`, 0, -1, { by: 'rank', reverse: true });
  const items = (await Promise.all(indexed.slice(0, 60).map(({ member }) => getChallenge(member)))).filter((item): item is Challenge => Boolean(item && item.status === 'published'));
  const withPlays = await Promise.all(items.map(async (challenge) => ({ ...challenge, plays: Number(await redis.hGet(resultsKey(challenge.id), 'plays') ?? '0') })));
  return c.json({ challenges: withPlays });
});

api.post('/media', async (c) => {
  if (!requireUser()) return c.json({ error: 'Sign in to upload media.' }, 401);
  const body = await c.req.json<{ dataUrl?: unknown; dataUrls?: unknown; type?: unknown }>();
  const rawUrls = Array.isArray(body.dataUrls) ? body.dataUrls : typeof body.dataUrl === 'string' ? [body.dataUrl] : [];
  const dataUrls = rawUrls.filter((value): value is string => typeof value === 'string').map((v) => v.trim());
  const validMediaDataUrl = (value: string): boolean =>
    /^data:(?:image\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/octet-stream);base64,[a-z0-9+/_\r\n=-]+$/i.test(value) ||
    /^https?:\/\/.+/i.test(value);
  if (dataUrls.length < 1 || dataUrls.length > 30 || dataUrls.some((value) => !validMediaDataUrl(value)) || dataUrls.reduce((sum, value) => sum + value.length, 0) > 27_000_000) {
    return c.json({ error: 'Choose up to 30 PNG, JPEG, WEBP, GIF, AVIF, or AVI files under 18 MB total.' }, 400);
  }
  const isGifUrl = (url: string) => /^data:image\/(?:gif|x-gif)/i.test(url) || /\.gif(\?|$)/i.test(url);
  const isVideoUrl = (url: string) =>
    /^data:video\//i.test(url) ||
    /\.(avi|mp4|webm|mov|mkv)(\?|$)/i.test(url) ||
    url.includes('v.redd.it');
  const getMediaType = (url: string): 'image' | 'gif' | 'video' => {
    if (typeof body.type === 'string' && ['image', 'gif', 'video'].includes(body.type)) {
      return body.type as 'image' | 'gif' | 'video';
    }
    if (isGifUrl(url)) return 'gif';
    if (isVideoUrl(url)) return 'video';
    return 'image';
  };
  try {
    const uploaded = await Promise.all(dataUrls.map((url) => media.upload({
      url,
      type: getMediaType(url),
    })));
    const imageUrls = uploaded.map((image) => image.mediaUrl);
    return c.json({ imageUrl: imageUrls[0], imageUrls });
  } catch (err) {
    console.error('Media upload failed', err);
    return c.json({ error: 'Reddit could not upload this file. Try a smaller image, GIF, or AVI video.' }, 502);
  }
});

api.get('/drafts', async (c) => {
  const user = requireUser();
  if (!user) return c.json({ drafts: [] });
  const key = `${prefix()}drafts:${user}`;
  const raw = await redis.hGetAll(key);
  await redis.expire(key, identityTtl);
  const drafts = Object.values(raw).flatMap((value) => {
    try { return [JSON.parse(value) as Challenge]; } catch { return []; }
  });
  return c.json({ drafts });
});

api.post('/drafts', async (c) => {
  const user = requireUser();
  if (!user) return c.json({ error: 'Sign in to save a draft.' }, 401);
  const input = await c.req.json<Record<string, unknown>>();
  const draftId = text(input.draftId, 80) || randomUUID();
  const mode = modeOK(input.mode) ? input.mode : 'rank';
  const rawEntries = Array.isArray(input.entries) ? input.entries : [];
  const entries: ChallengeEntry[] = rawEntries.slice(0, MAX_ENTRIES_BY_MODE[mode]).map((row, index) => {
    const entry = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    return { id: text(entry.id, 80) || `e${index + 1}`, text: text(entry.text, 180), ...(text(entry.imageUrl, 500) ? { imageUrl: text(entry.imageUrl, 500) } : {}) };
  });
  const draft: Challenge = { id: draftId, title: text(input.title, 80) || 'Untitled draft', description: text(input.description, 500), category: text(input.category, 40) || 'Other', mode, ...(themeColor(input.themeColor) ? { themeColor: themeColor(input.themeColor) } : {}), entries, creator: context.username ?? 'Redditor', createdAt: Date.now(), status: 'draft' };
  const key = `${prefix()}drafts:${user}`;
  await redis.hSet(key, { [draftId]: JSON.stringify(draft) });
  await redis.expire(key, identityTtl);
  return c.json({ draft });
});

api.post('/publish', async (c) => {
  const userId = requireUser();
  if (!userId) return c.json({ error: 'Sign in to create a challenge.' }, 401);
  const input = await c.req.json<Record<string, unknown>>();
  const mode = input.mode;
  const entriesRaw = Array.isArray(input.entries) ? input.entries : [];
  if (!modeOK(mode)) return c.json({ error: 'Choose a game mode.' }, 400);
  const entries: ChallengeEntry[] = entriesRaw.slice(0, MAX_ENTRIES_BY_MODE[mode]).map((row, i) => {
    const entry = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    const imageUrl = text(entry.imageUrl, 500);
    return { id: `e${i + 1}`, text: text(entry.text, 180), ...(imageUrl ? { imageUrl } : {}) };
  }).filter((entry) => entry.text || entry.imageUrl);
  const isRedditMedia = (url: string) =>
    /^https:\/\/(?:[a-z0-9-]+\.)?(?:redd\.it|redditmedia\.com|redditstatic\.com)\//i.test(url) ||
    /^https:\/\/reddit-uploaded-media\.s3-accelerate\.amazonaws\.com\//i.test(url);
  for (const entry of entries) {
    if (entry.imageUrl && !isRedditMedia(entry.imageUrl)) {
      try {
        const isGif = /\.gif(\?|$)/i.test(entry.imageUrl) || entry.imageUrl.includes('gif');
        const isVid = /\.(avi|mp4|webm|mov)(\?|$)/i.test(entry.imageUrl) || entry.imageUrl.includes('v.redd.it');
        const rehosted = await media.upload({ url: entry.imageUrl, type: isVid ? 'video' : isGif ? 'gif' : 'image' });
        entry.imageUrl = rehosted.mediaUrl;
      } catch (rehostErr) {
        console.error('Failed to rehost external entry media', rehostErr);
        return c.json({ error: `Could not load media for "${entry.text}". Please upload the file directly.` }, 400);
      }
    }
  }
  if (entries.some((entry) => entry.imageUrl && !isRedditMedia(entry.imageUrl))) return c.json({ error: 'Entry images must use a Reddit-hosted image URL.' }, 400);
  if (!validEntryCount(mode, entries.length)) return c.json({ error: `${MODE_LABELS[mode]} needs between ${MIN_ENTRIES[mode]} and ${MAX_ENTRIES_BY_MODE[mode]} complete entries.` }, 400);
  const title = text(input.title, 80);
  if (!title) return c.json({ error: 'Add a challenge title.' }, 400);
  const userDraftsKey = `${prefix()}drafts:${userId}`;
  const draftId = text(input.draftId, 80);
  const storedDraft = draftId ? await redis.hGet(userDraftsKey, draftId) : undefined;
  if (draftId && !storedDraft) return c.json({ error: 'Draft not found or expired.' }, 404);
  const existingDraft = storedDraft ? JSON.parse(storedDraft) as Challenge : undefined;
  const id = existingDraft?.id ?? randomUUID();
  const now = existingDraft?.createdAt ?? Date.now();
  const challenge: Challenge = { id, title, description: text(input.description, 500), category: text(input.category, 40) || 'Other', mode, ...(themeColor(input.themeColor) ? { themeColor: themeColor(input.themeColor) } : {}), entries, creator: context.username ?? 'Redditor', createdAt: now, status: 'draft', subredditName: context.subredditName };
  await redis.set(challengeKey(id), JSON.stringify(challenge));
  const ugcDescription = text(input.description, 500);
  const ugcText = [
    title,
    ugcDescription ? `\n\n${ugcDescription}` : '',
    entries.length > 0 ? `\n\nEntries:\n${entries.map((e, idx) => `${idx + 1}. ${e.text || 'Image entry'}`).join('\n')}` : '',
  ].join('');
  const ugcImages = entries
    .map((e) => e.imageUrl)
    .filter((url): url is string => Boolean(url && isRedditMedia(url) && !/\.(avi|mp4|webm|mov)(\?|$)/i.test(url)));

  let post;
  try {
    post = await reddit.submitCustomPost({
      title: `RANK.EXE: ${title}`.slice(0, 300),
      subredditName: context.subredditName,
      entry: 'default',
      styles: { backgroundColor: '#101114FF', backgroundColorDark: '#101114FF', height: EntrypointHeight.TALL },
      postData: { challengeId: id },
      runAs: 'USER',
      userGeneratedContent: {
        text: ugcText,
        ...(ugcImages.length > 0 ? { imageUrls: ugcImages } : {}),
      },
      textFallback: {
        text: `RANK.EXE: ${title}\n\n${ugcDescription ? `${ugcDescription}\n\n` : ''}Play this game on Reddit!`,
      },
    });
  } catch (err) {
    await redis.del(challengeKey(id));
    console.error('Challenge post creation failed', err);
    return c.json({ error: 'Reddit could not publish this challenge. Check account authorization and subreddit posting rules, then try again.' }, 502);
  }
  challenge.postId = post.id;
  challenge.status = 'published';
  try {
    await redis.set(challengeKey(id), JSON.stringify(challenge));
  } catch (err) {
    console.error('Challenge persistence failed after post creation', err);
    return c.json({ error: 'The Reddit post was created, but its game data could not be saved. Please contact the app moderator.' }, 503);
  }
  try {
    const indexKey = `${prefix()}challenge-index`;
    await redis.zAdd(indexKey, { member: id, score: now });
    const createdKey = `${prefix()}user-created:${userId}`;
    await redis.hSet(createdKey, { [id]: String(now) });
    await redis.expire(createdKey, identityTtl);
    if (draftId) await redis.hDel(userDraftsKey, [draftId]);
  } catch (err) {
    console.error('Challenge indexing failed after post creation', err);
  }
  return c.json({ challenge, postUrl: `https://reddit.com/r/${context.subredditName}/comments/${post.id}` });
});

api.get('/session/:id', async (c) => {
  const user = requireUser();
  if (!user) return c.json({ error: 'Sign in to save your game.' }, 401);
  const challenge = await getChallenge(c.req.param('id'));
  if (!challenge || challenge.status !== 'published') return c.json({ error: 'Challenge not found.' }, 404);
  let subreddit = context.subredditName || challenge.subredditName;
  if (!subreddit) {
    try {
      const sub = await reddit.getCurrentSubreddit();
      subreddit = sub?.name;
    } catch {
      /* ignore */
    }
  }
  const subName = subreddit ?? 'Rank_EXE';
  const key = sessionKey(challenge.id, String(user));
  const existing = await redis.get(key);
  if (existing) {
    const previous = JSON.parse(existing) as { status?: string; versusVersion?: number };
    if (challenge.mode !== 'versus' || previous.status === 'completed' || previous.versusVersion === 1) {
      await redis.expire(key, identityTtl);
      return c.json({ session: previous, challenge, subreddit: subName });
    }
    await redis.del(key);
  }
  const orderedEntries = [...challenge.entries];
  for (let index = orderedEntries.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = orderedEntries[index]; const swap = orderedEntries[swapIndex];
    if (current && swap) { orderedEntries[index] = swap; orderedEntries[swapIndex] = current; }
  }
  const order = orderedEntries.map((entry) => entry.id);
  const session = { challengeId: challenge.id, mode: challenge.mode, order, values: {} as Record<string, string | number>, ...(challenge.mode === 'versus' ? { versusVersion: 1 } : {}), createdAt: Date.now(), status: 'in-progress' as const };
  const stored = await redis.set(key, JSON.stringify(session), { nx: true, expiration: new Date(Date.now() + identityTtl * 1000) });
  if (!stored) {
    const latest = await redis.get(key);
    return latest ? c.json({ session: JSON.parse(latest), challenge, subreddit: subName }) : c.json({ error: 'Could not start this game. Try again.' }, 503);
  }
  return c.json({ session, challenge, subreddit: subName });
});

api.post('/session/:id/progress', async (c) => {
  const user = requireUser();
  if (!user) return c.json({ error: 'Sign in to save progress.' }, 401);
  const id = c.req.param('id');
  const challenge = await getChallenge(id);
  if (!challenge) return c.json({ error: 'Challenge not found.' }, 404);
  const lock = await acquireSessionLock(id, String(user));
  if (!lock) return c.json({ error: 'Your game is saving. Try that choice again in a moment.' }, 409);
  try {
  const key = sessionKey(id, String(user));
  const raw = await redis.get(key);
  const session = raw ? JSON.parse(raw) as { values: Record<string, string | number>; order: string[]; status: string } : undefined;
  if (!session || session.status !== 'in-progress') return c.json({ error: 'No active game to save.' }, 409);
  const body = await c.req.json<{ values?: unknown }>();
  const values = body.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return c.json({ error: 'Invalid progress.' }, 400);
  const next = values as Record<string, string | number>;
  const validIds = new Set(challenge.entries.map((entry) => entry.id));
  if (challenge.mode === 'kmk') {
    const roles = ['Kiss', 'Marry', 'Kill'];
    if (Object.keys(next).some((role) => !roles.includes(role)) || Object.values(next).some((entryId) => !validIds.has(String(entryId))) || new Set(Object.values(next)).size !== Object.values(next).length) return c.json({ error: 'Use each role and entry at most once.' }, 400);
  } else if (Object.keys(next).some((entryId) => !validIds.has(entryId))) return c.json({ error: 'Progress contains an unknown entry.' }, 400);
  if (challenge.mode === 'rank') {
    const positions = Object.values(next);
    if (positions.some((position) => !Number.isInteger(Number(position)) || Number(position) < 1 || Number(position) > challenge.entries.length) || new Set(positions.map(Number)).size !== positions.length) return c.json({ error: `Use each position from 1 to ${challenge.entries.length} only once.` }, 400);
    if (Object.entries(session.values).some(([entryId, position]) => Number(next[entryId]) !== Number(position))) return c.json({ error: 'Ranked choices are locked once selected.' }, 409);
  }
  if (challenge.mode === 'versus') {
    const challengers = session.order.slice(1);
    const oldKeys = Object.keys(session.values);
    const nextKeys = Object.keys(next);
    const challenger = challengers.find((entryId) => session.values[entryId] === undefined);
    const currentChampion = Object.values(session.values).at(-1) ?? session.order[0];
    if (!challenger || nextKeys.length !== oldKeys.length + 1 || nextKeys.some((entryId) => !challengers.includes(entryId)) || oldKeys.some((entryId) => next[entryId] !== session.values[entryId]) || nextKeys.filter((entryId) => !oldKeys.includes(entryId)).some((entryId) => entryId !== challenger)) return c.json({ error: 'Choose one side in the current duel.' }, 409);
    if (![currentChampion, challenger].includes(String(next[challenger]))) return c.json({ error: 'The selected image does not match this duel.' }, 400);
  }
  if (challenge.mode === 'kmk' && Object.values(next).some((entryId) => !session.order.slice(0, 3).includes(String(entryId)))) return c.json({ error: 'Choose from the three entries in this round.' }, 400);
  if (challenge.mode === 'smash' && Object.entries(session.values).some(([entryId, vote]) => next[entryId] !== vote)) return c.json({ error: 'Submitted votes are locked.' }, 409);
  if (challenge.mode === 'fact_cap' && Object.entries(session.values).some(([entryId, vote]) => next[entryId] !== vote)) return c.json({ error: 'Submitted calls are locked.' }, 409);
  if (challenge.mode === 'rating') {
    const scores = Object.values(next);
    if (scores.some((score) => !Number.isInteger(Number(score)) || Number(score) < 1 || Number(score) > 10)) return c.json({ error: 'Ratings must be whole numbers from 1 to 10.' }, 400);
  }
  session.values = next;
  await redis.set(key, JSON.stringify(session), { expiration: new Date(Date.now() + identityTtl * 1000) });
  return c.json({ ok: true });
  } finally { await releaseSessionLock(lock); }
});

api.post('/session/:id/complete', async (c) => {
  const user = requireUser();
  if (!user) return c.json({ error: 'Sign in to submit your choices.' }, 401);
  const id = c.req.param('id');
  const challenge = await getChallenge(id);
  if (!challenge || challenge.status !== 'published') return c.json({ error: 'Challenge not found.' }, 404);
  const lock = await acquireSessionLock(id, String(user));
  if (!lock) return c.json({ error: 'Your game is saving. Try submitting again in a moment.' }, 409);
  try {
  const key = sessionKey(id, String(user));
  const raw = await redis.get(key);
  if (!raw) return c.json({ error: 'Start a game before submitting.' }, 409);
  const session = JSON.parse(raw) as { values: Record<string, string | number>; order: string[]; status: string };
  if (session.status !== 'in-progress') return c.json({ error: 'This game has already been completed.' }, 409);
  const body = await c.req.json<{ values?: Record<string, string | number> }>();
  const submission: Submission = { mode: challenge.mode, values: body.values ?? session.values };
  if (!isValidSubmission(challenge, submission)) return c.json({ error: 'Your choices are incomplete or invalid.' }, 400);
  if (challenge.mode === 'versus') {
    const challengers = session.order.slice(1);
    if (Object.keys(submission.values).length !== challengers.length || challengers.some((entryId) => !Object.keys(submission.values).includes(entryId))) return c.json({ error: 'Complete every duel before submitting.' }, 400);
    let champion = session.order[0];
    for (const challenger of challengers) {
      const winner = String(submission.values[challenger]);
      if (winner !== champion && winner !== challenger) return c.json({ error: 'A duel result does not match its challenger.' }, 400);
      champion = winner;
    }
  }
  if (challenge.mode === 'kmk' && Object.values(submission.values).some((entryId) => !session.order.slice(0, 3).includes(String(entryId)))) return c.json({ error: 'Choose from this round’s three entries.' }, 400);
  const aggKey = resultsKey(id);
  try {
    await redis.hIncrBy(aggKey, 'plays', 1);
    for (const [k, v] of Object.entries(submission.values)) {
      if (challenge.mode === 'kmk') {
        // In KMK, k is role ('Kiss', 'Marry', 'Kill'), v is entryId ('e1', 'e2', 'e3')
        await redis.hIncrBy(aggKey, `role:${k}:${v}`, 1);
      } else if (challenge.mode === 'rank') {
        await redis.hIncrBy(aggKey, `rank:${k}:${v}`, 1);
      } else if (challenge.mode === 'smash') {
        await redis.hIncrBy(aggKey, `${v}:${k}`, 1);
      } else if (challenge.mode === 'fact_cap') {
        await redis.hIncrBy(aggKey, `${v}:${k}`, 1);
      } else if (challenge.mode === 'rating') {
        await redis.hIncrBy(aggKey, `rating_sum:${k}`, Number(v));
        await redis.hIncrBy(aggKey, `rating_count:${k}`, 1);
      } else {
        await redis.hIncrBy(aggKey, `pick:${v}`, 1);
      }
    }
    session.status = 'completed';
    session.values = submission.values;
    await redis.set(key, JSON.stringify(session), { expiration: new Date(Date.now() + identityTtl * 1000) });
  } catch (err) {
    console.error('Result aggregation failed', err);
    return c.json({ error: 'Could not save results. Please try again.' }, 503);
  }
  try {
    const completedKey = `${prefix()}user-completed:${user}`;
    await redis.hSet(completedKey, { [id]: String(Date.now()) });
    await redis.expire(completedKey, identityTtl);
  } catch (err) { console.error('Personal history update failed', err); }
  return c.json({ ok: true, submission });
  } finally { await releaseSessionLock(lock); }
});

api.get('/results/:id', async (c) => {
  const challenge = await getChallenge(c.req.param('id'));
  if (!challenge) return c.json({ error: 'Challenge not found.' }, 404);
  const totals = await redis.hGetAll(resultsKey(challenge.id));
  return c.json({ challenge, plays: Number(totals.plays ?? 0), totals: Object.fromEntries(Object.entries(totals).filter(([key]) => key !== 'plays')) });
});

api.get('/profile', async (c) => {
  const user = requireUser();
  if (!user) return c.json({ username: context.username ?? 'Redditor', completed: 0, created: 0, history: [] });
  const [created, submitted] = await Promise.all([
    redis.hGetAll(`${prefix()}user-created:${user}`),
    redis.hGetAll(`${prefix()}user-completed:${user}`),
  ]);
  const ids = Object.keys(submitted);
  const history = (await Promise.all(ids.map(async (id) => {
    const challenge = await getChallenge(id);
    return challenge ? { id, title: challenge.title, mode: challenge.mode, completedAt: Number(submitted[id]) } : null;
  }))).filter((item): item is NonNullable<typeof item> => Boolean(item));
  return c.json({ username: context.username ?? 'Redditor', completed: ids.length, created: Object.keys(created).length, history: history.sort((a, b) => b.completedAt - a.completedAt) });
});

api.post('/comment/:id', async (c) => {
  const user = requireUser();
  if (!user) return c.json({ error: 'Sign in to comment.' }, 401);
  const id = c.req.param('id');
  const challenge = await getChallenge(id);
  if (!challenge || !challenge.postId) return c.json({ error: 'Challenge post not found.' }, 404);
  const sessionRaw = await redis.get(sessionKey(id, String(user)));
  if (!sessionRaw) return c.json({ error: 'Complete the game before commenting.' }, 409);
  const session = JSON.parse(sessionRaw) as { status: string; values: Record<string, string | number>; order: string[] };
  if (session.status !== 'completed') return c.json({ error: 'Complete the game before commenting.' }, 409);
  const commentKey = `${prefix()}comment:${id}:${user}`;
  if (!(await redis.set(commentKey, 'pending', { nx: true, expiration: new Date(Date.now() + identityTtl * 1000) }))) return c.json({ error: 'You already commented for this game.' }, 409);
  const submission: Submission = { mode: challenge.mode, values: session.values };
  const byId = Object.fromEntries(challenge.entries.map((entry) => [entry.id, entry.text || 'Image entry']));
  const entries = Object.entries(submission.values);
  const comment = challenge.mode === 'rank'
    ? `🏆 My rankings: ${entries.sort((a, b) => Number(a[1]) - Number(b[1])).map(([entryId, pos]) => `#${pos}. ${byId[entryId]}`).join(' | ')}`
    : challenge.mode === 'kmk'
      ? `💋 Kiss: ${byId[String(submission.values.Kiss)]}\n💍 Marry: ${byId[String(submission.values.Marry)]}\n💀 Kill: ${byId[String(submission.values.Kill)]}`
      : challenge.mode === 'smash'
        ? entries.map(([entryId, vote]) => `${vote === 'Smash' ? '🔥 Smash' : '💀 Pass'}: ${byId[entryId]}`).join('\n')
        : challenge.mode === 'fact_cap'
          ? entries.map(([entryId, vote]) => `${vote === 'Fact' ? '✅ Fact' : '🧢 Cap'}: ${byId[entryId]}`).join('\n')
          : challenge.mode === 'rating'
            ? `⭐ My Ratings:\n` + entries.sort((a, b) => Number(b[1]) - Number(a[1])).map(([entryId, score]) => `⭐ ${byId[entryId]}: ${score}/10`).join('\n')
            : (() => { const champion = String(Object.values(submission.values).at(-1) ?? session.order[0]); return `👑 My Pick is ${byId[champion]} over ${session.order.filter((entryId) => entryId !== champion).map((entryId) => byId[entryId]).join(', ')}.`; })();
  try {
    const posted = await reddit.submitComment({ id: challenge.postId, text: comment, runAs: 'USER' });
    await redis.set(commentKey, posted.id);
    return c.json({ ok: true, commentId: posted.id });
  } catch (err) {
    await redis.del(commentKey);
    console.error('Comment submit failed', err);
    return c.json({ error: 'Reddit could not submit the comment. Check account authorization and try again.' }, 502);
  }
});

api.post('/subscribe', async (c) => {
  let subName = context.subredditName;
  if (!subName) {
    try {
      const sub = await reddit.getCurrentSubreddit();
      subName = sub?.name;
    } catch {
      /* ignore */
    }
  }
  const resolvedSub = subName ?? 'Rank_EXE';
  try {
    await reddit.subscribeToCurrentSubreddit();
    return c.json({ ok: true, subreddit: resolvedSub });
  } catch (err) {
    console.warn('Subreddit subscribe warning', err);
    return c.json({ ok: false, subreddit: resolvedSub });
  }
});
