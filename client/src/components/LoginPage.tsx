import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, User as UserIcon, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { ForgeLogo } from './ForgeLogo';

export const LoginPage: React.FC = () => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const clearError = () => setError(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="forge-auth-page">
      <style>{CSS}</style>

      {/* LEFT — brand / instrument panel. Purely presentational; no logic here. */}
      <div className="forge-auth-panel">
        <div className="forge-auth-panel-inner">
          <div className="forge-auth-badge">
            <ForgeLogo size={22} />
            <span>Forge</span>
          </div>

          <div className="forge-auth-panel-copy">
            <span className="forge-auth-eyebrow">AI Test Design Studio</span>
            <h1>Specify it once.<br />Forge writes the rest.</h1>
            <p>Point Forge at a spec, a Jira ticket, or an acceptance criterion and it drafts structured, edit-ready test cases — grouped by module, ranked by priority, ready for your suite.</p>
          </div>

          <ul className="forge-auth-panel-points">
            <li><span className="dot" />Coverage grouped by module &amp; priority</li>
            <li><span className="dot" />Generated cases stay fully editable</li>
            <li><span className="dot" />One workspace per target application</li>
          </ul>
        </div>
        <div className="forge-auth-panel-grid" aria-hidden="true" />
      </div>

      {/* RIGHT — the actual form. */}
      <div className="forge-auth-formside">
        <div className="forge-auth-stack">
          <div className="forge-auth-card">
            <div className="forge-auth-card-meta">
              <h2 className="forge-auth-form-title">
                {mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}
              </h2>
              <p className="forge-auth-form-subtitle">
                {mode === 'login' ? 'Enter your credentials to continue.' : 'Fill in your details to get started.'}
              </p>
            </div>

            {error && (
              <div className="forge-auth-alert" role="alert">
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="forge-auth-fields" noValidate>
              {mode === 'register' && (
                <div className="forge-auth-cell">
                  <label htmlFor="name" className="forge-auth-label">Full name</label>
                  <div className="forge-auth-input-wrap">
                    <UserIcon size={15} className="forge-auth-input-icon" />
                    <input id="name" type="text" placeholder="Jane Doe" value={name} onChange={(e) => { setName(e.target.value); clearError(); }} required autoFocus />
                  </div>
                </div>
              )}

              <div className="forge-auth-cell">
                <label htmlFor="email" className="forge-auth-label">Email address</label>
                <div className="forge-auth-input-wrap">
                  <Mail size={15} className="forge-auth-input-icon" />
                  <input id="email" type="email" placeholder="you@company.com" value={email} onChange={(e) => { setEmail(e.target.value); clearError(); }} required autoFocus={mode === 'login'} />
                </div>
              </div>

              <div className="forge-auth-cell">
                <label htmlFor="password" className="forge-auth-label">Password</label>
                <div className="forge-auth-input-wrap">
                  <Lock size={15} className="forge-auth-input-icon" />
                  <input id="password" type="password" placeholder="••••••••••" value={password} onChange={(e) => { setPassword(e.target.value); clearError(); }} required minLength={8} />
                </div>
              </div>

              <button type="submit" className="forge-auth-submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <><Loader2 size={15} className="forge-auth-spin" /> {mode === 'login' ? 'Signing in…' : 'Creating account…'}</>
                ) : (
                  <>{mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={15} /></>
                )}
              </button>
            </form>

            <div className="forge-auth-split"><span>or</span></div>

            <div className="forge-auth-switch">
              {mode === 'login' ? (
                <span>Don't have an account? <button type="button" onClick={() => { setMode('register'); setError(null); }}>Create one</button></span>
              ) : (
                <span>Already have an account? <button type="button" onClick={() => { setMode('login'); setError(null); }}>Sign in</button></span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const CSS = `
.forge-auth-page { width: 100%; min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F4F5F7; }

/* LEFT PANEL — dark instrument-panel brand side */
.forge-auth-panel { position: relative; background: #14151A; color: #fff; display: flex; flex-direction: column;
  justify-content: space-between; padding: 3rem; overflow: hidden; }
.forge-auth-panel-inner { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 2.5rem; max-width: 460px; }
.forge-auth-panel-grid { position: absolute; inset: 0; opacity: 0.5;
  background-image: linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
  background-size: 34px 34px; mask-image: radial-gradient(circle at 30% 30%, black 0%, transparent 70%); }

.forge-auth-badge { display: flex; align-items: center; gap: 0.6rem; }
.forge-auth-badge svg { color: #fff; }
.forge-auth-badge span { font-family: 'Space Grotesk', sans-serif; font-size: 1.05rem; font-weight: 700; letter-spacing: -0.01em; }

.forge-auth-eyebrow { display: inline-flex; align-items: center; gap: 0.4rem; font-family: 'JetBrains Mono', monospace; font-size: 0.68rem;
  font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #7FD9CF; margin-bottom: 1rem; }
.forge-auth-eyebrow::before { content: ''; width: 6px; height: 6px; background: #7FD9CF; display: inline-block; }
.forge-auth-panel-copy h1 { font-family: 'Space Grotesk', sans-serif; font-size: 2.15rem; font-weight: 700; line-height: 1.18;
  letter-spacing: -0.02em; margin-bottom: 1rem; }
.forge-auth-panel-copy p { font-size: 0.95rem; line-height: 1.6; color: rgba(255,255,255,0.62); max-width: 420px; }

.forge-auth-panel-points { list-style: none; display: flex; flex-direction: column; gap: 0.75rem; padding-top: 0.5rem; }
.forge-auth-panel-points li { display: flex; align-items: center; gap: 0.65rem; font-size: 0.85rem; color: rgba(255,255,255,0.78); }
.forge-auth-panel-points .dot { width: 6px; height: 6px; border-radius: 50%; background: #2A4CE0; flex-shrink: 0; }

/* RIGHT PANEL — form */
.forge-auth-formside { display: flex; align-items: center; justify-content: center; padding: 2.5rem; }
.forge-auth-stack { width: 100%; max-width: 400px; }

.forge-auth-card { background: #fff; }
.forge-auth-card-meta { margin-bottom: 1.75rem; }
.forge-auth-form-title { font-family: 'Space Grotesk', sans-serif; font-size: 1.5rem; font-weight: 700; color: #14151A; letter-spacing: -0.02em; margin-bottom: 0.4rem; }
.forge-auth-form-subtitle { font-size: 0.88rem; color: #7B7F8C; line-height: 1.45; }

.forge-auth-alert { display: flex; align-items: center; gap: 0.5rem; background: rgba(199,64,43,0.08); border: 1px solid rgba(199,64,43,0.25);
  color: #C7402B; border-radius: 10px; padding: 0.75rem 1rem; font-size: 0.82rem; margin-bottom: 1.25rem; }

.forge-auth-fields { display: flex; flex-direction: column; gap: 1.1rem; }
.forge-auth-cell { display: flex; flex-direction: column; gap: 0.45rem; }
.forge-auth-label { font-size: 0.72rem; font-weight: 700; color: #4B4E5A; letter-spacing: 0.04em; text-transform: uppercase; }
.forge-auth-input-wrap { position: relative; display: flex; align-items: center; }
.forge-auth-input-icon { position: absolute; left: 0.9rem; color: #7B7F8C; pointer-events: none; }
.forge-auth-input-wrap input { width: 100%; background: #F5F6F9; border: 1.5px solid rgba(20,21,26,0.10); border-radius: 10px;
  padding: 0.72rem 0.9rem 0.72rem 2.5rem; color: #14151A; font-size: 0.9rem; outline: none; transition: all 0.15s ease; }
.forge-auth-input-wrap input::placeholder { color: #A3A7B3; }
.forge-auth-input-wrap input:focus { border-color: #2A4CE0; background: #fff; box-shadow: 0 0 0 3px rgba(42,76,224,0.14); }

.forge-auth-submit { margin-top: 0.5rem; width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  background: #14151A; color: #fff; font-weight: 600; font-size: 0.9rem; border: none;
  border-radius: 10px; padding: 0.82rem 1rem; cursor: pointer; transition: transform 0.15s, background 0.15s; }
.forge-auth-submit:hover:not(:disabled) { background: #2A4CE0; transform: translateY(-1px); }
.forge-auth-submit:disabled { opacity: 0.55; cursor: not-allowed; }

.forge-auth-split { display: flex; align-items: center; gap: 0.75rem; margin: 1.5rem 0 1.25rem; color: #A3A7B3; font-size: 0.78rem; }
.forge-auth-split::before, .forge-auth-split::after { content: ''; flex: 1; height: 1px; background: rgba(20,21,26,0.08); }
.forge-auth-switch { font-size: 0.85rem; color: #7B7F8C; text-align: center; }
.forge-auth-switch button { background: none; border: none; color: #2A4CE0; font-weight: 700; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }

.forge-auth-spin { animation: forge-auth-rotate 0.9s linear infinite; }
@keyframes forge-auth-rotate { to { transform: rotate(360deg); } }

@media (max-width: 880px) {
  .forge-auth-page { grid-template-columns: 1fr; }
  .forge-auth-panel { display: none; }
  .forge-auth-formside { padding: 1.5rem; }
}
`;
