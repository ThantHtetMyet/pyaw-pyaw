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

function createHandMarkerIcon(gender) {
  const genderClass = gender === 'Female' ? 'female' : 'male';
  return L.divIcon({
    html: `<div class="user-hand-marker ${genderClass}"><div class="marker-pulse"></div><div class="marker-hand">☝</div></div>`,
    className: 'user-hand-marker-wrapper',
    iconSize: [56, 56],
    iconAnchor: [28, 52],
    popupAnchor: [0, -40],
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
    return createHandMarkerIcon(createdRoom.gender);
  }, [createdRoom]);
  const searchedRoomMarkers = useMemo(
    () =>
      searchedRooms
        .filter(room => Number.isFinite(room?.lat) && Number.isFinite(room?.lng))
        .map(room => ({
          ...room,
          icon: createHandMarkerIcon(room.gender),
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
            <Popup>
              <div className="map-room-popup">
                <div className="map-room-popup-title">Room found</div>
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
