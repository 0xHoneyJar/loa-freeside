import { Data, Effect } from "effect";

/**
 * Reject duplicate JSON object keys even when values are equal.
 * Standard JSON.parse keeps the last value and hides the collision.
 */
export class DuplicateJsonKey extends Data.TaggedError("DuplicateJsonKey")<{
  readonly key: string;
  readonly path: string;
  readonly reason: string;
}> {}

export class InvalidJsonDocument extends Data.TaggedError("InvalidJsonDocument")<{
  readonly reason: string;
}> {}

export type StrictJsonError = DuplicateJsonKey | InvalidJsonDocument;

type ParseState = {
  readonly text: string;
  index: number;
};

const isWhitespace = (ch: string): boolean =>
  ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

const peek = (state: ParseState): string => state.text[state.index] ?? "";

const advance = (state: ParseState): string => {
  const ch = state.text[state.index] ?? "";
  state.index += 1;
  return ch;
};

const skipWhitespace = (state: ParseState): void => {
  while (isWhitespace(peek(state))) {
    state.index += 1;
  }
};

const failInvalid = (reason: string): never => {
  throw new InvalidJsonDocument({ reason });
};

const parseString = (state: ParseState): string => {
  if (advance(state) !== '"') {
    failInvalid("expected string");
  }
  let out = "";
  for (;;) {
    if (state.index >= state.text.length) {
      failInvalid("unterminated string");
    }
    const ch = advance(state);
    if (ch === '"') {
      return out;
    }
    if (ch === "\\") {
      const escaped = advance(state);
      switch (escaped) {
        case '"':
        case "\\":
        case "/":
          out += escaped;
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const hex = state.text.slice(state.index, state.index + 4);
          if (!/^[0-9a-fA-F]{4}$/u.test(hex)) {
            failInvalid("invalid unicode escape");
          }
          out += String.fromCharCode(Number.parseInt(hex, 16));
          state.index += 4;
          break;
        }
        default:
          failInvalid(`invalid escape \\${escaped}`);
      }
      continue;
    }
    out += ch;
  }
};

const parseValue = (state: ParseState, path: string): unknown => {
  skipWhitespace(state);
  const ch = peek(state);
  if (ch === '"') {
    return parseString(state);
  }
  if (ch === "{") {
    return parseObject(state, path);
  }
  if (ch === "[") {
    return parseArray(state, path);
  }
  if (ch === "t") {
    if (state.text.slice(state.index, state.index + 4) !== "true") {
      failInvalid("expected true");
    }
    state.index += 4;
    return true;
  }
  if (ch === "f") {
    if (state.text.slice(state.index, state.index + 5) !== "false") {
      failInvalid("expected false");
    }
    state.index += 5;
    return false;
  }
  if (ch === "n") {
    if (state.text.slice(state.index, state.index + 4) !== "null") {
      failInvalid("expected null");
    }
    state.index += 4;
    return null;
  }
  if (ch === "-" || (ch >= "0" && ch <= "9")) {
    return parseNumber(state);
  }
  failInvalid(`unexpected token ${JSON.stringify(ch)}`);
};

const parseNumber = (state: ParseState): number => {
  const start = state.index;
  if (peek(state) === "-") {
    state.index += 1;
  }
  if (peek(state) === "0") {
    state.index += 1;
  } else if (/[1-9]/u.test(peek(state))) {
    while (/[0-9]/u.test(peek(state))) {
      state.index += 1;
    }
  } else {
    failInvalid("invalid number");
  }
  if (peek(state) === ".") {
    state.index += 1;
    if (!/[0-9]/u.test(peek(state))) {
      failInvalid("invalid number fraction");
    }
    while (/[0-9]/u.test(peek(state))) {
      state.index += 1;
    }
  }
  if (peek(state) === "e" || peek(state) === "E") {
    state.index += 1;
    if (peek(state) === "+" || peek(state) === "-") {
      state.index += 1;
    }
    if (!/[0-9]/u.test(peek(state))) {
      failInvalid("invalid number exponent");
    }
    while (/[0-9]/u.test(peek(state))) {
      state.index += 1;
    }
  }
  const raw = state.text.slice(start, state.index);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    failInvalid(`invalid number ${raw}`);
  }
  return value;
};

const parseArray = (state: ParseState, path: string): Array<unknown> => {
  if (advance(state) !== "[") {
    failInvalid("expected array");
  }
  skipWhitespace(state);
  const items: Array<unknown> = [];
  if (peek(state) === "]") {
    state.index += 1;
    return items;
  }
  while (true) {
    items.push(parseValue(state, `${path}[${items.length}]`));
    skipWhitespace(state);
    const ch = advance(state);
    if (ch === "]") {
      return items;
    }
    if (ch !== ",") {
      failInvalid("expected comma or end of array");
    }
    skipWhitespace(state);
  }
};

const parseObject = (state: ParseState, path: string): Record<string, unknown> => {
  if (advance(state) !== "{") {
    failInvalid("expected object");
  }
  skipWhitespace(state);
  const object: Record<string, unknown> = {};
  const seen = new Set<string>();
  if (peek(state) === "}") {
    state.index += 1;
    return object;
  }
  while (true) {
    skipWhitespace(state);
    if (peek(state) !== '"') {
      failInvalid("expected object key string");
    }
    const key = parseString(state);
    if (seen.has(key)) {
      throw new DuplicateJsonKey({
        key,
        path,
        reason: `duplicate JSON object key ${JSON.stringify(key)} at ${path || "$"}`,
      });
    }
    seen.add(key);
    skipWhitespace(state);
    if (advance(state) !== ":") {
      failInvalid("expected colon after object key");
    }
    const childPath = path === "" ? key : `${path}.${key}`;
    object[key] = parseValue(state, childPath);
    skipWhitespace(state);
    const ch = advance(state);
    if (ch === "}") {
      return object;
    }
    if (ch !== ",") {
      failInvalid("expected comma or end of object");
    }
  }
};

/**
 * Parse a JSON document, rejecting duplicate object keys at every nesting level.
 */
export const parseJsonStrict = (text: string): unknown => {
  const state: ParseState = { text, index: 0 };
  const value = parseValue(state, "");
  skipWhitespace(state);
  if (state.index !== state.text.length) {
    throw new InvalidJsonDocument({
      reason: "trailing content after JSON value",
    });
  }
  return value;
};

export const parseJsonStrictEffect = (
  text: string,
): Effect.Effect<unknown, StrictJsonError> =>
  Effect.try({
    try: () => parseJsonStrict(text),
    catch: (error) => {
      if (error instanceof DuplicateJsonKey || error instanceof InvalidJsonDocument) {
        return error;
      }
      return new InvalidJsonDocument({ reason: String(error) });
    },
  });
