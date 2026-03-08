import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkCustomHeaderId from 'remark-custom-header-id';
import { defListHastHandlers, remarkDefinitionList } from 'remark-definition-list';
import remarkGemoji from 'remark-gemoji';
import remarkGfm from 'remark-gfm';
import { remarkMark } from 'remark-mark-highlight';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import remarkSupersub from 'remark-supersub';
import { unified } from 'unified';

type RenderMarkdownToPdfInput = {
  markdown: string;
  title: string;
  sourceDir: string;
};

const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: '',
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'dl',
    'dt',
    'dd',
    'mark',
    'sub',
    'sup',
    'section'
  ],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    '*': [...((defaultSchema.attributes?.['*'] as unknown[]) ?? []), 'id'],
    a: [
      ...((defaultSchema.attributes?.a as unknown[]) ?? []),
      'ariaDescribedBy',
      'ariaLabel',
      'dataFootnoteRef',
      'dataFootnoteBackref'
    ],
    code: [
      ...((defaultSchema.attributes?.code as unknown[]) ?? []),
      ['className', /^language-./, /^hljs(?:-|$).*/]
    ],
    h1: [...((defaultSchema.attributes?.h1 as unknown[]) ?? []), 'id'],
    h2: [...((defaultSchema.attributes?.h2 as unknown[]) ?? []), 'id'],
    h3: [...((defaultSchema.attributes?.h3 as unknown[]) ?? []), 'id'],
    h4: [...((defaultSchema.attributes?.h4 as unknown[]) ?? []), 'id'],
    h5: [...((defaultSchema.attributes?.h5 as unknown[]) ?? []), 'id'],
    h6: [...((defaultSchema.attributes?.h6 as unknown[]) ?? []), 'id'],
    input: [
      ...((defaultSchema.attributes?.input as unknown[]) ?? []),
      ['type', 'checkbox'],
      'checked',
      'disabled'
    ],
    li: [...((defaultSchema.attributes?.li as unknown[]) ?? []), ['className', 'task-list-item']],
    section: [
      ...((defaultSchema.attributes?.section as unknown[]) ?? []),
      'dataFootnotes',
      ['className', 'footnotes']
    ],
    span: [...((defaultSchema.attributes?.span as unknown[]) ?? []), ['className', /^hljs(?:-|$).*/]],
    ol: [...((defaultSchema.attributes?.ol as unknown[]) ?? []), ['className', 'contains-task-list']],
    ul: [...((defaultSchema.attributes?.ul as unknown[]) ?? []), ['className', 'contains-task-list']]
  }
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveBaseHref(sourceDir: string): string {
  const absolutePath = path.resolve(sourceDir);
  const withTrailingSlash = absolutePath.endsWith(path.sep)
    ? absolutePath
    : `${absolutePath}${path.sep}`;
  return pathToFileURL(withTrailingSlash).toString();
}

function createPdfHtml(bodyHtml: string, title: string, baseHref: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base href="${escapeHtml(baseHref)}" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --font-sans: "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        --font-mono: "RobotoMono Nerd Font", "RobotoMono Nerd Font Mono", "Roboto Mono Nerd Font", "RobotoMonoNerdFont", "Roboto Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        color-scheme: light;
      }
      body {
        margin: 0;
        color: #161616;
        background: #ffffff;
        font-family: var(--font-sans);
        line-height: 1.65;
        font-size: 15px;
      }
      .markdown-body {
        max-width: 900px;
        margin: 0 auto;
        padding: 24px 28px 32px;
      }
      h1, h2, h3, h4, h5, h6 {
        line-height: 1.3;
        margin: 1.3em 0 0.55em;
      }
      h1 {
        font-size: 2rem;
        border-bottom: 1px solid #dddddd;
        padding-bottom: 0.25em;
      }
      h2 {
        font-size: 1.6rem;
        border-bottom: 1px solid #e7e7e7;
        padding-bottom: 0.2em;
      }
      h3 {
        font-size: 1.3rem;
      }
      p {
        margin: 0.8em 0;
      }
      blockquote {
        border-left: 4px solid #cdcdcd;
        margin: 0.9em 0;
        padding: 0.2em 0 0.2em 1em;
        color: #3f3f3f;
      }
      code {
        font-family: var(--font-mono);
        font-size: 0.92em;
        background: #f2f2f2;
        border-radius: 4px;
        padding: 0.08em 0.32em;
      }
      pre {
        background: #f6f8fa;
        border: 1px solid #e1e4e8;
        border-radius: 8px;
        margin: 1em 0;
        overflow-x: auto;
        padding: 0.8em;
      }
      pre code {
        background: transparent;
        border-radius: 0;
        padding: 0;
      }
      table {
        border-collapse: collapse;
        margin: 1em 0;
        width: 100%;
      }
      th,
      td {
        border: 1px solid #d7d7d7;
        padding: 0.4em 0.55em;
        text-align: left;
        vertical-align: top;
      }
      tr:nth-child(2n) {
        background: #fafafa;
      }
      img {
        max-width: 100%;
      }
      hr {
        border: 0;
        border-top: 1px solid #d9d9d9;
        margin: 1.5em 0;
      }
      a {
        color: #0b5bb9;
      }
      @page {
        size: A4;
        margin: 14mm 12mm 16mm;
      }
    </style>
  </head>
  <body>
    <main class="markdown-body">${bodyHtml}</main>
  </body>
</html>`;
}

async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkCustomHeaderId as any)
    .use(remarkDefinitionList as any)
    .use(remarkGemoji as any)
    .use(remarkMark as any)
    .use(remarkSupersub as any)
    .use(remarkRehype, {
      allowDangerousHtml: true,
      handlers: defListHastHandlers as any
    })
    .use(rehypeRaw as any)
    .use(rehypeSlug as any)
    .use(rehypeHighlight as any)
    .use(rehypeSanitize as any, sanitizeSchema as any)
    .use(rehypeStringify)
    .process(markdown);

  return String(file);
}

export async function renderMarkdownToPdf(input: RenderMarkdownToPdfInput): Promise<Buffer> {
  const htmlBody = await renderMarkdownToHtml(input.markdown);
  const pageHtml = createPdfHtml(htmlBody, input.title, resolveBaseHref(input.sourceDir));
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(pageHtml, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    return await page.pdf({
      format: 'A4',
      printBackground: true
    });
  } finally {
    await browser.close();
  }
}
