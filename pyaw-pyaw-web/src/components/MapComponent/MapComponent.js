import React, { useEffect, useMemo } from 'react';
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

function MapComponent({ createdRoom, locatedPosition, searchedRooms = [], isSearchingRooms }) {
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
        {searchedRoomMarkers.map(room => (
          <Marker key={room.topic} position={[room.lat, room.lng]} icon={room.icon}>
            <Popup>
              Room found
              {room.message ? ` - ${room.message}` : ''}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      {isSearchingRooms && (
        <div className="search-radar-overlay">
          <div className="search-radar-ring ring-one" />
          <div className="search-radar-ring ring-two" />
          <div className="search-radar-ring ring-three" />
          <div className="search-radar-core" />
        </div>
      )}
    </div>
  );
}

export default MapComponent;
