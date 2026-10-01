import React, { useState } from 'react';
import { 
  X, 
  Radio, 
  CheckCircle2, 
  AlertCircle, 
  RotateCcw, 
  ExternalLink,
  ShieldCheck,
  Server
} from 'lucide-react';
import { 
  COORDINATOR_API, 
  getStoredCoordinatorApi, 
  setStoredCoordinatorApi 
} from '../lib/config';
import './TunnelModal.css';

export default function TunnelModal({ isOpen, onClose }) {
  const currentStored = getStoredCoordinatorApi();
  const [tunnelUrl, setTunnelUrl] = useState(currentStored || COORDINATOR_API || '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { success: boolean, msg: string }

  if (!isOpen) return null;

  const handleTest = async () => {
    let url = tunnelUrl.trim().replace(/\/+$/, '');
    if (!url) {
      setTestResult({ success: false, msg: 'Please enter a valid URL.' });
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
      setTunnelUrl(url);
    }

    setTesting(true);
    setTestResult(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${url}/healthz`, { 
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        setTestResult({ success: true, msg: 'Connected successfully to local Coordinator!' });
      } else {
        setTestResult({ success: false, msg: `Server responded with HTTP ${res.status}.` });
      }
    } catch (err) {
      setTestResult({ 
        success: false, 
        msg: err.name === 'AbortError' 
          ? 'Connection timed out. Check your tunnel status.' 
          : 'Could not reach server. Verify tunnel URL & ensure host is running.' 
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    let url = tunnelUrl.trim().replace(/\/+$/, '');
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    setStoredCoordinatorApi(url);
    window.location.reload();
  };

  const handleReset = () => {
    setStoredCoordinatorApi('');
    window.location.reload();
  };

  return (
    <div className="tunnel-modal-overlay" onClick={onClose}>
      <div className="tunnel-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tunnel-modal-header">
          <div className="tunnel-modal-title">
            <Radio size={20} className="tunnel-title-icon" />
            <div>
              <h3>Stream Tunnel & Backend API</h3>
              <p>Connect this dashboard to your local PC stream tunnel</p>
            </div>
          </div>
          <button className="tunnel-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="tunnel-modal-body">
          <div className="tunnel-current-badge">
            <Server size={14} />
            <span>Active Endpoint: <strong>{COORDINATOR_API}</strong></span>
            {currentStored && <span className="tunnel-override-pill">Custom Override</span>}
          </div>

          <div className="tunnel-input-group">
            <label htmlFor="tunnel-url-input">Local Coordinator Tunnel URL</label>
            <p className="tunnel-helper-text">
              Enter your Cloudflare Tunnel hostname (e.g. <code>https://farm.example.com</code> or <code>https://xxx.trycloudflare.com</code>)
            </p>
            <input
              id="tunnel-url-input"
              type="text"
              placeholder="https://your-tunnel.trycloudflare.com"
              value={tunnelUrl}
              onChange={(e) => {
                setTunnelUrl(e.target.value);
                setTestResult(null);
              }}
            />
          </div>

          {testResult && (
            <div className={`tunnel-status-alert ${testResult.success ? 'success' : 'error'}`}>
              {testResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <span>{testResult.msg}</span>
            </div>
          )}

          <div className="tunnel-info-box">
            <ShieldCheck size={16} />
            <div>
              <strong>Hosted on Netlify?</strong>
              <p>
                Netlify serves the web dashboard, while real-time device video and touch control stream through this secure tunnel from your local PC.
              </p>
            </div>
          </div>
        </div>

        <div className="tunnel-modal-footer">
          {currentStored && (
            <button className="tunnel-btn-secondary" onClick={handleReset}>
              <RotateCcw size={14} />
              Reset Default
            </button>
          )}
          <button 
            className="tunnel-btn-test" 
            onClick={handleTest} 
            disabled={testing || !tunnelUrl.trim()}
          >
            {testing ? 'Pinging...' : 'Test Connection'}
          </button>
          <button 
            className="tunnel-btn-primary" 
            onClick={handleSave}
            disabled={!tunnelUrl.trim()}
          >
            Save & Reconnect
          </button>
        </div>
      </div>
    </div>
  );
}
