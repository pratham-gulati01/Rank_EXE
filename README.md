# RANK.EXE

**Pick. Rank. Regret. Repeat.**

RANK.EXE is an interactive Reddit community game app powered by `@devvit/web`, React 19, and Hono. It allows moderators and Redditors to create engaging, bite-sized visual and text games inside Reddit posts. Players can play directly within the Reddit feed, view personal and community leaderboards, and share their choices as Reddit comments.

---

## 🎮 The 6 Game Modes

RANK.EXE includes six distinct game modes designed for fast, replayable community debates:

### 1. Rank Roulette (2–10 items)
- **Concept:** Blind ranking challenge.
- **How it works:** Items are revealed one at a time in randomized order. Before seeing the next item, players must assign the current item to a specific numbered ranking slot (from `#1` to `#N`).
- **The Catch:** Once a slot is chosen, it is permanently locked in. If you put the first item in `#2`, and an even better one appears later, you have to decide where it belongs among the remaining slots.
- **Layout:** Uses a clean adaptive grid (up to 5 columns wide; 10 items display as two neat rows of five).
- **Leaderboard:** Ranks items by their most frequent placement (e.g., *Most placed: #1*) and total placements.

### 2. Pick a Side (2–30 items)
- **Concept:** "King of the Hill" head-to-head duels.
- **How it works:** Starts with two contenders facing off. Players tap either card to pick their winner. The champion retains their position on screen, while a new challenger enters the opposing slot.
- **The Goal:** Battle through the entire gauntlet until only the ultimate champion stands.
- **Leaderboard:** Displays each contender's duel wins, community win percentage bar, and total pick count.

### 3. Kiss, Marry, Kill (Exactly 3 items)
- **Concept:** The classic party dilemma.
- **How it works:** Three items are presented one by one. The player must assign each entry to one of three roles: 💋 **Kiss**, 💍 **Marry**, or 💀 **Kill**.
- **Constraint:** Each role and entry can be assigned exactly once.
- **Leaderboard:** Highlights `#1 Most Kisses`, `#2 Most Marry`, and `#3 Most Kills`, showing exact vote tallies and community role badges for each contender.

### 4. Smash or Pass (2–30 items)
- **Concept:** Fast-paced binary voting.
- **How it works:** Contenders are presented one at a time. Tap 🔥 **Smash** or 💀 **Pass** to make an instant verdict and move to the next item.
- **Leaderboard:** Ranks contenders by community **Smash %** and vote counts, highlighting the most smashed and most passed entries.

### 5. Fact or Cap (2–30 items)
- **Concept:** Real or Fake trivia challenge.
- **How it works:** Players evaluate statements, rumors, or entries one by one. Vote ✅ **Fact** (truth/legit) or 🧢 **Cap** (fake/cap) on each card.
- **Leaderboard:** Ranks entries by community **Fact %** and total calls, calling out the biggest facts and biggest caps in the community highlight banner.

### 6. Rating (2–30 items)
- **Concept:** Granular 1-to-10 scoring.
- **How it works:** Rate each item on a 1–10 scale using an interactive slider or direct number tick buttons, then tap **Lock In** to save the score and advance.
- **Leaderboard:** Calculates the exact community average score (e.g. `★ 9.4 / 10`) and total ratings for each contender, ranking them from highest to lowest.

---

## 🛠️ Media & Format Support

All six games support rich media and text-only entries:
- **Images:** JPEG, PNG, WebP, AVIF.
- **Animations & Video:** Animated GIFs and AVI / MP4 video files with automatic loop and inline playback.
- **Text-Only Cards:** Bold, styled typographic cards for pure text debate topics (e.g., hot takes, movie titles, philosophy).
- **Full-Screen Media Viewer:** Tap the `⛶ Full image` button on any media entry to inspect high-resolution images and videos in an overlay.

---

## 🎨 Game Creation & Customization

Moderators and creators can launch new games directly from the setup post:

1. **Choose a Game Mode:** Select any of the 6 game types.
2. **Game Title & Details:** Name your game, with optional description and category tags (Pop culture, Gaming, Food, Music, Sports, etc.).
3. **Custom Game Theme (One-Tap Accent):** Click the palette icon to instantly open the color picker. Choose from vibrant presets (Blue, Violet, Teal, Orange, Rose, Green) or input a custom HEX accent color.
4. **Item Actions Toolbar:**
   - **Media:** One-tap bulk upload for multiple images, GIFs, or videos.
   - **Text:** Quickly add a text card.
   - **Bulk:** Add batches of 5 entries at once.
5. **Numbered Item Rows:** Compact numbered strips (`01`, `02`, …) where attached media previews appear directly in the number box with quick-detach controls.
6. **Publish:** The sticky footer tracks real-time entry readiness (`X of Y minimum entries`) and publishes the game directly to the subreddit as a dedicated interactive Reddit post.

---

## 📊 Play, Leaderboards & Reddit Comments

- **In-Post Gameplay:** Games run entirely inside Reddit's WebView interface with zero external redirects.
- **Dual Results View:**
  - **You (Your Choices):** Summary of your personal selections, rankings, and ratings.
  - **All (Everyone Played):** Aggregated community leaderboard showing collective rankings, win rates, and vote distributions.
- **Smooth Navigation:** Internal list scrolling with synchronized Up/Down arrow buttons for long entry lists.
- **Comment My Rankings:** Tap **Comment my rankings** to automatically format your choices with custom emojis and post them as a Reddit comment directly onto the post thread.

---

## 💻 Tech Stack

- **Platform:** Reddit Developer Platform ([Devvit](https://developers.reddit.com/))
- **Frontend:** React 19, TypeScript, Vite, CSS Modules with modern flexbox/grid layout
- **Backend / Routing:** Hono running on Devvit Web Server
- **State & Storage:** Redis for session progress, distributed locks, challenge indexing, and live leaderboard aggregation
- **Media Hosting:** Reddit Media Upload API with direct video/GIF streaming support
