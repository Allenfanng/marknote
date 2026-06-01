# MarkNote

类 Typora 的所见即所得 Markdown 桌面编辑器。

![MarkNote](src-tauri/icons/128x128.png)

## 特性

- **WYSIWYG 编辑** — Milkdown Crepe 驱动的富文本 Markdown 编辑
- **源码模式** — `Ctrl+/` 一键切换，textarea 全页编辑原始 Markdown
- **顶部工具栏** — 文件操作、格式化、标题、列表、代码块、引用、链接、图片
- **文件拖拽** — 从资源管理器拖入 `.md` 文件，在新窗口打开
- **多窗口** — 支持同时编辑多个文件，独立窗口
- **主题切换** — 日间/夜间模式，Notion/Linear 风格中性配色
- **表格支持** — 清晰的单元格边框和表头底色
- **原生对话框** — 系统文件选择器，无缝融入操作系统
- **快捷键** — Ctrl+S 保存、Ctrl+O 打开、Ctrl+N 新建、Ctrl+/ 源码切换

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri v2 |
| 后端 | Rust |
| 前端 | React 19 + TypeScript |
| 编辑器 | Milkdown Crepe (ProseMirror) |
| 图标 | lucide-react |
| 构建 | Vite 8 |

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run tauri:dev

# 构建安装包
npm run tauri:build
```

## 系统要求

- Windows 10/11（x64）

## 版本历史

### v1.1.0（2026-06-01）

- 修复主题切换（编辑区跟随亮/暗模式）
- 新增顶部工具栏（Lucide 图标 + 激活态高亮）
- 新增源码模式（`Ctrl+/` 切换）
- 新增文件拖拽（新窗口打开）
- 新增关于对话框
- 表格单元格边框优化
- 中文字体优化（标题使用霞鹜文楷/微软雅黑 UI）
- UI 重构（Notion/Linear 风格）
- 新应用图标

### v1.0.0

- WYSIWYG Markdown 编辑
- 文件打开/保存
- 亮色/暗色主题
- 键盘快捷键
- 未保存修改提示
- Windows 安装包

## 作者

FZ
