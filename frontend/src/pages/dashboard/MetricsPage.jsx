import { useEffect, useState, useCallback, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Pause, RefreshCw, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import MetricChart     from '../../components/dashboard/MetricChart'
import LoadingSpinner  from '../../components/common/LoadingSpinner'
import useMetricsStore from '../../store/metricsStore'
import useAuthStore    from '../../store/authStore'
import { getServers }  from '../../api/servers'
import { getMetricsByServer, getLatestMetric, getMetricsByRange } from '../../api/metrics'
import { parseTimestampMs } from '../../utils/time'

const RANGES = [
  { label: '1h',  hours: 1  },
  { label: '6h',  hours: 6  },
  { label: '24h', hours: 24 },
  { label: '7d',  hours: 168 },
]

const metricTimestampMs = (metric) =>
  parseTimestampMs(
    metric?.timestamp ??
    metric?.collectedAt ??
    metric?.createdAt ??
    metric?.time ??
    metric?.ts
  )

export default function MetricsPage() {
  console.log('[MetricsPage] Page is rendering')
  const { metricsByServer, latestByServer, setMetrics, setLatest, appendMetric } = useMetricsStore()
  const { role } = useAuthStore()
  console.log('[MetricsPage] Current role:', role)

  const [servers, setServers]       = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [range, setRange]           = useState(RANGES[0])
  const [live, setLive]             = useState(true)
  const [loading, setLoading]       = useState(false)
  const [loadingServers, setLoadingServers] = useState(true)
  const [serverStatuses, setServerStatuses] = useState({})
  const [serverNamesById, setServerNamesById] = useState({})

  const getMs = (timestamp) => parseTimestampMs(timestamp)
  const isFresh = (timestamp, maxAgeMs = 5 * 60 * 1000) => {
    const ts = getMs(timestamp)
    return Number.isFinite(ts) && Date.now() - ts < maxAgeMs
  }

  // ── Load server list + periodically refresh for status updates ─────────────
  useEffect(() => {
    const load = async () => {
      console.log('[MetricsPage] Starting server fetch...')
      setLoadingServers(true)
      try {
        const srvs = await getServers()
        console.log('[MetricsPage] Got servers:', srvs.length)
        setServers(srvs)
        setServerNamesById(
          Object.fromEntries(srvs.map((s) => [Number(s.id), s.name]))
        )
        if (srvs.length > 0) {
          setSelectedId(srvs[0].id)
        }
        const statuses = {}
        srvs.forEach(s => {
          statuses[s.id] = s.lastSeen ? {
            lastSeen: s.lastSeen,
            isOnline: (Date.now() - parseTimestampMs(s.lastSeen)) < 5 * 60 * 1000
          } : { lastSeen: null, isOnline: false }
        })
        setServerStatuses(statuses)
      } catch (error) {
        console.error('[MetricsPage] Failed to load servers:', error.response?.status, error.message)
        console.error('[MetricsPage] Full error:', error)
      } finally {
        setLoadingServers(false)
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

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [servers, metricsByServer, latestByServer, serverNamesById])

  useEffect(() => {
    if (!serverOptions.length) {
      if (selectedId !== null) {
        setSelectedId(null)
      }
      return
    }

    // Only reset if selectedId is truly invalid (doesn't exist in current options or is null)
    // Don't reset just because serverOptions changed if the selected server still exists
    if (selectedId === null) {
      setSelectedId(serverOptions[0].id)
    } else if (!serverOptions.some((s) => s.id === selectedId)) {
      // Selected server was deleted; pick the first one
      setSelectedId(serverOptions[0].id)
    }
    // If selectedId is valid and exists in serverOptions, keep it (don't reset)
  }, [serverOptions, selectedId])

  // Derive online state from fresh latest metric when no status event is received.
  useEffect(() => {
    setServerStatuses((prev) => {
      const next = { ...prev }

      Object.keys(latestByServer).forEach((id) => {
        const numericId = Number(id)
        const latestTsMs = metricTimestampMs(latestByServer[id])
        if (!Number.isFinite(latestTsMs)) return

        const isOnline = Date.now() - latestTsMs < 5 * 60 * 1000
        next[numericId] = {
          lastSeen: new Date(latestTsMs).toISOString(),
          isOnline,
        }
      })

      return next
    })
  }, [latestByServer])

  // ── Listen for real-time server status changes ───────────────────────
  useEffect(() => {
    const handler = (e) => {
      const { serverId, lastSeen, serverName, status } = e.detail
      const numericId = Number(serverId)
      setServerStatuses(prev => ({
        ...prev,
        [numericId]: {
          lastSeen: lastSeen || prev[numericId]?.lastSeen || null,
          isOnline:
            status === 'ONLINE'
              ? true
              : status === 'OFFLINE'
              ? false
              : isFresh(lastSeen || prev[numericId]?.lastSeen),
        }
      }))
      if (serverName) {
        setServerNamesById((prev) => ({
          ...prev,
          [numericId]: serverName,
        }))
      }
    }
    window.addEventListener('server-status-change', handler)
    return () => window.removeEventListener('server-status-change', handler)
  }, [])

  // ── Fetch metrics for selected server + range ───────────────────────────
  const fetchMetrics = useCallback(async () => {
    if (!selectedId) return
    setLoading(true)
    try {
        const nowMs = Date.now()
      const fromMs = nowMs - (range.hours * 60 * 60 * 1000)

      // Always fetch per-server metrics to avoid mixing data from multiple servers.
      // The backend /api/metrics/range endpoint returns company-wide metrics without server filtering,
      // so we fetch all metrics for the selected server and filter on frontend.
      const allServerMetrics = await getMetricsByServer(selectedId)
      const data = allServerMetrics.filter((m) => {
        const ts = metricTimestampMs(m)
        return Number.isFinite(ts) && ts >= fromMs
      })

      setMetrics(selectedId, data)

      // also fetch latest
      try {
        const latest = await getLatestMetric(selectedId)
        setLatest(selectedId, latest)
      } catch { /* no metrics yet */ }
    } catch {
      toast.error('Failed to load metrics')
    } finally {
      setLoading(false)
    }
  }, [selectedId, range])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  // ── Poll when live mode is enabled ─────────────────────────────────────
  useEffect(() => {
    if (!live || !selectedId) return

    const latestMetric = latestByServer[selectedId]
    const hasRecentMetric = isFresh(latestMetric?.timestamp)
    const isOnline = serverStatuses[selectedId]?.isOnline ?? hasRecentMetric
    if (!isOnline) return

    const id = setInterval(() => {
      fetchMetrics()
    }, 30000)

    return () => clearInterval(id)
  }, [live, selectedId, fetchMetrics, serverStatuses, latestByServer])

  // ── Check if selected server is online ───────────────────────────────
  const selectedServerStatus = selectedId ? serverStatuses[selectedId] : null
  const hasRecentMetric = selectedId ? isFresh(latestByServer[selectedId]?.timestamp) : false
  const isSelectedOnline = selectedServerStatus?.isOnline ?? hasRecentMetric

  const metrics = selectedId ? (metricsByServer[selectedId] || []) : []
  const latest  = selectedId ? latestByServer[selectedId] : null

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="app-panel-soft rounded-[1.75rem] p-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-[#9AA6B2] mb-2">Performance</div>
          <h1 className="page-title">Metrics</h1>
          <p className="page-subtitle">
            Historical and real-time performance data
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">

          {/* Server selector */}
          {loadingServers ? (
            <LoadingSpinner size="sm" />
          ) : (
            <select
              value={selectedId || ''}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="
                bg-[#1f2937] border border-[#374151] rounded-xl
                text-sm text-[#E6EEF2] px-3 py-2.5
                focus:outline-none focus:ring-2 focus:ring-[#3f51b5]/45
              "
              disabled={serverOptions.length === 0}
            >
              {serverOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}

          {/* Time range */}
          <div className="flex items-center bg-[#1f2937] border border-[#374151] rounded-xl p-1">
            {RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => setRange(r)}
                className={`
                  px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${range.label === r.label
                    ? 'bg-[#3f51b5] text-white'
                    : 'text-[#9AA6B2] hover:text-[#E6EEF2]'
                  }
                `}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Live/Pause toggle */}
          <button
            onClick={() => setLive(!live)}
            className={`
              flex items-center gap-2 app-button-sm text-xs font-medium
              border transition-all
              ${live && isSelectedOnline
                ? 'border-[#4CAF50] text-[#4CAF50] bg-[#4CAF50]/10'
                : live && !isSelectedOnline
                ? 'border-[#E53935]/50 text-[#E53935] bg-[#E53935]/10 cursor-not-allowed opacity-60'
                : 'border-[#374151] text-[#9AA6B2] hover:border-[#4b5563]'
              }
            `}
            disabled={!isSelectedOnline}
            title={!isSelectedOnline ? 'Cannot poll offline server' : 'Live updates enabled'}
          >
            {live && isSelectedOnline
              ? <><span className="w-1.5 h-1.5 rounded-full bg-[#4CAF50] animate-pulse" />Live</>
              : live && !isSelectedOnline
              ? <><AlertCircle className="w-3 h-3" />Offline</>
              : <><Pause className="w-3 h-3" />Paused</>
            }
          </button>

          {/* Refresh button */}
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="
              app-button-sm p-2 border border-[#374151]
              text-[#9AA6B2] hover:text-[#E6EEF2]
              hover:border-[#4b5563] transition-all
            "
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Latest metric summary bar */}
      {latest && (
        <div className="
          bg-[#1f2937] border border-[#374151] rounded-2xl
          px-5 py-4 flex items-center gap-6 flex-wrap app-panel-soft
        ">
          <span className="text-xs font-semibold text-[#9AA6B2] uppercase tracking-wider">
            Latest
          </span>
          {[
            { label: 'CPU',    value: latest.cpu,    unit: '%' },
            { label: 'Memory', value: latest.memory, unit: '%' },
            { label: 'Disk',   value: latest.disk,   unit: '%' },
          ].map(({ label, value, unit }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-xs text-[#9AA6B2]">{label}:</span>
              <span className={`text-sm font-bold ${
                value >= 90 ? 'text-[#E53935]' :
                value >= 75 ? 'text-[#FFC107]' :
                'text-[#4CAF50]'
              }`}>
                {value.toFixed(1)}{unit}
              </span>
            </div>
          ))}
          {latest.networkIn && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#9AA6B2]">Net In:</span>
                <span className="text-sm font-bold text-[#E6EEF2]">
                  {latest.networkIn.toFixed(0)} KB/s
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#9AA6B2]">Net Out:</span>
                <span className="text-sm font-bold text-[#E6EEF2]">
                  {latest.networkOut?.toFixed(0) ?? 0} KB/s
                </span>
              </div>
            </>
          )}
          <span className="text-xs text-[#9AA6B2] ml-auto">
            Updated {formatDistanceToNow(new Date(latest.timestamp), { addSuffix: true })}
          </span>
        </div>
      )}

      {/* Charts grid */}
      {loading && metrics.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <MetricChart
            title="CPU Usage"
            data={metrics}
            lines={[{ key: 'cpu', name: 'CPU %', color: '#3f51b5' }]}
            loading={loading}
          />
          <MetricChart
            title="Memory Usage"
            data={metrics}
            lines={[{ key: 'memory', name: 'Memory %', color: '#FFC107' }]}
            loading={loading}
          />
          <MetricChart
            title="Disk Usage"
            data={metrics}
            lines={[{ key: 'disk', name: 'Disk %', color: '#4CAF50' }]}
            loading={loading}
          />
          <MetricChart
            title="Network I/O (KB/s)"
            data={metrics}
            lines={[
              { key: 'networkIn',  name: 'In',  color: '#3f51b5', unit: ' KB/s' },
              { key: 'networkOut', name: 'Out', color: '#E53935', unit: ' KB/s' },
            ]}
            yUnit=" KB/s"
            loading={loading}
          />
        </div>
      )}
    </div>
  )
}