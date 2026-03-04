import React, { useEffect, useRef, useState } from 'react';
import './MenuButton.css';

function MenuButton({ onCreateRoom, onSearchRooms, onLocate }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedGender, setSelectedGender] = useState('Male');
  const [freeText, setFreeText] = useState('');
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
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
    setIsCreateModalOpen(true);
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

    setIsGettingLocation(true);
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      position => {
        onCreateRoom?.({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          gender: selectedGender,
          message: freeText.trim(),
          createdAt: Date.now(),
        });
        setIsGettingLocation(false);
        setIsCreateModalOpen(false);
        setFreeText('');
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
            <div className="gender-row">
              <label className="gender-option">
                <input
                  type="radio"
                  name="gender"
                  value="Male"
                  checked={selectedGender === 'Male'}
                  onChange={event => setSelectedGender(event.target.value)}
                />
                <span>Male</span>
              </label>
              <label className="gender-option">
                <input
                  type="radio"
                  name="gender"
                  value="Female"
                  checked={selectedGender === 'Female'}
                  onChange={event => setSelectedGender(event.target.value)}
                />
                <span>Female</span>
              </label>
            </div>
            <div className="textarea-row">
              <textarea
                value={freeText}
                onChange={event => setFreeText(event.target.value)}
                placeholder="You can share something in here..."
              />
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
    </>
  );
}

export default MenuButton;
