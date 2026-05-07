import { useEffect, useRef } from 'react'
import { Client }            from '@stomp/stompjs'
import SockJS                from 'sockjs-client'
import toast                 from 'react-hot-toast'
import useAuthStore          from '../store/authStore'
import useMetricsStore       from '../store/metricsStore'
import useAlertsStore        from '../store/alertsStore'
import { parseTimestampMs }  from '../utils/time'

const WS_URL = import.meta.env.VITE_WS_URL || 
               (window.location.origin.replace('http', 'ws') + '/ws') ||
               'ws://localhost:8080/ws'

const metricTimestamp = (metric) =>
  metric?.timestamp ?? metric?.collectedAt ?? metric?.createdAt ?? metric?.time ?? metric?.ts ?? null

export const useWebSocket = () => {
  const clientRef = useRef(null)

  const { companyId, isAuthenticated } = useAuthStore()
  const { appendMetric }               = useMetricsStore()
  const { prependAlert, incrementCriticalCount } = useAlertsStore()

  useEffect(() => {
    if (!isAuthenticated || !companyId) return

    // ── Create STOMP client with SockJS ──────────────────────────────────
    const client = new Client({
      webSocketFactory: () => new SockJS(WS_URL),
      reconnectDelay:   5000,
      onConnect: () => {
        console.log('[WS] Connected to CloudShadow WebSocket')

        // ── Topic 1: Metrics ─────────────────────────────────────────────
        client.subscribe(
          `/topic/company/${companyId}/metrics`,
          (frame) => {
            try {
              const message = JSON.parse(frame.body)

              // Security: verify companyId matches
              if (Number(message.companyId) !== Number(companyId)) return

              if (message.type === 'NEW_METRIC') {
                const metric = message.data || {}

                // Normalize serverId across possible payload shapes
                const serverId = Number(metric?.serverId ?? metric?.serverID ?? metric?.server?.id)

                // Normalize timestamp field: prefer common keys, keep original if present
                const tsValue = metricTimestamp(metric)

                const normalized = {
                  ...metric,
                  // ensure serverId exists on the metric so stores that expect it work
                  serverId: Number.isFinite(serverId) ? serverId : metric.serverId,
                  // keep existing timestamp keys but also provide a canonical `timestamp` if missing
                  timestamp: metric.timestamp ?? metric.collectedAt ?? metric.createdAt ?? metric.time ?? metric.ts ?? tsValue,
                }

                // Append normalized metric so metricsStore has consistent keys
                appendMetric(normalized)

                const tsMs = parseTimestampMs(normalized.timestamp)

                if (Number.isFinite(serverId) && Number.isFinite(tsMs)) {
                  window.dispatchEvent(
                    new CustomEvent('server-status-change', {
                      detail: {
                        serverId,
                        serverName: normalized?.serverName ?? normalized?.name,
                        lastSeen: new Date(tsMs).toISOString(),
                        status: 'ONLINE',
                      },
                    })
                  )
                }
              }
            } catch (err) {
              console.error('[WS] Error parsing metric message:', err)
            }
          }
        )

        // ── Topic 2: Alerts ──────────────────────────────────────────────
        client.subscribe(
          `/topic/company/${companyId}/alerts`,
          (frame) => {
            try {
              const message = JSON.parse(frame.body)

              if (Number(message.companyId) !== Number(companyId)) return

              if (message.type === 'NEW_ALERT') {
                const alert = message.data

                prependAlert(alert)

                if (alert.severity === 'CRITICAL') {
                  incrementCriticalCount()
                  toast.error(
                    `🚨 CRITICAL alert on ${alert.serverName}: ${alert.type}`,
                    { duration: 6000 }
                  )
                } else {
                  toast(
                    `⚠️ WARNING alert on ${alert.serverName}: ${alert.type}`,
                    {
                      duration: 5000,
                      style: {
                        background: '#1f2937',
                        color: '#FFC107',
                        border: '1px solid #FFC107',
                      },
                    }
                  )
                }
              }
            } catch (err) {
              console.error('[WS] Error parsing alert message:', err)
            }
          }
        )

        // ── Topic 3: Server Status ───────────────────────────────────────
        client.subscribe(
          `/topic/company/${companyId}/status`,
          (frame) => {
            try {
              const message = JSON.parse(frame.body)

              if (Number(message.companyId) !== Number(companyId)) return

              const { serverName, status } = message.data

              if (status === 'ONLINE') {
                toast.success(`🟢 ${serverName} is back online`, {
                  duration: 4000,
                })
              } else if (status === 'OFFLINE') {
                toast.error(`🔴 ${serverName} is offline`, {
                  duration: 6000,
                })
              }

              // Status badge update is handled by serversStore or local state
              // We dispatch a custom event so ServerStatusBadge can react
              window.dispatchEvent(
                new CustomEvent('server-status-change', { detail: message.data })
              )
            } catch (err) {
              console.error('[WS] Error parsing status message:', err)
            }
          }
        )
      },
      onDisconnect: () => {
        console.log('[WS] Disconnected from CloudShadow WebSocket')
      },
      onStompError: (frame) => {
        console.error('[WS] STOMP error:', frame)
      },
    })

    client.activate()
    clientRef.current = client

    // ── Cleanup on unmount or logout ─────────────────────────────────────
    return () => {
      if (clientRef.current) {
        clientRef.current.deactivate()
        clientRef.current = null
      }
    }
  }, [isAuthenticated, companyId])
}