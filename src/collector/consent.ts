/**
 * Asked first: nothing about any tab is recorded until the person presses Start on the sweep page
 * (the Chrome Web Store's User Data Policy, its disclosure rule enforced since 1 Aug 2026;
 * DECISIONS 2026-11-10). Someone already using Tab Amnesty from before it asked — their database
 * holds records — is not asked again. The answer is read from the database every time rather than
 * kept in a variable: the worker dies at 30 s idle (§5.5), and the sweep page asks too.
 */
import { backupStarted } from '../archive/backup';
import { getCards } from '../archive/store';
import { getAllTraces, getMeta, setMeta } from './db';

/** Has the person said yes — or were they using Tab Amnesty before it asked? */
export async function hasStarted(): Promise<boolean> {
  if (await getMeta('startedAt')) return true;
  if ((await getAllTraces()).length > 0 || (await getCards()).length > 0) {
    await start();
    return true;
  }
  return false;
}

/** The person pressed Start. Kept in the second copy too, so a database Chrome replaces does not ask again. */
export async function start(at = Date.now()): Promise<void> {
  await setMeta('startedAt', at);
  await backupStarted(at).catch(() => {});
}
