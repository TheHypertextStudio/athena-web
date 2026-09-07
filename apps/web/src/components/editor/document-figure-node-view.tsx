'use client';

import type { NodeViewProps } from '@tiptap/core';
import { NodeViewWrapper } from '@tiptap/react';
import { FileImage, Info, MoreHorizontal, Trash2 } from '@docket/ui/icons';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
  Textarea,
} from '@docket/ui/primitives';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

import {
  readDocumentFigureAttributes,
  type DocumentFigureAttributes,
} from './document-figure-extension';

/** Actions the editor host performs for a figure node view. */
export interface DocumentFigureActions {
  /** Upload replacement bytes for the node at the supplied live position. */
  readonly replace: (position: number, file: File) => void;
  /** Retry the upload represented by one pending id. */
  readonly retry: (uploadId: string) => void;
  /** Forget retained upload state when a node is removed. */
  readonly forget: (uploadId: string) => void;
}

/** Node views render through a portal but retain this editor-owned action context. */
export const DocumentFigureActionsContext = createContext<DocumentFigureActions | null>(null);

/** Return a trimmed HTTPS URL or an application-owned validation sentence. */
function attributionUrlIssue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' || /^https:\/\//i.test(trimmed) ? undefined : 'Use an HTTPS address.';
}

interface FigureToolbarProps {
  readonly visible: boolean;
  readonly replaceInputRef: RefObject<HTMLInputElement | null>;
  readonly onOpenDetails: () => void;
  readonly onRemove: () => void;
  readonly onReplace: (file: File | undefined) => void;
  readonly onEscape: () => void;
}

