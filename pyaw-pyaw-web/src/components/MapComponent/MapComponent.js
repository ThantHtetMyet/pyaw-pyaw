import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
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

function createMessageMarkerIcon(gender, messageType, availability = 'idle') {
  const isFemale = gender === 'Female';
  const genderClass = isFemale ? 'female' : 'male';
  const availabilityClass = availability === 'busy' ? 'status-busy' : 'status-idle';
  const statusStroke = availability === 'busy' ? '#de4d5f' : '#29b86f';
  const color = isFemale ? '#ff56aa' : '#38a8ff';
  
  if (messageType === 'Help') {
    const helpPath = "M12,2C6.48,2,2,6.48,2,12s4.48,10,10,10s10-4.48,10-10S17.52,2,12,2z M12,20c-4.41,0-8-3.59-8-8s3.59-8,8-8 s8,3.59,8,8S16.41,20,12,20z M12,6c-3.31,0-6,2.69-6,6s2.69,6,6,6s6-2.69,6-6S15.31,6,12,6z";
    return L.divIcon({
      html: `<div class="user-hand-marker ${genderClass} ${availabilityClass} help-marker">
              <div class="marker-pulse"></div>
              <div class="marker-hand-halo"></div>
              <svg class="marker-hand-svg help-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="${helpPath}" fill="${color}" stroke="${statusStroke}" stroke-width="1.2" stroke-linejoin="round" />
              </svg>
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
            <div class="marker-pulse"></div>
            <div class="marker-hand-halo"></div>
            <svg class="marker-hand-svg chat-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="${chatPath}" fill="${color}" stroke="${statusStroke}" stroke-width="1.2" stroke-linejoin="round" />
              <circle cx="9" cy="9.4" r="1.15" fill="#ffffff" />
              <circle cx="12" cy="9.4" r="1.15" fill="#ffffff" />
              <circle cx="15" cy="9.4" r="1.15" fill="#ffffff" />
            </svg>
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
}) {
  const defaultPosition = [51.505, -0.09];
  const markerIcon = useMemo(() => {
    if (!createdRoom) {
      return null;
    }
    return createMessageMarkerIcon(createdRoom.gender, createdRoom.messageType, createdRoom.availability);
  }, [createdRoom]);
  const searchedRoomMarkers = useMemo(
    () =>
      searchedRooms
        .filter(room => Number.isFinite(room?.lat) && Number.isFinite(room?.lng))
        .map(room => ({
          ...room,
          icon: createMessageMarkerIcon(room.gender, room.messageType, room.availability),
        })),
    [searchedRooms]
  );
  const radarDots = useMemo(
    () =>
      searchedRoomMarkers.slice(0, 12).map(room => {
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
    [searchedRoomMarkers]
  );
  const locateIcon = useMemo(
    () =>
      L.divIcon({
        html: '<div class="current-location-dot"></div>',
        className: 'current-location-wrapper',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    []
  );
  const [joiningTopic, setJoiningTopic] = useState('');

  const isHostRoom = room => Boolean(room?.topic) && Boolean(hostRoomTopic) && room.topic === hostRoomTopic;
  const getRoomAvailability = room => (room?.availability === 'busy' ? 'busy' : 'idle');
  const isBusyRoom = room => getRoomAvailability(room) === 'busy';

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
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapResizeSync />
        <MapRecenter createdRoom={createdRoom} locatedPosition={locatedPosition} />
        {locatedPosition && (
          <Marker position={[locatedPosition.lat, locatedPosition.lng]} icon={locateIcon}>
            <Popup>Your current location</Popup>
          </Marker>
        )}
        {createdRoom && markerIcon && (
          <Marker position={[createdRoom.lat, createdRoom.lng]} icon={markerIcon}>
            <Popup className={`room-popup ${createdRoom.gender === 'Female' ? 'female' : 'male'}`}>
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
        {!isSearchingRooms && searchedRoomMarkers.map(room => (
          <Marker key={room.topic} position={[room.lat, room.lng]} icon={room.icon}>
            <Popup className={`room-popup ${room.gender === 'Female' ? 'female' : 'male'}`}>
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
          </Marker>
        ))}
      </MapContainer>
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
