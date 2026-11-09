/**
 * Local API switches — Host half.
 *
 * Owns the lifecycle of two independent local API daemons:
 *  - GLM  : `glm-api-server-via-zcode.exe` (start/stop/status CLI), port 18081
 *  - GPT  : `openai-api-server-via-codex.exe` (hidden launch through Start-Server.ps1), port 18080
 *
 * The Client half renders two sidebar switches and reaches this half through the
 * same-origin JSON route registered below.
 *
 * Invariants:
 *  - Both daemons are independent of Harness: disposing this plugin (including
 *    quitting Harness) only removes the route, it never stops a service.
 *  - Every process spawn happens here, in the main process, never in the page.
 *  - The service is the source of truth: running/stopped comes from GET /healthz
 *    plus the real process table, never from a remembered value.
 *  - Stopping the GPT service only kills processes whose full executable path is
 *    exactly the configured one: GLM, Harness and the 7890 proxy are never touched.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { connect } from 'node:net'
import { basename, dirname, join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-local-api'

const GLM_PORT = 18081
const GPT_PORT = 18080

export const Config = Schema.object({
  exePath: Schema.string().default('').description('GLM 本地 API：glm-api-server-via-zcode.exe 的绝对路径（也可在侧栏设置里填）'),
  port: Schema.natural().min(1).max(65535).default(GLM_PORT).description('GLM 本地 API 端口（healthz 与 OpenAI 兼容端点共用）'),
  gptExePath: Schema.string().default('').description('GPT 本地 API：openai-api-server-via-codex.exe 的绝对路径（也可在侧栏设置里填）'),
  gptScriptPath: Schema.string().default('').description('GPT 本地 API：Start-Server.ps1 的绝对路径，启动时隐藏调用'),
  gptPort: Schema.natural().min(1).max(65535).default(GPT_PORT).description('GPT 本地 API 端口（需与服务 config.toml 一致）'),
})

/** Same-origin JSON route prefix used by the Client half. */
const ROUTE = '/api/dsh-local-api'
/** Required header: keeps the mutation surface unreachable from a foreign origin. */
const GUARD_HEADER = 'x-dsh-local-api'
const START_TIMEOUT_MS = 30_000
const SCRIPT_TIMEOUT_MS = 60_000
const STOP_TIMEOUT_MS = 20_000
const PROBE_TIMEOUT_MS = 2_500
const PROBE_POLL_MS = 700
const STATE_CACHE_MS = 1_000
const POWERSHELL = 'powershell.exe'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function dshHome () {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** One settings file for both services: { glm: {...}, gpt: {...} } */
function settingsFile () {
  return join(dshHome(), 'dsh-local-api', 'settings.json')
}

/** Earlier versions wrote settings elsewhere; migrate whichever exists. */
function legacySettingsFiles () {
  return [
    join(dshHome(), 'local-api-switch', 'settings.json'),
    join(dshHome(), 'glm-local-api', 'settings.json'),
  ]
}

function readJson (file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeJson (file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function readOverrides () {
  const stored = readJson(settingsFile())
  const hasStored = Object.keys(stored).length > 0
  const overrides = {
    glm: stored.glm && typeof stored.glm === 'object' ? { ...stored.glm } : {},
    gpt: stored.gpt && typeof stored.gpt === 'object' ? { ...stored.gpt } : {},
  }
  if (!hasStored) {
    for (const file of legacySettingsFiles()) {
      const legacy = readJson(file)
      const migrated = {}
      if (typeof legacy.exePath === 'string' && legacy.exePath.trim()) migrated.exePath = legacy.exePath.trim()
      if (legacy.port !== undefined && legacy.port !== null && legacy.port !== '') migrated.port = Number(legacy.port)
      if (Object.keys(migrated).length > 0) {
        overrides.glm = migrated
        break
      }
    }
  }
  return overrides
}

function writeOverrides (overrides) {
  const clean = { glm: { ...overrides.glm }, gpt: { ...overrides.gpt } }
  for (const key of Object.keys(clean.glm)) {
    const value = clean.glm[key]
    if (value === undefined || value === null || value === '') delete clean.glm[key]
  }
  for (const key of Object.keys(clean.gpt)) {
    const value = clean.gpt[key]
    if (value === undefined || value === null || value === '') delete clean.gpt[key]
  }
  writeJson(settingsFile(), clean)
}

function normalizePath (value) {
  let text = String(value ?? '').trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).trim()
  return text
}

function samePath (left, right) {
  const a = normalizePath(left).replace(/\//g, '\\').toLowerCase()
  const b = normalizePath(right).replace(/\//g, '\\').toLowerCase()
  return a.length > 0 && a === b
}

function normalizePort (value, fallback) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback
  return port
}

function firstLine (text, limit = 400) {
  const line = String(text ?? '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  return line ? line.slice(0, limit) : ''
}

function tail (text, limit = 1_200) {
  const value = String(text ?? '').trim()
  return value.length > limit ? value.slice(value.length - limit) : value
}

/** Run a program without a shell, so Windows paths with spaces need no quoting. */
function run (file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: options.timeout ?? SCRIPT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        cwd: options.cwd,
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? '')
        const err = String(stderr ?? '')
        resolve({
          ok: !error,
          code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
          missing: Boolean(error && error.code === 'ENOENT'),
          timedOut: Boolean(error && error.killed),
          stdout: out,
          stderr: err,
          text: `${out}${out && err ? '\n' : ''}${err}`,
        })
      },
    )
  })
}

