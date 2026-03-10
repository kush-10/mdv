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

type AdminSessionState = 'authorized' | 'unauthorized' | 'error';

type AppIconName =
  | 'pin'
  | 'lock'
  | 'edit'
  | 'check'
  | 'link'
  | 'share'
  | 'download'
  | 'loader'
  | 'sun'
  | 'moon';

type AppIconProps = {
  name: AppIconName;
  className?: string;
};

function getAppIconShape(name: AppIconName): JSX.Element {
  switch (name) {
    case 'pin':
      return (
        <>
          <path d="M7 3.9h6l-1 4 2.4 2V11H5.6V9.9L8 7.9l-1-4Z" />
          <path d="M10 11v5.1" />
        </>
      );
    case 'lock':
      return (
        <>
          <path d="M7.1 9V7a2.9 2.9 0 0 1 5.8 0v2" />
          <rect x="5.4" y="9" width="9.2" height="7.5" rx="1.4" />
        </>
      );
    case 'edit':
      return (
        <>
          <path d="M3.7 16.3 4.4 13l8.2-8.2a1.5 1.5 0 0 1 2.1 0l.5.5a1.5 1.5 0 0 1 0 2.1L7 15.6l-3.3.7Z" />
          <path d="m11.8 5.6 2.6 2.6" />
        </>
      );
    case 'check':
      return <path d="m4.3 10.1 3.7 3.7 7.7-7.7" />;
    case 'link':
      return (
        <>
          <path d="m7.5 12.5-1.9 1.9a2.8 2.8 0 1 1-4-4l1.9-1.9a2.8 2.8 0 0 1 4 0" />
          <path d="m12.5 7.5 1.9-1.9a2.8 2.8 0 0 1 4 4l-1.9 1.9a2.8 2.8 0 0 1-4 0" />
          <path d="M7.7 12.3 12.3 7.7" />
        </>
      );
    case 'share':
      return (
        <>
          <circle cx="15.2" cy="4.7" r="1.9" />
          <circle cx="4.8" cy="10" r="1.9" />
          <circle cx="15.2" cy="15.3" r="1.9" />
          <path d="m6.5 9.1 6.9-3.4" />
          <path d="m6.5 10.9 6.9 3.4" />
        </>
      );
    case 'download':
      return (
        <>
          <path d="M10 3.7v8.1" />
          <path d="m6.8 8.9 3.2 3.2 3.2-3.2" />
          <path d="M4.7 15.8h10.6" />
        </>
      );
    case 'loader':
      return (
        <>
          <circle cx="10" cy="10" r="6.2" strokeOpacity="0.28" />
          <path d="M10 3.8a6.2 6.2 0 0 1 6.2 6.2" />
        </>
      );
    case 'sun':
      return (
        <>
          <circle cx="10" cy="10" r="3" />
          <path d="M10 2.5v1.8M10 15.7v1.8M4.7 4.7 6 6M14 14l1.3 1.3M2.5 10h1.8M15.7 10h1.8M4.7 15.3 6 14M14 6l1.3-1.3" />
        </>
      );
    case 'moon':
      return <path d="M13.8 3.8a6.7 6.7 0 1 0 2.4 12.9A7.2 7.2 0 0 1 13.8 3.8Z" />;
  }
}

function AppIcon({ name, className }: AppIconProps): JSX.Element {
  const classes = className ? `app-icon ${className}` : 'app-icon';

  return (
    <svg
      viewBox="0 0 20 20"
      className={classes}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {getAppIconShape(name)}
    </svg>
  );
}

