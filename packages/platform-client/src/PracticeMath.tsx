// Formula rendering adapted from Moodlelike; Mooyu supplies its own layout and styles.
import React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

import type { ReactNode } from 'react';

type MathContentProps = {
  text: string;
  className?: string;
  displayInlineMath?: boolean;
  formatPlainMath?: boolean;
};

const MATH_TOKEN_PATTERN = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g;
const BARE_LATEX_COMMAND_NAMES = 'frac|dfrac|tfrac|sqrt|leq|geq|neq|times|cdot|pm|mp|infty|cup|cap|theta|alpha|beta|gamma|pi|Delta|delta|lambda|mu|sin|cos|tan|log|ln|left|right|mathrm|text|overline|overrightarrow|angle|parallel|perp|approx|sim|equiv|to|rightarrow|leftarrow|sum|int|lim|binom|begin|end';
const BARE_LATEX_COMMAND_PATTERN = new RegExp(`\\\\{1,2}(?:${BARE_LATEX_COMMAND_NAMES})\\b`);
const BARE_LATEX_COMMAND_SPAN_PATTERN = new RegExp(`\\\\{1,2}(?:${BARE_LATEX_COMMAND_NAMES})\\b`, 'g');

const LEGACY_TOKEN_PATTERN = /(f\(x\)=1\/√x=x\^\(-1\/2\)|f\(x\)=1\/√x|1\/√x|x\^\(-1\/2\)|f\(π\)\s*<\s*f\(3\)|π\s*>\s*3|\(0,\+∞\)|f\(π\)|f\(3\)|f\(x\)|在 R 上)/g;

