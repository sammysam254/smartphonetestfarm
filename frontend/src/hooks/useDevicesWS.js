import { useState, useEffect, useRef } from 'react';
import { COORDINATOR_API } from '../lib/config';

export function useDevicesWS(token) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wsError, setWsError] = useState(null);
  const [activeApi, setActiveApi] = useState(COORDINATOR_API);
  const wsRef = useRef(null);

  useEffect(() => {
    const handleApiUpdate = (e) => {
      if (e.detail && e.detail !== activeApi) {
        setActiveApi(e.detail);
      }
    };
    window.addEventListener('coordinator-api-updated', handleApiUpdate);
    return () => window.removeEventListener('coordinator-api-updated', handleApiUpdate);
  }, [activeApi]);

  useEffect(() => {
    if (!token) {
      setDevices([]);
      setLoading(true);
      return;
    }
    let isMounted = true;
    let reconnectTimer;

    const connectWS = () => {
      let wsUrl;
      try {
        wsUrl = new URL(activeApi || COORDINATOR_API);
      } catch (err) {
        console.error('Invalid coordinator API URL for WS:', err);
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
        console.log('WebSocket connected');
        if (isMounted) setWsError(null);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          
          if (!isMounted) return;

          switch (payload.event) {
            case 'DEVICE_LIST_UPDATE':
              setDevices(payload.data || []);
              setLoading(false);
              break;
            case 'DEVICE_STATE_UPDATE':
              setDevices(prev => prev.map(d =>
                d.serial === payload.data.serial
                  ? { ...d, ...payload.data }
                  : d
              ));
              break;
            case 'DEVICE_CLAIMED':
              console.log('Device claimed:', payload.data);
              // Optimistically update device list if needed, though DEVICE_LIST_UPDATE will catch it shortly
              setDevices(prev => prev.map(d => 
                d.serial === payload.data.serial 
                  ? { ...d, status: 'claimed', stream_port: payload.data.port }
                  : d
              ));
              break;
            case 'DEVICE_RELEASED':
              console.log('Device released:', payload.data);
              // Do not blindly force idle here. A disconnect can race with release,
              // and the backend may already have transitioned the device to offline.
              setDevices(prev => prev.map(d => 
                d.serial === payload.data.serial 
                  ? {
                      ...d,
                      status: payload.data.status || (d.status === 'offline' ? 'offline' : 'idle'),
                      stream_port: 0,
                    }
                  : d
              ));
              break;
            default:
              console.log('Unknown WS event:', payload.event);
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting in 2s...');
        if (isMounted) {
          reconnectTimer = setTimeout(connectWS, 2000);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
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

  return { devices, loading, wsError, setDevices };
}
