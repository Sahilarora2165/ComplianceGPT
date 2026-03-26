import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Notifications from './components/Notifications'
import Dashboard from './pages/Dashboard'
import Circulars from './pages/Circulars'
import Drafts from './pages/Drafts'
import Query from './pages/Query'
import Clients from './pages/Clients'
import AuditLog from './pages/AuditLog'
import useStore from './store/useStore'
import { healthCheck } from './api/client'

export default function App() {
  const { setBackendOnline } = useStore()

  useEffect(() => {
    const check = async () => {
      try {
        await healthCheck()
        setBackendOnline(true)
      } catch {
        setBackendOnline(false)
      }
    }
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [setBackendOnline])

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-ink-950">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/"          element={<Dashboard />} />
            <Route path="/circulars" element={<Circulars />} />
            <Route path="/drafts"    element={<Drafts />} />
            <Route path="/query"     element={<Query />} />
            <Route path="/clients"   element={<Clients />} />
            <Route path="/audit"     element={<AuditLog />} />
          </Routes>
        </main>
      </div>
      <Notifications />
    </BrowserRouter>
  )
}