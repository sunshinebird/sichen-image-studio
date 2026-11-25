# 思辰生图工作站

面向中文创作者的开源图片工作站。从案例开始做同款，用文字生成图片并继续修改，再到画布里调尺寸、排版和导出。

- **浏览案例与做同款**。按用途和行业筛选中文案例。有参考图的案例会带入输入素材。
- **连续生图和改图**。选择画幅、上传参考图，用对话修改当前版本，可对比历史或指定修改区域。
- **编辑与导出**。在画布里操作文字、形状、图片和图层，支持对齐、裁切、调色和撤销。可编辑的演示模板还支持导出 PPTX。
- **独立运行**。Vue 3 前端、Node.js 服务和 SQLite 本地存储，支持 chatgpt2api 任务协议和兼容 Images API。账户与钱包可选。

## 直接体验

需要 Node.js 24 和 npm。克隆本项目后运行：

```sh
npm ci
npm run local:demo
```

用浏览器打开 `http://127.0.0.1:4175`。可以浏览中文案例、打开画布，或在工作台输入「示例生图」。演示使用内置素材，无需 API 密钥。

## 接入图像服务

```sh
cp .env.example .env
# 在 .env 中填写 STUDIO_PROVIDER_KEY 和服务地址
npm run local
```

chatgpt2api 默认连接 `http://127.0.0.1:3000`，使用 `gpt-image-2.6-sunburst`。工作站通过 `POST /api/image-tasks` 提交任务，再按同一个任务 ID 查询结果。也可将 `STUDIO_PROVIDER_MODE` 设为 `openai`，接入兼容 Images API 的自选服务，并配置它支持的模型。

默认游客每天免费 5 张，按北京时间刷新。画布预览与导出尺寸分别控制。部署与可选的智能编辑见 [运行文档](docs/deployment.md)。账户、邀请和购买见 [账户接口](docs/account-bridge.md)。

## 参与开发

欢迎提交 [Issue](../../issues/new/choose) 和 [Pull Request](../../pulls)。手机操作、无障碍体验、新案例、可编辑演示模板和上游适配都是适合参与的方向。

```sh
npm test
npm run build
```

提交方式见 [贡献指南](CONTRIBUTING.md)。代码与内置原创演示素材使用 [MIT 许可证](LICENSE)。第三方依赖沿用各自的许可。
