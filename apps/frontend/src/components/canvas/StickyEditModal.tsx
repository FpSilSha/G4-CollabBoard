import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useBoardStore } from '../../stores/boardStore';
import { getEditSession } from '../../stores/editSessionRef';
import { getStickyChildren, darkenColor } from '../../utils/fabricHelpers';
import { OBJECT_DEFAULTS, STICKY_SIZE_PRESETS } from 'shared';
import type { StickySizeKey } from 'shared';
import styles from './StickyEditModal.module.css';

/**
 * Centered modal for editing sticky-note text.
 *
 * Driven by `editingObjectId` in boardStore:
 *   - non-null → modal visible
 *   - null     → modal hidden
 *
 * Three visual layers (ascending z-index):
 *   1. Dark backdrop overlay (9996)
 *   2. DOM ghost of the sticky note at its canvas position (9997)
 *   3. Modal dialog with textarea + buttons (9998)
 *
 * Keyboard shortcuts:
 *   Enter       → Confirm (save text, close)
 *   Ctrl+Enter  → Insert newline
 *   Escape      → Cancel  (revert to original, close)
 */
export function StickyEditModal() {
  const editingObjectId = useBoardStore((s) => s.editingObjectId);
  const originalText = useBoardStore((s) => s.editingOriginalText);
  const finishEditingFn = useBoardStore((s) => s.finishEditingFn);
  const concurrentEditors = useBoardStore((s) => s.concurrentEditors);

  const [text, setText] = useState('');
  const [ghostColor, setGhostColor] = useState('#FDFD96');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Compute the sticky note's screen position for the DOM ghost.
  // Position is computed once (sticky can't be moved while editing).
  // Color is tracked separately via ghostColor state so it updates live.
  const ghostInfo = useMemo(() => {
    if (!editingObjectId) return null;
    const session = getEditSession();
    if (!session) return null;

    const { target, canvas } = session;
    const zoom = canvas.getZoom();
    const vpt = canvas.viewportTransform!;
    // Use actual sticky dimensions (may be S/M/L preset)
    const sizeKey = target.data?.size as StickySizeKey | undefined;
    const preset = sizeKey ? STICKY_SIZE_PRESETS[sizeKey] : null;
    const w = target.width ?? preset?.width ?? OBJECT_DEFAULTS.STICKY_WIDTH;
    const h = target.height ?? preset?.height ?? OBJECT_DEFAULTS.STICKY_HEIGHT;
    const foldSize = 24;
    const padding = OBJECT_DEFAULTS.STICKY_PADDING;

    // Screen position of the sticky group
    const screenLeft = (target.left ?? 0) * zoom + vpt[4];
    const screenTop = (target.top ?? 0) * zoom + vpt[5];
    const screenWidth = w * zoom;
    const screenHeight = h * zoom;

    // Initial color
    const { base } = getStickyChildren(target);
    const initialColor = (base.fill as string) ?? '#FDFD96';
    setGhostColor(initialColor);

    // Determine char limit from size preset, or match by width
    const charLimit = preset?.charLimit ?? (() => {
      if (w <= 150) return STICKY_SIZE_PRESETS.small.charLimit;
      if (w <= 200) return STICKY_SIZE_PRESETS.medium.charLimit;
      return STICKY_SIZE_PRESETS.large.charLimit;
    })();

    return {
      left: screenLeft,
      top: screenTop,
      width: screenWidth,
      height: screenHeight,
      foldSize: foldSize * zoom,
      padding: padding * zoom,
      fontSize: OBJECT_DEFAULTS.STICKY_FONT_SIZE * zoom,
      charLimit,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingObjectId]);

  // Poll the Fabric object's color so the ghost updates if another user
  // changes the sticky's color while we're editing.
  useEffect(() => {
    if (!editingObjectId) return;

    const interval = setInterval(() => {
      const session = getEditSession();
      if (!session) return;
      const { base } = getStickyChildren(session.target);
      const currentColor = (base.fill as string) ?? '#FDFD96';
      setGhostColor((prev) => prev !== currentColor ? currentColor : prev);
    }, 500); // check every 500ms — lightweight

    return () => clearInterval(interval);
  }, [editingObjectId]);

  // Initialise local text state when the modal opens
  useEffect(() => {
    if (editingObjectId && originalText !== null) {
      setText(originalText);
      // Focus after React has rendered the textarea
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        // Place cursor at end of text
        const len = originalText.length;
        textareaRef.current?.setSelectionRange(len, len);
      });
    }
  }, [editingObjectId, originalText]);

  // ── Confirm: save current text ──
  const handleConfirm = useCallback(() => {
    finishEditingFn?.(false);
  }, [finishEditingFn]);

  // ── Cancel: revert to original text ──
  const handleCancel = useCallback(() => {
    const session = getEditSession();
    if (session && originalText !== null) {
      // Revert the Fabric object so the final-state emit sends original text
      session.target.data!.text = originalText;
      session.textChild.set('text', originalText);
      session.canvas.requestRenderAll();
    }
    finishEditingFn?.(true);
  }, [finishEditingFn, originalText]);

  // ── Live text updates (local canvas + WS broadcast) ──
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      setText(newText);

      const session = getEditSession();
      if (session) {
        session.target.data!.text = newText;
        session.textChild.set('text', newText);
        session.textChild.set('opacity', 0.3); // dim ghost preview
        session.canvas.requestRenderAll();
        session.throttledEmit(newText);
      }
    },
    [],
  );

  // ── Keyboard shortcuts ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
        return;
      }

      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        // Plain Enter = Confirm
        e.preventDefault();
        handleConfirm();
        return;
      }

      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        // Ctrl+Enter = insert newline
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const before = text.substring(0, start);
        const after = text.substring(end);
        const newText = before + '\n' + after;
        setText(newText);

        // Update Fabric canvas + broadcast
        const session = getEditSession();
        if (session) {
          session.target.data!.text = newText;
          session.textChild.set('text', newText);
          session.textChild.set('opacity', 0.3);
          session.canvas.requestRenderAll();
          session.throttledEmit(newText);
        }

        // Restore cursor position after the inserted newline
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1;
        });
      }
    },
    [handleConfirm, handleCancel, text],
  );

  // Don't render when not editing a sticky note.
  // editingObjectId is shared with other edit flows (e.g. flag labels),
  // so also require an active edit session (only set for stickies).
  if (!editingObjectId || !getEditSession()) return null;

  return (
    <>
      {/* Layer 1: dark backdrop — clicking it cancels */}
      <div className={styles.backdrop} onMouseDown={handleCancel} />

      {/* Layer 2: DOM ghost of the sticky note at its canvas position */}
      {ghostInfo && (
        <div
          className={styles.stickyGhost}
          style={{
            left: ghostInfo.left,
            top: ghostInfo.top,
            width: ghostInfo.width,
            height: ghostInfo.height,
            background: ghostColor,
            borderRadius: 2,
            border: '1px solid #000',
          }}
        >
          {/* Text inside the ghost — updates live */}
          <div
            className={styles.stickyGhostText}
            style={{
              left: ghostInfo.padding,
              top: ghostInfo.padding,
              width: ghostInfo.width - ghostInfo.padding * 2,
              height: ghostInfo.height - ghostInfo.padding * 2,
              fontSize: ghostInfo.fontSize,
            }}
          >
            {text}
          </div>
          {/* Fold triangle in bottom-right corner (CSS triangle via border) */}
          <div
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: 0,
              height: 0,
              borderStyle: 'solid',
              borderWidth: `0 0 ${ghostInfo.foldSize}px ${ghostInfo.foldSize}px`,
              borderColor: `transparent transparent ${darkenColor(ghostColor, 15)} transparent`,
            }}
          />
        </div>
      )}

      {/* Layer 3: modal dialog — above the ghost */}
      <div className={styles.modalLayer}>
        <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
          <h3 className={styles.title}>Editing Text</h3>
          {concurrentEditors.length > 0 && (
            <div className={styles.warningBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>
                Also editing: {concurrentEditors.map((e) => e.userName).join(', ')}
              </span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            rows={6}
            maxLength={ghostInfo?.charLimit}
            spellCheck
          />
          {ghostInfo && (
            <div className={styles.charCount}>
              {text.length}/{ghostInfo.charLimit}
            </div>
          )}
          <div className={styles.buttonRow}>
            <button className={styles.cancelButton} onClick={handleCancel}>
              Cancel
            </button>
            <button className={styles.confirmButton} onClick={handleConfirm}>
              Confirm
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
