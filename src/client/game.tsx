import './index.css';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { navigateTo } from '@devvit/web/client';
import { isVideoUrl } from '../shared/game';
import type { Challenge, ChallengeEntry, GameMode } from '../shared/game';

type Session = { challengeId: string; mode: GameMode; order: string[]; values: Record<string, string | number>; status: string };
type API<T> = T & { error?: string };
const request = async <T,>(url: string, init?: RequestInit): Promise<API<T>> => {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json() as API<T>;
  if (!response.ok) throw new Error(data.error ?? 'Something went wrong. Try again.');
  return data;
};

const detectSubreddit = (fallback = 'Rank_EXE'): string => {
  if (typeof window !== 'undefined') {
    const match = (window.location.href + ' ' + (document.referrer || '')).match(/\/r\/([a-zA-Z0-9_]+)/i);
    if (match?.[1]) return match[1];
  }
  return fallback;
};

export const App = ({ initialChallenge, initialSubreddit }: { initialChallenge?: Challenge | null | undefined; initialSubreddit?: string | undefined } = {}) => {
  const [challenge, setChallenge] = useState<Challenge | null>(initialChallenge ?? null);
  const [session, setSession] = useState<Session | null>(null);
  const [subreddit, setSubreddit] = useState<string>(() => initialSubreddit ?? detectSubreddit(initialChallenge?.subredditName ?? 'Rank_EXE'));
  const [active, setActive] = useState(false);
  const [tab, setTab] = useState<'Your Choices' | 'Everyone Played'>('Your Choices');
  const [results, setResults] = useState<{ plays: number; totals: Record<string, string> } | null>(null);
  const [loading, setLoading] = useState(!initialChallenge);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        let targetChallenge = initialChallenge;
        const initData = await fetch('/api/init')
          .then((r) => r.json() as Promise<API<{ challenge: Challenge | null; subreddit?: string }>>)
          .catch(() => null);
        if (initData?.subreddit) {
          setSubreddit(initData.subreddit);
        }
        if (!targetChallenge) {
          if (!initData?.challenge) throw new Error('This post is not connected to a game. Open a RANK.EXE setup post to create one.');
          targetChallenge = initData.challenge;
          setChallenge(targetChallenge);
          if (targetChallenge.subredditName) {
            setSubreddit(targetChallenge.subredditName);
          }
        }
        const result = await request<{ session: Session; subreddit?: string }>(`/api/session/${targetChallenge.id}`);
        if (result.subreddit) {
          setSubreddit(result.subreddit);
        }
        setSession(result.session);
        setActive(true);
      } catch (error: unknown) {
        setNotice(error instanceof Error ? error.message : 'Could not load this game post.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [initialChallenge]);

  const challengeId = challenge?.id;
  useEffect(() => {
    if (!challengeId) return;
    const fetchResults = () => {
      void request<{ plays: number; totals: Record<string, string> }>(`/api/results/${challengeId}`)
        .then(setResults)
        .catch(() => setResults(null));
    };
    fetchResults();
    if (tab === 'Everyone Played') {
      const interval = setInterval(fetchResults, 3000);
      return () => clearInterval(interval);
    }
  }, [challengeId, session?.status, tab]);

  return <main className="game-post-shell" style={{ '--game-accent': challenge?.themeColor ?? '#4979D0' } as CSSProperties}>
    <header className="game-post-brand"><span className="brand-mark">R</span><span>RANK<span className="accent">.EXE</span></span><span className="post-kind">GAME POST</span></header>
    {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
    {loading ? <div className="game-loading-screen" role="status" aria-live="polite"><div className="loading-brand"><span className="loading-mark">R</span><span>RANK<span className="accent">.EXE</span></span></div><div className="loading-orbit"><i/><i/><i/></div><h1>Opening your game</h1><p>Loading your challenge…</p><div className="loading-skeleton"><span/><span/><span/></div></div> : challenge ? <PlayView challenge={challenge} active={active} session={session} tab={tab} setTab={setTab} results={results} subreddit={subreddit} onNotice={setNotice} onSession={setSession} /> : <div className="empty-state"><h2>Game unavailable</h2><p>{notice || 'This post is not connected to a game.'}</p></div>}
  </main>;
};

function PlayView({ challenge, active, session, tab, setTab, results, subreddit, onNotice, onSession }: { challenge: Challenge; active: boolean; session: Session | null; tab: 'Your Choices' | 'Everyone Played'; setTab: (t: 'Your Choices' | 'Everyone Played') => void; results: { plays: number; totals: Record<string, string> } | null; subreddit?: string; onNotice: (n: string) => void; onSession: (s: Session) => void }) {
  const completed = session?.status === 'completed';
  const [commenting, setCommenting] = useState(false);
  const [commented, setCommented] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const postComment = async () => { setCommenting(true); const done = await comment(challenge, onNotice); setCommented(done); setCommenting(false); };
  return <section className="play-page">
    {!active || !session ? null : completed ? (tab === 'Your Choices' ? <YourResults challenge={challenge} session={session}/> : <EveryoneResults challenge={challenge} results={results}/>) : <GameBoard challenge={challenge} session={session} onSession={onSession} onNotice={onNotice} onComplete={async (values) => { onSession({ ...session, values, status: 'completed' }); setTab('Your Choices'); setShowCompletionModal(true); try { await request(`/api/session/${challenge.id}/complete`, { method: 'POST', body: JSON.stringify({ values }) }); } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not submit.'); } }} />}
    {completed && <GameBottomBar tab={tab} setTab={setTab} commenting={commenting} commented={commented} onComment={() => void postComment()}/>}
    {completed && showCompletionModal && typeof document !== 'undefined' && createPortal(
      <GameCompletionModal
        onClose={() => setShowCompletionModal(false)}
        onComment={() => void postComment()}
        commenting={commenting}
        commented={commented}
        subreddit={subreddit || challenge.subredditName || 'Rank_EXE'}
        onNotice={onNotice}
      />,
      document.body
    )}
  </section>;
}
function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function scrollPage(direction: -1 | 1) {
  const list = document.querySelector<HTMLElement>('.results-card .community-list, .results-card .ranking-feed');
  if (!list) return;

  const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
  if (maxScroll <= 0) return; // All entries already fit on screen; avoid erratic window/parent jump

  const row = list.querySelector<HTMLElement>('.ranking-feed-row');
  const step = row ? Math.max(row.offsetHeight + 6, 44) * 1.5 : 75;
  const target = Math.max(0, Math.min(maxScroll, list.scrollTop + step * direction));
  list.scrollTo({ top: target, behavior: 'smooth' });
}

function GameBottomBar({ tab, setTab, commenting, commented, onComment }: { tab: 'Your Choices' | 'Everyone Played'; setTab: (t: 'Your Choices' | 'Everyone Played') => void; commenting: boolean; commented: boolean; onComment: () => void }) {
  return (
    <nav className="game-bottom-bar" aria-label="Leaderboard controls">
      <button className="scroll-control" onClick={() => scrollPage(-1)} aria-label="Scroll up">
        <ArrowUpIcon />
      </button>
      <button className={`my-rank-control ${tab === 'Your Choices' ? 'selected' : ''}`} onClick={() => setTab('Your Choices')}>You</button>
      <button className={`all-rank-control ${tab === 'Everyone Played' ? 'selected' : ''}`} onClick={() => setTab('Everyone Played')}>All</button>
      <button className="comment-rank-control" disabled={commenting || commented} onClick={onComment}>{commented ? 'Commented ✓' : commenting ? 'Sending…' : 'Comment my rankings'}</button>
      <button className="scroll-control" onClick={() => scrollPage(1)} aria-label="Scroll down">
        <ArrowDownIcon />
      </button>
    </nav>
  );
}

function CommentIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CommunityIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function GameCompletionModal({
  onClose,
  onComment,
  commenting,
  commented,
  subreddit: initialSubreddit = 'Rank_EXE',
  onNotice,
}: {
  onClose: () => void;
  onComment: () => Promise<void> | void;
  commenting: boolean;
  commented: boolean;
  subreddit?: string;
  onNotice: (n: string) => void;
}) {
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joinedSubreddit, setJoinedSubreddit] = useState<string | null>(null);
  const activeSubreddit = joinedSubreddit ?? initialSubreddit;

  const handleJoin = async () => {
    if (joining || joined) return;
    setJoining(true);
    try {
      const res = await request<{ ok: boolean; subreddit?: string }>('/api/subscribe', { method: 'POST', body: '{}' });
      const targetSub = res.subreddit || activeSubreddit;
      if (res.subreddit) setJoinedSubreddit(res.subreddit);
      setJoined(true);
      onNotice(`Joined r/${targetSub}! 🎉`);
    } catch {
      try {
        navigateTo(`https://www.reddit.com/r/${activeSubreddit}`);
        setJoined(true);
      } catch {
        onNotice(`Visit r/${activeSubreddit} to join!`);
      }
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="completion-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="completion-modal-title" onClick={onClose}>
      <div className="completion-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="completion-modal-badge" aria-hidden="true">
          <span className="completion-trophy-emoji" role="img" aria-label="Trophy">🏆</span>
        </div>
        <h2 id="completion-modal-title" className="completion-modal-heading">Game Completed!</h2>
        <p className="completion-modal-sub">Your rankings are ready. Share your verdict!</p>

        <button
          type="button"
          className="completion-primary-cta"
          disabled={commenting || commented}
          onClick={async () => {
            await onComment();
          }}
        >
          <CommentIcon />
          <span>{commented ? 'Commented ✓' : commenting ? 'Posting comment…' : 'Comment my rankings'}</span>
        </button>

        <button
          type="button"
          className={`completion-secondary-cta ${joined ? 'joined' : ''}`}
          disabled={joining}
          onClick={() => void handleJoin()}
        >
          <CommunityIcon />
          <span>{joined ? `Joined r/${activeSubreddit} ✓` : joining ? 'Joining…' : `Join r/${activeSubreddit}`}</span>
        </button>

        <button
          type="button"
          className="completion-dismiss-btn"
          onClick={onClose}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

function RatingMediaStage({ entry }: { entry: ChallengeEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isTextOnly = !entry.imageUrl;

  return (
    <div className={`rating-media-stage ${isTextOnly ? 'text-only' : ''}`}>
      {entry.imageUrl ? (
        <>
          <button
            type="button"
            className="rating-full-image-btn"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
            aria-label="View full image"
          >
            <span>⛶</span>
            <span className="rating-full-label">Full image</span>
          </button>
          <div className="rating-media-wrap">
            <MediaView
              url={entry.imageUrl}
              alt={entry.text || 'Rating entry'}
              eager
              className="rating-media-img"
            />
          </div>
          {expanded && typeof document !== 'undefined' && createPortal(
            <div className="full-image-overlay" role="dialog" aria-modal="true" aria-label={`${entry.text || 'Challenge'} full image`} onClick={(event) => { event.stopPropagation(); setExpanded(false); }}>
              <button type="button" className="close-full-image" aria-label="Close full image" onClick={() => setExpanded(false)}>✕</button>
              <MediaView url={entry.imageUrl} alt={entry.text || 'Challenge entry full size'} fullImage />
            </div>,
            document.body
          )}
        </>
      ) : (
        <div className="rating-text-card">
          <span className="rating-text-card-label">{entry.text || 'Text entry'}</span>
        </div>
      )}
      {entry.imageUrl && entry.text ? (
        <strong className="rating-item-name">{entry.text}</strong>
      ) : null}
    </div>
  );
}

function RatingGameView({
  current,
  index,
  total,
  onRate,
}: {
  current: ChallengeEntry;
  index: number;
  total: number;
  onRate: (score: number) => Promise<void> | void;
}) {
  const [value, setValue] = useState(7);
  const [submitting, setSubmitting] = useState(false);

  const handleRate = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onRate(value);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="game-title-row rating-title-row">
        <h1 className="game-title rating-game-title">Rating</h1>
        <div className="game-progress-pill rating-progress-pill" aria-label={`Item ${index + 1} of ${total}`}>
          <span className="game-progress-current rating-progress-current">{index + 1}</span>
          <span className="game-progress-sep rating-progress-sep">of</span>
          <span className="game-progress-total rating-progress-total">{total}</span>
        </div>
      </div>
      <div className="game-panel rating-panel rating-unified-container">
        {/* Central Media Stage */}
        <RatingMediaStage key={current.id} entry={current} />

        {/* Rating Controls Card */}
        <div className="rating-controls-card">
          <div className="rating-controls-top">
            <div className="rating-score-display" aria-label={`Selected score: ${value} of 10`}>
              <span className="rating-score-star" aria-hidden="true">★</span>
              <b className="rating-score-num">{value}</b>
              <span className="rating-score-max">/ 10</span>
            </div>
            <button
              type="button"
              className="rating-submit-btn"
              disabled={submitting}
              onClick={() => void handleRate()}
            >
              <span>{submitting ? 'Locking In…' : 'Lock In'}</span>
              <span className="arrow-icon" aria-hidden="true">→</span>
            </button>
          </div>

          {/* 10-Segment Horizontal Rating Bar */}
          <div className="rating-segments-bar" role="radiogroup" aria-label="Rating score from 1 to 10">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
              const isFilled = num <= value;
              const isSelected = num === value;
              return (
                <button
                  key={num}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={`Score ${num}`}
                  className={`rating-segment-btn ${isFilled ? 'filled' : 'unselected'} ${isSelected ? 'selected' : ''}`}
                  onClick={() => setValue(num)}
                >
                  <span className="segment-number">{num}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function GameBoard({ challenge, session, onSession, onNotice, onComplete }: { challenge: Challenge; session: Session; onSession: (s: Session) => void; onNotice: (n: string) => void; onComplete: (v: Record<string, string | number>) => void }) {
  const [values, setValues] = useState(session.values ?? {});
  const entries = useMemo(() => session.order.map((id) => challenge.entries.find((entry) => entry.id === id)).filter((entry): entry is ChallengeEntry => Boolean(entry)), [session.order, challenge.entries]);
  const save = async (next: Record<string, string | number>) => {
    setValues(next); onSession({ ...session, values: next });
    try { await request(`/api/session/${challenge.id}/progress`, { method: 'POST', body: JSON.stringify({ values: next }) }); }
    catch (e) { onNotice(e instanceof Error ? e.message : 'Progress could not be saved.'); }
  };
  const update = (next: Record<string, string | number>) => save(next);
  if (challenge.mode === 'rank') {
    const current = entries.find((entry) => values[entry.id] === undefined);
    const columns = Math.min(entries.length, 5);
    const currentIndex = entries.findIndex((entry) => values[entry.id] === undefined);
    return current ? (
      <>
        <div className="game-title-row">
          <h1 className="game-title rank-game-title">Rank Roulette</h1>
          <div className="game-progress-pill" aria-label={`Item ${currentIndex + 1} of ${entries.length}`}>
            <span className="game-progress-current">{currentIndex + 1}</span>
            <span className="game-progress-sep">of</span>
            <span className="game-progress-total">{entries.length}</span>
          </div>
        </div>
        <div className="game-panel rank-panel" style={{ '--rank-columns': columns } as CSSProperties}>
          <EntryTile entry={current} large rankEntry />
          <p className="instruction">Choose a position</p>
          <div className="rank-grid">
            {Array.from({ length: entries.length }, (_, i) => {
              const position = i + 1;
              const owner = Object.entries(values).find(([, value]) => Number(value) === position);
              const ownerEntry = owner ? challenge.entries.find((entry) => entry.id === owner[0]) : undefined;
              return (
                <button
                  key={position}
                  className={`rank-slot ${owner ? 'occupied' : ''}`}
                  disabled={Boolean(owner)}
                  onClick={async () => {
                    const next = { ...values, [current.id]: position };
                    setValues(next);
                    if (Object.keys(next).length === entries.length) {
                      onComplete(next);
                      return;
                    }
                    await update(next);
                  }}
                  aria-label={owner ? `Position ${position}, ${ownerEntry?.text || 'occupied'}` : `Rank at position ${position}`}
                >
                  {owner ? (
                    <>
                      <small>#{position}</small>
                      <span className="slot-entry-name">{ownerEntry?.text || 'Item'}</span>
                    </>
                  ) : (
                    <span className="slot-number">{position}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </>
    ) : (
      <div className="empty-state">
        <h2>Ranking submitted</h2>
        <button className="primary" onClick={() => onComplete(values)}>See results →</button>
      </div>
    );
  }
  if (challenge.mode === 'kmk') {
    const trio = entries.slice(0, 3);
    const roles = ['Kiss', 'Marry', 'Kill'] as const;
    const current = trio.find((entry) => !roles.some((role) => values[role] === entry.id));
    const currentIndex = trio.findIndex((entry) => !roles.some((role) => values[role] === entry.id));
    return current ? (
      <>
        <div className="game-title-row">
          <h1 className="game-title kmk-game-title">Kiss, Marry, Kill</h1>
          <div className="game-progress-pill" aria-label={`Item ${currentIndex + 1} of 3`}>
            <span className="game-progress-current">{currentIndex + 1}</span>
            <span className="game-progress-sep">of</span>
            <span className="game-progress-total">3</span>
          </div>
        </div>
        <div className="game-panel kmk-panel">
          <EntryTile entry={current} large />
          <p className="instruction">Choose a role for this one.</p>
          <div className="kmk-actions">
            {roles.map((role) => (
              <button
                key={role}
                className={`kmk-action kmk-${role.toLowerCase()}`}
                disabled={Boolean(values[role])}
                onClick={async () => {
                  const next = { ...values, [role]: current.id };
                  setValues(next);
                  if (roles.every((item) => next[item])) {
                    onComplete(next);
                    return;
                  }
                  await update(next);
                }}
              >
                {role}
              </button>
            ))}
          </div>
        </div>
      </>
    ) : (
      <div className="empty-state">
        <h2>All three roles assigned</h2>
        <button className="primary" onClick={() => onComplete(values)}>See results →</button>
      </div>
    );
  }
  if (challenge.mode === 'versus') {
    const starter = entries[0];
    const championId = Object.values(values).at(-1) ?? starter?.id;
    const champion = entries.find((entry) => entry.id === championId);
    const challenger = entries.slice(1).find((entry) => values[entry.id] === undefined);
    let championSide: 'top' | 'bottom' = 'top';
    for (const contender of entries.slice(1)) {
      const winner = values[contender.id];
      if (winner === undefined) break;
      if (winner === contender.id) championSide = championSide === 'top' ? 'bottom' : 'top';
    }
    const otherSide = championSide === 'top' ? 'bottom' : 'top';
    const cards = champion && challenger ? [{ entry: champion, side: championSide }, { entry: challenger, side: otherSide }].sort((a, b) => a.side === 'top' ? -1 : b.side === 'top' ? 1 : 0) : [];
    const chooseSide = async (winnerId: string) => {
      if (!challenger) return;
      const next = { ...values, [challenger.id]: winnerId };
      setValues(next);
      if (Object.keys(next).length === entries.length - 1) { onComplete(next); return; }
      await update(next);
    };
    const currentMatch = Object.keys(values).length + 1;
    const totalMatches = Math.max(1, entries.length - 1);
    return challenger && champion ? (
      <>
        <div className="game-title-row">
          <h1 className="game-title versus-game-title">Pick a Side</h1>
          <div className="game-progress-pill" aria-label={`Matchup ${currentMatch} of ${totalMatches}`}>
            <span className="game-progress-current">{currentMatch}</span>
            <span className="game-progress-sep">of</span>
            <span className="game-progress-total">{totalMatches}</span>
          </div>
        </div>
        <div className="game-panel versus-panel">
          <div className="versus-duel">
            {cards.map(({ entry, side }) => (
              <div
                key={entry.id}
                className={`versus-choice duel-${side}`}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    void chooseSide(entry.id);
                  }
                }}
                onClick={() => void chooseSide(entry.id)}
                aria-label={`Pick ${entry.text || 'this image'}`}
              >
                <EntryTile entry={entry} large />
              </div>
            ))}
            <div className="versus-divider" aria-hidden="true">
              <b>VS</b>
            </div>
          </div>
        </div>
      </>
    ) : (
      <button className="primary" onClick={() => onComplete(values)}>See results →</button>
    );
  }
  if (challenge.mode === 'fact_cap') {
    const currentIndex = entries.findIndex((entry) => values[entry.id] === undefined);
    const current = entries[currentIndex];
    if (!current) return <div className="game-panel"><h2>All calls made.</h2><button className="primary" onClick={() => onComplete(values)}>See results →</button></div>;
    const nextVote = async (vote: 'Fact' | 'Cap') => {
      const next = { ...values, [current.id]: vote };
      setValues(next);
      if (Object.keys(next).length === entries.length) { onComplete(next); return; }
      await update(next);
    };
    return (
      <>
        <div className="game-title-row">
          <h1 className="game-title fact-cap-game-title">Fact or Cap</h1>
          <div className="game-progress-pill" aria-label={`Item ${currentIndex + 1} of ${entries.length}`}>
            <span className="game-progress-current">{currentIndex + 1}</span>
            <span className="game-progress-sep">of</span>
            <span className="game-progress-total">{entries.length}</span>
          </div>
        </div>
        <div className="game-panel fact-cap-panel">
          <EntryTile entry={current} large />
          <p className="instruction">Fact or Cap?</p>
          <div className="fact-cap-actions">
            <button className="fact-cap-action fact-action" onClick={() => void nextVote('Fact')}>
              ✅ <span>FACT</span>
            </button>
            <button className="fact-cap-action cap-action" onClick={() => void nextVote('Cap')}>
              🧢 <span>CAP</span>
            </button>
          </div>
        </div>
      </>
    );
  }
  if (challenge.mode === 'rating') {
    const currentIndex = entries.findIndex((entry) => values[entry.id] === undefined);
    const current = entries[currentIndex];
    if (!current) return <div className="game-panel"><h2>All items rated.</h2><button className="primary" onClick={() => onComplete(values)}>See results →</button></div>;
    const onRate = async (score: number) => {
      const next = { ...values, [current.id]: score };
      setValues(next);
      if (Object.keys(next).length === entries.length) { onComplete(next); return; }
      await update(next);
    };
    return (
      <RatingGameView
        key={current.id}
        current={current}
        index={currentIndex}
        total={entries.length}
        onRate={onRate}
      />
    );
  }
  const currentIndex = entries.findIndex((entry) => values[entry.id] === undefined);
  const current = entries[currentIndex];
  if (!current) return <div className="game-panel"><h2>All calls made.</h2><button className="primary" onClick={() => onComplete(values)}>See results →</button></div>;
  const nextVote = async (vote: string) => { const next = { ...values, [current.id]: vote }; setValues(next); if (Object.keys(next).length === entries.length) { onComplete(next); return; } await update(next); };
  return (
    <>
      <div className="game-title-row">
        <h1 className="game-title smash-game-title">Smash or Pass</h1>
        <div className="game-progress-pill" aria-label={`Item ${currentIndex + 1} of ${entries.length}`}>
          <span className="game-progress-current">{currentIndex + 1}</span>
          <span className="game-progress-sep">of</span>
          <span className="game-progress-total">{entries.length}</span>
        </div>
      </div>
      <div className="game-panel smash-panel">
        <EntryTile entry={current} large />
        <p className="instruction">What's the verdict?</p>
        <div className="smash-actions">
          <button className="smash" onClick={() => void nextVote('Smash')}>🔥 <span>SMASH</span></button>
          <button className="pass" onClick={() => void nextVote('Pass')}>💀 <span>PASS</span></button>
        </div>
      </div>
    </>
  );
}

function MediaView({ url, alt, className, fullImage = false, eager = false }: { url?: string | undefined; alt?: string | undefined; className?: string | undefined; fullImage?: boolean | undefined; eager?: boolean | undefined }) {
  if (!url) return null;
  if (isVideoUrl(url)) {
    return (
      <video
        className={className}
        src={url}
        autoPlay
        loop
        muted
        playsInline
        controls={fullImage}
      />
    );
  }
  return (
    <img
      className={className}
      src={url}
      alt={alt || ''}
      loading={eager ? 'eager' : 'lazy'}
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  );
}

function EntryTile({ entry, large, rankEntry = false }: { entry: ChallengeEntry; large?: boolean; rankEntry?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const fullImageButton = <button type="button" className="view-full-image" onClick={(event) => { event.stopPropagation(); setExpanded(true); }}>⛶ <span>Full image</span></button>;
  const isTextOnly = !entry.imageUrl;
  return <div className={`entry-tile ${large ? 'entry-large' : ''} ${rankEntry ? 'rank-entry-tile' : ''} ${isTextOnly ? 'entry-text-only' : ''}`}>
    {entry.imageUrl && <>
      {fullImageButton}
      <MediaView className={rankEntry ? 'rank-entry-image' : undefined} url={entry.imageUrl} alt={entry.text || 'Challenge entry'} eager={large} />
      {expanded && typeof document !== 'undefined' && createPortal(
        <div className="full-image-overlay" role="dialog" aria-modal="true" aria-label={`${entry.text || 'Challenge'} full image`} onClick={(event) => { event.stopPropagation(); setExpanded(false); }}>
          <button type="button" className="close-full-image" aria-label="Close full image" onClick={() => setExpanded(false)}>✕</button>
          <MediaView url={entry.imageUrl} alt={entry.text || 'Challenge entry full size'} fullImage />
        </div>,
        document.body
      )}
    </>}
    <strong className={isTextOnly ? 'text-card-label' : undefined}>{entry.text || (isTextOnly ? 'Text entry' : 'Image entry')}</strong>
  </div>;
}

function YourResults({ challenge, session }: { challenge: Challenge; session: Session }) {
  const byId = Object.fromEntries(challenge.entries.map((e) => [e.id, e]));
  const rows = challenge.mode === 'rank'
    ? Object.entries(session.values).sort((a, b) => Number(a[1]) - Number(b[1])).map(([id, value]) => ({ label: `#${value}`, posNum: `${value}`, entry: byId[id], detail: `Ranked #${value}` }))
    : challenge.mode === 'kmk'
      ? ['Kiss', 'Marry', 'Kill'].map((role) => ({ label: `${role === 'Kiss' ? '💋 ' : role === 'Marry' ? '💍 ' : '💀 '}${role}`, posNum: '', entry: byId[String(session.values[role])], detail: `Assigned ${role}` }))
      : challenge.mode === 'smash'
        ? Object.entries(session.values).map(([id, value]) => ({ label: `${value === 'Smash' ? '🔥 ' : '💀 '}${value}`, posNum: '', entry: byId[id], detail: `Voted ${value}` }))
        : challenge.mode === 'fact_cap'
          ? Object.entries(session.values).map(([id, value]) => ({ label: `${value === 'Fact' ? '✅ ' : '🧢 '}${value}`, posNum: '', entry: byId[id], detail: `Voted ${value}` }))
          : challenge.mode === 'rating'
            ? Object.entries(session.values).sort((a, b) => Number(b[1]) - Number(a[1])).map(([id, value]) => ({ label: `★ ${value}/10`, posNum: '', entry: byId[id], detail: `Your rating: ${value} of 10` }))
            : (() => { let champion = session.order[0] ?? ''; return session.order.slice(1).map((challenger) => { const winner = String(session.values[challenger]); const loser = winner === champion ? challenger : champion; const row = { label: 'PICKED', posNum: '', entry: byId[winner], detail: `over ${byId[loser]?.text ?? 'Image entry'}` }; champion = winner; return row; }); })();
  const commentPreview = challenge.mode === 'rank'
    ? `🏆 My rankings: ${Object.entries(session.values).sort((a, b) => Number(a[1]) - Number(b[1])).map(([id, position]) => `#${position}. ${byId[id]?.text || 'Image entry'}`).join(' | ')}`
    : challenge.mode === 'kmk'
      ? `💋 Kiss: ${byId[String(session.values.Kiss)]?.text || 'Image entry'}\n💍 Marry: ${byId[String(session.values.Marry)]?.text || 'Image entry'}\n💀 Kill: ${byId[String(session.values.Kill)]?.text || 'Image entry'}`
      : challenge.mode === 'smash'
        ? Object.entries(session.values).map(([id, vote]) => `${vote === 'Smash' ? '🔥 Smash' : '💀 Pass'}: ${byId[id]?.text || 'Image entry'}`).join('\n')
        : challenge.mode === 'fact_cap'
          ? Object.entries(session.values).map(([id, vote]) => `${vote === 'Fact' ? '✅ Fact' : '🧢 Cap'}: ${byId[id]?.text || 'Image entry'}`).join('\n')
          : challenge.mode === 'rating'
            ? `⭐ My Ratings:\n` + Object.entries(session.values).sort((a, b) => Number(b[1]) - Number(a[1])).map(([id, value]) => `⭐ ${byId[id]?.text || 'Image entry'}: ${value}/10`).join('\n')
            : (() => { const champion = String(Object.values(session.values).at(-1) ?? session.order[0]); return `👑 My Pick is ${byId[champion]?.text || 'Image entry'} over ${session.order.filter((id) => id !== champion).map((id) => byId[id]?.text || 'Image entry').join(', ')}.`; })();
  return (
    <div className={`results-card personal-results ${challenge.mode === 'rank' ? 'rank-results' : ''}`}>
      <div className="results-heading">
        <span className="success-mark">✓</span>
        <div>
          <span className="eyebrow">GAME COMPLETE</span>
          <h2>Results</h2>
          <p className="results-option">My rankings</p>
        </div>
      </div>
      <div className="ranking-feed">
        {rows.map((row, index) => (
          <div className="ranking-feed-row" key={`${row.label}-${row.entry?.id ?? index}`}>
            <span className="ranking-position">{challenge.mode === 'rank' ? row.posNum : index + 1}</span>
            {row.entry?.imageUrl ? <MediaView url={row.entry.imageUrl} alt=""/> : <span className="ranking-thumb-fallback">{(row.entry?.text ?? '').slice(0, 1) || String(index + 1)}</span>}
            <div className="ranking-item-text">
              <b>{row.entry?.text || 'Image entry'}</b>
              {row.detail && <small className="rank-stat-text">{row.detail}</small>}
            </div>
            {challenge.mode !== 'rank' && <span className="ranking-row-label">{row.label}</span>}
          </div>
        ))}
        <details className="comment-preview completed-choices">
          <summary>Comment preview</summary>
          <p>{commentPreview}</p>
        </details>
      </div>
    </div>
  );
}

function EveryoneResults({ challenge, results }: { challenge: Challenge; results: { plays: number; totals: Record<string, string> } | null }) {
  const getCount = (key: string) => Number(results?.totals[key] ?? 0);

  const getKiss = (entry: ChallengeEntry) => Math.max(getCount(`role:Kiss:${entry.id}`), getCount(`role:${entry.id}:Kiss`));
  const getMarry = (entry: ChallengeEntry) => Math.max(getCount(`role:Marry:${entry.id}`), getCount(`role:${entry.id}:Marry`));
  const getKill = (entry: ChallengeEntry) => Math.max(getCount(`role:Kill:${entry.id}`), getCount(`role:${entry.id}:Kill`));

  const getSmash = (entry: ChallengeEntry) => getCount(`Smash:${entry.id}`);
  const getPass = (entry: ChallengeEntry) => getCount(`Pass:${entry.id}`);

  const getFact = (entry: ChallengeEntry) => getCount(`Fact:${entry.id}`);
  const getCap = (entry: ChallengeEntry) => getCount(`Cap:${entry.id}`);

  const getRatingSum = (entry: ChallengeEntry) => getCount(`rating_sum:${entry.id}`);
  const getRatingCount = (entry: ChallengeEntry) => getCount(`rating_count:${entry.id}`);
  const getRatingAvg = (entry: ChallengeEntry) => {
    const count = getRatingCount(entry);
    return count > 0 ? getRatingSum(entry) / count : 0;
  };

  const getRankLeader = (entry: ChallengeEntry) => {
    let position: number | null = null;
    let votes = 0;
    for (let i = 0; i < challenge.entries.length; i += 1) {
      const count = getCount(`rank:${entry.id}:${i + 1}`);
      if (count > votes) {
        position = i + 1;
        votes = count;
      }
    }
    return votes > 0 && position !== null ? { position, votes } : null;
  };
  const getRankTotal = (entry: ChallengeEntry) => {
    const counts = Array.from({ length: challenge.entries.length }, (_, i) => getCount(`rank:${entry.id}:${i + 1}`));
    return counts.reduce((sum, value) => sum + value, 0);
  };

  const getPicks = (entry: ChallengeEntry) => getCount(`pick:${entry.id}`);

  const mostPicked = [...challenge.entries].sort((a, b) => getPicks(b) - getPicks(a))[0];

  const getKMKRankedEntries = (): ChallengeEntry[] => {
    const items = [...challenge.entries];
    if (items.length !== 3) {
      return items.sort((a, b) => getKiss(b) - getKiss(a));
    }
    const perms: [number, number, number][] = [
      [0, 1, 2], [0, 2, 1],
      [1, 0, 2], [1, 2, 0],
      [2, 0, 1], [2, 1, 0]
    ];
    let bestPerm: [number, number, number] = [0, 1, 2];
    let bestScore = -1;
    for (const [k, m, d] of perms) {
      const itemK = items[k];
      const itemM = items[m];
      const itemD = items[d];
      if (!itemK || !itemM || !itemD) continue;
      // Match so item with most kisses is #1, most marry is #2, most kills is #3
      const score = getKiss(itemK) * 10000 + getMarry(itemM) * 100 + getKill(itemD);
      if (score > bestScore) {
        bestScore = score;
        bestPerm = [k, m, d];
      }
    }
    const [bestK, bestM, bestD] = bestPerm;
    const resK = items[bestK];
    const resM = items[bestM];
    const resD = items[bestD];
    if (resK && resM && resD) {
      return [resK, resM, resD];
    }
    return items;
  };

  const rankedEntries = challenge.mode === 'kmk'
    ? getKMKRankedEntries()
    : [...challenge.entries].sort((a, b) => {
        if (challenge.mode === 'rank') {
          const rankA = getRankLeader(a);
          const rankB = getRankLeader(b);
          if (!rankA && !rankB) return 0;
          if (!rankA) return 1;
          if (!rankB) return -1;
          return rankA.position - rankB.position || rankB.votes - rankA.votes;
        }
        if (challenge.mode === 'smash') {
          return getSmash(b) - getSmash(a) || getPass(a) - getPass(b);
        }
        if (challenge.mode === 'fact_cap') {
          const aFact = getFact(a); const aCap = getCap(a); const aTotal = aFact + aCap;
          const bFact = getFact(b); const bCap = getCap(b); const bTotal = bFact + bCap;
          const aPct = aTotal > 0 ? aFact / aTotal : 0;
          const bPct = bTotal > 0 ? bFact / bTotal : 0;
          if (bPct !== aPct) return bPct - aPct;
          return bFact - aFact;
        }
        if (challenge.mode === 'rating') {
          const aAvg = getRatingAvg(a);
          const bAvg = getRatingAvg(b);
          if (bAvg !== aAvg) return bAvg - aAvg;
          return getRatingCount(b) - getRatingCount(a);
        }
        return getPicks(b) - getPicks(a);
      });

  const bestRanked = rankedEntries[0];
  const bestRankLeader = bestRanked ? getRankLeader(bestRanked) : null;

  const getFactCapHighlight = () => {
    if (challenge.entries.length === 0) return '—';
    const sortedByFact = [...challenge.entries].sort((a, b) => getFact(b) - getFact(a));
    const sortedByCap = [...challenge.entries].sort((a, b) => getCap(b) - getCap(a));
    const topFact = sortedByFact[0];
    const topCap = sortedByCap[0];
    const factCalls = topFact ? getFact(topFact) : 0;
    const capCalls = topCap ? getCap(topCap) : 0;
    if (factCalls === 0 && capCalls === 0) return 'No calls yet';
    return `✅ Most Fact: ${topFact?.text ?? '—'} (${factCalls} votes) · 🧢 Biggest Cap: ${topCap?.text ?? '—'} (${capCalls} votes)`;
  };

  const getRatingHighlight = () => {
    if (challenge.entries.length === 0) return '—';
    const top = rankedEntries[0];
    if (!top) return '—';
    const avg = getRatingAvg(top);
    const count = getRatingCount(top);
    if (count === 0) return 'No ratings yet';
    return `🏆 Highest Rated: ${top.text || '—'} · ★ ${avg.toFixed(1)}/10 average (${count} rating${count === 1 ? '' : 's'})`;
  };

  const getSmashHighlight = () => {
    if (challenge.entries.length === 0) return '—';
    const sortedBySmash = [...challenge.entries].sort((a, b) => getSmash(b) - getSmash(a));
    const firstSmash = sortedBySmash[0];
    const maxSmash = firstSmash ? getSmash(firstSmash) : 0;
    const topSmashed = sortedBySmash.filter((e) => getSmash(e) === maxSmash && maxSmash > 0);

    const sortedByPass = [...challenge.entries].sort((a, b) => getPass(b) - getPass(a));
    const firstPass = sortedByPass[0];
    const maxPass = firstPass ? getPass(firstPass) : 0;
    const topPassed = sortedByPass.filter((e) => getPass(e) === maxPass && maxPass > 0 && !topSmashed.some((ts) => ts.id === e.id));

    if (maxSmash === 0 && maxPass === 0) {
      return 'No votes yet';
    }

    if (topSmashed.length > 1) {
      const names = topSmashed.map((e) => e.text || 'Image').join(' & ');
      if (topPassed.length > 0 && maxPass > 0) {
        return `🤝 Tie for most smashed: ${names} (${maxSmash} votes) · 💀 Most passed: ${topPassed[0]?.text ?? '—'} (${maxPass} votes)`;
      }
      return `🤝 Tie: ${names} (${maxSmash} Smash vote${maxSmash === 1 ? '' : 's'})`;
    }

    if (topSmashed.length === 1 && topSmashed[0]) {
      const smashPart = `🔥 Most smashed: ${topSmashed[0].text || '—'} (${maxSmash} votes)`;
      if (topPassed.length > 0 && maxPass > 0 && topPassed[0]) {
        return `${smashPart} · 💀 Most passed: ${topPassed[0].text || '—'} (${maxPass} votes)`;
      }
      return smashPart;
    }

    if (topPassed.length > 0 && topPassed[0]) {
      return `💀 Most passed: ${topPassed[0].text || '—'} (${maxPass} votes)`;
    }

    return '🤝 It’s a tie!';
  };

  const highlight = challenge.mode === 'versus'
    ? `👑 Most picked: ${mostPicked?.text ?? '—'} (${mostPicked ? getPicks(mostPicked) : 0} picks)`
    : challenge.mode === 'kmk'
      ? `💋 #1 Most Kisses: ${rankedEntries[0]?.text ?? '—'} · 💍 #2 Most Marry: ${rankedEntries[1]?.text ?? '—'} · 💀 #3 Most Kills: ${rankedEntries[2]?.text ?? '—'}`
      : challenge.mode === 'smash'
        ? getSmashHighlight()
        : challenge.mode === 'fact_cap'
          ? getFactCapHighlight()
          : challenge.mode === 'rating'
            ? getRatingHighlight()
            : `🏆 Top position: ${bestRanked?.text ?? '—'}${bestRankLeader ? ` · Most placed #${bestRankLeader.position}` : ''} · ${results?.plays ?? 0} total plays`;

  const ranks = rankedEntries.map((_, idx) => idx + 1);

  return (
    <div className="results-card community-results">
      <div className="results-heading">
        <div>
          <span className="eyebrow">COMMUNITY</span>
          <h2>Results</h2>
          <p className="results-option">All rankings · {results?.plays ?? 0} plays</p>
        </div>
      </div>
      {results === null ? (
        <div className="empty-state"><p>Loading community results…</p></div>
      ) : results.plays > 0 ? (
        <>
          <div className="result-highlights">{highlight}</div>
          <div className="community-list">
            {rankedEntries.map((entry, index) => {
              if (challenge.mode === 'kmk') {
                const kissCount = getKiss(entry);
                const marryCount = getMarry(entry);
                const killCount = getKill(entry);
                const kmkRoleLabels = ['💋 Most Kisses', '💍 Most Marry', '💀 Most Kills'];
                const kmkRoleClasses = ['kiss-badge', 'marry-badge', 'kill-badge'];
                const roleBadgeText = kmkRoleLabels[index] || `#${index + 1}`;
                const roleBadgeClass = kmkRoleClasses[index] || 'generic-badge';
                return (
                  <div className="ranking-feed-row community-feed-row kmk-community-row" key={entry.id}>
                    <span className="ranking-position">#{index + 1}</span>
                    {entry.imageUrl ? <MediaView url={entry.imageUrl} alt="" /> : <span className="ranking-thumb-fallback">{(entry.text ?? '').slice(0, 1) || '•'}</span>}
                    <div className="ranking-item-text">
                      <b>{entry.text || 'Image entry'}</b>
                      <div className="kmk-stats-row">
                        <span className="stat-pill kmk-kiss">💋 <b>{kissCount}</b></span>
                        <span className="stat-pill kmk-marry">💍 <b>{marryCount}</b></span>
                        <span className="stat-pill kmk-kill">💀 <b>{killCount}</b></span>
                      </div>
                    </div>
                    <b className={`kmk-role-badge ${roleBadgeClass}`}>{roleBadgeText}</b>
                  </div>
                );
              }

              if (challenge.mode === 'smash') {
                const smashCount = getSmash(entry);
                const passCount = getPass(entry);
                const totalVotes = smashCount + passCount;
                const smashPct = totalVotes > 0 ? Math.round((smashCount / totalVotes) * 100) : 0;
                return (
                  <div className="ranking-feed-row community-feed-row smash-community-row" key={entry.id}>
                    <span className="ranking-position">#{ranks[index]}</span>
                    {entry.imageUrl ? <MediaView url={entry.imageUrl} alt="" /> : <span className="ranking-thumb-fallback">{(entry.text ?? '').slice(0, 1) || '•'}</span>}
                    <div className="ranking-item-text">
                      <b>{entry.text || 'Image entry'}</b>
                      <div className="smash-stats-row">
                        <span className="stat-pill smash-fire">🔥 <b>{smashCount}</b> Smash</span>
                        <span className="stat-pill smash-pass">💀 <b>{passCount}</b> Pass</span>
                      </div>
                    </div>
                    <b className="ranking-avg-badge smash-badge">{smashPct}% Smash</b>
                  </div>
                );
              }

              if (challenge.mode === 'fact_cap') {
                const factCount = getFact(entry);
                const capCount = getCap(entry);
                const totalVotes = factCount + capCount;
                const factPct = totalVotes > 0 ? Math.round((factCount / totalVotes) * 100) : 0;
                return (
                  <div className="ranking-feed-row community-feed-row fact-cap-community-row" key={entry.id}>
                    <span className="ranking-position">#{ranks[index]}</span>
                    {entry.imageUrl ? <MediaView url={entry.imageUrl} alt="" /> : <span className="ranking-thumb-fallback">{(entry.text ?? '').slice(0, 1) || '•'}</span>}
                    <div className="ranking-item-text">
                      <b>{entry.text || 'Image entry'}</b>
                      <div className="fact-cap-stats-row">
                        <span className="stat-pill fact-pill">✅ <b>{factCount}</b> Fact</span>
                        <span className="stat-pill cap-pill">🧢 <b>{capCount}</b> Cap</span>
                      </div>
                    </div>
                    <b className="ranking-avg-badge fact-cap-badge">{factPct}% Fact</b>
                  </div>
                );
              }

              if (challenge.mode === 'rating') {
                const avg = getRatingAvg(entry);
                const count = getRatingCount(entry);
                const pos = ranks[index];
                const medalClass = pos === 1 ? 'medal-gold' : pos === 2 ? 'medal-silver' : pos === 3 ? 'medal-bronze' : '';
                return (
                  <div className="ranking-feed-row community-feed-row rating-community-row" key={entry.id}>
                    <span className={`ranking-position ${medalClass}`}>#{pos}</span>
                    {entry.imageUrl ? <MediaView url={entry.imageUrl} alt="" /> : <span className="ranking-thumb-fallback">{(entry.text ?? '').slice(0, 1) || '•'}</span>}
                    <div className="ranking-item-text">
                      <b>{entry.text || 'Image entry'}</b>
                      <span className="rank-stat-text">Average: <b>{avg.toFixed(1)} / 10</b> · {count} rating{count === 1 ? '' : 's'}</span>
                    </div>
                    <b className={`ranking-avg-badge rating-badge ${medalClass}`}>★ {avg.toFixed(1)}/10</b>
                  </div>
                );
              }

              if (challenge.mode === 'rank') {
                const rankLeader = getRankLeader(entry);
                const totalPlacements = getRankTotal(entry);
                return (
                  <div className="ranking-feed-row community-feed-row rank-community-row" key={entry.id}>
                    <span className="ranking-position">{ranks[index]}</span>
                    {entry.imageUrl ? <MediaView url={entry.imageUrl} alt="" /> : <span className="ranking-thumb-fallback">{(entry.text ?? '').slice(0, 1) || '•'}</span>}
                    <div className="ranking-item-text">
                      <b>{entry.text || 'Image entry'}</b>
                      <span className="rank-stat-text">Most placed: <b>#{rankLeader?.position ?? '—'}</b> · {totalPlacements} placement{totalPlacements === 1 ? '' : 's'}</span>
                    </div>
                    <b className="ranking-avg-badge">#{rankLeader?.position ?? '—'}</b>
                  </div>
                );
              }

              const count = getPicks(entry);
              const maxPicks = Math.max(results.plays * Math.max(challenge.entries.length - 1, 1), 1);
              const pct = Math.round((count / maxPicks) * 100);
              return (
                <div className="ranking-feed-row community-feed-row versus-community-row" key={entry.id}>
                  <span className="ranking-position">#{ranks[index]}</span>
                  {entry.imageUrl ? <MediaView url={entry.imageUrl} alt="" /> : <span className="ranking-thumb-fallback">{(entry.text ?? '').slice(0, 1) || '•'}</span>}
                  <div className="ranking-item-text">
                    <b>{entry.text || 'Image entry'}</b>
                    <span className="rank-stat-text"><b>{count}</b> duel win{count === 1 ? '' : 's'}</span>
                    <div className="bar-track"><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
                  </div>
                  <b className="ranking-avg-badge">{count} picks</b>
                </div>
              );
            })}
            <p className="fine-print">Only completed games are counted. Individual players and usernames are never shown.</p>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <h3>You're the first to finish.</h3>
          <p>Community results will appear after more players complete this challenge.</p>
          <p className="fine-print">Only completed games are counted. Individual players and usernames are never shown.</p>
        </div>
      )}
    </div>
  );
}

async function comment(challenge: Challenge, notice: (n: string) => void): Promise<boolean> { try { await request(`/api/comment/${challenge.id}`, { method: 'POST', body: '{}' }); notice('Your comment was submitted.'); return true; } catch (error) { notice(error instanceof Error ? error.message : 'Could not comment.'); return false; } }





