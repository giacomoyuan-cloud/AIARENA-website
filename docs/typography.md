# 思源现代字体规范

所有自有网页界面和 Android 原生界面使用固定的思源现代体系：Inter + Noto Sans SC。标题、导航、用户及 AI 消息、模型菜单、表格、表单、弹窗、代码块和独立功能页遵循同一规范，不提供其他字体选项。保持原有字号、行高和布局。

| Before | After | Why |
| --- | --- | --- |
| 宋体标题与回复、系统界面字体、旧 Sora 和等宽字体 | 一个 Inter / Noto Sans SC 字体组合 | 对齐用户选定的思源现代方案 |
| 网页外部字体服务、原生默认字体 | 自托管网页 WOFF2 分片、原生随包字体 | 网页与 App 明确使用批准的字体资源 |

## 网页

`arena-fonts.css` 是唯一字体策略入口，三个发布页面全部引入。字体变量统一为 `--arena-ui-font`，全局覆盖动态生成的控件、Markdown 与伪元素。`assets/fonts/modern` 保存官方 Google Fonts 的 Unicode 分片、来源和 OFL 许可，构建时复制到发布目录。不再请求 Google Fonts 服务。

## Android

`NativeTypography` 统一 Material 3 全部 15 级文字样式。Android 10+ 使用 Inter 优先、Noto Sans SC 后备的原生字体链；Android 8/9 使用批准体系内的 Noto Sans SC 同时绘制中文、西文和数字，避免回到系统默认字体。`modern_font.xml` 指定常用字重及变量轴。Markdown 的 TextView、标题、行内代码和代码块显式使用同一字体。

字体资源来自 Google Fonts 官方 Inter / Noto Sans SC 原始变量 TTF；OFL 许可同时放入 App。系统文件选择器、键盘及原始 PDF/图片等内容由系统或原文件绘制，不修改原始资料。

## 验证

- 网页回归与 `arena-fonts.test.cjs`：三个入口、旧字体清理、分片文件及许可完整性。
- Android 单元测试、Release lint、Debug / Release 构建、签名及更新包元数据核对。
- `NativeTypographyRuntimeTest`：15 级主题字体、标题/正文/输入框、Markdown、代码块，以及 Android 实际文字渲染器选取的中西文字体文件 SHA-256 对照。
- 浏览器检查正式域名页面、菜单和功能区的计算字体与实际下载字体资源；响应式浏览器结果不等于所有真机验收。
