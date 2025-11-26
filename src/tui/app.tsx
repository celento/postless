import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useApp, useInput, useStdin} from 'ink';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CookieJar,
  copyToClipboard,
  createFolder,
  deleteFolder,
  deleteRequest,
  diffResponses,
  foldJsonLines,
  fire,
  fuzzySearch,
  loadConfig,
  loadEnvironments,
  loadHistory,
  loadRequests,
  moveRequest,
  parseCurl,
  renameFolder,
  renameRequest,
  resolveRequest,
  saveRequest,
  toCurl,
  type HistoryEntry,
  type PostlessConfig,
  type RequestDefinition,
  type RequestRecord,
  type ResponseResult,
} from '../core/index.js';
import {InlineInput} from './input.js';
import {RequestForm, type Draft} from './request-form.js';
import {ResponseView, viewContent} from './response-view.js';
import {useTerminalSize} from './use-terminal-size.js';
import {Chip, EmptyState, KeyHints, MethodTag, Modal, Rule, Seam, type Hint} from './components.js';
import {METHOD_WIDTH, methodColor, statusColor, t} from './theme.js';

type TreeItem =
  | {kind: 'folder'; id: string; label: string; depth: number; folderPath: string; count: number}
  | {kind: 'request'; id: string; label: string; depth: number; record: RequestRecord}
  | {kind: 'section'; id: string; label: string; depth: number; sectionKey: string; count: number}
  | {kind: 'history'; id: string; label: string; depth: number; entry: HistoryEntry};

type Prompt = {label: string; value: string; placeholder?: string; submit: (value: string) => void | Promise<void>};
type Toast = {text: string; kind: 'info' | 'success' | 'error'};

const HISTORY_KEY = '__history__';

const DEFAULT_KEYS: Record<string, string> = {
  fire: 'enter', edit: 'e', editor: 'E', new: 'n', search: '/', help: '?', delete: 'd',
  reload: 'r', copyResponse: 'y', copyCurl: 'Y', pasteCurl: 'p', headers: 'H', diff: 'D',
  createFolder: 'a', rename: 'R', move: 'm', save: 's', environments: 'v', quit: 'q',
};

interface FolderNode {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  requests: RequestRecord[];
}

function countRequests(node: FolderNode): number {
  let total = node.requests.length;
  for (const child of node.folders.values()) total += countRequests(child);
  return total;
}

/**
 * Flattens the collection into display rows: folders first, then requests,
 * alphabetically at every level. History is a collapsible section at the end.
 */
