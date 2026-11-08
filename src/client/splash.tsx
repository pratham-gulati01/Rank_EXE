import './index.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './game';
import { SetupApp } from './setup';
import type { Challenge } from '../shared/game';

export const Splash = () => {
  const [screen, setScreen] = useState<'loading' | 'setup' | 'game' | 'error'>('loading');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [subreddit, setSubreddit] = useState<string | undefined>(undefined);

  useEffect(() => {
    void fetch('/api/init').then(async (response) => {
      const result = await response.json() as { challenge?: Challenge; setup?: boolean; subreddit?: string };
      if (!response.ok) throw new Error('Could not open this RANK.EXE post.');
      if (result.subreddit) {
        setSubreddit(result.subreddit);
      }
      if (result.challenge) {
        setChallenge(result.challenge);
        setScreen('game');
      } else if (result.setup) {
        setScreen('setup');
      } else {
        setScreen('error');
      }
    }).catch(() => setScreen('error'));
  }, []);

  if (screen === 'setup') return <SetupApp />;
  if (screen === 'game') return <App initialChallenge={challenge} initialSubreddit={subreddit} />;
  if (screen === 'loading') {
    return (
      <main className="game-post-shell">
        <div className="game-loading-screen" role="status" aria-live="polite">
          <div className="loading-brand"><span className="loading-mark">R</span><span>RANK<span className="accent">.EXE</span></span></div>
          <div className="loading-orbit"><i/><i/><i/></div>
          <h1>Opening your game</h1>
          <p>Loading your challenge…</p>
          <div className="loading-skeleton"><span/><span/><span/></div>
        </div>
      </main>
    );
  }
  return (
    <main className="game-post-shell">
      <div className="empty-state">
        <h2>Game unavailable</h2>
        <p>This post is not connected to a game. Create one from the subreddit menu.</p>
      </div>
    </main>
  );
};

createRoot(document.getElementById('root')!).render(<StrictMode><Splash /></StrictMode>);

