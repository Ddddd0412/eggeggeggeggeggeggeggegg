import { useEffect, useState } from 'react';
import { getAuditLogs, getExtractionRuns } from '../api/api';

const entityLabels = {
  meeting: '会议',
  extraction_run: 'AI提取',
  task_draft: '任务草稿',
  task: '正式任务',
  team_member: '团队成员',
};

const actionLabels = {
  created: '创建',
  completed: '完成',
  updated: '修改',
  confirmed: '确认',
  rejected: '拒绝',
  deleted: '删除',
  joined: '加入',
};

function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export default function Records({ currentUser }) {
  const [runs, setRuns] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const canView = ['leader', 'teacher'].includes(currentUser?.role);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    Promise.all([getExtractionRuns(), getAuditLogs()])
      .then(([runData, logData]) => {
        setRuns(runData);
        setLogs(logData);
      })
      .catch((error) => alert(error.message))
      .finally(() => setLoading(false));
  }, [canView]);

  if (!canView) return <div className="permission-banner">仅组长或教师/助教可以查看系统记录。</div>;
  if (loading) return <div className="panel">系统记录加载中...</div>;

  return (
    <div>
      <div className="page-header"><div><h1>系统记录</h1><p>复盘每次 AI 提取结果和人工修改过程。</p></div></div>
      <section className="panel table-panel records-section">
        <div className="records-heading"><h2>AI 提取运行</h2><span>最近 {runs.length} 次</span></div>
        <div className="table-wrap"><table><thead><tr><th>ID</th><th>会议</th><th>提供方 / 模型</th><th>提示词版本</th><th>状态</th><th>草稿数</th><th>开始时间</th><th>错误</th></tr></thead><tbody>
          {runs.map((run) => <tr key={run.id}><td>{run.id}</td><td>{run.meetingTitle}</td><td>{run.provider}<br /><span className="muted">{run.model || '-'}</span></td><td>{run.promptVersion}</td><td><span className={`tag ${run.status === 'succeeded' ? 'status-done' : run.status === 'failed' ? 'status-overdue' : 'status-todo'}`}>{run.status}</span></td><td>{run.draftCount}</td><td>{formatTime(run.createdAt)}</td><td>{run.errorMessage || '-'}</td></tr>)}
          {runs.length === 0 && <tr><td colSpan="8" className="empty">暂无 AI 提取记录</td></tr>}
        </tbody></table></div>
      </section>
      <section className="panel table-panel records-section">
        <div className="records-heading"><h2>人工操作审计</h2><span>最近 {logs.length} 条</span></div>
        <div className="table-wrap"><table><thead><tr><th>时间</th><th>操作人</th><th>对象</th><th>动作</th><th>字段</th><th>修改前</th><th>修改后</th></tr></thead><tbody>
          {logs.map((log) => <tr key={log.id}><td>{formatTime(log.createdAt)}</td><td>{log.userName}</td><td>{entityLabels[log.entityType] || log.entityType} #{log.entityId}</td><td>{actionLabels[log.action] || log.action}</td><td>{log.fieldName || '-'}</td><td className="audit-value">{log.oldValue ?? '-'}</td><td className="audit-value">{log.newValue ?? '-'}</td></tr>)}
          {logs.length === 0 && <tr><td colSpan="7" className="empty">暂无人工修改记录</td></tr>}
        </tbody></table></div>
      </section>
    </div>
  );
}