/** Render the selected figure's non-wrapping actions and replacement picker. */
function FigureToolbar({
  visible,
  replaceInputRef,
  onOpenDetails,
  onRemove,
  onReplace,
  onEscape,
}: FigureToolbarProps): JSX.Element | null {
  if (!visible) return null;
  return (
    <div
      role="toolbar"
      aria-label="Image controls"
      aria-keyshortcuts="Alt+F10"
      data-figure-toolbar=""
      contentEditable={false}
      className="border-outline-variant bg-surface-container-high absolute top-2 right-2 z-10 flex max-w-[calc(100%-1rem)] flex-nowrap items-center gap-0.5 rounded-xl border p-1 whitespace-nowrap"
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={() => {
          replaceInputRef.current?.click();
        }}
      >
        <FileImage aria-hidden="true" className="size-4" />
        Replace
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 max-[390px]:hidden"
        onClick={onOpenDetails}
      >
        <Info aria-hidden="true" className="size-4" />
        Details
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" iconOnly aria-label="Image options">
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="min-[391px]:hidden" onSelect={onOpenDetails}>
            Details
          </DropdownMenuItem>
          <DropdownMenuSeparator className="min-[391px]:hidden" />
          <DropdownMenuItem destructive onSelect={onRemove}>
            <Trash2 aria-hidden="true" className="size-4" />
            Remove image
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        aria-label="Replace image file"
        className="sr-only"
        onChange={(event) => {
          onReplace(event.target.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
    </div>
  );
}

interface FigureMediaProps {
  readonly attrs: DocumentFigureAttributes;
  readonly onRetry: () => void;
  readonly onRemove: () => void;
}

/** Render image bytes, pending progress, or recoverable upload failure. */
function FigureMedia({ attrs, onRetry, onRemove }: FigureMediaProps): JSX.Element {
  const imageSource = attrs.previewSrc || attrs.src;
  return (
    <div
      className="bg-surface-container relative overflow-hidden rounded-xl"
      contentEditable={false}
    >
      {imageSource ? (
        <img
          src={imageSource}
          alt={attrs.decorative ? '' : attrs.alt}
          itemProp="contentUrl"
          className="mx-auto block h-auto max-h-[70vh] max-w-full object-contain"
        />
      ) : (
        <div className="text-on-surface-variant flex min-h-36 items-center justify-center">
          <FileImage aria-hidden="true" className="size-8" />
        </div>
      )}
      {attrs.status === 'uploading' ? (
        <div
          role="status"
          className="bg-scrim/60 text-inverse-on-surface text-body-small absolute inset-0 flex items-center justify-center"
        >
          Uploading image…
        </div>
      ) : null}
      {attrs.status === 'failed' ? (
        <div
          role="alert"
          className="bg-error-container/95 text-on-error-container absolute inset-x-2 bottom-2 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2"
        >
          <span>Could not upload this image.</span>
          <span className="flex flex-nowrap gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
              Retry
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              Remove
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Render optional credit, source, and license phrasing below a figure. */
function FigureAttribution({
  attrs,
}: {
  readonly attrs: DocumentFigureAttributes;
}): JSX.Element | null {
  const visible = attrs.creditText || attrs.sourceUrl || attrs.licenseText || attrs.licenseUrl;
  if (!visible) return null;
  let license: JSX.Element | null = null;
  if (attrs.licenseUrl) {
    license = (
      <a href={attrs.licenseUrl} target="_blank" rel="license noreferrer" itemProp="license">
        {attrs.licenseText ? attrs.licenseText : 'License'}
      </a>
    );
  } else if (attrs.licenseText) {
    license = <span itemProp="license">{attrs.licenseText}</span>;
  }
  return (
    <span
      data-docket-attribution=""
      contentEditable={false}
      className="flex flex-wrap gap-x-3 gap-y-1"
    >
      {attrs.creditText ? <span itemProp="creditText">{attrs.creditText}</span> : null}
      {attrs.sourceUrl ? (
        <a href={attrs.sourceUrl} target="_blank" rel="noreferrer">
          Source
        </a>
      ) : null}
      {license}
    </span>
  );
}

interface FigureCaptionProps {
  readonly attrs: DocumentFigureAttributes;
  readonly editable: boolean;
  readonly onChange: (caption: string) => void;
}

/** Render the editable caption for authors and plain figure phrasing for readers. */
function FigureCaption({ attrs, editable, onChange }: FigureCaptionProps): JSX.Element | null {
  const hasAttribution = Boolean(
    attrs.creditText || attrs.sourceUrl || attrs.licenseText || attrs.licenseUrl,
  );
  if (!editable && !attrs.caption && !hasAttribution) return null;
  return (
    <figcaption className="text-on-surface-variant text-body-small flex flex-col gap-1 px-1 pt-2">
      {editable ? (
        <Textarea
          variant="plain"
          rows={1}
          aria-label="Image caption"
          placeholder="Add a caption"
          value={attrs.caption}
          itemProp="caption"
          className="text-body-small min-h-8 resize-y rounded-none border-transparent bg-transparent px-0 py-1"
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      ) : attrs.caption ? (
        <span itemProp="caption">{attrs.caption}</span>
      ) : null}
      <FigureAttribution attrs={attrs} />
    </figcaption>
  );
}

type FigureMetadataPatch = Pick<
  DocumentFigureAttributes,
  'alt' | 'decorative' | 'creditText' | 'sourceUrl' | 'licenseText' | 'licenseUrl'
>;

interface FigureDetailsProps {
  readonly open: boolean;
  readonly attrs: DocumentFigureAttributes;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (patch: FigureMetadataPatch) => void;
}

/** Edit accessibility and attribution fields that do not belong on the image itself. */
function FigureDetails({ open, attrs, onOpenChange, onSave }: FigureDetailsProps): JSX.Element {
  const [alt, setAlt] = useState(attrs.alt);
  const [decorative, setDecorative] = useState(attrs.decorative);
  const [creditText, setCreditText] = useState(attrs.creditText);
  const [sourceUrl, setSourceUrl] = useState(attrs.sourceUrl);
  const [licenseText, setLicenseText] = useState(attrs.licenseText);
  const [licenseUrl, setLicenseUrl] = useState(attrs.licenseUrl);
  const sourceIssue = attributionUrlIssue(sourceUrl);
  const licenseIssue = attributionUrlIssue(licenseUrl);
  const altIssue =
    !decorative && alt.trim() === '' ? 'Describe the image or mark it decorative.' : undefined;
  const canSave = sourceIssue === undefined && licenseIssue === undefined && altIssue === undefined;

  useEffect(() => {
    if (!open) return;
    setAlt(attrs.alt);
    setDecorative(attrs.decorative);
    setCreditText(attrs.creditText);
    setSourceUrl(attrs.sourceUrl);
    setLicenseText(attrs.licenseText);
    setLicenseUrl(attrs.licenseUrl);
  }, [
    attrs.alt,
    attrs.creditText,
    attrs.decorative,
    attrs.licenseText,
    attrs.licenseUrl,
    attrs.sourceUrl,
    open,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Image details</DialogTitle>
          <DialogDescription>
            Describe the image for readers and keep its source and license with this use.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            onSave({
              alt: decorative ? '' : alt.trim(),
              decorative,
              creditText: creditText.trim(),
              sourceUrl: sourceUrl.trim(),
              licenseText: licenseText.trim(),
              licenseUrl: licenseUrl.trim(),
            });
            onOpenChange(false);
          }}
        >
          <Field label="Alt text" {...(altIssue ? { error: altIssue } : {})}>
            <Input
              value={alt}
              disabled={decorative}
              onChange={(event) => {
                setAlt(event.target.value);
              }}
            />
          </Field>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={decorative}
              onChange={(event) => {
                setDecorative(event.target.checked);
              }}
            />
            <span className="text-body-medium">This image is decorative</span>
          </label>
          <Field label="Credit">
            <Input
              value={creditText}
              onChange={(event) => {
                setCreditText(event.target.value);
              }}
            />
          </Field>
          <Field label="Source URL" {...(sourceIssue ? { error: sourceIssue } : {})}>
            <Input
              inputMode="url"
              value={sourceUrl}
              onChange={(event) => {
                setSourceUrl(event.target.value);
              }}
            />
          </Field>
          <Field label="License">
            <Input
              value={licenseText}
              onChange={(event) => {
                setLicenseText(event.target.value);
              }}
            />
          </Field>
          <Field label="License URL" {...(licenseIssue ? { error: licenseIssue } : {})}>
            <Input
              inputMode="url"
              value={licenseUrl}
              onChange={(event) => {
                setLicenseUrl(event.target.value);
              }}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              Save details
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Return whether a click belongs to a control nested inside the figure. */
function isFigureControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest('button,input,a') !== null;
}

/** The semantic figure node, including its caption, contextual toolbar, and metadata dialog. */
export function DocumentFigureNodeView({
  node,
  editor,
  selected,
  getPos,
  updateAttributes,
  deleteNode,
}: NodeViewProps): JSX.Element {
  const actions = useContext(DocumentFigureActionsContext);
  const attrs = readDocumentFigureAttributes(node.attrs);
  const figureRef = useRef<HTMLElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const position = (): number | null => {
    const value = getPos();
    return typeof value === 'number' ? value : null;
  };
  const focusFigure = (): void => {
    const at = position();
    if (at !== null) editor.commands.setNodeSelection(at);
    figureRef.current?.focus();
  };
  const remove = (): void => {
    actions?.forget(attrs.uploadId);
    deleteNode();
  };
  const replace = (file: File | undefined): void => {
    const at = position();
    if (file === undefined || at === null) return;
    actions?.replace(at, file);
  };

  return (
    <NodeViewWrapper
      as="figure"
      ref={figureRef}
      tabIndex={selected && editor.isEditable ? 0 : -1}
      data-docket-figure="1"
      data-selected={selected ? 'true' : 'false'}
      data-upload-status={attrs.status}
      itemScope
      itemType="https://schema.org/ImageObject"
      className="border-outline-variant focus-visible:ring-primary relative my-4 max-w-full rounded-xl border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-offset-2 data-[selected=true]:border-current"
      onClick={(event: ReactMouseEvent<HTMLElement>) => {
        if (editor.isEditable && !isFigureControl(event.target)) focusFigure();
      }}
    >
      <FigureToolbar
        visible={selected && editor.isEditable}
        replaceInputRef={replaceInputRef}
        onOpenDetails={() => {
          setDetailsOpen(true);
        }}
        onRemove={remove}
        onReplace={replace}
        onEscape={focusFigure}
      />
      <FigureMedia
        attrs={attrs}
        onRetry={() => {
          actions?.retry(attrs.uploadId);
        }}
        onRemove={remove}
      />
      <FigureCaption
        attrs={attrs}
        editable={editor.isEditable}
        onChange={(caption) => {
          updateAttributes({ caption });
        }}
      />
      <FigureDetails
        open={detailsOpen}
        attrs={attrs}
        onOpenChange={setDetailsOpen}
        onSave={updateAttributes}
      />
    </NodeViewWrapper>
  );
}
