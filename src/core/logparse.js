'use strict';

/**
 * Mojang's log config writes log4j XML events meant for a launcher to read.
 * This turns that stream back into "[12:00:01] [Render thread/INFO]: message" lines;
 * anything that is not XML passes straight through.
 */
class LogParser {
  constructor() {
    this.event = null;
    this.field = null;
  }

  static decode(text) {
    return text
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
  }

  static attr(tag, name) {
    const m = tag.match(new RegExp(`${name}="([^"]*)"`));
    return m ? LogParser.decode(m[1]) : '';
  }

  static format(ev) {
    const d = new Date(Number(ev.timestamp) || Date.now());
    const time = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    const lines = [`[${time}] [${ev.thread}/${ev.level}]: ${ev.message.join('\n')}`];
    if (ev.throwable.length) lines.push(...ev.throwable);
    return lines.join('\n').split('\n');
  }

  /** Feeds one raw line, returns the finished lines it completed (often none). */
  push(line) {
    const trimmed = line.trim();
    if (!this.event) {
      if (trimmed.startsWith('<log4j:Event')) {
        this.event = {
          level: LogParser.attr(trimmed, 'level') || 'INFO',
          thread: LogParser.attr(trimmed, 'thread') || 'main',
          timestamp: LogParser.attr(trimmed, 'timestamp'),
          message: [],
          throwable: [],
        };
        this.field = null;
        return [];
      }
      return [line];
    }
    if (trimmed.startsWith('</log4j:Event>')) {
      const out = LogParser.format(this.event);
      this.event = null;
      return out;
    }
    let rest = line;
    if (rest.includes('<log4j:Message>')) { this.field = 'message'; rest = rest.slice(rest.indexOf('<log4j:Message>') + 15); }
    if (rest.includes('<log4j:Throwable>')) { this.field = 'throwable'; rest = rest.slice(rest.indexOf('<log4j:Throwable>') + 17); }
    let closing = false;
    for (const end of ['</log4j:Message>', '</log4j:Throwable>']) {
      const i = rest.indexOf(end);
      if (i !== -1) { rest = rest.slice(0, i); closing = true; }
    }
    rest = rest.replace('<![CDATA[', '').replace(']]>', '');
    if (this.field && (rest.length || !closing)) this.event[this.field].push(rest);
    if (closing) this.field = null;
    return [];
  }
}

/** INFO/WARN/ERROR/FATAL/DEBUG out of a formatted line, for colouring. */
function levelOf(line) {
  const m = line.match(/\/(INFO|WARN|ERROR|FATAL|DEBUG|TRACE)\]/);
  if (m) return m[1];
  if (/^\s+at |Exception|Error:/.test(line)) return 'ERROR';
  return 'INFO';
}

module.exports = { LogParser, levelOf };
