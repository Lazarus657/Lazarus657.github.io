import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { collectActivity, shanghaiDate } from './activity.mjs'

if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true') {
  throw new Error('Activity calendar requires full git history. Run git fetch --unshallow first.')
}
const log = execFileSync('git', ['-c', 'core.quotepath=false', 'log', '--format=@@@%cI', '--name-only', '--diff-filter=AM', '--', 'docs/notes', 'docs/projects', 'docs/troubleshooting'], { encoding: 'utf8' })
const counts = collectActivity(log)
mkdirSync('docs/.vitepress/data', { recursive: true })
writeFileSync('docs/.vitepress/data/activity.json', JSON.stringify({ today: shanghaiDate(new Date()), timezone: 'Asia/Shanghai', counts }, null, 2) + '\n')
console.log(`Activity calendar: ${Object.keys(counts).length} days with note updates`)
