const TOKEN_KEY = 'authToken';
const USER_KEY = 'currentUser';
const LAST_MEETING_KEY = 'lastExtractionMeetingId';

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('服务器返回了无法解析的响应');
  }

  if (!response.ok || !payload.success) {
    if (response.status === 401) {
      clearSession();
      if (window.location.pathname !== '/login') window.location.replace('/login');
    }
    const error = new Error(payload?.error?.message || `请求失败（${response.status}）`);
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    throw error;
  }
  return payload.data;
}

export async function register(payload) {
  const data = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.user;
}

export async function login(credentials) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
}

export async function logout() {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } finally {
    clearSession();
  }
}

export async function getCurrentUser() {
  return request('/api/auth/me');
}

export async function getTeamMembers() {
  return request('/api/team/members');
}

export async function getMeetings() {
  return request('/api/meetings');
}

export async function createMeeting(meeting) {
  return request('/api/meetings', {
    method: 'POST',
    body: JSON.stringify(meeting),
  });
}

export async function updateMeeting(id, updates) {
  return request(`/api/meetings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteMeeting(id) {
  return request(`/api/meetings/${id}`, { method: 'DELETE' });
}

export async function transcribeMeetingAudio(audio, {
  fileName = 'meeting-recording.webm',
  language = 'zh',
  meetingId,
} = {}) {
  const formData = new FormData();
  formData.append('audio', audio, fileName);
  formData.append('language', language);
  if (meetingId) formData.append('meetingId', String(meetingId));
  return request('/api/meetings/transcribe', {
    method: 'POST',
    body: formData,
  });
}

export async function extractTasks(meeting) {
  const meetingId = typeof meeting === 'object' ? meeting.id : meeting;
  const data = await request('/api/ai/extract', {
    method: 'POST',
    body: JSON.stringify({ meetingId }),
  });
  localStorage.setItem(LAST_MEETING_KEY, String(meetingId));
  return data.drafts;
}

export async function getDraftTasks() {
  const meetingId = localStorage.getItem(LAST_MEETING_KEY);
  return request(`/api/ai/drafts${meetingId ? `?meetingId=${meetingId}` : ''}`);
}

export async function updateDraft(id, updates) {
  return request(`/api/ai/drafts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteDraft(id) {
  return request(`/api/ai/drafts/${id}`, { method: 'DELETE' });
}

export async function confirmTask(draft) {
  await updateDraft(draft.id, {
    title: draft.title,
    assignee: draft.assignee,
    deadline: draft.deadline,
    priority: draft.priority,
    sourceText: draft.sourceText,
  });
  return request('/api/tasks/confirm', {
    method: 'POST',
    body: JSON.stringify({ draftId: draft.id }),
  });
}

export async function getTasks() {
  return request('/api/tasks');
}

export async function createTask(task) {
  return request('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(task),
  });
}

export async function updateTask(id, updates) {
  return request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteTask(id) {
  return request(`/api/tasks/${id}`, { method: 'DELETE' });
}

export async function getStatistics() {
  return request('/api/statistics');
}

export async function getAuditLogs() {
  return request('/api/audit-logs');
}

export async function getExtractionRuns() {
  return request('/api/ai/extractions');
}
