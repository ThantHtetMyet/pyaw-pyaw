import React from 'react';

const InfoModal = ({ isOpen, onClose, title = 'Notification', message, buttonText = 'OK' }) => {
  // If message is empty string, we treat it as closed, unless isOpen is explicitly true?
  // The App.js usage is <InfoModal message={modalMessage} ... /> where modalMessage is '' initially.
  // So we should check if message is truthy.
  if (!message) return null;

  return (
    <div className="glass-modal-backdrop" onClick={onClose}>
      <div className="glass-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <h3 className="modal-title">{title}</h3>
        </div>
        <p className="modal-description">{message}</p>
        <div className="modal-action-row" style={{ justifyContent: 'center' }}>
          <button className="modal-action-button create-button" onClick={onClose}>
            {buttonText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InfoModal;
