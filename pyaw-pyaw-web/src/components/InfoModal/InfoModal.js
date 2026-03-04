import React from 'react';

function InfoModal({ message, onClose }) {
  if (!message) {
    return null;
  }

  return (
    <div className="no-room-overlay" onClick={onClose}>
      <div className="no-room-panel" onClick={event => event.stopPropagation()}>
        <div className="no-room-header">
          <button type="button" className="no-room-close-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="no-room-body">
          <div className="no-room-icon">⚠️</div>
          <div className="no-room-text">{message}</div>
        </div>
      </div>
    </div>
  );
}

export default InfoModal;
