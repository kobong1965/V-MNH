import React from 'react';
import { Trash2, X } from 'lucide-react';

interface CanvasTextStyleEditorProps {
  heading: string;
  value: string;
  color: string;
  fontSize: number;
  placeholder: string;
  onChange: (updates: { value?: string; color?: string; fontSize?: number }) => void;
  onClose: () => void;
  onClear?: () => void;
}

export const CanvasTextStyleEditor: React.FC<CanvasTextStyleEditorProps> = ({
  heading,
  value,
  color,
  fontSize,
  placeholder,
  onChange,
  onClose,
  onClear
}) => {
  const textRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    textRef.current?.focus();
  }, []);

  return (
    <section
      className="vela-canvas-text-editor"
      role="dialog"
      aria-label={heading}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <header>
        <strong>{heading}</strong>
        <button type="button" aria-label={`关闭${heading}`} onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <label>
        <span>文字</span>
        <textarea
          ref={textRef}
          value={value}
          rows={3}
          maxLength={160}
          placeholder={placeholder}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      </label>
      <div className="vela-canvas-text-editor__style-row">
        <label>
          <span>字号</span>
          <input
            type="number"
            min={12}
            max={72}
            step={1}
            value={fontSize}
            aria-label={`${heading}字号`}
            onChange={(event) => {
              const nextValue = Number(event.target.value);
              if (!Number.isFinite(nextValue)) return;
              onChange({ fontSize: Math.max(12, Math.min(72, Math.round(nextValue))) });
            }}
          />
        </label>
        <label>
          <span>颜色</span>
          <div className="vela-canvas-text-editor__color-field">
            <input
              type="color"
              value={color}
              aria-label={`${heading}颜色选择器`}
              onChange={(event) => onChange({ color: event.target.value })}
            />
            <input
              type="text"
              value={color}
              inputMode="text"
              maxLength={7}
              spellCheck={false}
              aria-label={`${heading}颜色值`}
              onChange={(event) => {
                const nextColor = event.target.value.trim();
                if (/^#[0-9a-f]{6}$/i.test(nextColor)) onChange({ color: nextColor });
              }}
            />
          </div>
        </label>
      </div>
      <footer>
        {onClear && (
          <button type="button" className="is-danger" onClick={onClear}>
            <Trash2 size={14} aria-hidden="true" />清除文字
          </button>
        )}
        <button type="button" className="is-primary" onClick={onClose}>完成</button>
      </footer>
    </section>
  );
};
