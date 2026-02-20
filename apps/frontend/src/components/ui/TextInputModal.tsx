import { useState, useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useBoardStore } from '../../stores/boardStore';
import styles from './TextInputModal.module.css';

/**
 * Generic text-input modal that replaces window.prompt().
 * Matches StickyEditModal styling (dark backdrop, centered card, Confirm/Cancel).
 *
 * Driven by `textInputModal` in uiStore:
 *   - non-null → modal visible
 *   - null     → modal hidden
 *
 * Keyboard:
 *   Enter  → Confirm
 *   Escape → Cancel
 */
export function TextInputModal() {
  const modal = useUIStore((s) => s.textInputModal);
  const concurrentEditors = useBoardStore((s) => s.concurrentEditors);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialise value when modal opens
  useEffect(() => {
    if (modal) {
      setValue(modal.initialValue);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [modal]);

  const handleConfirm = useCallback(() => {
    if (!modal) return;
    const trimmed = value.trim();
    if (!trimmed) return; // don't allow empty
    modal.onConfirm(trimmed);
  }, [modal, value]);

  const handleCancel = useCallback(() => {
    modal?.onCancel();
  }, [modal]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleConfirm, handleCancel],
  );

  if (!modal) return null;

  return (
    <>
      {/* Dark backdrop — clicking cancels */}
      <div className={styles.backdrop} onMouseDown={handleCancel} />

      {/* Centered modal */}
      <div className={styles.modalLayer}>
        <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
          <h3 className={styles.title}>{modal.title}</h3>
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
          <input
            ref={inputRef}
            className={styles.input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={modal.placeholder}
            maxLength={modal.maxLength}
            spellCheck
          />
          <div className={styles.buttonRow}>
            <button className={styles.cancelButton} onClick={handleCancel}>
              Cancel
            </button>
            <button
              className={styles.confirmButton}
              onClick={handleConfirm}
              disabled={!value.trim()}
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
