import React, { useState } from 'react';
import { 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  Smartphone, 
  Zap, 
  Activity, 
  Sparkles, 
  UserCheck, 
  ArrowRight,
  CheckCircle2,
  Lock
} from 'lucide-react';
import './Login.css';
import { COORDINATOR_API, SUPABASE_ENABLED } from '../lib/config';
import { getSupabase } from '../lib/supabase';

function Login({ onLoginSuccess }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    if (isSignUp && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (isSignUp && password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      if (SUPABASE_ENABLED) {
        const supabase = getSupabase();

        if (isSignUp) {
          // Sign Up flow with Supabase Auth
          const { data, error: sbError } = await supabase.auth.signUp({
            email,
            password,
          });

          if (sbError) throw new Error(sbError.message);

          if (data?.session?.access_token) {
            // Auto sign-in if email confirmation is disabled
            localStorage.setItem('token', data.session.access_token);
            onLoginSuccess(data.session.access_token);
            return;
          } else {
            // Confirmation email sent
            setMessage('Account created! Please check your email to verify your account or sign in below.');
            setIsSignUp(false);
            return;
          }
        } else {
          // Sign In flow
          const { data, error: sbError } = await supabase.auth.signInWithPassword({ 
            email, 
            password 
          });

          if (sbError) throw new Error(sbError.message);
          const token = data?.session?.access_token;
          if (!token) throw new Error('Sign-in succeeded but no session token was received');
          
          localStorage.setItem('token', token);
          onLoginSuccess(token);
          return;
        }
      }

      // Local coordinator fallback
      const endpoint = isSignUp ? '/api/v1/auth/register' : '/api/v1/auth/login';
      const res = await fetch(`${COORDINATOR_API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Authentication failed');
      }

      const data = await res.json();
      if (data.token) {
        localStorage.setItem('token', data.token);
        onLoginSuccess(data.token);
      } else {
        setMessage('Registration complete! Please sign in.');
        setIsSignUp(false);
      }
    } catch (err) {
      setError(err.message || 'Connection to authentication service failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      {/* ── Left Brand Panel with Live Animations ── */}
      <div className="login-brand-panel">
        {/* Animated Ambient Light Orbs */}
        <div className="ambient-orb orb-1"></div>
        <div className="ambient-orb orb-2"></div>
        <div className="ambient-orb orb-3"></div>

        <div className="brand-content">
          <div className="brand-header">
            <div className="brand-logo">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="6" height="6" rx="1.5" />
                <rect x="14" y="4" width="6" height="6" rx="1.5" />
                <rect x="4" y="14" width="6" height="6" rx="1.5" />
                <rect x="14" y="14" width="6" height="6" rx="1.5" />
              </svg>
              <span>FlexPulse</span>
            </div>
            <span className="brand-badge-live">
              <span className="live-dot-pulse"></span>
              Ultra-Low Latency Farm
            </span>
          </div>

          {/* Center Live Device Visual Animation */}
          <div className="live-showcase-container">
            <div className="floating-phone-card">
              <div className="phone-notch"></div>
              
              {/* Phone Screen Mockup with Live Animation */}
              <div className="phone-screen">
                <div className="screen-header">
                  <span className="screen-live-pill">
                    <span className="screen-dot"></span> LIVE 60 FPS
                  </span>
                  <span className="screen-latency">⚡ 12ms</span>
                </div>

                {/* Animated Waveform Display */}
                <div className="screen-visualizer">
                  <div className="vis-bar bar-1"></div>
                  <div className="vis-bar bar-2"></div>
                  <div className="vis-bar bar-3"></div>
                  <div className="vis-bar bar-4"></div>
                  <div className="vis-bar bar-5"></div>
                  <div className="vis-bar bar-6"></div>
                  <div className="vis-bar bar-7"></div>
                  <div className="vis-bar bar-8"></div>
                </div>

                {/* Interactive Touch Simulator Animation */}
                <div className="touch-animation-ring"></div>
                <div className="touch-animation-center"></div>

                <div className="screen-footer">
                  <Smartphone size={13} />
                  <span>Hardware H.264 Stream Active</span>
                </div>
              </div>

              {/* Floating Feature Tags */}
              <div className="floating-tag tag-webrtc">
                <Activity size={12} />
                <span>WebCodecs 4K Native</span>
              </div>
              <div className="floating-tag tag-multitouch">
                <Zap size={12} />
                <span>Multi-Touch Zero Lag</span>
              </div>
            </div>
          </div>

          <div className="brand-hero">
            <h1>Scale your mobile automation with <span className="highlight-brand">FlexPulse</span>.</h1>
            <p>Connect physical Android & iOS smartphones over USB, tunnel low-latency streams globally, and assign dedicated devices to user groups.</p>
          </div>

          <div className="brand-footer">
            <div className="brand-footer-features">
              <span><ShieldCheck size={13} /> Supabase Auth</span>
              <span>•</span>
              <span><Zap size={13} /> Cloudflare Tunnel</span>
              <span>•</span>
              <span><UserCheck size={13} /> Group Tenancy</span>
            </div>
            <span>© {new Date().getFullYear()} FlexPulse. All rights reserved.</span>
          </div>
        </div>
      </div>

      {/* ── Right Form Panel (Sign In & Sign Up) ── */}
      <div className="login-form-panel">
        <div className="login-form-wrapper">
          <div className="form-header">
            <div className="mobile-logo">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="6" height="6" rx="1.5" />
                <rect x="14" y="4" width="6" height="6" rx="1.5" />
                <rect x="4" y="14" width="6" height="6" rx="1.5" />
                <rect x="14" y="14" width="6" height="6" rx="1.5" />
              </svg>
            </div>
            
            {/* Mode Switcher Tabs */}
            <div className="auth-tab-switcher">
              <button 
                type="button" 
                className={`auth-tab ${!isSignUp ? 'active' : ''}`}
                onClick={() => { setIsSignUp(false); setError(''); setMessage(''); }}
              >
                Sign In
              </button>
              <button 
                type="button" 
                className={`auth-tab ${isSignUp ? 'active' : ''}`}
                onClick={() => { setIsSignUp(true); setError(''); setMessage(''); }}
              >
                Sign Up
              </button>
            </div>

            <h2>{isSignUp ? 'Create your account' : 'Sign in to your account'}</h2>
            <p>
              {isSignUp 
                ? 'Register your email to access assigned mobile streams' 
                : 'Enter your credentials to stream your connected devices'}
            </p>
          </div>

          {error && (
            <div className="login-error-alert">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="error-message">
                <span>{error}</span>
              </div>
            </div>
          )}

          {message && (
            <div className="login-success-alert">
              <CheckCircle2 size={18} />
              <span>{message}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="premium-form">
            <div className="premium-input-group">
              <label htmlFor="email">Work Email</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                disabled={loading}
                required
              />
              {email.toLowerCase() === 'sammyseth260@gmail.com' && (
                <span className="super-admin-hint">
                  👑 Super Admin Account
                </span>
              )}
            </div>

            <div className="premium-input-group">
              <div className="password-label-wrapper">
                <label htmlFor="password">Password</label>
              </div>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {isSignUp && (
              <div className="premium-input-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={loading}
                    required
                  />
                </div>
              </div>
            )}

            <button type="submit" className="premium-submit-btn" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner"></span>
                  <span>{isSignUp ? 'Creating Account...' : 'Signing In...'}</span>
                </>
              ) : (
                <>
                  <span>{isSignUp ? 'Create Account' : 'Sign In'}</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="form-toggle-footer">
            {isSignUp ? (
              <p>
                Already have an account?{' '}
                <button 
                  type="button" 
                  className="text-link-btn" 
                  onClick={() => { setIsSignUp(false); setError(''); setMessage(''); }}
                >
                  Sign In
                </button>
              </p>
            ) : (
              <p>
                Don't have an account yet?{' '}
                <button 
                  type="button" 
                  className="text-link-btn" 
                  onClick={() => { setIsSignUp(true); setError(''); setMessage(''); }}
                >
                  Create an account
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
