import {useEffect, useState} from 'react';
import {useStdout} from 'ink';

export function useTerminalSize(): {columns: number; rows: number} {
  const {stdout} = useStdout();
  const [size, setSize] = useState({columns: stdout.columns ?? 100, rows: stdout.rows ?? 30});
  useEffect(() => {
    const resize = () => setSize({columns: stdout.columns ?? 100, rows: stdout.rows ?? 30});
    stdout.on('resize', resize);
    return () => { stdout.off('resize', resize); };
  }, [stdout]);
  return size;
}
