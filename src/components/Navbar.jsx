import { NavLink, useNavigate } from 'react-router-dom';
import RoleBadge from './RoleBadge';
import { logout as logoutApi } from '../api/api';

export default function Navbar({ currentUser }) {
  const navigate = useNavigate();
  const links = [
    ['/meetings', '会议纪要'],
    ['/ai-tasks', 'AI任务确认'],
    ['/tasks', '团队任务看板'],
    ['/my-tasks', '我的任务'],
    ['/statistics', '数据统计'],
  ];
  if (['leader', 'teacher'].includes(currentUser?.role)) links.push(['/records', '系统记录']);

  const logout = async () => {
    await logoutApi().catch(() => {});
    navigate('/login', { replace: true });
  };

  return (
    <aside className="sidebar">
      <div>
        <div className="brand">
          <div className="brand-mark">AI</div>
          <div><strong>TaskFlow</strong><span>课程协同系统</span></div>
        </div>
        <nav className="nav-list">
          {links.map(([path, label]) => (
            <NavLink key={path} to={path} className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="sidebar-user">
        <div className="user-name">{currentUser?.name}</div>
        <RoleBadge role={currentUser?.role} />
        <button className="btn secondary full" onClick={logout}>退出登录</button>
      </div>
    </aside>
  );
}
