import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calendarDays, collectActivity, shanghaiDate } from './activity.mjs'

test('counts unique notes per Shanghai day, excluding index and configuration changes', () => {
  const log = '@@@2026-10-07T17:00:00Z\ndocs/notes/a.md\ndocs/notes/index.md\n@@@2026-10-08T03:00:00Z\ndocs/notes/a.md\ndocs/projects/demo.md\ndocs/.vitepress/config.ts\n@@@2026-10-07T12:00:00Z\ndocs/notes/b.md'
  assert.deepEqual(collectActivity(log), { '2026-10-07': 1, '2026-10-08': 2 })
  assert.equal(shanghaiDate(new Date('2026-10-07T16:00:00Z')), '2026-10-08')
})
test('calendar includes 365 days across leap years, pads full weeks and never includes future dates', () => {
  for (const today of ['2026-10-08', '2024-03-01', '2025-01-01']) {
    const cells = calendarDays(today, { [today]: 3 })
    assert.equal(cells.length % 7, 0)
    const real = cells.filter(Boolean)
    assert.equal(real.length, 365)
    assert.equal(new Set(real.map(d => d.date)).size, 365)
    assert.equal(real.at(-1).date, today)
    assert.equal(real.at(-1).count, 3)
    assert.ok(real.every(d => d.date <= today))
  }
})
