export default function RoleBadge({ role }) {
  const labels = {
    leader: '组长 / 管理员',
    member: '普通组员',
    teacher: '教师 / 助教（只读）',
  };
  return (
    <span className={`role-badge ${role || 'member'}`}>
      {labels[role] || labels.member}
    </span>
  );
}