/**
 * Run a launcher script and stop waiting the moment the script itself exits.
 * The daemon it starts inherits our stdout/stderr handles on Windows, so waiting
 * for the pipes to close would block until that daemon ends. We resolve on
 * 'exit', keep whatever the script printed, then drop the pipes.
 */
function runLauncher (file, args, options = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(file, args, { windowsHide: true, cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ ok: false, missing: Boolean(error && error.code === 'ENOENT'), code: 1, text: String(error && error.message) })
      return
    }
    let out = ''
    let err = ''
    let finished = false
    let timer
    const finish = (payload) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try { if (child.stdout) child.stdout.destroy() } catch {}
      try { if (child.stderr) child.stderr.destroy() } catch {}
      resolve(payload)
    }
    timer = setTimeout(() => {
      try { child.kill() } catch {}
      finish({ ok: false, timedOut: true, code: null, text: `${out}${err}`.trim() })
    }, options.timeout ?? SCRIPT_TIMEOUT_MS)
    if (child.stdout) child.stdout.on('data', (chunk) => { if (out.length < 262144) out += String(chunk) })
    if (child.stderr) child.stderr.on('data', (chunk) => { if (err.length < 262144) err += String(chunk) })
    child.on('error', (error) => {
      finish({ ok: false, missing: Boolean(error && error.code === 'ENOENT'), code: 1, text: String(error && error.message) })
    })
    child.on('exit', (code) => {
      setTimeout(() => finish({ ok: code === 0, code, text: `${out}${out && err ? '\n' : ''}${err}`.trim() }), 200)
    })
  })
}

/** True when something (any program) already listens on 127.0.0.1:<port>. */
function portBusy (targetPort) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: targetPort })
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(900)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** PIDs whose full executable path is exactly `exePath` (never a name-only match). */
async function processesForExe (exePath) {
  const target = normalizePath(exePath)
  if (!target) return []
  const imageName = basename(target).replace(/'/g, "''")
  const script = `$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process -Filter "Name='${imageName}'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`
  const result = await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 20_000 })
  if (result.missing) return []
  const pids = []
  for (const line of result.text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf('|')
    if (index <= 0) continue
    const pid = Number(trimmed.slice(0, index))
    const path = trimmed.slice(index + 1)
    if (Number.isInteger(pid) && samePath(path, target)) pids.push(pid)
  }
  return pids
}

