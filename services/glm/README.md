# GLM API Server via ZCode

💰 你的智谱 GLM 编程会员（BigModel Individual Coding Plan）已经包含在 ZCode
登录里，但这个后端通常只对 ZCode 客户端开放。本项目在它前面放了一个
**OpenAI 兼容 + Anthropic 兼容**的本地 API 服务，其它工具只需改一个环境
变量，就能在会员额度内调用 GLM 模型 —— 无需单独的 API Key，没有额外的
按 token 计费。

设计上对标 `openai-api-server-via-codex`：同一个思路，把 Codex 换成 ZCode，
把 ChatGPT 会员换成 GLM 编程会员。

## 工作原理

```
任意 OpenAI / Anthropic 客户端
        │  http://127.0.0.1:18081/v1
        ▼
glm-api-server-via-zcode (Go, 单文件, ~7 MB)
        │  1. 解密 ~/.zcode/v2/credentials.json (AES-256-GCM,
        │     密钥由系统信息派生, 与 ZCode 桌面端一致)
        │  2. 用登录令牌向 bigmodel.cn 换取 ~5 小时的编程会员
        │     短期 accessToken (ZCode 内部同款流程, 自动续期)
        │  3. 注入 Authorization 头并转发请求
        ▼
https://open.bigmodel.cn/api/coding/paas/v4/...   (OpenAI 协议)
https://open.bigmodel.cn/api/anthropic/v1/...     (Anthropic 协议)
```

由于上游本身就讲这两种协议，本服务是**透明鉴权代理**而不是协议转换器，
因此对客户端高度兼容（流式、工具调用、思考内容等原样透传）。

## 快速开始

前提：已在 ZCode 桌面端登录（存在 `~/.zcode/v2/credentials.json`）。

```powershell
# 方式一：前台运行
.\glm-api-server-via-zcode.exe serve

# 方式二：后台守护进程
.\glm-api-server-via-zcode.exe start
.\glm-api-server-via-zcode.exe status
.\glm-api-server-via-zcode.exe stop

# 或直接双击运行 Start-Server.ps1（隐藏窗口启动并等待健康检查通过）
```

然后让任意 OpenAI 客户端指向本地服务：

```console
$ export OPENAI_BASE_URL=http://127.0.0.1:18081/v1
$ # 本服务默认不校验 key，但 OpenAI SDK 要求非空，随便填一个即可
$ export OPENAI_API_KEY=dummy-not-a-real-key
```

```python
from openai import OpenAI

client = OpenAI()
chat = client.chat.completions.create(
    model="glm-5.3",            # 大小写不敏感，可省略（默认 GLM-5.3）
    messages=[{"role": "user", "content": "你好"}],
)
print(chat.choices[0].message.content)
```

Claude Code 等 Anthropic 协议客户端：

```console
$ export ANTHROPIC_BASE_URL=http://127.0.0.1:18081
$ export ANTHROPIC_AUTH_TOKEN=dummy-not-a-real-key
```

```python
import anthropic

client = anthropic.Anthropic()
msg = client.messages.create(
    model="glm-5.3",
    max_tokens=256,
    messages=[{"role": "user", "content": "你好"}],
)
print(msg.content[0].text)
```

## 实现的端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/healthz` | 健康检查（含令牌到期时间） |
| `GET` | `/v1/models` | GLM 模型目录 |
| `POST` | `/v1/chat/completions` | OpenAI Chat（支持流式） |
| `POST` | `/v1/messages` | Anthropic Messages（支持流式） |
| `POST` | `/v1/messages/count_tokens` | Anthropic token 计数透传 |
| 任意 | `/v1/...` | 未知名路径尽力透传到 OpenAI 兼容基址 |

## 命令与配置

```console
$ glm-api-server-via-zcode serve --port 19090 --verbose
$ glm-api-server-via-zcode start --api-key local-secret
$ glm-api-server-via-zcode login-status      # 校验登录与令牌链
$ glm-api-server-via-zcode config-generate   # 生成配置文件模板
```

配置解析顺序（与 codex 版一致）：

```text
CLI 参数 -> 环境变量 (GLM_VIA_ZCODE_*) -> 配置文件 -> 默认值
```

配置文件默认路径：`~/.config/glm-api-server-via-zcode/config.toml`

```toml
[server]
host = "127.0.0.1"
port = 18081
default_model = "GLM-5.3"
timeout = 300.0
verbose = false
max_concurrent_requests = 10
# api_key = "change-me"        # 保护本地 /v1 接口（可选）

[zcode]
credentials = "~/.zcode/v2/credentials.json"
# credential_secret = ""       # 仅当 ZCode 以 ZCODE_CREDENTIAL_SECRET 启动时需要

[upstream]
openai_base_url = "https://open.bigmodel.cn/api/coding/paas/v4"
anthropic_base_url = "https://open.bigmodel.cn/api/anthropic"
exchange_base_url = "https://bigmodel.cn"

[daemon]
state_dir = "~/.config/glm-api-server-via-zcode/run"
```

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `server.host` | `127.0.0.1` | HTTP 绑定地址 |
| `server.port` | `18081` | HTTP 端口 |
| `server.default_model` | `GLM-5.3` | 请求未指定模型时使用 |
| `server.api_key` | 空 | 校验进入 `/v1` 的请求 key |
| `server.max_concurrent_requests` | `10` | 并发上限，满时返回 503+Retry-After；`0` 不限制 |
| `server.timeout` | `300` | 上游超时秒数 |
| `zcode.credentials` | `~/.zcode/v2/credentials.json` | ZCode 凭据文件 |

## 令牌与安全

- **两层鉴权**：本服务 → 智谱后端（登录令牌换短期 accessToken）；
  客户端 → 本服务（默认无鉴权，可用 `--api-key` 开启）。
- accessToken 有效期约 5 小时，服务在 **90% TTL 时自动续期**，无需人工干预。
- 上游返回 `401` 时自动刷新令牌并重试一次；`~/.zcode/v2/credentials.json`
  在 ZCode 里重新登录后，服务会检测文件变化并自动热加载。
- 客户端发来的 `Authorization` / `x-api-key` **不会**转发给上游。
- 日志不记录任何令牌明文；令牌类字段自动脱敏。
- 若没有现成的 `project-key-location`，服务会像 ZCode 一样自动查找或创建
  名为 `zcode-api-key` 的项目密钥（只在智谱业务 API 层面操作，不影响你
  已有的 Key）。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| `credential error: ... not found` | 先在 ZCode 桌面端完成登录 |
| `login token rejected (401)` | ZCode 里退出并重新登录，服务会自动重载凭据 |
| `token exchange failed` / 网络错误 | 检查能否访问 `bigmodel.cn` / `open.bigmodel.cn`（必要时设 `HTTPS_PROXY`） |
| 端口占用 | `--port` 换端口，或 `stop` 停掉已有实例 |
| 官方 SDK 要求 `OPENAI_API_KEY` | 填任意非空占位值如 `dummy-not-a-real-key` |

## 与会员额度的关系

请求计入你的 GLM 编程会员额度（与 ZCode 桌面端共享同一额度池），
本服务**不会**提升或绕过任何额度限制。请仅在自己有权使用的账号上使用，
不要对外暴露服务或转售访问。上游接口属非公开约定，可能随时变动。

## 构建

```console
$ go build -trimpath -ldflags "-s -w" -o glm-api-server-via-zcode.exe .
$ go test ./...
```

纯 Go 标准库，零第三方依赖。版本：0.1.0。

## License

MIT
