# dsh-local-api

Two switches in the DeepSeek Harness sidebar for **standalone local API daemons** — one for a GPT/Codex-style server, one for a GLM/ZCode-style server. Each switch reports live status, starts and stops its daemon, and keeps working after you close Harness.

```
● GPT 本地 API
● GLM 本地 API
CHEN-SM
```

![Two switches in the sidebar footer](docs/preview.png)

Both rows sit in the sidebar footer, just above the account row. The plugin only manages process lifecycles: it never reads, writes or displays your API keys, and it never touches either service's config file.

## Features

| | |
| --- | --- |
| Live status | Polls `GET /healthz` every 30 s (1 s while a start/stop is in flight) and re-reads the real process table. A killed daemon flips the switch back to stopped on the next poll. |
| Start | GLM: runs `glm-api-server-via-zcode.exe start`. GPT: runs the service's own `Start-Server.ps1` hidden (`-WindowStyle Hidden`), exactly as shipped, so proxy/credential/config handling stays in the script. |
| Stop | Kills only processes whose **full executable path** matches the configured path. Other services, the proxy, and Harness itself are untouched. |
| Duplicate starts | A switch never launches a second copy: if the process is already alive it waits for `/healthz`, and reports `unhealthy` instead of spawning again. |
| No console window | Launchers run with `windowsHide`, and status is confirmed through `/healthz` rather than a visible window. |
| Harness shutdown | Unloading the plugin disposes the HTTP route only — running daemons keep running. |
| Settings | Per-service executable/script path and port, editable from the row's panel and persisted to `%USERPROFILE%\.dsh\dsh-local-api\settings.json`. |
| Login expiry (GLM) | A `401` / `login token rejected` from the ZCode-backed server surfaces as an amber "login expired" state with a retry hint instead of a generic error. |

Nothing starts automatically when the plugin loads: the first paint only queries state.

## Requirements

- DeepSeek Harness with third-party plugin support (Cordis bundles).
- Windows (process discovery uses CIM; the GPT launcher is PowerShell).
- The two services installed separately. This repository ships **no** binaries and no service configuration; paths are yours to set.

## Install

From a checkout:

```powershell
# absolute path to this folder
plugin_manager install_bundle C:\path\to\dsh-local-api
```

Refresh the Harness page once after installing, then fill in the paths in the row panel:

| Setting | Meaning |
| --- | --- |
| `exePath` | GLM server executable (`glm-api-server-via-zcode.exe`) |
| `port` | GLM port, default `18081` |
| `gptExePath` | GPT server executable (`openai-api-server-via-codex.exe`) |
| `gptScriptPath` | Its launcher script (`Start-Server.ps1`) |
| `gptPort` | GPT port, default `18080` (must match that service's `config.toml`) |

The same five keys exist in the plugin config (`cordis.patch.yml`), so they can also be supplied at install time; values entered in the panel win and are stored under `~/.dsh/dsh-local-api/`.

## Package layout

```
dsh-local-api/
├─ package.json        # dsh.client (web) + dsh.bundle (patch)
├─ cordis.patch.yml    # bundle entry; all paths empty by default
├─ lib/index.js        # host half: probe, start, stop, settings, same-origin route
├─ lib/client.js       # web half: two switches in sidebar.footer.action
├─ locale/{en,zh}.json # plugin list metadata
├─ docs/preview.png    # the sidebar footer, as rendered
├─ icon.svg
├─ LICENSE
└─ README.md
```

The host half serves `/api/dsh-local-api/*` on the Harness web server, guarded by an `x-dsh-local-api` header so the mutation endpoints are not reachable cross-origin. The client half is a plain `__ModuleLoader__` bundle and renders both rows inside a single footer cell (`flex-direction: column`), because that slot lays its entries out horizontally.

## Notes

- Ports shown in the panel are the ports the plugin probes. Changing a daemon's real port is a service-side setting (`config.toml` / CLI flag); keep the two in sync.
- Stop uses `Stop-Process -Force` after path matching. If you run a service under another account, grant the plugin the same rights or stop it yourself.
- Tested on Windows with the two servers above; the UI intentionally uses only `--dsw-alias-*` theme tokens, so it follows light/dark themes.

## License

MIT — see [LICENSE](LICENSE).
