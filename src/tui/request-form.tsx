import React from 'react';
import {Box, Text, useInput} from 'ink';
import {HTTP_METHODS, type RequestDefinition} from '../core/index.js';
import {InlineInput} from './input.js';
import {KeyHints} from './components.js';
import {methodColor, t} from './theme.js';

export interface Draft {
  name: string;
  folder: string;
  request: RequestDefinition;
}

const fields = ['method', 'url', 'name', 'folder', 'headers', 'auth', 'body'] as const;
type Field = (typeof fields)[number];

const placeholders: Record<Field, string> = {
  method: '',
  url: 'https://api.example.com/v1/users',
  name: 'list users',
  folder: 'users',
  headers: 'content-type: application/json; accept: application/json',
  auth: 'bearer:{{token}}   ·   basic:user:pass   ·   header:X-Key:value',
  body: '{"email": "{{email}}"}',
};

function headersToText(headers?: Record<string, string>): string {
  return Object.entries(headers ?? {}).map(([key, value]) => `${key}: ${value}`).join('; ');
}

function textToHeaders(value: string): Record<string, string> | undefined {
  const entries = value.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf(':');
    return separator < 1 ? [part, ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function authToText(auth: RequestDefinition['auth']): string {
  if (auth?.bearer) return `bearer:${auth.bearer}`;
  if (auth?.basic) return `basic:${auth.basic.user}:${auth.basic.pass}`;
  if (auth?.header) return `header:${auth.header.name}:${auth.header.value}`;
  return '';
}

function textToAuth(value: string): RequestDefinition['auth'] {
  if (!value.trim()) return undefined;
  const [type, first = '', ...rest] = value.split(':');
  if (type === 'bearer') return {bearer: [first, ...rest].join(':')};
  if (type === 'basic') return {basic: {user: first, pass: rest.join(':')}};
  if (type === 'header') return {header: {name: first, value: rest.join(':')}};
  return undefined;
}

/** Method shown as selectable chips so the available verbs are always visible. */
function MethodChips({active}: {active: string}) {
  return <Text>
    {HTTP_METHODS.map((method, index) => (
      <Text key={method}>
        {index > 0 ? ' ' : ''}
        {method === active
          ? <Text backgroundColor={methodColor(method)} color={t.onPill} bold>{` ${method} `}</Text>
          : <Text color={t.faint}>{` ${method} `}</Text>}
      </Text>
    ))}
  </Text>;
}

export function RequestForm({draft, onChange, onFire, onSave, onCancel, width}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onFire: () => void;
  onSave: () => void;
  onCancel: () => void;
  width: number;
}) {
  const [selected, setSelected] = React.useState(1);
  const [typing, setTyping] = React.useState(false);
  const field = fields[selected]!;

  const valueOf = (name: Field): string => {
    if (name === 'name' || name === 'folder') return draft[name];
    if (name === 'method') return draft.request.method;
    if (name === 'headers') return headersToText(draft.request.headers);
    if (name === 'auth') return authToText(draft.request.auth);
    return draft.request[name] ?? '';
  };

  const update = (next: string) => {
    if (field === 'name' || field === 'folder') onChange({...draft, [field]: next});
    else if (field === 'headers') onChange({...draft, request: {...draft.request, headers: textToHeaders(next)}});
    else if (field === 'auth') onChange({...draft, request: {...draft.request, auth: textToAuth(next)}});
    else onChange({...draft, request: {...draft.request, [field]: next}});
  };

  const cycleMethod = (step: number) => {
    const index = HTTP_METHODS.indexOf(draft.request.method);
    const next = HTTP_METHODS[(index + step + HTTP_METHODS.length) % HTTP_METHODS.length]!;
    onChange({...draft, request: {...draft.request, method: next}});
  };

  useInput((input, key) => {
    if (typing) return;
    if (key.escape) onCancel();
    else if (input === 'j' || key.downArrow || key.tab) setSelected((value) => (value + 1) % fields.length);
    else if (input === 'k' || key.upArrow) setSelected((value) => (value - 1 + fields.length) % fields.length);
    else if ((input === 'h' || key.leftArrow) && field === 'method') cycleMethod(-1);
    else if ((input === 'l' || key.rightArrow) && field === 'method') cycleMethod(1);
    else if (key.return && field === 'method') cycleMethod(1);
    else if (key.return || input === 'i') setTyping(true);
    else if (input === 's') onSave();
    else if (input === 'f') onFire();
  });

  const panelWidth = Math.min(width - 6, 84);
  const title = draft.name ? `Edit · ${draft.folder ? `${draft.folder}/` : ''}${draft.name}` : 'New request';
  const ready = Boolean(draft.request.url);

  if (typing) {
    return <Box flexGrow={1} alignItems="center" justifyContent="center">
      <Box flexDirection="column" width={panelWidth} borderStyle="round" borderColor={t.accent} paddingX={2} paddingY={1}>
        <Text color={t.accent} bold>{field.toUpperCase()}</Text>
        <Box marginTop={1}>
          <InlineInput
            label="›"
            value={valueOf(field)}
            onChange={update}
            onSubmit={() => setTyping(false)}
            onCancel={() => setTyping(false)}
            placeholder={placeholders[field]}
          />
        </Box>
        <Box marginTop={1}>
          <KeyHints hints={[['↵', 'apply'], ['^j', 'newline'], ['^u', 'clear'], ['esc', 'done']]} />
        </Box>
      </Box>
    </Box>;
  }

  return <Box flexGrow={1} alignItems="center" justifyContent="center">
    <Box flexDirection="column" width={panelWidth} borderStyle="round" borderColor={t.accent} paddingX={2} paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text color={t.accent} bold>{title}</Text>
        {!ready && <Text color={t.warning}>url required</Text>}
      </Box>

      {fields.map((name, index) => {
        const active = index === selected;
        const raw = valueOf(name);
        const display = raw.replace(/\n/g, ' ↵ ');
        const lineCount = name === 'body' && raw.includes('\n') ? raw.split('\n').length : 0;
        return <Box key={name}>
          <Text color={active ? t.accent : t.faint}>{active ? '▍' : ' '} </Text>
          <Text color={active ? t.accent : t.muted}>{name.toUpperCase().padEnd(8)}</Text>
          {name === 'method'
            ? <MethodChips active={draft.request.method} />
            : display
              ? <Text color={t.text} wrap="truncate-end">
                {display}{lineCount ? <Text color={t.faint}>  ({lineCount} lines)</Text> : null}
              </Text>
              : <Text color={t.faint} wrap="truncate-end">{placeholders[name] || '—'}</Text>}
        </Box>;
      })}

      <Box marginTop={1}>
        <KeyHints hints={
          field === 'method'
            ? [['←→', 'method'], ['↑↓', 'field'], ['f', 'fire'], ['s', 'save'], ['esc', 'back']]
            : [['↵', 'edit'], ['↑↓', 'field'], ['f', 'fire'], ['s', 'save'], ['esc', 'back']]
        } />
      </Box>
    </Box>
  </Box>;
}
