import { useState } from 'react';

interface ModalField {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'password' | 'select';
  options?: string[];
  default?: string;
}

interface ModalProps {
  title: string;
  fields: ModalField[];
  confirmText?: string;
  onConfirm: (values: Record<string, string>) => void;
  onCancel: () => void;
}

export default function Modal({ title, fields, confirmText = 'OK', onConfirm, onCancel }: ModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) {
      if (f.default) initial[f.key] = f.default;
      else if (f.type === 'select' && f.options && f.options.length > 0) initial[f.key] = f.options[0];
    }
    return initial;
  });

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {fields.map((field) => (
          <div key={field.key} className="form-group">
            <label>{field.label}</label>
            {field.type === 'select' && field.options ? (
              <select
                value={values[field.key] || field.options[0] || ''}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                style={{ width: '100%' }}
              >
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type === 'password' ? 'password' : 'text'}
                value={values[field.key] || ''}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                placeholder={field.placeholder}
                autoFocus={fields[0].key === field.key}
              />
            )}
          </div>
        ))}
        <div className="modal-buttons">
          <button className="small-button" onClick={onCancel}>Отмена</button>
          <button className="play-button" onClick={() => onConfirm(values)}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}