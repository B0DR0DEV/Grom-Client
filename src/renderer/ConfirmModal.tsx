interface ConfirmModalProps {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ title, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="modal-buttons">
          <button className="small-button" onClick={onCancel}>Отмена</button>
          <button className="play-button" onClick={onConfirm}>ОК</button>
        </div>
      </div>
    </div>
  );
}