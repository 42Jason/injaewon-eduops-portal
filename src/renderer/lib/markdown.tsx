/**
 * Ultra-minimal Markdown -> React renderer.
 * Enough for internal SOP/manuals:
 *   - # / ## / ### headings
 *   - **bold** / *italic* / `inline code`
 *   - - and * unordered lists, 1. ordered lists
 *   - ```code fences```
 *   - blockquotes (>)
 *   - [link](url) — rendered as plain span (no navigation in Electron)
 *   - horizontal rule (---)
 *   - paragraphs
 */
import { Fragment, type ReactNode } from 'react';

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    // inline code
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        out.push(
          <code
            key={`${keyBase}-c${k++}`}
            className="px-1 py-0.5 rounded bg-bg-soft text-accent text-[0.9em] font-mono"
          >
            {text.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }
    // bold
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        out.push(
          <strong key={`${keyBase}-b${k++}`} className="text-fg font-semibold">
            {renderInline(text.slice(i + 2, end), `${keyBase}-b${k}`)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }
    // italic (single * not followed by another *)
    if (text[i] === '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1) {
        out.push(
          <em key={`${keyBase}-i${k++}`} className="italic">
            {text.slice(i + 1, end)}
          </em>,
        );
        i = end + 1;
        continue;
      }
    }
    // link [label](url)
    if (text[i] === '[') {
      const close = text.indexOf(']', i + 1);
      if (close !== -1 && text[close + 1] === '(') {
        const urlEnd = text.indexOf(')', close + 2);
        if (urlEnd !== -1) {
          const label = text.slice(i + 1, close);
          const url = text.slice(close + 2, urlEnd);
          out.push(
            <span key={`${keyBase}-l${k++}`} className="text-accent underline" title={url}>
              {label}
            </span>,
          );
          i = urlEnd + 1;
          continue;
        }
      }
    }
    // plain char
    const nextSpecial = findNextSpecial(text, i);
    out.push(<Fragment key={`${keyBase}-t${k++}`}>{text.slice(i, nextSpecial)}</Fragment>);
    i = nextSpecial;
  }
  return out;
}

function findNextSpecial(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '`' || c === '*' || c === '[') return i;
  }
  return text.length;
}

export function renderMarkdown(src: string): ReactNode {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      let j = i + 1;
      const bodyLines: string[] = [];
      while (j < lines.length && !lines[j].startsWith('```')) {
        bodyLines.push(lines[j]);
        j++;
      }
      blocks.push(
        <pre
          key={`code-${k++}`}
          className="my-3 p-3 rounded border border-border bg-bg-soft/50 text-xs font-mono overflow-x-auto"
        >
          <code className="text-fg-muted">{bodyLines.join('\n')}</code>
          {lang && (
            <div className="text-[10px] text-fg-subtle mt-2 uppercase tracking-wider">{lang}</div>
          )}
        </pre>,
      );
      i = j + 1;
      continue;
    }

    // horizontal rule
    if (/^\s*---+\s*$/.test(line)) {
      blocks.push(<hr key={`hr-${k++}`} className="my-4 border-border" />);
      i++;
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const txt = h[2];
      const sizes = ['text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-xs'];
      const size = sizes[Math.min(level - 1, 5)];
      const mt = level === 1 ? 'mt-6' : level === 2 ? 'mt-5' : 'mt-4';
      blocks.push(
        <div
          key={`h-${k++}`}
          className={`${size} ${mt} mb-2 font-semibold text-fg border-b border-border pb-1`}
        >
          {renderInline(txt, `h${k}`)}
        </div>,
      );
      i++;
      continue;
    }

    // blockquote
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <blockquote
          key={`bq-${k++}`}
          className="my-3 pl-3 border-l-2 border-accent/60 text-fg-muted italic"
        >
          {renderInline(quoteLines.join(' '), `bq${k}`)}
        </blockquote>,
      );
      continue;
    }

    // unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`ul-${k++}`} className="my-2 pl-5 list-disc space-y-1 text-fg-muted">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `ul${k}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`ol-${k++}`} className="my-2 pl-5 list-decimal space-y-1 text-fg-muted">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `ol${k}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // paragraph — join consecutive non-blank lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !lines[i].match(/^(#{1,6})\s+/) &&
      !lines[i].startsWith('> ') &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^\s*---+\s*$/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`p-${k++}`} className="my-2 text-fg-muted leading-relaxed">
        {renderInline(paraLines.join(' '), `p${k}`)}
      </p>,
    );
  }

  return <div className="text-sm">{blocks}</div>;
}
