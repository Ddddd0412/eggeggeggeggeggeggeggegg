const TOKEN_KEY = 'authToken';
const USER_KEY = 'currentUser';
const LAST_MEETING_KEY = 'lastExtractionMeetingId';

// 清除登录状态
function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// 所有普通 JSON 请求统一从这里发送
async function request(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);

  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error('服务器返回数据格式错误');
  }

  if (!response.ok || result.success === false) {
    if (response.status === 401) {
      clearSession();
    }

    throw new Error(
      result?.error?.message ||
        result?.error ||
        `请求失败：${response.status}`
    );
  }

  // 兼容两种后端返回：
  // 1. { success: true, data: ... }
  // 2. 直接返回数据
  return result.data ?? result;
}


// ====================
// 用户
// ====================

export async function register(data) {
  const payload = {
    username: data.username,
    email: data.email,
    password: data.password,
    teamName: data.teamName,
    role: data.role,
  };

  const result = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return result.user ?? result;
}

export async function login(data) {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  if (result.token) {
    localStorage.setItem(TOKEN_KEY, result.token);
  }

  const user = result.user ?? result;
  localStorage.setItem(USER_KEY, JSON.stringify(user));

  return user;
}

export async function logout() {
  try {
    await request('/api/auth/logout', {
      method: 'POST',
    });
  } finally {
    clearSession();
  }
}

export async function getCurrentUser() {
  const cachedUser = localStorage.getItem(USER_KEY);

  try {
    const result = await request('/api/auth/me');
    const user = result.user ?? result;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  } catch {
    return cachedUser ? JSON.parse(cachedUser) : null;
  }
}


// ====================
// 团队
// ====================

export async function getTeamMembers() {
  return request('/api/team/members');
}


// ====================
// 会议
// ====================

export async function getMeetings() {
  return request('/api/meetings');
}

export async function createMeeting(meeting) {
  const meetingDate = meeting.date || meeting.meetingDate;

  return request('/api/meetings', {
    method: 'POST',
    body: JSON.stringify({
      ...meeting,
      // 兼容后端 date / meetingDate 两种字段名，避免“日期已选但后端提示为空”
      date: meetingDate,
      meetingDate,
    }),
  });
}

export async function updateMeeting(id, meeting) {
  const meetingDate = meeting.date || meeting.meetingDate;

  return request(`/api/meetings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...meeting,
      date: meetingDate,
      meetingDate,
    }),
  });
}


// ====================
// 文件 / 录音交给 AI 处理
// ====================

// 上传多个会议文件和录音文件给 AI 解析为文本。
// 注意：FormData 请求不要手动设置 Content-Type。
// 浏览器会自动生成 multipart/form-data boundary。
export async function transcribeMeetingFiles(files) {
  if (!files || files.length === 0) {
    throw new Error('请先上传文件或录制音频');
  }

  const token = localStorage.getItem(TOKEN_KEY);
  const formData = new FormData();

  // 统一字段名：files
  // 后端需要支持多文件接收，例如 upload.array('files')
  files.forEach((item) => {
    formData.append('files', item.file, item.name);
  });

  const response = await fetch('/api/meetings/transcribe', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error('AI解析文本结果格式错误');
  }

  if (!response.ok || result.success === false) {
    throw new Error(
      result?.error?.message ||
        result?.error ||
        `AI解析文本失败：${response.status}`
    );
  }

  const data = result.data ?? result;

  // 兼容不同后端返回字段：transcript / text / content
  const transcript = data.transcript || data.text || data.content || '';

  if (!transcript) {
    throw new Error('AI解析结果为空');
  }

  return transcript;
}

// 保留单个录音上传函数，方便旧代码继续调用
export async function transcribeRecording(audioBlob) {
  if (!audioBlob) {
    throw new Error('没有可上传的录音');
  }

  const file = new File([audioBlob], `meeting-recording-${Date.now()}.webm`, {
    type: audioBlob.type || 'audio/webm',
  });

  return transcribeMeetingFiles([
    {
      id: `${Date.now()}-recording`,
      name: file.name,
      type: 'recording',
      file,
    },
  ]);
}


// ====================
// AI任务草稿
// ====================

// 根据会议 id 生成每个人的 JSON 任务草稿。
// 推荐后端流程：读取会议纪要 -> 拼接提示词 -> 调 AI -> 保存 task_drafts -> 返回 drafts。
export async function extractTasks(meeting) {
  const meetingId = typeof meeting === 'object' ? meeting.id : meeting;

  const result = await request('/api/ai/extract', {
    method: 'POST',
    body: JSON.stringify({ meetingId }),
  });

  localStorage.setItem(LAST_MEETING_KEY, String(meetingId));

  return result.drafts ?? result;
}

export async function getDraftTasks() {
  const meetingId = localStorage.getItem(LAST_MEETING_KEY);
  const query = meetingId ? `?meetingId=${meetingId}` : '';

  return request(`/api/ai/drafts${query}`);
}

export async function updateDraft(id, updates) {
  return request(`/api/ai/drafts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteDraft(id) {
  return request(`/api/ai/drafts/${id}`, {
    method: 'DELETE',
  });
}


// ====================
// 管理员审核并分发任务
// ====================

export async function confirmTask(task) {
  // 先把管理员在前端修改后的草稿细节同步给后端
  await updateDraft(task.id, {
    title: task.title,
    assignee: task.assignee,
    deadline: task.deadline,
    priority: task.priority,
    sourceText: task.sourceText,
  });

  // 再把草稿确认成正式任务，分发给对应组员
  return request('/api/tasks/confirm', {
    method: 'POST',
    body: JSON.stringify({
      draftId: task.id,
    }),
  });
}


// ====================
// 正式任务
// ====================

export async function getTasks() {
  return request('/api/tasks');
}

export async function updateTask(id, updates) {
  return request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteTask(id) {
  return request(`/api/tasks/${id}`, {
    method: 'DELETE',
  });
}


// ====================
// 数据统计
// ====================

export async function getStatistics() {
  return request('/api/statistics');
}