function normalizeLatexSource(source: string) {
  return source
    .replace(/\\\\(?=[A-Za-z])/g, '\\')
    .replace(/^\\\(/, '')
    .replace(/\\\)$/, '')
    .replace(/^\\\[/, '')
    .replace(/\\\]$/, '')
    .replace(/\\dfrac\b/g, '\\frac')
    .replace(/\\tfrac\b/g, '\\frac')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDisplayText(text: string) {
  return text
    .replace(/\\\\\(/g, '\\(')
    .replace(/\\\\\)/g, '\\)')
    .replace(/\\\\\[/g, '\\[')
    .replace(/\\\\\]/g, '\\]')
    .replace(/\\\\(?=(?:frac|dfrac|tfrac|sqrt|leq|geq|neq|times|cdot|pm|mp|infty|cup|cap|theta|alpha|beta|gamma|pi|Delta|delta|lambda|mu|sin|cos|tan|log|ln|left|right|mathrm|text|overline|overrightarrow|angle|parallel|perp|approx|sim|equiv|to|rightarrow|leftarrow|sum|int|lim|binom|begin|end)\b)/g, '\\');
}

function renderFormula(source: string, displayMode: boolean) {
  try {
    const normalizedSource = normalizeLatexSource(source);
    if (/[\u3400-\u9fff]/.test(normalizedSource) && !/\\(?:text|mathrm)\s*\{/.test(normalizedSource)) return null;
    return katex.renderToString(normalizedSource, {
      displayMode,
      strict: false,
      throwOnError: true,
      trust: false
    });
  } catch {
    return null;
  }
}

function stripOuterBareMathPunctuation(source: string) {
  let prefix = '';
  let body = source;
  let suffix = '';

  const prefixMatch = body.match(/^[\s，。；;：:、]+/);
  if (prefixMatch) {
    prefix = prefixMatch[0];
    body = body.slice(prefix.length);
  }

  const suffixMatch = body.match(/[\s，。；;：:、]+$/);
  if (suffixMatch) {
    suffix = suffixMatch[0];
    body = body.slice(0, -suffix.length);
  }

  return { prefix, body, suffix };
}

function renderPlainText(text: string, key: string, formatPlainMath = false) {
  const lines = text.split('\n');
  return lines.flatMap<ReactNode>((line, index) => {
    const itemKey = `${key}-text-${index}`;
    if (!formatPlainMath) return index === 0 ? [<span key={itemKey}>{line}</span>] : [<br key={`${itemKey}-br`} />, <span key={itemKey}>{line}</span>];
    // Legacy public questions also store coordinates, fractions and powers as
    // ASCII. Typeset only explicit notation, preserving every numeric value.
    const powers = /\b[A-Z]\s*=\s*\((?:[+-]?(?:\d+(?:\.\d+)?|[a-z]),\s*){1,2}[+-]?(?:\d+(?:\.\d+)?|[a-z])\)|([A-Za-z0-9)])\^(?:\{([+-]?\d+)\}|\(([+-]?\d+(?:\/\d+)?)\)|([+-]?\d+))|(?<![\w/.:])([+-]?\d+)\/(\d+)(?![\d/.])/g;
    const nodes: ReactNode[] = []; let start = 0; let match: RegExpExecArray | null;
    while ((match = powers.exec(line))) {
      nodes.push(line.slice(start, match.index));
      if (match[5]) nodes.push(formulaNode(`\\displaystyle\\frac{${match[5]}}{${match[6]}}`, `${itemKey}-${match.index}`));
      else if (match[1]) nodes.push(match[1], <sup key={`${itemKey}-${match.index}`}>{match[2] ?? match[3] ?? match[4]}</sup>);
      else nodes.push(<span className="math-content-coordinate" key={`${itemKey}-${match.index}`}>{match[0]}</span>);
      start = match.index + match[0].length;
    }
    nodes.push(line.slice(start));
    if (index === 0) return [<span key={itemKey}>{nodes}</span>];
    return [<br key={`${itemKey}-br`} />, <span key={itemKey}>{nodes}</span>];
  });
}

function balancedGroupEnd(input: string, start: number, open: string, close: string) {
  if (input[start] !== open) return start;
  let depth = 0;
  for (let index = start; index < input.length; index += 1) {
    if (input[index] === open) depth += 1;
    if (input[index] === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return start + 1;
}

function latexCommandSpanEnd(input: string, start: number, commandEnd: number) {
  let cursor = commandEnd;
  let groupCount = 0;
  while (groupCount < 2) {
    while (/\s/.test(input[cursor] ?? '')) cursor += 1;
    if (input[cursor] === '[') {
      cursor = balancedGroupEnd(input, cursor, '[', ']');
      continue;
    }
    if (input[cursor] !== '{') break;
    const next = balancedGroupEnd(input, cursor, '{', '}');
    if (next <= cursor + 1) break;
    cursor = next;
    groupCount += 1;
  }

  while (input[cursor] === '^' || input[cursor] === '_') {
    cursor += 1;
    if (input[cursor] === '{') {
      cursor = balancedGroupEnd(input, cursor, '{', '}');
    } else if (input[cursor]) {
      cursor += 1;
    }
  }

  return Math.max(cursor, start + 1);
}

function renderBareLatexText(text: string, key: string, formatPlainMath = false) {
  if (!BARE_LATEX_COMMAND_PATTERN.test(text)) return renderPlainText(text, key, formatPlainMath);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  BARE_LATEX_COMMAND_SPAN_PATTERN.lastIndex = 0;
  while ((match = BARE_LATEX_COMMAND_SPAN_PATTERN.exec(text))) {
    const start = match.index;
    if (start > cursor) nodes.push(...renderPlainText(text.slice(cursor, start), `${key}-plain-${nodes.length}`, formatPlainMath));
    const end = latexCommandSpanEnd(text, start, start + match[0].length);
    const { prefix, body, suffix } = stripOuterBareMathPunctuation(text.slice(start, end));
    if (body.trim()) {
      nodes.push(...renderPlainText(prefix, `${key}-prefix-${nodes.length}`, formatPlainMath));
      nodes.push(formulaNode(body, `${key}-bare-math-${nodes.length}`));
      nodes.push(...renderPlainText(suffix, `${key}-suffix-${nodes.length}`, formatPlainMath));
    } else {
      nodes.push(...renderPlainText(text.slice(start, end), `${key}-empty-${nodes.length}`, formatPlainMath));
    }
    cursor = end;
    BARE_LATEX_COMMAND_SPAN_PATTERN.lastIndex = end;
  }
  if (cursor < text.length) nodes.push(...renderPlainText(text.slice(cursor), `${key}-tail`, formatPlainMath));
  return nodes;
}

function formulaNode(source: string, key: string, displayMode = false) {
  const html = renderFormula(source, displayMode);
  if (!html) return <span key={key} className="math-content-fallback">{displayMode ? `$$${source}$$` : `$${source}$`}</span>;
  const Tag = displayMode ? 'div' : 'span';
  return (
    <Tag
      key={key}
      className={displayMode ? 'math-content-block' : 'math-content-inline'}
      data-math-formula="true"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function renderLegacyToken(token: string, key: string) {
  const compactToken = token.replace(/\s+/g, '');
  if (token === 'f(x)=1/√x=x^(-1/2)') return formulaNode('f(x)=\\frac{1}{\\sqrt{x}}=x^{-\\frac12}', key);
  if (token === 'f(x)=1/√x') return formulaNode('f(x)=\\frac{1}{\\sqrt{x}}', key);
  if (token === '1/√x') return formulaNode('\\frac{1}{\\sqrt{x}}', key);
  if (token === 'x^(-1/2)') return formulaNode('x^{-\\frac12}', key);
  if (/^f\(π\)\s*<\s*f\(3\)$/.test(token)) return formulaNode('f(\\pi)<f(3)', key);
  if (compactToken === 'π>3') return formulaNode('\\pi>3', key);
  if (token === '(0,+∞)') return formulaNode('(0,+\\infty)', key);
  if (token === 'f(π)') return formulaNode('f(\\pi)', key);
  if (token === 'f(3)') return formulaNode('f(3)', key);
  if (token === 'f(x)') return formulaNode('f(x)', key);
  if (token === '在 R 上') {
    return (
      <span key={key}>
        在 {formulaNode('\\mathbb{R}', `${key}-r`)} 上
      </span>
    );
  }
  return <span key={key}>{token}</span>;
}

function renderLegacyText(text: string, formatPlainMath = false) {
  const parts = text.split(LEGACY_TOKEN_PATTERN).filter((part) => part.length > 0);
  return parts.flatMap<ReactNode>((part, index) => {
    if (LEGACY_TOKEN_PATTERN.test(part)) {
      LEGACY_TOKEN_PATTERN.lastIndex = 0;
      return [renderLegacyToken(part, `legacy-${index}`)];
    }
    LEGACY_TOKEN_PATTERN.lastIndex = 0;
    return renderBareLatexText(part, `legacy-${index}`, formatPlainMath);
  });
}

export function MathContent({ text, className, displayInlineMath = false, formatPlainMath = false }: MathContentProps) {
  const normalizedText = normalizeDisplayText(text);
  const hasLatex = MATH_TOKEN_PATTERN.test(normalizedText);
  MATH_TOKEN_PATTERN.lastIndex = 0;
  const parts = hasLatex ? normalizedText.split(MATH_TOKEN_PATTERN).filter((part) => part.length > 0) : [];

  return (
    <span className={['math-content', className].filter(Boolean).join(' ')}>
      {!hasLatex ? renderLegacyText(normalizedText, formatPlainMath) : parts.map((part, index) => {
        const isDollarBlock = part.startsWith('$$') && part.endsWith('$$');
        const isBracketBlock = part.startsWith('\\[') && part.endsWith('\\]');
        const isBlock = isDollarBlock || isBracketBlock;
        const isParenInline = part.startsWith('\\(') && part.endsWith('\\)');
        const isInline = isParenInline || (!isBlock && part.startsWith('$') && part.endsWith('$'));
        if (!isBlock && !isInline) return renderBareLatexText(part, `part-${index}`, formatPlainMath);

        const source = isDollarBlock || isBracketBlock || isParenInline ? part.slice(2, -2).trim() : part.slice(1, -1).trim();
        return formulaNode(source, `math-${index}`, isBlock || displayInlineMath);
      })}
    </span>
  );
}
