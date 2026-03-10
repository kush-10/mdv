import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkCustomHeaderId from 'remark-custom-header-id';
import { defListHastHandlers, remarkDefinitionList } from 'remark-definition-list';
import remarkGemoji from 'remark-gemoji';
import remarkGfm from 'remark-gfm';
import { remarkMark } from 'remark-mark-highlight';
import remarkSupersub from 'remark-supersub';
import { ThemeAnimationType, useModeAnimation } from 'react-theme-switch-animation';

type HeadingItem = {
  id: string;
  text: string;
  level: number;
};

type DocumentVisibility = 'private' | 'pinned';

type EditStatus = 'idle' | 'checking' | 'saving' | 'saved' | 'error' | 'unauthorized';

const POLL_INTERVAL_MS = 800;
const EDIT_AUTOSAVE_DEBOUNCE_MS = 900;

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
    '*': [...((defaultSchema.attributes?.['*'] as any[]) ?? []), 'id'],
    a: [
      ...((defaultSchema.attributes?.a as any[]) ?? []),
      'ariaDescribedBy',
      'ariaLabel',
      'dataFootnoteRef',
      'dataFootnoteBackref'
    ],
    code: [
      ...((defaultSchema.attributes?.code as any[]) ?? []),
      ['className', /^language-./, /^hljs(?:-|$).*/]
    ],
    h1: [...((defaultSchema.attributes?.h1 as any[]) ?? []), 'id'],
    h2: [...((defaultSchema.attributes?.h2 as any[]) ?? []), 'id'],
    h3: [...((defaultSchema.attributes?.h3 as any[]) ?? []), 'id'],
    h4: [...((defaultSchema.attributes?.h4 as any[]) ?? []), 'id'],
    h5: [...((defaultSchema.attributes?.h5 as any[]) ?? []), 'id'],
    h6: [...((defaultSchema.attributes?.h6 as any[]) ?? []), 'id'],
    input: [
      ...((defaultSchema.attributes?.input as any[]) ?? []),
      ['type', 'checkbox'],
      'checked',
      'disabled'
    ],
    li: [...((defaultSchema.attributes?.li as any[]) ?? []), ['className', 'task-list-item']],
    section: [
      ...((defaultSchema.attributes?.section as any[]) ?? []),
      'dataFootnotes',
      ['className', 'footnotes']
    ],
    span: [...((defaultSchema.attributes?.span as any[]) ?? []), ['className', /^hljs(?:-|$).*/]],
    ol: [...((defaultSchema.attributes?.ol as any[]) ?? []), ['className', 'contains-task-list']],
    ul: [...((defaultSchema.attributes?.ul as any[]) ?? []), ['className', 'contains-task-list']]
  }
};

const remarkPlugins = [
  [remarkGfm, { singleTilde: false }],
  remarkCustomHeaderId,
  remarkDefinitionList,
  remarkGemoji,
  remarkMark,
  remarkSupersub
];

const rehypePlugins = [
  rehypeRaw,
  rehypeSlug,
  rehypeHighlight,
  [rehypeSanitize, sanitizeSchema]
];

const remarkRehypeOptions = {
  allowDangerousHtml: true,
  handlers: defListHastHandlers
};

