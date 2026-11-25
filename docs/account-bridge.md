# 可选账户与钱包接口

配置 `STUDIO_PUBLIC_ORIGIN`、`STUDIO_SUB2_ORIGIN` 和 `STUDIO_SUB2_SECRET` 可接到账户站。账户站给浏览器和工作站的入口不同时，可另设 `STUDIO_SUB2_API_ORIGIN`。公开部署可选择同一主域下的 HTTPS 子域名，使内嵌页能读取工作站的会话。

## 登录接力

1. 工作站生成随机 `state`，和当前浏览器会话绑定。账户站入口为 `/image-studio?state=<state>`。注册时把该入口放入 `redirect` 参数，可加 `aff`。
2. 账户站根据登录态签发一次性 `code`。用 `#sub2=<code>.<state>` 返回独立站，工作台草稿回到 `/studio`。嵌入时工作站发 `sichen-studio:connect`，父窗口回复 `sichen-studio:ticket`。双方核对来源。
3. 工作站服务端交换票据，取得账户标识与工作站用途的会话凭证。

## 服务端接口

POST 到 `/api/v1/image-studio/<操作>`，携带 `Authorization: Bearer <共享密钥>`。兑换后提供 `X-Studio-Session`。响应采用 `{ code: 0, data: ... }`。

| 操作 | 请求 | 返回 |
| --- | --- | --- |
| `exchange` | `{ code, state }` | `{ id, credential, verifiedSignup, inviter? }`。ID 用十进制字符串。 |
| `wallet` | `{}` | `{ balance, packages, affCode? }`。余额单位为美元，套餐为 `{ id, images, cents }`。 |
| `purchase` | `{ id, package, images, cents }` | 原订单字段及 `account`。核对报价，扣减余额和保存回执在同一个事务完成。重试使用同一订单。 |
| `logout` | `{}` | `{}`。注销用途凭证。 |

错误的 `reason` 可以为 `STUDIO_SESSION_EXPIRED`、`STUDIO_TICKET_INVALID`、`STUDIO_BALANCE_LOW`、`STUDIO_QUOTE_CHANGED` 或 `STUDIO_ORDER_CONFLICT`。

工作站优先使用每日免费次数，注册与好友首图各赠 5 张，购买图张记到账户。账户站维护充值、真实邮箱验证码和邀请关系。
