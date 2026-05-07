import { useEffect, useState, useMemo } from 'react'
import { Link }                          from 'react-router-dom'
import { Cpu, HardDrive, MemoryStick, AlertTriangle, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import StatCard        from '../../components/dashboard/StatCard'
import MetricChart     from '../../components/dashboard/MetricChart'
import AlertCard       from '../../components/dashboard/AlertCard'
import ServerStatusBadge from '../../components/dashboard/ServerStatusBadge'
import useMetricsStore from '../../store/metricsStore'
import useAlertsStore  from '../../store/alertsStore'
import useAuthStore    from '../../store/authStore'
import { getServers }           from '../../api/servers'
import { getLatestMetric, getMetricsByServer } from '../../api/metrics'
import { parseTimestampMs } from '../../utils/time'

const getMetricStatus = (value) => {
  if (value >= 90) return 'danger'
  if (value >= 75) return 'warning'
  return 'normal'
}

export default function OverviewPage() {
  console.log('[OverviewPage] Page is rendering')
  const { metricsByServer, latestByServer, setMetrics, setLatest } = useMetricsStore()
  const { alerts, criticalCount } = useAlertsStore()
  const { role } = useAuthStore()
  console.log('[OverviewPage] Current role:', role)

  const [servers, setServers]         = useState([])
  const [selectedId, setSelectedId]   = useState(null)
  const [loading, setLoading]         = useState(true)
  const [loadingCharts, setLoadingCharts] = useState(false)
  const [serverNamesById, setServerNamesById] = useState({})
  const [serverStatusesById, setServerStatusesById] = useState({})

  const getMs = (value) => parseTimestampMs(value)

  const isRecent = (value, maxAgeMs = 5 * 60 * 1000) => {
    const ts = getMs(value)
    return Number.isFinite(ts) && Date.now() - ts < maxAgeMs
  }

  // ── Load servers + their latest metrics + periodically refresh status ────────
  useEffect(() => {
    const load = async () => {
      console.log('[OverviewPage] Starting server fetch...')
      setLoading(true)
      try {
        const srvs = await getServers()
        console.log('[OverviewPage] Got servers:', srvs.length)
        setServers(srvs)
        setServerNamesById(
          Object.fromEntries(srvs.map((s) => [Number(s.id), s.name]))
        )
        setServerStatusesById(
          Object.fromEntries(
            srvs.map((s) => [
              Number(s.id),
              {
                lastSeen: s.lastSeen ?? null,
                status: isRecent(s.lastSeen) ? 'ONLINE' : 'OFFLINE',
              },
            ])
          )
        )

        const latestMap = {}

        // Fetch latest metric for each server in parallel
        await Promise.allSettled(
          srvs.map(async (s) => {
            try {
              const latest = await getLatestMetric(s.id)
              latestMap[s.id] = latest
              setLatest(s.id, latest)
            } catch { /* server may have no metrics */ }
          })
        )

        // Auto-select worst performing server (highest CPU)
        if (srvs.length > 0) {
          const worst = srvs.reduce((prev, curr) => {
            const prevCpu = latestMap[prev.id]?.cpu ?? 0
            const currCpu = latestMap[curr.id]?.cpu ?? 0
            return currCpu > prevCpu ? curr : prev
          })
          setSelectedId(worst.id)
        }
      } catch (error) {
        console.error('[OverviewPage] Failed to load servers:', error.response?.status, error.message)
        console.error('[OverviewPage] Full error:', error)
      } finally {
        setLoading(false)
      }
    }
    load()

    // Refresh server status every 30 seconds so OFFLINE/ONLINE updates are reflected
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  const serverOptions = useMemo(() => {
    const map = new Map()

    const deriveName = (numericId) => {
      const latest = latestByServer[numericId] || latestByServer[String(numericId)]
      if (latest?.serverName) return latest.serverName
      if (latest?.name) return latest.name

      const history = metricsByServer[numericId] || metricsByServer[String(numericId)] || []
      const namedMetric = [...history].reverse().find((m) => m.serverName || m.name)
      if (namedMetric?.serverName) return namedMetric.serverName
      if (namedMetric?.name) return namedMetric.name

      if (serverNamesById[numericId]) return serverNamesById[numericId]
      return `Server #${numericId}`
    }

    servers.forEach((s) => {
      map.set(Number(s.id), {
        id: Number(s.id),
        name: s.name || deriveName(Number(s.id)),
        lastSeen: s.lastSeen ?? null,
      })
    })

    Object.keys(latestByServer).forEach((id) => {
      const numericId = Number(id)
      if (!map.has(numericId)) {
        map.set(numericId, {
          id: numericId,
          name: deriveName(numericId),
          lastSeen: latestByServer[id]?.timestamp ?? null,
        })
      }
    })

    Object.keys(metricsByServer).forEach((id) => {
      const numericId = Number(id)
      if (!map.has(numericId)) {
        map.set(numericId, {
          id: numericId,
          name: deriveName(numericId),
          lastSeen: null,
        })
      }
    })

    Object.keys(serverStatusesById).forEach((id) => {
      const numericId = Number(id)
      if (!map.has(numericId)) {
        map.set(numericId, {
          id: numericId,
          name: deriveName(numericId),
          lastSeen: serverStatusesById[numericId]?.lastSeen ?? null,
        })
      }
    })

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [servers, latestByServer, metricsByServer, serverNamesById, serverStatusesById])

  useEffect(() => {
    const handler = (e) => {
      const { serverId, serverName, lastSeen, status } = e.detail
      const numericId = Number(serverId)
      if (serverName) {
        setServerNamesById((prev) => ({
          ...prev,
          [numericId]: serverName,
        }))
      }

      setServerStatusesById((prev) => ({
        ...prev,
        [numericId]: {
          lastSeen: lastSeen || prev[numericId]?.lastSeen || null,
          status: status || prev[numericId]?.status || null,
        },
      }))
    }

    window.addEventListener('server-status-change', handler)
    return () => window.removeEventListener('server-status-change', handler)
  }, [])

  useEffect(() => {
    if (!serverOptions.length) {
      if (selectedId !== null) {
        setSelectedId(null)
      }
      return
    }

    if (selectedId === null || !serverOptions.some((s) => s.id === selectedId)) {
      setSelectedId(serverOptions[0].id)
    }
  }, [serverOptions, selectedId])

  // ── When selectedId changes, load chart data ──────────────────────────────
  useEffect(() => {
    if (!selectedId) return

    const loadChartData = async (showSpinner = true) => {
      if (showSpinner) setLoadingCharts(true)
      try {
        const metrics = await getMetricsByServer(selectedId)
        setMetrics(selectedId, metrics)

        try {
          const latest = await getLatestMetric(selectedId)
          setLatest(selectedId, latest)
        } catch {
          // Keep chart even if latest endpoint has no data yet.
        }
      } catch { /* empty */ }
      finally {
        if (showSpinner) setLoadingCharts(false)
      }
    }

    loadChartData(true)

    const id = setInterval(() => {
      loadChartData(false)
    }, 10000)

    return () => clearInterval(id)
  }, [selectedId, setMetrics, setLatest])

  // ── Compute averages across all servers ─────────────────────────────────
  const averages = useMemo(() => {
    const vals = Object.values(latestByServer)
    if (!vals.length) return { cpu: null, memory: null, disk: null }
    return {
      cpu:    vals.reduce((a, m) => a + m.cpu,    0) / vals.length,
      memory: vals.reduce((a, m) => a + m.memory, 0) / vals.length,
      disk:   vals.reduce((a, m) => a + m.disk,   0) / vals.length,
    }
  }, [latestByServer])

  // ── Worst server (highest CPU) ───────────────────────────────────────────
  const worstServer = useMemo(() => {
    if (!serverOptions.length) return null
    return serverOptions.reduce((prev, curr) => {
      const p = latestByServer[prev.id]?.cpu ?? 0
      const c = latestByServer[curr.id]?.cpu ?? 0
      return c > p ? curr : prev
    })
  }, [serverOptions, latestByServer])

  const selectedLatest  = selectedId ? latestByServer[selectedId]  : null
  const selectedMetrics = selectedId ? (metricsByServer[selectedId] || []) : []
  const totalServers = serverOptions.length

  const activeServers = useMemo(() => {
    return serverOptions.filter((server) => {
      const latest = latestByServer[server.id] || latestByServer[String(server.id)]
      const history = metricsByServer[server.id] || metricsByServer[String(server.id)] || []
      const latestHistoryTs = history.length ? history[history.length - 1]?.timestamp : null
      const knownStatus = serverStatusesById[server.id]?.status

      if (knownStatus === 'OFFLINE') return false
      if (knownStatus === 'ONLINE') return true

      return (
        isRecent(server.lastSeen) ||
        isRecent(latest?.timestamp) ||
        isRecent(latestHistoryTs)
      )
    }).length
  }, [serverOptions, latestByServer, metricsByServer, serverStatusesById])

  const offlineServers = totalServers - activeServers

  const recentAlerts = [...alerts]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5)

  return (
    <div className="space-y-6">

      {/* Page title */}
      <div className="app-panel-soft rounded-[1.75rem] p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-[#9AA6B2] mb-2">Dashboard</div>
            <h1 className="page-title">Overview</h1>
            <p className="page-subtitle max-w-2xl">
              Real-time view of your infrastructure, live metrics, and recent alerts.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 min-w-[300px] max-w-[420px] w-full sm:w-auto">
            <div className="rounded-2xl bg-white/4 border border-white/6 p-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#9AA6B2]">Active</p>
              <p className="text-xl font-semibold text-[#4CAF50] mt-1">{activeServers}</p>
            </div>
            <div className="rounded-2xl bg-white/4 border border-white/6 p-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#9AA6B2]">Offline</p>
              <p className="text-xl font-semibold text-[#E53935] mt-1">{offlineServers}</p>
            </div>
            <div className="rounded-2xl bg-white/4 border border-white/6 p-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#9AA6B2]">Critical</p>
              <p className="text-xl font-semibold text-[#E6EEF2] mt-1">{criticalCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stat cards row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Avg CPU Usage"
          value={averages.cpu !== null ? averages.cpu.toFixed(1) : null}
          unit="%"
          icon={<Cpu className="w-5 h-5" />}
          status={averages.cpu !== null ? getMetricStatus(averages.cpu) : 'normal'}
          subtitle={`Across ${totalServers} servers`}
          loading={loading}
        />
        <StatCard
          title="Avg Memory Usage"
          value={averages.memory !== null ? averages.memory.toFixed(1) : null}
          unit="%"
          icon={<MemoryStick className="w-5 h-5" />}
          status={averages.memory !== null ? getMetricStatus(averages.memory) : 'normal'}
          subtitle={`Across ${totalServers} servers`}
          loading={loading}
        />
        <StatCard
          title="Avg Disk Usage"
          value={averages.disk !== null ? averages.disk.toFixed(1) : null}
          unit="%"
          icon={<HardDrive className="w-5 h-5" />}
          status={averages.disk !== null ? getMetricStatus(averages.disk) : 'normal'}
          subtitle={`Across ${totalServers} servers`}
          loading={loading}
        />
        <StatCard
          title="Critical Alerts"
          value={criticalCount}
          unit=""
          icon={<AlertTriangle className="w-5 h-5" />}
          status={criticalCount > 0 ? 'danger' : 'normal'}
          subtitle="Requiring attention"
          loading={loading}
        />
      </div>

      {/* ── Middle row: Worst server card + Server selector ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Worst server highlight */}
        {worstServer && (
          <div className="bg-[#1f2937] border border-[#374151] rounded-2xl p-5 app-panel-soft">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-[#9AA6B2] uppercase tracking-wider">
                Highest Load Server
              </p>
              <Link
                to="/dashboard/metrics"
                className="text-xs text-[#3f51b5] hover:text-[#5c6bc0] flex items-center gap-1"
              >
                View metrics <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <h3 className="text-lg font-semibold text-[#E6EEF2] mb-1 font-mono">
              {worstServer.name}
            </h3>
            <ServerStatusBadge
              serverId={worstServer.id}
              lastSeen={worstServer.lastSeen}
            />
            {latestByServer[worstServer.id] && (
              <div className="mt-4 space-y-2">
                {[
                  { label: 'CPU',    value: latestByServer[worstServer.id].cpu,    color: '#3f51b5' },
                  { label: 'Memory', value: latestByServer[worstServer.id].memory, color: '#FFC107' },
                  { label: 'Disk',   value: latestByServer[worstServer.id].disk,   color: '#4CAF50' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#9AA6B2]">{label}</span>
                      <span className="text-[#E6EEF2] font-medium">{value.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#374151] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Server selector */}
        <div className="lg:col-span-2 bg-[#1f2937] border border-[#374151] rounded-2xl p-5 app-panel-soft min-w-0">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-[#E6EEF2]">
              Server Performance
            </p>
            <select
              value={selectedId || ''}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="
                bg-[#0f1724] border border-[#374151] rounded-lg
                text-sm text-[#E6EEF2] px-3 py-1.5 max-w-[180px] truncate
                focus:outline-none focus:ring-2 focus:ring-[#3f51b5]
              "
            >
              {serverOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Mini metric summary */}
          {selectedLatest && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'CPU',    value: selectedLatest.cpu    },
                { label: 'Memory', value: selectedLatest.memory },
                { label: 'Disk',   value: selectedLatest.disk   },
              ].map(({ label, value }) => (
                <div key={label} className="bg-[#0f1724] rounded-lg px-3 py-2 text-center">
                  <p className="text-xs text-[#9AA6B2]">{label}</p>
                  <p className={`text-lg font-bold ${
                    value >= 90 ? 'text-[#E53935]' :
                    value >= 75 ? 'text-[#FFC107]' :
                    'text-[#4CAF50]'
                  }`}>
                    {value.toFixed(1)}%
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* CPU chart */}
          <MetricChart
            title="CPU Usage"
            data={selectedMetrics}
            lines={[{ key: 'cpu', name: 'CPU', color: '#3f51b5', unit: '%' }]}
            loading={loadingCharts}
          />
        </div>
      </div>

      {/* ── Recent alerts ─────────────────────────────────────────────── */}
      <div className="bg-[#1f2937] border border-[#374151] rounded-2xl p-5 app-panel-soft">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[#E6EEF2]">Recent Alerts</h2>
          <Link
            to="/dashboard/alerts"
            className="text-xs text-[#3f51b5] hover:text-[#5c6bc0] flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {recentAlerts.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-[#9AA6B2]">No alerts yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}