function buildTree(records: RequestRecord[], history: HistoryEntry[], collapsed: Set<string>): TreeItem[] {
  const root: FolderNode = {name: '', path: '', folders: new Map(), requests: []};
  for (const record of records) {
    let node = root;
    for (const part of record.folder.split('/').filter(Boolean)) {
      let child = node.folders.get(part);
      if (!child) {
        child = {name: part, path: node.path ? `${node.path}/${part}` : part, folders: new Map(), requests: []};
        node.folders.set(part, child);
      }
      node = child;
    }
    node.requests.push(record);
  }

  const output: TreeItem[] = [];
  const walk = (node: FolderNode, depth: number): void => {
    for (const child of [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      output.push({
        kind: 'folder', id: `folder:${child.path}`, label: child.name,
        depth, folderPath: child.path, count: countRequests(child),
      });
      if (!collapsed.has(child.path)) walk(child, depth + 1);
    }
    for (const record of [...node.requests].sort((a, b) => a.name.localeCompare(b.name))) {
      output.push({kind: 'request', id: `request:${record.id}`, label: record.name, depth, record});
    }
  };
  walk(root, 0);

  output.push({kind: 'section', id: 'section:history', label: 'History', depth: 0, sectionKey: HISTORY_KEY, count: history.length});
  if (!collapsed.has(HISTORY_KEY)) {
    for (const entry of history) {
      output.push({
        kind: 'history', id: `history:${entry.id}`, depth: 1, entry,
        label: entry.requestId ?? entry.request.name ?? entry.request.url.replace(/^https?:\/\/|^\{\{[\w.-]+\}\}/, ''),
      });
    }
  }
  return output;
}

function bodyKind(request: RequestDefinition): string {
  if (request.form?.length) return 'form data';
  if (request.body_file) return 'body file';
  if (!request.body) return 'no body';
  return /^\s*[{[]/.test(request.body) ? 'json body' : 'text body';
}

function authKind(request: RequestDefinition): string {
  if (request.auth?.bearer) return 'bearer';
  if (request.auth?.basic) return 'basic';
  if (request.auth?.header) return 'header auth';
  return 'no auth';
}

export function App({cwd = process.cwd()}: {cwd?: string}) {
  const {exit} = useApp();
  const {stdin, setRawMode} = useStdin();
  const {columns, rows} = useTerminalSize();
  const [records, setRecords] = useState<RequestRecord[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [environmentNames, setEnvironmentNames] = useState<string[]>(['default']);
  const [environment, setEnvironment] = useState('default');
  const [config, setConfig] = useState<PostlessConfig>();
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [selected, setSelected] = useState(0);
  const [focus, setFocus] = useState<'tree' | 'response'>('tree');
  const [response, setResponse] = useState<ResponseResult>();
  const [previousResponse, setPreviousResponse] = useState<ResponseResult>();
  const [responseRequestId, setResponseRequestId] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [showHeaders, setShowHeaders] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [bodySearch, setBodySearch] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [folded, setFolded] = useState(new Set<number>());
  const [searchQuery, setSearchQuery] = useState<string>();
  const [searchIndex, setSearchIndex] = useState(0);
  const [pasteValue, setPasteValue] = useState<string>();
  const [showHelp, setShowHelp] = useState(false);
  const [showEnvironments, setShowEnvironments] = useState(false);
  const [cookies, setCookies] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [prompt, setPrompt] = useState<Prompt>();
  const [confirm, setConfirm] = useState<{message: string; detail?: string; action: () => Promise<void>} | undefined>();
  const [toast, setToast] = useState<Toast>();

  /** Every async action funnels through here so a rejection becomes a toast, not a crash. */
  const guard = useCallback((action: () => Promise<unknown>) => {
    void action().catch((failure: any) => setToast({text: failure?.message ?? String(failure), kind: 'error'}));
  }, []);

  useEffect(() => {
    if (!toast || toast.kind === 'error') return;
    const timer = setTimeout(() => setToast(undefined), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const reload = useCallback(async () => {
    const [nextRecords, nextHistory, environments, nextConfig] = await Promise.all([
      loadRequests(cwd), loadHistory(cwd), loadEnvironments(cwd), loadConfig(),
    ]);
    setRecords(nextRecords);
    setHistory(nextHistory);
    const names = Object.keys(environments.environments);
    setEnvironmentNames(names.length ? names : ['default']);
    setEnvironment((current) => names.includes(current) ? current : (environments.default ?? names[0] ?? 'default'));
    setConfig(nextConfig);
  }, [cwd]);

  useEffect(() => { guard(reload); }, [reload, guard]);

  const tree = useMemo(() => buildTree(records, history, collapsed), [records, history, collapsed]);
  useEffect(() => { setSelected((value) => Math.min(value, Math.max(0, tree.length - 1))); }, [tree.length]);
  const selectedItem = tree[selected];
  const selectedRequest = selectedItem?.kind === 'request' ? selectedItem.record.request
    : selectedItem?.kind === 'history' ? selectedItem.entry.request : undefined;
  const currentId = selectedItem?.kind === 'request' ? selectedItem.record.id
    : selectedItem?.kind === 'history' ? selectedItem.entry.requestId : undefined;
  const keyFor = (action: string) => config?.keybindings[action] ?? DEFAULT_KEYS[action];
  const matchesAction = (input: string, key: any, action: string) =>
    keyFor(action) === 'enter' ? key.return : input === keyFor(action);

  const responseDiff = useMemo(
    () => showDiff && previousResponse && response ? diffResponses(previousResponse, response) : undefined,
    [showDiff, previousResponse, response],
  );

  /**
   * The rendered text is derived once per response/mode change rather than on
   * every keystroke, so scrolling a multi-megabyte body stays responsive.
   */
  const viewLines = useMemo(
    () => response ? viewContent(response, showHeaders, responseDiff).split('\n') : [],
    [response, showHeaders, responseDiff],
  );

  const isJson = Boolean(response && /json/i.test(response.contentType));
  const displayLines = useMemo(
    () => !responseDiff && !showHeaders && isJson
      ? foldJsonLines(viewLines, folded)
      : viewLines.map((text, sourceIndex) => ({text, sourceIndex, folded: false})),
    [viewLines, responseDiff, showHeaders, isJson, folded],
  );

  const matchLines = useMemo(
    () => bodySearch
      ? viewLines.map((line, index) => line.toLowerCase().includes(bodySearch.toLowerCase()) ? index : -1).filter((index) => index >= 0)
      : [],
    [viewLines, bodySearch],
  );

  const contentHeight = Math.max(6, rows - 5);
  const bodyHeight = Math.max(3, contentHeight - 4);

  const runRequest = useCallback(async (request: RequestDefinition, requestId?: string) => {
    setLoading(true); setError(undefined); setProgress(0);
    setShowDiff(false); setShowHeaders(false); setScroll(0); setFolded(new Set()); setFocus('response');
    const prior = requestId === undefined
      ? undefined
      : history.find((entry) => entry.requestId === requestId && entry.response)?.response;
    setPreviousResponse(requestId === responseRequestId ? response : prior);
    try {
      const result = await fire(request, {cwd, environment, requestId, onProgress: setProgress});
      setResponse(result); setResponseRequestId(requestId); setToast(undefined);
    } catch (requestError: any) {
      setResponse(undefined); setError(requestError.message);
    } finally {
      setLoading(false);
      await reload().catch(() => undefined);
    }
  }, [cwd, environment, history, reload, response, responseRequestId]);

  const copyCurl = async () => {
    if (!selectedRequest) return;
    const envs = await loadEnvironments(cwd);
    const resolved = resolveRequest(selectedRequest, envs.environments[environment] ?? {});
    setToast({text: copyToClipboard(toCurl(resolved)).message, kind: 'success'});
  };

  const openPathInEditor = async (file: string) => {
    const editor = process.env.EDITOR || process.env.VISUAL;
    if (!editor) { setToast({text: '$EDITOR is not set.', kind: 'error'}); return; }
    try {
      setRawMode(false);
      spawnSync(editor, [file], {stdio: 'inherit', shell: process.platform === 'win32'});
    } finally {
      setRawMode(true); stdin.resume(); await reload().catch(() => undefined);
    }
  };

  const openEnvironmentPanel = async () => {
    const jar = await CookieJar.open(cwd);
    setCookies(jar.get(environment).map((cookie) =>
      `${cookie.name}=${cookie.value.length > 18 ? `${cookie.value.slice(0, 18)}…` : cookie.value}  ${cookie.domain}${cookie.path}${cookie.secure ? '  secure' : ''}`));
    setShowEnvironments(true);
  };

  const cycleEnvironment = (step: number) => setEnvironment((value) => {
    const index = environmentNames.indexOf(value);
    return environmentNames[(index + step + environmentNames.length) % environmentNames.length]!;
  });

  const jumpToMatch = (step: 1 | -1) => {
    if (!matchLines.length) return;
    const next = (matchIndex + step + matchLines.length) % matchLines.length;
    setMatchIndex(next);
    const line = matchLines[next]!;
    const displayIndex = displayLines.findIndex((item) => item.sourceIndex === line);
    setScroll(Math.max(0, (displayIndex >= 0 ? displayIndex : line) - Math.floor(bodyHeight / 3)));
  };

  useInput((input, key) => {
    if (prompt || searchQuery !== undefined || pasteValue !== undefined || draft) return;

    if (confirm) {
      if (input.toLowerCase() === 'y') guard(async () => { try { await confirm.action(); } finally { setConfirm(undefined); } });
      else if (input.toLowerCase() === 'n' || key.escape) setConfirm(undefined);
      return;
    }
    if (showHelp) { if (key.escape || input === '?' || input === 'q') setShowHelp(false); return; }
    if (showEnvironments) {
      if (key.escape || input === 'v' || key.return) setShowEnvironments(false);
      else if (input === 'j' || key.downArrow) cycleEnvironment(1);
      else if (input === 'k' || key.upArrow) cycleEnvironment(-1);
      else if (input === 'c') setConfirm({
        message: `Clear the cookie jar for "${environment}"?`,
        detail: `${cookies.length} cookie${cookies.length === 1 ? '' : 's'} will be removed.`,
        action: async () => {
          const jar = await CookieJar.open(cwd);
          await jar.clear(environment);
          setCookies([]); setToast({text: 'Cookie jar cleared.', kind: 'success'});
        },
      });
      return;
    }

    // ── global ────────────────────────────────────────────────────────────
    if (key.ctrl && input === 'e') { cycleEnvironment(1); return; }
    if (key.tab) { setFocus((value) => value === 'tree' ? 'response' : 'tree'); return; }
    if (key.escape) {
      if (bodySearch) { setBodySearch(''); setMatchIndex(0); }
      else if (showDiff || showHeaders) { setShowDiff(false); setShowHeaders(false); setScroll(0); }
      else if (toast) setToast(undefined);
      else setFocus('tree');
      return;
    }
    if (matchesAction(input, key, 'quit')) { exit(); return; }
    if (matchesAction(input, key, 'help')) { setShowHelp(true); return; }
    if (matchesAction(input, key, 'reload')) {
      guard(async () => { await reload(); setToast({text: 'Reloaded from disk.', kind: 'success'}); });
      return;
    }
    if (matchesAction(input, key, 'pasteCurl')) { setPasteValue(''); return; }
    if (matchesAction(input, key, 'environments')) { guard(openEnvironmentPanel); return; }
    if (matchesAction(input, key, 'search')) {
      if (focus === 'response' && response) {
        setPrompt({label: 'Find in body', value: bodySearch, placeholder: 'substring…', submit: (value) => {
          setBodySearch(value); setMatchIndex(0); setPrompt(undefined);
        }});
      } else { setSearchQuery(''); setSearchIndex(0); }
      return;
    }
    if (matchesAction(input, key, 'headers') && response) { setShowHeaders((value) => !value); setShowDiff(false); setScroll(0); return; }
    if (matchesAction(input, key, 'diff') && response) {
      if (!previousResponse) setToast({text: 'No previous response to diff against.', kind: 'info'});
      else { setShowDiff((value) => !value); setShowHeaders(false); setScroll(0); }
      return;
    }
    if (matchesAction(input, key, 'copyResponse') && response) {
      setToast({text: copyToClipboard(response.body).message, kind: 'success'}); return;
    }
    if (matchesAction(input, key, 'copyCurl')) { guard(copyCurl); return; }
    if (input === 'O' && response?.tempFile) { guard(() => openPathInEditor(response.tempFile!)); return; }
    if (input === 'w' && response?.tempFile) {
      setPrompt({label: 'Write to', value: response.binary ? 'response.bin' : 'response.txt', submit: async (value) => {
        const destination = path.isAbsolute(value) ? value : path.join(cwd, value);
        await fs.copyFile(response.tempFile!, destination);
        setPrompt(undefined); setToast({text: `Saved to ${destination}`, kind: 'success'});
      }});
      return;
    }

    // ── response pane ─────────────────────────────────────────────────────
    if (focus === 'response') {
      const total = displayLines.length;
      if (input === 'j' || key.downArrow) setScroll((value) => Math.min(Math.max(0, total - 1), value + 1));
      else if (input === 'k' || key.upArrow) setScroll((value) => Math.max(0, value - 1));
      else if (key.pageDown) setScroll((value) => Math.min(Math.max(0, total - 1), value + bodyHeight));
      else if (key.pageUp) setScroll((value) => Math.max(0, value - bodyHeight));
      else if (input === 'g') setScroll(0);
      else if (input === 'G') setScroll(Math.max(0, total - bodyHeight));
      else if (input === 'f' && isJson && !showDiff && !showHeaders) {
        const sourceIndex = displayLines[scroll]?.sourceIndex;
        if (sourceIndex !== undefined) setFolded((value) => {
          const next = new Set(value);
          if (next.has(sourceIndex)) next.delete(sourceIndex); else next.add(sourceIndex);
          return next;
        });
      } else if (input === 'n') jumpToMatch(1);
      else if (input === 'N') jumpToMatch(-1);
      return;
    }

    // ── collection tree ───────────────────────────────────────────────────
    const collapseKey = selectedItem?.kind === 'folder' ? selectedItem.folderPath
      : selectedItem?.kind === 'section' ? selectedItem.sectionKey : undefined;
    const toggle = (force?: boolean) => {
      if (collapseKey === undefined) return;
      setCollapsed((value) => {
        const next = new Set(value);
        const shouldCollapse = force ?? !next.has(collapseKey);
        if (shouldCollapse) next.add(collapseKey); else next.delete(collapseKey);
        return next;
      });
    };

    if (input === 'j' || key.downArrow) setSelected((value) => Math.min(tree.length - 1, value + 1));
    else if (input === 'k' || key.upArrow) setSelected((value) => Math.max(0, value - 1));
    else if (input === 'g') setSelected(0);
    else if (input === 'G') setSelected(Math.max(0, tree.length - 1));
    else if (input === 'h' || key.leftArrow) toggle(true);
    else if (input === 'l' || key.rightArrow) toggle(false);
    else if (matchesAction(input, key, 'fire')) {
      if (collapseKey !== undefined) toggle();
      else if (selectedRequest) guard(() => runRequest(selectedRequest, currentId));
      else if (selectedItem?.kind === 'request') setToast({text: selectedItem.record.error ?? 'This request could not be parsed.', kind: 'error'});
    } else if (matchesAction(input, key, 'new')) {
      setDraft({name: '', folder: selectedItem?.kind === 'folder' ? selectedItem.folderPath : '', request: {type: 'http', method: 'GET', url: ''}});
    } else if (matchesAction(input, key, 'edit') && selectedItem?.kind === 'request' && selectedItem.record.request) {
      setDraft({name: selectedItem.record.name, folder: selectedItem.record.folder, request: structuredClone(selectedItem.record.request)});
    } else if (matchesAction(input, key, 'editor') && selectedItem?.kind === 'request') {
      guard(() => openPathInEditor(selectedItem.record.path));
    } else if (matchesAction(input, key, 'delete') && (selectedItem?.kind === 'request' || selectedItem?.kind === 'folder')) {
      setConfirm({
        message: `Delete ${selectedItem.kind} "${selectedItem.label}"?`,
        detail: selectedItem.kind === 'folder'
          ? `${selectedItem.count} request${selectedItem.count === 1 ? '' : 's'} will be deleted from disk.`
          : selectedItem.record.path,
        action: async () => {
          if (selectedItem.kind === 'request') await deleteRequest(selectedItem.record.id, cwd);
          else await deleteFolder(selectedItem.folderPath, cwd);
          await reload();
          setToast({text: `Deleted ${selectedItem.label}.`, kind: 'success'});
        },
      });
    } else if (matchesAction(input, key, 'createFolder')) {
      setPrompt({label: 'New folder', value: '', placeholder: 'users/admin', submit: async (value) => {
        await createFolder(value, cwd); setPrompt(undefined); await reload();
        setToast({text: `Created ${value}.`, kind: 'success'});
      }});
    } else if (matchesAction(input, key, 'rename') && (selectedItem?.kind === 'request' || selectedItem?.kind === 'folder')) {
      setPrompt({label: 'Rename to', value: selectedItem.label, submit: async (value) => {
        if (selectedItem.kind === 'request') await renameRequest(selectedItem.record.id, value, cwd);
        else await renameFolder(selectedItem.folderPath, value, cwd);
        setPrompt(undefined); await reload(); setToast({text: 'Renamed.', kind: 'success'});
      }});
    } else if (matchesAction(input, key, 'move') && selectedItem?.kind === 'request') {
      setPrompt({label: 'Move to folder', value: selectedItem.record.folder, placeholder: 'root', submit: async (value) => {
        await moveRequest(selectedItem.record.id, value, cwd);
        setPrompt(undefined); await reload(); setToast({text: 'Moved.', kind: 'success'});
      }});
    } else if (matchesAction(input, key, 'save') && selectedItem?.kind === 'history') {
      setPrompt({label: 'Save as', value: selectedItem.entry.request.name ?? 'request', submit: async (value) => {
        await saveRequest(selectedItem.entry.request, value, '', cwd);
        setPrompt(undefined); await reload(); setToast({text: `Saved ${value}.`, kind: 'success'});
      }});
    }
  });

  const searchResults = useMemo(
    () => searchQuery === undefined ? [] : fuzzySearch(records, searchQuery).slice(0, 12),
    [records, searchQuery],
  );

  // ── chrome ──────────────────────────────────────────────────────────────
  const treeWidth = Math.max(26, Math.min(40, Math.floor(columns * 0.3)));
  const mainWidth = Math.max(20, columns - treeWidth - 1);

  const contextHints: Hint[] = focus === 'tree'
    ? [['↵', 'fire'], ['e', 'edit'], ['n', 'new'], ['/', 'search'], ['d', 'delete']]
    : [['j/k', 'scroll'], ['/', 'find'], ['H', 'headers'], ['D', 'diff'], ['f', 'fold']];

  const topBar = <Box paddingX={1} justifyContent="space-between">
    <Box>
      <Text color={t.accent}>▍</Text>
      <Text color={t.text} bold>postless</Text>
      <Text color={t.faint}>  ·  </Text>
      <Text color={t.muted}>env </Text>
      <Text color={t.accent} bold>{environment}</Text>
      <Text color={t.faint}> ^e</Text>
    </Box>
    <Box>
      {config && !config.tlsVerify && <Text color={t.danger} bold>⚠ TLS VERIFY OFF  </Text>}
      <Text color={t.faint}>{records.length} request{records.length === 1 ? '' : 's'}</Text>
    </Box>
  </Box>;

  const statusBar = <Box paddingX={1} justifyContent="space-between">
    <KeyHints hints={contextHints} />
    <KeyHints hints={[['⇥', 'pane'], ['?', 'keys'], ['q', 'quit']]} />
  </Box>;

  const toastRow = <Box paddingX={1}>
    {toast
      ? <Text color={toast.kind === 'error' ? t.danger : toast.kind === 'success' ? t.success : t.info} wrap="truncate-end">
        {toast.kind === 'error' ? '✕' : toast.kind === 'success' ? '✓' : 'ℹ'} {toast.text.split('\n')[0]}
      </Text>
      : <Text> </Text>}
  </Box>;

  const shell = (content: React.ReactNode) => <Box flexDirection="column" width={columns} height={rows}>
    {topBar}
    <Rule width={columns} />
    <Box height={contentHeight}>{content}</Box>
    <Rule width={columns} />
    {statusBar}
    {toastRow}
  </Box>;

  // ── overlays ────────────────────────────────────────────────────────────
  const modalWidth = Math.min(columns - 8, 78);

  if (showHelp) return shell(<HelpPanel config={config} width={modalWidth} />);

  if (showEnvironments) {
    return shell(<Modal title="Environments & cookies" width={modalWidth}>
      {environmentNames.map((name) => <Box key={name}>
        <Text color={name === environment ? t.accent : t.faint}>{name === environment ? '▍' : ' '} </Text>
        <Text color={name === environment ? t.accent : t.muted} bold={name === environment}>{name}</Text>
        {name === environment && <Text color={t.faint}>  active</Text>}
      </Box>)}
      <Box marginTop={1}><Text color={t.muted} bold>COOKIES · {environment}</Text></Box>
      {cookies.length
        ? cookies.slice(0, 8).map((cookie) => <Text key={cookie} color={t.text} wrap="truncate-end">  {cookie}</Text>)
        : <Text color={t.faint}>  jar is empty</Text>}
      {config && !config.tlsVerify && <Box marginTop={1}>
        <Text color={t.danger} bold>⚠ TLS certificate verification is disabled.</Text>
      </Box>}
      <Box marginTop={1}><KeyHints hints={[['↑↓', 'switch'], ['c', 'clear cookies'], ['esc', 'close']]} /></Box>
    </Modal>);
  }

  if (confirm) {
    return shell(<Modal title="Confirm" accent={t.danger} width={Math.min(modalWidth, 60)}>
      <Text color={t.text}>{confirm.message}</Text>
      {confirm.detail && <Text color={t.faint} wrap="truncate-end">{confirm.detail}</Text>}
      <Box marginTop={1}><KeyHints hints={[['y', 'yes'], ['n', 'no'], ['esc', 'cancel']]} /></Box>
    </Modal>);
  }

  if (prompt) {
    return shell(<Modal title={prompt.label} width={modalWidth}>
      <InlineInput
        label="›"
        value={prompt.value}
        placeholder={prompt.placeholder ?? ''}
        onChange={(value) => setPrompt({...prompt, value})}
        onSubmit={() => guard(async () => { await prompt.submit(prompt.value); })}
        onCancel={() => setPrompt(undefined)}
      />
      <Box marginTop={1}><KeyHints hints={[['↵', 'confirm'], ['^u', 'clear'], ['esc', 'cancel']]} /></Box>
    </Modal>);
  }

  if (searchQuery !== undefined) {
    const active = Math.min(searchIndex, Math.max(0, searchResults.length - 1));
    return shell(<Modal title="Search requests" width={modalWidth}>
      <InlineInput
        label="›"
        value={searchQuery}
        placeholder="name or url…"
        onChange={(value) => { setSearchQuery(value); setSearchIndex(0); }}
        onArrow={(direction) => setSearchIndex((value) =>
          searchResults.length ? (value + direction + searchResults.length) % searchResults.length : 0)}
        onSubmit={() => {
          const chosen = searchResults[active];
          if (chosen) {
            const index = tree.findIndex((item) => item.kind === 'request' && item.record.id === chosen.id);
            if (index >= 0) { setSelected(index); setFocus('tree'); }
          }
          setSearchQuery(undefined);
        }}
        onCancel={() => setSearchQuery(undefined)}
      />
      <Box marginTop={1} flexDirection="column">
        {searchResults.length
          ? searchResults.map((record, index) => <Box key={record.id}>
            <Text color={index === active ? t.accent : t.faint}>{index === active ? '▍' : ' '} </Text>
            <MethodTag method={record.request?.method ?? 'GET'} muted={index !== active} />
            <Text color={index === active ? t.text : t.muted}> {record.id.padEnd(24).slice(0, 24)}</Text>
            <Text color={t.faint} wrap="truncate-end"> {record.request?.url ?? ''}</Text>
          </Box>)
          : <Text color={t.faint}>  no matches</Text>}
      </Box>
      <Box marginTop={1}><KeyHints hints={[['↑↓', 'select'], ['↵', 'jump'], ['esc', 'cancel']]} /></Box>
    </Modal>);
  }

  if (pasteValue !== undefined) {
    return shell(<Modal title="Import curl" width={modalWidth}>
      <InlineInput
        label="$"
        value={pasteValue}
        placeholder="curl https://api.example.com -H 'accept: application/json'"
        onChange={setPasteValue}
        onSubmit={() => {
          try {
            const parsed = parseCurl(pasteValue);
            setPasteValue(undefined);
            setDraft({name: '', folder: '', request: parsed.request});
            setToast(parsed.unsupported.length
              ? {text: `Imported. Unsupported flags ignored: ${parsed.unsupported.join(', ')}`, kind: 'info'}
              : {text: 'curl imported.', kind: 'success'});
          } catch (pasteError: any) {
            setToast({text: pasteError.message, kind: 'error'});
            setPasteValue(undefined);
          }
        }}
        onCancel={() => setPasteValue(undefined)}
      />
      <Box marginTop={1}>
        <Text color={t.faint} wrap="wrap">Paste a command, then press enter. Multi-line commands are supported.</Text>
      </Box>
    </Modal>);
  }

  if (draft) {
    return shell(<RequestForm
      draft={draft}
      width={columns}
      onChange={setDraft}
      onCancel={() => setDraft(undefined)}
      onFire={() => {
        if (!draft.request.url) { setToast({text: 'A URL is required.', kind: 'error'}); return; }
        setDraft(undefined);
        guard(() => runRequest(draft.request));
      }}
      onSave={() => {
        if (!draft.name || !draft.request.url) { setToast({text: 'Name and URL are required to save.', kind: 'error'}); return; }
        guard(async () => {
          await saveRequest(draft.request, draft.name, draft.folder, cwd);
          setDraft(undefined); await reload();
          setToast({text: `Saved ${draft.folder ? `${draft.folder}/` : ''}${draft.name}.`, kind: 'success'});
        });
      }}
    />);
  }

  // ── main two-pane view ──────────────────────────────────────────────────
  const treeRows = contentHeight - 1;
  const windowStart = Math.max(0, Math.min(selected - Math.floor(treeRows / 2), tree.length - treeRows));
  const windowed = tree.slice(windowStart, windowStart + treeRows);
  const treeInner = treeWidth - 2;

  return shell(<>
    <Box width={treeWidth} flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={focus === 'tree' ? t.accent : t.muted} bold>COLLECTIONS</Text>
        {tree.length > treeRows && <Text color={t.faint}>{windowStart + 1}–{Math.min(tree.length, windowStart + treeRows)}</Text>}
      </Box>
      {records.length === 0 && history.length === 0
        ? <EmptyState title="No saved requests" hints={[['n', 'create'], ['p', 'paste curl']]} />
        : windowed.map((item, index) => {
          const isActive = windowStart + index === selected;
          const background = isActive ? (focus === 'tree' ? t.selection : undefined) : undefined;
          const indent = '  '.repeat(item.depth);
          let label = item.label;
          let leading: React.ReactNode;
          if (item.kind === 'folder' || item.kind === 'section') {
            const key = item.kind === 'folder' ? item.folderPath : item.sectionKey;
            leading = <Text color={isActive ? t.accent : t.muted} backgroundColor={background} bold>
              {collapsed.has(key) ? '▸' : '▾'}{' '}
            </Text>;
          } else if (item.kind === 'request') {
            leading = item.record.request
              ? <Text backgroundColor={background}><MethodTag method={item.record.request.method} /><Text> </Text></Text>
              : <Text color={t.danger} backgroundColor={background} bold>{'ERR'.padEnd(METHOD_WIDTH)} </Text>;
          } else {
            const status = item.entry.response?.status;
            leading = <Text color={status ? statusColor(status) : t.danger} backgroundColor={background} bold>
              {String(status ?? 'ERR').padEnd(METHOD_WIDTH)}{' '}
            </Text>;
          }
          const count = item.kind === 'folder' || item.kind === 'section' ? ` ${item.count}` : '';
          const used = indent.length + (item.kind === 'folder' || item.kind === 'section' ? 2 : METHOD_WIDTH + 1) + label.length + count.length;
          label = label.slice(0, Math.max(0, treeInner - (used - label.length)));
          const pad = ' '.repeat(Math.max(0, treeInner - (indent.length + (item.kind === 'folder' || item.kind === 'section' ? 2 : METHOD_WIDTH + 1) + label.length + count.length)));
          return <Text key={item.id} backgroundColor={background} wrap="truncate-end">
            <Text backgroundColor={background}>{indent}</Text>
            {leading}
            <Text
              color={isActive ? t.text : item.kind === 'request' && item.record.error ? t.danger : item.kind === 'history' ? t.muted : t.text}
              backgroundColor={background}
              bold={item.kind === 'folder' || item.kind === 'section'}
            >{label}</Text>
            {count && <Text color={t.faint} backgroundColor={background}>{count}</Text>}
            <Text backgroundColor={background}>{pad}</Text>
          </Text>;
        })}
    </Box>

    <Seam height={contentHeight} />

    <Box width={mainWidth} flexDirection="column">
      <Box flexDirection="column" height={3}>
        {selectedRequest ? <>
          <Box paddingX={1}>
            <Text color={methodColor(selectedRequest.method)} bold>{selectedRequest.method}</Text>
            <Text color={t.text} wrap="truncate-end"> {selectedRequest.url}</Text>
          </Box>
          <Box paddingX={1}>
            <Chip label={`${Object.keys(selectedRequest.headers ?? {}).length} headers`} />
            <Text color={t.faint}>   </Text>
            <Chip label={bodyKind(selectedRequest)} />
            <Text color={t.faint}>   </Text>
            <Chip label={authKind(selectedRequest)} color={selectedRequest.auth ? t.violet : t.muted} />
          </Box>
        </> : <>
          <Box paddingX={1}><Text color={t.faint}>no request selected</Text></Box>
          <Text> </Text>
        </>}
        <Box paddingX={1}><Rule width={mainWidth - 2} /></Box>
      </Box>
      <ResponseView
        response={response}
        error={error}
        loading={loading}
        progress={progress}
        scroll={scroll}
        height={bodyHeight}
        width={mainWidth}
        showHeaders={showHeaders}
        diff={responseDiff}
        search={bodySearch}
        matches={matchLines}
        matchIndex={matchIndex}
        folded={folded}
      />
    </Box>
  </>);
}

function HelpPanel({config, width}: {config?: PostlessConfig; width: number}) {
  const keys = {...DEFAULT_KEYS, ...(config?.keybindings ?? {})};
  const overridden = new Set(Object.keys(config?.keybindings ?? {}));
  const groups: Array<[string, Hint[]]> = [
    ['NAVIGATE', [['j/k', 'move'], ['h/l', 'collapse/expand'], ['g/G', 'top/bottom'], ['⇥', 'switch pane'], [keys.search!, 'fuzzy search']]],
    ['REQUESTS', [[keys.fire === 'enter' ? '↵' : keys.fire!, 'fire'], [keys.new!, 'new'], [keys.edit!, 'edit form'], [keys.editor!, 'open in $EDITOR'], [keys.save!, 'promote history']]],
    ['ORGANISE', [[keys.createFolder!, 'new folder'], [keys.rename!, 'rename'], [keys.move!, 'move'], [keys.delete!, 'delete'], [keys.reload!, 'reload from disk']]],
    ['RESPONSE', [['j/k', 'scroll'], ['f', 'fold node'], ['n/N', 'next/prev match'], [keys.headers!, 'headers'], [keys.diff!, 'diff']]],
    ['TRANSFER', [[keys.copyResponse!, 'copy body'], [keys.copyCurl!, 'copy as curl'], [keys.pasteCurl!, 'import curl'], ['w', 'write to file'], ['O', 'open in $EDITOR']]],
    ['SESSION', [['^e', 'cycle environment'], [keys.environments!, 'environments'], [keys.help!, 'this help'], ['esc', 'back out'], [keys.quit!, 'quit']]],
  ];
  // Three columns of two groups keeps the whole keymap on one screen.
  const columnWidth = Math.floor((width - 6) / 3);
  const columns: Array<typeof groups> = [groups.slice(0, 2), groups.slice(2, 4), groups.slice(4, 6)];
  return <Modal title="Keymap" width={width} compact>
    <Box>
      {columns.map((column, index) => <Box key={index} flexDirection="column" width={columnWidth}>
        {column.map(([title, hints]) => <Box key={title} flexDirection="column" marginBottom={1}>
          <Text color={t.muted} bold>{title}</Text>
          {hints.map(([key, label]) => <Box key={key + label}>
            <Text color={t.accent} bold>{key.padEnd(5)}</Text>
            <Text color={t.text} wrap="truncate-end">{label}</Text>
          </Box>)}
        </Box>)}
      </Box>)}
    </Box>
    <Text color={t.faint} wrap="truncate-end">
      {overridden.size ? `${overridden.size} binding(s) overridden from config.yaml` : 'Override any binding in ~/.config/postless/config.yaml'}
    </Text>
  </Modal>;
}
