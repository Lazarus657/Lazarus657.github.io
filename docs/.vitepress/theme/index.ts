import Teek from 'vitepress-theme-teek'
import 'vitepress-theme-teek/index.css'
import { h } from 'vue'
import ActivityCalendar from './components/ActivityCalendar.vue'
import './style.css'
export default {
  extends: Teek,
  Layout: () => h(Teek.Layout, null, { 'teek-home-post-before': () => h(ActivityCalendar) })
}
