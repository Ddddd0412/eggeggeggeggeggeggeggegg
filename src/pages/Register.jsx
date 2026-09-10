import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register } from '../api/api';
import RoleBadge from '../components/RoleBadge';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '', teamName: '', role: 'member' });
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    try {
      await register(form);
      alert('注册成功，请登录');
      navigate('/login');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="auth-page single">
      <form className="auth-card register-card" onSubmit={submit}>
        <h2>创建账号</h2>
        <p className="muted">注册时请选择你在课程小组中的角色</p>
        <div className="form-grid two">
          <label>用户名<input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
          <label>邮箱<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>密码<input type="password" required minLength="6" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <label>确认密码<input type="password" required value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} /></label>
        </div>
        <label>团队名称<input required value={form.teamName} onChange={(e) => setForm({ ...form, teamName: e.target.value })} /></label>
        <div className="field-title">用户角色</div>
        <div className="role-options">
          <label className={`role-card ${form.role === 'leader' ? 'selected' : ''}`}>
            <input type="radio" name="role" value="leader" checked={form.role === 'leader'} onChange={(e) => setForm({ ...form, role: e.target.value })} />
            <div><RoleBadge role="leader" /><strong>创建并管理团队</strong><span>可确认 AI 任务、管理负责人、截止时间、优先级及统计数据。</span></div>
          </label>
          <label className={`role-card ${form.role === 'member' ? 'selected' : ''}`}>
            <input type="radio" name="role" value="member" checked={form.role === 'member'} onChange={(e) => setForm({ ...form, role: e.target.value })} />
            <div><RoleBadge role="member" /><strong>加入并参与协作</strong><span>可查看团队任务、管理自己的任务状态并查看基础统计。</span></div>
          </label>
        </div>
        {error && <div className="error-tip">{error}</div>}
        <button className="btn primary full">注册</button>
        <div className="auth-footer">已有账号？<Link to="/login">返回登录</Link></div>
      </form>
    </div>
  );
}


