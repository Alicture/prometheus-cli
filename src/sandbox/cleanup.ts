// Sandboxes hold real resources (containers, SSH connections) that must be
// released when the process goes away. Ink owns the TTY and exits without
// unwinding the React tree, and signals bypass `exit` entirely, so teardown is
// registered here as *synchronous* callbacks driven by process events.
//
// This cannot cover SIGKILL or a hard crash; DockerSandbox additionally reaps
// orphaned containers on startup for that case.

type Teardown = () => void;

const teardowns = new Set<Teardown>();
let installed = false;

function runAll(): void {
  for (const fn of teardowns) {
    try {
      fn();
    } catch {
      // Never let a failing teardown mask the original exit.
    }
  }
  teardowns.clear();
}

function install(): void {
  if (installed) return;
  installed = true;

  // Fires for normal exits, uncaught exceptions and explicit process.exit().
  process.once('exit', runAll);

  // Default signal handling terminates without emitting 'exit', so re-exit
  // explicitly and let the 'exit' handler above do the work.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(sig, () => {
      process.exit(sig === 'SIGINT' ? 130 : 143);
    });
  }
}

/** Register a synchronous teardown; returns a function to unregister it. */
export function registerTeardown(fn: Teardown): () => void {
  teardowns.add(fn);
  install();
  return () => {
    teardowns.delete(fn);
  };
}
