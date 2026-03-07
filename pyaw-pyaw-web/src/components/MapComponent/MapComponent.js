import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function MapRecenter({ createdRoom, locatedPosition }) {
  const map = useMap();
  const lastCenterKeyRef = useRef('');
  const hasAutoLocatedRef = useRef(false);
  const target = useMemo(() => {
    const isManualLocate = locatedPosition?.trigger === 'menu-locate';
    if (isManualLocate && Number.isFinite(locatedPosition?.lat) && Number.isFinite(locatedPosition?.lng)) {
      return {
        key: `locate-manual-${locatedPosition.locatedAt || `${locatedPosition.lat},${locatedPosition.lng}`}`,
        position: [locatedPosition.lat, locatedPosition.lng],
        source: 'locate',
      };
    }
    if (createdRoom && Number.isFinite(createdRoom.lat) && Number.isFinite(createdRoom.lng)) {
      const roomKey = createdRoom.topic || createdRoom.createdAt || `${createdRoom.lat},${createdRoom.lng}`;
      return {
        key: `created-${roomKey}`,
        position: [createdRoom.lat, createdRoom.lng],
      };
    }
    if (!locatedPosition || hasAutoLocatedRef.current) {
      return null;
    }
    return {
      key: `locate-initial-${locatedPosition.locatedAt || `${locatedPosition.lat},${locatedPosition.lng}`}`,
      position: [locatedPosition.lat, locatedPosition.lng],
      source: 'locate',
    };
  }, [createdRoom, locatedPosition]);

  useEffect(() => {
    if (!target) {
      return;
    }
    if (lastCenterKeyRef.current === target.key) {
      return;
    }
    lastCenterKeyRef.current = target.key;
    map.flyTo(target.position, 16, { duration: 1.1 });
    if (target.source === 'locate') {
      hasAutoLocatedRef.current = true;
    }
  }, [target, map]);

  return null;
}

function MapResizeSync() {
  const map = useMap();

  useEffect(() => {
    const resizeMap = () => {
      map.invalidateSize();
    };
    const resizeBurst = () => {
      resizeMap();
      window.requestAnimationFrame(() => {
        resizeMap();
      });
      window.setTimeout(resizeMap, 180);
    };
    const timeoutId = window.setTimeout(resizeBurst, 80);
    window.addEventListener('resize', resizeBurst);
    window.addEventListener('orientationchange', resizeBurst);
    window.addEventListener('pyaw-pyaw-layout-change', resizeBurst);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', resizeBurst);
      window.removeEventListener('orientationchange', resizeBurst);
      window.removeEventListener('pyaw-pyaw-layout-change', resizeBurst);
    };
  }, [map]);

  return null;
}

function MapOutsideClickClose({ enabled, onOutsideClose }) {
  useMapEvents({
    click() {
      if (enabled) {
        onOutsideClose();
      }
    },
  });

  return null;
}

function createMessageMarkerIcon(gender, messageType, availability = 'idle') {
  const isFemale = gender === 'Female';
  const genderClass = isFemale ? 'female' : 'male';
  const availabilityClass = availability === 'busy' ? 'status-busy' : 'status-idle';

  if (messageType === 'Help') {
    return L.divIcon({
      html: `<div class="user-hand-marker ${genderClass} ${availabilityClass} help-marker">
              <div class="marker-hand-halo">
                <svg class="marker-hand-svg help-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <text x="12" y="14.6" text-anchor="middle" class="marker-help-text">?</text>
                </svg>
              </div>
             </div>`,
      className: 'user-hand-marker-wrapper',
      iconSize: [64, 64],
      iconAnchor: [32, 58],
      popupAnchor: [0, -45],
    });
  }

  const chatPath = "M4,5.5C4,4.12,5.12,3,6.5,3h11C18.88,3,20,4.12,20,5.5v7c0,1.38-1.12,2.5-2.5,2.5H11l-4.2,3.7c-0.74,0.65-1.9,0.12-1.9-0.86V15.2C4.37,14.76,4,14.17,4,13.5V5.5z";

  return L.divIcon({
    html: `<div class="user-hand-marker ${genderClass} ${availabilityClass}">
            <div class="marker-hand-halo">
              <svg class="marker-hand-svg chat-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path class="marker-border-base" d="${chatPath}" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linejoin="round" />
                <circle cx="9" cy="9.4" r="1.15" fill="#ffffff" />
                <circle cx="12" cy="9.4" r="1.15" fill="#ffffff" />
                <circle cx="15" cy="9.4" r="1.15" fill="#ffffff" />
              </svg>
            </div>
           </div>`,
    className: 'user-hand-marker-wrapper',
    iconSize: [64, 64],
    iconAnchor: [32, 58],
    popupAnchor: [0, -45],
  });
}

