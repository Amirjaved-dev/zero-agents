export default function Home() {
  const checks = [
    { label: 'Core framework package builds and exports typed modules.', state: 'good' },
    { label: 'Offline agent integration proves tool reuse without live credentials.', state: 'good' },
    { label: '0G, ENS, and AXL paths are implemented but still need a live judge-run setup.', state: 'warn' },
    { label: 'Generated tools run in isolated-vm by default with explicit unsafe fallback.', state: 'good' },
    { label: 'Dashboard is currently a readiness console, not a live event stream yet.', state: 'warn' }
  ];

  const loop = [
    'Task arrives through handleTask() or run().',
    'Registry and experience memory are searched.',
    'StrategyAdapter chooses reuse, generation, improvement, delegation, or rejection.',
    'EvolutionEngine generates, sandboxes, evaluates, and saves approved tools.',
    'ReflectionEngine records what happened for the next run.'
  ];

  return (
    <main className="page-shell">
      <section className="hero" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">ZeroAgent framework dashboard</p>
          <h1 id="page-title">Self-evolving agents, checked like infrastructure.</h1>
          <p className="hero-copy">
            This console summarizes the current framework surface: what works locally,
            what depends on live sponsor infrastructure, and what developers can build on today.
          </p>
        </div>
        <div className="actions" aria-label="Project links">
          <a className="button-link" href="https://github.com/Amirjaved-dev/zero-agents">
            View repository
          </a>
          <a className="button-link secondary" href="/" aria-current="page">
            Readiness console
          </a>
        </div>
      </section>

      <section className="section" aria-labelledby="metrics-title">
        <h2 className="section-title" id="metrics-title">Current Readiness</h2>
        <div className="grid cols-3">
          <article className="card metric">
            <span className="metric-value">Alpha</span>
            <span className="metric-label">Framework maturity</span>
          </article>
          <article className="card metric">
            <span className="metric-value">Core</span>
            <span className="metric-label">Reusable package focus</span>
          </article>
          <article className="card metric">
            <span className="metric-value">Local</span>
            <span className="metric-label">Default developer mode</span>
          </article>
        </div>
      </section>

      <section className="section" aria-labelledby="checks-title">
        <h2 className="section-title" id="checks-title">Build Checks</h2>
        <div className="grid cols-2">
          <article className="card strong">
            <h3>What is working</h3>
            <ul className="status-list">
              {checks.map((check) => (
                <li className="status-item" key={check.label}>
                  <span className={`dot ${check.state}`} aria-hidden="true" />
                  <span>{check.label}</span>
                </li>
              ))}
            </ul>
          </article>
          <article className="card">
            <h3>Developer install path</h3>
            <pre className="code"><code>{'npm install @zero-agents/core\n\nimport { SelfEvolvingAgent } from \'@zero-agents/core\';'}</code></pre>
          </article>
        </div>
      </section>

      <section className="section" aria-labelledby="loop-title">
        <h2 className="section-title" id="loop-title">Framework Loop</h2>
        <div className="card">
          <ol className="flow-list">
            {loop.map((step) => (
              <li className="flow-item" key={step}>
                <span className="dot good" aria-hidden="true" />
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="states-title">
        <h2 className="section-title" id="states-title">Live Stream States</h2>
        <div className="grid cols-3">
          <article className="loading-state">
            <h3>Loading</h3>
            <p>Waiting for an agent event stream.</p>
            <div className="loading-bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </article>
          <article className="empty-state">
            <h3>No events yet</h3>
            <p>Run the demo agent to produce search, generation, sandbox, save, and reuse events.</p>
          </article>
          <article className="error-state">
            <h3>Stream unavailable</h3>
            <p>Check the demo process and retry once the local event API is wired in.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
