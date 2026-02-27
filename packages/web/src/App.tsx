import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThemeAnimationType, useModeAnimation } from 'react-theme-switch-animation';

type HeadingItem = {
  id: string;
  text: string;
  level: number;
};

const POLL_INTERVAL_MS = 800;

function createSlugger() {
  const seen = new Map<string, number>();

  return (text: string): string => {
    const base = text
      .toLowerCase()
      .trim()
      .replace(/[`*_~\[\](){}#+.!?,:;"']/g, '')
      .replace(/\s+/g, '-');

    const safeBase = base.length > 0 ? base : 'section';
    const count = seen.get(safeBase) ?? 0;
    seen.set(safeBase, count + 1);
    return count === 0 ? safeBase : `${safeBase}-${count}`;
  };
}

function extractHeadings(markdown: string): HeadingItem[] {
  const slug = createSlugger();
  const headings: HeadingItem[] = [];
  let activeFence: '`' | '~' | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*([`~]{3,})/);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0] as '`' | '~';
      if (activeFence === null) {
        activeFence = fenceChar;
      } else if (activeFence === fenceChar) {
        activeFence = null;
      }

      continue;
    }

    if (activeFence !== null) {
      continue;
    }

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) {
      continue;
    }

    const text = match[2].trim();
    if (!text) {
      continue;
    }

    headings.push({
      id: slug(text),
      text,
      level: match[1].length
    });
  }

  return headings;
}

function getFileNameFromPath(inputPath: string): string {
  if (!inputPath) {
    return '';
  }

  const normalized = inputPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function getRemoteSlugFromLocation(): string {
  const match = window.location.pathname.match(/^\/d\/([^/]+)/);
  if (!match) {
    return '';
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

export function App(): JSX.Element {
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState('');
  const [filePath, setFilePath] = useState('');
  const [activeHeadingId, setActiveHeadingId] = useState('');
  const [hoveredHeadingId, setHoveredHeadingId] = useState('');
  const markdownRef = useRef('');

  const headings = useMemo(() => extractHeadings(markdown), [markdown]);

  const { ref, toggleSwitchTheme, isDarkMode } = useModeAnimation({
    animationType: ThemeAnimationType.CIRCLE,
    duration: 700,
    easing: 'ease-in-out',
    globalClassName: 'dark'
  });

  useEffect(() => {
    let isDisposed = false;
    let isLoading = false;
    const remoteSlug = getRemoteSlugFromLocation();
    const markdownUrl = remoteSlug
      ? `/api/markdown?slug=${encodeURIComponent(remoteSlug)}`
      : '/api/markdown';

    const loadMarkdown = async () => {
      if (isLoading || isDisposed) {
        return;
      }

      isLoading = true;

      try {
        const response = await fetch(markdownUrl, {
          cache: 'no-store'
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        if (isDisposed) {
          return;
        }

        setFilePath(response.headers.get('x-md-path') ?? '');
        const text = await response.text();

        if (isDisposed) {
          return;
        }

        if (text !== markdownRef.current) {
          markdownRef.current = text;
          setMarkdown(text);
        }

        setError('');
      } catch (fetchError) {
        const message =
          fetchError instanceof Error
            ? fetchError.message
            : 'Unable to load markdown content';
        if (!isDisposed) {
          setError(message);
        }
      } finally {
        isLoading = false;
      }
    };

    void loadMarkdown();
    const refreshTimer = window.setInterval(loadMarkdown, POLL_INTERVAL_MS);

    return () => {
      isDisposed = true;
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    const fileName = getFileNameFromPath(filePath);
    document.title = fileName ? `${fileName} - Local MD Viewer` : 'Local MD Viewer';
  }, [filePath]);

  useEffect(() => {
    if (headings.length === 0) {
      setActiveHeadingId('');
      return;
    }

    const updateActiveHeading = () => {
      let current = headings[0].id;

      for (const heading of headings) {
        const node = document.getElementById(heading.id);
        if (!node) {
          continue;
        }

        if (node.getBoundingClientRect().top <= 120) {
          current = heading.id;
        } else {
          break;
        }
      }

      setActiveHeadingId(current);
    };

    updateActiveHeading();
    window.addEventListener('scroll', updateActiveHeading, { passive: true });
    window.addEventListener('resize', updateActiveHeading);

    return () => {
      window.removeEventListener('scroll', updateActiveHeading);
      window.removeEventListener('resize', updateActiveHeading);
    };
  }, [headings]);

  const headingIdQueue = headings.map((item) => item.id);
  let headingIndex = 0;

  const headingRenderer = (tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
    function Heading(props: any) {
      const id = headingIdQueue[headingIndex] ?? `section-${headingIndex}`;
      headingIndex += 1;
      return createElement(tag, { id, ...props });
    };

  return (
    <>
      <header className="top-bar">
        <div className="file-path" title={filePath || 'Loading markdown path...'}>
          {filePath || 'Loading markdown path...'}
        </div>
        <button
          ref={ref}
          type="button"
          className="theme-toggle"
          aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggleSwitchTheme}
        >
          <span aria-hidden="true" className="theme-icon">
            {isDarkMode ? '☀' : '☾'}
          </span>
        </button>
      </header>

      {headings.length > 0 ? (
        <aside className="toc-rail" aria-label="Table of contents">
          <ul className="toc-list">
            {headings.map((heading) => (
              <li
                key={heading.id}
                className={`toc-item toc-l${heading.level}${
                  activeHeadingId === heading.id ? ' is-active' : ''
                }${hoveredHeadingId === heading.id ? ' is-hovered' : ''}`}
                onMouseEnter={() => setHoveredHeadingId(heading.id)}
                onMouseLeave={() => setHoveredHeadingId('')}
              >
                <a className="toc-link" href={`#${heading.id}`}>
                  <span className="toc-line" aria-hidden="true" />
                  <span className="toc-label">{heading.text}</span>
                </a>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}

      <main className="reading-view" aria-live="polite">
        <article className="markdown-body">
          {error ? (
            <p>{error}</p>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: headingRenderer('h1') as any,
                h2: headingRenderer('h2') as any,
                h3: headingRenderer('h3') as any,
                h4: headingRenderer('h4') as any,
                h5: headingRenderer('h5') as any,
                h6: headingRenderer('h6') as any
              }}
            >
              {markdown}
            </ReactMarkdown>
          )}
        </article>
      </main>
    </>
  );
}
