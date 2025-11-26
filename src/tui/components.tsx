import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import {METHOD_WIDTH, methodColor, methodLabel, t} from './theme.js';

export function Rule({width, color = t.rule}: {width: number; color?: string}) {
  return <Text color={color}>{'─'.repeat(Math.max(0, width))}</Text>;
}

/** Vertical seam between the two panes — one line, not two adjacent borders. */
export function Seam({height}: {height: number}) {
  return <Box flexDirection="column" width={1}>
    {Array.from({length: Math.max(0, height)}, (_, index) => (
      <Text key={index} color={t.rule}>│</Text>
    ))}
  </Box>;
}

/** Solid badge — used for status codes and the active environment. */
export function Pill({label, color, dim = false}: {label: string; color: string; dim?: boolean}) {
  if (dim) return <Text color={color} bold>{label}</Text>;
  return <Text backgroundColor={color} color={t.onPill} bold>{` ${label} `}</Text>;
}

export function MethodTag({method, muted = false}: {method: string; muted?: boolean}) {
  return <Text color={muted ? t.faint : methodColor(method)} bold={!muted}>{methodLabel(method)}</Text>;
}

/** Small metadata chip: `○ 2 headers`. */
export function Chip({label, color = t.muted, glyph = '○'}: {label: string; color?: string; glyph?: string}) {
  return <Text color={color}>{glyph} {label}</Text>;
}

export type Hint = [key: string, label: string];

/** Footer key hints: bright key, muted description. */
export function KeyHints({hints, separator = '   '}: {hints: Hint[]; separator?: string}) {
  return <Text>
    {hints.map(([key, label], index) => (
      <Text key={key + label}>
        {index > 0 ? separator : ''}
        <Text color={t.accent} bold>{key}</Text>
        <Text color={t.muted}> {label}</Text>
      </Text>
    ))}
  </Text>;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner({color = t.accent}: {color?: string}) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => (value + 1) % SPINNER.length), 80);
    return () => clearInterval(timer);
  }, []);
  return <Text color={color}>{SPINNER[frame]}</Text>;
}

/**
 * Position indicator for the response body. Renders a proportional thumb so a
 * long payload shows how much is off-screen, the way a real editor would.
 */
export function ScrollBar({height, total, offset}: {height: number; total: number; offset: number}) {
  const rows = Math.max(0, height);
  if (total <= rows) {
    return <Box flexDirection="column" width={1}>
      {Array.from({length: rows}, (_, index) => <Text key={index} color={t.rule}>│</Text>)}
    </Box>;
  }
  const thumb = Math.max(1, Math.round((rows / total) * rows));
  const span = Math.max(1, total - rows);
  const start = Math.min(rows - thumb, Math.round((offset / span) * (rows - thumb)));
  return <Box flexDirection="column" width={1}>
    {Array.from({length: rows}, (_, index) => (
      <Text key={index} color={index >= start && index < start + thumb ? t.accent : t.rule}>
        {index >= start && index < start + thumb ? '█' : '│'}
      </Text>
    ))}
  </Box>;
}

/** Centred guidance for empty panes, so blank space never looks like a bug. */
export function EmptyState({title, hints}: {title: string; hints?: Hint[]}) {
  return <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
    <Text color={t.faint}>{title}</Text>
    {hints && <Box marginTop={1}><KeyHints hints={hints} /></Box>}
  </Box>;
}

/**
 * Framed, centred surface for overlays. Ink has no z-index, so instead of
 * blanking the screen we keep the app chrome and float a titled panel inside it.
 */
export function Modal({
  title,
  accent = t.accent,
  width,
  compact = false,
  children,
}: {
  title: string;
  accent?: string;
  width: number;
  /** Drops the vertical breathing room so tall panels still fit short terminals. */
  compact?: boolean;
  children: React.ReactNode;
}) {
  return <Box flexGrow={1} alignItems="center" justifyContent="center">
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={accent}
      paddingX={2}
      paddingY={compact ? 0 : 1}
    >
      <Box marginBottom={compact ? 0 : 1}>
        <Text color={accent} bold>{title}</Text>
      </Box>
      {children}
    </Box>
  </Box>;
}

export const METHOD_COLUMN = METHOD_WIDTH;
