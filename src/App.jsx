import './App.css'

const tools = [
  {
    href: '/crm/',
    title: 'Investor CRM',
    text: 'Shared list of investors. Add, review and edit records as a team.',
  },
]

function App() {
  return (
    <main className="home">
      <h1>DL3 Investor Tools</h1>
      <p className="lead">Pick a tool to open.</p>
      <div className="tools">
        {tools.map((t) => (
          <a key={t.href} className="tool" href={t.href}>
            <h2>{t.title}</h2>
            <p>{t.text}</p>
            <span className="go">Open →</span>
          </a>
        ))}
      </div>
    </main>
  )
}

export default App
