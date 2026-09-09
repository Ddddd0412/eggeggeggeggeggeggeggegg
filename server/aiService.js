import { HttpError, isIsoDate } from './utils.js';

export const PROMPT_VERSION = 'task-extraction-v1';

const WEEKDAYS = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

function utcDate(dateText) {
  return new Date(`${dateText}T00:00:00.000Z`);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

/**
 * Resolve common Chinese meeting-date expressions without guessing beyond the text.
 * Returns null whenever the expression is not explicit enough.
 */
export function resolveDueDate(dateText, meetingDate) {
  if (!dateText || !isIsoDate(meetingDate)) return null;
  const text = String(dateText).replace(/\s+/g, '');

  const iso = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?/);
  if (iso) {
    const candidate = `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
    return isIsoDate(candidate) ? candidate : null;
  }

  const monthDay = text.match(/(\d{1,2})月(\d{1,2})日?/);
  if (monthDay) {
    const year = meetingDate.slice(0, 4);
    const candidate = `${year}-${String(monthDay[1]).padStart(2, '0')}-${String(monthDay[2]).padStart(2, '0')}`;
    return isIsoDate(candidate) ? candidate : null;
  }

  const anchor = utcDate(meetingDate);
  if (text.includes('今天') || text.includes('当天')) return meetingDate;
  if (text.includes('明天') || text.includes('次日')) return formatDate(addDays(anchor, 1));
  if (text.includes('后天')) return formatDate(addDays(anchor, 2));

  const weekday = text.match(/(下周|下星期|本周|这周|本星期|这星期)?(?:周|星期)?([一二三四五六日天])/);
  if (!weekday) return null;

  const targetDay = WEEKDAYS[weekday[2]];
  const currentDay = anchor.getUTCDay() === 0 ? 7 : anchor.getUTCDay();
  const prefix = weekday[1] || '';
  let offset;
  if (prefix === '下周' || prefix === '下星期') {
    offset = 7 - currentDay + targetDay;
  } else if (prefix) {
    offset = targetDay - currentDay;
  } else {
    offset = targetDay - currentDay;
    if (offset < 0) offset += 7;
  }
  return formatDate(addDays(anchor, offset));
}

function normalizePriority(value, text = '') {
  const combined = `${value || ''}${text}`;
  if (/高|紧急|优先|尽快|必须/.test(combined)) return '高';
  if (/低|不急|有空|之后/.test(combined)) return '低';
  if (/中|普通|正常/.test(combined)) return '中';
  return '未指定';
}

function cleanTaskTitle(text, memberNames) {
  let title = String(text || '').trim();
  for (const name of memberNames) title = title.replace(name, '');
  title = title
    .replace(/(?:下周|下星期|本周|这周|本星期|这星期|周|星期)[一二三四五六日天](?:前|之前|以前|截止)?/g, '')
    .replace(/(?:今天|当天|明天|后天)(?:前|之前|以前|截止)?/g, '')
    .replace(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:前|之前|截止)?/g, '')
    .replace(/\d{1,2}月\d{1,2}日?(?:前|之前|截止)?/g, '')
    .replace(/^(?:请|由|让|安排|要求|需要|负责|来|需)/, '')
    .replace(/^(?:大家|全体成员|全员)/, '')
    .replace(/(?:负责|来)(?=[\u4e00-\u9fa5A-Za-z])/, '')
    .replace(/(?:前|之前|截止)[，,]?$/, '')
    .replace(/^[，,、:：\s]+|[，,、:：\s]+$/g, '');
  return title;
}

function findDateText(text) {
  const match = String(text).match(
    /(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?|\d{1,2}月\d{1,2}日?|(?:下周|下星期|本周|这周|本星期|这星期|周|星期)[一二三四五六日天]|今天|当天|明天|后天)(?:前|之前|以前|截止)?/,
  );
  return match ? match[0] : null;
}

function normalizeModelTask(rawTask, context) {
  const rawTitle = rawTask?.title ?? rawTask?.task ?? '';
  const title = cleanTaskTitle(rawTitle, []);
  if (!title) return null;

  const requestedAssignee = String(rawTask?.assignee ?? rawTask?.assignee_name ?? '').trim();
  const member = context.members.find((item) => item.name === requestedAssignee) || null;
  const dueDateText = String(rawTask?.due_date_text ?? rawTask?.deadline_text ?? '').trim() || null;
  const rawDueDate = String(rawTask?.due_date ?? rawTask?.deadline ?? '').trim();
  const dueDate = isIsoDate(rawDueDate)
    ? rawDueDate
    : resolveDueDate(dueDateText || rawDueDate, context.meetingDate);
  const sourceQuote = String(rawTask?.source_quote ?? rawTask?.sourceText ?? '').trim();
  const quoteIsValid = Boolean(sourceQuote) && context.content.includes(sourceQuote);
  const reasons = [];
  if (!member) reasons.push(requestedAssignee ? `负责人“${requestedAssignee}”不是当前团队成员` : '负责人不明确');
  if (!dueDate) reasons.push('截止时间不明确');
  if (!quoteIsValid) reasons.push('原文依据无法在会议纪要中定位');
  if (rawTask?.needs_confirmation && rawTask?.ambiguity_reason) {
    reasons.push(String(rawTask.ambiguity_reason));
  }

  return {
    title: title.slice(0, 200),
    assigneeText: requestedAssignee || null,
    assigneeId: member?.id ?? null,
    dueDateText,
    dueDate,
    priority: normalizePriority(rawTask?.priority, `${title}${sourceQuote}`),
    sourceQuote: quoteIsValid ? sourceQuote : (sourceQuote || title).slice(0, 1000),
    needsConfirmation: reasons.length > 0,
    ambiguityReason: [...new Set(reasons)].join('；') || null,
    originalPayload: rawTask,
  };
}

function extractLocally(context) {
  const memberNames = context.members.map((member) => member.name);
  const sentences = context.content
    .split(/[。；;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const rawTasks = [];

  for (const sentence of sentences) {
    const pieces = sentence.split(/[，,]+/).map((item) => item.trim()).filter(Boolean);
    let sharedDateText = null;
    if (pieces.length > 1 && findDateText(pieces[0]) && !memberNames.some((name) => pieces[0].includes(name))) {
      sharedDateText = findDateText(pieces.shift());
    }

    for (const piece of pieces) {
      const mentioned = context.members.find((member) => piece.includes(member.name));
      const groupAssignee = /大家|全体成员|全员/.test(piece);
      const ownDateText = findDateText(piece);
      const dueDateText = ownDateText || sharedDateText;
      const title = cleanTaskTitle(piece, memberNames);
      if (!title || title.length < 2) continue;
      const ambiguity = [];
      if (groupAssignee) ambiguity.push('“全体成员”需由组长拆分或指定负责人');
      if (!mentioned && !groupAssignee) ambiguity.push('负责人不明确');
      if (!dueDateText) ambiguity.push('截止时间不明确');

      rawTasks.push({
        title,
        assignee: mentioned?.name || (groupAssignee ? '全体成员' : ''),
        due_date_text: dueDateText,
        due_date: resolveDueDate(dueDateText, context.meetingDate),
        priority: normalizePriority(null, piece),
        source_quote: piece,
        needs_confirmation: ambiguity.length > 0,
        ambiguity_reason: ambiguity.join('；'),
      });
    }
  }

  return rawTasks;
}

function buildPrompt(context) {
  const memberList = context.members.map((member) => member.name).join('、');
  return [
    '你是课程小组任务抽取助手。只提取会议中明确要求执行的行动项，不作任何业务决定。',
    '必须输出一个JSON对象，格式为：',
    '{"tasks":[{"title":"任务名称","assignee":"负责人姓名或空字符串","due_date_text":"原始时间表达或空字符串","due_date":"YYYY-MM-DD或空字符串","priority":"高|中|低|未指定","source_quote":"会议原文中的连续原句","needs_confirmation":true,"ambiguity_reason":"原因或空字符串"}]}',
    '规则：负责人只能使用成员名单中的精确姓名；不得补写原文没有的信息；日期以会议日期为基准；不明确则留空并标记needs_confirmation；source_quote必须逐字来自原文；不要输出Markdown。',
    `会议日期：${context.meetingDate}`,
    `团队成员：${memberList}`,
    `会议纪要：${context.content}`,
  ].join('\n');
}

function parseModelJson(content) {
  const normalized = String(content || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  let payload;
  try {
    payload = JSON.parse(normalized);
  } catch {
    throw new HttpError(502, 'INVALID_MODEL_OUTPUT', '大语言模型返回的内容不是合法JSON');
  }
  if (!payload || !Array.isArray(payload.tasks)) {
    throw new HttpError(502, 'INVALID_MODEL_OUTPUT', '大语言模型返回结果缺少tasks数组');
  }
  return payload;
}

async function extractWithCompatibleApi(context, config) {
  if (!config.llmApiUrl || !config.llmApiKey || !config.llmModel) {
    throw new HttpError(503, 'LLM_NOT_CONFIGURED', '真实AI模式尚未配置API地址、密钥或模型名');
  }
  let response;
  try {
    response = await fetch(config.llmApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '严格遵守任务抽取规则并仅返回JSON。' },
          { role: 'user', content: buildPrompt(context) },
        ],
      }),
      signal: AbortSignal.timeout(config.llmTimeoutMs),
    });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'AI接口请求超时' : '无法连接AI接口';
    throw new HttpError(502, 'LLM_REQUEST_FAILED', message);
  }

  const rawResponse = await response.text();
  if (!response.ok) {
    throw new HttpError(502, 'LLM_REQUEST_FAILED', `AI接口调用失败（HTTP ${response.status}）`);
  }
  let envelope;
  try {
    envelope = JSON.parse(rawResponse);
  } catch {
    throw new HttpError(502, 'INVALID_MODEL_RESPONSE', 'AI接口响应不是合法JSON');
  }
  const content = envelope?.choices?.[0]?.message?.content;
  const parsed = parseModelJson(content);
  return { rawTasks: parsed.tasks, rawResponse: envelope };
}

export async function extractTaskDrafts(context, config) {
  const useMock = String(config.llmMode).toLowerCase() !== 'api';
  const provider = useMock ? 'local-mock' : 'openai-compatible';
  const model = useMock ? 'deterministic-rule-v1' : config.llmModel;
  const extraction = useMock
    ? { rawTasks: extractLocally(context), rawResponse: { mode: 'mock', promptVersion: PROMPT_VERSION } }
    : await extractWithCompatibleApi(context, config);

  const tasks = extraction.rawTasks
    .map((rawTask) => normalizeModelTask(rawTask, context))
    .filter(Boolean);

  return {
    provider,
    model,
    promptVersion: PROMPT_VERSION,
    rawResponse: extraction.rawResponse,
    tasks,
  };
}
