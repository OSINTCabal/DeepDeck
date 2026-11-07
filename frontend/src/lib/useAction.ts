import * as React from "react";
import { errorMessage } from "./bridge";

/** Small async action state used by every settings section. */
export function useAction() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const run = React.useCallback(async <T,>(
    action: () => Promise<T>,
    success?: string,
  ): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const value = await action();
      if (success) setMessage(success);
      return value;
    } catch (cause) {
      setError(errorMessage(cause));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, message, run, setError, setMessage };
}
