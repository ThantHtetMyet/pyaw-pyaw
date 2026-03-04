import React, { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function MapRecenter({ createdRoom, locatedPosition, searchedRooms }) {
  const map = useMap();
  const targetPosition = useMemo(() => {
    const roomTime = createdRoom?.createdAt || 0;
    const locateTime = locatedPosition?.locatedAt || 0;
    if (!createdRoom && !locatedPosition) {
      if (searchedRooms.length > 0) {
        return [searchedRooms[0].lat, searchedRooms[0].lng];
      }
      return null;
    }
    if (locateTime >= roomTime && locatedPosition) {
      return [locatedPosition.lat, locatedPosition.lng];
    }
    return [createdRoom.lat, createdRoom.lng];
  }, [createdRoom, locatedPosition, searchedRooms]);

  useEffect(() => {
    if (!targetPosition) {
      return;
    }
    map.flyTo(targetPosition, 16, { duration: 1.1 });
  }, [targetPosition, map]);

  return null;
}

function createHandMarkerIcon(gender, messageType) {
  const isFemale = gender === 'Female';
  const genderClass = isFemale ? 'female' : 'male';
  const color = isFemale ? '#ff56aa' : '#38a8ff';
  
  if (messageType === 'Help') {
    const helpPath = "M12,2C6.48,2,2,6.48,2,12s4.48,10,10,10s10-4.48,10-10S17.52,2,12,2z M12,20c-4.41,0-8-3.59-8-8s3.59-8,8-8 s8,3.59,8,8S16.41,20,12,20z M12,6c-3.31,0-6,2.69-6,6s2.69,6,6,6s6-2.69,6-6S15.31,6,12,6z";
    return L.divIcon({
      html: `<div class="user-hand-marker ${genderClass} help-marker">
              <div class="marker-pulse"></div>
              <div class="marker-hand-halo"></div>
              <svg class="marker-hand-svg help-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="${helpPath}" fill="${color}" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round" />
              </svg>
             </div>`,
      className: 'user-hand-marker-wrapper',
      iconSize: [64, 64],
      iconAnchor: [32, 58],
      popupAnchor: [0, -45],
    });
  }

  const handPath = "M13,2.1v7h-1V3.1c0-0.62-0.5-1.1-1.1-1.1S9.8,2.48,9.8,3.1v6h-1V4.9c0-0.78-0.62-1.4-1.4-1.4S6,4.12,6,4.9v7.7l-0.9-0.2c-0.53-0.12-1.06,0.2-1.18,0.73c-0.04,0.2-0.02,0.41,0.05,0.6l1.28,3.94C5.68,19.1,6.82,20,8.1,20H16c1.66,0,3-1.34,3-3V9.9c0-0.78-0.62-1.4-1.4-1.4s-1.4,0.62-1.4,1.4v1.8h-1V4.2c0-0.62-0.5-1.1-1.1-1.1S13,3.58,13,4.2z";

  return L.divIcon({
    html: `<div class="user-hand-marker ${genderClass}">
            <div class="marker-pulse"></div>
            <div class="marker-hand-halo"></div>
            <span class="marker-wave-line line-one"></span>
            <span class="marker-wave-line line-two"></span>
            <svg class="marker-hand-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="${handPath}" fill="${color}" stroke="#ffffff" stroke-width="1.1" stroke-linejoin="round" />
              <path class="marker-finger-lines" d="M9.2 5.2V9.3M11 4.2V9.1M12.8 5V9.2M14.7 6.1V9.3" />
              <path class="marker-palm-highlight" d="M8.2 12.2c0.9-0.5 2.2-0.8 3.6-0.8c1.5 0 2.9 0.3 4 0.9c0.3 0.2 0.5 0.6 0.3 0.9c-0.2 0.3-0.6 0.4-0.9 0.2c-0.8-0.5-2-0.7-3.4-0.7c-1.3 0-2.4 0.2-3.2 0.7c-0.3 0.2-0.7 0.1-0.9-0.2C7.8 12.8 7.9 12.4 8.2 12.2z" />
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
  locatedPosition,
  searchedRooms = [],
  isSearchingRooms,
  showNoRoomFound = false,
  onDismissNoRoom,
  onCancelScan,
  onJoinRoom,
}) {
  const defaultPosition = [51.505, -0.09];
  const markerIcon = useMemo(() => {
    if (!createdRoom) {
      return null;
    }
    return createHandMarkerIcon(createdRoom.gender, createdRoom.messageType);
  }, [createdRoom]);
  const searchedRoomMarkers = useMemo(
    () =>
      searchedRooms
        .filter(room => Number.isFinite(room?.lat) && Number.isFinite(room?.lng))
        .map(room => ({
          ...room,
          icon: createHandMarkerIcon(room.gender, room.messageType),
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

  const handleJoinFromMap = async room => {
    if (!room?.topic || joiningTopic) {
      return;
    }
    setJoiningTopic(room.topic);
    try {
      await onJoinRoom?.(room);
    } finally {
      setJoiningTopic('');
    }
  };

  return (
    <div className="map-stage">
      <MapContainer center={defaultPosition} zoom={13} style={{ height: '100vh', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapRecenter createdRoom={createdRoom} locatedPosition={locatedPosition} searchedRooms={searchedRoomMarkers} />
        {locatedPosition && (
          <Marker position={[locatedPosition.lat, locatedPosition.lng]} icon={locateIcon}>
            <Popup>Your current location</Popup>
          </Marker>
        )}
        {createdRoom && markerIcon && (
          <Marker position={[createdRoom.lat, createdRoom.lng]} icon={markerIcon}>
            <Popup>
              I am here
              {createdRoom.message ? ` - ${createdRoom.message}` : ''}
            </Popup>
          </Marker>
        )}
        {!isSearchingRooms && searchedRoomMarkers.map(room => (
          <Marker key={room.topic} position={[room.lat, room.lng]} icon={room.icon}>
            <Popup className={`room-popup ${room.gender === 'Female' ? 'female' : 'male'}`}>
              <div className="map-room-popup">
                <div className="map-room-popup-header">
                  <div className="map-room-popup-username">{room.username}</div>
                </div>
                {room.message ? <div className="map-room-popup-message">{room.message}</div> : null}
                <button
                  type="button"
                  className="map-room-popup-join-button"
                  onClick={() => handleJoinFromMap(room)}
                  disabled={Boolean(joiningTopic)}
                >
                  {joiningTopic === room.topic ? 'Joining...' : 'Join'}
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
