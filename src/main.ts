import { mountFeed } from './ui';

if (import.meta.env.DEV) {
  const { seedDevFeed } = await import('./dev-tools');
  const { installDevPotok } = await import('./potok-dev');
  seedDevFeed();
  installDevPotok();
}

mountFeed(document.querySelector<HTMLElement>('#feed')!);
