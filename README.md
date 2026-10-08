# 学习手记

基于 VitePress 与 Teek 的中文个人学习笔记站，包含文章卡片、分类标签与每日更新点格图。

## 每日更新图

首页展示最近 365 天的笔记更新。数据来自 Git 历史中的 `docs/notes`、`docs/projects`、`docs/troubleshooting` 的 Markdown 新增和修改，不统计 `index.md` 和主题配置；同一天同一篇笔记只计一次。日期按北京时间计算。构建需要完整 Git 历史。

提交后自动更新；GitHub Actions 每天北京时间 00:15 计划重新部署，实际运行时间可能延后。

## 主题 DIY

`docs/.vitepress/config.ts` 的 Teek 配置可以调整首页 Banner、博主信息、文章卡片和阅读布局。`docs/.vitepress/theme/style.css` 控制配色和点格图外观。

文章可在开头添加 `title`、`date`、`categories`、`tags`、`description`、`coverImg`，用于首页卡片和分类。封面放在 `docs/public/covers`。

## 本地运行

安装 Node.js 22 或更高版本，并安装 pnpm 10。

```sh
pnpm install
pnpm docs:dev
```

## 构建和预览

```sh
pnpm docs:build
pnpm docs:preview
```

文章位于 `docs/`，导航目录配置位于 `docs/.vitepress/config.ts`。

## GitHub Pages

推送到 GitHub 仓库的 `main` 分支。在仓库 Settings → Pages 中将 Source 设为 GitHub Actions。

部署流程会自动根据仓库名设置路径，支持 `用户名.github.io` 和普通项目仓库。

默认发布的是公开网站，请只提交希望公开的笔记。自定义域名部署到根目录时，将工作流中的 VITEPRESS_BASE 固定为 `/`。
