import { context, reddit } from '@devvit/web/server';
import { EntrypointHeight } from '@devvit/reddit';

export const createPost = async () => {
  if (!context.subredditName) throw new Error('A subreddit context is required to create a Rank-EXE post.');
  return await reddit.submitCustomPost({
    title: 'RANK.EXE — Create a game',
    subredditName: context.subredditName,
    entry: 'default',
    styles: { backgroundColor: '#101114FF', backgroundColorDark: '#101114FF', height: EntrypointHeight.TALL },
    postData: { setup: true },
  });
};
