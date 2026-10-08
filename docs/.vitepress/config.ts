import { defineConfig } from 'vitepress'
import { defineTeekConfig } from 'vitepress-theme-teek/config'

const teek = defineTeekConfig({
  teekHome: true, vpHome: false, themeSize: 'large', pageStyle: 'card', windowTransition: false,
  author: { name: 'Lazarus657', link: 'https://github.com/Lazarus657' },
  banner: {
    bgStyle: 'pure', pureBgColor: '#143f3a',
    name: '学习手记', description: '把电路里的信号，变成脑海里的知识。', descStyle: 'default', titleFontSize: '3.6rem', descFontSize: '1.05rem',
    features: [
      { title: '学习笔记', details: '理解 · 整理 · 复习', link: '/notes/' },
      { title: '动手实践', details: '设计 · 测试 · 复盘', link: '/projects/' },
      { title: '问题记录', details: '发现 · 排查 · 解决', link: '/troubleshooting/' }
    ]
  },
  post: { postStyle: 'card', coverImgMode: 'full', showMore: true, moreLabel: '阅读笔记 →' },
  blogger: { name: 'Lazarus657', slogan: '在学习中理解，在实践中验证。', avatar: '/favicon.svg', shape: 'circle' },
  homeCardSort: ['category', 'tag'], topArticle: { enabled: false }, friendLink: { enabled: false },
  docAnalysis: { enabled: false },
  themeEnhance: { enabled: true, position: 'top' },
  footerInfo: { topMessage: '记录今天理解的东西，也留住还没想明白的问题。', copyright: { name: 'Lazarus657', link: 'https://github.com/Lazarus657', createYear: 2026 }, theme: { show: true } },
  vitePlugins: { sidebar: false, permalink: false, mdH1: false, autoFrontmatter: false }
})

export default defineConfig({
  extends: teek,
  ignoreDeadLinks: false,
  lang: 'zh-CN',
  title: '学习手记',
  description: '记录学习、实践与思考，让知识慢慢生长。',
  base: process.env.VITEPRESS_BASE || '/',
  lastUpdated: true,
  head: [['link', { rel: 'icon', href: `${process.env.VITEPRESS_BASE || '/'}favicon.svg` }]],
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: '首页', link: '/' },
      { text: '笔记', link: '/notes/' },
      { text: '实践', link: '/projects/' },
      { text: '问题记录', link: '/troubleshooting/' },
      { text: '关于', link: '/about' }
    ],
    sidebar: [
      { text: '从这里开始', items: [{ text: '欢迎', link: '/' }, { text: '如何写笔记', link: '/guide/writing' }] },
      { text: '学习笔记', collapsed: false, items: [{ text: '笔记索引', link: '/notes/' }, { text: '秋招硬件面试笔记', link: '/notes/hardware-interview' }, { text: 'Markdown 入门', link: '/notes/markdown' }] },
      { text: '动手实践', items: [{ text: '项目记录', link: '/projects/' }] },
      { text: '解决问题', items: [{ text: '问题记录', link: '/troubleshooting/' }] },
      { text: '关于本站', items: [{ text: '关于', link: '/about' }] }
    ],
    search: {
      provider: 'local',
      options: { locales: { root: { translations: {
        button: { buttonText: '搜索笔记', buttonAriaLabel: '搜索笔记' },
        modal: { noResultsText: '没有找到相关笔记', resetButtonTitle: '清除搜索', footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' } }
      } } } }
    },
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新' },
    darkModeSwitchLabel: '外观',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '返回顶部'
  }
})
