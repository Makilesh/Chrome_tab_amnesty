/**
 * Phase 1 gate reading from study summaries (x-ray page -> Export study summary).
 *
 *   npm run phase1 <name> [<name> ...]      reads fixtures/<name>.study.json
 *
 * Prints, per browser: how often Archive & close was pressed and on how many days, how many were
 * brought back, and the open-tab count before the first press vs days 6-8 after. Whether a press
 * was unprompted is not in the data; it is the tester's report and is flagged as such.
 */
import { readFileSync } from 'node:fs';
import { readGate, type StudySummary } from '../src/archive/study';

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function main(): void {
  const names = process.argv.slice(2);
  if (names.length === 0) throw new Error('usage: phase1 <name> [<name> ...]');
  let pressed = 0;
  let lower = 0;
  let unreadable = 0;
  console.log('== Phase 1 gate: pressed Archive & close of their own accord AND open-tab count lower 7 days later');
  console.log('   "own accord" is the tester\'s report, not in the data; ask each tester whether they were prompted.\n');
  for (const name of names) {
    const s = JSON.parse(readFileSync(`fixtures/${name}.study.json`, 'utf8')) as StudySummary;
    if (s.kind !== 'tab-amnesty-phase1-study' || s.schemaVersion !== 1) throw new Error(`${name}: not a study summary v1`);
    const g = readGate(s);
    if (g.pressed) pressed++;
    if (g.lowerAtDay7) lower++;
    if (g.pressed && g.lowerAtDay7 === null) unreadable++;
    const verdict = !g.pressed
      ? 'never pressed'
      : g.lowerAtDay7 === null
        ? g.readableFrom
          ? `day 7 not readable until ${day(g.readableFrom)}`
          : 'no snapshot before the first press — cannot compare'
        : g.lowerAtDay7
          ? 'LOWER at day 7'
          : 'NOT lower at day 7';
    console.log(
      `${name.padEnd(14)} presses ${g.presses} on ${g.pressDays} day(s), brought back ${g.broughtBack}` +
        (g.firstPress ? `, first ${day(g.firstPress)}` : '') +
        ` | open before ${g.before ?? '-'} -> day 6-8 ${g.day7 ?? '-'} | ${verdict}` +
        ` | ${s.snapshots.length} snapshots`,
    );
  }
  console.log(`\n${pressed} of ${names.length} pressed; ${lower} of ${names.length} lower at day 7; ${unreadable} not yet readable.`);
}

main();