/** Kill only processes whose full path equals `exePath`; returns the killed PIDs. */
async function stopProcessesByExe (exePath) {
  const target = normalizePath(exePath)
  if (!target) return []
  const imageName = basename(target).replace(/'/g, "''")
  const escaped = target.replace(/'/g, "''")
  const script = `$ErrorActionPreference='SilentlyContinue'; $target='${escaped}'; Get-CimInstance Win32_Process -Filter "Name='${imageName}'" | Where-Object { $_.ExecutablePath -ieq $target } | ForEach-Object { $procId=$_.ProcessId; Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; $procId }`
  const result = await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 20_000 })
  if (result.missing) return []
  return result.text
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

function apiBaseOf (port) {
  return `http://127.0.0.1:${port}/v1`
}

/**
 * One service controller: settings, real-state probe, start/stop.
 * `kind: 'cli'` drives a start/stop/status CLI, `kind: 'script'` runs a launcher
 * script and manages the daemon process table directly.
 */
function createService (spec) {
  const overrides = spec.overrides
  const config = spec.config
  const configRecord = config && typeof config === 'object' ? config : {}

  const state = {
    phase: 'unknown',
    reason: null,
    detail: '',
    tokenExpiresAt: null,
    at: Date.now(),
  }
  let busy = false
  let lastProbeAt = 0

  function settings () {
    const stored = overrides[spec.id] && typeof overrides[spec.id] === 'object' ? overrides[spec.id] : {}
    const resolved = {
      exePath: normalizePath(stored.exePath) || normalizePath(configRecord[spec.configKeys.exePath]) || spec.defaults.exePath,
      port: normalizePort(stored.port, normalizePort(configRecord[spec.configKeys.port], spec.defaults.port)),
      overridden: Object.keys(stored).length > 0,
      configExePath: normalizePath(configRecord[spec.configKeys.exePath]) || spec.defaults.exePath,
      configPort: normalizePort(configRecord[spec.configKeys.port], spec.defaults.port),
      defaultExePath: spec.defaults.exePath,
      defaultPort: spec.defaults.port,
    }
    if (spec.kind === 'script') {
      resolved.scriptPath =
        normalizePath(stored.scriptPath) ||
        normalizePath(configRecord[spec.configKeys.scriptPath]) ||
        spec.defaults.scriptPath
      resolved.configScriptPath = normalizePath(configRecord[spec.configKeys.scriptPath]) || spec.defaults.scriptPath
      resolved.defaultScriptPath = spec.defaults.scriptPath
    }
    return resolved
  }

  function snapshot () {
    const s = settings()
    return {
      id: spec.id,
      phase: state.phase,
      reason: state.reason,
      detail: state.detail,
      apiBase: apiBaseOf(s.port),
      port: s.port,
      exePath: s.exePath,
      scriptPath: s.scriptPath ?? null,
      tokenExpiresAt: state.tokenExpiresAt,
      at: state.at,
      busy,
    }
  }

  function setPhase (phase, reason = null, detail = '') {
    state.phase = phase
    state.reason = reason
    state.detail = detail
    state.at = Date.now()
  }

  async function probe () {
    const s = settings()
    const url = `http://127.0.0.1:${s.port}/healthz`
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), cache: 'no-store' })
      const text = await response.text()
      let body = null
      try {
        body = JSON.parse(text)
      } catch {
        body = null
      }
      // `authenticated: false` is reported by the GLM service when the upstream
      // token is stale: healthy requires both `status: "ok"` and a live token.
      const healthy = response.ok && body !== null && body.status === 'ok' && body.authenticated !== false
      const authenticated = body && typeof body.authenticated === 'boolean' ? body.authenticated : null
      return {
        reachable: true,
        healthy,
        status: response.status,
        authenticated,
        tokenExpiresAt: body && typeof body.token_expires_at === 'string' ? body.token_expires_at : null,
        detail: healthy ? '' : firstLine(text) || `HTTP ${response.status}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        reachable: false,
        healthy: false,
        status: 0,
        authenticated: null,
        tokenExpiresAt: null,
        detail: error && error.name === 'TimeoutError' ? 'health check timed out' : message,
      }
    }
  }

  async function refresh (force = false) {
    const now = Date.now()
    if (!force && now - lastProbeAt < STATE_CACHE_MS) return snapshot()
    // While a start/stop is running the transition phase is authoritative.
    if (busy && (state.phase === 'starting' || state.phase === 'stopping')) return snapshot()
    lastProbeAt = now

    const s = settings()
    const result = await probe()

    if (result.healthy) {
      state.tokenExpiresAt = result.tokenExpiresAt
      setPhase('running', null, '')
      return snapshot()
    }

    state.tokenExpiresAt = result.tokenExpiresAt

    if (spec.kind === 'script') {
      // A live process with a silent /healthz is an error, not "stopped".
      const pids = await processesForExe(s.exePath)
      if (pids.length > 0) {
        setPhase(
          'error',
          'unhealthy',
          `${s.exePath} (pid ${pids.join(', ')}) is running but http://127.0.0.1:${s.port}/healthz is not answering: ${result.detail}`,
        )
      } else {
        setPhase('stopped', null, '')
      }
      return snapshot()
    }

    if (result.authenticated === false) {
      setPhase('login-expired', 'login-expired', result.detail)
    } else if (result.reachable) {
      setPhase('login-expired', 'login-expired', result.detail)
    } else {
      setPhase('stopped', null, '')
    }
    return snapshot()
  }

  function failMissing (s, what, path) {
    setPhase('error', what, `${path} does not exist (check the plugin settings)`)
  }

  async function portPreflight (s) {
    // A foreign listener on our port: report it instead of waiting 30 s.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await probe()
      if (result.healthy) {
        setPhase('running', null, '')
        return snapshot()
      }
      if (!(await portBusy(s.port))) return null
      await sleep(PROBE_POLL_MS)
    }
    const occupied = await portBusy(s.port)
    if (!occupied) return null
    setPhase(
      'error',
      'port-in-use',
      `127.0.0.1:${s.port} is already in use; stop that process (or pick another port) and retry`,
    )
    return snapshot()
  }

  async function startCli (s) {
    if (!s.exePath) {
      failMissing(s, 'missing-exe', '(unset)')
      return snapshot()
    }
    const result = await run(s.exePath, ['start', '-host', '127.0.0.1', '-port', String(s.port)], {
      timeout: SCRIPT_TIMEOUT_MS,
    })
    if (result.missing) {
      failMissing(s, 'missing-exe', s.exePath)
      return snapshot()
    }
    const output = result.text
    if (/login token rejected|unauthorized|\b401\b/i.test(output)) {
      setPhase('login-expired', 'login-expired', firstLine(output))
      return snapshot()
    }
    if (/already running/i.test(output)) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const probeResult = await probe()
        if (probeResult.healthy) {
          setPhase('running', null, '')
          return snapshot()
        }
        await sleep(PROBE_POLL_MS)
      }
      setPhase('error', 'port-in-use', firstLine(output))
      return snapshot()
    }
    if (!result.ok) {
      setPhase('error', 'cli-failed', firstLine(output) || `exit code ${result.code}`)
      return snapshot()
    }
    return await waitForHealth(s, output)
  }

  async function startScript (s) {
    if (!s.scriptPath || !existsSync(s.scriptPath)) {
      failMissing(s, 'missing-script', s.scriptPath ?? '(unset)')
      return snapshot()
    }
    if (!existsSync(s.exePath)) {
      failMissing(s, 'missing-exe', s.exePath)
      return snapshot()
    }
    // Never launch a second copy: if the exact executable is already alive but its
    // health endpoint is not ready yet, wait briefly instead of starting again.
    const alive = await processesForExe(s.exePath)
    if (alive.length > 0) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if ((await probe()).healthy) {
          setPhase('running', null, '')
          return snapshot()
        }
        await sleep(PROBE_POLL_MS)
      }
      setPhase('error', 'unhealthy', `pid ${alive.join(', ')} is already running but http://127.0.0.1:${s.port}/healthz is not ready; stop it and retry`)
      return snapshot()
    }
    // Hidden, non-interactive PowerShell: the launcher script starts the daemon
    // with Start-Process -WindowStyle Hidden, so no console window ever appears.
    const result = await runLauncher(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', s.scriptPath],
      { cwd: dirname(s.scriptPath), timeout: SCRIPT_TIMEOUT_MS },
    )
    if (result.missing) {
      setPhase('error', 'cli-failed', `cannot run ${POWERSHELL} (not found in PATH)`)
      return snapshot()
    }
    const output = result.text
    if (!result.ok) {
      if (/address already in use|EADDRINUSE|bind:|already running|port .*in use/i.test(output)) {
        setPhase('error', 'port-in-use', firstLine(output))
      } else if (/login token rejected|unauthorized|\b401\b/i.test(output)) {
        setPhase('login-expired', 'login-expired', firstLine(output))
      } else {
        setPhase('error', 'cli-failed', tail(output) || `launcher exit code ${result.code}`)
      }
      return snapshot()
    }
    return await waitForHealth(s, output)
  }

  async function waitForHealth (s, output) {
    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      const result = await probe()
      if (result.healthy) {
        setPhase('running', null, '')
        return snapshot()
      }
      await sleep(PROBE_POLL_MS)
    }
    if (/address already in use|EADDRINUSE|bind:|already running|port .*in use/i.test(output)) {
      setPhase('error', 'port-in-use', firstLine(output))
    } else {
      setPhase('error', 'timeout', `http://127.0.0.1:${s.port}/healthz did not become ready within ${START_TIMEOUT_MS / 1000} s`)
    }
    return snapshot()
  }

  async function stopCli (s) {
    const result = await run(s.exePath, ['stop'], { timeout: SCRIPT_TIMEOUT_MS })
    if (result.missing) {
      failMissing(s, 'missing-exe', s.exePath)
      return snapshot()
    }
    const deadline = Date.now() + STOP_TIMEOUT_MS
    while (Date.now() < deadline) {
      const probeResult = await probe()
      if (!probeResult.reachable) {
        setPhase('stopped', null, '')
        return snapshot()
      }
      await sleep(PROBE_POLL_MS)
    }
    setPhase('error', 'still-running', `http://127.0.0.1:${s.port}/healthz still answers after the stop command`)
    return snapshot()
  }

  async function stopScript (s) {
    const before = await processesForExe(s.exePath)
    if (before.length === 0) {
      const probeResult = await probe()
      if (probeResult.healthy) {
        setPhase('error', 'still-running', `http://127.0.0.1:${s.port}/healthz answers but no ${basename(s.exePath)} process matches ${s.exePath}`)
      } else {
        setPhase('stopped', null, '')
      }
      return snapshot()
    }
    await stopProcessesByExe(s.exePath)
    const deadline = Date.now() + STOP_TIMEOUT_MS
    while (Date.now() < deadline) {
      const remaining = await processesForExe(s.exePath)
      const probeResult = remaining.length === 0 ? await probe() : { healthy: true }
      if (remaining.length === 0 && !probeResult.healthy) {
        setPhase('stopped', null, '')
        return snapshot()
      }
      await sleep(PROBE_POLL_MS)
    }
    const left = await processesForExe(s.exePath)
    setPhase('error', 'still-running', left.length > 0 ? `pid ${left.join(', ')} is still running` : `http://127.0.0.1:${s.port}/healthz still answers`)
    return snapshot()
  }

  async function start () {
    if (busy) return snapshot()
    busy = true
    setPhase('starting', null, '')
    try {
      const s = settings()
      const pre = await probe()
      if (pre.healthy) {
        setPhase('running', null, '')
        return snapshot()
      }
      const blocked = await portPreflight(s)
      if (blocked) return blocked
      return spec.kind === 'script' ? await startScript(s) : await startCli(s)
    } catch (error) {
      setPhase('error', 'cli-failed', error instanceof Error ? error.message : String(error))
      return snapshot()
    } finally {
      busy = false
      lastProbeAt = 0
    }
  }

  async function stop () {
    if (busy) return snapshot()
    busy = true
    setPhase('stopping', null, '')
    try {
      const s = settings()
      return spec.kind === 'script' ? await stopScript(s) : await stopCli(s)
    } catch (error) {
      setPhase('error', 'cli-failed', error instanceof Error ? error.message : String(error))
      return snapshot()
    } finally {
      busy = false
      lastProbeAt = 0
    }
  }

  function saveSettings (input) {
    const current = overrides[spec.id] && typeof overrides[spec.id] === 'object' ? { ...overrides[spec.id] } : {}
    const next = { ...current }
    let changed = false

    if (input && input.exePath !== undefined) {
      const value = normalizePath(input.exePath)
      if (!value) {
        delete next.exePath
        changed = true
      } else if (value !== normalizePath(current.exePath)) {
        next.exePath = value
        changed = true
      }
    }

    if (input && input.port !== undefined && input.port !== null && input.port !== '') {
      const value = normalizePort(input.port, null)
      if (value === null) return { ok: false, error: 'port must be an integer between 1 and 65535' }
      if (value !== Number(current.port)) {
        next.port = value
        changed = true
      }
    }

    if (spec.kind === 'script' && input && input.scriptPath !== undefined) {
      const value = normalizePath(input.scriptPath)
      if (!value) {
        delete next.scriptPath
        changed = true
      } else if (value !== normalizePath(current.scriptPath)) {
        next.scriptPath = value
        changed = true
      }
    }

    if (changed) {
      overrides[spec.id] = next
      writeOverrides(overrides)
      lastProbeAt = 0
    }
    return { ok: true }
  }

  return { id: spec.id, snapshot, refresh, start, stop, saveSettings, settings }
}

