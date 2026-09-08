export default function RoleBadge({ role }) {
  return (
    <span className={`role-badge ${role === 'leader' ? 'leader' : 'member'}`}>
      {role === 'leader' ? '组长 / 管理员' : '普通组员'}
    </span>
  );
}
