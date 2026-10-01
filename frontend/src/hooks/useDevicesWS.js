import { useState, useEffect, useRef, useCallback } from 'react';
import { COORDINATOR_API, SUPABASE_ENABLED } from '../lib/config';
import { getSupabase } from '../lib/supabase';

export function useDevicesWS(token) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wsError, setWsError] = useState(null);
  const [activeApi, setActiveApi] = useState(COORDINATOR_API);
  const wsRef = useRef(null);

  // 1. Fetch devices directly from Supabase and subscribe to Realtime changes
  const fetchFromSupabase = useCallback(async () => {
    if (!SUPABASE_ENABLED) return;
    const sb = getSupabase();
    if (!sb) return;

    try {
      const { data, error } = await sb
        .from('devices')
        .select('*')
        .order('connected_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        setDevices(data);
        setLoading(false);
      } else if (error) {
        console.warn('Supabase devices query error:', error.message);
      }
    } catch (err) {
      console.warn('Failed to query devices from Supabase:', err);
    }
  }, []);

  useEffect(() => {
    // Initial fetch from Supabase
    fetchFromSupabase();

    if (!SUPABASE_ENABLED) return;
    const sb = getSupabase();
    if (!sb) return;

    // Realtime postgres changes on public.devices table
    const channel = sb
      .channel('devices_realtime_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'devices' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setDevices((prev) => {
              if (prev.some((d) => d.serial === payload.new.serial)) {
                return prev.map((d) =>
                  d.serial === payload.new.serial ? { ...d, ...payload.new } : d
                );
              }
              return [payload.new, ...prev];
            });
            setLoading(false);
          } else if (payload.eventType === 'UPDATE') {
            setDevices((prev) =>
              prev.map((d) =>
                d.serial === payload.new.serial ? { ...d, ...payload.new } : d
              )
            );
          } else if (payload.eventType === 'DELETE') {
            setDevices((prev) => prev.filter((d) => d.serial !== payload.old.serial));
          }
        }
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [fetchFromSupabase]);

  // 2. Listen for coordinator API changes (e.g. tunnel URL discovered)
  useEffect(() => {
    const handleApiUpdate = (e) => {
      if (e.detail && e.detail !== activeApi) {
        setActiveApi(e.detail);
      }
    };
    window.addEventListener('coordinator-api-updated', handleApiUpdate);
    return () => window.removeEventListener('coordinator-api-updated', handleApiUpdate);
  }, [activeApi]);

  // 3. Coordinator WebSocket connection (supplementary for low-latency live telemetry & streaming events)
  useEffect(() => {
    if (!activeApi) return;

    let isMounted = true;
    let reconnectTimer;

    const connectWS = () => {
      let wsUrl;
      try {
        wsUrl = new URL(activeApi);
      } catch (err) {
        return;
      }
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl.pathname = '/api/v1/devices/ws';
      if (token) {
        wsUrl.searchParams.set('token', token);
      }

      const ws = new WebSocket(wsUrl.toString());
      wsRef.current = ws;

      ws.onopen = () => {
        if (isMounted) setWsError(null);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!isMounted) return;

          switch (payload.event) {
            case 'DEVICE_LIST_UPDATE':
              if (Array.isArray(payload.data) && payload.data.length > 0) {
                setDevices(payload.data);
                setLoading(false);
              }
              break;
            case 'DEVICE_STATE_UPDATE':
              setDevices((prev) =>
                prev.map((d) =>
                  d.serial === payload.data.serial ? { ...d, ...payload.data } : d
                )
              );
              break;
            case 'DEVICE_CLAIMED':
              setDevices((prev) =>
                prev.map((d) =>
                  d.serial === payload.data.serial
                    ? { ...d, status: 'claimed', stream_port: payload.data.port }
                    : d
                )
              );
              break;
            case 'DEVICE_RELEASED':
              setDevices((prev) =>
                prev.map((d) =>
                  d.serial === payload.data.serial
                    ? {
                        ...d,
                        status: payload.data.status || (d.status === 'offline' ? 'offline' : 'idle'),
                        stream_port: 0,
                      }
                    : d
                )
              );
              break;
            default:
              break;
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        if (isMounted) {
          reconnectTimer = setTimeout(connectWS, 4000);
        }
      };

      ws.onerror = (err) => {
        if (isMounted) setWsError(err);
        ws.close();
      };
    };

    connectWS();

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token, activeApi]);

  return { devices, loading, wsError, setDevices, refreshDevices: fetchFromSupabase };
}

