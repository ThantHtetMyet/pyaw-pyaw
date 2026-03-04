import React, { useEffect, useRef, useState } from 'react';
import './MenuButton.css';

function MenuButton({ onCreateRoom, onSearchRooms, onLocate }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedGender, setSelectedGender] = useState('Male');
  const [messageType, setMessageType] = useState('Hi');
  const [username, setUsername] = useState('');
  const [freeText, setFreeText] = useState('');
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [resumeRoom, setResumeRoom] = useState(null);
  const containerRef = useRef(null);
  
  useEffect(() => {
    const handleDocumentClick = event => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('touchstart', handleDocumentClick);

    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('touchstart', handleDocumentClick);
    };
  }, []);

  const handleClick = () => {
    setIsOpen(prevIsOpen => {
      console.log('Menu button clicked. isOpen:', !prevIsOpen);
      return !prevIsOpen;
    });
  };

  const handleCreateClick = () => {
    setIsOpen(false);
    setLocationError('');

    const activeRoomJson = window.localStorage.getItem('pyaw-pyaw-active-room');
    if (activeRoomJson) {
      try {
        const activeRoom = JSON.parse(activeRoomJson);
        if (activeRoom && activeRoom.sessionExpiresAt > Date.now()) {
          setResumeRoom(activeRoom);
          return;
        } else {
          window.localStorage.removeItem('pyaw-pyaw-active-room');
        }
      } catch (e) {
        window.localStorage.removeItem('pyaw-pyaw-active-room');
      }
    }

    setIsCreateModalOpen(true);
    setUsername('');
    setMessageType('Hi');
    setFreeText('');
  };

  const handleResumeRoom = () => {
    if (!resumeRoom) return;
    
    const roomUrl = `${window.location.origin}${window.location.pathname}?roomTopic=${encodeURIComponent(
      resumeRoom.topic
    )}&role=${resumeRoom.role}&sessionExpiresAt=${resumeRoom.sessionExpiresAt}&username=${encodeURIComponent(resumeRoom.username || '')}`;
    
    window.open(roomUrl, '_blank', 'noopener,noreferrer');
    setResumeRoom(null);
  };

  const handleCloseModal = () => {
    setLocationError('');
    setIsCreateModalOpen(false);
  };

  const handleSearchClick = async () => {
    setIsOpen(false);
    setLocationError('');
    try {
      await onSearchRooms?.();
    } catch (error) {
      setLocationError(error?.message || 'Unable to scan active rooms.');
    }
  };

  const handleLocateClick = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by this browser.');
      return;
    }

    setLocationError('');
    setIsOpen(false);
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        onLocate?.({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          locatedAt: Date.now(),
        });
        setIsLocating(false);
      },
      error => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocationError('Location permission was denied.');
        } else if (error.code === error.TIMEOUT) {
          setLocationError('Location request timed out. Please try again.');
        } else {
          setLocationError('Unable to get your location right now.');
        }
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const handleCreateRoom = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by this browser.');
      return;
    }

    if (!username.trim()) {
      setLocationError('Please enter a username.');
      return;
    }

    setIsGettingLocation(true);
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      position => {
        onCreateRoom?.({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          gender: selectedGender,
          username: username.trim(),
          messageType: messageType,
          message: freeText.trim(),
          createdAt: Date.now(),
        });
        setIsGettingLocation(false);
        setIsCreateModalOpen(false);
        setFreeText('');
        setUsername('');
        setMessageType('Hi');
      },
      error => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocationError('Location permission was denied.');
        } else if (error.code === error.TIMEOUT) {
          setLocationError('Location request timed out. Please try again.');
        } else {
          setLocationError('Unable to get your location right now.');
        }
        setIsGettingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  return (
    <>
      <div ref={containerRef} className={`menu-button-container ${isOpen ? 'open' : ''}`}>
        <div className={`menu-button ${isOpen ? 'open' : ''}`}>
          <div className="menu-button-inner" onClick={handleClick}>
            Menu
          </div>
        </div>
        <div className="sub-menu-item create-item" onClick={handleCreateClick}>
          <span className="sub-menu-label" aria-label="Create">
            <svg className="sub-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
        </div>
        <div className="sub-menu-item search-item" onClick={handleSearchClick}>
          <span className="sub-menu-label" aria-label="Search">
            <svg className="sub-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="5.5" />
              <path d="M15 15l4 4" />
            </svg>
          </span>
        </div>
        <div className="sub-menu-item locate-item" onClick={handleLocateClick}>
          <span className="sub-menu-label" aria-label="Locate">
            <svg className="sub-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="5.5" />
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
            </svg>
          </span>
        </div>
        {isLocating && <div className="locate-status">Locating...</div>}
        {!isCreateModalOpen && locationError && <div className="locate-status error">{locationError}</div>}
      </div>
      {isCreateModalOpen && (
        <div className="glass-modal-backdrop" onClick={handleCloseModal}>
          <div className="glass-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header-row">
              <h3 className="modal-title">Create Room</h3>
            </div>
            <div className="manual-join-section">
              <input
                className="manual-join-input"
                value={username}
                onChange={event => setUsername(event.target.value)}
                placeholder="Enter your username..."
              />
            </div>
            <div className="gender-row">
              <button
                type="button"
                className={`gender-badge male ${selectedGender === 'Male' ? 'selected' : ''}`}
                onClick={() => setSelectedGender('Male')}
              >
                Male 👨
              </button>
              <button
                type="button"
                className={`gender-badge female ${selectedGender === 'Female' ? 'selected' : ''}`}
                onClick={() => setSelectedGender('Female')}
              >
                Female 👩
              </button>
            </div>
            <div className="textarea-row">
              <textarea
                value={freeText}
                onChange={event => setFreeText(event.target.value)}
                placeholder="You can share something in here..."
              />
            </div>
            <div className="message-type-row">
              <button
                type="button"
                className={`message-type-badge ${messageType === 'Hi' ? 'selected' : ''}`}
                onClick={() => setMessageType('Hi')}
              >
                Hi 👋
              </button>
              <button
                type="button"
                className={`message-type-badge ${messageType === 'Help' ? 'selected' : ''}`}
                onClick={() => setMessageType('Help')}
              >
                Help 🆘
              </button>
            </div>
            {locationError && <div className="location-error">{locationError}</div>}
            <div className="modal-action-row">
              <button
                type="button"
                className="modal-action-button cancel-button"
                onClick={handleCloseModal}
                disabled={isGettingLocation}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-action-button create-button"
                onClick={handleCreateRoom}
                disabled={isGettingLocation}
              >
                {isGettingLocation ? 'Getting Location...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
      {resumeRoom && (
        <div className="glass-modal-backdrop" onClick={() => setResumeRoom(null)}>
          <div className="glass-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header-row">
              <h3 className="modal-title">Active Room Found</h3>
            </div>
            <div className="manual-join-section">
              <p className="modal-description">You already have an active room. Would you like to resume it?</p>
            </div>
            <div className="modal-action-row">
              <button
                type="button"
                className="modal-action-button cancel-button"
                onClick={() => {
                  setResumeRoom(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-action-button create-button"
                onClick={handleResumeRoom}
              >
                Resume Room
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default MenuButton;
