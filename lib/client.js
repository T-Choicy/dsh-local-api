/**
 * Local API switches — Client half.
 *
 * Renders one sidebar-footer cell holding two switches stacked vertically:
 * GPT on top, GLM below (the footer slot itself lays entries out in a row, so a
 * single cell is the only way to stack them). The account avatar sits under the
 * settings row, so both switches stay above it.
 *
 * Every process action happens in the Host half; this half only reads state and
 * posts start/stop/settings over the same-origin route /api/dsh-local-api.
 */
window.__ModuleLoader__.load({
  id: 'dsh-local-api',
  factory: (require) => {
    // Diagnostics: if the Host half never sees these, the bundle never ran.
    const report = (stage, detail) => {
      try {
        fetch('/api/dsh-local-api/client-log', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dsh-local-api': '1' },
          body: JSON.stringify({ stage, detail: String(detail ?? '').slice(0, 2000) }),
        }).catch(() => {})
      } catch {}
    }
    report('factory:enter', '')

    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-local-api'
    const ENDPOINT = '/api/dsh-local-api'
    const GUARD = { 'x-dsh-local-api': '1' }
    const SLOT = 'sidebar.footer.action'

    const SERVICES = [
      { id: 'gpt', labelKey: 'label.gpt', fallbackApi: 'http://127.0.0.1:18080/v1' },
      { id: 'glm', labelKey: 'label.glm', fallbackApi: 'http://127.0.0.1:18081/v1' },
    ]

    const DICTS = {
      zh: {
        'label.gpt': 'GPT 本地 API',
        'label.glm': 'GLM 本地 API',
        'phase.checking': '检查中',
        'phase.running': '运行中',
        'phase.stopped': '已停止',
        'phase.starting': '启动中',
        'phase.stopping': '停止中',
        'phase.loginExpired': '登录过期',
        'phase.error': '出错',
        'phase.unreachable': '连接失败',
        'reason.loginExpired': '请在 ZCode 桌面端确认已登录，然后回到这里点「重试」。服务会自动热重载凭据。',
        'reason.missingExe': '找不到可执行文件：请检查设置里的路径。',
        'reason.missingScript': '找不到启动脚本：请检查设置里的 Start-Server.ps1 路径。',
        'reason.portInUse': '端口可能已被占用：可能已有实例在运行，先刷新状态确认。',
        'reason.timeout': '启动超时：30 秒内 /healthz 没有就绪。',
        'reason.cliFailed': '启动命令执行失败。',
        'reason.stillRunning': '停止命令已执行，但进程或 /healthz 仍在。',
        'reason.portForeign': '端口被另一个进程占用：它不是插件管理的那个可执行文件，请先结束该进程（详情里有 PID）。',
        'reason.unhealthy': '进程在运行，但 /healthz 没有响应。',
        'reason.hostUnreachable': '无法连接 Harness 主进程：插件可能未加载或被停用。',
        'reason.unknown': '状态未知。',
        retry: '重试',
        close: '关闭',
        settingsTitle: '设置',
        exePath: '可执行文件路径',
        scriptPath: '启动脚本路径',
        port: '端口',
        save: '保存',
        saved: '已保存',
        saveFailed: '保存失败',
      },
      en: {
        'label.gpt': 'GPT Local API',
        'label.glm': 'GLM Local API',
        'phase.checking': 'Checking',
        'phase.running': 'Running',
        'phase.stopped': 'Stopped',
        'phase.starting': 'Starting',
        'phase.stopping': 'Stopping',
        'phase.loginExpired': 'Login expired',
        'phase.error': 'Error',
        'phase.unreachable': 'Unreachable',
        'reason.loginExpired': 'Confirm you are signed in to the ZCode desktop app, then press Retry. The service reloads credentials on its own.',
        'reason.missingExe': 'Executable not found: check the configured path.',
        'reason.missingScript': 'Launcher script not found: check the configured Start-Server.ps1 path.',
        'reason.portInUse': 'The port may already be in use: an instance could be running. Refresh the state first.',
        'reason.timeout': '/healthz did not become ready within 30 seconds.',
        'reason.cliFailed': 'The lifecycle command failed.',
        'reason.stillRunning': 'The stop command ran, but the process or /healthz is still there.',
        'reason.portForeign': 'Another process owns the port: it is not the executable this plugin manages. End that process first (the PID is in the details).',
        'reason.unhealthy': 'The process is running but /healthz does not answer.',
        'reason.hostUnreachable': 'Cannot reach the Harness main process: the plugin may not be loaded.',
        'reason.unknown': 'Unknown state.',
        retry: 'Retry',
        close: 'Close',
        settingsTitle: 'Settings',
        exePath: 'Executable path',
        scriptPath: 'Launcher script path',
        port: 'Port',
        save: 'Save',
        saved: 'Saved',
        saveFailed: 'Save failed',
      },
    }

    const PHASE_LABEL = {
      checking: 'phase.checking',
      running: 'phase.running',
      stopped: 'phase.stopped',
      starting: 'phase.starting',
      stopping: 'phase.stopping',
      'login-expired': 'phase.loginExpired',
      error: 'phase.error',
      unreachable: 'phase.unreachable',
    }

    const REASON_TEXT = {
      'login-expired': 'reason.loginExpired',
      'missing-exe': 'reason.missingExe',
      'missing-script': 'reason.missingScript',
      'port-in-use': 'reason.portInUse',
      timeout: 'reason.timeout',
      'cli-failed': 'reason.cliFailed',
      'still-running': 'reason.stillRunning',
      'port-foreign': 'reason.portForeign',
      unhealthy: 'reason.unhealthy',
      'host-unreachable': 'reason.hostUnreachable',
    }

    const DOT_COLOR = {
      running: 'var(--dsw-alias-state-success-primary, #22c55e)',
      starting: 'var(--dsw-alias-state-business-primary, #3b82f6)',
      stopping: 'var(--dsw-alias-state-business-primary, #3b82f6)',
      'login-expired': 'var(--dsw-alias-state-warn-primary, #eab308)',
      error: 'var(--dsw-alias-state-error-primary, #ef4444)',
      unreachable: 'var(--dsw-alias-state-error-primary, #ef4444)',
      stopped: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      checking: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      unknown: 'var(--dsw-alias-label-tertiary, #9ca3af)',
    }

    const PANEL_STYLE = {
      position: 'absolute',
      bottom: 'calc(100% + 8px)',
      left: '0',
      zIndex: 60,
      width: '300px',
      padding: '12px',
      borderRadius: '10px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25))',
      background: 'var(--dsw-alias-bg-layer-2, Canvas)',
      color: 'var(--dsw-alias-label-primary, CanvasText)',
      boxShadow: '0 10px 30px rgba(0,0,0,0.28)',
      fontSize: '12px',
      lineHeight: '1.5',
      textAlign: 'left',
      cursor: 'default',
    }

    const INPUT_STYLE = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '5px 7px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
      background: 'var(--dsw-alias-bg-layer-1, Canvas)',
      color: 'var(--dsw-alias-label-primary, CanvasText)',
      font: 'inherit',
      fontSize: '12px',
    }

    const BUTTON_STYLE = {
      padding: '4px 10px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
      background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))',
      color: 'var(--dsw-alias-label-primary, CanvasText)',
      font: 'inherit',
      fontSize: '12px',
      cursor: 'pointer',
    }

    function rowComponent (service, t) {
      return function LocalApiRow (props) {
        const wide = props && props.wide !== undefined ? Boolean(props.wide) : true

        const [state, setState] = React.useState({ phase: 'checking', apiBase: service.fallbackApi })
        const [settings, setSettings] = React.useState(null)
        const [panel, setPanel] = React.useState(null) // null | 'status' | 'settings'
        const [hover, setHover] = React.useState(false)
        const [pulse, setPulse] = React.useState(1)
        const [draftExe, setDraftExe] = React.useState('')
        const [draftScript, setDraftScript] = React.useState('')
        const [draftPort, setDraftPort] = React.useState('')
        const [notice, setNotice] = React.useState('')

        const stateRef = React.useRef(state)
        stateRef.current = state

        const transitioning = state.phase === 'starting' || state.phase === 'stopping'

        const applyPayload = React.useCallback((payload) => {
          if (!payload) return
          if (payload.state) setState(payload.state)
          if (payload.settings) setSettings(payload.settings)
        }, [])

        const readState = React.useCallback(async () => {
          try {
            const response = await fetch(`${ENDPOINT}/${service.id}/state`, {
              headers: { accept: 'application/json', ...GUARD },
              cache: 'no-store',
            })
            applyPayload(await response.json())
          } catch (error) {
            setState((previous) => ({
              ...previous,
              phase: 'unreachable',
              reason: 'host-unreachable',
              detail: error instanceof Error ? error.message : String(error),
            }))
          }
        }, [applyPayload])

        // One self-scheduling poll: 1 s while a transition runs, 30 s at rest.
        React.useEffect(() => {
          let disposed = false
          let timer = null
          const tick = async () => {
            if (disposed) return
            await readState()
            if (disposed) return
            const phase = stateRef.current.phase
            const delay = phase === 'starting' || phase === 'stopping' ? 1_000 : 30_000
            timer = setTimeout(tick, delay)
          }
          tick()
          return () => {
            disposed = true
            if (timer) clearTimeout(timer)
          }
        }, [readState])

        // Transition feedback without a global stylesheet: pulse the dot by hand.
        React.useEffect(() => {
          if (!transitioning) {
            setPulse(1)
            return undefined
          }
          const timer = setInterval(() => setPulse((value) => (value > 0.5 ? 0.35 : 1)), 550)
          return () => clearInterval(timer)
        }, [transitioning])

        React.useEffect(() => {
          if (!panel) return undefined
          const onKeyDown = (event) => {
            if (event.key === 'Escape') setPanel(null)
          }
          window.addEventListener('keydown', onKeyDown)
          return () => window.removeEventListener('keydown', onKeyDown)
        }, [panel])

        const act = React.useCallback(
          async (verb) => {
            setNotice('')
            setState((previous) => ({
              ...previous,
              phase: verb === 'start' ? 'starting' : 'stopping',
              reason: null,
              detail: '',
            }))
            try {
              const response = await fetch(`${ENDPOINT}/${service.id}/${verb}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json', ...GUARD },
                body: '{}',
              })
              const payload = await response.json()
              applyPayload(payload)
              const phase = payload && payload.state ? payload.state.phase : null
              if (phase === 'login-expired' || phase === 'error' || phase === 'stopped') {
                setPanel(phase === 'stopped' ? null : 'status')
              } else {
                setPanel(null)
              }
            } catch (error) {
              setState((previous) => ({
                ...previous,
                phase: 'unreachable',
                reason: 'host-unreachable',
                detail: error instanceof Error ? error.message : String(error),
              }))
              setPanel('status')
            }
          },
          [applyPayload],
        )

        const saveSettings = React.useCallback(async () => {
          try {
            const response = await fetch(`${ENDPOINT}/${service.id}/settings`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json', ...GUARD },
              body: JSON.stringify({ exePath: draftExe, scriptPath: draftScript, port: draftPort }),
            })
            const payload = await response.json()
            if (payload && payload.ok) {
              applyPayload(payload)
              setNotice(t('saved'))
            } else {
              setNotice(`${t('saveFailed')}${payload && payload.error ? `: ${payload.error}` : ''}`)
            }
          } catch (error) {
            setNotice(`${t('saveFailed')}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }, [draftExe, draftScript, draftPort, applyPayload, t])

        const openSettings = React.useCallback(() => {
          const current = settings || {}
          setDraftExe(String(current.exePath || ''))
          setDraftScript(String(current.scriptPath || ''))
          setDraftPort(String(current.port || ''))
          setNotice('')
          setPanel((value) => (value === 'settings' ? null : 'settings'))
        }, [settings])

        const onRowClick = React.useCallback(() => {
          const phase = stateRef.current.phase
          if (phase === 'running') {
            act('stop')
            return
          }
          if (phase === 'login-expired' || phase === 'error' || phase === 'unreachable') {
            setPanel((value) => (value === 'status' ? null : 'status'))
            return
          }
          if (phase === 'starting' || phase === 'stopping' || phase === 'checking') return
          act('start')
        }, [act])

        const label = t(service.labelKey)
        const color = DOT_COLOR[state.phase] || DOT_COLOR.unknown
        const phaseLabel = t(PHASE_LABEL[state.phase] || 'phase.stopped')
        const apiBase = state.apiBase || service.fallbackApi

        const rowStyle = {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          height: '30px',
          padding: wide ? '0 8px' : '0',
          justifyContent: wide ? 'flex-start' : 'center',
          boxSizing: 'border-box',
          borderRadius: '8px',
          border: 'none',
          background: hover ? 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))' : 'transparent',
          color: hover ? 'var(--dsw-alias-label-primary, inherit)' : 'var(--dsw-alias-label-secondary, inherit)',
          font: 'inherit',
          fontSize: '13px',
          lineHeight: '1',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background 120ms ease, color 120ms ease',
        }

        const dotStyle = {
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          flex: 'none',
          background: color,
          opacity: pulse,
          boxShadow: state.phase === 'running' ? `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)` : 'none',
        }

        const reasonKey = REASON_TEXT[state.reason] || 'reason.unknown'

        const statusPanel = h(
          'div',
          { style: PANEL_STYLE, role: 'dialog', 'aria-label': label },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' } },
            h('span', { style: dotStyle }),
            h('strong', { style: { fontSize: '12px' } }, label),
            h('span', { style: { color: 'var(--dsw-alias-label-tertiary, inherit)' } }, `· ${phaseLabel}`),
          ),
          h('div', { style: { marginBottom: '8px' } }, t(reasonKey)),
          state.detail
            ? h(
                'div',
                {
                  style: {
                    marginBottom: '8px',
                    padding: '6px',
                    borderRadius: '6px',
                    background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.08))',
                    color: 'var(--dsw-alias-label-tertiary, inherit)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: '11px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '96px',
                    overflow: 'auto',
                  },
                },
                state.detail,
              )
            : null,
          h('div', { style: { color: 'var(--dsw-alias-label-tertiary, inherit)', marginBottom: '8px' } }, apiBase),
          h(
            'div',
            { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            h('button', { type: 'button', style: BUTTON_STYLE, onClick: () => act('start') }, t('retry')),
            h('button', { type: 'button', style: BUTTON_STYLE, onClick: openSettings }, t('settingsTitle')),
            h('button', { type: 'button', style: BUTTON_STYLE, onClick: () => setPanel(null) }, t('close')),
          ),
        )

        const settingsPanel = h(
          'div',
          { style: PANEL_STYLE, role: 'dialog', 'aria-label': t('settingsTitle') },
          h('div', { style: { fontWeight: 600, marginBottom: '8px' } }, `${label} · ${t('settingsTitle')}`),
          h(
            'label',
            { style: { display: 'block', marginBottom: '8px' } },
            h('div', { style: { marginBottom: '3px', color: 'var(--dsw-alias-label-tertiary, inherit)' } }, t('exePath')),
            h('input', {
              type: 'text',
              value: draftExe,
              spellCheck: false,
              style: INPUT_STYLE,
              onChange: (event) => setDraftExe(event.target.value),
            }),
          ),
          service.id === 'gpt'
            ? h(
                'label',
                { style: { display: 'block', marginBottom: '8px' } },
                h('div', { style: { marginBottom: '3px', color: 'var(--dsw-alias-label-tertiary, inherit)' } }, t('scriptPath')),
                h('input', {
                  type: 'text',
                  value: draftScript,
                  spellCheck: false,
                  style: INPUT_STYLE,
                  onChange: (event) => setDraftScript(event.target.value),
                }),
              )
            : null,
          h(
            'label',
            { style: { display: 'block', marginBottom: '10px' } },
            h('div', { style: { marginBottom: '3px', color: 'var(--dsw-alias-label-tertiary, inherit)' } }, t('port')),
            h('input', {
              type: 'text',
              inputMode: 'numeric',
              value: draftPort,
              style: INPUT_STYLE,
              onChange: (event) => setDraftPort(event.target.value),
            }),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
            h('button', { type: 'button', style: BUTTON_STYLE, onClick: saveSettings }, t('save')),
            h('button', { type: 'button', style: BUTTON_STYLE, onClick: () => setPanel(null) }, t('close')),
            notice ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary, inherit)' } }, notice) : null,
          ),
        )

        return h(
          'div',
          { style: { position: 'relative', display: 'flex', width: '100%', minWidth: 0 } },
          h(
            'button',
            {
              type: 'button',
              role: 'switch',
              'aria-checked': state.phase === 'running',
              'aria-label': `${label} — ${phaseLabel}`,
              title: apiBase,
              style: rowStyle,
              onClick: onRowClick,
              onMouseEnter: () => setHover(true),
              onMouseLeave: () => setHover(false),
            },
            h('span', { style: dotStyle, 'aria-hidden': 'true' }),
            wide
              ? h(
                  'span',
                  {
                    style: {
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  },
                  label,
                )
              : null,
          ),
          panel === 'status' ? statusPanel : null,
          panel === 'settings' ? settingsPanel : null,
        )
      }
    }

    function stackComponent (t) {
      const rows = SERVICES.map((service) => rowComponent(service, t))
      return function LocalApiSwitches (props) {
        const wide = props && props.wide !== undefined ? Boolean(props.wide) : true
        return h(
          'div',
          {
            // The footer slot lays registered entries out in a row; this single
            // cell stacks the two switches so GPT sits directly above GLM.
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              flex: '1 1 auto',
              minWidth: 0,
              paddingTop: '2px',
              paddingBottom: '2px',
            },
          },
          rows.map((Row, index) => h(Row, { key: SERVICES[index].id, wide })),
        )
      }
    }

    const name = NS
    const inject = ['slots', 'locale']

    function apply (ctx) {
      try {
        report('apply:enter', '')
        // A rebuilt interface re-runs apply in the same page, where the locale
        // registry still holds this namespace: register once, never throw here.
        try {
          ctx.locale.register(NS, DICTS)
        } catch {}
        const t = ctx.locale.bind(NS)
        ctx.slots.inject(SLOT, () => {
          try {
            const dispose = ctx.slots.register(
              { name: SLOT, id: NS, order: 20, label: () => t('label.glm') },
              stackComponent(t),
            )
            report('register:ok', SLOT)
            return dispose
          } catch (error) {
            report('register:throw', (error && error.stack) || error)
            throw error
          }
        })
        report('apply:ok', SLOT)
      } catch (error) {
        report('apply:throw', (error && error.stack) || error)
        throw error
      }
    }

    report('factory:ok', NS)
    return { name, inject, apply }
  },
})
