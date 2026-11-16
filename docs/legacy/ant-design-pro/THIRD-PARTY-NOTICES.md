# 第三方授权声明（Third-Party Notices）

本仓库在「任务管理 · 甘特视图」功能中引入了下列第三方依赖。本文件按各依赖的许可要求
保留其版权声明与许可文本。

---

## dhtmlx-gantt

- **组件名称**：DHTMLX Gantt（Community Edition，开源社区版）
- **npm 包名**：`dhtmlx-gantt`
- **版本**：v10.0.3（仓库 `package.json` 中声明为 `^10.0.3`，实际安装版本见
  `node_modules/dhtmlx-gantt/package.json`）
- **许可**：MIT
- **版权声明**：Copyright (c) 2026 XB Software
- **作者**：XB Software
- **项目主页**：https://dhtmlx.com/docs/products/dhtmlxGantt/
- **源码仓库**：https://github.com/DHTMLX/gantt.git
- **在本仓的用途**：作为「任务管理 · 甘特视图」页面（`/pm/task/gantt`）的时间轴本体，
  负责甘特图表格区、刻度时间轴、条形渲染与拖拽交互。
- **许可全文出处**：`node_modules/dhtmlx-gantt/LICENSE.md`
  （以下为该文件全文抄录）

### MIT License (MIT)

Copyright (c) 2026 XB Software

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### 附：随包分发的样式表所引用的网络字体

`node_modules/dhtmlx-gantt/codebase/dhtmlxgantt.css` 中通过 `@font-face` 引用了
**Inter** 字体（地址 `fonts.gstatic.com`），Inter 以 SIL Open Font License 1.1 发布，
由 Google Fonts 提供，**未随本 npm 包一同分发**。此引用为上游包自带，本仓未做改动。

---

## 说明

- 本文件所列事实均核对自 `node_modules/dhtmlx-gantt/package.json` 与
  `node_modules/dhtmlx-gantt/LICENSE.md`。
- MIT 许可要求「在所有副本或实质性部分中包含上述版权声明与许可声明」，本文件即为
  该声明的载体，随仓库分发。
