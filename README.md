# dsh-local-api

给 DeepSeek Harness 侧栏加两个开关，用来管理本机的**独立 API 守护进程**：一个对应 GPT/Codex 风格的服务，一个对应 GLM/ZCode 风格的服务。每行都显示真实状态，可以一键启停，关掉 Harness 之后服务照常运行。

```
● GPT 本地 API
● GLM 本地 API
CHEN-SM
```

![侧栏底部两个开关](docs/preview.png)

两行都固定在侧栏底部、账户行（头像）上方。插件只管理进程生命周期：它不读取、不写入、也不显示你的 API Key，也不会改动任一服务自己的配置文件。

## 功能

| | |
| --- | --- |
| 实时状态 | 每 30 秒请求一次 `GET /healthz`（启停进行中改为 1 秒），并配合查询真实进程表。守护进程被外部杀掉后，下一次轮询就会把开关弹回「已停止」。 |
| 启动 | GLM：执行 `glm-api-server-via-zcode.exe start`。GPT：隐藏执行服务自带的 `Start-Server.ps1`（`-WindowStyle Hidden`），原样调用，代理、凭据、配置仍由脚本自己处理。 |
| 停止 | 只结束**可执行文件完整路径**与配置一致的那些进程，其他服务、代理程序与 Harness 本身都不受影响。 |
| 防重复启动 | 永不启动第二份：如果进程已经存在，就改为等待 `/healthz`，等不到则报 `unhealthy`，不会重复 spawn。 |
| 不弹窗 | 启动器以 `windowsHide` 方式运行，状态以 `/healthz` 为准，不依赖可见窗口。 |
| 退出 Harness | 卸载插件只注销本地 HTTP 路由，正在运行的服务不会被杀掉。 |
| 设置 | 每个服务的可执行文件/脚本路径与端口，可在侧栏面板里改，持久化到 `%USERPROFILE%\.dsh\dsh-local-api\settings.json`。 |
| 登录过期（GLM） | ZCode 凭据失效时，服务返回的 `401` / `login token rejected` 会显示成琥珀色的「登录过期」并给出重试提示，而不是笼统的报错。 |

插件加载时**不会**自动启动或停止任何服务，首次渲染只查询状态。

## 环境要求

- 支持第三方插件（Cordis bundle）的 DeepSeek Harness。
- Windows（进程发现用 CIM，GPT 的启动器是 PowerShell）。
- 两个服务各自另行安装。本仓库**不带**任何二进制、也不带服务配置，路径由使用者自己填。

## 安装

在本地检出后：

```powershell
# 指向本目录的绝对路径
plugin_manager install_bundle C:\path\to\dsh-local-api
```

安装后刷新一次 Harness 页面，然后在侧栏任一行打开面板填写路径：

| 设置项 | 含义 |
| --- | --- |
| `exePath` | GLM 服务可执行文件（`glm-api-server-via-zcode.exe`） |
| `port` | GLM 端口，默认 `18081` |
| `gptExePath` | GPT 服务可执行文件（`openai-api-server-via-codex.exe`） |
| `gptScriptPath` | 它的启动脚本（`Start-Server.ps1`） |
| `gptPort` | GPT 端口，默认 `18080`，需与该服务 `config.toml` 中的端口一致 |

这五个键同时也存在于插件配置（`cordis.patch.yml`）里，可以在安装时直接给出；面板里填的值优先，并保存在 `~/.dsh/dsh-local-api/` 下。

## 从插件市场安装

本仓库自带一份市场索引（`market/index.json`，`format: 1`），任何人都可以把它加进 DSH 的插件市场，然后像装其他插件一样点「安装」。

在 **插件 → 发现（Discover）→ 索引源 → 添加索引源**，填入：

```
https://t-choicy.github.io/dsh-local-api/market/index.json
```

（需要仓库先在 **Settings → Pages** 里开启 Pages：*Deploy from a branch* → `main` → `/ (root)`。不开 Pages 也可以用 raw 地址：`https://raw.githubusercontent.com/T-Choicy/dsh-local-api/main/market/index.json`，但部分网络环境直连 raw.githubusercontent.com 会被重置。）

索引里当前是 0.3.0，来源为**锁定了 commit 的 GitHub 仓库**（`source.type: git`），因此不依赖 npm 也能装：

```
git+https://github.com/T-Choicy/dsh-local-api.git#<commit>
```

如果之后把包发布到了 npm，只需把该条目 `versions` 里的 `source` 换成 `{ "type": "npm" }`（版本号同步提升），安装就会改走 registry；同一份索引可以同时保留两种来源的版本。索引文件的校验规则与 DSH 读取时完全一致（`@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex`），改完可以先本地校验再推送。

## 发布到 npm（可选）

包名 `dsh-local-api` 未占用，可直接发布：

```powershell
pnpm login                     # 或 npm login；会打开浏览器授权
pnpm publish --access public   # 之后每次先改 version 再发
```

发布后把 `market/index.json` 里对应版本的 `source` 改成 `{"type": "npm"}`，社区索引（如 awesome-dsh-plugin.com 那一份）如果收录了该包，也会自动出现，不必额外提交。

## 目录结构

```
dsh-local-api/
├─ package.json        # dsh.client（web）与 dsh.bundle（patch）
├─ cordis.patch.yml    # bundle 入口；路径默认全部留空
├─ lib/index.js        # Host 半：探活、启停、设置、同源路由
├─ lib/client.js       # Web 半：sidebar.footer.action 里的两个开关
├─ locale/{en,zh}.json # 插件列表里的元数据
├─ market/index.json   # 插件市场索引（format 1），可直接作为索引源
├─ docs/preview.png    # 侧栏底部的实际渲染
├─ icon.svg
├─ LICENSE
└─ README.md
```

## 实现说明

Host 半在 Harness 的 Web 服务上挂 `/api/dsh-local-api/*`，所有请求都必须带 `x-dsh-local-api: 1` 头，避免被跨站请求触发启停。所有进程操作都在 Host 进程里完成（`execFile` / `spawn`），渲染进程只发同源 `fetch`。

Web 半是一个普通的 `__ModuleLoader__` bundle，只注册**一个** `sidebar.footer.action` 条目，内部用 `flex-direction: column` 渲染两行——因为该槽位默认把条目横向排列，注册两项会左右并排而不是上下叠放。

## 注意事项

- 面板里显示的端口是插件用来探活的端口。改服务真实端口要改服务自己的配置（`config.toml` 或启动参数），两边保持一致。
- 停止使用 `Stop-Process -Force`，且只针对路径匹配到的进程。若服务以其他账户运行，需要给插件同等权限，或手动停止。
- 只在上面的两个服务上测试过；界面只使用 `--dsw-alias-*` 主题变量，因此跟随明暗主题。

## 许可证

MIT，见 [LICENSE](LICENSE)。
