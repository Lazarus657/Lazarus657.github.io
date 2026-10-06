import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: '学习手记',
  description: '记录学习、实践与思考，让知识慢慢生长。',
  base: process.env.VITEPRESS_BASE || '/',
  lastUpdated: true,
  head: [['link', { rel: 'icon', href: `${process.env.VITEPRESS_BASE || '/'}favicon.svg` }]],
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
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
    returnToTopLabel: '返回顶部',
    footer: { message: '记录今天理解的东西，也留住还没想明白的问题。' }
  }
})
