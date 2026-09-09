import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '../api/api';

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(form);
      navigate('/meetings');
    } catch (err) {
      setError(err.message || '登录失败，请检查邮箱和密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-side">
        <div className="brand large">
          <div className="brand-mark">AI</div>
          <div><strong>TaskFlow</strong><span>课程小组会议纪要任务系统</span></div>
        </div>
        <h1>让会议纪要真正变成可执行任务</h1>
        <p>录入会议纪要、AI 提取任务、人工确认、任务看板与团队统计，帮助课程小组更加清晰地完成协同工作。</p>
      </div>

      <form className="auth-card" onSubmit={submit}>
        <h2>登录系统</h2>
        <p className="muted">使用团队账号进入协同工作区</p>
        <label>
          邮箱
          <input
            type="email"
            required
            placeholder="请输入邮箱"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            required
            placeholder="请输入密码"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>
        {error && <div className="error-tip">{error}</div>}
        <button type="submit" className="btn primary full" disabled={loading}>
          {loading ? '登录中...' : '登录'}
        </button>
        <div className="auth-footer">还没有账号？<Link to="/register">注册新账号</Link></div>
      </form>
    </div>
  );
}
