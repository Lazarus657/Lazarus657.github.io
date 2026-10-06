# 学习手记

基于 VitePress 的中文个人学习笔记站。

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
