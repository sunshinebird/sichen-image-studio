# 运行与部署

执行 `npm ci` 和 `npm run build`，用 `npm start` 启动。配置写入 `.env` 或进程的环境变量。

| 变量 | 用途 |
| --- | --- |
| `STUDIO_BIND` / `STUDIO_PORT` | 默认监听 `127.0.0.1:4175`。公开访问通过 HTTPS 反向代理。 |
| `STUDIO_DATA_DIR` | 保存 SQLite、生成结果和上传素材。部署时挂载持久目录。 |
| `STUDIO_CASES_DIR` | 可选的运营案例目录。 |
| `STUDIO_PROVIDER_MODE` | `chatgpt2api`、`openai` 或本地 `demo`。 |
| `STUDIO_PROVIDER_URL` / `STUDIO_PROVIDER_KEY` | 图像服务地址与服务端密钥。 |
| `STUDIO_IMAGE_MODEL` | 图像服务提供的模型 ID。 |
| `STUDIO_GUEST_DAILY` / `STUDIO_GLOBAL_DAILY` | 每日访客及全站免费图张上限。 |
| `STUDIO_GUEST_IP_DAILY` | 一个来源地址共用的免费次数上限。 |
| `STUDIO_GITHUB_URL` | 开源共建入口使用的公开 GitHub 仓库。留空时隐藏入口。使用自己的仓库时，启用 Issues 并保留贡献指南和 Issue 模板。 |

HTTPS 代理后可设 `STUDIO_SECURE_COOKIE=1`。若开启 `STUDIO_TRUST_LOOPBACK_PROXY=1`，反向代理须覆盖客户端同名头部，再写入可信的 `X-Real-IP`。一个数据目录由一个工作站进程使用。

可通过私网或受控隧道连接电脑上的上游。浏览器访问工作站的同源 API，服务端负责连接图像服务。页面按视窗选择预览图，详情与导出可用原图。

## 增加案例

参考 `content/gallery-cases.json`。把图片放在运营目录的 `art/<id>.webp`，改图前素材放在 `refs/<id>.webp`。运行 `npm run cases:publish -- <清单路径>`。默认运营目录是 `.runtime/studio/catalog`。更新图片时使用新的案例 ID。

## 可选智能编辑

执行 `npm run editor:setup` 下载文字识别和分割模型。可用 `STUDIO_EDIT_PYTHON` 和 `STUDIO_EDIT_MODELS` 指向自己的 Python 环境和模型目录。
