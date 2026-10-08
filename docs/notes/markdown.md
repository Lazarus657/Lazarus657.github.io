---
title: Markdown 入门
date: 2026-10-06 22:26:29
categories: [工具与写作]
tags: [Markdown, 写作]
description: 用标题、列表、链接和代码块，把学习过程整理成一篇清晰的笔记。
coverImg: /covers/writing.svg
---

# Markdown 入门

Markdown 用简单的文本标记表达文章结构。本篇是示例笔记，可以替换成自己的学习内容。

## 标题与段落

用 `#` 表示文章标题，`##` 表示章节，`###` 表示小节。段落之间空一行。

```md
# 我的第一篇笔记

今天学到了一个新概念。

## 我的理解

用自己的话解释它。
```

## 列表与链接

```md
- 学到的知识
- 想尝试的例子
- 还没解决的问题

[VitePress 文档](https://vitepress.dev/)
```

## 代码块

三个反引号包住代码，并标明语言，可以获得语法高亮。

```js
const notes = ['学习', '实践', '复盘']
notes.forEach(note => console.log(note))
```

## 提示块

::: tip 学习建议
先写清楚自己的理解，再补充引用和例子。
:::

## 小结

掌握标题、段落、列表、链接和代码块，就足以开始记录大部分学习内容。