async function getAdminSessionState(): Promise<AdminSessionState> {
  try {
    const response = await fetch('/api/admin/session', {
      cache: 'no-store'
    });

    return response.ok ? 'authorized' : 'unauthorized';
  } catch {
    return 'error';
  }
}

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
  const [hasAdminSession, setHasAdminSession] = useState(false);
  const [draftMarkdown, setDraftMarkdown] = useState('');
  const [editStatus, setEditStatus] = useState<EditStatus>('idle');
  const [editError, setEditError] = useState('');
  const markdownRef = useRef('');
  const lastSavedDraftRef = useRef('');
  const shareUrlInputRef = useRef<HTMLInputElement | null>(null);
  const editorLineRailRef = useRef<HTMLDivElement | null>(null);
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewPaneRef = useRef<HTMLElement | null>(null);
  const isEditorProgrammaticScrollRef = useRef(false);
  const isPreviewProgrammaticScrollRef = useRef(false);
  const editorScrollUnlockFrameRef = useRef<number | null>(null);
  const previewScrollUnlockFrameRef = useRef<number | null>(null);

  const remoteSlug = useMemo(() => getRemoteSlugFromLocation(), []);

  const shareShortcutLabel = useMemo(() => {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Cmd+K' : 'Ctrl+K';
  }, []);

  const pdfDownloadUrl = useMemo(() => getPdfDownloadUrl(remoteSlug), [remoteSlug]);

  const renderedMarkdown = isEditMode ? draftMarkdown : markdown;

  const editorLineNumbers = useMemo(() => {
    const lineCount = Math.max(1, draftMarkdown.split(/\r\n|\r|\n/).length);
    return Array.from({ length: lineCount }, (_value, index) => index + 1);
  }, [draftMarkdown]);

  const syncScrollablePanes = (source: HTMLElement, target: HTMLElement) => {
    const sourceScrollable = source.scrollHeight - source.clientHeight;
    const targetScrollable = target.scrollHeight - target.clientHeight;
    if (targetScrollable <= 0) {
      return;
    }

    const ratio =
      sourceScrollable <= 0 ? 0 : Math.min(1, Math.max(0, source.scrollTop / sourceScrollable));
    const nextScrollTop = ratio * targetScrollable;

    if (Math.abs(target.scrollTop - nextScrollTop) < 1) {
      return;
    }

    target.scrollTop = nextScrollTop;
  };

  const queueScrollUnlock = (
    lockRef: { current: boolean },
    frameRef: { current: number | null }
  ) => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = window.requestAnimationFrame(() => {
      lockRef.current = false;
      frameRef.current = null;
    });
  };

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
    return () => {
      if (editorScrollUnlockFrameRef.current !== null) {
        window.cancelAnimationFrame(editorScrollUnlockFrameRef.current);
      }

      if (previewScrollUnlockFrameRef.current !== null) {
        window.cancelAnimationFrame(previewScrollUnlockFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!remoteSlug) {
      setHasAdminSession(false);
      return;
    }

    let isDisposed = false;

    const refreshSession = async () => {
      const sessionState = await getAdminSessionState();
      if (isDisposed) {
        return;
      }

      setHasAdminSession(sessionState === 'authorized');
    };

    void refreshSession();

    const handleWindowFocus = () => {
      void refreshSession();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshSession();
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isDisposed = true;
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [remoteSlug]);

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
    if (!isEditMode || !editorTextareaRef.current || !previewPaneRef.current) {
      return;
    }

    const editor = editorTextareaRef.current;
    const previewPane = previewPaneRef.current;
    const frame = window.requestAnimationFrame(() => {
      syncScrollablePanes(editor, previewPane);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [draftMarkdown, isEditMode]);

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
            setHasAdminSession(false);
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

    const sessionState = await getAdminSessionState();
    if (sessionState === 'authorized') {
      setHasAdminSession(true);
      setEditStatus('idle');
      return true;
    }

    setHasAdminSession(false);
    if (sessionState === 'unauthorized') {
      setEditStatus('unauthorized');
      setEditError('Edit mode is admin-only. Open /admin and authenticate first.');
      return false;
    }

    if (sessionState === 'error') {
      setEditStatus('error');
      setEditError('Unable to verify admin session.');
    }

    return false;
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
              <AppIcon name={documentVisibility === 'pinned' ? 'pin' : 'lock'} />
            </span>
          </span>
          <div className="file-path" title={filePath || 'Loading markdown path...'}>
            {filePath || 'Loading markdown path...'}
          </div>
        </div>
        <div className="top-bar-actions">
          {remoteSlug && hasAdminSession ? (
            <button
              type="button"
              className={`top-action-button edit-toggle${isEditMode ? ' is-active' : ''}`}
              aria-label={isEditMode ? 'Exit edit mode' : 'Enter edit mode'}
              title={isEditMode ? 'Exit edit mode' : 'Enter edit mode'}
              onClick={() => {
                void handleEditToggle();
              }}
            >
              <AppIcon name={isEditMode ? 'check' : 'edit'} />
            </button>
          ) : null}
          <button
            type="button"
            className="top-action-button share-toggle"
            aria-label={`Share this page (${shareShortcutLabel})`}
            aria-haspopup="dialog"
            aria-expanded={isShareDialogOpen}
            title={`Share (${shareShortcutLabel})`}
            onClick={() => setIsShareDialogOpen(true)}
          >
            <AppIcon name="share" />
          </button>
          <button
            type="button"
            className="top-action-button pdf-download"
            aria-label={isPdfDownloading ? 'Generating PDF' : 'Download PDF'}
            title={isPdfDownloading ? 'Generating PDF' : 'Download PDF'}
            onClick={() => {
              void handlePdfDownload();
            }}
            disabled={isPdfDownloading}
          >
            <AppIcon
              name={isPdfDownloading ? 'loader' : 'download'}
              className={isPdfDownloading ? 'is-spinning' : undefined}
            />
          </button>
          <button
            ref={ref}
            type="button"
            className="top-action-button theme-toggle"
            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={toggleSwitchTheme}
          >
            <span aria-hidden="true" className="theme-icon">
              <AppIcon name={isDarkMode ? 'sun' : 'moon'} />
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
                  ref={editorTextareaRef}
                  className="raw-editor-input"
                  value={draftMarkdown}
                  spellCheck={false}
                  onChange={(event) => {
                    setDraftMarkdown(event.currentTarget.value);
                  }}
                  onScroll={(event) => {
                    const textarea = event.currentTarget;
                    if (editorLineRailRef.current) {
                      editorLineRailRef.current.scrollTop = textarea.scrollTop;
                    }

                    if (!previewPaneRef.current || isEditorProgrammaticScrollRef.current) {
                      return;
                    }

                    isPreviewProgrammaticScrollRef.current = true;
                    syncScrollablePanes(textarea, previewPaneRef.current);
                    queueScrollUnlock(
                      isPreviewProgrammaticScrollRef,
                      previewScrollUnlockFrameRef
                    );
                  }}
                  aria-label="Markdown source editor"
                />
              </div>
            </section>

            <div className="split-divider" aria-hidden="true" />

            <section className="preview-panel" aria-label="Rendered markdown preview">
              <header className="preview-header">
                <h2>Preview</h2>
              </header>

              <article
                className="markdown-body preview-pane"
                ref={previewPaneRef}
                onScroll={(event) => {
                  if (!editorTextareaRef.current || isPreviewProgrammaticScrollRef.current) {
                    return;
                  }

                  isEditorProgrammaticScrollRef.current = true;
                  syncScrollablePanes(event.currentTarget, editorTextareaRef.current);
                  if (editorLineRailRef.current) {
                    editorLineRailRef.current.scrollTop = editorTextareaRef.current.scrollTop;
                  }

                  queueScrollUnlock(isEditorProgrammaticScrollRef, editorScrollUnlockFrameRef);
                }}
              >
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
