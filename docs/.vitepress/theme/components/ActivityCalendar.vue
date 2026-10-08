<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useData } from 'vitepress'
import activity from '../../data/activity.json'
import { calendarDays, shanghaiDate } from '../../../../scripts/activity.mjs'
const today = ref(activity.today)
const { frontmatter } = useData()
const selected = ref('')
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  today.value = shanghaiDate(new Date())
  timer = setInterval(() => { today.value = shanghaiDate(new Date()) }, 60_000)
})
onUnmounted(() => clearInterval(timer))
const cells = computed(() => calendarDays(today.value, activity.counts))
const total = computed(() => cells.value.reduce((n, d) => n + (d?.count || 0), 0))
const activeDays = computed(() => cells.value.filter(d => d?.count > 0).length)
const describe = (d: { date: string, count: number }) => `${d.date} · ${d.count ? `更新 ${d.count} 篇笔记` : '暂无笔记更新'}`
const months = computed(() => {
  const result: { name: string, column: number }[] = []
  for (let i = 0; i < cells.value.length; i += 7) {
    const week = cells.value.slice(i, i + 7).filter(Boolean)
    const first = week.find(d => d.day === 1)
    if (first || i === 0) result.push({ name: `${(first || week[0]).month}月`, column: i / 7 + 1 })
  }
  return result
})
</script>
<template>
  <section v-if="!frontmatter.categoriesPage && !frontmatter.tagsPage" class="activity-card" aria-labelledby="activity-title">
    <div class="activity-heading">
      <div><span class="eyebrow">A LITTLE, EVERY DAY</span><h2 id="activity-title">学习的足迹<span class="live-dot" /></h2></div>
      <div class="activity-summary"><strong>{{ total }}</strong> 次笔记更新<span>过去一年 · {{ activeDays }} 个活跃日</span></div>
    </div>
    <div class="calendar-scroll" tabindex="0" aria-label="过去一年的每日笔记更新，窄屏可横向滚动">
      <div class="calendar-months" :style="{ gridTemplateColumns: `repeat(${cells.length / 7}, 12px)` }"><span v-for="m in months" :key="m.column" :style="{ gridColumn: m.column }">{{ m.name }}</span></div>
      <div class="calendar-grid">
        <template v-for="(d, i) in cells" :key="d?.date || i">
          <button v-if="d" :class="['calendar-cell', `level-${Math.min(d.count, 4)}`]" :title="describe(d)" :aria-label="describe(d)" @mouseenter="selected = describe(d)" @focus="selected = describe(d)" @click="selected = describe(d)" />
          <span v-else class="calendar-cell empty" />
        </template>
      </div>
    </div>
    <div class="calendar-footer"><span class="calendar-selected" aria-live="polite">{{ selected || '每一格，都是积累的一天。' }}</span><div class="calendar-legend">少<span v-for="n in 5" :key="n" :class="['calendar-cell', `level-${n - 1}`]" />多</div></div>
    <p class="calendar-note">按北京时间统计笔记的 Git 提交；同一天同一篇只计一次。每天自动刷新。</p>
  </section>
</template>
