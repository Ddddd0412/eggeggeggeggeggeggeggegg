import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(serverDirectory, '..');

function loadEnvFile(filePath = path.join(projectRoot, '.env')) {
  if (!fs.existsSync(filePath)) return;

  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function asBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function resolveProjectPath(value) {
  if (path.isAbsolute(value)) return value;
  return path.resolve(projectRoot, value);
}

loadEnvFile();

function defaultTranscriptionUrl(chatUrl) {
  if (!chatUrl) return '';
  return chatUrl.replace(/\/chat\/completions\/?$/, '/audio/transcriptions');
}

export function buildConfig(overrides = {}) {
  const llmApiUrl = overrides.llmApiUrl ?? process.env.LLM_API_URL ?? '';
  const llmApiKey = overrides.llmApiKey ?? process.env.LLM_API_KEY ?? '';
  return {
    port: Number(overrides.port ?? process.env.PORT ?? 3001),
    databasePath: resolveProjectPath(
      overrides.databasePath ?? process.env.TASKFLOW_DB_PATH ?? './data/taskflow.sqlite',
    ),
    tokenTtlHours: Number(overrides.tokenTtlHours ?? process.env.TOKEN_TTL_HOURS ?? 24),
    frontendOrigin: overrides.frontendOrigin ?? process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
    autoSeedDemo: overrides.autoSeedDemo ?? asBoolean(process.env.AUTO_SEED_DEMO, true),
    llmMode: overrides.llmMode ?? process.env.LLM_MODE ?? 'mock',
    llmApiUrl,
    llmApiKey,
    llmModel: overrides.llmModel ?? process.env.LLM_MODEL ?? '',
    llmTimeoutMs: Number(overrides.llmTimeoutMs ?? process.env.LLM_TIMEOUT_MS ?? 30000),
    transcriptionApiUrl: overrides.transcriptionApiUrl ?? process.env.TRANSCRIPTION_API_URL ?? defaultTranscriptionUrl(llmApiUrl),
    transcriptionApiKey: overrides.transcriptionApiKey ?? process.env.TRANSCRIPTION_API_KEY ?? llmApiKey,
    transcriptionModel: overrides.transcriptionModel ?? process.env.TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe',
    transcriptionTimeoutMs: Number(overrides.transcriptionTimeoutMs ?? process.env.TRANSCRIPTION_TIMEOUT_MS ?? 120000),
  };
}
