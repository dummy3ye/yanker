// Direct checks on the pure formatters in src/lib/format.ts.
// Run with: node --experimental-strip-types test/format.test.mjs
import assert from 'node:assert/strict'
import { formatBytes, formatEta, formatDuration, truncate } from '../src/lib/format.ts'

const cases = []
const t = (name, got, want) => cases.push([name, got, want])

// formatBytes: undefined/0/NaN render blank; 1024 is exactly one KiB.
t('formatBytes(undefined)', formatBytes(undefined), '')
t('formatBytes(0)', formatBytes(0), '')
t('formatBytes(NaN)', formatBytes(NaN), '')
t('formatBytes(1024)', formatBytes(1024), '1.0 KiB')
t('formatBytes(1536)', formatBytes(1536), '1.5 KiB')

// formatDuration rejects negatives but renders a genuine zero.
t('formatDuration(undefined)', formatDuration(undefined), '')
t('formatDuration(-1)', formatDuration(-1), '')
t('formatDuration(0)', formatDuration(0), '0:00')
t('formatDuration(65)', formatDuration(65), '1:05')
t('formatDuration(3661)', formatDuration(3661), '1:01:01')

// formatEta: 0 is a real eta, not a missing one.
t('formatEta(undefined)', formatEta(undefined), '')
t('formatEta(0)', formatEta(0), '0s')
t('formatEta(-5)', formatEta(-5), '')
t('formatEta(45)', formatEta(45), '45s')
t('formatEta(60)', formatEta(60), '1m 0s')
t('formatEta(90)', formatEta(90), '1m 30s')
t('formatEta(3599)', formatEta(3599), '59m 59s')
t('formatEta(3600)', formatEta(3600), '1h 0m')
t('formatEta(3660)', formatEta(3660), '1h 1m')

// truncate never exceeds the requested width.
t('truncate width 0', truncate('hello', 0), '')
t('truncate width 1', truncate('hello', 1), '…')
t('truncate width 3', truncate('hello', 3), 'he…')
t('truncate no-op', truncate('hi', 5), 'hi')

// Boundary cases: a size landing exactly on a 1024 boundary, and
// exactly one unit.
t('formatBytes(1023)', formatBytes(1023), '1023 B')
t('formatBytes(1024)', formatBytes(1024), '1.0 KiB')
t('formatBytes(1048576)', formatBytes(1048576), '1.0 MiB')


for (const [name, got, want] of cases) {
  try {
    assert.equal(got, want)
    console.log(`ok   ${name}: ${JSON.stringify(got)}`)
  } catch {
    failed++
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
  }
}
console.log(failed ? `\n${failed} failing` : `\nall ${cases.length} checks pass`)
process.exit(failed ? 1 : 0)
