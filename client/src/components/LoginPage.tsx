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
      <div className="forge-auth-stack">

        <div className="forge-auth-header">
          <div className="forge-auth-badge">
            <ForgeLogo size={26} />
          </div>
          <h1 className="forge-auth-title">OmniTestAI Forge</h1>
          <p className="forge-auth-subtitle">AI TEST CASE GENERATION</p>
        </div>

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
  );
};

const CSS = `
.forge-auth-page { width: 100%; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem;
  background: radial-gradient(circle at 85% 10%, rgba(34, 211, 238, 0.12) 0%, transparent 45%),
              radial-gradient(circle at 15% 85%, rgba(99, 102, 241, 0.14) 0%, transparent 45%),
              #05070d;
  font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.forge-auth-stack { width: 100%; max-width: 440px; display: flex; flex-direction: column; gap: 1.75rem; }

.forge-auth-header { text-align: center; display: flex; flex-direction: column; align-items: center; }
.forge-auth-badge { width: 52px; height: 52px; border-radius: 16px; display: flex; align-items: center; justify-content: center; margin-bottom: 0.75rem;
  background: linear-gradient(135deg, #22d3ee 0%, #6366f1 100%); box-shadow: 0 8px 24px rgba(99, 102, 241, 0.35); }
.forge-auth-title { font-size: 1.4rem; font-weight: 800; letter-spacing: -0.01em;
  background: linear-gradient(135deg, #22d3ee 0%, #818cf8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.forge-auth-subtitle { font-size: 0.65rem; font-weight: 700; color: #6b7a94; letter-spacing: 0.14em; margin-top: 4px; }

.forge-auth-card { background: #121a2b; border: 1px solid rgba(148,163,184,0.14); border-top: 3px solid #22d3ee; border-radius: 18px;
  padding: 2.5rem 2.25rem; box-shadow: 0 20px 45px rgba(0,0,0,0.45); }
.forge-auth-card-meta { margin-bottom: 1.75rem; }
.forge-auth-form-title { font-size: 1.35rem; font-weight: 800; color: #f1f5f9; letter-spacing: -0.02em; margin-bottom: 0.4rem; }
.forge-auth-form-subtitle { font-size: 0.85rem; color: #94a3b8; line-height: 1.45; }

.forge-auth-alert { display: flex; align-items: center; gap: 0.5rem; background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.3);
  color: #f87171; border-radius: 10px; padding: 0.75rem 1rem; font-size: 0.82rem; margin-bottom: 1.25rem; }

.forge-auth-fields { display: flex; flex-direction: column; gap: 1.1rem; }
.forge-auth-cell { display: flex; flex-direction: column; gap: 0.45rem; }
.forge-auth-label { font-size: 0.72rem; font-weight: 800; color: #94a3b8; letter-spacing: 0.04em; text-transform: uppercase; }
.forge-auth-input-wrap { position: relative; display: flex; align-items: center; }
.forge-auth-input-icon { position: absolute; left: 0.9rem; color: #6b7a94; pointer-events: none; }
.forge-auth-input-wrap input { width: 100%; background: #0e1526; border: 1.5px solid rgba(148,163,184,0.16); border-radius: 10px;
  padding: 0.72rem 0.9rem 0.72rem 2.5rem; color: #f1f5f9; font-size: 0.9rem; outline: none; transition: all 0.15s ease; }
.forge-auth-input-wrap input::placeholder { color: #475569; }
.forge-auth-input-wrap input:focus { border-color: #22d3ee; box-shadow: 0 0 0 3px rgba(34,211,238,0.15); }

.forge-auth-submit { margin-top: 0.5rem; width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  background: linear-gradient(135deg, #22d3ee 0%, #6366f1 100%); color: #05070d; font-weight: 700; font-size: 0.9rem; border: none;
  border-radius: 10px; padding: 0.82rem 1rem; cursor: pointer; transition: filter 0.15s, transform 0.15s; }
.forge-auth-submit:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
.forge-auth-submit:disabled { opacity: 0.6; cursor: not-allowed; }

.forge-auth-split { display: flex; align-items: center; gap: 0.75rem; margin: 1.5rem 0 1.25rem; color: #475569; font-size: 0.78rem; }
.forge-auth-split::before, .forge-auth-split::after { content: ''; flex: 1; height: 1px; background: rgba(148,163,184,0.14); }
.forge-auth-switch { font-size: 0.85rem; color: #94a3b8; text-align: center; }
.forge-auth-switch button { background: none; border: none; color: #22d3ee; font-weight: 700; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }

.forge-auth-spin { animation: forge-auth-rotate 0.9s linear infinite; }
@keyframes forge-auth-rotate { to { transform: rotate(360deg); } }
`;
