import { describe, expect, it } from "vitest";

import { describeError } from "../src/lib/errors";

/**
 * The raw strings below are what Rust, SQLite and the operating system actually
 * hand across the IPC boundary. They are the whole point of the module: the
 * mapping is a table of substrings, and a table of substrings breaks silently
 * when one pattern starts swallowing another. `connection timed out` is the
 * case that matters — it has to land on the timeout advice, not on the "engines
 * are not answering" advice, because the two ask the user to do different things.
 */
const CASES: Array<{ raw: string; expect: RegExp; label: string }> = [
  { label: "disco pieno POSIX", raw: "No space left on device (os error 28)", expect: /disco/i },
  { label: "disco pieno Windows", raw: "There is not enough space on the disk.", expect: /disco/i },
  { label: "disco pieno dal motore", raw: "spazio su disco insufficiente", expect: /disco/i },
  { label: "permessi POSIX", raw: "Permission denied (os error 13)", expect: /permessi/i },
  { label: "permessi Windows", raw: "Access is denied. (os error 5)", expect: /permessi/i },
  { label: "permessi macOS", raw: "Operation not permitted (os error 1)", expect: /permessi/i },
  { label: "file mancante", raw: "No such file or directory (os error 2)", expect: /non si trova/i },
  {
    label: "file mancante Windows",
    raw: "The system cannot find the file specified. (os error 2)",
    expect: /non si trova/i,
  },
  {
    label: "motore spento",
    raw: "error sending request for url (http://127.0.0.1:8787/api/health): tcp connect error: Connection refused (os error 61)",
    expect: /Modelli/,
  },
  { label: "database occupato", raw: "database is locked", expect: /database/i },
  { label: "errore sqlite generico", raw: "SQLite failure: constraint violated", expect: /database/i },
  { label: "timeout esplicito", raw: "operation timed out", expect: /tempo massimo/i },
  // The case this table exists for: the string contains "connection", so it used
  // to be answered with "the engines are not answering, start them", while
  // nothing had refused the connection. It now has its own branch, and the
  // branch has to stay ahead of the two generic ones.
  { label: "timeout di connessione", raw: "connection timed out", expect: /non hanno risposto in tempo/i },
  { label: "timeout di connect POSIX", raw: "tcp connect error: os error 60", expect: /non hanno risposto in tempo/i },
];

describe("describeError", () => {
  for (const { label, raw, expect: pattern } of CASES) {
    it(`riconosce ${label}`, () => {
      const message = describeError(raw);
      expect(message).toMatch(pattern);
      // The raw text is kept on purpose: for several backend errors it is the
      // only clue about what actually failed.
      expect(message).toContain(raw);
    });
  }

  it("distingue un timeout da una connessione rifiutata", () => {
    const timeout = describeError("connection timed out");
    const refused = describeError("tcp connect error: Connection refused (os error 61)");
    expect(timeout).not.toBe(refused);
    expect(timeout).toMatch(/in tempo/i);
    expect(refused).not.toMatch(/in tempo/i);
  });

  it("tiene il testo sconosciuto invece di sostituirlo con una frase generica", () => {
    expect(describeError("engine returned status 418")).toBe("engine returned status 418");
  });

  it("toglie il prefisso Error: che arriva dal ponte IPC", () => {
    expect(describeError("Error: database is locked")).toContain("database is locked");
    expect(describeError("Error: database is locked")).not.toContain("Error:");
  });

  it("accetta Error, stringhe vuote e valori non testuali", () => {
    expect(describeError(new Error("No space left on device"))).toMatch(/disco/i);
    expect(describeError("   ")).toMatch(/errore imprevisto/i);
    expect(describeError(undefined)).toMatch(/undefined|errore/i);
  });
});