function hashTopic(topic) {
  let hash = 0;
  for (let index = 0; index < topic.length; index += 1) {
    hash = (hash * 31 + topic.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getDistanceMeters(left, right) {
  const lat1 = (left.lat * Math.PI) / 180;
  const lat2 = (right.lat * Math.PI) / 180;
  const latDiff = lat2 - lat1;
  const lngDiff = ((right.lng - left.lng) * Math.PI) / 180;
  const sinLat = Math.sin(latDiff / 2);
  const sinLng = Math.sin(lngDiff / 2);
  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c;
}

function MapComponent({
  createdRoom,
  hostRoomTopic,
  locatedPosition,
  searchedRooms = [],
  isSearchingRooms,
  showNoRoomFound = false,
  onDismissNoRoom,
  onCancelScan,
  onJoinRoom,
  onOpenRoom,
  mapTheme = 'light',
  onToggleMapTheme,
  showThemeToggle = true,
}) {
  const defaultPosition = [51.505, -0.09];
  const isDarkTheme = mapTheme === 'dark';
  const tileUrl = isDarkTheme
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttribution = isDarkTheme
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const markerIcon = useMemo(() => {
    if (!createdRoom) {
      return null;
    }
    return createMessageMarkerIcon(createdRoom.gender, createdRoom.messageType, createdRoom.availability);
  }, [createdRoom]);
  const validSearchedRooms = useMemo(
    () =>
      searchedRooms.filter(room => {
        if (!Number.isFinite(room?.lat) || !Number.isFinite(room?.lng)) {
          return false;
        }
        if (createdRoom?.topic && room?.topic === createdRoom.topic) {
          return false;
        }
        if (hostRoomTopic && room?.topic === hostRoomTopic) {
          return false;
        }
        return true;
      }),
    [searchedRooms, createdRoom?.topic, hostRoomTopic]
  );
  const searchedRoomMarkers = useMemo(() => {
    const overlapRadiusMeters = 7.5;
    const orderedRooms = [...validSearchedRooms].sort((left, right) => {
      const latDiff = left.lat - right.lat;
      if (latDiff !== 0) {
        return latDiff;
      }
      const lngDiff = left.lng - right.lng;
      if (lngDiff !== 0) {
        return lngDiff;
      }
      return String(left.topic || '').localeCompare(String(right.topic || ''));
    });
    const groupedByArea = [];
    orderedRooms.forEach(room => {
      const targetGroup = groupedByArea.find(group =>
        group.rooms.some(member => getDistanceMeters(member, room) <= overlapRadiusMeters)
      );
      if (targetGroup) {
        targetGroup.rooms.push(room);
        return;
      }
      groupedByArea.push({ rooms: [room] });
    });

    return groupedByArea.flatMap(group => {
      const orderedGroup = [...group.rooms].sort((left, right) =>
        String(left.topic || '').localeCompare(String(right.topic || ''))
      );

      if (orderedGroup.length === 1) {
        const room = orderedGroup[0];
        return [{
          ...room,
          displayLat: room.lat,
          displayLng: room.lng,
          icon: createMessageMarkerIcon(room.gender, room.messageType, room.availability),
        }];
      }

      return orderedGroup.map((room, index) => {
        const seed = hashTopic(room.topic || `${room.lat}-${room.lng}-${index}`);
        const angleInRadians = ((index * 77 + (seed % 41)) * Math.PI) / 180;
        const distanceInMeters = 1 + ((seed % 3) * 0.5);
        const latOffset = (distanceInMeters / 111320) * Math.sin(angleInRadians);
        const safeCos = Math.max(Math.cos((room.lat * Math.PI) / 180), 0.2);
        const lngOffset = (distanceInMeters / (111320 * safeCos)) * Math.cos(angleInRadians);

        return {
          ...room,
          displayLat: room.lat + latOffset,
          displayLng: room.lng + lngOffset,
          overlapRooms: orderedGroup,
          icon: createMessageMarkerIcon(room.gender, room.messageType, room.availability),
        };
      });
    });
  }, [validSearchedRooms]);
  const radarDots = useMemo(
    () =>
      validSearchedRooms.slice(0, 12).map(room => {
        const seed = hashTopic(room.topic || `${room.lat}-${room.lng}`);
        const angle = (seed % 360) * (Math.PI / 180);
        const radius = 22 + (seed % 56);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        return {
          key: room.topic,
          style: {
            left: `calc(50% + ${x}px)`,
            top: `calc(50% + ${y}px)`,
            animationDelay: `${(seed % 8) * 0.18}s`,
          },
        };
      }),
    [validSearchedRooms]
  );
  const locateIcon = useMemo(
    () =>
      L.divIcon({
        html: '<div class="current-location-marker"><div class="current-location-pulse"></div><div class="current-location-wave"></div><div class="current-location-pin"><svg class="current-location-pin-icon" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="currentLocationPinGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff5aa5"></stop><stop offset="55%" stop-color="#ff2f76"></stop><stop offset="100%" stop-color="#e10f5f"></stop></linearGradient></defs><path d="M32 3c-10.5 0-19 8.4-19 18.7 0 14.5 16.7 33.6 18.5 35.7.3.4.8.6 1.3.6s1-.2 1.3-.6C34.3 55.3 51 36.2 51 21.7 51 11.4 42.5 3 32 3z" fill="url(#currentLocationPinGradient)"></path><circle cx="32" cy="22" r="9" fill="none" stroke="#ffffff" stroke-width="4.2"></circle></svg></div></div>',
        className: 'current-location-wrapper',
        iconSize: [46, 46],
        iconAnchor: [23, 40],
      }),
    []
  );
  const [joiningTopic, setJoiningTopic] = useState('');
  const [pinnedOverlapKey, setPinnedOverlapKey] = useState('');
  const overlapMarkerRefs = useRef(new Map());

  const isHostRoom = room => Boolean(room?.topic) && Boolean(hostRoomTopic) && room.topic === hostRoomTopic;
  const getRoomAvailability = room => (room?.availability === 'busy' ? 'busy' : 'idle');
  const isBusyRoom = room => getRoomAvailability(room) === 'busy';
  const closePinnedOverlapPopup = useCallback(() => {
    setPinnedOverlapKey(currentPinnedKey => {
      if (currentPinnedKey) {
        const marker = overlapMarkerRefs.current.get(currentPinnedKey);
        marker?.closePopup?.();
      }
      return '';
    });
  }, []);

  const handleJoinFromMap = async room => {
    if (!room?.topic || joiningTopic || isBusyRoom(room)) {
      return;
    }
    setJoiningTopic(room.topic);
    try {
      await onJoinRoom?.(room);
    } finally {
      setJoiningTopic('');
    }
  };

  const handleRoomActionFromMap = room => {
    if (isHostRoom(room)) {
      onOpenRoom?.(room);
      return;
    }
    handleJoinFromMap(room);
  };

  return (
    <div className="map-stage">
      <MapContainer center={defaultPosition} zoom={13} style={{ height: '100vh', width: '100%' }}>
        <TileLayer
          attribution={tileAttribution}
          url={tileUrl}
        />
        <MapResizeSync />
        <MapRecenter createdRoom={createdRoom} locatedPosition={locatedPosition} />
        <MapOutsideClickClose enabled={Boolean(pinnedOverlapKey)} onOutsideClose={closePinnedOverlapPopup} />
        {locatedPosition && (
          <Marker position={[locatedPosition.lat, locatedPosition.lng]} icon={locateIcon}>
            <Popup>Your current location</Popup>
          </Marker>
        )}
        {createdRoom && markerIcon && (
          <Marker position={[createdRoom.lat, createdRoom.lng]} icon={markerIcon}>
            <Popup
              className={`room-popup ${createdRoom.gender === 'Female' ? 'female' : 'male'}${createdRoom.messageType === 'Help' ? ' help' : ''}`}
            >
              <div className="map-room-popup">
                <div className="map-room-popup-header">
                  <div className="map-room-popup-username">{createdRoom.username || 'You'}</div>
                  <span className={`map-room-popup-status ${getRoomAvailability(createdRoom)}`}>
                    {getRoomAvailability(createdRoom)}
                  </span>
                </div>
                {createdRoom.message ? <div className="map-room-popup-message">{createdRoom.message}</div> : null}
                <button type="button" className="map-room-popup-join-button" onClick={() => onOpenRoom?.(createdRoom)}>
                  Connect
                </button>
              </div>
            </Popup>
          </Marker>
        )}
        {!isSearchingRooms && searchedRoomMarkers.map(room => {
          const markerKey = room.topic || `${room.lat}-${room.lng}-${room.username || ''}`;
          return (
          <Marker
            key={markerKey}
            position={[room.displayLat, room.displayLng]}
            icon={room.icon}
            ref={marker => {
              if (!room.overlapRooms) {
                return;
              }
              if (marker) {
                overlapMarkerRefs.current.set(markerKey, marker);
              } else {
                overlapMarkerRefs.current.delete(markerKey);
              }
            }}
            eventHandlers={room.overlapRooms ? {
              mouseover: event => {
                if (!pinnedOverlapKey || pinnedOverlapKey === markerKey) {
                  event.target.openPopup();
                }
              },
              mouseout: event => {
                if (pinnedOverlapKey !== markerKey) {
                  event.target.closePopup();
                }
              },
              click: event => {
                setPinnedOverlapKey(markerKey);
                event.target.openPopup();
              },
              popupclose: () => {
                setPinnedOverlapKey(currentPinnedKey => (currentPinnedKey === markerKey ? '' : currentPinnedKey));
              },
            } : undefined}
          >
            {room.overlapRooms ? (
              <Popup className="overlap-list-popup" closeButton={false}>
                <div className="overlap-room-popup">
                  <div className="overlap-room-popup-header">
                    <button
                      type="button"
                      className="overlap-room-close-button"
                      aria-label="Close duplicate list"
                      onClick={event => {
                        event.preventDefault();
                        event.stopPropagation();
                        closePinnedOverlapPopup();
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {room.overlapRooms.map(overlapRoom => (
                    <div className="overlap-room-item" key={overlapRoom.topic || `${overlapRoom.lat}-${overlapRoom.lng}-${overlapRoom.username || ''}`}>
                      <div className={`overlap-room-gender ${overlapRoom.gender === 'Female' ? 'female' : 'male'}`}>
                        {overlapRoom.messageType === 'Help' ? '!' : '💬'}
                      </div>
                      <div className="overlap-room-main">
                        <div className="overlap-room-header">
                          <div className="overlap-room-username">{overlapRoom.username}</div>
                          <span className={`map-room-popup-status ${getRoomAvailability(overlapRoom)}`}>
                            {getRoomAvailability(overlapRoom)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="map-room-popup-join-button overlap-room-action"
                          onClick={() => handleRoomActionFromMap(overlapRoom)}
                          disabled={!isHostRoom(overlapRoom) && (Boolean(joiningTopic) || isBusyRoom(overlapRoom))}
                        >
                          {isHostRoom(overlapRoom) ? 'Connect' : isBusyRoom(overlapRoom) ? 'Busy' : joiningTopic === overlapRoom.topic ? 'Joining...' : 'Join'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Popup>
            ) : (
              <Popup
                className={`room-popup ${room.gender === 'Female' ? 'female' : 'male'}${room.messageType === 'Help' ? ' help' : ''}`}
              >
                <div className="map-room-popup">
                  <div className="map-room-popup-header">
                    <div className="map-room-popup-username">{room.username}</div>
                    <span className={`map-room-popup-status ${getRoomAvailability(room)}`}>{getRoomAvailability(room)}</span>
                  </div>
                  {room.message ? <div className="map-room-popup-message">{room.message}</div> : null}
                  <button
                    type="button"
                    className="map-room-popup-join-button"
                    onClick={() => handleRoomActionFromMap(room)}
                    disabled={!isHostRoom(room) && (Boolean(joiningTopic) || isBusyRoom(room))}
                  >
                    {isHostRoom(room) ? 'Connect' : isBusyRoom(room) ? 'Busy' : joiningTopic === room.topic ? 'Joining...' : 'Join'}
                  </button>
                </div>
              </Popup>
            )}
          </Marker>
          );
        })}
      </MapContainer>
      {showThemeToggle && (
        <div
          className={`map-theme-toggle ${isDarkTheme ? 'dark' : 'light'}`}
          role="group"
          aria-label="Map theme"
          onClick={() => onToggleMapTheme?.()}
        >
          <button
            type="button"
            className="map-theme-toggle-option"
            aria-pressed={!isDarkTheme}
            data-theme="light"
          >
            White
          </button>
          <button
            type="button"
            className="map-theme-toggle-option"
            aria-pressed={isDarkTheme}
            data-theme="dark"
          >
            Black
          </button>
        </div>
      )}
      {isSearchingRooms && (
        <div className="scan-modal-backdrop">
          <div className="scan-modal-panel">
            <div className="scan-modal-header">
              <button type="button" className="scan-modal-close-button" onClick={onCancelScan} aria-label="Stop scan">
                ×
              </button>
            </div>
            <div className="scan-radar">
              <div className="scan-radar-circle circle-one" />
              <div className="scan-radar-circle circle-two" />
              <div className="scan-radar-circle circle-three" />
              {radarDots.map(dot => (
                <span key={dot.key} className="scan-radar-dot" style={dot.style} />
              ))}
              <div className="scan-radar-center" />
              <div className="scan-radar-hand" />
            </div>
            <div className="scan-modal-title">Scanning Rooms</div>
            <div className="scan-modal-subtitle">Searching nearby active rooms...</div>
          </div>
        </div>
      )}
      {showNoRoomFound && (
        <div className="no-room-overlay" onClick={onDismissNoRoom}>
          <div className="no-room-panel" onClick={event => event.stopPropagation()}>
            <div className="no-room-header">
              <button type="button" className="no-room-close-button" onClick={onDismissNoRoom} aria-label="Close">
                ×
              </button>
            </div>
            <div className="no-room-body">
              <div className="no-room-icon">😞</div>
              <div className="no-room-text">No room found, try again</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MapComponent;
