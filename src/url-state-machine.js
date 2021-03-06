"use strict";
const punycode = require("punycode");

const tr46 = require("tr46");

/*jshint unused: false */

function p(char) {
  return char.codePointAt(0);
}

const specialSchemas = {
  "ftp": 21,
  "file": null,
  "gopher": 70,
  "http": 80,
  "https": 443,
  "ws": 80,
  "wss": 443
};

const localSchemas = [
  "about",
  "blob",
  "data",
  "filesystem"
];

const bufferReplacement = {
  "%2e": ".",
  ".%2e": "..",
  "%2e.": "..",
  "%2e%2e": ".."
};

const failure = Symbol("failure");

function countSymbols(str) {
  return punycode.ucs2.decode(str).length;
}

function at(input, idx) {
  const c = input[idx];
  return isNaN(c) ? undefined : String.fromCodePoint(c);
}

function isASCIIDigit(c) {
  return c >= 0x30 && c <= 0x39;
}

function isASCIIAlpha(c) {
  return (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A);
}

function isASCIIHex(c) {
  return isASCIIDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

function isSingleDot(buffer) {
  return buffer === "." || buffer.toLowerCase() === "%2e";
}

function isDoubleDot(buffer) {
  buffer = buffer.toLowerCase();
  return buffer === ".." || buffer === "%2e." || buffer === ".%2e" || buffer === "%2e%2e";
}

function percentEncode(c) {
  let hex = c.toString(16).toUpperCase();
  if (hex.length === 1) {
    hex = "0" + hex;
  }

  return "%" + hex;
}

const invalidCodePoint = String.fromCodePoint(65533);
function utf8PercentEncode(c) {
  const buf = new Buffer(c);
  if (buf.toString() === invalidCodePoint) {
    return "";
  }

  let str = "";

  for (let i = 0; i < buf.length; ++i) {
    str += percentEncode(buf[i]);
  }

  return str;
}

function utf8PercentDecode(str) {
  const input = new Buffer(str);
  const output = [];
  for (let i = 0; i < input.length; ++i) {
    if (input[i] !== p("%")) {
      output.push(input[i]);
    } else if (input[i] === p("%") && isASCIIHex(input[i + 1]) && isASCIIHex(input[i + 2])) {
      output.push(parseInt(input.slice(i + 1, i + 3).toString(), 16));
      i += 2;
    } else {
      output.push(input[i]);
    }
  }
  return new Buffer(output).toString();
}

function isSimpleEncode(c) {
  return c <= 0x1F || c > 0x7E;
}

const defaultEncodeSet = [p(" "), p("\""), p("#"), p("<"), p(">"), p("?"), p("`"), p("{"), p("}")];
function isDefaultEncode(c) {
  return isSimpleEncode(c) || defaultEncodeSet.indexOf(c) !== -1;
}

const userInfoEncodeSet = [p("/"), p(":"), p(";"), p("="), p("@"), p("["), p("\\"), p("]"), p("^"), p("|")];
function isUserInfoEncode(c) {
  return isDefaultEncode(c) || userInfoEncodeSet.indexOf(c) !== -1;
}

function encodeChar(c, checkCb) {
  const c_str = String.fromCodePoint(c);

  if (checkCb(c)) {
    return utf8PercentEncode(c_str);
  }

  return c_str;
}

function parseIPv4Number(input) {
  let R = 10;

  if (input.length >= 2 && input.charAt(0) === "0" && input.charAt(1).toLowerCase() === "x") {
    input = input.substring(2);
    R = 16;
  } else if (input.length >= 2 && input.charAt(0) === "0") {
    input = input.substring(1);
    R = 8;
  }

  if (input === "") {
    return 0;
  }

  const regex = R === 10 ? /[^0-9]/ : (R === 16 ? /[^0-9A-Fa-f]/ : /[^0-7]/);
  if (regex.test(input)) {
    return failure;
  }

  return parseInt(input, R);
}

function parseIPv4(input) {
  let parts = input.split(".");
  if (parts[parts.length - 1] === "") {
    parts.pop();
  }

  if (parts.length > 4) {
    return input;
  }

  let numbers = [];
  for (const part of parts) {
    const n = parseIPv4Number(part);
    if (n === failure) {
      return input;
    }

    numbers.push(n);
  }

  for (let i = 0; i < numbers.length - 1; ++i) {
    if (numbers[i] > 255) {
      return failure;
    }
  }
  if (numbers[numbers.length - 1] >= Math.pow(256, 5 - numbers.length)) {
    return failure;
  }

  let ipv4 = numbers.pop();
  let counter = 0;

  for (const n of numbers) {
    ipv4 += n * Math.pow(256, 3 - counter);
    ++counter;
  }

  return ipv4;
}

function serializeIPv4(address) {
  let output = "";
  let n = address;

  for (let i = 0; i < 4; ++i) {
    output = String(n % 256) + output;
    if (i !== 3) {
      output = "." + output;
    }
    n = Math.floor(n / 256);
  }

  return output;
}

function parseIPv6(input) {
  const ip = [0, 0, 0, 0, 0, 0, 0, 0];
  let piecePtr = 0;
  let compressPtr = null;
  let pointer = 0;

  input = punycode.ucs2.decode(input);

  if (input[pointer] === p(":")) {
    if (input[pointer + 1] !== p(":")) {
      return failure;
    }

    pointer += 2;
    ++piecePtr;
    compressPtr = piecePtr;
  }

  let ipv4 = false;
  Main:
  while (pointer < input.length) {
    if (piecePtr === 8) {
      return failure;
    }

    if (input[pointer] === p(":")) {
      if (compressPtr !== null) {
        return failure;
      }
      ++pointer;
      ++piecePtr;
      compressPtr = piecePtr;
      continue;
    }

    let value = 0;
    let length = 0;

    while (length < 4 && isASCIIHex(input[pointer])) {
      value = value * 0x10 + parseInt(at(input, pointer), 16);
      ++pointer;
      ++length;
    }

    switch (at(input, pointer)) {
      case ".":
        if (length === 0) {
          return failure;
        }
        pointer -= length;
        ipv4 = true;
        break Main;
      case ":":
        ++pointer;
        if (input[pointer] === undefined) {
          return failure;
        }
        break;
      case undefined:
        break;
      default:
        return failure;
    }

    ip[piecePtr] = value;
    ++piecePtr;
  }

  if (ipv4 && piecePtr > 6) {
    return failure;
  } else if (input[pointer] !== undefined) {
    let dotsSeen = 0;

    while (input[pointer] !== undefined) {
      let value = null;
      if (!isASCIIDigit(input[pointer])) {
        return failure;
      }

      while (isASCIIDigit(input[pointer])) {
        const number = parseInt(at(input, pointer), 10);
        if (value === null) {
          value = number;
        } else if (value === 0) {
          return failure;
        } else {
          value = value * 10 + number;
        }
        ++pointer;
        if (value > 255) {
          return failure;
        }
      }

      if (dotsSeen < 3 && input[pointer] !== p(".")) {
        return failure;
      }
      ip[piecePtr] = ip[piecePtr] * 0x100 + value;
      if (dotsSeen === 1 || dotsSeen === 3) {
        ++piecePtr;
      }

      if (input[pointer] !== undefined) {
        ++pointer;
      }

      if (dotsSeen === 3 && input[pointer] !== undefined) {
        return failure;
      }
      ++dotsSeen;
    }
  }

  if (compressPtr !== null) {
    let swaps = piecePtr - compressPtr;
    piecePtr = 7;
    while (piecePtr !== 0 && swaps > 0) {
      const temp = ip[compressPtr + swaps - 1]; // piece
      ip[compressPtr + swaps - 1] = ip[piecePtr];
      ip[piecePtr] = temp;
      --piecePtr;
      --swaps;
    }
  } else if (piecePtr !== 8) {
    return failure;
  }

  return ip;
}

function serializeIPv6(address) {
  let output = "";
  const seqResult = findLongestZeroSequence(address);
  const compressPtr = seqResult.idx;

  for (var i = 0; i < address.length; ++i) {
    if (compressPtr === i) {
      if (i === 0) {
        output += "::";
      } else {
        output += ":";
      }

      i += seqResult.len - 1;
      continue;
    }

    output += address[i].toString(16);
    if (i !== address.length - 1) {
      output += ":";
    }
  }

  return output;
}

function parseHost(input, isUnicode) {
  if (input[0] === "[") {
    if (input[input.length - 1] !== "]") {
      return failure;
    }

    return parseIPv6(input.substring(1, input.length - 1));
  }

  const domain = utf8PercentDecode(input);
  const asciiDomain = tr46.toASCII(domain, false, tr46.PROCESSING_OPTIONS.TRANSITIONAL, false);
  if (asciiDomain === null) {
    return failure;
  }

  if (asciiDomain.search(/\u0000|\u0009|\u000A|\u000D|\u0020|#|%|\/|:|\?|@|\[|\\|\]/) !== -1) {
    return failure;
  }

  let ipv4Host = parseIPv4(asciiDomain);
  if (typeof ipv4Host === "number" || ipv4Host === failure) {
    return ipv4Host;
  }

  return isUnicode ? tr46.toUnicode(asciiDomain, false).domain : asciiDomain;
}

function findLongestZeroSequence(arr) {
  let maxIdx = null;
  let maxLen = 1; // only find elements > 1
  let currStart = null;
  let currLen = 0;

  for (var i = 0; i < arr.length; ++i) {
    if (arr[i] !== 0) {
      if (currLen > maxLen) {
        maxIdx = currStart;
        maxLen = currLen;
      }

      currStart = null;
      currLen = 0;
    } else {
      if (currStart === null) {
        currStart = i;
      }
      ++currLen;
    }
  }

  return {
    idx: maxIdx,
    len: maxLen
  };
}

function serializeHost(host) {
  if (typeof host === "number") {
    return serializeIPv4(host);
  }

  // IPv6 serializer
  if (host instanceof Array) {
    return "[" + serializeIPv6(host) + "]";
  }

  return host;
}

function trimControlChars(url) {
  return url.replace(/^[\u0000-\u001F\u0020]+|[\u0000-\u001F\u0020]+$/g, "");
}

function URLStateMachine(input, base, encoding_override, url, state_override) {
  this.pointer = 0;
  this.input = input;
  this.base = base || null;
  this.encoding_override = encoding_override || "utf-8";
  this.state_override = state_override;
  this.url = url;
  this.failure = false;
  this.parse_error = false;

  if (!this.url) {
    this.url = {
      scheme: "",
      username: "",
      password: null,
      host: null,
      port: null,
      path: [],
      query: null,
      fragment: null,

      nonRelative: false
    };

    const res = trimControlChars(this.input);
    if (res !== this.input) {
      this.parse_error = true;
    }
    this.input = res;
  }

  this.state = state_override || "scheme start";

  this.buffer = "";
  this.at_flag = false;
  this.arr_flag = false;

  this.input = punycode.ucs2.decode(this.input);

  for (; this.pointer <= this.input.length; ++this.pointer) {
    const c = this.input[this.pointer];
    const c_str = isNaN(c) ? undefined : String.fromCodePoint(c);

    // exec state machine
    const ret = this["parse" + this.state](c, c_str);
    if (ret === false) {
      break; // terminate algorithm
    } else if (ret === failure) {
      this.failure = true;
      break;
    }
  }
}

URLStateMachine.prototype["parse" + "scheme start"] =
    function parseSchemeStart(c, c_str) {
  if (isASCIIAlpha(c)) {
    this.buffer += c_str.toLowerCase();
    this.state = "scheme";
  } else if (!this.state_override) {
    this.state = "no scheme";
    --this.pointer;
  } else {
    this.parse_error = true;
    return false;
  }
};

URLStateMachine.prototype["parse" + "scheme"] =
    function parseScheme(c, c_str) {
  if (isASCIIAlpha(c) || c === p("+") || c === p("-") || c === p(".")) {
    this.buffer += c_str.toLowerCase();
  } else if (c === p(":")) {
    if (this.state_override) {
      // TODO: XOR
      if (specialSchemas[this.url.scheme] !== undefined && !specialSchemas[this.buffer]) {
        return false;
      } else if (specialSchemas[this.url.scheme] === undefined && specialSchemas[this.buffer]) {
        return false;
      }
    }
    this.url.scheme = this.buffer;
    this.buffer = "";
    if (this.state_override) {
      return false;
    }
    if (this.url.scheme === "file") {
      if (this.input[this.pointer + 1] === p("/") && this.input[this.pointer + 2] === p("/")) {
        this.parse_error = true;
      }
      this.state = "file";
    } else if (specialSchemas[this.url.scheme] !== undefined && this.base !== null &&
               this.base.scheme === this.url.scheme) {
      this.state = "special relative or authority";
    } else if (specialSchemas[this.url.scheme] !== undefined) {
      this.state = "special authority slashes";
    } else if (this.input[this.pointer + 1] === p("/")) {
      this.state = "path or authority";
      ++this.pointer;
    } else {
      this.url.nonRelative = true;
      this.url.path.push("");
      this.state = "non-relative path";
    }
  } else if (!this.state_override) {
    this.buffer = "";
    this.state = "no scheme";
    this.pointer = -1;
  } else {
    this.parse_error = true;
    return false;
  }
};

URLStateMachine.prototype["parse" + "no scheme"] =
    function parseNoScheme(c, c_str) {
  //jshint unused:false
  if (this.base === null || (this.base.nonRelative && c !== p("#"))) {
    return failure;
  } else if (this.base.nonRelative && c === p("#")) {
    this.url.scheme = this.base.scheme;
    this.url.path = this.base.path.slice();
    this.url.query = this.base.query;
    this.url.fragment = "";
    this.url.nonRelative = true;
    this.state = "fragment";
  } else if (this.base.scheme === "file") {
    this.state = "file";
    --this.pointer;
  } else {
    this.state = "relative";
    --this.pointer;
  }
};

URLStateMachine.prototype["parse" + "special relative or authority"] =
    function parseSpecialRelativeOrAuthority(c, c_str) {
  if (c === p("/") && this.input[this.pointer + 1] === p("/")) {
    this.state = "special authority ignore slashes";
    ++this.pointer;
  } else {
    this.parse_error = true;
    this.state = "relative";
    --this.pointer;
  }
};

URLStateMachine.prototype["parse" + "path or authority"] =
    function parsePathOrAuthority(c, c_str) {
  if (c === p("/")) {
    this.state = "authority";
  } else {
    this.state = "path";
    --this.pointer;
  }
};

URLStateMachine.prototype["parse" + "relative"] =
    function parseRelative(c, c_str) {
  this.url.scheme = this.base.scheme;
  if (isNaN(c)) {
    this.url.username = this.base.username;
    this.url.password = this.base.password;
    this.url.host = this.base.host;
    this.url.port = this.base.port;
    this.url.path = this.base.path.slice();
    this.url.query = this.base.query;
  } else if (c === p("/")) {
    this.state = "relative slash";
  } else if (c === p("?")) {
    this.url.username = this.base.username;
    this.url.password = this.base.password;
    this.url.host = this.base.host;
    this.url.port = this.base.port;
    this.url.path = this.base.path.slice();
    this.url.query = "";
    this.state = "query";
  } else if (c === p("#")) {
    this.url.username = this.base.username;
    this.url.password = this.base.password;
    this.url.host = this.base.host;
    this.url.port = this.base.port;
    this.url.path = this.base.path.slice();
    this.url.query = this.base.query;
    this.url.fragment = "";
    this.state = "fragment";
  } else if (specialSchemas[this.url.scheme] !== undefined && c === p("\\")) {
    this.parse_error = true;
    this.state = "relative slash";
  } else {
    this.url.username = this.base.username;
    this.url.password = this.base.password;
    this.url.host = this.base.host;
    this.url.port = this.base.port;
    this.url.path = this.base.path.slice(0, this.base.path.length - 1);

    this.state = "path";
    --this.pointer;
  }
};

URLStateMachine.prototype["parse" + "relative slash"] =
    function parseRelativeSlash(c, c_str) {
  if (c === p("/") || (specialSchemas[this.url.scheme] !== undefined && c === p("\\"))) {
    if (c === p("\\")) {
      this.parse_error = true;
    }
    this.state = "special authority ignore slashes";
  } else {
    this.url.username = this.base.username;
    this.url.password = this.base.password;
    this.url.host = this.base.host;
    this.url.port = this.base.port;
    this.state = "path";
    --this.pointer;
  }
};

URLStateMachine.prototype["parse" + "special authority slashes"] =
    function parseSpecialAuthoritySlashes(c, c_str) {
  if (c === p("/") && this.input[this.pointer + 1] === p("/")) {
    this.state = "special authority ignore slashes";
    ++this.pointer;
  } else {
    this.parse_error = true;
    this.state = "special authority ignore slashes";
    --this.pointer;
  }
};

URLStateMachine.prototype["parse" + "special authority ignore slashes"] =
    function parseSpecialAuthorityIgnoreSlashes(c, c_str) {
  if (c !== p("/") && c !== p("\\")) {
    this.state = "authority";
    --this.pointer;
  } else {
    this.parse_error = true;
  }
};

URLStateMachine.prototype["parse" + "authority"] =
    function parseAuthority(c, c_str) {
  if (c === p("@")) {
    this.parse_error = true;
    if (this.at_flag) {
      this.buffer = "%40" + this.buffer;
    }
    this.at_flag = true;

    // careful, this is based on buffer and has its own pointer (this.pointer != pointer) and inner chars
    const len = countSymbols(this.buffer);
    for (let pointer = 0; pointer < len; ++pointer) {
      /* jshint -W004 */
      const c = this.buffer.codePointAt(pointer);
      /* jshint +W004 */

      if (c === 0x9 || c === 0xA || c === 0xD) {
        continue;
      }

      if (c === p(":") && this.url.password === null) {
        this.url.password = "";
        continue;
      }
      const encodedCodePoints = encodeChar(c, isUserInfoEncode);
      if (this.url.password !== null) {
        this.url.password += encodedCodePoints;
      } else {
        this.url.username += encodedCodePoints;
      }
    }
    this.buffer = "";
  } else if (isNaN(c) || c === p("/") || c === p("?") || c === p("#") ||
             (specialSchemas[this.url.scheme] !== undefined && c === p("\\"))) {
    this.pointer -= countSymbols(this.buffer) + 1;
    this.buffer = "";
    this.state = "host";
  } else {
    this.buffer += c_str;
  }
};

URLStateMachine.prototype["parse" + "host name"] =
URLStateMachine.prototype["parse" + "host"] =
    function parseHostName(c, c_str) {
  if (c === p(":") && !this.arr_flag) {
    if (specialSchemas[this.url.scheme] !== undefined && this.buffer === "") {
      return failure;
    }

    let host = parseHost(this.buffer);
    if (host === failure) {
      return failure;
    }

    this.url.host = host;
    this.buffer = "";
    this.state = "port";
    if (this.state_override === "host name") {
      return false;
    }
  } else if (isNaN(c) || c === p("/") || c === p("?") || c === p("#") ||
             (specialSchemas[this.url.scheme] !== undefined && c === p("\\"))) {
    --this.pointer;
    if (specialSchemas[this.url.scheme] !== undefined && this.buffer === "") {
      return failure;
    }

    let host = parseHost(this.buffer);
    if (host === failure) {
      return failure;
    }

    this.url.host = host;
    this.buffer = "";
    this.state = "path start";
    if (this.state_override) {
      return false;
    }
  } else if (c === 0x9 || c === 0xA || c === 0xD) {
    this.parse_error = true;
  } else {
    if (c === p("[")) {
      this.arr_flag = true;
    } else if (c === p("]")) {
      this.arr_flag = false;
    }
    this.buffer += c_str;
  }
};

URLStateMachine.prototype["parse" + "port"] =
    function parsePort(c, c_str) {
  if (isASCIIDigit(c)) {
    this.buffer += c_str;
  } else if (isNaN(c) || c === p("/") || c === p("?") || c === p("#") ||
             (specialSchemas[this.url.scheme] !== undefined && c === p("\\")) ||
             this.state_override) {
    if (this.buffer !== "") {
      const port = parseInt(this.buffer, 10);
      if (port > Math.pow(2, 16) - 1) {
        this.parse_error = true;
        return failure;
      }
      this.url.port = port === specialSchemas[this.url.scheme] ? null : port;
      this.buffer = "";
    }
    if (this.state_override) {
      return false;
    }
    this.state = "path start";
    --this.pointer;
  } else if (c === 0x9 || c === 0xA || c === 0xD) {
    this.parse_error = true;
  } else {
    this.parse_error = true;
    return failure;
  }
};

URLStateMachine.prototype["parse" + "file"] =
    function parseFile(c, c_str) {
  this.url.scheme = "file";
  if (isNaN(c)) {
    if (this.base !== null && this.base.scheme === "file") {
      this.url.host = this.base.host;
      this.url.path = this.base.path.slice();
      this.url.query = this.base.query;
    }
  } else if (c === p("/") || c === p("\\")) {
    if (c === p("\\")) {
      this.parse_error = true;
    }
    this.state = "file slash";
  } else if (c === p("?")) {
    if (this.base !== null && this.base.scheme === "file") {
      this.url.host = this.base.host;
      this.url.path = this.base.path.slice();
      this.url.query = "";
    }
    this.state = "query";
  } else if (c === p("#")) {
    if (this.base !== null && this.base.scheme === "file") {
      this.url.host = this.base.host;
      this.url.path = this.base.path.slice();
      this.url.query = this.base.query;
      this.url.fragment = "";
    }
    this.state = "fragment";
  } else {
    if (this.base !== null && this.base.scheme === "file") {
      if ((!isASCIIAlpha(c) || // windows drive letter
           (this.input[this.pointer + 1] !== p(":") && this.input[this.pointer + 1] !== p("|"))) ||
          this.input.length - this.pointer - 1 === 1 || // remaining consists of 1 code point
          [p("/"), p("\\"), p("?"), p("#")].indexOf(this.input[this.pointer + 2]) === -1) {
        this.url.host = this.base.host;
        this.url.path = this.base.path.slice();
        this.url.path.pop();
      } else {
        this.parse_error = true;
      }
    }
    this.state = "path";
    --this.pointer;
  }
};

URLStateMachine.prototype["parse" + "file slash"] =
    function parseFileSlash(c, c_str) {
  if (c === p("/") || c === p("\\")) {
    if (c === p("\\")) {
      this.parse_error = true;
    }
    this.state = "file host";
  } else {
    if (this.base !== null && this.base.scheme === "file") {
      if (this.base.path.length && isASCIIAlpha(this.base.path[0][0].charCodeAt(0)) && this.base.path[0][1] === ":") {
        this.url.path.push(this.base.path[0]);
      }
    }
    this.state = "path";
    --this.pointer;
  }
};

URLStateMachine.prototype["parse" + "file host"] =
    function parseFileHost(c, c_str) {
  if (isNaN(c) || c === p("/") || c === p("\\") || c === p("?") || c === p("#")) {
    --this.pointer;
    // don't need to count symbols here since we check ASCII values
    if (this.buffer.length === 2 &&
      isASCIIAlpha(this.buffer.codePointAt(0)) && (this.buffer[1] === ":" || this.buffer[1] === "|")) {
      this.state = "path";
    } else if (this.buffer === "") {
      this.state = "path start";
    } else {
      let host = parseHost(this.buffer);
      if (host === failure) {
        return failure;
      }
      if (host !== "localhost") {
        this.url.host = host;
      }

      this.buffer = "";
      this.state = "path start";
    }
  } else if (c === 0x9 || c === 0xA || c === 0xD) {
    this.parse_error = true;
  } else {
    this.buffer += c_str;
  }
};

URLStateMachine.prototype["parse" + "path start"] =
    function parsePathStart(c, c_str) {
  if (specialSchemas[this.url.scheme] !== undefined && c === p("\\")) {
    this.parse_error = true;
  }
  this.state = "path";
  if (c !== p("/") && !(specialSchemas[this.url.scheme] !== undefined && c === p("\\"))) {
    --this.pointer;
  }
};

URLStateMachine.prototype["parse" + "path"] =
    function parsePath(c, c_str) {
  if (isNaN(c) || c === p("/") || (specialSchemas[this.url.scheme] !== undefined && c === p("\\")) ||
      (!this.state_override && (c === p("?") || c === p("#")))) {
    if (specialSchemas[this.url.scheme] !== undefined && c === p("\\")) {
      this.parse_error = true;
    }

    if (isDoubleDot(this.buffer)) {
      this.url.path.pop();
      if (c !== p("/") && !(specialSchemas[this.url.scheme] !== undefined && c === p("\\"))) {
        this.url.path.push("");
      }
    } else if (isSingleDot(this.buffer) && c !== p("/") &&
               !(specialSchemas[this.url.scheme] !== undefined && c === p("\\"))) {
      this.url.path.push("");
    } else if (!isSingleDot(this.buffer)) {
      if (this.url.scheme === "file" && this.url.path.length === 0 &&
        this.buffer.length === 2 && isASCIIAlpha(this.buffer.codePointAt(0)) &&
        (this.buffer[1] === "|" || this.buffer[1] === ":")) {
        if (this.url.host !== null) {
          this.parse_error = true;
        }
        this.url.host = null;
        this.buffer = this.buffer[0] + ":";
      }
      this.url.path.push(this.buffer);
    }
    this.buffer = "";
    if (c === p("?")) {
      this.url.query = "";
      this.state = "query";
    }
    if (c === p("#")) {
      this.url.fragment = "";
      this.state = "fragment";
    }
  } else if (c === 0x9 || c === 0xA || c === 0xD) {
    this.parse_error = true;
  } else {
    // TODO: If c is not a URL code point and not "%", parse error.

    if (c === p("%") &&
      (!isASCIIHex(this.input[this.pointer + 1]) ||
        !isASCIIHex(this.input[this.pointer + 2]))) {
      this.parse_error = true;
    }

    if (c === p("%") &&
        this.input[this.pointer + 1] === p("2") &&
        this.input[this.pointer + 2] === p("e")) {
      this.buffer += ".";
      this.pointer += 2;
    } else {
      this.buffer += encodeChar(c, isDefaultEncode);
    }
  }
};

URLStateMachine.prototype["parse" + "non-relative path"] =
    function parseNonRelativePath(c, c_str) {
  if (c === p("?")) {
    this.url.query = "";
    this.state = "query";
  } else if (c === p("#")) {
    this.url.fragment = "";
    this.state = "fragment";
  } else {
    // TODO: Add: not a URL code point
    if (!isNaN(c) && c !== p("%")) {
      this.parse_error = true;
    }

    if (c === p("%") &&
        (!isASCIIHex(this.input[this.pointer + 1]) ||
         !isASCIIHex(this.input[this.pointer + 2]))) {
      this.parse_error = true;
    }

    if (!isNaN(c) && c !== 0x9 && c !== 0xA && c !== 0xD) {
      this.url.path[0] = this.url.path[0] + encodeChar(c, isSimpleEncode);
    }
  }
};

URLStateMachine.prototype["parse" + "query"] =
    function parseQuery(c, c_str) {
  if (isNaN(c) || (!this.state_override && c === p("#"))) {
    if (specialSchemas[this.url.scheme] === undefined || this.url.scheme === "ws" || this.url.scheme === "wss") {
      this.encoding_override = "utf-8";
    }

    const buffer = new Buffer(this.buffer); //TODO: Use encoding override instead
    for (let i = 0; i < buffer.length; ++i) {
      if (buffer[i] < 0x21 || buffer[i] > 0x7E || buffer[i] === 0x22 || buffer[i] === 0x23 ||
          buffer[i] === 0x3C || buffer[i] === 0x3E) {
        this.url.query += percentEncode(buffer[i]);
      } else {
        this.url.query += String.fromCodePoint(buffer[i]);
      }
    }

    this.buffer = "";
    if (c === p("#")) {
      this.url.fragment = "";
      this.state = "fragment";
    }
  } else if (c === 0x9 || c === 0xA || c === 0xD) {
    this.parse_error = true;
  } else {
    //TODO: If c is not a URL code point and not "%", parse error.
    if (c === p("%") &&
      (!isASCIIHex(this.input[this.pointer + 1]) ||
        !isASCIIHex(this.input[this.pointer + 2]))) {
      this.parse_error = true;
    }

    this.buffer += c_str;
  }
};

URLStateMachine.prototype["parse" + "fragment"] =
    function parseFragment(c, c_str) {
  if (isNaN(c)) { // do nothing
  } else if (c === 0x0 || c === 0x9 || c === 0xA || c === 0xD) {
    this.parse_error = true;
  } else {
    //TODO: If c is not a URL code point and not "%", parse error.
    if (c === p("%") &&
      (!isASCIIHex(this.input[this.pointer + 1]) ||
        !isASCIIHex(this.input[this.pointer + 2]))) {
      this.parse_error = true;
    }

    this.url.fragment += c_str;
  }
};

function serializeURL(url, excludeFragment) {
  let output = url.scheme + ":";
  if (url.host !== null) {
    output += "//" + url.username;
    if (url.password !== null) {
      output += ":" + url.password;
    }
    if (url.username !== "" || url.password !== null) {
      output += "@";
    }
    output += serializeHost(url.host);
    if (url.port !== null) {
      output += ":" + url.port;
    }
  } else if (url.host === null && url.scheme === "file") {
    output += "//";
  }

  if (url.nonRelative) {
    output += url.path[0];
  } else {
    output += "/" + url.path.join("/");
  }

  if (url.query !== null) {
    output += "?" + url.query;
  }

  if (!excludeFragment && url.fragment !== null) {
    output += "#" + url.fragment;
  }

  return output;
}

function serializeOrigin(tuple) {
  if (tuple.scheme === undefined || tuple.host === undefined || tuple.port === undefined) {
    return "null";
  }

  let result = tuple.scheme + "://";
  result += tr46.toUnicode(tuple.host, false).domain;

  if (specialSchemas[tuple.scheme] && tuple.port !== specialSchemas[tuple.scheme]) {
    result += ":" + tuple.port;
  }

  return result;
}

// TODO these will be useful for URL constructor
function urlToASCII(domain) {
  try {
    const asciiDomain = parseHost(domain);
    if (typeof asciiDomain !== "string") {
      return "";
    }
    return asciiDomain;
  } catch (e) {
    return "";
  }
}

function urlToUnicode(domain) {
  try {
    const unicodeDomain = parseHost(domain, true);
    if (typeof unicodeDomain !== "string") {
      return "";
    }
    return unicodeDomain;
  } catch (e) {
    return "";
  }
}

module.exports.serializeURL = serializeURL;

module.exports.serializeURLToUnicodeOrigin = function (url) {
  switch (url.scheme) {
    case "blob":
      try {
        return module.exports.serializeURLToUnicodeOrigin(module.exports.parseURL(url.path[0]));
      } catch (e) {
        // serializing an opaque identifier returns "null"
        return "null";
      }
      break;
    case "ftp":
    case "gopher":
    case "http":
    case "https":
    case "ws":
    case "wss":
      return serializeOrigin({
        scheme: url.scheme,
        host: serializeHost(url.host),
        port: url.port === null ? specialSchemas[url.scheme] : url.port
      });
    case "file":
      // spec says "exercise to the reader", chrome says "file://"
      return "file://";
    default:
      // serializing an opaque identifier returns "null"
      return "null";
  }
};

module.exports.basicURLParse = function (input, options) {
  if (options === undefined) {
    options = {};
  }

  const usm = new URLStateMachine(input, options.baseURL, options.encodingOverride, options.url, options.stateOverride);
  if (usm.failure) {
    throw new TypeError("Invalid URL");
  }

  return usm.url;
};

module.exports.setTheUsername = function (url, username) {
  url.username = "";
  const decoded = punycode.ucs2.decode(username);
  for (let i = 0; i < decoded.length; ++i) {
    url.username += encodeChar(decoded[i], isUserInfoEncode);
  }
};

module.exports.setThePassword = function (url, password) {
  if (password === "") {
    url.password = null;
  } else {
    url.password = "";
    const decoded = punycode.ucs2.decode(password);
    for (let i = 0; i < decoded.length; ++i) {
      url.password += encodeChar(decoded[i], isUserInfoEncode);
    }
  }
};

module.exports.serializeHost = serializeHost;

module.exports.serializeInteger = function (integer) {
  return String(integer);
};

module.exports.parseURL = function (input, options) {
  if (options === undefined) {
    options = {};
  }

  // We don't handle blobs, so this just delegates:
  return module.exports.basicURLParse(input, { baseURL: options.baseURL, encodingOverride: options.encodingOverride });
};
