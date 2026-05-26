import { useMemo, useState } from 'react'
import './App.css'

type TutorialStep = {
  id: number
  title: string
  note: string
  actionLabel?: string
  action?: () => Promise<boolean>
}

type SetupCheckItem = {
  key: string
  label: string
  ok: boolean
  details: string
}

type SetupCheckResult = {
  success: boolean
  ready: boolean
  checks: SetupCheckItem[]
}

function App() {
  const apiBase = useMemo(() => import.meta.env.VITE_API_URL || '', [])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('Ready')
  const [completedSteps, setCompletedSteps] = useState<number[]>([])
  const [lockNextStep, setLockNextStep] = useState(true)
  const [showSecurityModal, setShowSecurityModal] = useState(false)
  const [setupCheck, setSetupCheck] = useState<SetupCheckResult | null>(null)
  const [setupCheckLoading, setSetupCheckLoading] = useState(false)
  const [copiedCheckKey, setCopiedCheckKey] = useState<string | null>(null)

  function markStepDone(stepId: number) {
    setCompletedSteps((previous) => (previous.includes(stepId) ? previous : [...previous, stepId]))
  }

  async function callApi(endpoint: string, method: 'GET' | 'POST', body?: unknown) {
    setLoading(true)

    try {
      const response = await fetch(`${apiBase}${endpoint}`, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setResult(`${response.status}: ${JSON.stringify(data, null, 2)}`)
        return null
      }

      setResult(JSON.stringify(data, null, 2))
      return data
    } catch (error) {
      setResult(`Network error: ${String(error)}`)
      return null
    } finally {
      setLoading(false)
    }
  }

  async function runSetupCheck() {
    setSetupCheckLoading(true)
    try {
      const response = await fetch(`${apiBase}/api/setup/check`, {
        method: 'GET',
        credentials: 'include'
      })

      const data = (await response.json()) as SetupCheckResult
      setSetupCheck(data)
    } catch (error) {
      setResult(`Setup check failed: ${String(error)}`)
    } finally {
      setSetupCheckLoading(false)
    }
  }

  async function handleSignup() {
    const data = await callApi('/api/auth/signup', 'POST', { email, password })

    if (data) {
      markStepDone(3)
      return true
    }

    return false
  }

  async function handleLogin() {
    const data = await callApi('/api/auth/login', 'POST', { email, password })

    if (data) {
      markStepDone(4)
      return true
    }

    return false
  }

  async function handleLogout() {
    const data = await callApi('/api/auth/logout', 'POST')

    if (data) {
      markStepDone(10)
      return true
    }

    return false
  }

  async function handleCheckout() {
    const data = await callApi('/api/billing/create-checkout', 'POST')

    if (data) {
      markStepDone(8)
    }

    if (data?.url) {
      window.location.href = data.url
    }

    return Boolean(data)
  }

  async function handleBuyCredits() {
    const data = await callApi('/api/billing/buy-credits', 'POST')

    if (data) {
      markStepDone(7)
    }

    if (data?.url) {
      window.location.href = data.url
    }

    return Boolean(data)
  }

  async function checkHealth() {
    const data = await callApi('/health', 'GET')

    if (data) {
      markStepDone(2)
      return true
    }

    return false
  }

  async function checkCurrentUser() {
    const data = await callApi('/api/auth/me', 'GET')

    if (data) {
      markStepDone(5)
      return true
    }

    return false
  }

  async function checkProtectedRoute() {
    const data = await callApi('/api/protected', 'GET')

    if (data) {
      markStepDone(6)
      return true
    }

    return false
  }

  async function useAiRoute() {
    const data = await callApi('/api/ai/generate', 'POST', {})

    if (data) {
      markStepDone(9)
      return true
    }

    return false
  }

  async function checkProRoute() {
    const data = await callApi('/api/pro-feature', 'GET')

    if (data) {
      markStepDone(11)
      return true
    }

    return false
  }

  const tutorialSteps: TutorialStep[] = [
    {
      id: 1,
      title: 'Set credentials fields',
      note: 'Enter the email and password you want to use for this full walkthrough.'
    },
    {
      id: 2,
      title: 'Check backend health',
      note: 'Confirms server is online before auth and billing steps.',
      actionLabel: 'Run Health Check',
      action: checkHealth
    },
    {
      id: 3,
      title: 'Create account',
      note: 'Creates your user and Stripe customer.',
      actionLabel: 'Signup',
      action: handleSignup
    },
    {
      id: 4,
      title: 'Login with cookie session',
      note: 'Logs in and stores JWT cookie.',
      actionLabel: 'Login',
      action: handleLogin
    },
    {
      id: 5,
      title: 'Verify current session',
      note: 'Reads current authenticated user.',
      actionLabel: 'Current User',
      action: checkCurrentUser
    },
    {
      id: 6,
      title: 'Test protected route',
      note: 'Verifies middleware access control.',
      actionLabel: 'Protected Route',
      action: checkProtectedRoute
    },
    {
      id: 7,
      title: 'Buy credits pack',
      note: 'Opens Stripe one-time payment checkout to top up usage.',
      actionLabel: 'Buy Credits',
      action: handleBuyCredits
    },
    {
      id: 8,
      title: 'Start subscription checkout',
      note: 'Opens Stripe subscription checkout.',
      actionLabel: 'Subscription Checkout',
      action: handleCheckout
    },
    {
      id: 9,
      title: 'Consume credits',
      note: 'Calls AI route and decreases credits.',
      actionLabel: 'AI Route',
      action: useAiRoute
    },
    {
      id: 10,
      title: 'Logout session',
      note: 'Confirms logout behavior and cookie cleanup.',
      actionLabel: 'Logout',
      action: handleLogout
    },
    {
      id: 11,
      title: 'Validate pro route',
      note: 'Checks if account has pro access.',
      actionLabel: 'Pro Feature',
      action: checkProRoute
    }
  ]

  const firstIncompleteStepIndex = tutorialSteps.findIndex(
    (step) => !completedSteps.includes(step.id)
  )

  function isStepUnlocked(stepIndex: number, stepId: number) {
    if (!lockNextStep) {
      return true
    }

    if (completedSteps.includes(stepId)) {
      return true
    }

    if (firstIncompleteStepIndex === -1) {
      return true
    }

    return stepIndex === firstIncompleteStepIndex
  }

  async function runNextStep() {
    const nextIndex = tutorialSteps.findIndex((step, index) => {
      const done = completedSteps.includes(step.id)
      const unlocked = isStepUnlocked(index, step.id)
      return !done && unlocked
    })

    if (nextIndex === -1) {
      setResult('All tutorial steps are complete.')
      return
    }

    const nextStep = tutorialSteps[nextIndex]

    if (!nextStep.action) {
      setResult(
        `Step ${nextStep.id} is manual: ${nextStep.title}. Complete it, then click Done.`
      )
      return
    }

    const ok = await nextStep.action()

    if (!ok) {
      setResult(
        `Auto-Run Next stopped at step ${nextStep.id}: ${nextStep.title}. Resolve the error in Latest Response and retry.`
      )
    }
  }

  async function runAllSteps() {
    const maxIterations = tutorialSteps.length + 2

    for (let i = 0; i < maxIterations; i += 1) {
      const nextIndex = tutorialSteps.findIndex((step, index) => {
        const done = completedSteps.includes(step.id)
        const unlocked = isStepUnlocked(index, step.id)
        return !done && unlocked
      })

      if (nextIndex === -1) {
        setResult('Auto-Run All complete: all tutorial steps are done.')
        return
      }

      const nextStep = tutorialSteps[nextIndex]

      if (!nextStep.action) {
        setResult(
          `Auto-Run paused at manual step ${nextStep.id}: ${nextStep.title}. Complete it, then run Auto-Run All again.`
        )
        return
      }

      const ok = await nextStep.action()

      if (!ok) {
        setResult(
          `Auto-Run stopped at step ${nextStep.id}: ${nextStep.title}. Resolve the error shown in Latest Response and try again.`
        )
        return
      }
    }

    setResult('Auto-Run stopped due to safety limit. Continue manually from the next step.')
  }

  const setupStatus = {
    credentialsReady: email.trim().length > 3 && password.trim().length >= 8,
    progressPercent: Math.round((completedSteps.length / tutorialSteps.length) * 100),
    nextStep: firstIncompleteStepIndex === -1 ? 'Complete' : tutorialSteps[firstIncompleteStepIndex].title
  }

  function getFixInstructions(check: SetupCheckItem) {
    if (check.ok) {
      return [] as string[]
    }

    if (check.key === 'env') {
      const missing = check.details.replace('Missing: ', '').trim()
      return [
        'Open your root .env file and add every missing variable listed above.',
        `Missing now: ${missing || 'See details above'}`,
        'Then restart backend with pnpm dev and run Check Setup again.'
      ]
    }

    if (check.key === 'vaultMasterKey') {
      return [
        'Run pnpm vault:gen-key in project root.',
        'Paste output into VAULT_MASTER_KEY in .env.',
        'Restart backend and run Check Setup again.'
      ]
    }

    if (check.key === 'database') {
      return [
        'Verify DATABASE_URL in .env points to a running PostgreSQL instance.',
        'Confirm username, password, host, port, and db name are correct.',
        'Restart backend after changes and run Check Setup again.'
      ]
    }

    if (check.key === 'usersTable' || check.key === 'vaultTable') {
      return [
        'Create missing tables in PostgreSQL (users and vault_entries).',
        'Then rerun Check Setup to confirm both table checks pass.'
      ]
    }

    if (check.key === 'stripe') {
      return [
        'In Stripe dashboard, copy STRIPE_SECRET_KEY and webhook secret (whsec_...).',
        'Add STRIPE_SUBSCRIPTION_PRICE_ID and STRIPE_CREDIT_PRICE_ID from Stripe Prices.',
        'Save .env, restart backend, and run Check Setup again.'
      ]
    }

    return ['Fix the issue shown in details, then run Check Setup again.']
  }

  async function copyFixInstructions(check: SetupCheckItem) {
    const instructions = getFixInstructions(check)
    const text = [`${check.label}`, ...instructions].join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setCopiedCheckKey(check.key)
      setTimeout(() => {
        setCopiedCheckKey((current) => (current === check.key ? null : current))
      }, 1400)
    } catch {
      setResult('Copy failed. Your browser blocked clipboard access.')
    }
  }

  return (
    <main className="layout">
      <section className="hero">
        <p className="eyebrow">Universal Auth + Stripe</p>
        <h1>Local Frontend Control Panel</h1>
        <p className="subtitle">
          This frontend is wired to your local backend and includes auth, protected routes,
          subscription checkout, and credits purchase actions.
        </p>
        <div className="hero-actions">
          <button type="button" onClick={() => setShowSecurityModal(true)}>
            Security and Privacy
          </button>
        </div>
      </section>

      <section className="panel status-panel">
        <h2>Setup Status</h2>
        <div className="status-grid">
          <div className="status-item">
            <span className="status-label">Credentials</span>
            <strong>{setupStatus.credentialsReady ? 'Ready' : 'Missing'}</strong>
          </div>
          <div className="status-item">
            <span className="status-label">Progress</span>
            <strong>{setupStatus.progressPercent}%</strong>
          </div>
          <div className="status-item">
            <span className="status-label">Next Step</span>
            <strong>{setupStatus.nextStep}</strong>
          </div>
        </div>
      </section>

      <section className="panel checker-panel">
        <div className="checker-header">
          <h2>Setup Checker</h2>
          <button type="button" disabled={setupCheckLoading} onClick={() => void runSetupCheck()}>
            {setupCheckLoading ? 'Checking...' : 'Check Setup'}
          </button>
        </div>
        <p className="panel-help">
          This checks exactly what is missing for signup, Stripe, vault, and database setup.
        </p>

        {setupCheck ? (
          <>
            <p className={`checker-summary ${setupCheck.ready ? 'ok' : 'bad'}`}>
              {setupCheck.ready
                ? 'Ready: your core setup looks complete.'
                : 'Not ready: complete failed checks below.'}
            </p>
            <div className="checker-list">
              {setupCheck.checks.map((check) => (
                <div key={check.key} className={`checker-item ${check.ok ? 'ok' : 'bad'}`}>
                  <div>
                    <strong>{check.label}</strong>
                    <p>{check.details}</p>
                    {!check.ok ? (
                      <>
                        <ul className="checker-fix-list">
                          {getFixInstructions(check).map((instruction) => (
                            <li key={instruction}>{instruction}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="copy-fix-btn"
                          onClick={() => void copyFixInstructions(check)}
                        >
                          {copiedCheckKey === check.key ? 'Copied' : 'Copy Fix Steps'}
                        </button>
                      </>
                    ) : null}
                  </div>
                  <span>{check.ok ? 'PASS' : 'FIX'}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="checker-empty">Run Check Setup to get a clear missing-items list.</p>
        )}
      </section>

      <section className="panel">
        <h2>Credentials</h2>
        <p className="panel-help">Use your test email and password. Password should be at least 8 characters.</p>
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault()
            void handleLogin()
          }}
        >
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => markStepDone(1)}
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onBlur={() => markStepDone(1)}
              placeholder="••••••••"
              required
            />
          </label>

          <div className="actions">
            <button type="submit" disabled={loading}>
              Login
            </button>
            <button type="button" onClick={() => void handleSignup()} disabled={loading}>
              Signup
            </button>
            <button type="button" onClick={() => void handleLogout()} disabled={loading}>
              Logout
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Auth + Access</h2>
        <p className="panel-help">Run these checks after login to verify middleware, plan rules, and credits.</p>
        <div className="actions grid">
          <button type="button" disabled={loading} onClick={() => void checkCurrentUser()}>
            Current User
          </button>
          <button type="button" disabled={loading} onClick={() => void checkProtectedRoute()}>
            Protected Route
          </button>
          <button type="button" disabled={loading} onClick={() => void checkProRoute()}>
            Pro Feature
          </button>
          <button type="button" disabled={loading} onClick={() => void useAiRoute()}>
            AI Route (Uses Credits)
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Billing</h2>
        <p className="panel-help">These actions open Stripe checkout. Use test keys in development.</p>
        <div className="actions grid">
          <button type="button" disabled={loading} onClick={() => void handleCheckout()}>
            Start Subscription Checkout
          </button>
          <button type="button" disabled={loading} onClick={() => void handleBuyCredits()}>
            Buy Credits
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Latest Response</h2>
        <p className="panel-help">Every API call result appears here. If something fails, read this first.</p>
        <pre>{result}</pre>
      </section>

      <section className="panel tutorial-panel">
        <div className="tutorial-header">
          <h2>App Steps Tutorial</h2>
          <div className="tutorial-header-meta">
            <p>
              Completed {completedSteps.length} / {tutorialSteps.length}
            </p>
            <label className="lock-toggle">
              <input
                type="checkbox"
                checked={lockNextStep}
                onChange={(event) => setLockNextStep(event.target.checked)}
              />
              Lock Next Step
            </label>
            <button type="button" disabled={loading} onClick={() => void runNextStep()}>
              Run Next Step
            </button>
            <button type="button" disabled={loading} onClick={() => void runAllSteps()}>
              Run Remaining Steps
            </button>
          </div>
        </div>
        <div className="security-callout">
          <p>
            Before setup, review security policy.
          </p>
          <button type="button" onClick={() => setShowSecurityModal(true)}>
            Read Security and Privacy
          </button>
        </div>
        <ol className="tutorial-list">
          {tutorialSteps.map((step, index) => {
            const done = completedSteps.includes(step.id)
            const unlocked = isStepUnlocked(index, step.id)

            return (
              <li key={step.id} className={done ? 'is-done' : ''}>
                <div>
                  <h3>
                    Step {step.id}: {step.title}
                  </h3>
                  <p>{step.note}</p>
                </div>
                <div className="tutorial-controls">
                  {step.action ? (
                    <button
                      type="button"
                      disabled={loading || !unlocked}
                      onClick={() => void step.action?.()}
                    >
                      {step.actionLabel}
                    </button>
                  ) : (
                    <span className="manual-step">Manual Step</span>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={done}
                      disabled={!unlocked && !done}
                      onChange={() => markStepDone(step.id)}
                    />
                    Done
                  </label>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      {showSecurityModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Security and Privacy">
          <div className="modal-card">
            <h2>Security and Privacy</h2>
            <p>
              This app secures auth, billing, and key storage with layered controls. Scanning is for
              local integration planning only.
            </p>

            <h3>API Security Measures</h3>
            <ul>
              <li>JWT session in HTTP-only cookies</li>
              <li>Protected middleware for sensitive routes</li>
              <li>Plan and credits access checks</li>
              <li>Stripe webhook signature verification</li>
              <li>Admin-only access for vault endpoints</li>
              <li>Encrypted API vault using AES-256-GCM</li>
            </ul>

            <h3>Scanner Data Policy</h3>
            <ul>
              <li>Scanner reads local project structure and config</li>
              <li>Output is used for setup recommendations only</li>
              <li>Scanner does not auto-send scan data to external services</li>
              <li>Scanner does not auto-push secret values</li>
            </ul>

            <div className="modal-actions">
              <button type="button" onClick={() => setShowSecurityModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default App