export function apply (ctx, config) {
  const web = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (!web || typeof web.register !== 'function') {
    // At startup this bundle can be applied before the web server is mounted.
    // Wait for the service instead of returning, or the route never exists and
    // every switch shows "cannot reach the host half".
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (scoped) => {
        const ready = typeof scoped.get === 'function' ? scoped.get('webServer') : undefined
        if (!ready || typeof ready.register !== 'function') {
          console.error('[dsh-local-api] webServer service is unavailable; the switches cannot reach the host half.')
          return
        }
        apply(scoped, config)
      })
      return
    }
    console.error('[dsh-local-api] webServer service is unavailable; the switches cannot reach the host half.')
    return
  }

  const overrides = readOverrides()

  const glm = createService({
    id: 'glm',
    kind: 'cli',
    config,
    overrides,
    defaults: { exePath: '', port: GLM_PORT },
    configKeys: { exePath: 'exePath', port: 'port' },
  })
  const gpt = createService({
    id: 'gpt',
    kind: 'script',
    config,
    overrides,
    defaults: { exePath: '', scriptPath: '', port: GPT_PORT },
    configKeys: { exePath: 'gptExePath', scriptPath: 'gptScriptPath', port: 'gptPort' },
  })

  const services = { gpt, glm }
  /** Counts client reads; a rising count proves the sidebar switches are polling. */
  let stateReads = 0
  /** Diagnostics posted by the browser bundle (load/apply failures surface here). */
  const clientLog = []

  function send (res, status, payload) {
    const text = JSON.stringify(payload)
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('content-length', Buffer.byteLength(text))
    res.end(text)
  }

  function readBody (req, limit = 64 * 1024) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size <= limit) chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', () => resolve(''))
    })
  }

  async function allStates (force) {
    const result = {}
    for (const id of Object.keys(services)) result[id] = await services[id].refresh(force)
    return result
  }

  function allSettings () {
    const result = {}
    for (const id of Object.keys(services)) result[id] = services[id].settings()
    return result
  }

  /**
   * Node handler form: unlike a `resource` route (GET only), this accepts the
   * POST verbs the switches need.
   */
  async function handle (req, res) {
    if (req.headers[GUARD_HEADER] !== '1') {
      return send(res, 403, { ok: false, error: 'forbidden' })
    }

    let pathname = '/'
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    } catch {
      return send(res, 400, { ok: false, error: 'bad request url' })
    }
    const rest = pathname.slice(ROUTE.length).replace(/^\/+|\/+$/g, '')
    const method = (req.method ?? 'GET').toUpperCase()

    try {
      if (rest === '' || rest === 'state') {
        if (method !== 'GET') return send(res, 405, { ok: false, error: 'method not allowed' })
        stateReads += 1
        return send(res, 200, { ok: true, services: await allStates(true), settings: allSettings(), stateReads })
      }
      if (rest === 'client-log') {
        if (method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' })
        let body = {}
        try {
          body = JSON.parse((await readBody(req)) || '{}')
        } catch {
          body = {}
        }
        clientLog.push({
          at: new Date().toISOString(),
          stage: String(body.stage ?? '?').slice(0, 80),
          detail: String(body.detail ?? '').slice(0, 2000),
        })
        if (clientLog.length > 30) clientLog.shift()
        return send(res, 200, { ok: true })
      }
      if (rest === 'debug') {
        return send(res, 200, { ok: true, services: Object.keys(services), stateReads, clientLog })
      }

      const [id, action = ''] = rest.split('/')
      const service = services[id]
      if (!service) return send(res, 404, { ok: false, error: `unknown service: ${id}` })

      if (action === '' || action === 'state') {
        if (method !== 'GET') return send(res, 405, { ok: false, error: 'method not allowed' })
        stateReads += 1
        return send(res, 200, {
          ok: true,
          state: await service.refresh(),
          settings: service.settings(),
          stateReads,
        })
      }
      if (action === 'start') {
        if (method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' })
        return send(res, 200, { ok: true, state: await service.start() })
      }
      if (action === 'stop') {
        if (method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' })
        return send(res, 200, { ok: true, state: await service.stop() })
      }
      if (action === 'settings') {
        if (method === 'GET') return send(res, 200, { ok: true, settings: service.settings() })
        if (method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' })
        let body = {}
        try {
          const text = await readBody(req)
          body = text ? JSON.parse(text) : {}
        } catch {
          body = {}
        }
        const saved = service.saveSettings(body ?? {})
        if (!saved.ok) return send(res, 400, { ok: false, error: saved.error, settings: service.settings() })
        const fresh = await service.refresh(true)
        return send(res, 200, { ok: true, settings: service.settings(), state: fresh })
      }
      return send(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[dsh-local-api] route failure:', message)
      return send(res, 500, { ok: false, error: message })
    }
  }

  const disposeRoute = web.register({ kind: 'prefix', path: ROUTE, handler: (req, res) => handle(req, res) })
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => disposeRoute)
  }

  // Loading only queries state: no service is started or stopped implicitly.
  setTimeout(() => {
    allStates(true).catch((error) => {
      console.error('[dsh-local-api] initial probe failed:', error instanceof Error ? error.message : String(error))
    })
  }, 0)

  console.log(`[dsh-local-api] host half ready at ${ROUTE}`)
}
