import React, {useMemo} from 'react';
import {Box, Text} from 'ink';
import {foldJsonLines, formatBody, humanBytes, type ResponseResult} from '../core/index.js';
import {Chip, EmptyState, Pill, ScrollBar, Spinner} from './components.js';
import {statusColor, syntax, t} from './theme.js';

const TOKENS = /("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

/**
 * Tokenises a JSON line in a single left-to-right pass. The previous version
 * looked each token up with `indexOf`, which mis-coloured any line where the
 * same token appeared twice.
 */
function highlight(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  TOKENS.lastIndex = 0;
  while ((match = TOKENS.exec(line)) !== null) {
    if (match.index > cursor) {
      nodes.push(<Text key={key++} color={t.text}>{line.slice(cursor, match.index)}</Text>);
    }
    const token = match[0];
    let color: string = t.text;
    if (match[1]) color = /^\s*:/.test(line.slice(match.index + token.length)) ? syntax.key : syntax.string;
    else if (match[2]) color = syntax.number;
    else if (match[3]) color = syntax.literal;
    else if (match[4]) color = syntax.punctuation;
    nodes.push(<Text key={key++} color={color}>{token}</Text>);
    cursor = match.index + token.length;
  }
  if (cursor < line.length) nodes.push(<Text key={key++} color={t.text}>{line.slice(cursor)}</Text>);
  return nodes.length ? nodes : [<Text key="empty"> </Text>];
}

/**
 * The exact text the body pane shows for a given view mode. Shared with the app
 * so search-match line numbers always index the same lines that get rendered —
 * previously the app matched against the raw body while the pane drew the
 * pretty-printed one, so jumping to a match landed on the wrong line.
 */
export function viewContent(response: ResponseResult, showHeaders: boolean, diff?: string): string {
  if (diff) return diff;
  if (showHeaders) {
    return Object.entries(response.headers)
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(`\n${' '.repeat(name.length + 2)}`) : value}`)
      .join('\n');
  }
  return formatBody(response.body, response.contentType);
}

function diffColor(line: string): string {
  if (line.startsWith('+')) return t.success;
  if (line.startsWith('-')) return t.danger;
  if (line.startsWith('@@')) return t.info;
  return t.muted;
}

export function ResponseView({
  response,
  error,
  loading,
  progress,
  scroll,
  height,
  showHeaders,
  diff,
  search,
  matches,
  matchIndex = 0,
  folded = new Set<number>(),
  width = 80,
}: {
  response?: ResponseResult;
  error?: string;
  loading: boolean;
  progress: number;
  scroll: number;
  height: number;
  showHeaders: boolean;
  diff?: string;
  search: string;
  matches: number[];
  matchIndex?: number;
  folded?: Set<number>;
  width?: number;
}) {
  const isJson = Boolean(response && /json/i.test(response.contentType));

  const content = useMemo(
    () => response ? viewContent(response, showHeaders, diff) : '',
    [response, showHeaders, diff],
  );

  const displayLines = useMemo(() => {
    const lines = content.split('\n');
    return !diff && !showHeaders && isJson
      ? foldJsonLines(lines, folded)
      : lines.map((text, sourceIndex) => ({text, sourceIndex, folded: false}));
  }, [content, diff, showHeaders, isJson, folded]);

  const rows = Math.max(1, height);
  const visible = displayLines.slice(scroll, scroll + rows);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const activeMatch = matches[matchIndex];

  if (loading) {
    return <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
      <Box>
        <Spinner />
        <Text color={t.muted}> sending{progress ? ` · ${humanBytes(progress)} received` : '…'}</Text>
      </Box>
    </Box>;
  }

  if (error) {
    return <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
      <Box borderStyle="round" borderColor={t.danger} paddingX={2} flexDirection="column" width={Math.min(width - 4, 64)}>
        <Text color={t.danger} bold>Request failed</Text>
        <Text color={t.text} wrap="wrap">{error}</Text>
      </Box>
    </Box>;
  }

  if (!response) {
    return <EmptyState
      title="No response yet"
      hints={[['↵', 'fire the selected request'], ['n', 'new request'], ['p', 'paste curl']]}
    />;
  }

  const showGutter = !diff && !showHeaders;
  const gutterWidth = showGutter ? String(displayLines.length).length : 0;
  const bodyWidth = Math.max(10, width - gutterWidth - 3);

  return <Box flexDirection="column" flexGrow={1}>
    {/* Status line: badge, timing, size, and whichever view mode is active. */}
    <Box paddingX={1}>
      <Pill label={`${response.status} ${response.statusText}`.trim()} color={statusColor(response.status)} />
      <Text color={t.muted}>  {response.elapsedMs}ms</Text>
      <Text color={t.faint}>  ·  </Text>
      <Text color={t.muted}>{humanBytes(response.bytes)}</Text>
      {response.truncated && <><Text color={t.faint}>  ·  </Text><Chip label="preview" color={t.warning} glyph="◐" /></>}
      {showHeaders && <><Text color={t.faint}>  ·  </Text><Chip label="headers" color={t.info} glyph="▤" /></>}
      {diff && <><Text color={t.faint}>  ·  </Text><Chip label="diff" color={t.violet} glyph="±" /></>}
      {search && <><Text color={t.faint}>  ·  </Text>
        <Chip
          label={`${search}  ${matches.length ? matchIndex + 1 : 0}/${matches.length}`}
          color={matches.length ? t.warning : t.faint}
          glyph="⌕"
        /></>}
    </Box>

    <Box flexGrow={1}>
      <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
        {visible.map((line, index) => {
          const absolute = scroll + index;
          const isMatch = matchSet.has(line.sourceIndex);
          const isActive = activeMatch !== undefined && line.sourceIndex === activeMatch;
          const background = isActive ? t.accentDeep : isMatch ? t.selection : undefined;
          return <Box key={absolute}>
            {showGutter && <Text color={isActive ? t.accent : t.faint}>
              {String(line.sourceIndex + 1).padStart(gutterWidth)}{' '}
            </Text>}
            <Text backgroundColor={background} wrap="truncate-end">
              {line.folded
                ? <Text color={t.muted}>{line.text.slice(0, bodyWidth)}</Text>
                : diff
                  ? <Text color={diffColor(line.text)}>{line.text.slice(0, bodyWidth) || ' '}</Text>
                  : isJson
                    ? highlight(line.text.slice(0, bodyWidth))
                    : <Text color={t.text}>{line.text.slice(0, bodyWidth) || ' '}</Text>}
            </Text>
          </Box>;
        })}
      </Box>
      <ScrollBar height={rows} total={displayLines.length} offset={scroll} />
    </Box>
  </Box>;
}
