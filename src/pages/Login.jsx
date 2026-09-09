import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '../api/api';

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: 'zhangsan@example.com', password: '123456' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(form);
      localStorage.setItem('currentUser', JSON.stringify(user));
      navigate('/meetings');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-side">
        <div className="brand large"><div className="brand-mark">AI</div><div><strong>TaskFlow</strong><span>课程小组会议纪要任务系统</span></div></div>
        <h1>让会议纪要真正变成可执行任务</h1>
        <p>录入纪要、AI 提取、人工确认、任务看板与团队统计，一套适合课程项目展示的完整全栈系统。</p>
        <div className="demo-tip">演示组长：zhangsan@example.com / 123456<br />演示组员：lisi@example.com / 123456<br />教师/助教：teacher@example.com / 123456</div>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <h2>登录系统</h2>
        <p className="muted">使用团队账号进入协同工作区</p>
        <label>邮箱<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>密码<input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        {error && <div className="error-tip">{error}</div>}
        <button className="btn primary full" disabled={loading}>{loading ? '登录中...' : '登录'}</button>
        <div className="auth-footer">还没有账号？<Link to="/register">注册新账号</Link></div>
      </form>
    </div>
  );
}
