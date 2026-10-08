export const shanghaiDate = date => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date)

export function collectActivity(log) {
  const days = new Map()
  let date = ''
  for (const line of log.split(/\r?\n/)) {
    if (line.startsWith('@@@')) date = shanghaiDate(new Date(line.slice(3)))
    else if (date && /^docs\/(notes|projects|troubleshooting)\/.+\.md$/.test(line) && !line.endsWith('/index.md')) {
      if (!days.has(date)) days.set(date, new Set())
      days.get(date).add(line)
    }
  }
  return Object.fromEntries([...days].sort(([a],[b]) => a.localeCompare(b)).map(([day, files]) => [day, files.size]))
}

export function calendarDays(today, counts) {
  const end = new Date(today + 'T00:00:00Z')
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 364)
  const cells = Array.from({ length: start.getUTCDay() }, () => null)
  for (let i = 0; i < 365; i++) {
    const day = new Date(start)
    day.setUTCDate(day.getUTCDate() + i)
    const date = day.toISOString().slice(0, 10)
    cells.push({ date, count: counts[date] || 0, month: day.getUTCMonth() + 1, day: day.getUTCDate() })
  }
  while (cells.length % 7) cells.push(null)
  return cells
}