function getRenderedMarkdownHeadings(): HeadingItem[] {
  const headingNodes = document.querySelectorAll<HTMLElement>(
    '.markdown-body h1[id], .markdown-body h2[id], .markdown-body h3[id], .markdown-body h4[id], .markdown-body h5[id], .markdown-body h6[id]'
  );

  return Array.from(headingNodes)
    .map((node) => {
      const text = (node.textContent ?? '').trim();
      const id = node.id.trim();
      const level = Number.parseInt(node.tagName.slice(1), 10);

      if (!id || !text || !Number.isInteger(level)) {
        return null;
      }

      return {
        id,
        text,
        level
      } satisfies HeadingItem;
    })
    .filter((item): item is HeadingItem => item !== null);
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

function getShareUrlFromLocation(): string {
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

function getPdfDownloadUrl(remoteSlug: string): string {
  if (!remoteSlug) {
    return '/api/markdown/pdf';
  }

  return `/api/markdown/${encodeURIComponent(remoteSlug)}/pdf`;
}

function getFallbackPdfFileName(inputPath: string): string {
  const fileName = getFileNameFromPath(inputPath);
  const withoutExtension = fileName.replace(/\.[^.]+$/, '').trim();
  const baseName = withoutExtension || 'document';
  const safeName = baseName.replace(/[\\/:*?"<>|]/g, '-');
  return `${safeName}.pdf`;
}

function getPdfFileNameFromContentDisposition(contentDisposition: string | null, fallbackPath: string): string {
  if (contentDisposition) {
    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      const decoded = decodeURIComponent(utf8Match[1]).trim();
      if (decoded) {
        return decoded;
      }
    }

    const fallbackMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    if (fallbackMatch?.[1]) {
      const parsed = fallbackMatch[1].trim();
      if (parsed) {
        return parsed;
      }
    }
  }

  return getFallbackPdfFileName(fallbackPath);
}

function normalizeDocumentVisibility(value: string | null | undefined): DocumentVisibility {
  return value === 'pinned' ? 'pinned' : 'private';
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  );
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const tempTextArea = document.createElement('textarea');
  tempTextArea.value = value;
  tempTextArea.setAttribute('readonly', 'true');
  tempTextArea.style.position = 'fixed';
  tempTextArea.style.opacity = '0';
  tempTextArea.style.pointerEvents = 'none';
  document.body.appendChild(tempTextArea);
  tempTextArea.select();

  const didCopy = document.execCommand('copy');
  document.body.removeChild(tempTextArea);

  if (!didCopy) {
    throw new Error('Clipboard copy failed.');
  }
}

export function App(): JSX.Element {
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState('');
  const [filePath, setFilePath] = useState('');
  const [documentVisibility, setDocumentVisibility] = useState<DocumentVisibility>('private');
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState('');
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState(() => getShareUrlFromLocation());
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [qrCodeError, setQrCodeError] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [isPdfDownloading, setIsPdfDownloading] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [draftMarkdown, setDraftMarkdown] = useState('');
  const [editStatus, setEditStatus] = useState<EditStatus>('idle');
  const [editError, setEditError] = useState('');
  const markdownRef = useRef('');
  const lastSavedDraftRef = useRef('');
  const shareUrlInputRef = useRef<HTMLInputElement | null>(null);
  const editorLineRailRef = useRef<HTMLDivElement | null>(null);

  const remoteSlug = useMemo(() => getRemoteSlugFromLocation(), []);

  const shareShortcutLabel = useMemo(() => {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Cmd+K' : 'Ctrl+K';
  }, []);

  const pdfDownloadUrl = useMemo(() => getPdfDownloadUrl(remoteSlug), [remoteSlug]);

  const renderedMarkdown = isEditMode ? draftMarkdown : markdown;

  const editorLineNumbers = useMemo(() => {
    const lineCount = Math.max(1, draftMarkdown.split('\n').length);
    return Array.from({ length: lineCount }, (_value, index) => index + 1);
  }, [draftMarkdown]);

  const editStatusLabel = useMemo(() => {
    switch (editStatus) {
      case 'checking':
        return 'Checking admin access...';
      case 'saving':
        return 'Autosaving...';
      case 'saved':
        return 'Saved';
      case 'unauthorized':
        return 'Admin auth required';
      case 'error':
        return 'Autosave failed';
      default:
        return 'Autosave enabled';
    }
  }, [editStatus]);

  const { ref, toggleSwitchTheme, isDarkMode } = useModeAnimation({
    animationType: ThemeAnimationType.CIRCLE,
    duration: 700,
    easing: 'ease-in-out',
    globalClassName: 'dark'
  });

  useEffect(() => {
    if (isEditMode) {
      return;
    }

    let isDisposed = false;
    let isLoading = false;
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
        setDocumentVisibility(normalizeDocumentVisibility(response.headers.get('x-md-visibility')));
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
  }, [isEditMode, remoteSlug]);

  useEffect(() => {
    const fileName = getFileNameFromPath(filePath);
    document.title = fileName ? `${fileName} - Local MD Viewer` : 'Local MD Viewer';
  }, [filePath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        if (isEditableElement(event.target)) {
          return;
        }

        event.preventDefault();
        setIsShareDialogOpen((isOpen) => !isOpen);
        return;
      }

      if (event.key === 'Escape') {
        setIsShareDialogOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!isShareDialogOpen) {
      return;
    }

    setShareUrl(getShareUrlFromLocation());
    setCopyStatus('idle');

    const timer = window.setTimeout(() => {
      shareUrlInputRef.current?.focus();
      shareUrlInputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isShareDialogOpen]);

  useEffect(() => {
    if (!isShareDialogOpen) {
      return;
    }

    let isDisposed = false;
    setQrCodeDataUrl('');
    setQrCodeError('');

    const generateQrCode = async () => {
      try {
        const dataUrl = await QRCode.toDataURL(shareUrl, {
          width: 280,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: {
            dark: '#111111',
            light: '#FFFFFF'
          }
        });

        if (!isDisposed) {
          setQrCodeDataUrl(dataUrl);
        }
      } catch {
        if (!isDisposed) {
          setQrCodeError('Unable to generate QR code.');
        }
      }
    };

    void generateQrCode();

    return () => {
      isDisposed = true;
    };
  }, [isShareDialogOpen, shareUrl]);

  useEffect(() => {
    if (copyStatus !== 'copied') {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopyStatus('idle');
    }, 1400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copyStatus]);

  useEffect(() => {
    if (error) {
      setHeadings([]);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setHeadings(getRenderedMarkdownHeadings());
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [error, renderedMarkdown]);

  useEffect(() => {
    if (isEditMode || headings.length === 0) {
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
  }, [headings, isEditMode]);

  useEffect(() => {
    if (!isEditMode) {
      return;
    }

    setDraftMarkdown(markdownRef.current);
    lastSavedDraftRef.current = markdownRef.current;
    setEditError('');
    setEditStatus('idle');
  }, [isEditMode]);

  useEffect(() => {
    if (editStatus !== 'saved') {
      return;
    }

    const timer = window.setTimeout(() => {
      setEditStatus('idle');
    }, 1100);

    return () => {
      window.clearTimeout(timer);
    };
  }, [editStatus]);

  useEffect(() => {
    if (!isEditMode || !remoteSlug) {
      return;
    }

    if (editStatus === 'checking' || editStatus === 'saving' || editStatus === 'unauthorized') {
      return;
    }

    if (draftMarkdown === lastSavedDraftRef.current) {
      return;
    }

    const markdownToSave = draftMarkdown;
    const timer = window.setTimeout(() => {
      const saveDraft = async () => {
        setEditStatus('saving');
        setEditError('');

        try {
          const response = await fetch(`/api/admin/files/${encodeURIComponent(remoteSlug)}`, {
            method: 'PUT',
            headers: {
              'content-type': 'application/json'
            },
            cache: 'no-store',
            body: JSON.stringify({ markdown: markdownToSave })
          });

          if (response.status === 401) {
            setEditStatus('unauthorized');
            setEditError('Open /admin in this browser tab, sign in, then retry edit mode.');
            return;
          }

          if (!response.ok) {
            setEditStatus('error');
            setEditError(`Autosave failed (${response.status}).`);
            return;
          }

          const payload = (await response.json()) as { visibility?: string };
          lastSavedDraftRef.current = markdownToSave;
          markdownRef.current = markdownToSave;
          setMarkdown(markdownToSave);
          setDocumentVisibility(normalizeDocumentVisibility(payload.visibility));
          setEditStatus('saved');
        } catch {
          setEditStatus('error');
          setEditError('Autosave failed. Check server connectivity.');
        }
      };

      void saveDraft();
    }, EDIT_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [draftMarkdown, editStatus, isEditMode, remoteSlug]);

  const closeShareDialog = () => {
    setIsShareDialogOpen(false);
  };

  const handleShareCopy = async () => {
    try {
      await copyTextToClipboard(shareUrl);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
  };

  const handlePdfDownload = async () => {
    if (isPdfDownloading) {
      return;
    }

    setIsPdfDownloading(true);

    try {
      const response = await fetch(pdfDownloadUrl, {
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`PDF request failed with status ${response.status}`);
      }

      const pdfBlob = await response.blob();
      const blobUrl = URL.createObjectURL(pdfBlob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = blobUrl;
      downloadAnchor.download = getPdfFileNameFromContentDisposition(
        response.headers.get('content-disposition'),
        filePath
      );

      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);

      window.setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 1000);
    } catch {
      return;
    } finally {
      setIsPdfDownloading(false);
    }
  };

  const verifyAdminSession = async (): Promise<boolean> => {
    setEditStatus('checking');
    setEditError('');

    try {
      const response = await fetch('/api/admin/session', {
        cache: 'no-store'
      });

      if (!response.ok) {
        setEditStatus('unauthorized');
        setEditError('Edit mode is admin-only. Open /admin and authenticate first.');
        return false;
      }

      setEditStatus('idle');
      return true;
    } catch {
      setEditStatus('error');
      setEditError('Unable to verify admin session.');
      return false;
    }
  };

  const handleEditToggle = async () => {
    if (!remoteSlug) {
      return;
    }

    if (isEditMode) {
      setIsEditMode(false);
      setEditStatus('idle');
      setEditError('');
      return;
    }

    const isAuthorized = await verifyAdminSession();
    if (!isAuthorized) {
      return;
    }

    setIsEditMode(true);
  };

  const handleRetryAuth = async () => {
    const isAuthorized = await verifyAdminSession();
    if (!isAuthorized) {
      return;
    }

    setEditError('');
    setEditStatus('idle');
  };

  return (
    <>
      <header className="top-bar">
        <div className="file-meta">
          <span
            className={`doc-visibility-chip is-${documentVisibility}`}
            aria-label={documentVisibility === 'pinned' ? 'Pinned document' : 'Private document'}
            title={documentVisibility === 'pinned' ? 'Pinned (shown on home page)' : 'Private (unlisted on home page)'}
          >
            <span className="doc-visibility-icon" aria-hidden="true">
              {documentVisibility === 'pinned' ? '📌' : '🔒'}
            </span>
            <span className="doc-visibility-label">{documentVisibility}</span>
          </span>
          <div className="file-path" title={filePath || 'Loading markdown path...'}>
            {filePath || 'Loading markdown path...'}
          </div>
        </div>
        <div className="top-bar-actions">
          {remoteSlug ? (
            <button
              type="button"
              className={`edit-toggle${isEditMode ? ' is-active' : ''}`}
              aria-label={isEditMode ? 'Exit edit mode' : 'Enter edit mode'}
              onClick={() => {
                void handleEditToggle();
              }}
            >
              {isEditMode ? 'Done' : 'Edit'}
            </button>
          ) : null}
          <button
            type="button"
            className="share-toggle"
            aria-label={`Share this page (${shareShortcutLabel})`}
            aria-haspopup="dialog"
            aria-expanded={isShareDialogOpen}
            onClick={() => setIsShareDialogOpen(true)}
          >
            Share
          </button>
          <button
            type="button"
            className="pdf-download"
            aria-label={isPdfDownloading ? 'Generating PDF' : 'Download PDF'}
            onClick={() => {
              void handlePdfDownload();
            }}
            disabled={isPdfDownloading}
          >
            {isPdfDownloading ? 'PDF...' : 'PDF'}
          </button>
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
        </div>
      </header>

      {headings.length > 0 && !isEditMode ? (
        <aside className="toc-rail" aria-label="Table of contents">
          <p className="toc-title">On this page</p>
          <ul className="toc-list">
            {headings.map((heading) => (
              <li
                key={heading.id}
                className={`toc-item toc-l${heading.level}${
                  activeHeadingId === heading.id ? ' is-active' : ''
                }`}
              >
                <a className="toc-link" href={`#${heading.id}`}>
                  <span className="toc-label">{heading.text}</span>
                </a>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}

      {isShareDialogOpen ? (
        <div className="share-overlay" role="presentation" onClick={closeShareDialog}>
          <section
            className="share-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="share-close"
              aria-label="Close share dialog"
              onClick={closeShareDialog}
            >
              x
            </button>
            <h2 id="share-dialog-title">Share this page</h2>
            <p className="share-description">Scan the QR code or copy the link.</p>

            <div className="share-qr-shell">
              {qrCodeDataUrl ? (
                <img src={qrCodeDataUrl} alt="QR code for this page" />
              ) : qrCodeError ? (
                <p className="share-qr-message is-error">{qrCodeError}</p>
              ) : (
                <p className="share-qr-message">Generating QR code...</p>
              )}
            </div>

            <div className="share-url-row">
              <input
                ref={shareUrlInputRef}
                type="text"
                className="share-url-input"
                value={shareUrl}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Shareable link"
              />
              <button type="button" className="share-copy" onClick={handleShareCopy}>
                {copyStatus === 'copied' ? 'Copied' : 'Copy link'}
              </button>
            </div>

            <p className="share-meta">
              Shortcut: <kbd>{shareShortcutLabel}</kbd>
              {copyStatus === 'error' ? ' - Clipboard unavailable.' : ''}
            </p>
          </section>
        </div>
      ) : null}

      <main className={`reading-view${isEditMode ? ' is-edit-mode' : ''}`} aria-live="polite">
        {isEditMode ? (
          <section className="editor-split">
            <section className="raw-editor-panel" aria-label="Raw markdown editor">
              <header className="raw-editor-header">
                <h2>Raw Markdown</h2>
                <div className="raw-editor-status">
                  <span className={`edit-status is-${editStatus}`}>{editStatusLabel}</span>
                  {editStatus === 'unauthorized' ? (
                    <button
                      type="button"
                      className="edit-auth-retry"
                      onClick={() => {
                        void handleRetryAuth();
                      }}
                    >
                      Retry auth
                    </button>
                  ) : null}
                </div>
              </header>

              {editError ? <p className="raw-editor-error">{editError}</p> : null}

              <div className="raw-editor-shell">
                <div className="raw-editor-lines" aria-hidden="true" ref={editorLineRailRef}>
                  {editorLineNumbers.map((lineNumber) => (
                    <div key={lineNumber}>{lineNumber}</div>
                  ))}
                </div>
                <textarea
                  className="raw-editor-input"
                  value={draftMarkdown}
                  spellCheck={false}
                  onChange={(event) => {
                    setDraftMarkdown(event.currentTarget.value);
                  }}
                  onScroll={(event) => {
                    if (!editorLineRailRef.current) {
                      return;
                    }

                    editorLineRailRef.current.scrollTop = event.currentTarget.scrollTop;
                  }}
                  aria-label="Markdown source editor"
                />
              </div>
            </section>

            <article className="markdown-body preview-pane">
              {error ? (
                <p>{error}</p>
              ) : (
                <ReactMarkdown
                  remarkPlugins={remarkPlugins as any}
                  rehypePlugins={rehypePlugins as any}
                  remarkRehypeOptions={remarkRehypeOptions as any}
                >
                  {renderedMarkdown}
                </ReactMarkdown>
              )}
            </article>
          </section>
        ) : (
          <article className="markdown-body">
            {error ? (
              <p>{error}</p>
            ) : (
              <ReactMarkdown
                remarkPlugins={remarkPlugins as any}
                rehypePlugins={rehypePlugins as any}
                remarkRehypeOptions={remarkRehypeOptions as any}
              >
                {renderedMarkdown}
              </ReactMarkdown>
            )}
          </article>
        )}
      </main>
    </>
  );
}
