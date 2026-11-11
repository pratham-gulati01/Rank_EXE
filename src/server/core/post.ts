import { context, reddit } from '@devvit/web/server';
import { EntrypointHeight } from '@devvit/reddit';

export const createPost = async () => {
  if (!context.subredditName) throw new Error('A subreddit context is required to create a Rank-EXE post.');
  if (context.userId) {
    try {
      return await reddit.submitCustomPost({
        title: 'RANK.EXE — Create a game',
        subredditName: context.subredditName,
        entry: 'default',
        styles: { backgroundColor: '#101114FF', backgroundColorDark: '#101114FF', height: EntrypointHeight.TALL },
        postData: { setup: true },
        runAs: 'USER',
        userGeneratedContent: {
          text: 'RANK.EXE — Create a game',
        },
        textFallback: {
          text: 'RANK.EXE — Create a game. Open this post to build a game.',
        },
      });
    } catch (err) {
      console.warn('Post creation as USER failed, falling back to APP', err);
    }
  }
  return await reddit.submitCustomPost({
    title: 'RANK.EXE — Create a game',
    subredditName: context.subredditName,
    entry: 'default',
    styles: { backgroundColor: '#101114FF', backgroundColorDark: '#101114FF', height: EntrypointHeight.TALL },
    postData: { setup: true },
  });
};
