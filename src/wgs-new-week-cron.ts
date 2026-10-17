#!/usr/bin/env bun

export {};

const ROOT = '/Users/Joseph/Development/workout-google-sheets';
const child = Bun.spawn([`${ROOT}/wgs`, 'check-for-new-week', '--json'], {
  cwd: ROOT,
  stdout: 'pipe',
  stderr: 'pipe',
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);

if (exitCode !== 0) {
  console.error(stderr.trim() || stdout.trim() || `wgs check-for-new-week exited ${exitCode}`);
  process.exit(exitCode);
}

const start = stdout.indexOf('{');
const end = stdout.lastIndexOf('}');
if (start < 0 || end < start) {
  console.error(`wgs check-for-new-week returned no JSON object: ${stdout.trim() || '(empty)'}`);
  process.exit(2);
}

const result = JSON.parse(stdout.slice(start, end + 1));
if (result.hasNewWeek !== true) {
  console.log('NO_REPLY');
  process.exit(0);
}

console.log(`A new workout week appears ready in Google Sheets. Latest range: ${result.latestRange}; previous validated range: ${result.previousRange}.`);
