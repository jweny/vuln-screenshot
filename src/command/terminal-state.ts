import { SerializeAddon } from "@xterm/addon-serialize";
import headless from "@xterm/headless";

const { Terminal } = headless;

export interface TerminalState {
  serializedAnsi: string;
  plainText: string;
}

export async function buildTerminalState(raw: Buffer): Promise<TerminalState> {
  const terminal = new Terminal({
    cols: 120,
    rows: 40,
    scrollback: 100_000,
    allowProposedApi: true,
  });
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(serializeAddon);
  await new Promise<void>((resolve) => terminal.write(raw.toString("utf8"), resolve));

  const active = terminal.buffer.active;
  const lines: string[] = [];
  for (let index = 0; index < active.length; index += 1) {
    lines.push(active.getLine(index)?.translateToString(true) ?? "");
  }
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();

  const serializedAnsi = serializeAddon
    .serialize()
    .replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, (sequence) =>
      sequence.endsWith("m") ? sequence : "",
    );
  terminal.dispose();
  return {
    serializedAnsi,
    plainText: lines.join("\n"),
  };
}
