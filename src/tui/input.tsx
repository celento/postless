import React from 'react';
import {Box, Text, useInput} from 'ink';
import {t} from './theme.js';

export function InlineInput({
  label,
  value,
  onChange,
  onSubmit,
  onCancel,
  onArrow,
  placeholder = '',
  secret = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Lets a parent overlay steer a result list without losing keystrokes. */
  onArrow?: (direction: -1 | 1) => void;
  placeholder?: string;
  secret?: boolean;
}) {
  useInput((input, key) => {
    if (key.return) onSubmit();
    else if (key.escape) onCancel();
    else if (key.upArrow) onArrow?.(-1);
    else if (key.downArrow) onArrow?.(1);
    else if (key.ctrl && input === 'p') onArrow?.(-1);
    else if (key.ctrl && input === 'n') onArrow?.(1);
    else if (key.backspace || key.delete) onChange(value.slice(0, -1));
    else if (key.ctrl && input === 'u') onChange('');
    else if (key.ctrl && input === 'w') onChange(value.replace(/\s*\S+\s*$/, ''));
    else if (key.ctrl && input === 'j') onChange(`${value}\n`);
    // Arrow/navigation keys arrive with escape-sequence payloads; appending them
    // would inject junk into the field.
    else if (key.leftArrow || key.rightArrow || key.pageUp || key.pageDown || key.tab) return;
    else if (!key.ctrl && !key.meta && input) onChange(value + input);
  });

  const shown = secret ? '•'.repeat(value.length) : value;
  return <Box>
    <Text color={t.accent} bold>{label} </Text>
    {value ? <Text color={t.text}>{shown.replace(/\n/g, '↵')}</Text> : <Text color={t.faint}>{placeholder}</Text>}
    <Text color={t.accent}>▏</Text>
  </Box>;
}
